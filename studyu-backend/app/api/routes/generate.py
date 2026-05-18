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
from app.services.rag import generate_content, generate_study_plan, generate_followup_answer, generate_plan_modification, generate_smart_chat

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
    model: Optional[str] = "gpt-4o"
    level: Optional[str] = "intermediate"
    quiz_count: Optional[int] = 5
    topic: Optional[str] = None
    difficulty: Optional[str] = "intermediate"
    quiz_style: Optional[str] = "multiple_choice"  # "multiple_choice" | "ox" | "short_answer"
    language: Optional[str] = "ko"            # ko | en | ja | zh
    tone: Optional[str] = "formal"            # formal | casual | academic
    instructions: Optional[str] = None        # 추가 지시사항
    item_title: Optional[str] = None  # 스튜디오 저장 시 표시 제목
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate")
async def generate(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
):
    """요약 / 퀴즈 / 학습 계획 생성."""
    print(f"[studio] 🚀 {req.type} 생성 시작 | docs={req.doc_ids} | user={user['id'][:8]}")
    if req.type not in ("summary", "quiz", "plan"):
        raise HTTPException(
            status_code=400,
            detail="type은 summary | quiz | plan 중 하나여야 합니다.",
        )

    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_id 또는 doc_ids가 필요합니다.")

    print(f"[DEBUG] 요청된 doc_ids: {doc_ids}")

    try:
        result = generate_content(
            doc_ids=doc_ids,
            gen_type=req.type,
            model=req.model or "gpt-4o",
            level=req.level or "intermediate",
            quiz_count=req.quiz_count or 5,
            topic=req.topic or "",
            difficulty=req.difficulty or "intermediate",
            quiz_style=req.quiz_style or "multiple_choice",
            language=req.language or "ko",
            tone=req.tone or "formal",
            instructions=req.instructions or "",
        )
        print(f"[DEBUG] generate_content 결과 길이: {len(result)}")
        if not result or len(result.strip()) < 50:
            print(f"[WARNING] 응답이 너무 짧음: {result[:100]}")
    except Exception as e:
        print(f"[ERROR] generate_content 실패: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"콘텐츠 생성 실패: {str(e)}")

    if req.type == "quiz":
        try:
            # 마크다운 코드블록 제거 (```json ... ``` 형식)
            cleaned = result.strip()
            if cleaned.startswith("```"):
                # ```json 또는 ``` 로 시작하는 경우
                cleaned = cleaned.split("```")[1]
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:]  # "json" 제거
                cleaned = cleaned.strip()
            parsed = json.loads(cleaned)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"[ERROR] JSON 파싱 실패. 결과: {result[:300]}")
            raise HTTPException(status_code=500, detail=f"퀴즈 JSON 파싱 실패: {str(e)}")
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
                "doc_ids": doc_ids,
            },
            notebook_id=req.notebook_id,
        )
        print(f"[studio] ✅ quiz 생성 완료 | item_id={item_id} | title={parsed.get('title','')}")
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
    print(f"[studio] ✅ {req.type} 생성 완료 | item_id={item_id}")
    return {"result": result, "type": req.type, "item_id": item_id}


class StudyPlanRequest(BaseModel):
    doc_ids: list[str] = []
    studio_item_ids: list[str] = []
    notebook_id: str
    target_weeks: int
    purpose: str  # "concept" | "exam_cram"
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None


@router.post("/generate/study-plan")
async def generate_study_plan_endpoint(
    req: StudyPlanRequest,
    user: dict = Depends(get_current_user),
):
    """학생용 AI 학습계획 생성 — 실제 파일·결과물의 최적 학습 순서 추천."""
    if req.target_weeks < 1 or req.target_weeks > 15:
        raise HTTPException(status_code=400, detail="target_weeks는 1~15 사이여야 합니다.")
    if req.purpose not in ("concept", "exam_cram", "cram_mode"):
        raise HTTPException(status_code=400, detail="purpose는 concept 또는 exam_cram 이어야 합니다.")

    nb = supabase_admin.table("notebooks").select("id, user_id").eq("id", req.notebook_id).limit(1).execute()
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    is_owner = nb.data[0]["user_id"] == user["id"]
    if not is_owner:
        enrolled = supabase_admin.table("notebook_enrollments").select("id").eq("notebook_id", req.notebook_id).eq("student_id", user["id"]).limit(1).execute()
        if not enrolled.data:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    materials: list[dict] = []
    DOC_MAX_CHARS = 2000

    if req.doc_ids:
        try:
            doc_res = supabase_admin.table("documents").select("id, filename").in_("id", req.doc_ids).execute()
            doc_name_map = {d["id"]: d.get("filename", d["id"]) for d in doc_res.data or []}
        except Exception as e:
            print(f"[study_plan] 문서 조회 실패: {e}")
            doc_name_map = {}

        doc_summary_map: dict[str, str] = {}
        try:
            summary_res = (
                supabase_admin.table("studio_items")
                .select("id, content")
                .eq("notebook_id", req.notebook_id)
                .in_("type", ["summary", "report"])
                .order("created_at", desc=True)
                .limit(50)
                .execute()
            )
            for s in summary_res.data or []:
                content = s.get("content") or {}
                summary_text = (content.get("text") or "").strip()
                if not summary_text:
                    continue
                for did in (content.get("doc_ids") or []):
                    if did in req.doc_ids and did not in doc_summary_map:
                        doc_summary_map[did] = summary_text
        except Exception as e:
            print(f"[study_plan] 요약본 조회 실패: {e}")

        docs_needing_chunks = [d for d in req.doc_ids if d not in doc_summary_map]
        doc_chunk_map: dict[str, str] = {}
        if docs_needing_chunks:
            try:
                chunk_res = (
                    supabase_admin.table("document_chunks")
                    .select("document_id, text, chunk_index")
                    .in_("document_id", docs_needing_chunks)
                    .order("chunk_index")
                    .limit(len(docs_needing_chunks) * 8)
                    .execute()
                )
                for chunk in chunk_res.data or []:
                    did = chunk["document_id"]
                    existing = doc_chunk_map.get(did, "")
                    added = (chunk.get("text") or "").strip()
                    if added and len(existing) < DOC_MAX_CHARS:
                        doc_chunk_map[did] = (existing + " " + added).strip()[:DOC_MAX_CHARS]
            except Exception as e:
                print(f"[study_plan] 문서 청크 조회 실패: {e}")

        for doc_id in req.doc_ids:
            used_summary = doc_id in doc_summary_map
            materials.append({
                "id": doc_id,
                "name": doc_name_map.get(doc_id, doc_id),
                "item_type": "document",
                "type": "document",
                "content_preview": doc_summary_map.get(doc_id) or doc_chunk_map.get(doc_id, ""),
                "content_source": "summary" if used_summary else "chunks",
            })

    if req.studio_item_ids:
        try:
            studio_res = (
                supabase_admin.table("studio_items")
                .select("id, type, title, content")
                .in_("id", req.studio_item_ids)
                .not_.in_("type", ["study_plan", "notepad"])
                .execute()
            )
            for item in studio_res.data or []:
                itype = item.get("type", "")
                content = item.get("content") or {}
                full_content = ""

                if itype in ("summary", "report"):
                    full_content = (content.get("text") or "").strip()
                elif itype == "quiz":
                    questions = content.get("questions") or []
                    lines = []
                    for i, q in enumerate(questions, 1):
                        q_text = q.get("question") or q.get("text") or ""
                        if not q_text:
                            continue
                        options = q.get("options") or q.get("choices") or []
                        answer = q.get("answer") or q.get("correct_answer") or ""
                        line = f"Q{i}. {q_text}"
                        if options:
                            line += " [" + " / ".join(str(o) for o in options) + "]"
                        if answer:
                            line += f" → 정답: {answer}"
                        lines.append(line)
                    full_content = "\n".join(lines)
                elif itype == "flashcard":
                    cards = content.get("cards") or []
                    lines = []
                    for c in cards:
                        term = c.get("term") or c.get("front") or ""
                        definition = c.get("definition") or c.get("back") or ""
                        if term:
                            lines.append(f"{term}: {definition}" if definition else term)
                    full_content = "\n".join(lines)
                elif itype in ("notepad", "memo"):
                    full_content = (content.get("text") or content.get("content") or "").strip()
                elif itype == "mindmap":
                    nodes = content.get("nodes") or []
                    labels = [str(n.get("label") or n.get("text") or "") for n in nodes if n]
                    full_content = " → ".join(l for l in labels if l)
                elif itype == "table":
                    rows = content.get("rows") or []
                    full_content = "\n".join(
                        " | ".join(str(cell) for cell in row) for row in rows[:20] if row
                    )

                materials.append({
                    "id": item["id"],
                    "name": item.get("title") or item["id"],
                    "item_type": "studio",
                    "type": itype,
                    "content_preview": full_content,
                })
        except Exception as e:
            print(f"[study_plan] 스튜디오 아이템 조회 실패: {e}")

    if not materials:
        raise HTTPException(status_code=400, detail="학습계획을 생성할 자료가 없습니다.")

    print(f"[study_plan] 생성 시작 | purpose={req.purpose} | materials={len(materials)}")

    try:
        result_str = generate_study_plan(
            materials=materials,
            purpose=req.purpose,
            target_weeks=req.target_weeks,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        print(f"[study_plan] 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=f"학습계획 생성 실패: {str(e)}")

    try:
        cleaned = result_str.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        print(f"[study_plan] JSON 파싱 실패: {result_str[:300]}")
        raise HTTPException(status_code=500, detail="학습계획 JSON 파싱 실패")

    material_name_to_id = {m["name"].strip().lower(): m["id"] for m in materials}
    material_ids = {m["id"] for m in materials}
    material_id_to_type = {m["id"]: m.get("item_type", "document") for m in materials}
    for step in parsed.get("steps") or []:
        raw_id = step.get("item_id", "")
        if raw_id not in material_ids:
            fallback = material_name_to_id.get((step.get("item_name") or "").strip().lower())
            if fallback:
                step["item_id"] = fallback
        corrected_id = step.get("item_id", "")
        if corrected_id in material_id_to_type:
            step["item_type"] = material_id_to_type[corrected_id]

    purpose_label = {"concept": "개념정립", "exam_cram": "시험대비", "cram_mode": "벼락치기"}.get(req.purpose, req.purpose)
    title = req.item_title or parsed.get("title") or f"학습계획 ({purpose_label})"
    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="study_plan",
        title=title,
        subtitle=f"학습계획 · {req.target_weeks}주 · {purpose_label}",
        content={**parsed, "target_weeks": req.target_weeks, "purpose": req.purpose},
        notebook_id=req.notebook_id,
    )

    print(f"[study_plan] 생성 완료 | item_id={item_id} | title={title}")
    return {"result": parsed, "item_id": item_id, "title": title}


class StudyPlanFollowupRequest(BaseModel):
    notebook_id: str
    question: str
    plan: dict
    model: Optional[str] = "gpt-4o"


@router.post("/generate/study-plan/followup")
async def study_plan_followup_endpoint(
    req: StudyPlanFollowupRequest,
    user: dict = Depends(get_current_user),
):
    """학습계획 컨텍스트 기반 후속 질문 답변."""
    nb = supabase_admin.table("notebooks").select("id, user_id").eq("id", req.notebook_id).limit(1).execute()
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    is_owner = nb.data[0]["user_id"] == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", req.notebook_id)
            .eq("student_id", user["id"])
            .limit(1)
            .execute()
        )
        if not enrolled.data:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="질문을 입력해주세요.")

    try:
        answer = generate_followup_answer(
            question=req.question,
            plan=req.plan,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"답변 생성 실패: {str(e)}")

    return {"answer": answer}


class StudyPlanModifyRequest(BaseModel):
    notebook_id: str
    plan: dict
    request: str
    model: Optional[str] = "gpt-4o"


@router.post("/generate/study-plan/modify")
async def study_plan_modify_endpoint(
    req: StudyPlanModifyRequest,
    user: dict = Depends(get_current_user),
):
    """학습계획 수정 요청 처리 — 수정된 계획 JSON 반환."""
    nb = supabase_admin.table("notebooks").select("id, user_id").eq("id", req.notebook_id).limit(1).execute()
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    is_owner = nb.data[0]["user_id"] == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", req.notebook_id)
            .eq("student_id", user["id"])
            .limit(1)
            .execute()
        )
        if not enrolled.data:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    if not req.request.strip():
        raise HTTPException(status_code=400, detail="수정 요청을 입력해주세요.")

    try:
        result_str = generate_plan_modification(
            plan=req.plan,
            request=req.request,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"계획 수정 실패: {str(e)}")

    try:
        cleaned = result_str.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=500, detail="계획 수정 JSON 파싱 실패")

    return {"result": parsed}


class StudyPlanChatRequest(BaseModel):
    notebook_id: str
    message: str
    plan: dict
    model: Optional[str] = "gpt-4o"


@router.post("/generate/study-plan/chat")
async def study_plan_chat_endpoint(
    req: StudyPlanChatRequest,
    user: dict = Depends(get_current_user),
):
    """학생 메시지 의도를 판단해 답변 + 선택적 계획 수정을 한 번에 반환."""
    nb = supabase_admin.table("notebooks").select("id, user_id").eq("id", req.notebook_id).limit(1).execute()
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    is_owner = nb.data[0]["user_id"] == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", req.notebook_id)
            .eq("student_id", user["id"])
            .limit(1)
            .execute()
        )
        if not enrolled.data:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    if not req.message.strip():
        raise HTTPException(status_code=400, detail="메시지를 입력해주세요.")

    try:
        result = generate_smart_chat(
            message=req.message,
            plan=req.plan,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"응답 생성 실패: {str(e)}")

    return {
        "answer": result.get("answer", ""),
        "updated_plan": result.get("updated_plan"),
    }


class AudioGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "deep_analysis"   # deep_analysis | summary | critique | debate
    language: str = "ko"            # ko | en | ja | zh
    length: str = "default"         # short | default
    focus: str = ""
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None  # 스튜디오 저장 시 표시 제목
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/audio")
async def generate_audio(
    req: AudioGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """2인 토크쇼 형식의 오디오 오버뷰 생성 (TTS 포함)."""
    print(f"[studio] 🚀 오디오 생성 시작 | format={req.format} | docs={req.doc_ids} | user={user['id'][:8]}")
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
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 오디오 생성 완료 | item_id={item_id} | title={title}")
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
    model: Optional[str] = "gpt-4o"
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/mindmap")
async def generate_mindmap_route(
    req: MindmapGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 평면 노드 배열 형식의 마인드맵으로 생성."""
    print(f"[studio] 🚀 마인드맵 생성 시작 | docs={req.doc_ids} | user={user['id'][:8]}")
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_mindmap
    try:
        nodes, title = generate_mindmap(
            doc_ids=req.doc_ids,
            language=req.language,
            focus=req.focus,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"마인드맵 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="mindmap",
        title=title,
        subtitle=f"마인드맵 · 소스 {len(req.doc_ids)}개",
        content={"nodes": nodes, "week_id": req.week_id, "doc_ids": req.doc_ids},
        notebook_id=req.notebook_id,
    )
    print(f"[studio] ✅ 마인드맵 생성 완료 | item_id={item_id} | title={title}")
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
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/flashcard")
async def generate_flashcard(
    req: FlashcardGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 플래시카드 세트를 생성."""
    print(f"[studio] 🚀 플래시카드 생성 시작 | count={req.count} | difficulty={req.difficulty} | docs={req.doc_ids} | user={user['id'][:8]}")
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
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 플래시카드 생성 완료 | item_id={item_id} | title={title} | cards={len(cards)}장")
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
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/slides")
async def generate_slides_route(
    req: SlideGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 슬라이드 자료를 생성."""
    print(f"[studio] 🚀 슬라이드 생성 시작 | format={req.format} | docs={req.doc_ids} | user={user['id'][:8]}")
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
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 슬라이드 생성 완료 | item_id={item_id} | title={title} | slides={len(slides)}장")
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
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/report")
async def generate_report_route(
    req: ReportGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 구조화된 보고서를 생성."""
    print(f"[studio] 🚀 보고서 생성 시작 | format={req.format} | docs={req.doc_ids} | user={user['id'][:8]}")
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
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 보고서 생성 완료 | item_id={item_id} | title={title}")
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
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None
    week_id: Optional[int] = None


@router.post("/generate/data")
async def generate_data_table_route(
    req: DataTableGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 구조화된 데이터 표를 생성."""
    print(f"[studio] 🚀 데이터표 생성 시작 | format={req.format} | docs={req.doc_ids} | user={user['id'][:8]}")
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_data_table
    try:
        title, description, columns, rows = generate_data_table(
            doc_ids=req.doc_ids,
            format=req.format,
            language=req.language,
            instructions=req.instructions,
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 데이터표 생성 완료 | item_id={item_id} | title={title} | rows={len(rows)}행")
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
    model: Optional[str] = "gpt-4o"
    item_title: Optional[str] = None
    notebook_id: Optional[str] = None


@router.post("/generate/video")
async def generate_video_route(
    req: VideoGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 Remotion 비디오용 슬라이드+오디오 데이터를 생성."""
    print(f"[studio] 🚀 동영상 생성 시작 | docs={req.doc_ids} | user={user['id'][:8]}")
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_video
    try:
        slides, title = generate_video(
            doc_ids=req.doc_ids,
            language=req.language,
            length=req.length,
            model=req.model or "gpt-4o",
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
    print(f"[studio] ✅ 동영상 생성 완료 | item_id={item_id} | title={title}")
    return {
        "slides": slides,
        "title": title,
        "item_id": item_id,
    }


class InfographicGenerateRequest(BaseModel):
    doc_ids: list[str]
    format: str = "overview"       # overview | process | comparison | statistics | timeline
    language: str = "ko"
    instructions: str = ""
    model: Optional[str] = "gpt-4o"
    notebook_id: Optional[str] = None


@router.post("/generate/infographic")
async def generate_infographic_route(
    req: InfographicGenerateRequest,
    user: dict = Depends(get_current_user),
):
    """문서 내용을 바탕으로 인포그래픽을 생성."""
    print(f"[studio] 🚀 인포그래픽 생성 시작 | format={req.format} | docs={req.doc_ids} | user={user['id'][:8]}")
    if not req.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids가 필요합니다.")

    from app.services.rag import generate_infographic
    try:
        title, description, sections = generate_infographic(
            doc_ids=req.doc_ids,
            format=req.format,
            language=req.language,
            instructions=req.instructions,
            model=req.model or "gpt-4o",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"인포그래픽 생성 실패: {str(e)}")

    item_id = _save_studio_item(
        user_id=user["id"],
        item_type="infographic",
        title=title,
        subtitle=f"인포그래픽 · 소스 {len(req.doc_ids)}개",
        content={"title": title, "description": description, "sections": sections},
        notebook_id=req.notebook_id,
    )
    print(f"[studio] ✅ 인포그래픽 생성 완료 | item_id={item_id} | title={title} | sections={len(sections)}개")
    return {
        "title": title,
        "description": description,
        "sections": sections,
        "item_id": item_id,
    }
