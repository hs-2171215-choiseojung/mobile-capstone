import io
import os
import re
import shutil
import subprocess
import tempfile
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form

from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.api.routes.documents import (
    STORAGE_BUCKET,
    STORAGE_CONTENT_TYPES,
    STORABLE_EXTENSIONS,
    MAX_FILE_SIZE,
    MAX_VIDEO_SIZE,
    _generate_and_upload_slides,
    _generate_and_upload_docx_pages,
    _generate_and_upload_hwpx_pages,
)
from app.services.rag import ingest_document, SUPPORTED_EXTENSIONS, VIDEO_AUDIO_EXTENSIONS

router = APIRouter()

PREVIEWABLE_EXTENSIONS = {"docx", "pptx", "ppt"}


def _find_soffice_executable() -> str | None:
    candidates = [
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _convert_office_bytes_to_pdf(file_bytes: bytes, ext: str) -> bytes | None:
    soffice = _find_soffice_executable()
    if not soffice:
        return None

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_path = os.path.join(tmp_dir, f"source.{ext}")
        output_path = os.path.join(tmp_dir, "source.pdf")

        with open(input_path, "wb") as source_file:
            source_file.write(file_bytes)

        try:
            completed = subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp_dir,
                    input_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except Exception:
            return None

        if completed.returncode != 0 or not os.path.exists(output_path):
            return None

        with open(output_path, "rb") as pdf_file:
            return pdf_file.read()


def _authorize_document_access(document_id: str, user_id: str) -> dict:
    doc_res = (
        supabase_admin.table("documents")
        .select("id, notebook_id, user_id, storage_path, filename, status")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    doc = doc_res.data[0]
    if doc.get("status") != "ready":
        raise HTTPException(status_code=404, detail="사용할 수 없는 문서입니다.")

    notebook_id = doc.get("notebook_id")
    if not notebook_id:
        raise HTTPException(status_code=400, detail="노트북 정보가 없는 문서입니다.")

    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .single()
        .execute()
        .data
    )
    if not nb:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")

    if nb.get("user_id") != user_id:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user_id)
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="문서 열람 권한이 없습니다.")

    return doc


@router.get("/proxy")
async def proxy_webpage(
    url: str = Query(..., description="프록시할 웹페이지 URL"),
    user: dict = Depends(get_current_user),
):
    """웹페이지를 서버 측에서 가져와 iframe 표시용으로 반환.
    CSP/X-Frame-Options 메타 태그 제거, base 태그 주입."""
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="유효하지 않은 URL입니다.")

    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
            resp = await client.get(url, headers=req_headers)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"페이지를 가져올 수 없습니다: {str(e)}")

    raw = resp.content

    # 바이너리 응답 감지
    null_ratio = raw.count(b"\x00") / max(len(raw), 1)
    if null_ratio > 0.005:
        fallback_html = f"""<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;">
<p>이 페이지는 바이너리 응답으로 인해 표시할 수 없습니다.</p>
<a href="{url}" target="_blank">원본 페이지 열기 →</a>
</body></html>"""
        return Response(content=fallback_html.encode("utf-8"), media_type="text/html; charset=utf-8")

    # 인코딩 감지
    content_type = resp.headers.get("content-type", "")
    charset = "utf-8"
    for part in content_type.split(";"):
        part = part.strip()
        if part.lower().startswith("charset="):
            charset = part[8:].strip().strip('"\'')
            break
    try:
        html = raw.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        html = raw.decode("utf-8", errors="replace")

    # CSP / X-Frame-Options 메타 태그 제거
    html = re.sub(
        r'<meta[^>]+http-equiv=["\']?Content-Security-Policy["\']?[^>]*>',
        '', html, flags=re.IGNORECASE
    )
    html = re.sub(
        r'<meta[^>]+http-equiv=["\']?X-Frame-Options["\']?[^>]*>',
        '', html, flags=re.IGNORECASE
    )

    # <base> 태그 주입 (상대 경로 → 절대 경로, 링크는 새 탭으로)
    base_tag = f'<base href="{url}" target="_blank">'
    if re.search(r'<head[^>]*>', html, re.IGNORECASE):
        html = re.sub(r'(<head[^>]*>)', r'\1' + base_tag, html, count=1, flags=re.IGNORECASE)
    else:
        html = base_tag + html

    return Response(
        content=html.encode("utf-8", errors="replace"),
        media_type="text/html; charset=utf-8",
        headers={"X-Frame-Options": "SAMEORIGIN"},
    )


@router.get("/documents/{document_id}/preview-pdf")
async def get_student_document_preview_pdf(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    doc = _authorize_document_access(document_id, user["id"])
    filename = doc.get("filename") or ""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in PREVIEWABLE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="PDF 미리보기를 지원하지 않는 문서입니다.")

    storage_path = (doc.get("storage_path") or "").strip()
    if not storage_path or storage_path.startswith(("http://", "https://")):
        raise HTTPException(status_code=404, detail="원본 파일이 저장되어 있지 않습니다.")

    try:
        file_bytes = supabase_admin.storage.from_(STORAGE_BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"원본 문서 다운로드 실패: {str(e)}")

    if not file_bytes:
        raise HTTPException(status_code=500, detail="원본 문서를 불러오지 못했습니다.")

    pdf_bytes = _convert_office_bytes_to_pdf(file_bytes, ext)
    if not pdf_bytes:
        raise HTTPException(status_code=503, detail="PDF 미리보기를 생성할 수 없습니다.")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{document_id}.pdf"'},
    )


# ──────────────────────────────────────────────────────────────
# 학생 직접 파일 업로드
# ──────────────────────────────────────────────────────────────

def _check_enrollment(notebook_id: str, student_id: str) -> None:
    """학생이 해당 노트북에 enrolled 되어 있는지 확인."""
    enrolled = (
        supabase_admin.table("notebook_enrollments")
        .select("id")
        .eq("notebook_id", notebook_id)
        .eq("student_id", student_id)
        .execute()
        .data
    )
    if not enrolled:
        raise HTTPException(status_code=403, detail="수강 중인 노트북이 아닙니다.")


@router.post("/student/documents/upload")
async def upload_student_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """학생이 직접 파일을 업로드합니다. → Storage 저장 + documents 테이블 + RAG 청킹."""
    _check_enrollment(notebook_id, user["id"])

    if not file.filename:
        raise HTTPException(status_code=400, detail="파일명이 없습니다.")

    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(f".{e}" for e in sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 형식입니다. 지원 형식: {supported}")

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    if ext in VIDEO_AUDIO_EXTENSIONS and len(file_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail="비디오/오디오 파일은 25MB 이하만 가능합니다.")
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기는 200MB 이하만 가능합니다.")

    # 중복 업로드 검사 (같은 학생, 같은 노트북, 같은 파일명)
    try:
        existing = (
            supabase_admin.table("documents")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("user_id", user["id"])
            .eq("filename", file.filename.replace("\x00", ""))
            .eq("status", "ready")
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=409, detail="같은 이름의 파일이 이미 업로드되어 있습니다.")
    except HTTPException:
        raise
    except Exception:
        pass

    doc_id = str(uuid.uuid4())

    # 1. Storage 저장
    storage_path = ""
    if ext in STORABLE_EXTENSIONS:
        content_type = STORAGE_CONTENT_TYPES.get(ext, "application/octet-stream")
        storage_path = f"student-uploads/{user['id']}/{doc_id}.{ext}"
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                file_bytes,
                {"content-type": content_type},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    # 2. documents 테이블 등록
    # DB file_type 컬럼이 enum이므로 허용된 값으로 매핑
    # (pdf, url, youtube, text, image) — 실제 확장자는 filename에서 추출
    if ext in {"jpg", "jpeg", "png", "gif", "webp"}:
        db_file_type = "image"
    else:
        db_file_type = "pdf"  # docx, pptx, ppt, hwpx, mp4, mp3 등
    try:
        supabase_admin.table("documents").insert({
            "id": doc_id,
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "filename": file.filename.replace("\x00", ""),
            "file_type": db_file_type,
            "file_size": len(file_bytes),
            "storage_path": storage_path,
            "status": "processing",
        }).execute()
    except Exception as e:
        if storage_path:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")

    # 3. 슬라이드 에셋 생성 (docx/pptx/ppt/hwpx)
    if ext in ("pptx", "ppt"):
        try:
            _generate_and_upload_slides(file_bytes, doc_id)
        except Exception as _e:
            print(f"[student_upload] 슬라이드 에셋 생성 실패 (무시): {_e}")
    elif ext == "docx":
        try:
            _generate_and_upload_docx_pages(file_bytes, doc_id)
        except Exception as _e:
            print(f"[student_upload] docx 페이지 에셋 생성 실패 (무시): {_e}")
    elif ext == "hwpx":
        try:
            _generate_and_upload_hwpx_pages(file_bytes, doc_id)
        except Exception as _e:
            print(f"[student_upload] hwpx 페이지 에셋 생성 실패 (무시): {_e}")

    # 4. RAG 청킹
    try:
        chunk_count, page_count = ingest_document(
            file_bytes, doc_id, filename=file.filename,
        )
    except Exception as e:
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        if storage_path:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=500, detail=f"문서 분석 실패: {str(e)}")

    # 4. 상태 ready로 업데이트
    supabase_admin.table("documents").update({
        "status": "ready",
        "chunk_count": chunk_count,
        "page_count": page_count,
    }).eq("id", doc_id).execute()

    return {
        "id": doc_id,
        "filename": file.filename,
        "status": "ready",
        "chunk_count": chunk_count,
    }


@router.get("/student/documents/my")
async def get_my_student_documents(
    notebook_id: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """현재 학생이 해당 노트북에 직접 업로드한 파일 목록을 반환합니다."""
    _check_enrollment(notebook_id, user["id"])

    res = (
        supabase_admin.table("documents")
        .select("id, filename, file_type, file_size, status, created_at")
        .eq("notebook_id", notebook_id)
        .eq("user_id", user["id"])
        .eq("status", "ready")
        .order("created_at", desc=True)
        .execute()
    )

    docs = [
        {
            "id": d["id"],
            "filename": d["filename"],
            # file_type은 DB enum 우회용이므로 실제 확장자는 filename에서 추출
            "type": d["filename"].lower().rsplit(".", 1)[-1] if "." in (d.get("filename") or "") else (d.get("file_type") or ""),
            "file_size": d.get("file_size") or 0,
            "created_at": d.get("created_at"),
        }
        for d in (res.data or [])
    ]
    return {"documents": docs}


@router.delete("/student/documents/{document_id}")
async def delete_my_student_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """학생이 직접 올린 파일을 삭제합니다."""
    doc_res = (
        supabase_admin.table("documents")
        .select("id, user_id, storage_path, notebook_id")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    doc = doc_res.data[0]
    if doc["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")

    storage_path = (doc.get("storage_path") or "").strip()
    if storage_path and not storage_path.startswith(("http://", "https://")):
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass

    supabase_admin.table("documents").delete().eq("id", document_id).execute()
    return {"ok": True}
