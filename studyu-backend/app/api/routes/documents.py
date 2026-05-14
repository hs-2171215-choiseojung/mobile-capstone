"""
문서 관리 라우터.
엔드포인트:
    POST   /api/documents/upload       → Supabase Storage 저장 + DB 등록 + RAG 청킹
    POST   /api/documents/ingest_url   → URL에서 텍스트 추출 + DB 등록 + RAG 청킹
    PATCH  /api/documents/{id}         → 파일명 변경
    DELETE /api/documents/{id}         → Storage + DB 삭제 (CASCADE로 chunks 자동 삭제)

이슈 1 (file_type enum):
    Supabase DB의 file_type 컬럼이 enum인 경우 "url" 값이 거부될 수 있습니다.
    URL 문서는 storage_path에 URL 전체를 저장하고, file_type은 기본값("pdf")을 사용합니다.
    삭제 시에는 storage_path가 http로 시작하면 Storage 삭제를 건너뜁니다.

    근본 해결 (Supabase SQL Editor에서 실행):
        ALTER TABLE documents ALTER COLUMN file_type TYPE TEXT;
"""

import base64
import io
import re
import uuid
from typing import Any, Optional
from urllib.parse import urlparse, quote as url_quote

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from openai import OpenAI
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.supabase import supabase_admin
from app.services.tts import tts_with_timestamps, ELEVENLABS_VOICES, DEFAULT_VOICE, serialize_summary
from app.services.audio_cache import load_cached_summary, save_cached_summary, load_slide_audio, save_slide_audio
from app.services.rag import (
    ingest_document,
    ingest_url,
    prepare_media_for_browser_playback,
    SUPPORTED_EXTENSIONS,
    VIDEO_AUDIO_EXTENSIONS,
    _extract_youtube_video_id,
    _strip_media_metadata,
    _build_media_timeline_from_chunks_v2,
    _parse_media_summary,
    _inject_media_summary,
    align_media_summary_to_timeline,
    chat_with_docs,
    _call_llm,
    _call_llm_vision,
    _DEFAULT_MODEL,
)

router = APIRouter()

STORAGE_BUCKET = "documents"
SLIDE_ASSETS_PREFIX = "slide-assets"

_MEDIA_SUMMARY_BLOCK_RE = re.compile(r"\[MEDIA_SUMMARY\].*?\[/MEDIA_SUMMARY\]\s*", re.DOTALL)


def _markdown_summary_to_media_payload(answer: str) -> dict[str, Any]:
    cleaned = (answer or "").strip()
    if not cleaned:
        return {"title": "전체 내용 요약", "overview": "", "sections": []}

    cleaned = re.sub(r"\[SUGGESTED_QUESTIONS\].*?\[/SUGGESTED_QUESTIONS\]", "", cleaned, flags=re.DOTALL).strip()
    lines = cleaned.splitlines()

    title = "전체 내용 요약"
    overview_lines: list[str] = []
    sections: list[dict[str, Any]] = []
    current_section: dict[str, Any] | None = None
    seen_section = False

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if current_section is not None:
                current_section.setdefault("_lines", []).append("")
            elif not seen_section:
                overview_lines.append("")
            continue

        h1_match = re.match(r"^#\s+(.+)$", line)
        if h1_match and title == "전체 내용 요약":
            title = h1_match.group(1).strip()
            continue

        h2_match = re.match(r"^##\s+(.+)$", line)
        if h2_match:
            seen_section = True
            section_title = h2_match.group(1).strip()
            if section_title.lower() in {"개요", "overview"}:
                current_section = None
                continue
            current_section = {"title": section_title, "_lines": []}
            sections.append(current_section)
            continue

        evidence_match = re.match(r"^>\s*근거\s*:\s*(.+)$", line)
        if current_section is not None and evidence_match:
            current_section["anchor_text"] = evidence_match.group(1).strip()
            continue

        if current_section is not None and raw_line.lstrip().startswith(">"):
            current_section.setdefault("anchor_text", raw_line.lstrip()[1:].strip().strip('"'))
            continue

        if current_section is not None:
            current_section.setdefault("_lines", []).append(raw_line.rstrip())
        else:
            overview_lines.append(raw_line.rstrip())

    normalized_sections: list[dict[str, Any]] = []
    for section in sections:
        summary_text = "\n".join(section.get("_lines", [])).strip()
        if not summary_text:
            continue
        normalized_sections.append({
            "title": str(section.get("title", "")).strip() or "요약 섹션",
            "summary": summary_text,
            "anchor_text": str(section.get("anchor_text", "")).strip(),
        })

    return {
        "title": title or "전체 내용 요약",
        "overview": "\n".join(overview_lines).strip(),
        "sections": normalized_sections,
    }


def _generate_media_summary_via_chat(document_id: str) -> dict[str, Any]:
    answer, _, _, _ = chat_with_docs(
        doc_ids=[document_id],
        question=(
            "이 내용을 요약해줘.\n"
            "Markdown 형식으로 작성하고, 제목(H1), 개요(H2: 개요), 주제별 섹션(H2)을 포함한 보고서처럼 정리해줘.\n"
            "각 주제별 섹션은 반드시 아래 형식을 따라줘:\n"
            "## 섹션 제목\n"
            "> 근거: 전사 원문에서 그대로 가져온 대표 문장 1개\n"
            "그 아래에 자연스러운 본문 2~5문장\n"
            "근거 문장은 전사 텍스트를 요약하거나 바꾸지 말고 최대한 그대로 써줘.\n"
            "각 섹션의 근거 문장은 서로 다른 구간을 대표하게 골라줘.\n"
            "시간 표시는 쓰지 말아줘.\n"
            "추천 질문은 넣지 말아줘."
        ),
        model=_DEFAULT_MODEL,
        level="intermediate",
        chat_history=[],
    )
    return _markdown_summary_to_media_payload(answer)


def _clear_media_summary_from_content(content: str) -> str:
    return _MEDIA_SUMMARY_BLOCK_RE.sub("", content or "").strip()


def _generate_and_upload_slides(file_bytes: bytes, doc_id: str) -> tuple[int, dict]:
    """PPT/PPTX → WebP 슬라이드 이미지 생성 + 영상 추출 + Vision AI 분석.

    Returns:
        (total_slides, vision_descriptions)
        vision_descriptions: {slide_num(int): description_str}
        실패 시 (0, {})
    """
    import subprocess, tempfile, os, base64
    import fitz  # PyMuPDF
    from PIL import Image
    import io as _io
    from pptx import Presentation
    from openai import OpenAI

    prefix = f"{SLIDE_ASSETS_PREFIX}/{doc_id}"
    vision_descriptions: dict = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        ppt_path = os.path.join(tmpdir, "input.pptx")
        with open(ppt_path, "wb") as f:
            f.write(file_bytes)

        # 1) PPTX에서 영상 파일 직접 추출 + Whisper 트랜스크립션
        VIDEO_EXTS = {"mp4", "mov", "avi", "wmv", "webm", "mkv"}
        VIDEO_MIME = {"mp4": "video/mp4", "mov": "video/quicktime", "avi": "video/x-msvideo",
                      "wmv": "video/x-ms-wmv", "webm": "video/webm", "mkv": "video/x-matroska"}
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        # 중복 업로드 방지용 (같은 media_part가 여러 slide에 연결될 수 있음)
        uploaded_parts: set = set()
        try:
            prs = Presentation(ppt_path)
            for slide_idx, slide in enumerate(prs.slides, start=1):
                for rel in slide.part.rels.values():
                    reltype = rel.reltype.lower()
                    if "video" in reltype or ("media" in reltype and "audio" not in reltype):
                        try:
                            media_part = rel.target_part
                            part_name = str(media_part.partname)
                            ext = part_name.rsplit(".", 1)[-1].lower()
                            if ext not in VIDEO_EXTS:
                                continue
                            if part_name in uploaded_parts:
                                continue
                            uploaded_parts.add(part_name)

                            video_bytes = media_part.blob
                            mime = VIDEO_MIME.get(ext, "video/mp4")
                            supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                                f"{prefix}/video_{slide_idx}.{ext}",
                                video_bytes,
                                {"content-type": mime, "upsert": "true"},
                            )
                            print(f"[slides] 슬라이드 {slide_idx} 영상 업로드: video_{slide_idx}.{ext}")

                            # Whisper로 영상 내 음성 트랜스크립션
                            try:
                                import tempfile as _tf
                                with _tf.NamedTemporaryFile(suffix=f".{ext}", delete=False) as vtmp:
                                    vtmp.write(video_bytes)
                                    vtmp_path = vtmp.name
                                with open(vtmp_path, "rb") as vf:
                                    transcript_resp = client.audio.transcriptions.create(
                                        model="whisper-1",
                                        file=vf,
                                        prompt="Transcribe the audio exactly as spoken. Keep Korean in Korean and English in English.",
                                        response_format="text",
                                    )
                                transcript_text = (transcript_resp or "").strip()
                                import os as _os; _os.unlink(vtmp_path)
                                if transcript_text:
                                    vision_descriptions[slide_idx] = (
                                        vision_descriptions.get(slide_idx, "") +
                                        f"\n[동영상 음성 내용] {transcript_text}"
                                    )
                                    print(f"[slides] 슬라이드 {slide_idx} 영상 트랜스크립션 완료 ({len(transcript_text)}자)")
                                else:
                                    vision_descriptions[slide_idx] = (
                                        vision_descriptions.get(slide_idx, "") +
                                        "\n[동영상이 포함되어 있으나 음성 내용이 없습니다]"
                                    )
                            except Exception as te:
                                print(f"[slides] Whisper 트랜스크립션 실패 (슬라이드 {slide_idx}): {te}")
                                vision_descriptions[slide_idx] = (
                                    vision_descriptions.get(slide_idx, "") +
                                    "\n[동영상이 포함되어 있습니다]"
                                )
                        except Exception as ve:
                            print(f"[slides] 영상 추출 실패 (슬라이드 {slide_idx}): {ve}")
        except Exception as e:
            print(f"[slides] PPTX 영상 추출 오류: {e}")

        # 2) LibreOffice로 PDF 변환
        import sys
        if sys.platform == "win32":
            soffice_path = r"C:\Program Files\LibreOffice\program\soffice.exe"
        else:
            soffice_path = "soffice"
        try:
            result = subprocess.run(
                [soffice_path, "--headless", "--convert-to", "pdf", "--outdir", tmpdir, ppt_path],
                capture_output=True, timeout=120
            )
            if result.returncode != 0:
                print(f"[slides] soffice 변환 실패: {result.stderr.decode()}")
                return 0, {}
        except Exception as e:
            print(f"[slides] soffice 실행 오류: {e}")
            return 0, {}

        pdf_path = os.path.join(tmpdir, "input.pdf")
        if not os.path.exists(pdf_path):
            print("[slides] PDF 파일이 생성되지 않았습니다.")
            return 0, {}

        # 3) PDF → WebP 슬라이드 이미지 (PyMuPDF → Pillow) + Vision AI 분석
        try:
            doc = fitz.open(pdf_path)
            total = len(doc)

            for i, page in enumerate(doc, start=1):
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                png_bytes = pix.tobytes("png")
                img = Image.open(_io.BytesIO(png_bytes))
                buf = _io.BytesIO()
                img.save(buf, format="WEBP", quality=85)
                webp_bytes = buf.getvalue()

                # WebP 업로드
                supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                    f"{prefix}/{i}.webp",
                    webp_bytes,
                    {"content-type": "image/webp", "upsert": "true"},
                )

                # Vision AI로 슬라이드 시각 요소 분석
                try:
                    b64 = base64.b64encode(webp_bytes).decode()
                    desc = client.chat.completions.create(
                        model="gpt-4o",
                        messages=[
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": f"data:image/webp;base64,{b64}"},
                                    },
                                    {
                                        "type": "text",
                                        "text": (
                                            "이 PPT 슬라이드에서 텍스트 외의 시각적 요소를 분석해주세요.\n"
                                            "- 이미지/사진: 무엇을 나타내는지, 어떤 장면인지\n"
                                            "- 차트/그래프: 종류, 데이터 값, 추세, 축 레이블\n"
                                            "- 다이어그램/흐름도: 구조, 관계, 흐름\n"
                                            "- 표: 항목과 값\n"
                                            "- 코드/스크린샷: 내용 요약\n"
                                            "시각적 요소가 없고 텍스트만 있으면 정확히 '없음'이라고만 답하세요.\n"
                                            "한국어로 상세하게 설명하세요."
                                        ),
                                    },
                                ],
                            }
                        ],
                        max_tokens=800,
                    ).choices[0].message.content.strip()
                    if desc and desc != "없음":
                        existing = vision_descriptions.get(i, "")
                        vision_descriptions[i] = (existing + f"\n[시각 자료] {desc}").strip()
                        print(f"[slides] 슬라이드 {i} Vision 분석 완료")
                except Exception as ve:
                    print(f"[slides] Vision AI 실패 (슬라이드 {i}): {ve}")

            doc.close()
            print(f"[slides] 슬라이드 {total}장 처리 완료: {prefix}")
            return total, vision_descriptions

        except Exception as e:
            print(f"[slides] 이미지 생성/업로드 오류: {e}")
            import traceback; traceback.print_exc()
            return 0, {}

def _analyze_pdf_images(file_bytes: bytes) -> dict:
    """PDF 각 페이지를 렌더링 → 이미지가 있는 페이지를 GPT-4o Vision으로 분석.

    - 이미지 내 텍스트(코드, 레이블 등)도 읽어서 포함
    - 페이지의 텍스트 컨텍스트와 함께 전달해 문서 흐름과 연결

    Returns:
        {page_num(int): description_str}
    """
    import base64
    import io as _io
    import fitz  # PyMuPDF
    import pdfplumber
    from PIL import Image
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    vision_descriptions: dict = {}

    try:
        # pdfplumber로 페이지별 텍스트 미리 추출 (Vision 맥락 제공용)
        page_texts: dict[int, str] = {}
        with pdfplumber.open(_io.BytesIO(file_bytes)) as plumb_pdf:
            for page_idx, page in enumerate(plumb_pdf.pages, start=1):
                raw = (page.extract_text() or "").strip()
                if raw:
                    page_texts[page_idx] = raw[:2000]  # 너무 길면 앞부분만

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(doc)

        for page_idx, page in enumerate(doc, start=1):
            image_list = page.get_images(full=False)
            if not image_list:
                continue  # 이미지 없는 페이지 스킵

            # 페이지 PNG 렌더링 → WebP 변환
            mat = fitz.Matrix(1.5, 1.5)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.open(_io.BytesIO(pix.tobytes("png")))
            buf = _io.BytesIO()
            img.save(buf, format="WEBP", quality=85)
            webp_bytes = buf.getvalue()

            # 앞뒤 페이지 텍스트로 문서 흐름 컨텍스트 구성
            context_parts: list[str] = []
            for ctx_idx in [page_idx - 1, page_idx, page_idx + 1]:
                if ctx_idx in page_texts:
                    label = f"[페이지 {ctx_idx} 텍스트]"
                    context_parts.append(f"{label}\n{page_texts[ctx_idx]}")
            context_text = "\n\n".join(context_parts)

            try:
                b64 = base64.b64encode(webp_bytes).decode()
                prompt = (
                    f"이 PDF는 총 {total_pages}페이지 문서의 {page_idx}페이지입니다.\n\n"
                    f"【주변 페이지 텍스트 (문서 흐름 파악용)】\n{context_text}\n\n"
                    "위 문서 흐름을 참고하여 이 페이지에 포함된 이미지(사진, 차트, 다이어그램, 표, 코드 스크린샷 등)를 분석하세요.\n\n"
                    "분석 항목:\n"
                    "- 이미지/사진: 무엇을 나타내는지, 문서 맥락에서 어떤 의미인지\n"
                    "- 이미지 내 텍스트·코드: 이미지 안에 적힌 글자, 코드, 레이블을 정확히 읽어서 그대로 인용하고 의미 설명\n"
                    "- 차트/그래프: 종류, 데이터 값, 추세, 축 레이블, 문서 맥락에서의 해석\n"
                    "- 다이어그램/흐름도: 구조, 관계, 흐름, 문서에서 이 다이어그램이 설명하는 개념\n"
                    "- 표: 항목과 값\n"
                    "설명은 문서 전체 흐름과 연결지어 학생이 이해할 수 있게 한국어로 작성하세요."
                )
                desc = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/webp;base64,{b64}"},
                                },
                                {
                                    "type": "text",
                                    "text": prompt,
                                },
                            ],
                        }
                    ],
                    max_tokens=1000,
                ).choices[0].message.content.strip()
                if desc:
                    vision_descriptions[page_idx] = desc
                    print(f"[pdf_vision] 페이지 {page_idx} Vision 분석 완료")
            except Exception as ve:
                print(f"[pdf_vision] Vision AI 실패 (페이지 {page_idx}): {ve}")

        doc.close()
        print(f"[pdf_vision] 총 {len(vision_descriptions)}개 페이지 Vision 분석 완료")
    except Exception as e:
        print(f"[pdf_vision] PDF Vision 분석 오류: {e}")

    return vision_descriptions


def _generate_and_upload_hwpx_pages(file_bytes: bytes, doc_id: str) -> tuple[int, bytes | None]:
    """HWPX → pyhwpx(한/글 COM) → PDF → WebP 페이지 이미지 생성 + Supabase 업로드.

    Returns:
        (total_pages, pdf_bytes) — 성공 시 (페이지 수, PDF bytes), 실패 시 (0, None)
    """
    import tempfile, os
    import fitz  # PyMuPDF
    from PIL import Image
    import io as _io

    prefix = f"{SLIDE_ASSETS_PREFIX}/{doc_id}"

    try:
        import pyhwpx
    except ImportError:
        print("[hwpx_pages] pyhwpx 미설치")
        return 0, None

    with tempfile.TemporaryDirectory() as tmpdir:
        hwpx_path = os.path.join(tmpdir, "input.hwpx")
        pdf_path = os.path.join(tmpdir, "output.pdf")
        with open(hwpx_path, "wb") as f:
            f.write(file_bytes)

        try:
            import pythoncom
            pythoncom.CoInitialize()
            hwp = pyhwpx.Hwp(visible=False)
            hwp.open(hwpx_path)
            hwp.save_as(pdf_path, "PDF")
            hwp.quit()
        except Exception as e:
            print(f"[hwpx_pages] pyhwpx PDF 변환 실패: {e}")
            import traceback; traceback.print_exc()
            return 0, None
        finally:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except Exception:
                pass

        if not os.path.exists(pdf_path):
            print("[hwpx_pages] PDF 생성 안 됨")
            return 0, None

        try:
            with open(pdf_path, "rb") as pf:
                pdf_bytes = pf.read()
            doc = fitz.open(pdf_path)
            total = len(doc)
            for i, page in enumerate(doc, start=1):
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                img = Image.open(_io.BytesIO(pix.tobytes("png"))).convert("RGB")
                buf = _io.BytesIO()
                img.save(buf, format="WEBP", quality=85)
                webp_bytes = buf.getvalue()
                supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                    f"{prefix}/{i}.webp",
                    webp_bytes,
                    {"content-type": "image/webp", "upsert": "true"},
                )
            doc.close()
            print(f"[hwpx_pages] 페이지 {total}장 처리 완료: {prefix}")
            return total, pdf_bytes
        except Exception as e:
            print(f"[hwpx_pages] 이미지 업로드 오류: {e}")
            import traceback; traceback.print_exc()
            return 0, None


def _generate_and_upload_docx_pages(file_bytes: bytes, doc_id: str, ext: str = "docx") -> int:
    """DOCX → LibreOffice PDF → WebP 페이지 이미지 생성 + Supabase 업로드.

    Returns:
        total_pages (int) — 성공 시 페이지 수, 실패 시 0
    """
    import subprocess, tempfile, os
    import fitz  # PyMuPDF
    from PIL import Image
    import io as _io
    import sys

    prefix = f"{SLIDE_ASSETS_PREFIX}/{doc_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, f"input.{ext}")
        with open(input_path, "wb") as f:
            f.write(file_bytes)

        # 1) LibreOffice로 DOCX → PDF 변환
        if sys.platform == "win32":
            soffice_path = r"C:\Program Files\LibreOffice\program\soffice.exe"
        else:
            soffice_path = "soffice"
        try:
            result = subprocess.run(
                [soffice_path, "--headless", "--convert-to", "pdf", "--outdir", tmpdir, input_path],
                capture_output=True, timeout=120
            )
            if result.returncode != 0:
                print(f"[docx_pages] soffice 변환 실패: {result.stderr.decode()}")
                return 0
        except Exception as e:
            print(f"[docx_pages] soffice 실행 오류: {e}")
            return 0

        pdf_path = os.path.join(tmpdir, "input.pdf")
        if not os.path.exists(pdf_path):
            print("[docx_pages] PDF 파일이 생성되지 않았습니다.")
            return 0

        # 2) PDF → WebP 페이지 이미지 (PyMuPDF → Pillow)
        try:
            doc = fitz.open(pdf_path)
            total = len(doc)
            for i, page in enumerate(doc, start=1):
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                img = Image.open(_io.BytesIO(pix.tobytes("png")))
                buf = _io.BytesIO()
                img.save(buf, format="WEBP", quality=85)
                webp_bytes = buf.getvalue()
                supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                    f"{prefix}/{i}.webp",
                    webp_bytes,
                    {"content-type": "image/webp", "upsert": "true"},
                )
            doc.close()
            print(f"[docx_pages] 페이지 {total}장 처리 완료: {prefix}")
            return total
        except Exception as e:
            print(f"[docx_pages] 이미지 생성/업로드 오류: {e}")
            import traceback; traceback.print_exc()
            return 0


STORAGE_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt": "application/vnd.ms-powerpoint",

    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    # HWPX는 별도 처리 (마크다운 변환 후 text/plain 저장)
}
# Supabase Storage에 저장하는 확장자
STORABLE_EXTENSIONS = set(STORAGE_CONTENT_TYPES.keys())

# 파일 크기 제한 (바이트)
MAX_FILE_SIZE = 200 * 1024 * 1024  # 200MB
MAX_VIDEO_SIZE = 25 * 1024 * 1024  # Whisper API 제한 25MB
VIDEO_AUDIO_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "webm", "mp3", "m4a"}


def _friendly_media_upload_error(ext: str, error: Exception) -> str:
    raw = str(error)
    lowered = raw.lower()

    if "maximum content size limit" in lowered or "413" in lowered or "25mb" in lowered:
        return "오디오/비디오 파일은 25MB 이하만 업로드할 수 있습니다."
    if "rate limit" in lowered or "rate_limit" in lowered:
        return "일시적으로 처리 요청이 초과되었습니다. 잠시 후 다시 시도해주세요."
    if "timeout" in lowered or "timed out" in lowered or "connection" in lowered:
        return "처리 중 서버 연결이 끊겼습니다. 잠시 후 다시 시도해주세요."
    if "invalid file format" in lowered or "could not decode" in lowered or "no such file" in lowered:
        return f"{ext.upper()} 파일이 손상되었거나 재생할 수 없는 파일입니다. 파일이 정상적으로 재생되는지 확인 후 다시 업로드해주세요."
    if "지원하지 않는 파일 형식" in raw:
        return "지원하지 않는 오디오/비디오 파일 형식입니다. MP4, MOV, AVI, MKV, WEBM, MP3, M4A 파일만 업로드해주세요."
    if ext in ("mp3", "m4a"):
        return (
            f"{ext.upper()} 파일을 처리하지 못했습니다. "
            "파일이 손상되었거나 재생할 수 없는 파일일 수 있습니다. 파일이 정상적으로 재생되는지 확인 후 다시 시도해주세요."
        )
    return (
        f"{ext.upper()} 파일을 처리하지 못했습니다. "
        "파일이 손상되었거나 지원하지 않는 코덱일 수 있습니다. MP4 형식으로 변환 후 다시 시도해주세요."
    )


def _friendly_url_ingest_error(url: str, error: Exception) -> str:
    raw = str(error)
    lowered = raw.lower()
    is_youtube = _extract_youtube_video_id(url) is not None

    if is_youtube:
        if "자막이 없습니다" in raw:
            return "이 유튜브 영상에는 사용할 수 있는 자막이 없습니다. 자막이 있는 영상 URL을 입력해주세요."
        if "비활성화" in raw:
            return "이 유튜브 영상은 자막이 비활성화되어 있어 불러올 수 없습니다."
        return "유튜브 자막을 불러오지 못했습니다. 자막이 공개된 영상인지 확인한 뒤 다시 시도해주세요."

    if "maximum content size limit" in lowered or "413" in lowered or "25mb" in lowered:
        return "오디오/비디오 파일은 25MB 이하만 처리할 수 있습니다."
    if "invalid file format" in lowered or "지원하지 않는 파일 형식" in raw:
        return (
            "지원하지 않는 오디오/비디오 형식입니다. "
            "MP4, MOV, AVI, MKV, WEBM, MP3, M4A 형식만 사용할 수 있습니다."
        )
    media_error_markers_lower = (
        "media url",
        "transcription",
    )
    media_error_markers_raw = (
        "미디어 URL",
        "오디오/비디오 URL",
        "전사",
        "음성 내용",
    )
    if any(marker in lowered for marker in media_error_markers_lower) or any(marker in raw for marker in media_error_markers_raw):
        return "오디오/비디오 파일을 처리하지 못했습니다. 파일 형식이나 인코딩을 확인한 뒤 다시 시도해주세요."

    return raw


def _friendly_document_upload_error(ext: str, error: Exception) -> tuple[int, str]:
    raw = str(error)
    lowered = raw.lower()

    if ext in VIDEO_AUDIO_EXTENSIONS:
        return 400, _friendly_media_upload_error(ext, error)

    if ext == "pdf":
        if "broken document" in lowered or "cannot open" in lowered:
            return 400, "PDF 파일이 손상되었거나 열 수 없는 형식입니다."
        if "password" in lowered or "encrypt" in lowered:
            return 400, "암호로 보호된 PDF는 업로드할 수 없습니다. 보안 해제 후 다시 시도해주세요."
        return 400, "PDF 내용을 읽지 못했습니다. 암호화되었거나 손상된 파일인지 확인해주세요."

    if ext == "docx":
        if "file is not a zip file" in lowered or "package not found" in lowered:
            return 400, "DOCX 파일 형식이 올바르지 않습니다. 실제 Word 문서인지 확인해주세요."
        if "badzipfile" in lowered or "corrupt" in lowered:
            return 400, "DOCX 파일이 손상되어 문서 내용을 읽을 수 없습니다."
        return 400, "DOCX 문서를 분석하지 못했습니다. 손상되었거나 지원하지 않는 구성 요소가 포함되어 있을 수 있습니다."

    if ext in {"ppt", "pptx"}:
        if "file is not a zip file" in lowered:
            return 400, "PPT/PPTX 파일 형식이 올바르지 않습니다. 실제 PowerPoint 문서인지 확인해주세요."
        if "presentation" in lowered or "powerpoint" in lowered or "corrupt" in lowered:
            return 400, "PPT/PPTX 파일이 손상되었거나 슬라이드 구조를 읽을 수 없습니다."
        return 400, "PPT/PPTX 파일을 분석하지 못했습니다. 손상된 파일인지 확인해주세요."

    if ext == "hwp":
        if "hwp" in lowered or "ole" in lowered:
            return 400, "HWP 파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다."
        return 400, "HWP 문서 분석에 실패했습니다."

    if ext == "hwpx":
        if "file is not a zip file" in lowered or "xml" in lowered:
            return 400, "HWPX 내부 문서 구조를 읽을 수 없습니다. 손상된 파일인지 확인해주세요."
        if "corrupt" in lowered:
            return 400, "HWPX 파일이 손상되어 내용을 추출할 수 없습니다."
        return 400, "HWPX 문서 분석에 실패했습니다."

    if ext in {"jpg", "jpeg", "png", "gif", "webp"}:
        if "이미지 압축 실패" in raw:
            return 400, "이미지 파일 압축에 실패했습니다. 손상된 이미지인지 확인해주세요."
        if "cannot identify image file" in lowered or "unidentifiedimageerror" in lowered:
            return 400, "이미지 파일 형식이 올바르지 않거나 손상되었습니다."
        return 400, "이미지 분석에 실패했습니다. 이미지 내용을 읽을 수 없는 파일일 수 있습니다."

    return 500, "파일 처리 중 오류가 발생했습니다. 파일 형식과 내용을 확인한 뒤 다시 시도해주세요."


def _ensure_youtube_document_chunks(document_id: str, storage_path: str) -> None:
    if not storage_path or not storage_path.startswith(("http://", "https://")):
        return

    existing = (
        supabase_admin.table("document_chunks")
        .select("chunk_index")
        .eq("doc_id", document_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return

    ingest_url(storage_path, document_id)
    supabase_admin.table("documents").update({
        "status": "ready",
    }).eq("id", document_id).execute()


@router.post("/documents/upload")
async def upload_document(
    notebook_id: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """파일 업로드 → Supabase Storage 저장 → documents 테이블 등록 → RAG 청킹."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일명이 없습니다.")

    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(f".{e}" for e in sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 형식입니다. 지원 형식: {supported}")

    file_bytes = await file.read()

    # 빈 파일 검사
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다. 내용이 있는 파일을 업로드해주세요.")

    # 파일 크기 검사
    if ext in VIDEO_AUDIO_EXTENSIONS and len(file_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail="비디오/오디오 파일은 25MB 이하만 가능합니다.")
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기는 200MB 이하만 가능합니다.")

    # 중복 업로드 검사
    try:
        existing = (
            supabase_admin.table("documents")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("filename", file.filename.replace('\x00', ''))
            .eq("status", "ready")
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=409, detail="같은 이름의 파일이 이미 업로드되어 있습니다. 파일명을 변경하거나 기존 파일을 삭제해주세요.")
    except HTTPException:
        raise
    except Exception:
        pass

    # 이미지 파일이 5MB를 초과하면 자동 압축 (Claude Vision API 5MB 제한)
    original_filename = file.filename
    MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB
    compressed = False
    original_format: str | None = None
    if ext in {"jpg", "jpeg", "png", "gif", "webp"} and len(file_bytes) > MAX_IMAGE_SIZE:
        try:
            from PIL import Image
            import io as _io
            img = Image.open(_io.BytesIO(file_bytes))
            img.load()  # 손상 파일 조기 감지
            if img.mode == "RGBA":
                img = img.convert("RGB")
            compressed_buf = _io.BytesIO()
            quality = 85
            while quality >= 60:
                compressed_buf.seek(0)
                compressed_buf.truncate(0)
                img.save(compressed_buf, format="JPEG" if ext in {"jpg", "jpeg"} else "PNG", quality=quality)
                if compressed_buf.tell() <= MAX_IMAGE_SIZE:
                    break
                quality -= 5
            file_bytes = compressed_buf.getvalue()
            original_ext = ext
            if ext not in {"jpg", "jpeg"}:
                original_format = ext.upper()
                ext = "jpg"
                file.filename = original_filename.rsplit(".", 1)[0] + ".jpg"
            compressed = True
            print(f"[Image] 자동 압축 완료: {len(file_bytes)} bytes (원본: {original_ext} → 변환: {ext})")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[Image] 압축 실패: {e}")
            raise HTTPException(status_code=400, detail="이미지 파일을 처리할 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.")

    doc_id = str(uuid.uuid4())

    # HWPX 마크다운 미리 추출 (업로드 전, doc_id 확정 후 DB에 저장)
    hwpx_markdown_text: str | None = None
    if ext == "hwpx":
        try:
            from app.services.rag import _extract_markdown_from_hwpx
            hwpx_markdown_text = _extract_markdown_from_hwpx(file_bytes)
            print(f"[HWPX] 마크다운 변환 완료 ({len(hwpx_markdown_text)}자)")
        except Exception as e:
            import traceback
            print(f"[HWPX] 마크다운 변환 실패: {e}")
            traceback.print_exc()

    # 1. Supabase Storage에 업로드
    if ext in STORABLE_EXTENSIONS:
        storage_bytes = file_bytes
        storage_ext = ext
        content_type = STORAGE_CONTENT_TYPES[ext]

        if ext in {"avi", "mkv", "mov"}:
            converted_bytes, converted_ext, converted_content_type = prepare_media_for_browser_playback(
                file_bytes,
                file.filename,
            )
            if converted_ext != ext and converted_content_type:
                storage_bytes = converted_bytes
                storage_ext = converted_ext
                content_type = converted_content_type

        storage_path = f"{user['id']}/{doc_id}.{storage_ext}"
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                storage_bytes,
                {"content-type": content_type},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")
    else:
        storage_path = ""

    # 2. documents 테이블에 메타데이터 저장
    try:
        supabase_admin.table("documents").insert({
            "id": doc_id,
            "notebook_id": notebook_id,
            "user_id": user["id"],
            "filename": file.filename.replace('\x00', ''),
            "file_type": "pdf",
            "file_size": len(file_bytes),
            "storage_path": storage_path,
            "status": "processing",
        }).execute()
    except Exception as e:
        if storage_path:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")

    warnings: list[str] = []

    # 3-A. PPT/PPTX: 슬라이드 이미지 생성 + 영상 추출 + Vision AI 분석 (RAG보다 먼저)
    pptx_vision: dict = {}
    pptx_total_slides: int = 0
    if ext in ("pptx", "ppt"):
        pptx_total_slides, pptx_vision = _generate_and_upload_slides(file_bytes, doc_id)
        if pptx_total_slides == 0:
            warnings.append("슬라이드 미리보기를 생성하지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.")
        elif pptx_total_slides > 100:
            warnings.append(f"슬라이드가 {pptx_total_slides}장으로 많아 일부만 표시될 수 있습니다.")

    # 3-A2. DOCX: 페이지 이미지 생성 (LibreOffice PDF 변환 → WebP)
    if ext == "docx":
        docx_page_count = _generate_and_upload_docx_pages(file_bytes, doc_id)
        if docx_page_count == 0:
            warnings.append("문서 미리보기를 생성하지 못했습니다. 파일이 손상되었거나 일부 서식이 지원되지 않을 수 있습니다.")

    # 3-A3. HWPX: pyhwpx → PDF → WebP 페이지 이미지
    hwpx_page_count: int = 0
    hwpx_pdf_bytes: bytes | None = None
    if ext == "hwpx":
        hwpx_page_count, hwpx_pdf_bytes = _generate_and_upload_hwpx_pages(file_bytes, doc_id)
        warnings.append("HWPX 파일은 텍스트 추출만 지원됩니다. 페이지 미리보기는 제공되지 않습니다.")

    # 3-B. PDF: 이미지 페이지 Vision AI 분석 (RAG보다 먼저)
    pdf_vision: dict = {}
    if ext == "pdf":
        pdf_vision = _analyze_pdf_images(file_bytes)

    # 이미지 자동 압축 안내
    if compressed and original_format:
        warnings.append(f"이미지 용량이 커서 자동으로 압축되었습니다. ({original_format} → JPEG)")
    elif compressed:
        warnings.append("이미지 용량이 커서 자동으로 압축되었습니다.")

    # GIF 애니메이션 안내
    if ext == "gif":
        warnings.append("애니메이션 GIF는 첫 번째 프레임만 분석됩니다.")

    # 4. RAG 청킹 → document_chunks 저장
    try:
        chunk_count, page_count = ingest_document(
            file_bytes, doc_id, filename=file.filename,
            pptx_vision=pptx_vision, pdf_vision=pdf_vision,
            hwpx_page_count=hwpx_page_count,
            hwpx_pdf_bytes=hwpx_pdf_bytes,
        )
    except ValueError as e:
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        if storage_path:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        status_code, detail = _friendly_document_upload_error(ext, e)
        raise HTTPException(status_code=status_code, detail=detail)

    # 텍스트 없음 감지 (포맷별 안내)
    if chunk_count == 0:
        if ext == "pdf":
            warnings.append("텍스트를 추출하지 못했습니다. 스캔본 PDF이거나 이미지로만 구성된 경우 일부 기능이 제한될 수 있습니다.")
        elif ext in ("docx",):
            warnings.append("텍스트를 추출하지 못했습니다. 이미지나 도형으로만 구성된 문서이거나 파일이 손상되었을 수 있습니다.")
        elif ext in ("pptx", "ppt"):
            warnings.append("텍스트를 추출하지 못했습니다. 슬라이드가 이미지로만 구성된 경우 AI 검색 기능이 제한될 수 있습니다.")
        elif ext in ("hwp", "hwpx"):
            warnings.append("텍스트를 추출하지 못했습니다. 이미지로만 구성된 문서이거나 한/글 포맷 지원 한계일 수 있습니다.")
        elif ext in ("jpg", "jpeg", "png", "gif", "webp"):
            warnings.append("이미지 분석에 실패했습니다. AI 검색 기능이 제한될 수 있습니다.")
        elif ext in ("mp4", "mov", "avi", "mkv", "webm"):
            warnings.append("음성이 감지되지 않았습니다. 음성이 없거나 배경음악만 있는 영상은 AI 검색 기능이 제한될 수 있습니다.")
        elif ext in ("mp3", "m4a"):
            warnings.append("음성이 감지되지 않았습니다. 무음이거나 음성이 없는 오디오 파일은 AI 검색 기능이 제한될 수 있습니다.")

    # 4-B. HWPX 마크다운을 document_chunks 테이블에 chunk_index=-1로 저장
    if ext == "hwpx" and hwpx_markdown_text:
        try:
            supabase_admin.table("document_chunks").insert({
                "doc_id": doc_id,
                "chunk_index": -1,
                "content": hwpx_markdown_text,
            }).execute()
            print(f"[HWPX] 마크다운 DB 저장 완료 (doc_id={doc_id})")
        except Exception as e:
            print(f"[HWPX] 마크다운 DB 저장 실패: {e}")

    # 5. 상태 업데이트 (HWPX는 실제 페이지 수 사용)
    final_page_count = hwpx_page_count if (ext == "hwpx" and hwpx_page_count > 0) else page_count
    try:
        supabase_admin.table("documents").update({
            "status": "ready",
            "chunk_count": chunk_count,
            "page_count": final_page_count,
        }).eq("id", doc_id).execute()
    except Exception as e:
        print(f"[upload] status 업데이트 실패 (doc_id={doc_id}): {e}")
        warnings.append("파일 처리는 완료됐지만 상태 업데이트에 실패했습니다. 잠시 후 새로고침해 주세요.")

    response: dict = {
        "doc_id": doc_id,
        "filename": file.filename,
        "file_type": ext,
        "chunk_count": chunk_count,
        "notebook_id": notebook_id,
        "message": "업로드 및 인덱싱 완료",
    }
    if warnings:
        response["warnings"] = warnings
    return response


class IngestUrlRequest(BaseModel):
    notebook_id: str
    url: str
    filename: Optional[str] = None


@router.post("/documents/ingest_url")
async def ingest_url_document(
    req: IngestUrlRequest,
    user: dict = Depends(get_current_user),
):
    """URL에서 텍스트 추출 → documents 테이블 등록 → RAG 청킹.

    file_type enum 문제 우회: storage_path에 URL을 저장하고 file_type은 기본값 사용.
    """
    # 표시 파일명 결정
    if req.filename:
        display_name = req.filename[:80]
    else:
        try:
            parsed = urlparse(req.url)
            domain = parsed.netloc.lstrip("www.")
            path_parts = [p for p in parsed.path.strip("/").split("/") if p]
            display_name = f"{domain}/{path_parts[0]}" if path_parts else domain
            display_name = display_name[:80]
        except Exception:
            display_name = req.url[:80]

    doc_id = str(uuid.uuid4())

    # 1. documents 테이블에 등록 (storage_path = URL, file_type = 기본값)
    insert_data: dict = {
        "id": doc_id,
        "notebook_id": req.notebook_id,
        "user_id": user["id"],
        "filename": display_name,
        "file_size": 0,
        "storage_path": req.url,   # URL을 storage_path에 저장
        "status": "processing",
    }
    # file_type 컬럼 처리: TEXT면 "url", enum이면 "pdf"로 폴백
    try:
        supabase_admin.table("documents").insert({**insert_data, "file_type": "url"}).execute()
    except Exception as first_err:
        if "enum" in str(first_err).lower() or "invalid input value" in str(first_err).lower() or "23502" in str(first_err):
            # enum 제약 우회: 유효한 enum 값 "pdf" 사용
            try:
                supabase_admin.table("documents").insert({**insert_data, "file_type": "pdf"}).execute()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(e)}")
        else:
            raise HTTPException(status_code=500, detail=f"문서 등록 실패: {str(first_err)}")

    # 2. URL에서 텍스트 추출 → RAG 청킹
    try:
        chunk_count, _ = ingest_url(req.url, doc_id)
    except ValueError as e:
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        raise HTTPException(status_code=422, detail=_friendly_url_ingest_error(req.url, e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase_admin.table("documents").update({"status": "error"}).eq("id", doc_id).execute()
        friendly = _friendly_url_ingest_error(req.url, e)
        if friendly != str(e):
            raise HTTPException(status_code=400, detail=friendly)
        raise HTTPException(status_code=500, detail=f"URL 처리 실패: {str(e)}")

    # 3. 상태 업데이트
    supabase_admin.table("documents").update({
        "status": "ready",
        "chunk_count": chunk_count,
    }).eq("id", doc_id).execute()

    return {
        "doc_id": doc_id,
        "filename": display_name,
        "chunk_count": chunk_count,
        "notebook_id": req.notebook_id,
        "message": "URL 인덱싱 완료",
    }


class RenameRequest(BaseModel):
    filename: str


@router.get("/documents/{document_id}/access-url")
async def get_document_access_url(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 열람용 URL 반환 (소유자 또는 수강 학생)."""
    doc_res = (
        supabase_admin.table("documents")
        .select("id, notebook_id, user_id, storage_path, filename, status")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    doc = doc_res.data[0]
    if doc.get("status") != "ready":
        raise HTTPException(status_code=404, detail="사용할 수 없는 문서입니다.")
    notebook_id = doc.get("notebook_id")
    if not notebook_id:
        raise HTTPException(status_code=400, detail="노트북 정보가 없는 문서입니다.")

    nb = (
        supabase_admin.table("notebooks")
        .select("id, user_id")
        .eq("id", notebook_id)
        .single()
        .execute()
        .data
    )
    if not nb:
        raise HTTPException(status_code=404, detail="노트북을 찾을 수 없습니다.")

    owner_id = nb.get("user_id")
    is_owner = owner_id == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="문서 열람 권한이 없습니다.")

    storage_path = (doc.get("storage_path") or "").strip()
    if not storage_path:
        raise HTTPException(status_code=400, detail="문서 경로 정보가 없습니다.")

    if storage_path.startswith(("http://", "https://")):
        return {"url": storage_path, "kind": "external"}

    try:
        resp = supabase_admin.storage.from_(STORAGE_BUCKET).create_signed_url(
            storage_path, 3600
        )
        signed_url = resp.get("signedURL") or resp.get("signedUrl") or ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"문서 URL 생성 실패: {str(e)}")

    if not signed_url:
        raise HTTPException(status_code=500, detail="문서 URL 생성에 실패했습니다.")

    return {"url": signed_url, "kind": "signed", "expires_in": 3600}


@router.get("/documents/{document_id}/markdown")
async def get_document_markdown(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """DOCX/HWPX 문서를 마크다운으로 변환 반환. 원본 파일을 Storage에서 다운받아 변환."""
    doc_res = (
        supabase_admin.table("documents")
        .select("id, notebook_id, user_id, storage_path, filename, status")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    doc = doc_res.data[0]
    if doc.get("status") != "ready":
        raise HTTPException(status_code=404, detail="사용할 수 없는 문서입니다.")

    # 권한 확인 (소유자 또는 수강 학생)
    notebook_id = doc.get("notebook_id")
    nb = (
        supabase_admin.table("notebooks")
        .select("user_id")
        .eq("id", notebook_id)
        .single()
        .execute()
        .data
    )
    is_owner = nb and nb.get("user_id") == user["id"]
    if not is_owner:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", notebook_id)
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="문서 열람 권한이 없습니다.")

    filename = doc.get("filename", "")
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in ("docx", "hwpx"):
        raise HTTPException(status_code=400, detail="DOCX/HWPX 파일만 마크다운 변환을 지원합니다.")

    # HWPX: Storage 사용 안 함 — DB에서 직접 조회
    if ext == "hwpx":
        try:
            md_row = (
                supabase_admin.table("document_chunks")
                .select("content")
                .eq("doc_id", document_id)
                .eq("chunk_index", -1)
                .limit(1)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"마크다운 조회 실패: {e}")
        if not md_row.data:
            raise HTTPException(status_code=400, detail="HWPX 마크다운이 없습니다. 파일을 다시 업로드해 주세요.")
        return {"markdown": md_row.data[0]["content"]}

    storage_path = (doc.get("storage_path") or "").strip()
    if not storage_path:
        raise HTTPException(status_code=400, detail="파일이 저장되지 않았습니다. 새로 업로드해 주세요.")

    try:
        file_bytes = supabase_admin.storage.from_(STORAGE_BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 다운로드 실패: {e}")

    try:
        from app.services.rag import _extract_markdown_from_docx
        markdown = _extract_markdown_from_docx(file_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"마크다운 변환 실패: {e}")

    return {"markdown": markdown}


@router.get("/documents/{document_id}/slides")
async def get_document_slides(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """PPT 슬라이드 에셋 정보 반환.
    meta.json 로드 후 각 슬라이드의 signed URL (webp + 영상) 반환."""
    doc_res = (
        supabase_admin.table("documents")
        .select("id, notebook_id, user_id, filename, status")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    doc = doc_res.data[0]

    # 권한 확인
    nb = supabase_admin.table("notebooks").select("user_id").eq("id", doc["notebook_id"]).single().execute().data
    is_owner = nb and nb.get("user_id") == user["id"]
    if not is_owner:
        enrolled = supabase_admin.table("notebook_enrollments").select("id").eq("notebook_id", doc["notebook_id"]).eq("student_id", user["id"]).execute().data
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    prefix = f"{SLIDE_ASSETS_PREFIX}/{document_id}"

    # 파일 목록으로 슬라이드 수 및 영상 파일 파악
    try:
        file_list = supabase_admin.storage.from_(STORAGE_BUCKET).list(prefix)
    except Exception:
        raise HTTPException(status_code=404, detail="슬라이드 에셋이 없습니다. PPT 처리 중이거나 지원하지 않는 파일입니다.")

    if not file_list:
        raise HTTPException(status_code=404, detail="슬라이드 에셋이 없습니다. PPT 처리 중이거나 지원하지 않는 파일입니다.")

    # N.webp 파일만 필터링해서 total 계산
    import re as _re
    slide_nums = []
    videos: dict = {}  # {"3": "mp4", ...}
    for f in file_list:
        name = f.get("name", "")
        m = _re.match(r'^(\d+)\.webp$', name)
        if m:
            slide_nums.append(int(m.group(1)))
        v = _re.match(r'^video_(\d+)\.(\w+)$', name)
        if v:
            videos[v.group(1)] = v.group(2)

    if not slide_nums:
        raise HTTPException(status_code=404, detail="슬라이드 에셋이 없습니다. PPT 처리 중이거나 지원하지 않는 파일입니다.")

    total = max(slide_nums)

    def _signed(path: str, expires: int = 3600) -> str:
        try:
            resp = supabase_admin.storage.from_(STORAGE_BUCKET).create_signed_url(path, expires)
            return resp.get("signedURL") or resp.get("signedUrl") or ""
        except Exception:
            return ""

    slides = []
    for i in range(1, total + 1):
        img_url = _signed(f"{prefix}/{i}.webp")
        video_url = ""
        if str(i) in videos:
            ext = videos[str(i)]
            video_url = _signed(f"{prefix}/video_{i}.{ext}")
        slides.append({"slide_number": i, "image_url": img_url, "video_url": video_url})

    return {"total": total, "slides": slides}


_IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp"}
_TEXT_DOC_EXTS = {"pdf", "docx", "doc", "pptx", "ppt", "hwp", "hwpx", "txt"}

# 인메모리 1차 캐시 (서버 재시작 전까지 빠른 응답용)
_mem_cache: dict[tuple[str, str], dict] = {}
_slide_desc_cache: dict[str, dict[int, str]] = {}  # doc_id → {슬라이드번호: 설명}


@router.get("/documents/{document_id}/slide-descriptions")
async def get_slide_descriptions(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """PPT 슬라이드별 설명 — chat_with_docs()를 슬라이드별 병렬 호출해 챗과 동일 품질로 생성."""
    import re as _re
    import asyncio

    doc_res = supabase_admin.table("documents").select("id, notebook_id").eq("id", document_id).limit(1).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    doc = doc_res.data[0]

    nb = supabase_admin.table("notebooks").select("user_id").eq("id", doc["notebook_id"]).single().execute().data
    is_owner = nb and nb.get("user_id") == user["id"]
    if not is_owner:
        enrolled = supabase_admin.table("notebook_enrollments").select("id").eq("notebook_id", doc["notebook_id"]).eq("student_id", user["id"]).execute().data
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    if document_id in _slide_desc_cache:
        return {"descriptions": _slide_desc_cache[document_id]}

    result = (
        supabase_admin.table("document_chunks")
        .select("chunk_index, content")
        .eq("doc_id", document_id)
        .order("chunk_index")
        .execute()
    )

    # 슬라이드별 청크 내용 수집
    slide_chunks: dict[int, list[str]] = {}
    for row in result.data or []:
        content = row.get("content", "")
        m = _re.match(r"^\[슬라이드\s*(\d+)\]", content.strip())
        if m:
            n = int(m.group(1))
            slide_chunks.setdefault(n, []).append(content)

    slide_nums = sorted(slide_chunks.keys())
    if not slide_nums:
        return {"descriptions": {}}

    _trailing_pattern = _re.compile(
        r"\s*\n?\n?("
        r"이해(가|하기)?\s*(되셨나요|됐나요|되었나요)\??|"
        r"추가(로|적으로)?\s*(궁금한|질문이|알고\s*싶은).{0,30}(있으면|있다면|있으시면).{0,30}[\.\!~]*|"
        r"질문(이)?\s*(있으면|있다면|있으시면).{0,30}[\.\!~]*|"
        r"더\s*(궁금한|알고\s*싶은).{0,30}(있으면|있다면).{0,30}[\.\!~]*|"
        r"언제든지\s*(질문|물어).{0,30}[\.\!~]*"
        r")\s*$",
        _re.IGNORECASE,
    )

    def _strip_trailing(text: str) -> str:
        return _trailing_pattern.sub("", text).rstrip()

    def _normalize_slide_refs(text: str) -> str:
        def replacer(m: _re.Match) -> str:
            if m.start() > 0 and text[m.start() - 1] == "[":
                return m.group(0)
            return f"[슬라이드 {m.group(1)}]"
        return _re.sub(r"슬라이드\s*(\d+)", replacer, text)

    # RAG 우회: 해당 슬라이드 청크 내용을 직접 LLM에 전달
    def explain_slide(slide_num: int) -> tuple[int, str]:
        import time as _time
        content_text = "\n\n".join(slide_chunks.get(slide_num, []))
        for attempt in range(4):
            try:
                answer = _call_llm(
                    messages=[
                        {
                            "role": "user",
                            "content": (
                                f"다음은 슬라이드 {slide_num}의 내용입니다:\n\n{content_text}\n\n"
                                "이 슬라이드의 내용을 학생에게 선생님처럼 자세히 설명해줘. "
                                "이해도 확인 문구(예: '이해가 되었나요?', '궁금한 점 있으면 알려주세요' 등)는 절대 포함하지 말고 설명으로만 끝내줘."
                            ),
                        }
                    ],
                    model=_DEFAULT_MODEL,
                    temperature=0.5,
                    max_tokens=1024,
                )
                return slide_num, _normalize_slide_refs(_strip_trailing(answer))
            except Exception as e:
                if "429" in str(e) and attempt < 3:
                    wait = 5 * (2 ** attempt)  # 5s → 10s → 20s
                    print(f"[slide_desc] 슬라이드 {slide_num} rate limit, {wait}s 후 재시도 ({attempt+1}/3)")
                    _time.sleep(wait)
                else:
                    print(f"[slide_desc] 슬라이드 {slide_num} 설명 생성 실패: {e}")
                    return slide_num, ""
        return slide_num, ""

    # concurrent connection 한도 고려해 2개로 제한 + 429 재시도로 보완
    semaphore = asyncio.Semaphore(2)

    async def explain_slide_limited(slide_num: int) -> tuple[int, str]:
        async with semaphore:
            return await asyncio.to_thread(explain_slide, slide_num)

    tasks = [explain_slide_limited(n) for n in slide_nums]
    results = await asyncio.gather(*tasks)

    descriptions: dict[int, str] = {n: ans for n, ans in results if ans}
    _slide_desc_cache[document_id] = descriptions
    return {"descriptions": descriptions}


@router.get("/documents/{document_id}/slides/{slide_num}/audio")
async def get_slide_audio(
    document_id: str,
    slide_num: int,
    voice: str = DEFAULT_VOICE,
    user: dict = Depends(get_current_user),
):
    """슬라이드 설명 TTS 오디오 반환. Supabase Storage에 캐싱."""
    from app.services.tts import tts_with_timestamps

    doc_res = supabase_admin.table("documents").select("id, notebook_id").eq("id", document_id).limit(1).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    doc = doc_res.data[0]
    nb = supabase_admin.table("notebooks").select("user_id").eq("id", doc["notebook_id"]).single().execute().data
    is_owner = nb and nb.get("user_id") == user["id"]
    if not is_owner:
        enrolled = supabase_admin.table("notebook_enrollments").select("id").eq("notebook_id", doc["notebook_id"]).eq("student_id", user["id"]).execute().data
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    voice_key = voice if voice in ELEVENLABS_VOICES else DEFAULT_VOICE

    cached = load_slide_audio(document_id, slide_num, voice_key)
    if cached:
        return StreamingResponse(io.BytesIO(cached), media_type="audio/mpeg")

    desc_text = _slide_desc_cache.get(document_id, {}).get(slide_num)
    if not desc_text:
        raise HTTPException(status_code=404, detail="슬라이드 설명이 아직 생성되지 않았습니다. 잠시 후 다시 시도해주세요.")

    clean_text = re.sub(r"\[슬라이드\s*\d+\]", "", desc_text)
    clean_text = re.sub(r"📷|🎬", "", clean_text).strip()

    mp3_bytes, _ = await tts_with_timestamps(clean_text, voice_key)

    import asyncio as _asyncio
    _asyncio.get_event_loop().run_in_executor(
        None, save_slide_audio, document_id, slide_num, voice_key, mp3_bytes
    )

    return StreamingResponse(io.BytesIO(mp3_bytes), media_type="audio/mpeg")


class AudioSummaryRequest(BaseModel):
    voice: str = DEFAULT_VOICE  # "sarah" | "rachel" | "josh" | "adam"


@router.post("/documents/{document_id}/audio-summary")
async def get_document_audio_summary(
    document_id: str,
    req: AudioSummaryRequest = AudioSummaryRequest(),
    user: dict = Depends(get_current_user),
):
    """문서 음성 요약 — 이미지는 GPT-4o Vision, 나머지는 chunks 텍스트 → GPT-4o → ElevenLabs TTS.
    캐시 우선순위: 1) 인메모리  2) Supabase Storage  3) 새로 생성
    """
    voice_key = req.voice if req.voice in ELEVENLABS_VOICES else DEFAULT_VOICE

    # 1차: 인메모리 캐시
    mem_key = (document_id, voice_key)
    if mem_key in _mem_cache:
        return JSONResponse(_mem_cache[mem_key])

    # 2차: Supabase Storage 영구 캐시
    stored = load_cached_summary(document_id, voice_key)
    if stored:
        _mem_cache[mem_key] = stored   # 인메모리에도 올려두기
        return JSONResponse(stored)
    # 1. 문서 조회
    doc_res = (
        supabase_admin.table("documents")
        .select("id, notebook_id, user_id, storage_path, filename, file_type, status")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    doc = doc_res.data[0]
    if doc.get("status") != "ready":
        raise HTTPException(status_code=400, detail="사용할 수 없는 문서입니다.")

    # 2. 열람 권한 확인 (소유자 또는 수강 학생)
    notebook_id = doc.get("notebook_id")
    if notebook_id:
        nb = (
            supabase_admin.table("notebooks")
            .select("id, user_id")
            .eq("id", notebook_id)
            .single()
            .execute()
            .data
        )
        if nb and nb.get("user_id") != user["id"]:
            enrolled = (
                supabase_admin.table("notebook_enrollments")
                .select("id")
                .eq("notebook_id", notebook_id)
                .eq("student_id", user["id"])
                .execute()
                .data
            )
            if not enrolled:
                raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    # 3. 파일 형식 판별
    filename = doc.get("filename", "")
    storage_path = doc.get("storage_path", "") or ""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    file_type = doc.get("file_type", "") or ""
    is_image = ext in _IMAGE_EXTS
    is_url_doc = (
        file_type in ("url", "link")
        or storage_path.startswith(("http://", "https://"))
    )
    is_youtube_doc = bool(storage_path) and _extract_youtube_video_id(storage_path) is not None
    is_media_doc = ext in VIDEO_AUDIO_EXTENSIONS or is_youtube_doc
    is_text_doc = ext in _TEXT_DOC_EXTS or is_url_doc or is_media_doc

    if not is_image and not is_text_doc:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. (지원: 이미지, PDF, DOCX, PPTX, TXT, 웹 URL, 비디오, 오디오 등)",
        )

    openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)

    # 4-A. 이미지: GPT-4o Vision으로 내용 설명
    if is_image:
        storage_path = (doc.get("storage_path") or "").strip()
        if not storage_path:
            raise HTTPException(status_code=400, detail="문서 경로 정보가 없습니다.")
        if storage_path.startswith(("http://", "https://")):
            image_url = storage_path
        else:
            try:
                resp = supabase_admin.storage.from_(STORAGE_BUCKET).create_signed_url(storage_path, 300)
                image_url = resp.get("signedURL") or resp.get("signedUrl") or ""
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"이미지 URL 생성 실패: {str(e)}")
        if not image_url:
            raise HTTPException(status_code=500, detail="이미지 URL 생성에 실패했습니다.")
        try:
            completion = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "이 이미지는 학습 자료입니다. 다음 형식으로 한국어 음성 요약 스크립트를 작성해주세요:\n"
                                "1) 첫 문장: 이미지의 전체 주제/성격 한 줄 소개\n"
                                "2) 핵심 내용을 항목별로 자연스럽게 설명 (청취자가 이해하기 쉽게)\n"
                                "3) 마지막 문장: 학습 포인트 한 줄 마무리\n"
                                "말투는 친근하고 명확하게, 총 2~3분 분량으로 작성해주세요."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }],
                max_tokens=1200,
            )
            summary_text = completion.choices[0].message.content or ""
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"이미지 분석 실패: {str(e)}")

    # 4-B. 텍스트 문서: chunks → GPT-4o 요약
    else:
        _ensure_youtube_document_chunks(document_id, storage_path)
        chunks_res = (
            supabase_admin.table("document_chunks")
            .select("content, chunk_index")
            .eq("doc_id", document_id)
            .order("chunk_index")
            .execute()
        )
        if not chunks_res.data:
            if is_youtube_doc:
                raise HTTPException(
                    status_code=500,
                    detail="유튜브 자막을 불러오지 못했습니다. 서버에 youtube-transcript-api가 설치되어 있는지 확인해주세요.",
                )
            raise HTTPException(status_code=400, detail="문서 내용이 없습니다. 문서가 아직 처리 중일 수 있습니다.")
        raw_text = "\n\n".join(c["content"] for c in chunks_res.data)[:8000]
        try:
            completion = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": (
                        "아래 학습 자료를 한국어 음성 요약 스크립트로 변환해주세요.\n"
                        "형식:\n"
                        "1) 첫 문장: 자료의 주제 한 줄 소개\n"
                        "2) 핵심 내용을 순서대로 자연스럽게 설명\n"
                        "3) 마지막 문장: 핵심 학습 포인트 마무리\n"
                        "말투는 친근하고 명확하게, 총 2~3분 분량으로 작성해주세요.\n\n"
                        f"[자료 내용]\n{raw_text}"
                    ),
                }],
                max_tokens=1200,
            )
            summary_text = completion.choices[0].message.content or ""
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"텍스트 요약 실패: {str(e)}")

    # 5. ElevenLabs TTS + 타임스탬프 변환
    try:
        audio_bytes, subtitle_segments = await tts_with_timestamps(summary_text, voice_key)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"음성 변환 실패: {str(e)}")

    response_data = serialize_summary(summary_text, audio_bytes, subtitle_segments, voice_key)

    # 캐시 저장 (인메모리 + Storage 비동기 백그라운드)
    _mem_cache[mem_key] = response_data
    import asyncio
    asyncio.create_task(asyncio.to_thread(
        save_cached_summary, document_id, voice_key, summary_text, audio_bytes, subtitle_segments
    ))

    return JSONResponse(response_data)


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 청크 텍스트 반환 (미리보기용)."""
    doc_res = (
        supabase_admin.table("documents")
        .select("user_id, notebook_id, storage_path")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    # 소유자 또는 수강생 확인
    if doc_res.data["user_id"] != user["id"]:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", doc_res.data["notebook_id"])
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    _ensure_youtube_document_chunks(document_id, doc_res.data.get("storage_path") or "")

    chunks_res = (
        supabase_admin.table("document_chunks")
        .select("content, chunk_index")
        .eq("doc_id", document_id)
        .order("chunk_index")
        .execute()
    )
    rows = chunks_res.data or []
    if not rows and _extract_youtube_video_id(doc_res.data.get("storage_path") or "") is not None:
        raise HTTPException(
            status_code=500,
            detail="유튜브 자막을 불러오지 못했습니다. 서버에 youtube-transcript-api가 설치되어 있는지 확인해주세요.",
        )
    text = "\n\n".join(_strip_media_metadata(c["content"]) for c in rows)
    timeline = _build_media_timeline_from_chunks_v2(rows)
    return {"text": text, "timeline": timeline}



@router.get("/documents/{document_id}/media-summary")
async def get_document_media_summary(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    doc_res = (
        supabase_admin.table("documents")
        .select("user_id, notebook_id, filename, storage_path")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    if doc_res.data["user_id"] != user["id"]:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", doc_res.data["notebook_id"])
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    filename = doc_res.data.get("filename") or ""
    storage_path = doc_res.data.get("storage_path") or ""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    is_youtube_doc = bool(storage_path) and _extract_youtube_video_id(storage_path) is not None
    if ext not in VIDEO_AUDIO_EXTENSIONS and not is_youtube_doc:
        raise HTTPException(status_code=400, detail="비디오/오디오 문서에만 사용할 수 있습니다.")

    _ensure_youtube_document_chunks(document_id, doc_res.data.get("storage_path") or "")

    chunks_res = (
        supabase_admin.table("document_chunks")
        .select("content")
        .eq("doc_id", document_id)
        .order("chunk_index")
        .execute()
    )
    rows = chunks_res.data or []
    if not rows and is_youtube_doc:
        raise HTTPException(
            status_code=500,
            detail="유튜브 자막을 불러오지 못했습니다. 서버에 youtube-transcript-api가 설치되어 있는지 확인해주세요.",
        )
    summary = _parse_media_summary(rows[0]["content"]) if rows else {"title": "전체 내용 요약", "overview": "", "sections": []}
    timeline = _build_media_timeline_from_chunks_v2(rows)
    summary_was_updated = False

    if summary.get("sections"):
        aligned_summary = align_media_summary_to_timeline(summary, timeline)
        summary_was_updated = aligned_summary != summary
        summary = aligned_summary

    if not summary.get("sections"):
        generated_summary = _generate_media_summary_via_chat(document_id)
        aligned_summary = align_media_summary_to_timeline(generated_summary, timeline)
        summary_was_updated = aligned_summary != summary
        summary = aligned_summary

    if summary.get("sections") and rows and summary_was_updated:
        updated_chunks = _inject_media_summary([row["content"] for row in rows], summary)
        try:
            supabase_admin.table("document_chunks").update({
                "content": updated_chunks[0],
            }).eq("doc_id", document_id).eq("chunk_index", 0).execute()
        except Exception:
            pass
    return summary


@router.delete("/documents/{document_id}/media-summary")
async def delete_document_media_summary(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    doc_res = (
        supabase_admin.table("documents")
        .select("user_id, notebook_id, filename, storage_path")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    if doc_res.data["user_id"] != user["id"]:
        enrolled = (
            supabase_admin.table("notebook_enrollments")
            .select("id")
            .eq("notebook_id", doc_res.data["notebook_id"])
            .eq("student_id", user["id"])
            .execute()
            .data
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    chunks_res = (
        supabase_admin.table("document_chunks")
        .select("content")
        .eq("doc_id", document_id)
        .eq("chunk_index", 0)
        .limit(1)
        .execute()
    )
    rows = chunks_res.data or []
    if not rows:
        return {"ok": True}

    cleaned_content = _clear_media_summary_from_content(str(rows[0].get("content", "")))
    supabase_admin.table("document_chunks").update({
        "content": cleaned_content,
    }).eq("doc_id", document_id).eq("chunk_index", 0).execute()

    return {"ok": True}

    # 청크는 CHUNK_OVERLAP(100자) 슬라이딩 윈도우로 생성되므로
    # 두 번째 청크부터는 앞 CHUNK_OVERLAP 글자가 이전 청크 끝과 중복됨.
    # 원본 텍스트 복원: 첫 청크는 그대로, 나머지는 overlap 부분 제거 후 바로 이어붙임.
    # separator 없이 ""로 join — 원본 줄바꿈은 텍스트 내부에 이미 포함되어 있음.


@router.patch("/documents/{document_id}")
async def rename_document(
    document_id: str,
    req: RenameRequest,
    user: dict = Depends(get_current_user),
):
    """문서 이름 변경."""
    result = (
        supabase_admin.table("documents")
        .select("user_id")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if result.data["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다.")

    new_filename = req.filename.replace('\x00', '').strip()
    if not new_filename:
        raise HTTPException(status_code=400, detail="파일명이 비어 있습니다.")

    supabase_admin.table("documents").update({"filename": new_filename}).eq("id", document_id).execute()
    return {"message": "이름 변경 완료", "filename": new_filename}


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    """문서 삭제 — Storage 파일 + documents 테이블 (CASCADE로 chunks 자동 삭제)."""
    result = (
        supabase_admin.table("documents")
        .select("storage_path, user_id")
        .eq("id", document_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if result.data["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")

    storage_path = result.data.get("storage_path", "")
    # URL 문서는 storage_path가 http(s)://로 시작 → Storage 삭제 건너뜀
    is_url_doc = storage_path.startswith(("http://", "https://"))
    if storage_path and not is_url_doc:
        try:
            supabase_admin.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass

    supabase_admin.table("documents").delete().eq("id", document_id).execute()
    return {"message": "삭제 완료"}
