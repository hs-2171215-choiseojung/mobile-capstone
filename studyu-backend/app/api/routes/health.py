"""
헬스 체크 라우터.

서버가 살아있는지 확인하는 용도.
배포 후 모니터링이나 프론트에서 연결 테스트할 때 사용.

GET /api/health → {"status": "ok", "app": "STUDY:U API", "version": "0.1.0"}
"""

from fastapi import APIRouter
from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """서버 상태 확인."""
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
