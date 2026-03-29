from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

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
    """Return instructor weekly plan. Owner or enrolled student can read."""
    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .limit(1)
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=404, detail="Notebook not found.")

    is_owner = nb.data[0]["user_id"] == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user["id"])
            .limit(1)
            .execute()
        )
        if not enrolled.data:
            raise HTTPException(status_code=403, detail="Access denied.")

    result = (
        supabase_admin.table("study_plans")
        .select("instructor_weeks")
        .eq("notebook_id", notebook_id)
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
    """Save instructor weekly plan. Owner only."""
    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .limit(1)
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    if nb.data[0]["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied.")

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
        supabase_admin.table("study_plans").update({
            "instructor_weeks": body.plan_data,
        }).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase_admin.table("study_plans").insert({
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "title": PLAN_TITLE,
            "instructor_weeks": body.plan_data,
        }).execute()

    return {"ok": True}
