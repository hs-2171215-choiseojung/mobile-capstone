"""
RAG 질의응답 (채팅) 라우터.

엔드포인트:
    POST /api/chat   → RAG 기반 질의응답
"""

from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.services.rag import chat_with_docs, generate_suggestions

router = APIRouter()


class ChatRequest(BaseModel):
    doc_id: Optional[str] = None
    doc_ids: Optional[list[str]] = None
    doc_names: Optional[dict[str, str]] = None
    question: str
    session_id: Optional[str] = None
    model: Optional[str] = "gpt-4o"
    level: Optional[str] = "intermediate"
    current_slide: Optional[int] = None
    asked_questions: Optional[list[str]] = []
    chat_history: Optional[list] = []


class ChatResponse(BaseModel):
    answer: str
    sources: list[Any]
    references: list[dict[str, Any]] = []
    session_id: str
    suggested_questions: list[str] = []


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    user: dict = Depends(get_current_user),
):
    """문서 기반 RAG 질의응답."""
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    answer, sources, references, suggested_questions = chat_with_docs(
        doc_ids=doc_ids,
        question=req.question,
        model=req.model or "gpt-4o",
        level=req.level or "intermediate",
        chat_history=req.chat_history or [],
        current_slide=req.current_slide,
    )

    return ChatResponse(
        answer=answer,
        sources=sources,
        references=references,
        session_id=req.session_id or "default",
        suggested_questions=suggested_questions,
    )


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    user: dict = Depends(get_current_user),
):
    """스트리밍 RAG 질의응답 — SSE(text/event-stream)로 토큰을 즉시 전송."""
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    generator, _, _ = chat_with_docs(
        doc_ids=doc_ids,
        question=req.question,
        model=req.model or "gpt-4o",
        level=req.level or "intermediate",
        chat_history=req.chat_history or [],
        current_slide=req.current_slide,
        stream=True,
        asked_questions=req.asked_questions or [],
    )

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


class SuggestionsRequest(BaseModel):
    doc_ids: list[str]
    asked_questions: list[str] = []
    model: Optional[str] = "gpt-4o"
    last_answer: str = ""


class SuggestionsResponse(BaseModel):
    questions: list[Any]


@router.post("/chat/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    req: SuggestionsRequest,
    user: dict = Depends(get_current_user),
):
    """문서 기반 추천 질문 3개 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    questions = generate_suggestions(
        doc_ids=req.doc_ids,
        asked_questions=req.asked_questions,
        model=req.model or "gpt-4o",
        last_answer=req.last_answer,
    )
    return SuggestionsResponse(questions=questions)
