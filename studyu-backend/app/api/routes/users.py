"""
사용자 계정 관리 라우터.

엔드포인트:
    DELETE /api/users/me   → 본인 계정 삭제
                              + Supabase Storage 정리 (업로드 원본 + 슬라이드 자산 + 오디오 캐시)
                              + 강사가 수강생 있는 노트북을 보유 중이면 차단
"""

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user
from app.core.supabase import supabase_admin

router = APIRouter()

STORAGE_BUCKET = "documents"
DOC_PREFIXES = ["slide-assets", "_audio_summaries", "_slide_audio"]


def _list_doc_storage_paths(doc_ids: list[str], main_paths: list[str]) -> list[str]:
    """문서 한 묶음에 해당하는 Storage 파일 경로 전부 수집."""
    paths: list[str] = []

    for path in main_paths:
        path = (path or "").strip()
        if path and not path.startswith(("http://", "https://")):
            paths.append(path)

    for doc_id in doc_ids:
        for prefix in DOC_PREFIXES:
            folder = f"{prefix}/{doc_id}"
            try:
                files = supabase_admin.storage.from_(STORAGE_BUCKET).list(folder)
            except Exception as e:
                print(f"[users] storage list 실패 {folder}: {e}")
                continue
            for f in files or []:
                name = f.get("name") if isinstance(f, dict) else None
                if name:
                    paths.append(f"{folder}/{name}")

    return paths


def _count_enrolled_students_for_instructor(user_id: str) -> tuple[int, int]:
    """강사가 보유한 노트북 중 수강생이 한 명이라도 있는 것의 수강생 총합.

    Returns:
        (enrolled_student_count, notebook_with_students_count)
    """
    try:
        notebooks_result = (
            supabase_admin.table("notebooks")
            .select("id")
            .eq("user_id", user_id)
            .eq("notebook_type", "instructor")
            .execute()
        )
    except Exception as e:
        print(f"[users] 강사 노트북 조회 실패: {e}")
        return 0, 0

    notebook_ids = [n["id"] for n in (notebooks_result.data or []) if n.get("id")]
    if not notebook_ids:
        return 0, 0

    try:
        enrollments_result = (
            supabase_admin.table("notebook_enrollments")
            .select("notebook_id")
            .in_("notebook_id", notebook_ids)
            .execute()
        )
    except Exception as e:
        print(f"[users] 수강 등록 조회 실패: {e}")
        return 0, 0

    rows = enrollments_result.data or []
    enrolled_count = len(rows)
    notebooks_with_students = len({row["notebook_id"] for row in rows if row.get("notebook_id")})
    return enrolled_count, notebooks_with_students


@router.delete("/users/me")
async def delete_own_account(user: dict = Depends(get_current_user)):
    """본인 계정 + 업로드 자산 + DB 행을 모두 삭제.

    절차:
      1. 강사이면 수강생 있는 노트북 보유 여부 확인 → 있으면 409로 차단
      2. 보유 문서의 Storage 파일 경로 모두 수집 후 일괄 삭제
      3. public.users 행 삭제 (cascade로 notebooks/documents/enrollments 정리)
      4. auth.users 삭제 (Supabase Admin API)
    """
    user_id = user["id"]
    role = user.get("role") or "student"

    # 1. 강사 차단 정책
    if role == "instructor":
        enrolled, notebooks_with_students = _count_enrolled_students_for_instructor(user_id)
        if enrolled > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"수강생이 있는 노트북 {notebooks_with_students}개에 총 {enrolled}명이 등록되어 있어 "
                    f"계정을 삭제할 수 없습니다. 노트북을 먼저 삭제하거나 수강생을 정리한 뒤 다시 시도해주세요."
                ),
            )

    # 2. Storage 정리 — public.users 삭제 전에 모아야 doc_id를 알 수 있음
    try:
        docs_result = (
            supabase_admin.table("documents")
            .select("id, storage_path")
            .eq("user_id", user_id)
            .execute()
        )
        owned_docs = docs_result.data or []
    except Exception as e:
        print(f"[users] documents 조회 실패: {e}")
        owned_docs = []

    if owned_docs:
        doc_ids = [d["id"] for d in owned_docs if d.get("id")]
        main_paths = [d.get("storage_path", "") for d in owned_docs]
        all_paths = _list_doc_storage_paths(doc_ids, main_paths)

        # Supabase remove()는 리스트로 일괄 삭제. 너무 길면 분할.
        BATCH = 100
        for i in range(0, len(all_paths), BATCH):
            batch = all_paths[i:i + BATCH]
            try:
                supabase_admin.storage.from_(STORAGE_BUCKET).remove(batch)
            except Exception as e:
                print(f"[users] storage 일괄 삭제 실패 ({len(batch)}개): {e}")

    # 3. public.users 삭제 (cascade)
    try:
        supabase_admin.table("users").delete().eq("id", user_id).execute()
    except Exception as e:
        print(f"[users] public.users 삭제 실패 (계속 진행): {e}")

    # 4. auth.users 삭제
    try:
        supabase_admin.auth.admin.delete_user(user_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"계정 삭제에 실패했습니다: {str(e)}",
        )

    return {"ok": True}
