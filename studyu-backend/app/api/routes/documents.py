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
from app.services.rag import ingest_document, ingest_url

router = APIRouter()

STORAGE_BUCKET = "documents"


@router.post("/documents/upload")
async def upload_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """PDF 업로드 → Supabase Storage 저장 → documents 테이블 등록 → RAG 청킹."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    doc_id = str(uuid.uuid4())
    file_bytes = await file.read()
    storage_path = f"{user['id']}/{doc_id}.pdf"

    # 1. Supabase Storage에 PDF 업로드
    try:
        supabase_admin.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            file_bytes,
            {"content-type": "application/pdf"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    # 2. documents 테이블에 메타데이터 저장
    try:
        supabase_admin.table("documents").insert({
            "id": doc_id,
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "filename": file.filename.replace('\x00', ''),
            "file_type": "pdf",
            "file_size": len(file_bytes),
            "storage_path": storage_path,
            "status": "processing",
        }).execute()
    except Exception as e:
        supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")

    # 3. RAG 청킹 → document_chunks 저장
    try:
        chunk_count, page_count = ingest_document(file_bytes, doc_id, filename=file.filename)
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        raise HTTPException(status_code=500, detail=f"문서 파싱 실패: {str(e)}")

    # 4. 상태 업데이트
    supabase_admin.table("documents").update({
        "status": "ready",
        "chunk_count": chunk_count,
        "page_count": page_count,
    }).eq("id", doc_id).execute()

    return {
        "doc_id": doc_id,
        "filename": file.filename,
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
