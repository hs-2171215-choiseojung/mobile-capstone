"""
노트북 CRUD 라우터.

노트북 = 과목/프로젝트 단위로 자료를 그룹핑하는 컨테이너.
NotebookLM의 "노트북"과 같은 개념.

엔드포인트:
    GET    /api/notebooks            → 내 노트북 목록
    POST   /api/notebooks            → 노트북 생성
    GET    /api/notebooks/enrolled   → 참여 중인 노트북 목록
    POST   /api/notebooks/join       → 초대 코드로 참여
    GET    /api/notebooks/{id}       → 노트북 상세 (문서 목록 포함)
    PATCH  /api/notebooks/{id}       → 노트북 수정
    DELETE /api/notebooks/{id}       → 노트북 삭제
    POST   /api/notebooks/{id}/invite → 초대 코드 생성
"""

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from app.core.auth import get_current_user
from app.core.supabase import supabase_admin
from app.schemas.notebooks import (
    NotebookCreate,
    NotebookUpdate,
    NotebookResponse,
    NotebookDetailResponse,
)

router = APIRouter()


# ── 노트북 목록 조회 ──
@router.get("/notebooks", response_model=list[NotebookResponse])
async def get_notebooks(
    notebook_type: str | None = None,
    user: dict = Depends(get_current_user),
):
    """현재 사용자의 노트북 목록을 반환합니다. notebook_type으로 필터링 가능."""
    query = (
        supabase_admin.table("notebooks")
        .select("*")
        .eq("user_id", user["id"])
    )
    if notebook_type:
        query = query.eq("notebook_type", notebook_type)
    result = query.order("updated_at", desc=True).execute()
    return result.data


# ── 노트북 생성 ──
@router.post(
    "/notebooks",
    response_model=NotebookResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_notebook(
    body: NotebookCreate,
    user: dict = Depends(get_current_user),
):
    """새 노트북을 생성합니다."""
    base_title = body.title
    title = base_title
    counter = 1

    while True:
        check = (
            supabase_admin.table("notebooks")
            .select("id")
            .eq("user_id", user["id"])
            .eq("title", title)
            .execute()
        )
        if not check.data:
            break
        title = f"{base_title} {counter}"
        counter += 1

    result = (
        supabase_admin.table("notebooks")
        .insert({
            "user_id": user["id"],
            "title": title,
            "description": body.description,
            "default_model": body.default_model,
            "difficulty": body.difficulty,
            "notebook_type": body.notebook_type,
        })
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="노트북 생성에 실패했습니다.",
        )
    return result.data[0]


# ── 참여 중인 노트북 목록 (고정 경로 → /{id} 보다 먼저 등록) ──
@router.get("/notebooks/enrolled", response_model=list[NotebookResponse])
async def get_enrolled_notebooks(
    user: dict = Depends(get_current_user),
):
    """학생이 초대 코드로 참여한 강사 노트북 목록을 반환합니다."""
    result = (
        supabase_admin.table("notebook_enrollments")
        .select("notebook_id, notebooks(*)")
        .eq("student_id", user["id"])
        .execute()
    )
    notebooks = [row["notebooks"] for row in result.data if row.get("notebooks")]
    owner_ids = list({nb.get("user_id") for nb in notebooks if nb.get("user_id")})
    instructor_name_by_id: dict[str, str] = {}

    if owner_ids:
        owner_rows = (
            supabase_admin.table("users")
            .select("id, display_name")
            .in_("id", owner_ids)
            .execute()
        )
        instructor_name_by_id = {
            row["id"]: row.get("display_name") or "\uAC15\uC0AC"
            for row in (owner_rows.data or [])
            if row.get("id")
        }

    return [
        {
            **nb,
            "instructor_name": instructor_name_by_id.get(nb.get("user_id"), "\uAC15\uC0AC"),
        }
        for nb in notebooks
    ]


# ── 초대 코드로 참여 (고정 경로 → /{id} 보다 먼저 등록) ──
@router.post("/notebooks/join", response_model=NotebookResponse)
async def join_notebook(
    body: dict,
    user: dict = Depends(get_current_user),
):
    """학생이 초대 코드로 강사 노트북에 참여합니다."""
    invite_code = (body.get("invite_code") or "").strip().upper()
    if not invite_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="초대 코드를 입력해주세요.")

    result = (
        supabase_admin.table("notebooks")
        .select("*")
        .eq("invite_code", invite_code)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="유효하지 않은 초대 코드입니다.")

    notebook = result.data
    notebook_id = notebook["id"]

    existing = (
        supabase_admin.table("notebook_enrollments")
        .select("id")
        .eq("notebook_id", notebook_id)
        .eq("student_id", user["id"])
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 참여한 노트북입니다.")

    supabase_admin.table("notebook_enrollments").insert({
        "notebook_id": notebook_id,
        "student_id": user["id"],
    }).execute()

    return notebook


# ── 참여 노트북 나가기 ──
@router.delete("/notebooks/{notebook_id}/leave")
async def leave_notebook(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """학생이 참여 중인 노트북에서 나갑니다."""
    result = (
        supabase_admin.table("notebook_enrollments")
        .delete()
        .eq("notebook_id", notebook_id)
        .eq("student_id", user["id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="참여 중인 노트북을 찾을 수 없습니다.")
    return {"message": "노트북에서 나갔습니다."}


# ── 노트북 수강 학생 목록 (고정 경로 → /{id} 보다 먼저 등록) ──
@router.get("/notebooks/{notebook_id}/students")
async def get_notebook_students(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """강사 노트북에 참여 중인 학생 목록을 반환합니다."""
    # 본인 노트북인지 확인
    nb = (
        supabase_admin.table("notebooks")
        .select("id, title")
        .eq("id", notebook_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노트북을 찾을 수 없습니다.")

    result = (
        supabase_admin.table("notebook_enrollments")
        .select("id, created_at, users(id, display_name, email, avatar_url)")
        .eq("notebook_id", notebook_id)
        .order("created_at", desc=False)
        .execute()
    )
    students = []
    for row in result.data:
        u = row.get("users") or {}
        students.append({
            "enrollment_id": row["id"],
            "joined_at": row["created_at"],
            "id": u.get("id"),
            "display_name": u.get("display_name"),
            "email": u.get("email"),
            "avatar_url": u.get("avatar_url"),
        })
    return {"notebook_id": notebook_id, "title": nb.data["title"], "students": students}


# ── 노트북 상세 조회 (문서 목록 포함) ──
@router.get("/notebooks/{notebook_id}", response_model=NotebookDetailResponse)
async def get_notebook(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """노트북 상세 정보와 포함된 문서 목록을 반환합니다."""
    result = (
        supabase_admin.table("notebooks")
        .select("*, documents(*)")
        .eq("id", notebook_id)
        .single()
        .execute()
    )
    notebook = result.data
    if not notebook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="노트북을 찾을 수 없습니다.",
        )

    is_owner = notebook.get("user_id") == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user["id"])
            .execute()
        )
        if not enrolled.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="노트북 접근 권한이 없습니다.",
            )

    return notebook


# ── 노트북 수정 ──
@router.patch("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(
    notebook_id: str,
    body: NotebookUpdate,
    user: dict = Depends(get_current_user),
):
    """노트북 정보를 수정합니다."""
    update_data = body.model_dump(exclude_none=True)

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="수정할 내용이 없습니다.",
        )

    result = (
        supabase_admin.table("notebooks")
        .update(update_data)
        .eq("id", notebook_id)
        .eq("user_id", user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="노트북을 찾을 수 없습니다.",
        )
    return result.data[0]


# ── 초대 코드 생성 ──
@router.post("/notebooks/{notebook_id}/invite")
async def generate_invite_code(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """강사가 노트북의 초대 코드를 생성하거나 기존 코드를 반환합니다."""
    result = (
        supabase_admin.table("notebooks")
        .select("id, invite_code, notebook_type")
        .eq("id", notebook_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노트북을 찾을 수 없습니다.")

    if result.data.get("notebook_type") != "instructor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="강사 노트북에만 초대 코드를 생성할 수 있습니다.")

    existing_code = result.data.get("invite_code")
    if existing_code:
        return {"invite_code": existing_code}

    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        check = supabase_admin.table("notebooks").select("id").eq("invite_code", code).execute()
        if not check.data:
            break

    supabase_admin.table("notebooks").update({"invite_code": code}).eq("id", notebook_id).execute()
    return {"invite_code": code}


# ── 수강 학생 삭제 ──
@router.delete("/notebooks/{notebook_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_student(
    notebook_id: str,
    student_id: str,
    user: dict = Depends(get_current_user),
):
    """강사가 노트북에서 학생을 내보냅니다."""
    # 본인 노트북인지 확인
    nb = (
        supabase_admin.table("notebooks")
        .select("id")
        .eq("id", notebook_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not nb.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노트북을 찾을 수 없습니다.")

    result = (
        supabase_admin.table("notebook_enrollments")
        .delete()
        .eq("notebook_id", notebook_id)
        .eq("student_id", student_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 학생을 찾을 수 없습니다.")


# ── 노트북 삭제 ──
@router.delete("/notebooks/{notebook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notebook(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """
    노트북을 삭제합니다.
    CASCADE 설정에 의해 하위 문서, 청크, 대화, 퀴즈 등도 함께 삭제됩니다.
    """
    result = (
        supabase_admin.table("notebooks")
        .delete()
        .eq("id", notebook_id)
        .eq("user_id", user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="노트북을 찾을 수 없습니다.",
        )
