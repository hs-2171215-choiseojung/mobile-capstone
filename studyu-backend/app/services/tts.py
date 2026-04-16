"""
ElevenLabs TTS 서비스.

다른 라우터에서 import해서 사용:
    from app.services.tts import tts_with_timestamps, tts_with_word_timestamps,
                                   ELEVENLABS_VOICES, build_subtitle_segments, serialize_summary
"""

import base64
import httpx
from fastapi import HTTPException

from app.core.config import settings

# ── 음성 목록 ────────────────────────────────────────────────
ELEVENLABS_VOICES: dict[str, str] = {
    "sarah":  "EXAVITQu4vr4xnSDxMaL",  # Sarah  — 차분한 여성
    "rachel": "21m00Tcm4TlvDq8ikWAM",  # Rachel — 명확한 여성
    "josh":   "TxGEqnHWrfWFTfGW9XjX",  # Josh   — 친근한 남성
    "adam":   "pNInz6obpgDQGcFmaJgB",  # Adam   — 전문적인 남성
}
DEFAULT_VOICE = "sarah"


# ── 세그먼트 빌더 ────────────────────────────────────────────

def build_subtitle_segments(alignment: dict) -> list[dict]:
    """ElevenLabs character-level alignment → 문장 단위 자막 세그먼트 리스트."""
    chars  = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends   = alignment.get("character_end_times_seconds", [])
    n = min(len(chars), len(starts), len(ends))
    if n == 0:
        return []

    segments: list[dict] = []
    sent_chars: list[str] = []
    sent_starts: list[float] = []
    sent_ends: list[float] = []

    for i in range(n):
        ch = chars[i]
        sent_chars.append(ch)
        sent_starts.append(starts[i])
        sent_ends.append(ends[i])

        if ch in ".!?\n":
            text = "".join(sent_chars).strip()
            if len(text) > 3:
                segments.append({
                    "text": text,
                    "start": sent_starts[0],
                    "end": sent_ends[-1],
                })
            sent_chars, sent_starts, sent_ends = [], [], []

    if sent_chars:
        text = "".join(sent_chars).strip()
        if text:
            segments.append({
                "text": text,
                "start": sent_starts[0],
                "end": sent_ends[-1],
            })

    return segments


def build_word_segments(alignment: dict) -> list[dict]:
    """ElevenLabs character-level alignment → 단어 단위 세그먼트 리스트.

    공백 기준으로 분리. 한국어/영어 혼용 텍스트 모두 지원.
    """
    chars  = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends   = alignment.get("character_end_times_seconds", [])
    n = min(len(chars), len(starts), len(ends))
    if n == 0:
        return []

    segments: list[dict] = []
    word_chars: list[str] = []
    word_starts: list[float] = []
    word_ends: list[float] = []

    def _flush():
        if not word_chars:
            return
        text = "".join(word_chars)
        # 구두점만으로 이루어진 토큰은 제외
        if text.strip(".,!?;:\"'()-—…"):
            segments.append({
                "text": text,
                "start": word_starts[0],
                "end": word_ends[-1],
            })
        word_chars.clear()
        word_starts.clear()
        word_ends.clear()

    for i in range(n):
        ch = chars[i]
        if ch in " \n\t":
            _flush()
        else:
            word_chars.append(ch)
            word_starts.append(starts[i])
            word_ends.append(ends[i])

    _flush()
    return segments


# ── ElevenLabs API 호출 (내부용) ─────────────────────────────

async def _call_elevenlabs_tts(text: str, voice_key: str) -> tuple[bytes, dict]:
    """ElevenLabs TTS API 단일 호출. (mp3_bytes, alignment_dict) 반환."""
    voice_id = ELEVENLABS_VOICES.get(voice_key, ELEVENLABS_VOICES[DEFAULT_VOICE])

    async with httpx.AsyncClient(timeout=60) as http:
        res = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps",
            headers={
                "xi-api-key": settings.ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.45,
                    "similarity_boost": 0.80,
                    "style": 0.2,
                },
            },
        )

    if res.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"ElevenLabs TTS 실패: {res.text[:200]}",
        )

    data = res.json()
    audio_bytes = base64.b64decode(data.get("audio_base64", ""))
    return audio_bytes, data.get("alignment", {})


# ── 공개 API ────────────────────────────────────────────────

async def tts_with_timestamps(text: str, voice_key: str = DEFAULT_VOICE) -> tuple[bytes, list[dict]]:
    """(mp3_bytes, sentence_segments) 반환. 기존 코드와 호환."""
    audio_bytes, alignment = await _call_elevenlabs_tts(text, voice_key)
    return audio_bytes, build_subtitle_segments(alignment)


async def tts_with_word_timestamps(
    text: str, voice_key: str = DEFAULT_VOICE
) -> tuple[bytes, list[dict], list[dict]]:
    """(mp3_bytes, sentence_segments, word_segments) 반환. 채팅 TTS용."""
    audio_bytes, alignment = await _call_elevenlabs_tts(text, voice_key)
    sentences = build_subtitle_segments(alignment)
    words = build_word_segments(alignment)
    return audio_bytes, sentences, words


def serialize_summary(
    summary_text: str,
    audio_bytes: bytes,
    sentences: list[dict],
    voice: str,
) -> dict:
    """응답 dict 생성 (JSON 직렬화 가능)."""
    return {
        "summary_text": summary_text,
        "audio_base64": base64.b64encode(audio_bytes).decode(),
        "sentences": sentences,
        "voice": voice,
    }
