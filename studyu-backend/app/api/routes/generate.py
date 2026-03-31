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
    notebook_id: Optional[str] = None,
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
        row = {
            "user_id": user_id,
            "type": item_type,
            "title": title,
            "subtitle": subtitle,
            "content": content,
            "audio_path": audio_path,
        }
        if notebook_id:
            row["notebook_id"] = notebook_id
        result = supabase_admin.table("studio_items").insert(row).execute()
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
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


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
            title=quiz_title,
            subtitle=f"퀴즈 · 소스 {len(doc_ids)}개",
            content={
                "title": quiz_title,
                "questions": parsed.get("questions", []),
                "difficulty": req.difficulty or "intermediate",
                "week_id": req.week_id,
            },
            notebook_id=req.notebook_id,
        )
        return {"result": parsed, "type": req.type, "item_id": item_id}

    # summary / plan
    item_id = _save_studio_item(
        user_id=user["id"],
        item_type=req.type,
        title=req.item_title or "요약",
        subtitle=f"요약 · 소스 {len(doc_ids)}개",
        content={"text": result, "week_id": req.week_id},
        notebook_id=req.notebook_id,
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
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


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
        content={"script": script, "week_id": req.week_id},
        audio_bytes=audio_bytes,
        notebook_id=req.notebook_id,
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
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


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
        content={"nodes": nodes, "week_id": req.week_id},
        notebook_id=req.notebook_id,
    )
    return {
        "nodes": nodes,
        "title": title,
        "item_id": item_id,
    }


class FlashcardGenerateRequest(BaseModel):
    doc_ids: list[str]
    count: str = "standard"        # fewer | standard | more
    difficulty: str = "intermediate"  # easy | intermediate | hard
    topic: str = ""
    language: str = "ko"           # ko | en | ja | zh
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/flashcard")
async def generate_flashcard(
    req: FlashcardGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 플래시카드 세트를 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_flashcards
    try:
        cards, title = generate_flashcards(
            doc_ids=req.doc_ids,
            count=req.count,
            difficulty=req.difficulty,
            topic=req.topic,
            language=req.language,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"플래시카드 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="flashcard",
        title=title,
        subtitle=f"플래시카드 · 소스 {len(req.doc_ids)}개",
        content={"cards": cards, "difficulty": req.difficulty, "week_id": req.week_id},
        notebook_id=req.notebook_id,
    )
    return {
        "cards": cards,
        "title": title,
        "item_id": item_id,
    }


class SlideGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "presenter"      # presenter | detailed
    length: str = "default"        # short | default | long
    language: str = "ko"           # ko | en | ja | zh
    prompt: str = ""               # 사용자 커스텀 프롬프트
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/slides")
async def generate_slides_route(
    req: SlideGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 슬라이드 자료를 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_slides
    try:
        slides, title, cover_image_b64 = generate_slides(
            doc_ids=req.doc_ids,
            format=req.format,
            length=req.length,
            language=req.language,
            prompt=req.prompt,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"슬라이드 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="slides",
        title=title,
        subtitle=f"슬라이드 · 소스 {len(req.doc_ids)}개",
        content={"slides": slides, "format": req.format, "cover_image_b64": cover_image_b64, "week_id": req.week_id},
        notebook_id=req.notebook_id,
    )
    return {
        "slides": slides,
        "title": title,
        "cover_image_b64": cover_image_b64,
        "item_id": item_id,
    }


class ReportGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "briefing"       # briefing | study_guide | blog | prd | architecture | tech_explainer | learning_guide | custom
    language: str = "ko"           # ko | en | ja | zh
    length: str = "default"        # short | default | long
    tone: str = "formal"           # formal | casual | academic
    instructions: str = ""         # 사용자 커스텀 지시사항
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/report")
async def generate_report_route(
    req: ReportGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 구조화된 보고서를 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_report
    try:
        sections, title = generate_report(
            doc_ids=req.doc_ids,
            format=req.format,
            language=req.language,
            length=req.length,
            tone=req.tone,
            instructions=req.instructions,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"보고서 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="report",
        title=title,
        subtitle=f"보고서 · 소스 {len(req.doc_ids)}개",
        content={"sections": sections, "format": req.format, "week_id": req.week_id},
        notebook_id=req.notebook_id,
    )
    return {
        "sections": sections,
        "title": title,
        "item_id": item_id,
    }


class DataTableGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "summary_table"   # summary_table | comparison_table | concept_definition | learning_checklist | progress_tracking
    language: str = "ko"            # ko | en | ja | zh
    instructions: str = ""          # 사용자 커스텀 지시사항
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/data")
async def generate_data_table_route(
    req: DataTableGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 구조화된 데이터 표를 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_data_table
    try:
        title, description, columns, rows = generate_data_table(
            doc_ids=req.doc_ids,
            format=req.format,
            language=req.language,
            instructions=req.instructions,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 표 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="data",
        title=title,
        subtitle=f"데이터표 · 소스 {len(req.doc_ids)}개",
        content={"title": title, "description": description, "columns": columns, "rows": rows, "week_id": req.week_id},
        notebook_id=req.notebook_id,
    )
    return {
        "title": title,
        "description": description,
        "columns": columns,
        "rows": rows,
        "item_id": item_id,
    }


class VideoGenerateRequest(BaseModel):
    doc_ids: list[str]
    language: str = "ko"
    length: str = "default"
    model: Optional[str] = "gpt-4o-mini"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None


@router.post("/generate/video")
async def generate_video_route(
    req: VideoGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 Remotion 비디오용 슬라이드+오디오 데이터를 생성."""
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_video
    try:
        slides, title = generate_video(
            doc_ids=req.doc_ids,
            language=req.language,
            length=req.length,
            model=req.model or "gpt-4o-mini",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"동영상 스크립트 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="video",
        title=title,
        subtitle=f"동영상 · 소스 {len(req.doc_ids)}개",
        content={"slides": slides},
        notebook_id=req.notebook_id,
    )
    return {
        "slides": slides,
        "title": title,
        "item_id": item_id,
    }
