"""
인증 미들웨어 / 의존성.

프론트엔드에서 보내는 JWT 토큰을 검증하고,
현재 로그인한 사용자 정보를 추출합니다.

사용법 (라우트에서):
    @router.get("/notebooks")
    async def get_notebooks(user: dict = Depends(get_current_user)):
        print(user["id"])  # 현재 로그인한 사용자 ID
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.supabase import supabase_client

# Bearer 토큰 방식: Authorization: Bearer eyJhbGci...
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    요청 헤더의 JWT 토큰을 검증하고 사용자 정보를 반환.

    프론트엔드에서 이렇게 보내야 합니다:
        headers: { "Authorization": "Bearer eyJhbGci..." }

    토큰은 Supabase Auth 로그인 시 자동으로 발급됩니다.
    """
    token = credentials.credentials

    try:
        # Supabase에 토큰을 보내서 사용자 정보 확인
        user_response = supabase_client.auth.get_user(token)
        user = user_response.user

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="유효하지 않은 인증 토큰입니다.",
            )

        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.user_metadata.get("full_name", ""),
            "avatar_url": user.user_metadata.get("avatar_url", ""),
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"인증 실패: {str(e)}",
        )
