import io
import os
import re
import shutil
import subprocess
import tempfile

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.api.routes.documents import STORAGE_BUCKET

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
