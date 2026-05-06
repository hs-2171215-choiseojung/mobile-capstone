"""
음성 캐시 서비스.

Supabase Storage의 "documents" 버킷에 두 종류의 캐시를 저장합니다.

1. 문서 요약 캐시 (_audio_summaries/)
   _audio_summaries/{document_id}/{voice_key}.mp3
   _audio_summaries/{document_id}/{voice_key}.json

2. TTS 합성 캐시 (_tts_cache/)
   키: SHA256(text + ":" + voice)
   _tts_cache/{hash}.mp3
   _tts_cache/{hash}.json  ← words(단어 타임스탬프) 저장
"""

import base64
import hashlib
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


# ── TTS 합성 캐시 ─────────────────────────────────────────
_TTS_PREFIX = "_tts_cache"


def _tts_hash(text: str, voice: str) -> str:
    return hashlib.sha256(f"{text}:{voice}".encode()).hexdigest()


def load_tts_cache(text: str, voice: str) -> dict | None:
    """
    캐시된 TTS 합성 결과 로드.
    반환: { audio_base64: str, words: list[dict] } 또는 None
    """
    h = _tts_hash(text, voice)
    mp3_path  = f"{_TTS_PREFIX}/{h}.mp3"
    json_path = f"{_TTS_PREFIX}/{h}.json"
    try:
        json_bytes = supabase_admin.storage.from_(_BUCKET).download(json_path)
        meta = json.loads(json_bytes.decode("utf-8"))
        mp3_bytes = supabase_admin.storage.from_(_BUCKET).download(mp3_path)
        meta["audio_base64"] = base64.b64encode(mp3_bytes).decode()
        return meta
    except Exception:
        return None


def save_tts_cache(text: str, voice: str, audio_bytes: bytes, words: list[dict]) -> None:
    """
    TTS 합성 결과를 Storage에 저장. 실패해도 예외를 전파하지 않음.
    """
    h = _tts_hash(text, voice)
    mp3_path  = f"{_TTS_PREFIX}/{h}.mp3"
    json_path = f"{_TTS_PREFIX}/{h}.json"
    try:
        meta = json.dumps({"words": words}, ensure_ascii=False).encode("utf-8")
        _upsert(json_path, meta, "application/json")
        _upsert(mp3_path,  audio_bytes, "audio/mpeg")
    except Exception as e:
        print(f"[tts_cache] 저장 실패 (무시): {e}")


# ── 슬라이드별 오디오 캐시 ─────────────────────────────────
_SLIDE_AUDIO_PREFIX = "_slide_audio"


def load_slide_audio(doc_id: str, slide_num: int, voice: str) -> bytes | None:
    """슬라이드 오디오 캐시 로드. 없으면 None."""
    path = f"{_SLIDE_AUDIO_PREFIX}/{doc_id}/{slide_num}_{voice}.mp3"
    try:
        return supabase_admin.storage.from_(_BUCKET).download(path)
    except Exception:
        return None


def save_slide_audio(doc_id: str, slide_num: int, voice: str, audio_bytes: bytes) -> None:
    """슬라이드 오디오를 Storage에 저장. 실패해도 예외를 전파하지 않음."""
    path = f"{_SLIDE_AUDIO_PREFIX}/{doc_id}/{slide_num}_{voice}.mp3"
    try:
        _upsert(path, audio_bytes, "audio/mpeg")
    except Exception as e:
        print(f"[slide_audio_cache] 저장 실패 (무시): {e}")
