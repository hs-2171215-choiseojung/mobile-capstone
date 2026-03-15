from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google.cloud import speech
import base64
from app.core.config import settings

router = APIRouter()

class AudioRequest(BaseModel):
    audio_content: str  # 프론트엔드에서 보낸 Base64 음성 데이터

@router.post("/recognize")
async def recognize_speech(request: AudioRequest):
    try:
        client = speech.SpeechClient.from_service_account_json(settings.GOOGLE_APPLICATION_CREDENTIALS)

        # 오디오 데이터 처리
        audio_bytes = base64.b64decode(request.audio_content)
        audio = speech.RecognitionAudio(content=audio_bytes)

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            sample_rate_hertz=48000,
            language_code="ko-KR",  # 한국어 인식 설정
            enable_automatic_punctuation=True, # 자동 구두점 추가
        )

        # Google Cloud STT 호출
        response = client.recognize(config=config, audio=audio)

        # 인식된 텍스트 합치기
        transcript = ""
        for result in response.results:
            transcript += result.alternatives[0].transcript

        return {"text": transcript}

    except Exception as e:
        print(f"STT Error: {e}")
        raise HTTPException(status_code=500, detail="음성 인식 처리 중 오류가 발생했습니다.")