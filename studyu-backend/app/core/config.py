"""
환경변수를 관리하는 Settings 클래스.

.env 파일에서 값을 읽어와서 코드 전체에서 사용합니다.
사용법:
    from app.core.config import settings
    print(settings.SUPABASE_URL)
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Supabase ──
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # ── OpenAI ──
    OPENAI_API_KEY: str = ""  # 아직 없으면 빈 문자열로 시작 가능

    # ── 서버 설정 ──
    FRONTEND_URL: str = "http://localhost:3000"

    # ── 앱 정보 ──
    APP_NAME: str = "STUDY:U API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    class Config:
        env_file = ".env"          # .env 파일에서 자동으로 읽음
        env_file_encoding = "utf-8"


@lru_cache()  # 한 번만 로드하고 캐싱 (매번 .env 읽지 않도록)
def get_settings() -> Settings:
    return Settings()


# 다른 파일에서 이렇게 가져다 씁니다:
# from app.core.config import settings
settings = get_settings()
