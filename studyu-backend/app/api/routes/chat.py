"""
RAG 질의응답 (채팅) 라우터.

4주차에 본격 구현 예정. 현재는 엔드포인트 틀만 잡아둠.

엔드포인트:
    POST /api/chat              → 질문 보내기 (RAG 답변 생성)
    GET  /api/chat/history/{id} → 대화 히스토리 조회
"""

from fastapi import APIRouter, Depends
from app.core.auth import get_current_user

router = APIRouter()


@router.post("/chat")
async def chat(
    user: dict = Depends(get_current_user),
):
    """
    RAG 기반 질의응답. (4주차에 구현 예정)

    흐름:
    1. 사용자 질문 수신
    2. 질문 임베딩 생성
    3. 벡터 유사도 검색 (match_chunks)
    4. 관련 청크 + 질문 → LLM → 답변 생성
    5. 답변 + 출처 정보 반환
    """
    return {"message": "채팅 API - 4주차에 구현 예정"}


@router.get("/chat/history/{conversation_id}")
async def get_chat_history(
    conversation_id: str,
    user: dict = Depends(get_current_user),
):
    """대화 히스토리 조회. (4주차에 구현 예정)"""
    return {"message": "대화 히스토리 API - 4주차에 구현 예정"}
