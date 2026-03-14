"""
RAG 질의응답 (채팅) 라우터.

엔드포인트:
    POST /api/chat   → RAG 기반 질의응답
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.services.rag import chat_with_docs

router = APIRouter()

# 세션별 대화 히스토리 (in-memory 프로토타입용)
_history_cache: dict[str, list] = {}


class ChatRequest(BaseModel):
    doc_id: Optional[str] = None
    doc_ids: Optional[list[str]] = None
    doc_names: Optional[dict[str, str]] = None
    question: str
    session_id: Optional[str] = None
    model: Optional[str] = "gpt-4o-mini"
    level: Optional[str] = "intermediate"


class ChatResponse(BaseModel):
    answer: str
    sources: list[str]
    session_id: str


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    user: dict = Depends(get_current_user),
):
    """문서 기반 RAG 질의응답."""
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    session_key = f"{user['id']}:{','.join(doc_ids)}:{req.session_id or 'default'}"
    if session_key not in _history_cache:
        _history_cache[session_key] = []
    chat_history = _history_cache[session_key]

    answer, sources = chat_with_docs(
        doc_ids=doc_ids,
        question=req.question,
        model=req.model or "gpt-4o-mini",
        level=req.level or "intermediate",
        chat_history=chat_history,
    )

    chat_history.append({"role": "user", "content": req.question})
    chat_history.append({"role": "assistant", "content": answer})

    return ChatResponse(
        answer=answer,
        sources=sources,
        session_id=req.session_id or "default",
    )
