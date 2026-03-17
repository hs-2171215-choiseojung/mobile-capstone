"""
요약 / 퀴즈 / 학습 계획 생성 라우터.

엔드포인트:
    POST /api/generate  → 콘텐츠 생성 (summary | quiz | plan)
"""

import json
import uuid
import base64
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.services.rag import generate_content

router = APIRouter()

AUDIO_BUCKET = "studio-audio"


def _save_studio_item(
    user_id: str,
    item_type: str,
    title: str,
    subtitle: str,
    content: dict,
    audio_bytes: Optional[bytes] = None,
) -> str:
    """Supabase에 스튜디오 아이템 저장. 실패해도 예외를 전파하지 않음."""
    try:
        audio_path = None
        if audio_bytes:
            audio_path = f"{user_id}/{uuid.uuid4()}.mp3"
            supabase_admin.storage.from_(AUDIO_BUCKET).upload(
                audio_path,
                audio_bytes,
                {"content-type": "audio/mpeg"},
            )
        result = supabase_admin.table("studio_items").insert({
            "user_id": user_id,
            "type": item_type,
            "title": title,
            "subtitle": subtitle,
            "content": content,
            "audio_path": audio_path,
        }).execute()
        return result.data[0]["id"] if result.data else ""
    except Exception as e:
        print(f"[studio] save failed: {e}")
        return ""


class GenerateRequest(BaseModel):
    doc_id: Optional[str] = None
    doc_ids: Optional[list[str]] = None
    type: str  # "summary" | "quiz" | "plan"
    model: Optional[str] = "gpt-4o-mini"
    level: Optional[str] = "intermediate"
    quiz_count: Optional[int] = 5
    topic: Optional[str] = None
    difficulty: Optional[str] = "intermediate"
    item_title: Optional[str] = None  # 스튜디오 저장 시 표시 제목


@router.post("/generate")
async def generate(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
):
    """요약 / 퀴즈 / 학습 계획 생성."""
    if req.type not in ("summary", "quiz", "plan"):
        raise HTTPException(
            status_code=400,
            detail="type은 summary | quiz | plan 중 하나여야 합니다.",
        )

    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    result = generate_content(
        doc_ids=doc_ids,
        gen_type=req.type,
        model=req.model or "gpt-4o-mini",
        level=req.level or "intermediate",
        quiz_count=req.quiz_count or 5,
        topic=req.topic or "",
        difficulty=req.difficulty or "intermediate",
    )

    if req.type == "quiz":
        try:
            parsed = json.loads(result)
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(status_code=500, detail="퀴즈 JSON 파싱에 실패했습니다. 다시 시도해주세요.")
        quiz_title = parsed.get("title", "퀴즈")
        item_id = _save_studio_item(
            user_id=user["id"],
            item_type="quiz",
            title=req.item_title or quiz_title,
            subtitle=f"퀴즈 · 소스 {len(doc_ids)}개",
            content={
                "title": quiz_title,
                "questions": parsed.get("questions", []),
                "difficulty": req.difficulty or "intermediate",
            },
        )
        return {"result": parsed, "type": req.type, "item_id": item_id}

    # summary / plan
    item_id = _save_studio_item(
        user_id=user["id"],
        item_type=req.type,
        title=req.item_title or "요약",
        subtitle=f"요약 · 소스 {len(doc_ids)}개",
        content={"text": result},
    )
    return {"result": result, "type": req.type, "item_id": item_id}


class AudioGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "deep_analysis"   # deep_analysis | summary | critique | debate
    language: str = "ko"            # ko | en | ja | zh
    length: str = "default"         # short | default
    focus: str = ""
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None  # 스튜디오 저장 시 표시 제목


@router.post("/generate/audio")
async def generate_audio(
    req: AudioGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """2인 토크쇼 형식의 오디오 오버뷰 생성 (TTS 포함)."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_audio_overview
    try:
        audio_bytes, script, title = generate_audio_overview(
            doc_ids=req.doc_ids,
            fmt=req.format,
            language=req.language,
            length=req.length,
            focus=req.focus,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"오디오 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="audio",
        title=title,
        subtitle=f"오디오 · 소스 {len(req.doc_ids)}개",
        content={"script": script},
        audio_bytes=audio_bytes,
    )
    return {
        "audio_base64": base64.b64encode(audio_bytes).decode(),
        "script": script,
        "title": title,
        "item_id": item_id,
    }


class MindmapGenerateRequest(BaseModel):
    doc_ids: list[str]
    language: str = "ko"       # ko | en | ja | zh
    focus: str = ""
    model: Optional[str] = "gpt-4o-mini"


@router.post("/generate/mindmap")
async def generate_mindmap_route(
    req: MindmapGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 평면 노드 배열 형식의 마인드맵으로 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_mindmap
    try:
        nodes, title = generate_mindmap(
            doc_ids=req.doc_ids,
            language=req.language,
            focus=req.focus,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"마인드맵 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="mindmap",
        title=title,
        subtitle=f"마인드맵 · 소스 {len(req.doc_ids)}개",
        content={"nodes": nodes},
    )
    return {
        "nodes": nodes,
        "title": title,
        "item_id": item_id,
    }
