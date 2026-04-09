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


async def tts_with_timestamps(text: str, voice_key: str = DEFAULT_VOICE) -> tuple[bytes, list[dict]]:
    """
    ElevenLabs TTS + 문자 타임스탬프.

    Args:
        text: 변환할 텍스트
        voice_key: ELEVENLABS_VOICES의 키 ("sarah" | "rachel" | "josh" | "adam")

    Returns:
        (mp3_bytes, subtitle_segments)
    """
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
