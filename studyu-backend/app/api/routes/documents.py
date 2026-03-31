"""
문서 관리 라우터.

엔드포인트:
    POST   /api/documents/upload       → Supabase Storage 저장 + DB 등록 + RAG 청킹
    POST   /api/documents/ingest_url   → URL에서 텍스트 추출 + DB 등록 + RAG 청킹
    PATCH  /api/documents/{id}         → 파일명 변경
    DELETE /api/documents/{id}         → Storage + DB 삭제 (CASCADE로 chunks 자동 삭제)

이슈 1 (file_type enum):
    Supabase DB의 file_type 컬럼이 enum인 경우 "url" 값이 거부될 수 있습니다.
    URL 문서는 storage_path에 URL 전체를 저장하고, file_type은 기본값("pdf")을 사용합니다.
    삭제 시에는 storage_path가 http로 시작하면 Storage 삭제를 건너뜁니다.

    근본 해결 (Supabase SQL Editor에서 실행):
        ALTER TABLE documents ALTER COLUMN file_type TYPE TEXT;
"""

import uuid
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.services.rag import ingest_document, ingest_url, SUPPORTED_EXTENSIONS

router = APIRouter()

STORAGE_BUCKET = "documents"

STORAGE_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
}
# Supabase Storage에 저장하는 확장자 (오피스 문서 형식은 MIME 미지원)
STORABLE_EXTENSIONS = set(STORAGE_CONTENT_TYPES.keys())

# 파일 크기 제한 (바이트)
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_VIDEO_SIZE = 25 * 1024 * 1024  # Whisper API 제한 25MB
VIDEO_AUDIO_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "webm", "mp3", "m4a"}


@router.post("/documents/upload")
async def upload_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """파일 업로드 → Supabase Storage 저장 → documents 테이블 등록 → RAG 청킹."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일명이 없습니다.")

    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(f".{e}" for e in sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 형식입니다. 지원 형식: {supported}")

    file_bytes = await file.read()

    # 파일 크기 검사
    if ext in VIDEO_AUDIO_EXTENSIONS and len(file_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail=f"비디오/오디오 파일은 25MB 이하만 가능합니다.")
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기는 100MB 이하만 가능합니다.")

    doc_id = str(uuid.uuid4())

    # 1. Supabase Storage에 업로드 (PDF·이미지·비디오·오디오)
    if ext in STORABLE_EXTENSIONS:
        storage_path = f"{user['id']}/{doc_id}.{ext}"
        content_type = STORAGE_CONTENT_TYPES[ext]
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                file_bytes,
                {"content-type": content_type},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")
    else:
        # DOCX·PPTX·HWP 등 오피스 문서는 Storage 저장 없이 텍스트 추출만 진행
        storage_path = ""


    # 2. documents 테이블에 메타데이터 저장
    try:
        supabase_admin.table("documents").insert({
            "id": doc_id,
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "filename": file.filename.replace('\x00', ''),
            "file_type": "pdf",  # enum 제약 우회: 실제 형식은 filename에서 판단
            "file_size": len(file_bytes),
            "storage_path": storage_path,
            "status": "processing",
        }).execute()
    except Exception as e:
        if storage_path:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")

    # 3. RAG 청킹 → document_chunks 저장
    try:
        chunk_count, page_count = ingest_document(file_bytes, doc_id, filename=file.filename)
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        raise HTTPException(status_code=500, detail=f"파일 파싱 실패: {str(e)}")

    # 4. 상태 업데이트
    supabase_admin.table("documents").update({
        "status": "ready",
        "chunk_count": chunk_count,
        "page_count": page_count,
    }).eq("id", doc_id).execute()

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "file_type": ext,
        "chunk_count": chunk_count,
        "notebook_id": notebook_id,
        "message": "업로드 및 인덱싱 완료",
    }


class IngestUrlRequest(BaseModel):
    notebook_id: str
    url: str
    filename: Optional[str] = None


@router.post("/documents/ingest_url")
async def ingest_url_document(
    req: IngestUrlRequest,
    user: dict = Depends(get_current_user),
):
    """URL에서 텍스트 추출 → documents 테이블 등록 → RAG 청킹.

    file_type enum 문제 우회: storage_path에 URL을 저장하고 file_type은 기본값 사용.
    """
    # 표시 파일명 결정
    if req.filename:
        display_name = req.filename[:80]
    else:
        try:
            parsed = urlparse(req.url)
            domain = parsed.netloc.lstrip("www.")
            path_parts = [p for p in parsed.path.strip("/").split("/") if p]
            display_name = f"{domain}/{path_parts[0]}" if path_parts else domain
            display_name = display_name[:80]
        except Exception:
            display_name = req.url[:80]

    doc_id = str(uuid.uuid4())

    # 1. documents 테이블에 등록 (storage_path = URL, file_type = 기본값)
    insert_data: dict = {
        "id": doc_id,
        "notebook_id": req.notebook_id,
        "user_id": user["id"],
        "filename": display_name,
        "file_size": 0,
        "storage_path": req.url,   # URL을 storage_path에 저장
        "status": "processing",
    }
    # file_type 컬럼 처리: TEXT면 "url", enum이면 "pdf"로 폴백
    try:
        supabase_admin.table("documents").insert({**insert_data, "file_type": "url"}).execute()
    except Exception as first_err:
        if "enum" in str(first_err).lower() or "invalid input value" in str(first_err).lower() or "23502" in str(first_err):
            # enum 제약 우회: 유효한 enum 값 "pdf" 사용
            try:
                supabase_admin.table("documents").insert({**insert_data, "file_type": "pdf"}).execute()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")
        else:
            raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(first_err)}")

    # 2. URL에서 텍스트 추출 → RAG 청킹
    try:
        chunk_count, _ = ingest_url(req.url, doc_id)
    except ValueError as e:
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        raise HTTPException(status_code=500, detail=f"URL 처리 실패: {str(e)}")

    # 3. 상태 업데이트
    supabase_admin.table("documents").update({
        "status": "ready",
        "chunk_count": chunk_count,
    }).eq("id", doc_id).execute()

    return {
        "doc_id": doc_id,
        "filename": display_name,
        "chunk_count": chunk_count,
        "notebook_id": req.notebook_id,
        "message": "URL 인덱싱 완료",
    }


class RenameRequest(BaseModel):
    filename: str


@router.get("/documents/{document_id}/access-url")
async def get_document_access_url(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 열람용 URL 반환 (소유자 또는 수강 학생)."""
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

    owner_id = nb.get("user_id")
    is_owner = owner_id == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="문서 열람 권한이 없습니다.")

    storage_path = (doc.get("storage_path") or "").strip()
    if not storage_path:
        raise HTTPException(status_code=400, detail="문서 경로 정보가 없습니다.")

    if storage_path.startswith(("http://", "https://")):
        return {"url": storage_path, "kind": "external"}

    try:
        resp = supabase_admin.storage.from_(STORAGE_BUCKET).create_signed_url(
            storage_path, 3600
        )
        signed_url = resp.get("signedURL") or resp.get("signedUrl") or ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"문서 URL 생성 실패: {str(e)}")

    if not signed_url:
        raise HTTPException(status_code=500, detail="문서 URL 생성에 실패했습니다.")

    return {"url": signed_url, "kind": "signed", "expires_in": 3600}


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 청크 텍스트 반환 (미리보기용)."""
    doc_res = (
        supabase_admin.table("documents")
        .select("user_id, notebook_id")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    # 소유자 또는 수강생 확인
    if doc_res.data["user_id"] != user["id"]:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", doc_res.data["notebook_id"])
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    chunks_res = (
        supabase_admin.table("document_chunks")
        .select("content")
        .eq("doc_id", document_id)
        .order("chunk_index")
        .execute()
    )
    text = "\n\n".join(c["content"] for c in (chunks_res.data or []))
    return {"text": text}


@router.patch("/documents/{document_id}")
async def rename_document(
    document_id: str,
    req: RenameRequest,
    user: dict = Depends(get_current_user),
):
    """문서 이름 변경."""
    result = (
        supabase_admin.table("documents")
        .select("user_id")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if result.data["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다.")

    new_filename = req.filename.replace('\x00', '').strip()
    if not new_filename:
        raise HTTPException(status_code=400, detail="파일명이 비어 있습니다.")

    supabase_admin.table("documents").update({"filename": new_filename}).eq("id", document_id).execute()
    return {"message": "이름 변경 완료", "filename": new_filename}


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 삭제 — Storage 파일 + documents 테이블 (CASCADE로 chunks 자동 삭제)."""
    result = (
        supabase_admin.table("documents")
        .select("storage_path, user_id")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if result.data["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")

    storage_path = result.data.get("storage_path", "")
    # URL 문서는 storage_path가 http(s)://로 시작 → Storage 삭제 건너뜀
    is_url_doc = storage_path.startswith(("http://", "https://"))
    if storage_path and not is_url_doc:
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass

    supabase_admin.table("documents").delete().eq("id", document_id).execute()
    return {"message": "삭제 완료"}
