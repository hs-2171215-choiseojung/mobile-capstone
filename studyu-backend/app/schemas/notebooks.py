"""
노트북 관련 Pydantic 스키마.

스키마 = API 요청/응답의 데이터 형식을 정의하는 것.
FastAPI가 자동으로 검증하고, 잘못된 데이터가 오면 에러를 반환합니다.

예시:
    POST /api/notebooks 요청 시
    {"title": "운영체제"} → OK (NotebookCreate에 맞음)
    {"title": ""}         → 에러 (min_length=1 위반)
    {}                     → 에러 (title 필수)
"""

from pydantic import BaseModel, Field
from datetime import datetime


# ── 요청 스키마 ──

class NotebookCreate(BaseModel):
    """노트북 생성 요청."""
    title: str = Field(..., min_length=1, max_length=200, examples=["운영체제 기말고사 준비"])
    description: str | None = Field(None, max_length=1000, examples=["OS 강의자료 정리"])
    default_model: str = Field("openai", examples=["openai", "claude"])
    difficulty: str = Field("intermediate", examples=["beginner", "intermediate", "advanced"])


class NotebookUpdate(BaseModel):
    """노트북 수정 요청. 모든 필드가 선택적."""
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    default_model: str | None = None
    difficulty: str | None = None


# ── 응답 스키마 ──

class NotebookResponse(BaseModel):
    """노트북 기본 응답."""
    id: str
    user_id: str
    title: str
    description: str | None = None
    default_model: str
    difficulty: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True  # Supabase dict → Pydantic 모델 자동 변환


class DocumentInNotebook(BaseModel):
    """노트북 상세에 포함되는 문서 정보."""
    id: str
    filename: str
    file_type: str
    file_size: int | None = None
    status: str
    page_count: int | None = None
    chunk_count: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class NotebookDetailResponse(NotebookResponse):
    """노트북 상세 응답 (문서 목록 포함)."""
    documents: list[DocumentInNotebook] = []
