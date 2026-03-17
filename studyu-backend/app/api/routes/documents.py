"""
문서 관리 라우터.

엔드포인트:
    POST   /api/documents/upload     → Supabase Storage 저장 + DB 등록 + RAG 청킹
    DELETE /api/documents/{id}       → Storage + DB 삭제 (CASCADE로 chunks 자동 삭제)
"""

import uuid

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.services.rag import ingest_document

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
        print(f"[ERROR] ingest_document 실패: {type(e).__name__}: {e}")
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

    # Storage에서 파일 삭제
    storage_path = result.data.get("storage_path")
    if storage_path:
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass  # Storage 삭제 실패해도 DB 삭제는 계속 진행

    # DB에서 삭제 (CASCADE → document_chunks 자동 삭제)
    supabase_admin.table("documents").delete().eq("id", document_id).execute()

    return {"message": "삭제 완료"}
