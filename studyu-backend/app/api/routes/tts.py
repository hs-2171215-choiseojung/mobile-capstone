# studyu-backend/app/api/routes/chat.py 또는 별도 tts.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI
import io

router = APIRouter()
client = OpenAI(api_key="YOUR_OPENAI_API_KEY")

@router.post("/api/voice-chat")
async def voice_chat(request: dict):
    question = request.get("question")
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": question}]
    )
    answer = completion.choices[0].message.content

    speech_response = client.audio.speech.create(
        model="tts-1",
        voice="alloy", # alloy, echo, fable, onyx, nova, shimmer 중 선택 가능
        input=answer
    )
    
    audio_stream = io.BytesIO(speech_response.content)
    
    return StreamingResponse(audio_stream, media_type="audio/mpeg")