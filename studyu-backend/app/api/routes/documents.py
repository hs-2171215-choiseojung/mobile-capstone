"""
문서 관리 라우터.

3주차에 본격 구현 예정. 현재는 엔드포인트 틀만 잡아둠.

엔드포인트:
    POST   /api/documents/upload     → 파일 업로드
    GET    /api/documents/{id}       → 문서 상세
    DELETE /api/documents/{id}       → 문서 삭제
"""

from fastapi import APIRouter, Depends, UploadFile, File, Form
from app.core.auth import get_current_user

router = APIRouter()


@router.post("/documents/upload")
async def upload_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """
    학습 자료 업로드. (3주차에 구현 예정)

    흐름:
    1. 파일을 Supabase Storage에 저장
    2. documents 테이블에 메타데이터 저장 (status: 'processing')
    3. 백그라운드에서: PDF 파싱 → 청크 분할 → 임베딩 → 저장
    4. 완료 시 status를 'ready'로 변경
    """
    return {
        "message": "문서 업로드 API - 3주차에 구현 예정",
        "filename": file.filename,
        "notebook_id": notebook_id,
    }


@router.get("/documents/{document_id}")
async def get_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 상세 정보 조회. (3주차에 구현 예정)"""
    return {"message": "문서 상세 API - 3주차에 구현 예정"}


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 삭제. (3주차에 구현 예정)"""
    return {"message": "문서 삭제 API - 3주차에 구현 예정"}
