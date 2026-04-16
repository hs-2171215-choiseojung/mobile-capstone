"""
TTS 라우터 — ElevenLabs TTS 합성 및 단어 타임스탬프 제공.

엔드포인트:
  POST /api/tts/synthesize   → { audio_base64, words }
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.services.tts import tts_with_timestamps, ELEVENLABS_VOICES, DEFAULT_VOICE
import base64

router = APIRouter()


# ── 요청/응답 스키마 ─────────────────────────────────────
class SynthesizeRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE   # "sarah" | "rachel" | "josh" | "adam"


class WordSegment(BaseModel):
    text: str
    start: float
    end: float


class SynthesizeResponse(BaseModel):
    audio_base64: str
    words: list[WordSegment]


# ── 유틸: character-level → word-level 변환 ─────────────
def build_word_segments(alignment: dict) -> list[dict]:
    """
    ElevenLabs character-level alignment을 단어 단위 세그먼트로 변환.

    Returns:
        [{ text: str, start: float, end: float }, ...]
    """
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
            # 공백 → 현재까지 모은 글자로 단어 완성
            if word_chars:
                text = "".join(word_chars).strip()
                if text:
                    words.append({
                        "text":  text,
                        "start": word_starts[0],
                        "end":   word_ends[-1],
                    })
                word_chars, word_starts, word_ends = [], [], []
        else:
            word_chars.append(ch)
            word_starts.append(starts[i])
            word_ends.append(ends[i])

    # 마지막 단어 처리
    if word_chars:
        text = "".join(word_chars).strip()
        if text:
            words.append({
                "text":  text,
                "start": word_starts[0],
                "end":   word_ends[-1],
            })

    return words


# ── 엔드포인트 ───────────────────────────────────────────
@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(
    body: SynthesizeRequest,
    current_user=Depends(get_current_user),
):
    """
    텍스트 → ElevenLabs TTS 합성.

    Returns:
        audio_base64: MP3 오디오 (base64)
        words: 단어별 타임스탬프 목록
    """
    if body.voice not in ELEVENLABS_VOICES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 음성: {body.voice}")

    import httpx
    from app.core.config import settings

    voice_id = ELEVENLABS_VOICES[body.voice]

    async with httpx.AsyncClient(timeout=60) as http:
        res = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps",
            headers={
                "xi-api-key": settings.ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": body.text,
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
            detail=f"ElevenLabs TTS 실패: {res.text[:300]}",
        )

    data = res.json()
    audio_b64 = data.get("audio_base64", "")
    words = build_word_segments(data.get("alignment", {}))

    return SynthesizeResponse(audio_base64=audio_b64, words=words)
