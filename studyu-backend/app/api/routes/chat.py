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
    current_slide: Optional[int] = None
    asked_questions: Optional[list[str]] = []


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

    session_key = f"{user['id']}:{','.join(sorted(doc_ids))}:{req.session_id or 'default'}"
    if session_key not in _history_cache:
        _history_cache[session_key] = []
    chat_history = _history_cache[session_key]

    answer, sources, references, suggested_questions = chat_with_docs(
        doc_ids=doc_ids,
        question=req.question,
        model=req.model or "gpt-4o-mini",
        level=req.level or "intermediate",
        chat_history=chat_history,
        current_slide=req.current_slide,
    )

    chat_history.append({"role": "user", "content": req.question})
    chat_history.append({"role": "assistant", "content": answer})

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

    session_key = f"{user['id']}:{','.join(sorted(doc_ids))}:{req.session_id or 'default'}"
    if session_key not in _history_cache:
        _history_cache[session_key] = []
    chat_history = _history_cache[session_key]

    generator, _, _ = chat_with_docs(
        doc_ids=doc_ids,
        question=req.question,
        model=req.model or "gpt-4o-mini",
        level=req.level or "intermediate",
        chat_history=chat_history,
        current_slide=req.current_slide,
        stream=True,
        asked_questions=req.asked_questions or [],
    )

    # 히스토리는 스트리밍이 끝난 뒤 프론트에서 완성된 텍스트로 업데이트하므로
    # 여기서는 user 메시지만 미리 추가
    chat_history.append({"role": "user", "content": req.question})

    return StreamingResponse(generator, media_type="text/event-stream")


class SuggestionsRequest(BaseModel):
    doc_ids: list[str]
    asked_questions: list[str] = []
    model: Optional[str] = "gpt-4o-mini"
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
        model=req.model or "gpt-4o-mini",
        last_answer=req.last_answer,
    )
    return SuggestionsResponse(questions=questions)
