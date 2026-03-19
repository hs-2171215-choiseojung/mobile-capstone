"""스튜디오 아이템 관리 라우터.

엔드포인트:
    GET    /api/studio        → 사용자의 스튜디오 아이템 목록 조회
    PATCH  /api/studio/{id}  → 아이템 제목 변경
    DELETE /api/studio/{id}  → 아이템 삭제 (오디오 파일 포함)
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin

router = APIRouter()

AUDIO_BUCKET = "studio-audio"


@router.get("/studio")
async def list_studio_items(user: dict = Depends(get_current_user)):
    """사용자의 모든 스튜디오 아이템을 최신순으로 반환."""
    rows = (
        supabase_admin
        .table("studio_items")
        .select("*")
        .eq("user_id", user["id"])
        .order("created_at", desc=True)
        .execute()
        .data or []
    )
    # 오디오 파일이 있는 항목은 1시간짜리 서명 URL 생성
    for item in rows:
        if item.get("audio_path"):
            try:
                resp = supabase_admin.storage.from_(AUDIO_BUCKET).create_signed_url(
                    item["audio_path"], 3600
                )
                item["audio_url"] = (
                    resp.get("signedURL")
                    or resp.get("signedUrl")
                    or ""
                )
            except Exception:
                item["audio_url"] = ""
    return rows


class RenameRequest(BaseModel):
    title: str


@router.patch("/studio/{item_id}")
async def rename_studio_item(
    item_id: str,
    body: RenameRequest,
    user: dict = Depends(get_current_user),
):
    """아이템 제목 변경."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="제목을 입력해주세요.")

    rows = (
        supabase_admin
        .table("studio_items")
        .select("id")
        .eq("id", item_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    supabase_admin.table("studio_items").update({"title": title}).eq("id", item_id).execute()
    return {"ok": True}


@router.delete("/studio/{item_id}")
async def delete_studio_item(item_id: str, user: dict = Depends(get_current_user)):
    """아이템 삭제 (Storage 오디오 파일도 함께 삭제)."""
    rows = (
        supabase_admin
        .table("studio_items")
        .select("id, audio_path")
        .eq("id", item_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    audio_path = rows[0].get("audio_path")
    if audio_path:
        try:
            supabase_admin.storage.from_(AUDIO_BUCKET).remove([audio_path])
        except Exception:
            pass  # 파일 삭제 실패해도 DB 레코드는 삭제

    supabase_admin.table("studio_items").delete().eq("id", item_id).execute()
    return {"ok": True}


class MemoRequest(BaseModel):
    title: str
    content: str


@router.post("/studio/memo")
async def create_memo(req: MemoRequest, user: dict = Depends(get_current_user)):
    """메모 생성 후 저장된 item_id 반환."""
    item_id = str(uuid.uuid4())
    supabase_admin.table("studio_items").insert({
        "id": item_id,
        "user_id": user["id"],
        "type": "memo",
        "title": req.title or "제목 없음",
        "subtitle": "메모",
        "content": {"text": req.content},
    }).execute()
    return {"item_id": item_id}


@router.patch("/studio/memo/{item_id}")
async def update_memo(item_id: str, req: MemoRequest, user: dict = Depends(get_current_user)):
    """메모 내용 수정."""
    rows = (
        supabase_admin.table("studio_items")
        .select("id")
        .eq("id", item_id)
        .eq("user_id", user["id"])
        .eq("type", "memo")
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")
    supabase_admin.table("studio_items").update({
        "title": req.title or "제목 없음",
        "content": {"text": req.content},
    }).eq("id", item_id).execute()
    return {"ok": True}
