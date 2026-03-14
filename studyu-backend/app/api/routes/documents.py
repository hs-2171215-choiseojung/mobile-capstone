"""
문서 관리 라우터.

엔드포인트:
    POST   /api/documents/upload     → 파일 업로드 & RAG 인덱싱
    DELETE /api/documents/{id}       → 문서 삭제
"""

import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.core.auth import get_current_user
from app.services.rag import ingest_document

router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parents[4] / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("/documents/upload")
async def upload_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """PDF 업로드 및 RAG 인덱싱."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    doc_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{doc_id}.pdf"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    chunk_count = ingest_document(str(save_path), doc_id, filename=file.filename)

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
    """업로드된 PDF 파일 삭제."""
    pdf_path = UPLOAD_DIR / f"{document_id}.pdf"
    if pdf_path.exists():
        pdf_path.unlink()
    return {"message": "삭제 완료"}
