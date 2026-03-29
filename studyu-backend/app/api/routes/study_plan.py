"""
강사 주차별 학습 계획(Instructor Weekly Plan) 라우터.

study_plans 테이블의 instructor_weeks(JSONB) 컬럼을 사용합니다.
노트북당 하나의 행(title='__instructor_weekly_plan__')으로 관리합니다.

엔드포인트:
    GET  /api/notebooks/{notebook_id}/study-plan  → 주차 목록 조회
    PUT  /api/notebooks/{notebook_id}/study-plan  → 주차 목록 저장(upsert)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Any
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin

router = APIRouter()

PLAN_TITLE = "__instructor_weekly_plan__"


class StudyPlanBody(BaseModel):
    plan_data: list[Any]


@router.get("/notebooks/{notebook_id}/study-plan")
async def get_study_plan(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """강사의 주차별 학습 계획을 반환합니다. 없으면 빈 배열 반환."""
    # 노트북 소유권 확인
    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .limit(1)
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    if nb.data[0]["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    result = (
        supabase_admin.table("study_plans")
        .select("instructor_weeks")
        .eq("notebook_id", notebook_id)
        .eq("user_id", user["id"])
        .eq("title", PLAN_TITLE)
        .limit(1)
        .execute()
    )
    weeks = result.data[0]["instructor_weeks"] if result.data else []
    return {"plan_data": weeks if isinstance(weeks, list) else []}


@router.put("/notebooks/{notebook_id}/study-plan", status_code=status.HTTP_200_OK)
async def save_study_plan(
    notebook_id: str,
    body: StudyPlanBody,
    user: dict = Depends(get_current_user),
):
    """강사의 주차별 학습 계획을 저장합니다(없으면 생성, 있으면 업데이트)."""
    # 노트북 소유권 확인
    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .limit(1)
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")
    if nb.data[0]["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    # 기존 행 조회
    existing = (
        supabase_admin.table("study_plans")
        .select("id")
        .eq("notebook_id", notebook_id)
        .eq("user_id", user["id"])
        .eq("title", PLAN_TITLE)
        .limit(1)
        .execute()
    )

    if existing.data:
        # UPDATE
        supabase_admin.table("study_plans").update({
            "instructor_weeks": body.plan_data,
        }).eq("id", existing.data[0]["id"]).execute()
    else:
        # INSERT — title, notebook_id, user_id만 필수 (goal, start_date 등은 nullable)
        supabase_admin.table("study_plans").insert({
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "title": PLAN_TITLE,
            "instructor_weeks": body.plan_data,
        }).execute()

    return {"ok": True}


