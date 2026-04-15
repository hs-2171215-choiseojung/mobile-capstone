import base64

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.services.tts import tts_with_word_timestamps, ELEVENLABS_VOICES, DEFAULT_VOICE

router = APIRouter()


# ── 채팅 응답 TTS 합성 ────────────────────────────────────────
class SynthesizeRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE


@router.post("/synthesize")
async def synthesize_text(req: SynthesizeRequest, user=Depends(get_current_user)):
    """
    임의 텍스트를 ElevenLabs TTS로 합성. 채팅 응답 음성 재생에 사용.

    Returns:
        audio_base64: MP3 base64 인코딩
        words: 단어 단위 타임스탬프 세그먼트 (프론트 하이라이팅용)
    """
    voice = req.voice if req.voice in ELEVENLABS_VOICES else DEFAULT_VOICE
    audio_bytes, _, words = await tts_with_word_timestamps(req.text, voice)
    return {
        "audio_base64": base64.b64encode(audio_bytes).decode(),
        "words": words,
    }
