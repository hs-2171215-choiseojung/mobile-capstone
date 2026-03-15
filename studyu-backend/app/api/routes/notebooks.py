"""
노트북 CRUD 라우터.

노트북 = 과목/프로젝트 단위로 자료를 그룹핑하는 컨테이너.
NotebookLM의 "노트북"과 같은 개념.

엔드포인트:
    GET    /api/notebooks          → 내 노트북 목록
    POST   /api/notebooks          → 노트북 생성
    GET    /api/notebooks/{id}     → 노트북 상세 (문서 목록 포함)
    PATCH  /api/notebooks/{id}     → 노트북 수정
    DELETE /api/notebooks/{id}     → 노트북 삭제
"""

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
async def get_notebooks(user: dict = Depends(get_current_user)):
    """현재 사용자의 노트북 목록을 반환합니다."""
    result = (
        supabase_admin.table("notebooks")
        .select("*")
        .eq("user_id", user["id"])
        .order("updated_at", desc=True)
        .execute()
    )
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
    # 중복된 이름이 있으면 번호를 붙임
    base_title = body.title
    title = base_title
    counter = 1

    while True:
        # 같은 이름의 노트북이 있는지 확인
        check = (
            supabase_admin.table("notebooks")
            .select("id")
            .eq("user_id", user["id"])
            .eq("title", title)
            .execute()
        )

        if not check.data:
            # 같은 이름이 없으면 이 이름 사용
            break

        # 있으면 번호 증가
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
        })
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="노트북 생성에 실패했습니다.",
        )
    return result.data[0]


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
        .eq("user_id", user["id"])
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="노트북을 찾을 수 없습니다.",
        )
    return result.data


# ── 노트북 수정 ──
@router.patch("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(
    notebook_id: str,
    body: NotebookUpdate,
    user: dict = Depends(get_current_user),
):
    """노트북 정보를 수정합니다."""
    # 변경된 필드만 업데이트 (None이 아닌 것만)
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
