"""
Supabase 클라이언트 생성 모듈.

두 가지 클라이언트를 제공합니다:
- supabase_admin: service_role 키 사용. RLS 무시. 백엔드 내부 작업용.
- supabase_client: anon 키 사용. RLS 적용. 사용자 컨텍스트 작업용.

사용법:
    from app.core.supabase import supabase_admin
    result = supabase_admin.table("notebooks").select("*").execute()
"""

from supabase import create_client, Client
from app.core.config import settings


def get_supabase_admin() -> Client:
    """
    관리자용 Supabase 클라이언트.
    service_role 키를 사용하므로 RLS를 무시하고 모든 데이터에 접근 가능.

    사용처:
    - 문서 파싱 후 청크/임베딩 저장
    - 벡터 유사도 검색 (match_chunks)
    - 백그라운드 작업
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY
    )


def get_supabase_client() -> Client:
    """
    일반용 Supabase 클라이언트.
    anon 키를 사용하므로 RLS가 적용됨.

    사용처:
    - 사용자 인증 확인
    - RLS를 통한 데이터 접근 테스트
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY
    )


# 싱글톤처럼 사용 (앱 시작 시 한 번만 생성)
supabase_admin = get_supabase_admin()
supabase_client = get_supabase_client()
