"""
TTS 라우터 — ElevenLabs TTS 합성 및 단어 타임스탬프 제공.

엔드포인트:
  POST /api/tts/synthesize   → { audio_base64, words }
"""

import asyncio
import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.services.tts import synthesize_words, ELEVENLABS_VOICES, DEFAULT_VOICE
from app.services.audio_cache import load_tts_cache, save_tts_cache

router = APIRouter()


# ── 요청/응답 스키마 ─────────────────────────────────────
class SynthesizeRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE


class WordSegment(BaseModel):
    text: str
    start: float
    end: float


class SynthesizeResponse(BaseModel):
    audio_base64: str
    words: list[WordSegment]


# ── 엔드포인트 ───────────────────────────────────────────
@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(
    body: SynthesizeRequest,
    current_user=Depends(get_current_user),
):
    """
    텍스트 → ElevenLabs TTS 합성 (단어 단위 타임스탬프).
    동일 텍스트+음성 조합은 Supabase Storage 캐시에서 반환.
    """
    try:
        if body.voice not in ELEVENLABS_VOICES:
            raise HTTPException(status_code=400, detail=f"지원하지 않는 음성: {body.voice}")

        cached = load_tts_cache(body.text, body.voice)
        if cached:
            return SynthesizeResponse(
                audio_base64=cached["audio_base64"],
                words=cached.get("words", []),
            )

        audio_b64, words = await synthesize_words(body.text, body.voice)

        audio_bytes = base64.b64decode(audio_b64)
        asyncio.get_event_loop().run_in_executor(
            None, save_tts_cache, body.text, body.voice, audio_bytes, words
        )

        return SynthesizeResponse(audio_base64=audio_b64, words=words)
    except Exception as e:
        print(f"[ERROR] TTS 합성 실패: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"음성 생성 실패: {str(e)}")
