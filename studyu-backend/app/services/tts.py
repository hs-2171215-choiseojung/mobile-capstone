"""
ElevenLabs TTS 서비스.

다른 라우터에서 import해서 사용:
    from app.services.tts import tts_with_timestamps, ELEVENLABS_VOICES, build_subtitle_segments
"""

import base64
import json
import httpx
from fastapi import HTTPException

from app.core.config import settings

# ── 음성 목록 ────────────────────────────────────────────
ELEVENLABS_VOICES: dict[str, str] = {
    "sarah":  "EXAVITQu4vr4xnSDxMaL",  # Sarah  — 차분한 여성
    "rachel": "21m00Tcm4TlvDq8ikWAM",  # Rachel — 명확한 여성
    "josh":   "TxGEqnHWrfWFTfGW9XjX",  # Josh   — 친근한 남성
    "adam":   "pNInz6obpgDQGcFmaJgB",  # Adam   — 전문적인 남성
}
DEFAULT_VOICE = "sarah"


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
    """ElevenLabs character-level alignment → 단어 단위 세그먼트 리스트."""
    chars  = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends   = alignment.get("character_end_times_seconds", [])
    n = min(len(chars), len(starts), len(ends))
    if n == 0:
        return []

    words: list[dict] = []
    word_chars:  list[str]   = []
    word_starts: list[float] = []
    word_ends:   list[float] = []

    for i in range(n):
        ch = chars[i]
        if ch in (" ", "\n", "\t"):
            if word_chars:
                text = "".join(word_chars).strip()
                if text:
                    words.append({"text": text, "start": word_starts[0], "end": word_ends[-1]})
                word_chars, word_starts, word_ends = [], [], []
        else:
            word_chars.append(ch)
            word_starts.append(starts[i])
            word_ends.append(ends[i])

    if word_chars:
        text = "".join(word_chars).strip()
        if text:
            words.append({"text": text, "start": word_starts[0], "end": word_ends[-1]})

    return words


async def _elevenlabs_post(voice_id: str, text: str, model_id: str, voice_settings: dict) -> dict:
    """ElevenLabs /with-timestamps 공통 HTTP 호출. 응답 JSON 반환."""
    async with httpx.AsyncClient(timeout=60) as http:
        res = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps",
            headers={"xi-api-key": settings.ELEVENLABS_API_KEY, "Content-Type": "application/json"},
            json={"text": text, "model_id": model_id, "voice_settings": voice_settings},
        )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"ElevenLabs TTS 실패: {res.text[:300]}")
    return res.json()


async def synthesize_words(text: str, voice_key: str = DEFAULT_VOICE) -> tuple[str, list[dict]]:
    """
    단어 단위 하이라이팅용 TTS 합성 (turbo 모델, 저지연).

    Returns:
        (audio_base64, word_segments)
    """
    voice_id = ELEVENLABS_VOICES.get(voice_key, ELEVENLABS_VOICES[DEFAULT_VOICE])
    data = await _elevenlabs_post(
        voice_id, text,
        model_id="eleven_turbo_v2_5",
        voice_settings={"stability": 0.45, "similarity_boost": 0.80, "style": 0.0},
    )
    audio_b64 = data.get("audio_base64", "")
    words = build_word_segments(data.get("alignment", {}))
    return audio_b64, words


async def tts_with_timestamps(text: str, voice_key: str = DEFAULT_VOICE) -> tuple[bytes, list[dict]]:
    """
    문장 단위 자막용 TTS 합성 (multilingual 모델).

    Returns:
        (mp3_bytes, subtitle_segments)
    """
    voice_id = ELEVENLABS_VOICES.get(voice_key, ELEVENLABS_VOICES[DEFAULT_VOICE])
    data = await _elevenlabs_post(
        voice_id, text,
        model_id="eleven_multilingual_v2",
        voice_settings={"stability": 0.45, "similarity_boost": 0.80, "style": 0.2},
    )
    audio_bytes = base64.b64decode(data.get("audio_base64", ""))
    segments = build_subtitle_segments(data.get("alignment", {}))
    return audio_bytes, segments


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
