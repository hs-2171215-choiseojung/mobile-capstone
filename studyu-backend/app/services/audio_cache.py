"""
음성 요약 영구 캐시 서비스.

Supabase Storage의 "documents" 버킷 내 _audio_summaries/ 경로에
mp3와 메타데이터 JSON을 저장해서 서버 재시작 후에도 캐시를 유지합니다.

저장 경로 구조:
    _audio_summaries/{document_id}/{voice_key}.mp3
    _audio_summaries/{document_id}/{voice_key}.json
"""

import base64
import json
import io
from app.core.supabase import supabase_admin

_BUCKET = "documents"
_PREFIX = "_audio_summaries"


def _mp3_path(doc_id: str, voice: str) -> str:
    return f"{_PREFIX}/{doc_id}/{voice}.mp3"


def _json_path(doc_id: str, voice: str) -> str:
    return f"{_PREFIX}/{doc_id}/{voice}.json"


def load_cached_summary(doc_id: str, voice: str) -> dict | None:
    """
    Storage에서 캐시된 요약 로드.
    없으면 None 반환.
    """
    try:
        json_bytes = supabase_admin.storage.from_(_BUCKET).download(_json_path(doc_id, voice))
        meta = json.loads(json_bytes.decode("utf-8"))

        mp3_bytes = supabase_admin.storage.from_(_BUCKET).download(_mp3_path(doc_id, voice))
        meta["audio_base64"] = base64.b64encode(mp3_bytes).decode()
        return meta
    except Exception:
        return None


def save_cached_summary(
    doc_id: str,
    voice: str,
    summary_text: str,
    audio_bytes: bytes,
    sentences: list[dict],
) -> None:
    """
    Storage에 요약 결과 저장.
    이미 존재하면 덮어쓰기 (upsert).
    실패해도 예외를 전파하지 않고 로그만 출력.
    """
    try:
        # JSON 메타데이터 (오디오 제외)
        meta = {
            "summary_text": summary_text,
            "sentences": sentences,
            "voice": voice,
        }
        json_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")

        _upsert(_json_path(doc_id, voice), json_bytes, "application/json")
        _upsert(_mp3_path(doc_id, voice),  audio_bytes,  "audio/mpeg")
    except Exception as e:
        print(f"[audio_cache] 저장 실패 (무시): {e}")


def _upsert(path: str, data: bytes, content_type: str) -> None:
    """Storage에 파일 upsert (있으면 덮어쓰기)."""
    try:
        supabase_admin.storage.from_(_BUCKET).upload(
            path,
            data,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception:
        # upload가 실패하면 remove 후 재시도
        try:
            supabase_admin.storage.from_(_BUCKET).remove([path])
        except Exception:
            pass
        supabase_admin.storage.from_(_BUCKET).upload(
            path,
            data,
            {"content-type": content_type},
        )
