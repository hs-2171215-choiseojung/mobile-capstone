"""
요약 / 퀴즈 / 학습 계획 생성 라우터.

엔드포인트:
    POST /api/generate  → 콘텐츠 생성 (summary | quiz | plan)
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.services.rag import generate_content

router = APIRouter()


class GenerateRequest(BaseModel):
    doc_id: Optional[str] = None
    doc_ids: Optional[list[str]] = None
    type: str  # "summary" | "quiz" | "plan"
    model: Optional[str] = "gpt-4o-mini"
    level: Optional[str] = "intermediate"
    quiz_count: Optional[int] = 5
    topic: Optional[str] = None
    difficulty: Optional[str] = "intermediate"


@router.post("/generate")
async def generate(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
):
    """요약 / 퀴즈 / 학습 계획 생성."""
    if req.type not in ("summary", "quiz", "plan"):
        raise HTTPException(
            status_code=400,
            detail="type은 summary | quiz | plan 중 하나여야 합니다.",
        )

    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    result = generate_content(
        doc_ids=doc_ids,
        gen_type=req.type,
        model=req.model or "gpt-4o-mini",
        level=req.level or "intermediate",
        quiz_count=req.quiz_count or 5,
        topic=req.topic or "",
        difficulty=req.difficulty or "intermediate",
    )
    return {"result": result, "type": req.type}
