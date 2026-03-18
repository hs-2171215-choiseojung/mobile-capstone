"""
문서 관리 라우터.

엔드포인트:
    POST   /api/documents/upload      → PDF 파일 업로드 & RAG 인덱싱
    POST   /api/documents/ingest-url  → URL / YouTube 링크 인덱싱
    DELETE /api/documents/{id}        → 문서 삭제
"""

import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.services.rag import ingest_document, ingest_url, ingest_youtube, _extract_youtube_id, _doc_store

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


class IngestUrlRequest(BaseModel):
    notebook_id: str
    url: str


@router.post("/documents/ingest-url")
async def ingest_url_endpoint(
    req: IngestUrlRequest,
    user: dict = Depends(get_current_user),
):
    """URL 또는 YouTube 링크 인덱싱."""
    doc_id = str(uuid.uuid4())

    try:
        if _extract_youtube_id(req.url):
            chunk_count, title = ingest_youtube(req.url, doc_id)
            source_type = "youtube"
        else:
            chunk_count, title = ingest_url(req.url, doc_id)
            source_type = "url"
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import xml.etree.ElementTree as ET
        if isinstance(e, ET.ParseError):
            raise HTTPException(status_code=502, detail="콘텐츠 파싱에 실패했습니다. URL이 올바른지 확인하거나 잠시 후 다시 시도해주세요.")
        raise HTTPException(status_code=502, detail=f"콘텐츠를 가져오는 데 실패했습니다: {e}")

    return {
        "doc_id": doc_id,
        "filename": title,
        "chunk_count": chunk_count,
        "notebook_id": req.notebook_id,
        "source_type": source_type,
        "message": "인덱싱 완료",
    }


class RenameRequest(BaseModel):
    name: str


@router.patch("/documents/{document_id}")
async def rename_document(
    document_id: str,
    req: RenameRequest,
    user: dict = Depends(get_current_user),
):
    """문서 이름 변경."""
    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="이름을 입력해주세요.")
    if document_id not in _doc_store:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    _doc_store[document_id]["filename"] = new_name
    return {"message": "이름 변경 완료", "name": new_name}


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """업로드된 문서 삭제 (파일 + 인덱스)."""
    pdf_path = UPLOAD_DIR / f"{document_id}.pdf"
    if pdf_path.exists():
        pdf_path.unlink()
    _doc_store.pop(document_id, None)
    return {"message": "삭제 완료"}
