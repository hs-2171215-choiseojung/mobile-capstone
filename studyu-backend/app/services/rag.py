"""
RAG 파이프라인 (Supabase 영속 저장, pdfplumber + OpenAI)

문서 청크는 Supabase document_chunks 테이블에 저장되어
서버 재시작 / 배포 후에도 데이터가 유지됩니다.

임베딩 기반 유사도 검색:
  - 인덱싱 시 text-embedding-3-small로 청크 임베딩 생성 후 JSONB 컬럼에 저장
  - 쿼리 시 질문 임베딩과 코사인 유사도로 top-k 청크만 선택
  - document_chunks 테이블에 embedding JSONB 컬럼이 있어야 합니다:
      ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding JSONB;
"""

import io
import json
import re
import numpy as np
import pdfplumber
from openai import OpenAI
from app.core.config import settings
from app.core.supabase import supabase_admin

CHUNK_SIZE = 900
CHUNK_OVERLAP = 100
TOP_K = 5  # 문서당 검색할 최대 청크 수

# 이미지를 직접 가리키는 질문 패턴 — Python 레벨 사전 판단용
_IMAGE_DIRECT_REF_RE = re.compile(
    r'(이|저|그)\s+[가-힣]+'                      # 이 개, 저 꽃, 그 사람
    r'|이\s*(사진|이미지|그림|첨부|파일)'           # 이 사진, 이 이미지
    r'|사진\s*(속|에서|의|에|안)'                  # 사진 속, 사진에서
    r'|이미지\s*(속|에서|의|에|안)'
    r'|여기\s*(서|에|에서|나오는|에\s*있는)'
    r'|이것|저것|그것'
    r'|털\s*색|색상|색깔|무슨\s*색|어떤\s*색'      # 시각적 속성
    r'|외형|생김새|외모|모습|모양새',
    re.UNICODE,
)

_UNRELATED_IMG_PREFIX = "📌 이 질문은 업로드된 이미지와 직접적인 관련은 없지만, 알고 계시면 도움이 될 것 같아 답변드립니다."


# ─────────────────────────────────────────────
# 텍스트 정제
# ─────────────────────────────────────────────

def _sanitize(text: str) -> str:
    text = text.translate({0: None})
    text = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    text = text.encode('utf-8', errors='ignore').decode('utf-8')
    text = text.translate({0: None})
    return text


def _hard_sanitize(text: str) -> str:
    return "".join(ch for ch in text if ord(ch) != 0)


# ─────────────────────────────────────────────
# DB 안전 삽입
# ─────────────────────────────────────────────

def _db_safe_insert(table: str, records: list[dict]) -> None:
    """null byte가 절대 PostgREST에 전달되지 않도록 직접 HTTP로 삽입."""
    import httpx
    serialized = json.dumps(records, ensure_ascii=True)
    cleaned = serialized.replace('\\u0000', '')
    safe_records = json.loads(cleaned)

    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    batch_size = 50
    for i in range(0, len(safe_records), batch_size):
        batch_json = json.dumps(safe_records[i:i + batch_size], ensure_ascii=True).replace('\\u0000', '')
        print(f"[_db_safe_insert] batch {i//batch_size+1}, rows={min(batch_size, len(safe_records)-i)}")
        response = httpx.post(url, content=batch_json.encode('utf-8'), headers=headers, timeout=30)
        if response.status_code not in (200, 201):
            raise Exception(f"document_chunks insert 실패: {response.status_code} {response.text[:200]}")


# ─────────────────────────────────────────────
# 임베딩
# ─────────────────────────────────────────────

def _embed_batch(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    """OpenAI text-embedding-3-small으로 텍스트 임베딩 생성 (배치 처리)."""
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = client.embeddings.create(model="text-embedding-3-small", input=batch)
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings


def _cosine_similarity(query_vec: list[float], embeddings: list[list[float]]) -> np.ndarray:
    """query_vec과 embeddings 행렬의 코사인 유사도 벡터 반환."""
    q = np.array(query_vec, dtype=np.float32)
    m = np.array(embeddings, dtype=np.float32)
    q_norm = np.linalg.norm(q)
    m_norms = np.linalg.norm(m, axis=1)
    m_norms = np.where(m_norms == 0, 1e-10, m_norms)
    return (m @ q) / (m_norms * (q_norm if q_norm != 0 else 1e-10))


# ─────────────────────────────────────────────
# 파일 형식별 텍스트 추출
# ─────────────────────────────────────────────

def _extract_text_from_pdf(file_bytes: bytes) -> tuple[str, int]:
    """PDF에서 텍스트 추출. (text, page_count) 반환."""
    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            raw = page.extract_text() or ""
            text = _hard_sanitize(_sanitize(raw)).strip()
            if text:
                parts.append(text)
    return "\n\n".join(parts), page_count


def _extract_text_from_docx(file_bytes: bytes) -> tuple[str, int]:
    """DOCX에서 텍스트 추출. (text, 0) 반환."""
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    # 표 내용도 추출
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                paragraphs.append(row_text)
    return "\n".join(paragraphs), 0


def _extract_text_from_pptx(file_bytes: bytes) -> tuple[str, int]:
    """PPTX에서 텍스트 추출. (text, slide_count) 반환."""
    from pptx import Presentation
    prs = Presentation(io.BytesIO(file_bytes))
    slides_text: list[str] = []
    for slide in prs.slides:
        lines: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = " ".join(run.text for run in para.runs).strip()
                    if line:
                        lines.append(line)
        if lines:
            slides_text.append("\n".join(lines))
    return "\n\n".join(slides_text), len(prs.slides)


def _extract_text_from_hwpx(file_bytes: bytes) -> tuple[str, int]:
    """HWPX(zip 기반 XML)에서 텍스트 추출. (text, 0) 반환."""
    import zipfile
    from xml.etree import ElementTree as ET

    texts: list[str] = []
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        for name in sorted(z.namelist()):
            if "Contents" in name and name.endswith(".xml"):
                with z.open(name) as f:
                    try:
                        root = ET.fromstring(f.read())
                        for elem in root.iter():
                            if elem.text and elem.text.strip():
                                texts.append(elem.text.strip())
                    except Exception:
                        pass
    return "\n".join(texts), 0


def _extract_text_from_hwp(file_bytes: bytes) -> tuple[str, int]:
    """HWP 5.x (OLE 바이너리)에서 텍스트 추출. (text, 0) 반환."""
    import zlib
    import struct
    import olefile

    texts: list[str] = []
    try:
        ole = olefile.OleFileIO(io.BytesIO(file_bytes))
        section_idx = 0
        while True:
            section_name = f"BodyText/Section{section_idx:04d}"
            if not ole.exists(section_name):
                break
            stream_data = ole.openstream(section_name).read()
            try:
                decompressed = zlib.decompress(stream_data, -15)
            except Exception:
                decompressed = stream_data

            pos = 0
            while pos < len(decompressed):
                if pos + 4 > len(decompressed):
                    break
                header = struct.unpack_from("<I", decompressed, pos)[0]
                rec_type = header & 0x3FF
                size = (header >> 20) & 0xFFF
                if size == 0xFFF:
                    if pos + 8 > len(decompressed):
                        break
                    size = struct.unpack_from("<I", decompressed, pos + 4)[0]
                    pos += 8
                else:
                    pos += 4
                data = decompressed[pos: pos + size]
                pos += size
                # Record type 67 = 단락 텍스트
                if rec_type == 67 and data:
                    try:
                        text = data.decode("utf-16-le")
                        text = "".join(c for c in text if c.isprintable() or c in "\n\t ")
                        if text.strip():
                            texts.append(text.strip())
                    except Exception:
                        pass
            section_idx += 1
    except Exception as e:
        raise ValueError(f"HWP 파일을 읽을 수 없습니다: {e}")
    return "\n".join(texts), 0


def _extract_text_from_image(file_bytes: bytes, filename: str) -> tuple[str, int]:
    """이미지에서 GPT-4o Vision으로 텍스트/내용 + 구조화 메타데이터 추출.
    메타데이터는 [IMAGE_META]...[/IMAGE_META] 태그로 텍스트 앞에 삽입된다.
    Returns: (text_with_meta, 0)
    """
    import base64 as _base64
    ext = filename.lower().rsplit(".", 1)[-1]
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "gif": "image/gif", "webp": "image/webp"}
    mime_type = mime_map.get(ext, "image/jpeg")
    b64 = _base64.b64encode(file_bytes).decode("utf-8")

    prompt = """이 이미지를 분석하여 아래 JSON 형식으로 응답하세요.

{
  "subjects": ["이미지에 등장하는 주요 대상들 (사람, 동물, 사물, 장소, 브랜드, 개념 등)"],
  "image_type": "photo | chart | diagram | screenshot | document | illustration",
  "visual_context": "이미지 전체 상황을 한 문장으로 (예: 실내에서 후드를 입고 있는 소형 강아지)",
  "extracted_text": "이미지에 포함된 모든 텍스트를 그대로 추출 (없으면 빈 문자열)",
  "description": "이미지 내용을 시각적 요소 중심으로 상세히 설명 (수치, 색상, 구조, 레이아웃 포함)"
}

image_type 선택 기준:
- photo: 실제 사진 (인물, 동물, 풍경, 사물)
- chart: 데이터 차트, 그래프, 표
- diagram: 흐름도, 아키텍처, 마인드맵, 구조도
- screenshot: 컴퓨터 화면 캡처 (UI, 코드, 웹페이지)
- document: 스캔된 문서, 손글씨, 텍스트 위주 이미지
- illustration: 그림, 일러스트, 아이콘

반드시 JSON만 응답하세요."""

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}", "detail": "high"}},
            ],
        }],
        response_format={"type": "json_object"},
        max_tokens=2000,
    )

    raw = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {}

    subjects = parsed.get("subjects", [])
    image_type = parsed.get("image_type", "photo")
    visual_context = parsed.get("visual_context", "")
    extracted_text = parsed.get("extracted_text", "")
    description = parsed.get("description", "")

    # 메타데이터를 특수 태그로 인코딩하여 텍스트 앞에 삽입
    meta_json = json.dumps({
        "subjects": subjects,
        "image_type": image_type,
        "visual_context": visual_context,
    }, ensure_ascii=False)
    meta_block = f"[IMAGE_META]{meta_json}[/IMAGE_META]"

    body = "\n\n".join(filter(None, [extracted_text, description]))
    full_text = f"{meta_block}\n\n{body}" if body else meta_block

    return full_text, 0


def _extract_text_from_video(file_bytes: bytes, filename: str) -> tuple[str, int]:
    """비디오/오디오에서 OpenAI Whisper로 STT. (text, 0) 반환."""
    import tempfile
    import os
    ext = filename.lower().rsplit(".", 1)[-1]
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as f:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )
        text = response if isinstance(response, str) else getattr(response, "text", "")
        return text, 0
    finally:
        os.unlink(tmp_path)


# ─────────────────────────────────────────────
# 인덱싱 (공통)
# ─────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {
    "pdf", "docx", "pptx", "ppt", "hwp", "hwpx",
    "jpg", "jpeg", "png", "gif", "webp",
    "mp4", "mov", "avi", "mkv", "webm", "mp3", "m4a",
}

VIDEO_AUDIO_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "webm", "mp3", "m4a"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}


def ingest_document(file_bytes: bytes, doc_id: str, filename: str = "") -> tuple[int, int]:
    """파일을 청크로 분할하고 임베딩을 포함하여 Supabase에 저장.

    Returns:
        (chunk_count, page_count)
    """
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "pdf"

    if ext == "pdf":
        text, page_count = _extract_text_from_pdf(file_bytes)
    elif ext == "docx":
        text, page_count = _extract_text_from_docx(file_bytes)
    elif ext in ("pptx", "ppt"):
        text, page_count = _extract_text_from_pptx(file_bytes)
    elif ext == "hwpx":
        text, page_count = _extract_text_from_hwpx(file_bytes)
    elif ext == "hwp":
        text, page_count = _extract_text_from_hwp(file_bytes)
    elif ext in IMAGE_EXTENSIONS:
        text, page_count = _extract_text_from_image(file_bytes, filename)
    elif ext in VIDEO_AUDIO_EXTENSIONS:
        text, page_count = _extract_text_from_video(file_bytes, filename)
    else:
        raise ValueError(f"지원하지 않는 파일 형식: .{ext}")

    text = _hard_sanitize(_sanitize(text)).strip()
    if not text:
        return 0, page_count

    # 비디오/오디오 파일은 청크 앞에 전사(STT) 태그를 붙여 AI가 인식할 수 있게 함
    is_video_audio = ext in VIDEO_AUDIO_EXTENSIONS

    chunks: list[str] = []
    step = CHUNK_SIZE - CHUNK_OVERLAP
    for i in range(0, len(text), step):
        chunk = _hard_sanitize(_sanitize(text[i: i + CHUNK_SIZE]))
        if chunk.strip():
            if is_video_audio:
                chunk = f"[음성 전사 내용 - {filename}]\n{chunk}"
            chunks.append(chunk)

    if not chunks:
        return 0, page_count

    # 임베딩 생성
    try:
        embeddings = _embed_batch(chunks)
    except Exception as e:
        print(f"[WARNING] 임베딩 생성 실패, 임베딩 없이 저장: {e}")
        embeddings = [None] * len(chunks)  # type: ignore

    records = [
        {
            "doc_id": doc_id,
            "chunk_index": idx,
            "content": _hard_sanitize(content),
            "embedding": emb,
        }
        for idx, (content, emb) in enumerate(zip(chunks, embeddings))
    ]

    _db_safe_insert("document_chunks", records)
    print(f"[INFO] ingest_document: {len(records)} chunks 저장 완료 ({ext})")
    return len(chunks), page_count


# ─────────────────────────────────────────────
# 인덱싱 (URL)
# ─────────────────────────────────────────────

def _extract_youtube_video_id(url: str) -> str | None:
    """YouTube URL에서 video ID 추출. 아니면 None."""
    import re
    patterns = [
        r"(?:youtube\.com/watch\?.*v=|youtu\.be/)([A-Za-z0-9_-]{11})",
        r"youtube\.com/embed/([A-Za-z0-9_-]{11})",
        r"youtube\.com/shorts/([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None


def _fetch_youtube_transcript(video_id: str) -> str:
    """youtube_transcript_api로 자막 텍스트 추출 (한국어 → 영어 순)."""
    from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
    api = YouTubeTranscriptApi()
    try:
        transcript = api.fetch(video_id, languages=["ko", "ko-KR", "en", "en-US"])
    except NoTranscriptFound:
        try:
            transcript_list = api.list(video_id)
            # 자동 생성 포함 아무 언어나
            for t in transcript_list:
                transcript = api.fetch(video_id, languages=[t.language_code])
                break
            else:
                raise ValueError("유튜브 영상에 자막이 없습니다.")
        except TranscriptsDisabled:
            raise ValueError("이 유튜브 영상은 자막이 비활성화되어 있습니다.")
    except TranscriptsDisabled:
        raise ValueError("이 유튜브 영상은 자막이 비활성화되어 있습니다.")

    text = " ".join(s.text.replace("\n", " ") for s in transcript.snippets)
    return text.strip()


def ingest_url(url: str, doc_id: str) -> tuple[int, int]:
    """URL에서 텍스트를 추출하여 임베딩과 함께 Supabase document_chunks에 저장.

    Returns:
        (chunk_count, 0)
    Raises:
        ValueError: URL 접근 실패 또는 텍스트 부족
    """
    import httpx

    # ── YouTube 처리 ──
    video_id = _extract_youtube_video_id(url)
    if video_id:
        try:
            text = _fetch_youtube_transcript(video_id)
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"유튜브 자막 추출 실패: {str(e)}")
    else:
        # ── 일반 웹페이지 처리 ──
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
        }

        try:
            response = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
            response.raise_for_status()
            html_content = response.text
        except httpx.HTTPStatusError as e:
            raise ValueError(f"URL 접근 실패 (HTTP {e.response.status_code}): 접근이 제한된 페이지일 수 있습니다.")
        except Exception as e:
            raise ValueError(f"URL을 가져오는 데 실패했습니다: {str(e)}")

        from bs4 import BeautifulSoup
        from urllib.parse import urljoin, urlparse

        def _extract_meta(html: str) -> str:
            try:
                soup = BeautifulSoup(html, "html.parser")
                parts = []
                title = soup.find("title")
                if title and title.get_text(strip=True):
                    parts.append(title.get_text(strip=True))
                for attr in [("name", "description"), ("property", "og:description"),
                              ("property", "og:title"), ("name", "keywords")]:
                    tag = soup.find("meta", attrs={attr[0]: attr[1]})
                    if tag and tag.get("content", "").strip():
                        parts.append(tag["content"].strip())
                return "\n".join(parts)
            except Exception:
                return ""

        def _extract_body(html: str, referer: str = "") -> str:
            """HTML에서 본문 텍스트 추출. trafilatura → 콘텐츠 셀렉터 → p태그 → 전체 순."""
            text = ""
            try:
                import trafilatura
                text = trafilatura.extract(html, include_tables=True, favor_recall=True) or ""
            except Exception:
                pass

            if len(text.strip()) < 100:
                try:
                    soup = BeautifulSoup(html, "html.parser")
                    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "menu"]):
                        tag.decompose()

                    content_text = ""
                    for selector in [
                        # Naver blog
                        ".se-main-container", "#postViewArea", ".se_component_wrap",
                        # 일반
                        "article", "main", "[role='main']",
                        ".content", "#content", ".post", ".article",
                        ".entry-content", "#article-body", ".post-content",
                        # Tistory
                        ".tt_article_useless_p_margin", "#article-view",
                    ]:
                        nodes = soup.select(selector)
                        if nodes:
                            content_text = "\n".join(n.get_text(separator="\n", strip=True) for n in nodes)
                            if len(content_text) > 200:
                                break

                    if len(content_text) < 200:
                        paragraphs = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 20]
                        content_text = "\n".join(paragraphs)

                    if len(content_text) < 200:
                        content_text = soup.get_text(separator="\n", strip=True)

                    if len(content_text) > len(text):
                        text = content_text
                except Exception:
                    pass

            return text.strip()

        def _follow_iframe(html: str, base_url: str, req_headers: dict) -> str:
            """페이지에 iframe이 있으면 그 내용을 가져와 본문 추출."""
            try:
                soup = BeautifulSoup(html, "html.parser")
                for iframe in soup.find_all("iframe"):
                    src = iframe.get("src", "")
                    if not src or src.startswith("javascript"):
                        continue
                    iframe_url = urljoin(base_url, src)
                    # 같은 도메인 또는 신뢰 도메인만
                    base_host = urlparse(base_url).netloc
                    iframe_host = urlparse(iframe_url).netloc
                    if base_host not in iframe_host and iframe_host not in base_host:
                        continue
                    try:
                        iframe_resp = httpx.get(
                            iframe_url,
                            headers={**req_headers, "Referer": base_url},
                            timeout=20,
                            follow_redirects=True,
                        )
                        if iframe_resp.status_code == 200:
                            t = _extract_body(iframe_resp.text, referer=base_url)
                            if len(t) > 100:
                                return t
                    except Exception:
                        continue
            except Exception:
                pass
            return ""

        meta_text = _extract_meta(html_content)

        # 1. 본문 직접 추출
        text = _extract_body(html_content)

        # 2. 짧으면 iframe 추적
        if len(text) < 100:
            iframe_text = _follow_iframe(html_content, url, headers)
            if len(iframe_text) > len(text):
                text = iframe_text

        # 3. 여전히 짧으면 trafilatura.fetch_url 재시도
        if len(text) < 100:
            try:
                import trafilatura
                downloaded = trafilatura.fetch_url(url)
                if downloaded:
                    t2 = trafilatura.extract(downloaded, favor_recall=True) or ""
                    if len(t2) > len(text):
                        text = t2
            except Exception:
                pass

        # 메타 정보 결합
        if meta_text:
            text = (meta_text + "\n\n" + text).strip()

    text = _hard_sanitize(_sanitize(text)).strip()
    if len(text) < 50:
        raise ValueError(
            "URL에서 충분한 텍스트를 추출할 수 없습니다. "
            "로그인이 필요하거나, JavaScript로 렌더링되거나, 스크래핑을 차단하는 페이지일 수 있습니다. "
            f"(추출된 텍스트: {len(text)}자)"
        )

    # 청킹
    chunks: list[str] = []
    step = CHUNK_SIZE - CHUNK_OVERLAP
    for i in range(0, len(text), step):
        chunk = _hard_sanitize(_sanitize(text[i: i + CHUNK_SIZE]))
        if chunk.strip():
            chunks.append(chunk)

    if not chunks:
        raise ValueError("텍스트 청킹 실패")

    # 임베딩 생성
    try:
        embeddings = _embed_batch(chunks)
    except Exception as e:
        print(f"[WARNING] 임베딩 생성 실패, 임베딩 없이 저장: {e}")
        embeddings = [None] * len(chunks)  # type: ignore

    records = [
        {
            "doc_id": doc_id,
            "chunk_index": idx,
            "content": content,
            "embedding": emb,
        }
        for idx, (content, emb) in enumerate(zip(chunks, embeddings))
    ]
    _db_safe_insert("document_chunks", records)
    print(f"[INFO] ingest_url: {len(records)} chunks 저장 완료")
    return len(chunks), 0


# ─────────────────────────────────────────────
# 컨텍스트 조회
# ─────────────────────────────────────────────

def _get_context_semantic(
    doc_ids: list[str],
    question: str,
    top_k: int = TOP_K,
    labeled: bool = False,
) -> str:
    """임베딩 기반 코사인 유사도로 각 문서에서 top-k 청크를 선택하여 컨텍스트 구성."""
    if not doc_ids or not question:
        return _get_context(doc_ids)

    # 질문 임베딩
    try:
        query_embedding = _embed_batch([question])[0]
    except Exception as e:
        print(f"[WARNING] 질문 임베딩 실패, 순차 검색으로 fallback: {e}")
        return _get_context(doc_ids, labeled=labeled)

    # 문서명 조회
    doc_name_map: dict[str, str] = {}
    if labeled:
        try:
            name_result = supabase_admin.table("documents").select("id, filename").in_("id", doc_ids).execute()
            doc_name_map = {row["id"]: row["filename"] for row in name_result.data}
        except Exception:
            pass

    parts: list[str] = []

    for doc_id in doc_ids:
        # 해당 문서의 청크 + 임베딩 조회
        try:
            result = (
                supabase_admin.table("document_chunks")
                .select("content, embedding, chunk_index")
                .eq("doc_id", doc_id)
                .order("chunk_index")
                .execute()
            )
        except Exception:
            continue

        rows = result.data
        if not rows:
            continue

        # 임베딩이 있는 행만 유사도 검색, 없으면 순서대로
        rows_with_emb = [r for r in rows if r.get("embedding")]
        if rows_with_emb:
            embeddings = [r["embedding"] for r in rows_with_emb]
            scores = _cosine_similarity(query_embedding, embeddings)
            top_indices = np.argsort(scores)[::-1][:top_k]
            selected_chunks = [rows_with_emb[i]["content"] for i in top_indices]
            # 원래 chunk_index 순서로 정렬
            selected_with_idx = sorted(
                [(rows_with_emb[i]["chunk_index"], rows_with_emb[i]["content"]) for i in top_indices],
                key=lambda x: x[0],
            )
            selected_chunks = [c for _, c in selected_with_idx]
        else:
            # 임베딩 없으면 앞에서 top_k개
            selected_chunks = [r["content"] for r in rows[:top_k]]

        if not selected_chunks:
            continue

        doc_text = "\n\n".join(selected_chunks)
        if labeled:
            doc_name = doc_name_map.get(doc_id, doc_id)
            parts.append(f"[문서명: {doc_name}]\n{doc_text}")
        else:
            parts.append(doc_text)

    separator = "\n\n=====\n\n" if labeled else "\n\n"
    return separator.join(parts)


def _get_context(doc_ids: list[str], max_chars: int = 10000, labeled: bool = False) -> str:
    """순차적으로 청크를 가져와 컨텍스트 문자열 반환 (임베딩 없는 fallback)."""
    if not doc_ids:
        return ""

    if labeled:
        # 문서별 레이블 붙이기
        try:
            name_result = supabase_admin.table("documents").select("id, filename").in_("id", doc_ids).execute()
            doc_name_map = {row["id"]: row["filename"] for row in name_result.data}
        except Exception:
            doc_name_map = {}

        parts = []
        per_doc_chars = max_chars // max(len(doc_ids), 1)
        for doc_id in doc_ids:
            result = (
                supabase_admin.table("document_chunks")
                .select("content")
                .eq("doc_id", doc_id)
                .order("chunk_index")
                .execute()
            )
            chunks = [row["content"] for row in result.data]
            if not chunks:
                continue
            doc_text = "\n\n".join(chunks)[:per_doc_chars]
            doc_name = doc_name_map.get(doc_id, doc_id)
            parts.append(f"[문서명: {doc_name}]\n{doc_text}")
        return "\n\n=====\n\n".join(parts)

    result = (
        supabase_admin.table("document_chunks")
        .select("content")
        .in_("doc_id", doc_ids)
        .order("doc_id")
        .order("chunk_index")
        .execute()
    )
    chunks = [row["content"] for row in result.data]
    return "\n\n".join(chunks)[:max_chars]


def _get_filenames(doc_ids: list[str]) -> list[str]:
    if not doc_ids:
        return []
    result = supabase_admin.table("documents").select("filename").in_("id", doc_ids).execute()
    return [row["filename"] for row in result.data]


# ─────────────────────────────────────────────
# 챗
# ─────────────────────────────────────────────

LEVEL_PROMPTS = {
    "beginner": "쉽고 친절하게, 예시를 들어 입문자 수준으로 설명해주세요.",
    "intermediate": "핵심 개념 위주로 중급 학습자에게 적합하게 설명해주세요.",
    "advanced": "심화 분석과 비판적 관점을 포함하여 전문가 수준으로 설명해주세요.",
}


_IMAGE_MIME_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "png": "image/png", "gif": "image/gif", "webp": "image/webp",
}

def _get_image_docs(doc_ids: list[str]) -> list[dict]:
    """doc_ids 중 이미지 파일인 것의 메타데이터 반환.
    반환: [{"doc_id", "filename", "storage_path", "mime_type"}]
    """
    if not doc_ids:
        return []
    result = supabase_admin.table("documents") \
        .select("id, filename, storage_path") \
        .in_("id", doc_ids).execute()
    image_docs = []
    for row in result.data:
        fn = row.get("filename", "")
        ext = fn.lower().rsplit(".", 1)[-1] if "." in fn else ""
        if ext in IMAGE_EXTENSIONS and row.get("storage_path"):
            image_docs.append({
                "doc_id": row["id"],
                "filename": fn,
                "storage_path": row["storage_path"],
                "mime_type": _IMAGE_MIME_MAP.get(ext, "image/jpeg"),
            })
    return image_docs


def _check_image_relevance(question: str, subjects: list[str], visual_context: str) -> bool:
    """질문이 이미지 대상/내용과 관련 있는지 YES/NO로 판단. 관련 있으면 True."""
    # ── Python 사전 판단 (API 호출 없음) ──────────────
    # 지시어("이 개", "이 사진" 등) 또는 시각적 속성 키워드가 있으면 무조건 관련 있음
    if _IMAGE_DIRECT_REF_RE.search(question):
        return True
    # 메타데이터 없으면 관련 있다고 가정 (안전 기본값)
    if not subjects and not visual_context:
        return True

    subjects_str = ", ".join(subjects) if subjects else "불명확"
    prompt = f"""이미지 정보:
- 등장 대상: {subjects_str}
- 상황: {visual_context}

사용자 질문: "{question}"

판단 기준:
관련 있음(YES): 아래 중 하나라도 해당
  - 이미지 대상의 외형·색상·자세·표정·크기 등 시각적 속성
  - 이미지를 직접 가리키는 표현 ("이 개", "이 사진", "여기서" 등)
  - 이미지 대상의 특성·습성·행동·수명·먹이 등 관련 지식
  - 이미지 대상이 입고 있는 것, 들고 있는 것, 주변 환경
  - 이미지 주제와 맥락적으로 연결되는 배경지식
  - 판단이 애매한 경우

관련 없음(NO): 이미지 속 어떤 대상과도 완전히 무관한 다른 주제
  (예: 개 사진 → "파이썬 코드 짜줘" / 음식 사진 → "주식 투자 알려줘")

"YES" 또는 "NO"만 대답하세요."""

    try:
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=5,
            temperature=0,
        )
        answer = (response.choices[0].message.content or "YES").strip().upper()
        return answer != "NO"
    except Exception:
        return True  # 오류 시 관련 있다고 가정


def _get_image_metadata(doc_ids: list[str]) -> dict[str, dict]:
    """doc_ids에 해당하는 이미지 메타데이터를 청크에서 파싱해 반환.
    반환: {doc_id: {"subjects": [...], "image_type": "...", "visual_context": "..."}}
    """
    if not doc_ids:
        return {}
    import re
    result = supabase_admin.table("document_chunks") \
        .select("doc_id, content") \
        .in_("doc_id", doc_ids) \
        .execute()
    meta: dict[str, dict] = {}
    for row in result.data:
        doc_id = row["doc_id"]
        content = row.get("content", "")
        m = re.search(r"\[IMAGE_META\](.*?)\[/IMAGE_META\]", content, re.DOTALL)
        if m and doc_id not in meta:
            try:
                meta[doc_id] = json.loads(m.group(1))
            except Exception:
                pass
    return meta


def _download_image_b64(storage_path: str) -> bytes | None:
    """Supabase Storage에서 이미지를 다운로드해 bytes 반환. 실패 시 None."""
    try:
        return supabase_admin.storage.from_("documents").download(storage_path)
    except Exception:
        return None


def chat_with_docs(
    doc_ids: list[str],
    question: str,
    model: str = "gpt-4o-mini",
    level: str = "intermediate",
    chat_history: list | None = None,
) -> tuple[str, list[str]]:
    """문서 기반 RAG 질의응답. (answer, sources) 반환."""
    import base64

    is_multi = len(doc_ids) > 1
    level_hint = LEVEL_PROMPTS.get(level, LEVEL_PROMPTS["intermediate"])
    doc_filenames = _get_filenames(doc_ids)

    # ── 이미지 문서 처리 ──────────────────────────
    image_docs = _get_image_docs(doc_ids)
    img_meta_map = _get_image_metadata([img["doc_id"] for img in image_docs])
    non_image_ids = [
        d for d in doc_ids
        if d not in {img["doc_id"] for img in image_docs}
    ]
    has_images = len(image_docs) > 0
    has_non_image = len(non_image_ids) > 0

    # 이미지 base64 수집
    image_parts: list[dict] = []
    for img in image_docs:
        raw = _download_image_b64(img["storage_path"])
        if raw:
            b64 = base64.b64encode(raw).decode("utf-8")
            image_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{img['mime_type']};base64,{b64}", "detail": "high"},
            })

    # ── 컨텍스트 구성 ─────────────────────────────
    context_ids = non_image_ids if has_non_image else doc_ids
    context = _get_context_semantic(context_ids, question, top_k=TOP_K, labeled=is_multi) if context_ids else ""

    # 비디오/오디오 여부
    has_video = any(
        name.lower().rsplit(".", 1)[-1] in VIDEO_AUDIO_EXTENSIONS
        for name in doc_filenames if "." in name
    )
    video_note = (
        "\n\n중요: 비디오 또는 오디오 파일이 포함되어 있습니다. "
        "[음성 전사 내용 - 파일명] 태그가 붙은 내용은 해당 영상/음성의 음성을 텍스트로 변환한 것입니다."
        if has_video else ""
    )

    # ── 이미지 타입별 분석 가이드 ─────────────────
    IMAGE_TYPE_GUIDE = {
        "photo": "피사체의 외형·행동·감정을 묘사하고, 배경과 전체적인 분위기도 언급하세요.",
        "chart": "축 레이블, 데이터 값, 단위, 추세, 최댓값·최솟값을 정확히 언급하세요. 수치는 반드시 이미지에서 보이는 그대로 인용하세요.",
        "diagram": "각 구성 요소의 이름·역할과 요소 간 관계·흐름 방향을 순서대로 설명하세요.",
        "screenshot": "화면에 보이는 UI 요소, 코드, 오류 메시지, 설정 값을 그대로 인용하고 기술적으로 분석하세요.",
        "document": "문서에 적힌 텍스트를 정확히 인용하고, 문서의 구조(제목·항목·서명 등)를 설명하세요.",
        "illustration": "그림의 스타일, 색상, 표현하는 개념이나 메시지를 설명하세요.",
    }

    # ── 시스템 프롬프트 ───────────────────────────
    if has_images and not has_non_image:
        # 이미지 전용 모드 — 메타데이터로 subjects·type 주입
        image_names = ", ".join(f"'{img['filename']}'" for img in image_docs)

        # 모든 이미지의 subjects 통합
        all_subjects: list[str] = []
        all_types: list[str] = []
        for img in image_docs:
            meta = img_meta_map.get(img["doc_id"], {})
            all_subjects.extend(meta.get("subjects", []))
            if meta.get("image_type"):
                all_types.append(meta["image_type"])
            # visual_context를 context에 보조로 추가
        subjects_str = ", ".join(dict.fromkeys(all_subjects)) or "파악 중"
        primary_type = all_types[0] if all_types else "photo"
        type_guide = IMAGE_TYPE_GUIDE.get(primary_type, IMAGE_TYPE_GUIDE["photo"])

        # 관련성 사전 체크 (답변 생성과 완전히 분리)
        visual_context = ""
        for img in image_docs:
            meta = img_meta_map.get(img["doc_id"], {})
            if meta.get("visual_context"):
                visual_context = meta["visual_context"]
                break
        is_related = _check_image_relevance(question, all_subjects, visual_context)

        system_msg = f"""당신은 이미지를 깊이 분석하는 전문 비주얼 학습 튜터입니다.
첨부된 이미지({image_names})를 직접 보고 질문에 성실히 답변하세요.

【이미지 정보】
- 유형: {primary_type}
- 등장 대상: {subjects_str}

【{primary_type} 유형 분석 원칙】
{type_guide}
불명확한 부분은 "이미지에서 명확히 확인되지 않습니다"라고 솔직히 말하세요.

답변 시 {level_hint}"""
        if context:
            system_msg += f"\n\n【보조 참고 — 이미지 사전 추출 내용】\n<context>\n{context}\n</context>"
        if not is_related:
            system_msg += '\n\n【출력 형식】답변 맨 앞에 반드시 이 문장을 먼저 쓰세요: "📌 이 질문은 업로드된 이미지와 직접적인 관련은 없지만, 알고 계시면 도움이 될 것 같아 답변드립니다."'

    elif has_images and has_non_image:
        # 혼합 모드 (이미지 + 다른 문서)
        names_str = ", ".join(f"'{n}'" for n in doc_filenames)
        system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
총 {len(doc_ids)}개의 자료({names_str})가 제공됩니다. 이미지는 직접 확인하고, 문서는 아래 컨텍스트를 참조하세요.
이미지와 문서 내용을 통합하여 종합적으로 답변하세요.
답변 시 {level_hint}{video_note}

<context>
{context}
</context>"""

    elif is_multi:
        names_str = ", ".join(f"'{n}'" for n in doc_filenames)
        system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
총 {len(doc_ids)}개의 문서({names_str})가 제공됩니다.
반드시 각 문서를 모두 참조하여 답변하세요.
'**[문서명]** 에서는 ~', '**[문서명]** 에 따르면 ~' 형식으로 각 문서의 내용을 명확히 구분하여 서술하세요.
답변 시 {level_hint}
제공된 문서 내용에서 최대한 찾아서 답변하세요.{video_note}

<context>
{context}
</context>"""

    else:
        system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
아래 문서 내용을 바탕으로 질문에 답변하세요.
답변 시 {level_hint}
제공된 문서 내용에서 최대한 찾아서 답변하세요. 정말로 알 수 없을 때만 "문서에서 찾을 수 없습니다"라고 하세요.{video_note}

<context>
{context}
</context>"""

    # ── 메시지 구성 ───────────────────────────────
    messages: list[dict] = [{"role": "system", "content": system_msg}]

    if chat_history:
        for msg in chat_history[-6:]:
            # 히스토리에 이미지가 포함된 경우 텍스트만 유지 (토큰 절약)
            if isinstance(msg.get("content"), list):
                text_only = " ".join(
                    p.get("text", "") for p in msg["content"] if p.get("type") == "text"
                )
                messages.append({"role": msg["role"], "content": text_only})
            else:
                messages.append(msg)

    # 이미지가 있으면 multimodal user message
    if image_parts:
        user_content: list[dict] = [{"type": "text", "text": question}] + image_parts
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": question})

    # 이미지가 있으면 Vision 지원 모델 강제
    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    if image_parts and safe_model == "gpt-4o-mini":
        safe_model = "gpt-4o-mini"  # gpt-4o-mini도 vision 지원
    elif image_parts and "gpt-4o" not in safe_model:
        safe_model = "gpt-4o"

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=messages,  # type: ignore
        temperature=0.3,
        max_tokens=2000,
    )
    answer = response.choices[0].message.content or ""

    # ── 이미지 직접 참조 질문에서 잘못 붙은 📌 제거 ──
    if has_images and _IMAGE_DIRECT_REF_RE.search(question):
        if answer.lstrip().startswith("📌"):
            lines = answer.split("\n")
            filtered = []
            skip_blank = False
            for line in lines:
                if line.lstrip().startswith("📌 이 질문은 업로드된"):
                    skip_blank = True
                    continue
                if skip_blank and line.strip() == "":
                    skip_blank = False
                    continue
                filtered.append(line)
                skip_blank = False
            answer = "\n".join(filtered).lstrip()

    sources = _get_filenames(doc_ids)
    return answer, sources


# ─────────────────────────────────────────────
# 콘텐츠 생성
# ─────────────────────────────────────────────

def generate_content(
    doc_ids: list[str],
    gen_type: str,
    model: str = "gpt-4o-mini",
    level: str = "intermediate",
    quiz_count: int = 5,
    topic: str = "",
    difficulty: str = "intermediate",
) -> str:
    """요약 / 퀴즈 / 학습 계획 생성. 결과 문자열 반환."""
    context = _get_context(doc_ids, max_chars=10000)

    level_map = {"beginner": "입문", "intermediate": "중급", "advanced": "심화"}
    difficulty_map = {"easy": "쉬운", "intermediate": "중간", "hard": "어려운"}
    level_ko = level_map.get(level, "중급")
    difficulty_ko = difficulty_map.get(difficulty, "중간")

    if gen_type == "summary":
        prompt = f"""아래는 학습 문서의 내용입니다.
이 내용을 바탕으로 핵심 개념과 주요 내용을 {level_ko} 수준에 맞게 요약해주세요.
마크다운 형식으로 작성해주세요.

문서 내용:
{context}"""

    elif gen_type == "quiz":
        topic_instruction = (
            f"특히 '{topic}' 주제와 관련된 내용으로 퀴즈를 만들어주세요." if topic else ""
        )
        prompt = f"""아래는 학습 문서의 내용입니다.
이 내용을 바탕으로 {difficulty_ko} 난이도의 4지선다 퀴즈 {quiz_count}개를 만들어주세요.
{topic_instruction}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:

{{
  "title": "문서 핵심 내용을 반영한 구체적인 퀴즈 제목",
  "questions": [
    {{
      "id": 1,
      "question": "질문 내용",
      "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
      "answerIndex": 0,
      "hint": "정답을 직접 언급하지 않고 방향만 제시하는 힌트",
      "explanation": "정답인 이유를 설명하는 해설"
    }}
  ]
}}

규칙:
- answerIndex는 정답 options의 0부터 시작하는 인덱스
- options는 반드시 4개
- hint는 정답을 직접 언급하지 말 것
- questions 배열에 정확히 {quiz_count}개의 항목 포함
- title은 문서 내용을 구체적으로 반영할 것

문서 내용:
{context}"""

    elif gen_type == "plan":
        prompt = f"""아래는 학습 문서의 내용입니다.
이 내용을 바탕으로 {level_ko} 학습자를 위한 주간 학습 계획을 작성해주세요.
마크다운 형식으로 Day별 목표와 학습 내용을 구체적으로 작성해주세요.

문서 내용:
{context}"""

    else:
        raise ValueError(f"Unknown gen_type: {gen_type}")

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    create_kwargs: dict = {
        "model": safe_model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
    }
    if gen_type == "quiz":
        create_kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**create_kwargs)
    return response.choices[0].message.content or ""


def generate_audio_overview(
    doc_ids: list[str],
    fmt: str = "deep_analysis",
    language: str = "ko",
    length: str = "default",
    focus: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[bytes, str, str]:
    """2인 토크쇼 형식의 오디오 오버뷰 생성."""
    context = _get_context(doc_ids, max_chars=12000)

    length_map = {
        "short": "짧게 (10~14줄 대화)",
        "default": "충분히 (18~26줄 대화)",
    }
    length_desc = length_map.get(length, length_map["default"])

    format_map = {
        "deep_analysis": "두 호스트가 생동감 있게 주고받는 심층 분석 대화. 소스의 주제를 깊이 분석하고 서로 다른 관점을 연결합니다.",
        "summary": "소스의 핵심 아이디어를 빠르게 파악할 수 있도록 간결하게 요약하는 대화.",
        "critique": "소스에 대한 전문가적 시각의 비평 대화. 장단점과 개선점을 건설적으로 논의합니다.",
        "debate": "소스와 관련한 주제로 두 호스트가 서로 다른 입장을 가지고 논쟁하는 토론.",
    }
    format_desc = format_map.get(fmt, format_map["deep_analysis"])

    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")
    focus_instruction = f"\n특히 다음 부분에 집중해주세요: {focus}" if focus.strip() else ""

    prompt = f"""아래 문서 내용을 바탕으로 팟캐스트 스타일의 오디오 오버뷰 스크립트를 {lang_label}로 작성해주세요.

형식: {format_desc}
길이: {length_desc}{focus_instruction}

규칙:
- Host A와 Host B 두 사람이 자연스럽게 대화합니다
- 각 발화는 짧고 자연스럽게 (1~3문장)
- 인사 없이 바로 핵심 주제로 시작
- "그렇군요", "맞아요", "흥미롭네요" 같은 자연스러운 리액션 포함
- 청취자가 이해하기 쉽게 전문 용어는 설명 포함

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "오디오 오버뷰 제목",
  "lines": [
    {{"speaker": "A", "text": "말할 내용"}},
    {{"speaker": "B", "text": "응답 내용"}}
  ]
}}"""

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "오디오 오버뷰")
    lines: list[dict] = result.get("lines", [])

    script = "\n".join(
        f"{'Host A' if l.get('speaker') == 'A' else 'Host B'}: {l.get('text', '')}"
        for l in lines
    )

    voice_map = {"A": "alloy", "B": "echo"}
    audio_parts: list[bytes] = []
    for line in lines:
        text = line.get("text", "").strip()
        if not text:
            continue
        voice = voice_map.get(line.get("speaker", "A"), "alloy")
        tts_resp = client.audio.speech.create(
            model="tts-1",
            voice=voice,  # type: ignore[arg-type]
            input=text,
            response_format="mp3",
        )
        audio_parts.append(tts_resp.content)

    audio_bytes = b"".join(audio_parts)
    return audio_bytes, script, title


def generate_mindmap(
    doc_ids: list[str],
    language: str = "ko",
    focus: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[list, str]:
    """문서 내용을 평면 노드 배열 형식의 마인드맵 JSON으로 변환."""
    context = _get_context(doc_ids, max_chars=10000)

    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")
    focus_instruction = f"\n특히 다음 주제에 집중해주세요: {focus}" if focus.strip() else ""

    prompt = f"""아래 문서 내용을 바탕으로 학습용 마인드맵을 {lang_label}로 작성해주세요.{focus_instruction}

규칙:
- 루트 노드는 문서의 핵심 주제
- 2~4개의 1단계 브랜치 (주요 개념)
- 각 브랜치에 2~4개의 2단계 노드 (세부 내용)
- 필요시 3단계 노드 추가 가능
- 각 노드는 짧고 핵심적인 텍스트 (10단어 이내)

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "마인드맵 제목",
  "nodes": [
    {{"id": "root", "text": "중심 주제"}},
    {{"id": "1", "text": "브랜치 1", "parent": "root"}},
    {{"id": "1-1", "text": "세부 내용 1", "parent": "1"}},
    {{"id": "1-2", "text": "세부 내용 2", "parent": "1"}},
    {{"id": "2", "text": "브랜치 2", "parent": "root"}},
    {{"id": "2-1", "text": "세부 내용 1", "parent": "2"}}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.5,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "마인드맵")
    nodes = result.get("nodes", [{"id": "root", "text": title}])
    return nodes, title


def generate_flashcards(
    doc_ids: list[str],
    count: str = "standard",
    difficulty: str = "intermediate",
    topic: str = "",
    language: str = "ko",
    model: str = "gpt-4o-mini",
) -> tuple[list, str]:
    """문서 내용을 바탕으로 플래시카드(앞면/뒷면) 배열을 생성.

    Returns:
        (cards_list, title)
        cards_list: [{"front": "용어/개념", "back": "설명", "hint": "힌트(선택)"}]
    """
    count_map = {"fewer": 10, "standard": 20, "more": 40}
    card_count = count_map.get(count, 20)

    difficulty_map = {"easy": "쉬운", "intermediate": "보통", "hard": "어려운"}
    difficulty_ko = difficulty_map.get(difficulty, "보통")

    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")

    topic_instruction = f"\n특히 '{topic}' 주제와 관련된 카드를 만들어주세요." if topic.strip() else ""
    context = _get_context(doc_ids, max_chars=10000)

    prompt = f"""아래 문서 내용을 바탕으로 {difficulty_ko} 난이도의 학습용 플래시카드 {card_count}개를 {lang_label}로 만들어주세요.{topic_instruction}

플래시카드 규칙:
- 앞면(front): 핵심 용어, 개념 또는 질문 (짧고 명확하게)
- 뒷면(back): 앞면에 대한 설명, 정의 또는 답변 (이해하기 쉽게)
- 힌트(hint): 정답을 직접 언급하지 않고 방향만 제시 (선택사항)
- 내용이 점점 어려워지도록 순서를 정렬해주세요

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "플래시카드 세트 제목",
  "cards": [
    {{
      "front": "앞면 내용 (질문 또는 용어)",
      "back": "뒷면 내용 (답변 또는 설명)",
      "hint": "힌트 (선택, 없으면 빈 문자열)"
    }}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.4,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "플래시카드")
    cards = result.get("cards", [])
    return cards, title


def generate_slides(
    doc_ids: list[str],
    format: str = "presenter",
    length: str = "default",
    language: str = "ko",
    prompt: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[list, str, str]:
    """문서 내용을 바탕으로 슬라이드 자료(JSON)를 생성.

    Returns:
        (slides_list, title, cover_image_b64)
        slides_list: [{"title": "슬라이드 제목", "bullets": ["내용1", "내용2"], "speaker_notes": "발표자 노트", "layout": "title|content|two_column"}]
        cover_image_b64: 표지 이미지 base64 문자열 (DALL-E 3)
    """
    length_map = {"short": (5, 8), "default": (8, 12), "long": (12, 18)}
    min_slides, max_slides = length_map.get(length, (8, 12))

    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")

    if format == "detailed":
        format_instruction = "자세한 자료: 전체 텍스트와 세부정보를 포함한 포괄적인 슬라이드로, 이메일로 공유하거나 단독으로 읽기에 적합합니다. 각 슬라이드에 충분한 텍스트를 포함해 주세요."
    else:
        format_instruction = "발표자 슬라이드: 발표 중 참고할 핵심 키워드와 간결한 bullet point만 포함한 시각적인 슬라이드입니다. 각 bullet은 5단어 이내로 짧게 작성해 주세요."

    custom_instruction = f"\n추가 요구사항: {prompt.strip()}" if prompt.strip() else ""
    context = _get_context(doc_ids, max_chars=12000)

    prompt_text = f"""아래 문서 내용을 바탕으로 {lang_label} 슬라이드 자료를 만들어주세요.

형식: {format_instruction}{custom_instruction}

슬라이드 수: {min_slides}~{max_slides}장 (첫 슬라이드는 표지, 마지막은 정리/결론)

규칙:
- 첫 슬라이드: layout = "title", bullets는 비우고 subtitle 필드에 부제목만 기입
- 중간 슬라이드: layout = "content" (단일 컬럼) 또는 "two_column" (양쪽 비교)
- 마지막 슬라이드: layout = "summary", 핵심 내용 3~5개 정리
- bullets: 각 슬라이드의 본문 내용 (문자열 배열)
- speaker_notes: 발표자가 구두로 설명할 내용 (발표자 슬라이드 형식일 때 더 자세히)

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "슬라이드 전체 제목",
  "slides": [
    {{
      "title": "슬라이드 제목",
      "subtitle": "부제목 (표지에만 사용, 나머지는 빈 문자열)",
      "bullets": ["내용1", "내용2", "내용3"],
      "speaker_notes": "발표자 노트",
      "layout": "title"
    }}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=0.5,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "슬라이드 자료")
    slides = result.get("slides", [])

    # DALL-E 3 표지 이미지 생성
    cover_image_b64 = ""
    try:
        # 표지 이미지 프롬프트 자동 생성
        img_prompt_resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""다음 슬라이드 제목을 위한 DALL-E 이미지 생성 프롬프트를 영어로 한 문장으로 작성해주세요.
제목: {title}

요구사항:
- 학술/교육 자료에 어울리는 전문적인 flat illustration 스타일
- 파란색 계열 색상 팔레트 (#1e3a5f, #2563eb 계열)
- 깔끔하고 미니멀한 디자인, 흰색 배경
- 텍스트 없이 아이콘/도형/다이어그램으로만 구성
- 16:9 비율에 맞는 가로형 구도
프롬프트만 출력하세요."""
            }],
            max_tokens=200,
        )
        img_prompt = img_prompt_resp.choices[0].message.content or ""
        dalle_resp = client.images.generate(
            model="dall-e-3",
            prompt=img_prompt,
            size="1792x1024",
            quality="standard",
            response_format="b64_json",
            n=1,
        )
        cover_image_b64 = dalle_resp.data[0].b64_json or ""
    except Exception as e:
        print(f"[slides] DALL-E image generation failed: {e}")

    return slides, title, cover_image_b64


def generate_report(
    doc_ids: list[str],
    format: str = "briefing",
    language: str = "ko",
    length: str = "default",
    tone: str = "formal",
    instructions: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[list, str]:
    """문서 내용을 바탕으로 구조화된 보고서를 생성.

    Returns:
        (sections, title)
        sections: [{"heading": "섹션 제목", "content": "내용 텍스트"}]
    """
    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")

    tone_map = {
        "formal": "격식체(공식적이고 전문적인 문체)",
        "casual": "구어체(친근하고 읽기 쉬운 문체)",
        "academic": "학술체(논문 수준의 엄밀하고 인용 중심의 문체)",
    }
    tone_label = tone_map.get(tone, "격식체")

    length_map = {"short": 3, "default": 5, "long": 8}
    section_count = length_map.get(length, 5)

    format_prompts = {
        "briefing": f"""브리핑 문서: 핵심 인사이트를 간결하게 정리한 요약 보고서입니다.
구성: 개요, 주요 발견사항 {section_count-2}개, 결론
각 섹션은 bullet point 중심으로 간결하게 작성하세요.""",

        "study_guide": f"""학습 가이드: 학습자가 내용을 효과적으로 복습하고 이해할 수 있도록 돕는 구조입니다.
구성: 핵심 개념 요약, 단답형 퀴즈 (질문 {max(section_count-2, 3)}개와 정답), 추천 에세이 질문 2개, 핵심 용어집
학습자 친화적이고 교육적인 톤으로 작성하세요.""",

        "blog": f"""블로그 게시물: 일반 독자가 쉽게 이해할 수 있는 기사 형식입니다.
구성: 흥미로운 서론, 본론 {section_count-2}개의 소제목(각 2~3문단), 결론
스토리텔링 방식으로 읽기 쉽게 작성하세요.""",

        "prd": f"""제품 요구사항 정의서(PRD): 제품/서비스의 요구사항을 체계적으로 정리한 문서입니다.
구성: 개요 및 목적, 사용자 페르소나, 핵심 기능 요구사항, 기술적 제약 및 고려사항, 성공 지표
명확하고 구체적인 요구사항 형식으로 작성하세요.""",

        "architecture": f"""시스템 아키텍처 설계서: 시스템의 구조와 구성요소를 설명하는 기술 문서입니다.
구성: 시스템 개요, 핵심 컴포넌트 설명, 데이터 흐름, 기술 스택, 확장성/보안 고려사항
기술적이고 상세하게 작성하세요.""",

        "tech_explainer": f"""기술 개념 설명서: 복잡한 기술 개념을 이해하기 쉽게 설명하는 문서입니다.
구성: 개념 소개(비유 포함), 원리 설명, 실제 동작 방식, 활용 사례, 장단점 및 한계
단계적으로 개념을 쌓아가는 방식으로 설명하세요.""",

        "learning_guide": f"""학습 활용 가이드: 서비스나 도구를 효과적으로 활용하는 방법을 안내하는 입문용 자료입니다.
구성: 시작하기, 주요 기능 소개 (각 {max(section_count-3, 2)}가지), 활용 팁 및 모범 사례, 자주 묻는 질문
초보자를 위한 친절한 안내서 형식으로 작성하세요.""",

        "custom": "사용자가 아래 추가 지시사항에 명시한 형식으로 보고서를 작성하세요.",
    }

    format_instruction = format_prompts.get(format, format_prompts["briefing"])
    custom_instruction = f"\n\n추가 지시사항: {instructions.strip()}" if instructions.strip() else ""
    context = _get_context(doc_ids, max_chars=12000)

    prompt_text = f"""아래 문서 내용을 바탕으로 {lang_label} 보고서를 생성해주세요.

보고서 형식:
{format_instruction}{custom_instruction}

문체: {tone_label}

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "보고서 제목",
  "sections": [
    {{
      "heading": "섹션 제목",
      "content": "섹션 내용 (마크다운 bullet 사용 가능. \\n으로 줄바꿈)"
    }}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=0.5,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "보고서")
    sections = result.get("sections", [])
    return sections, title


def generate_data_table(
    doc_ids: list[str],
    format: str = "summary_table",
    language: str = "ko",
    instructions: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[str, str, list, list]:
    """문서 내용을 바탕으로 구조화된 데이터 표를 생성.

    Returns:
        (title, description, columns, rows)
        columns: [{"id": "col_id", "title": "Column Title", "type": "text|number|date"}]
        rows: [{"col_id": value, ...}, ...]
    """
    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")

    context = _get_context(doc_ids, max_chars=6000)
    custom_instruction = f"\n\n추가 지시사항: {instructions.strip()}" if instructions.strip() else ""

    # 형식별 상세 프롬프트 정의
    format_specs = {
        "summary_table": {
            "description": "핵심 내용 정리표",
            "instruction": """다음 구조의 요약 표를 생성하세요:
- 컬럼: 주제(text) | 핵심 내용(text) | 중요도(text: 상/중/하) | 관련 개념(text)
- 5~8개의 행: 문서의 핵심 내용을 주제별로 체계적으로 정리
- 각 행은 하나의 학습 포인트를 명확하게 표현

예시:
- 주제: "데이터베이스의 정의", 핵심 내용: "구조화된 데이터 모음", 중요도: "상", 관련 개념: "SQL, 스키마"
- 주제: "인덱싱", 핵심 내용: "검색 성능 향상 기법", 중요도: "중", 관련 개념: "B-tree, 쿼리"
""",
        },
        "comparison_table": {
            "description": "비교 분석 표",
            "instruction": """문서에서 비교할 2~4개의 개념/항목을 추출하여 다음 구조로 표를 생성하세요:
- 첫 번째 컬럼: 비교 항목(text)
- 나머지 컬럼: 각 개념/항목별 특성(text)
- 5~7개의 행: 명확한 비교 항목 (정의, 특징, 장점, 단점, 사용 사례 등)
- 각 셀에는 간결하고 구체적인 설명 작성

예시:
- 비교항목: "정의", [개념A]: "...", [개념B]: "..."
- 비교항목: "장점", [개념A]: "...", [개념B]: "..."
""",
        },
        "concept_definition": {
            "description": "개념 정의 표",
            "instruction": """문서의 핵심 개념/용어를 추출하여 다음 구조의 완전한 정의 표를 생성하세요:
- 컬럼: 개념(text) | 정의(text) | 예시(text) | 유사어/반대어(text) | 관련 분야(text)
- 8~12개의 행: 문서에서 중요한 개념들을 모두 포함
- 정의는 명확하고 이해하기 쉽게
- 예시는 실제로 발생할 수 있는 사례로
- 유사어와 반대어를 모두 포함

예시:
- 개념: "인덱싱", 정의: "데이터 검색 성능 향상 기법", 예시: "데이터베이스 컬럼에 인덱스 생성", 유사어: "색인화", 관련분야: "데이터베이스"
""",
        },
        "learning_checklist": {
            "description": "학습 점검표",
            "instruction": """학습자가 자신의 이해도를 점검할 수 있는 다음 구조의 체크리스트를 생성하세요:
- 컬럼: 학습 항목(text) | 상세 설명(text) | 중요도(text: 상/중/하) | 자가 평가 기준(text)
- 8~15개의 행: 문서의 학습 목표를 구체적인 항목으로 분해
- 자가 평가 기준: "설명할 수 있다", "예시를 들 수 있다", "응용할 수 있다" 등 명확한 기준 제시
- 중요도에 따라 학습 우선순위 명시

예시:
- 학습항목: "SELECT 문장", 상세설명: "데이터베이스에서 데이터를 조회하는 명령어", 중요도: "상", 평가기준: "SELECT * FROM 문법을 이해하고 사용할 수 있다"
""",
        },
        "progress_tracking": {
            "description": "진도 추적표",
            "instruction": """주차/단계별 학습 계획을 추적할 수 있는 다음 구조의 표를 생성하세요:
- 컬럼: 주차(text) | 학습 내용(text) | 예상 소요 시간(text) | 학습 목표(text) | 완료 여부(text: 미완료/진행중/완료)
- 6~10개의 행: 문서 내용을 주차/단계별로 분할하여 구성
- 소요 시간: 현실적인 학습 시간 제시 (예: "2시간", "1주일")
- 학습 목표: 각 주차의 구체적인 달성 목표 명시
- 완료 여부: 초기값은 모두 "미완료"로 설정

예시:
- 주차: "1주차", 내용: "데이터베이스 기초 개념", 소요시간: "3시간", 목표: "DBMS의 정의와 종류 이해", 완료여부: "미완료"
""",
        },
    }

    spec = format_specs.get(format, format_specs["summary_table"])
    format_instruction = spec["instruction"]

    prompt_text = f"""당신은 학습 자료를 체계적으로 정리하는 교육 전문가입니다.
아래 문서 내용을 바탕으로 {spec["description"]}을 생성해주세요.{custom_instruction}

생성 규칙:
{format_instruction}

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요. 필드를 생략하지 마세요:
{{
  "title": "표의 제목 (문서 내용을 반영한 구체적인 제목)",
  "description": "표의 목적과 사용 방법을 설명하는 한두 문장",
  "columns": [
    {{
      "id": "col_1",
      "title": "첫 번째 열 제목",
      "type": "text"
    }},
    {{
      "id": "col_2",
      "title": "두 번째 열 제목",
      "type": "text"
    }}
  ],
  "rows": [
    {{
      "col_1": "첫 번째 셀 값",
      "col_2": "두 번째 셀 값"
    }},
    {{
      "col_1": "첫 번째 셀 값",
      "col_2": "두 번째 셀 값"
    }}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "데이터표")
    description = result.get("description", "")
    columns = result.get("columns", [])
    rows = result.get("rows", [])
    return title, description, columns, rows


# ─────────────────────────────────────────────
# 영상 생성 (Remotion + TTS)
# ─────────────────────────────────────────────

def _extract_marker_timings(notes_raw: str, n_bullets: int) -> tuple[str, list[float]]:
    """[N] 마커를 파싱하고 문자 위치 기반 타이밍을 계산한다.

    핵심 원리:
    - TTS 발화 시간은 텍스트 길이에 비례 → 마커 이전 문자 수 / 전체 문자 수 = 타이밍 비율
    - 스프링 애니메이션 지연을 보정하기 위해 전체 길이의 6%를 앞서 트리거

    Returns: (마커 제거된 clean text, 타이밍 리스트 0.0~1.0)
    """
    pattern = re.compile(r'\[(\d+)\]')

    clean = pattern.sub('', notes_raw)
    clean = re.sub(r'  +', ' ', clean).strip()
    total_len = max(1, len(clean))

    if n_bullets <= 0:
        return clean, []

    marker_list = [(m.start(), int(m.group(1)), len(m.group(0))) for m in pattern.finditer(notes_raw)]

    timing_map: dict[int, float] = {}
    removed_chars = 0
    for raw_pos, num, mlen in marker_list:
        clean_pos = raw_pos - removed_chars
        frac = clean_pos / total_len
        frac = max(0.03, frac - 0.06)
        timing_map[num] = round(min(0.90, frac), 3)
        removed_chars += mlen

    if not timing_map:
        return clean, [round((i + 1) / (n_bullets + 1), 3) for i in range(n_bullets)]

    timings: list[float] = []
    sorted_map = sorted(timing_map.items())
    for i in range(n_bullets):
        if (i + 1) in timing_map:
            timings.append(timing_map[i + 1])
        else:
            prev = max((t for k, t in sorted_map if k <= i),     default=0.03)
            nxt  = min((t for k, t in sorted_map if k >= i + 2), default=0.90)
            timings.append(round((prev + nxt) / 2, 3))

    return clean, timings


def generate_video(
    doc_ids: list[str],
    language: str = "ko",
    length: str = "default",
    model: str = "gpt-4o-mini",
) -> tuple[list[dict], str]:
    """문서 내용을 바탕으로 Remotion 비디오용 슬라이드 데이터(TTS 오디오 포함)를 생성."""
    import base64 as _base64

    length_map = {"short": (4, 5), "default": (5, 7), "long": (7, 10)}
    min_slides, max_slides = length_map.get(length, (5, 7))

    lang_map = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}
    lang_label = lang_map.get(language, "한국어")

    context = _sanitize(_get_context(doc_ids, max_chars=14000))

    prompt_text = f"""당신은 대학 강의를 진행하는 강사입니다.
아래 문서를 바탕으로, 실제 강의실에서 학생들에게 설명하듯 {lang_label} 강의 슬라이드 스크립트를 작성해주세요.

슬라이드 수: {min_slides}~{max_slides}장 (첫 장 타이틀, 마지막 장 정리)

━━━ 핵심 원칙 ━━━
각 슬라이드는 하나의 주제만 다룹니다.
강의 전체가 자연스럽게 이어지도록, 앞 내용과 연결하거나 흐름을 만들어주세요.

━━━ speaker_notes 작성 규칙 ━━━
어조: 강사가 학생들에게 말하는 자연스러운 구어체 강의 말투
  - "~습니다", "~입니다" 로 끝나는 부드럽고 친근한 경어체
  - 딱딱하게 정의를 나열하지 말고, 강사가 실제로 입으로 말하듯 풀어서 설명
  - 청중이 따라오기 쉽도록 짧고 명확하게, 그러나 자연스러운 호흡으로
  - "~라고 볼 수 있습니다", "~인 셈입니다", "쉽게 말하면" 같은 표현도 자연스럽게 사용 가능

문장 수: 정확히 1 + bullets 개수 문장
  - 1번째 문장: 이 슬라이드 주제를 강사답게 도입 (앞 내용과 연결하거나, 왜 중요한지 한 문장으로)
  - 2번째~ 문장: bullets[0], bullets[1]... 순서대로 각각 1문장씩, 학생 눈높이에 맞게 설명

슬라이드 흐름: 강의 전체가 하나의 이야기처럼 이어지도록 작성합니다.
  - 앞 슬라이드 내용을 짧게 받아서 이 슬라이드로 자연스럽게 넘어오는 도입도 좋습니다.
  - 단, 이 슬라이드의 본론(bullets 설명)이 흐려지지 않도록 도입은 1문장 이내로 짧게.
연결어 적극 활용: "또한", "그리고", "반면에", "특히", "따라서", "이를 통해" 등으로 문장 흐름을 자연스럽게 연결
[N] 마커: 각 bullet 설명 문장 맨 앞에 [1], [2], [3]... 삽입 (렌더링 시 자동 제거)

예시 (bullets 3개 → 정확히 4문장):
"TCP가 왜 중요한지 이해하려면, 우선 데이터가 어떻게 전달되는지를 알아야 합니다. [1]연결을 시작할 때는 3-way handshake라는 과정을 거쳐서, 서로 준비됐는지 확인하고 통신을 시작합니다. [2]전송 중 패킷이 사라지면 자동으로 다시 보내줘서, 데이터가 빠짐없이 도착하도록 보장합니다. [3]통신이 끝날 때도 4-way handshake로 안전하게 연결을 끊어줍니다."

━━━ layout 선택 ━━━
"steps"  → 순서·절차·단계 (3~5개)
"cards"  → 독립된 개념·기능 (3~4개)
"table"  → 비교·대조
"list"   → 그 외 일반 내용

━━━ 나머지 필드 ━━━
[title] 슬라이드 주제 (10자 이내, 명사형)
[summary] 이 슬라이드의 핵심 결론 한 줄 (25자 이내, "~이다" 형식)
[bullets] "핵심어 | 한 줄 설명" 형식, 3~4개
  - 핵심어: 2~5자의 키워드
  - 설명: speaker_notes 해당 문장과 동일한 내용을 압축한 한 문장

━━━━━━━━━━━━━━━━━━

문서 내용:
{context}

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "title": "동영상 제목",
  "slides": [
    {{
      "layout": "list",
      "title": "슬라이드 제목",
      "summary": "핵심 결론 한 줄",
      "bullets": ["핵심어 | 설명", "핵심어2 | 설명2"],
      "speaker_notes": "핵심 도입 문장. [1]bullet1 설명 문장. [2]bullet2 설명 문장."
    }}
  ]
}}"""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=0.6,
        max_tokens=4000,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    video_title = result.get("title", "동영상 개요")
    raw_slides = result.get("slides", [])

    FPS = 30
    MIN_SLIDE_FRAMES = 150
    CHARS_PER_SEC = 5.0

    slides_with_audio: list[dict] = []
    for slide in raw_slides:
        notes_raw = slide.get("speaker_notes", "").strip()
        bullets   = slide.get("bullets", [])

        notes, bullet_timings = _extract_marker_timings(notes_raw, len(bullets))
        notes = _sanitize(notes)

        try:
            tts_resp = client.audio.speech.create(
                model="tts-1-hd",
                voice="nova",
                input=notes or _sanitize(slide.get("title", "")),
                response_format="wav",
            )
            audio_b64 = _base64.b64encode(tts_resp.content).decode()
            audio_sec = max(4.0, (len(tts_resp.content) - 44) / 48000)
            estimated_sec = audio_sec + 1.0
        except Exception as e:
            print(f"[video] TTS 실패, 무음으로 대체: {e}")
            audio_b64 = ""
            audio_sec = max(4.0, len(notes) / CHARS_PER_SEC)
            estimated_sec = audio_sec + 1.0

        duration_frames = max(MIN_SLIDE_FRAMES, int(estimated_sec * FPS))

        slides_with_audio.append({
            "title": slide.get("title", ""),
            "layout": slide.get("layout", "list"),
            "summary": slide.get("summary", ""),
            "bullets": bullets,
            "bulletTimings": bullet_timings,
            "audioSec": round(audio_sec, 2),
            "speakerNotes": notes,
            "audioBase64": audio_b64,
            "durationInFrames": duration_frames,
        })

    return slides_with_audio, video_title


def generate_infographic(
    doc_ids: list[str],
    format: str = "overview",
    language: str = "ko",
    instructions: str = "",
    model: str = "gpt-4o-mini",
) -> tuple[str, str, list[dict]]:
    """문서 내용을 바탕으로 인포그래픽을 생성.

    반환: (title, description, sections)
    - sections: 각각 title, icon, color, stat, stat_label, points를 가진 섹션 객체 리스트
    """
    context = _get_context(doc_ids, max_chars=6000)

    colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F", "#BB8FCE"]

    format_specs = {
        "overview": {
            "label": "개요형",
            "instruction": "문서의 주요 내용을 5개의 주제별 섹션으로 요약합니다. 각 섹션은 제목, 이모지 아이콘, 색상, 핵심 포인트 3~4개를 포함합니다.",
            "section_count": 5,
            "stat_rule": "stat은 선택사항입니다. 문서에 명확한 수치나 통계가 있을 때만 포함하세요. 없으면 stat과 stat_label을 생략하세요.",
        },
        "process": {
            "label": "프로세스형",
            "instruction": "문서에서 설명하는 단계적 프로세스나 절차를 순서대로 4~5개의 섹션으로 나타냅니다.",
            "section_count": 5,
            "stat_rule": "stat은 필수입니다. 각 섹션마다 '1단계', '2단계', '3단계' 등의 형식으로 순서 번호를 포함하세요. stat_label에는 해당 단계의 핵심 행동을 한 줄로 적으세요.",
        },
        "comparison": {
            "label": "비교형",
            "instruction": "문서의 주요 개념이나 대상들의 특징과 차이를 비교 분석합니다. 4개의 섹션으로 나누어 각각의 장점, 특징, 사용 시기를 설명합니다.",
            "section_count": 4,
            "stat_rule": "stat은 선택사항입니다. 비교 대상의 수치 차이나 비율 데이터가 있을 때만 포함하세요. 명확한 수치가 없으면 생략해도 괜찮습니다.",
        },
        "statistics": {
            "label": "통계형",
            "instruction": "문서에서 강조하는 수치, 통계, 비율을 중심으로 4~5개의 섹션을 만듭니다.",
            "section_count": 5,
            "stat_rule": "stat은 필수입니다. 각 섹션마다 문서에서 가장 임팩트 있는 숫자나 비율을 포함하세요 (예: '85%', '3배', '1억명'). stat_label에는 그 수치의 맥락을 설명하세요. 모든 섹션에 stat이 있어야 합니다.",
        },
        "timeline": {
            "label": "타임라인형",
            "instruction": "문서가 다루는 역사적, 발전적, 또는 시간 순서의 흐름을 4~5개의 섹션으로 표현합니다.",
            "section_count": 5,
            "stat_rule": "stat은 필수입니다. 각 섹션의 시간을 명확히 표시하세요 (예: '2024년', '1990년대', '3월'). stat_label에는 그 시기의 핵심 사건이나 변화를 적으세요.",
        },
    }

    spec = format_specs.get(format, format_specs["overview"])
    language_label = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}.get(language, "한국어")
    color_palette = ", ".join(colors)

    prompt_text = f"""당신은 전문적인 교육 콘텐츠 크리에이터입니다.

다음 문서 내용을 바탕으로 '{spec["label"]}' 형태의 인포그래픽을 생성하세요.

【문서 내용】
{context}

【요청사항】
- 형식: {spec["label"]}
- {spec["instruction"]}
- 섹션 개수: 약 {spec["section_count"]}개
- 언어: {language_label}
{f'- 추가 지시사항: {instructions}' if instructions else ''}

【stat 필드 규칙】
{spec["stat_rule"]}

【JSON 응답 형식】
각 섹션은 다음 구조를 가져야 합니다:
- title: 섹션 제목 (문자열)
- icon: 이모지 아이콘 (1개 이모지 문자)
- color: 섹션 배경색 (hex 컬러 코드, 권장 팔레트: {color_palette})
- stat: 위의 stat 필드 규칙에 따라 포함 또는 생략
- stat_label: stat이 있을 때만 포함 (문자열)
- points: 핵심 포인트 배열 (3~5개의 문자열)

전체 응답:
{{
  "title": "전체 제목",
  "description": "간단한 설명 (1~2문장)",
  "sections": [
    {{
      "title": "섹션 제목",
      "icon": "🎯",
      "color": "#FF6B6B",
      "stat": "85%",
      "stat_label": "통계 설명",
      "points": ["포인트 1", "포인트 2", "포인트 3"]
    }}
  ]
}}

올바른 JSON 형식으로만 응답하세요."""

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    result = json.loads(response.choices[0].message.content or "{}")
    title = result.get("title", "인포그래픽")
    description = result.get("description", "")
    sections = result.get("sections", [])

    for idx, section in enumerate(sections):
        if not section.get("color"):
            section["color"] = colors[idx % len(colors)]

    return title, description, sections


# ─────────────────────────────────────────────
# 추천 질문 생성
# ─────────────────────────────────────────────

def generate_suggestions(
    doc_ids: list[str],
    asked_questions: list[str] = [],
    model: str = "gpt-4o-mini",
) -> list[dict]:
    """문서 타입과 내용 기반으로 카테고리별 추천 질문 3개를 생성한다.
    이미지 소스는 실제 이미지를 Vision API에 직접 전달.
    반환: [{"text": "...", "category": "이해|분석|적용"}]
    """
    import base64

    filenames = _get_filenames(doc_ids)
    image_docs = _get_image_docs(doc_ids)
    non_image_ids = [d for d in doc_ids if d not in {img["doc_id"] for img in image_docs}]

    # 파일 타입 감지
    file_types: set[str] = set()
    for fn in filenames:
        ext = fn.lower().rsplit(".", 1)[-1] if "." in fn else ""
        if ext in IMAGE_EXTENSIONS:
            file_types.add("image")
        elif ext in VIDEO_AUDIO_EXTENSIONS:
            file_types.add("video_audio")
        elif ext in ("pptx", "ppt"):
            file_types.add("ppt")
        else:
            file_types.add("document")

    # 텍스트 컨텍스트 (비이미지 문서)
    context_ids = non_image_ids if non_image_ids else doc_ids
    context = _get_context(context_ids, max_chars=4000) if context_ids else ""

    # 이미지 메타데이터 조회
    img_meta_map = _get_image_metadata([img["doc_id"] for img in image_docs])
    all_subjects: list[str] = []
    all_img_types: list[str] = []
    for img in image_docs:
        meta = img_meta_map.get(img["doc_id"], {})
        all_subjects.extend(meta.get("subjects", []))
        if meta.get("image_type"):
            all_img_types.append(meta["image_type"])
    subjects_str = ", ".join(dict.fromkeys(all_subjects))
    primary_img_type = all_img_types[0] if all_img_types else "photo"

    # 이미지 base64 수집
    image_parts: list[dict] = []
    for img in image_docs:
        raw = _download_image_b64(img["storage_path"])
        if raw:
            b64 = base64.b64encode(raw).decode("utf-8")
            image_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{img['mime_type']};base64,{b64}", "detail": "high"},
            })

    asked_block = ""
    if asked_questions:
        asked_block = "\n\n[이미 질문된 항목 - 반드시 제외]\n" + "\n".join(
            f"- {q}" for q in asked_questions[-6:]
        )

    # 이미지 전용 프롬프트
    if image_parts and not non_image_ids:
        image_names = ", ".join(f"'{img['filename']}'" for img in image_docs)
        # 이미지 타입별 질문 가이드
        img_type_hint = {
            "photo":        "피사체([{subjects}])의 외형·행동·습성·생태 등 다양한 각도의 질문 포함.",
            "chart":        "축 값, 데이터 수치, 추세, 비교 포인트를 구체적으로 언급하는 질문 포함.",
            "diagram":      "구성 요소 간 관계, 흐름 순서, 핵심 노드에 관한 질문 포함.",
            "screenshot":   "코드 로직, UI 요소, 오류 원인, 설정 의미에 관한 기술적 질문 포함.",
            "document":     "문서에 적힌 특정 항목, 조항, 수치를 직접 인용하는 질문 포함.",
            "illustration": "그림이 표현하는 개념, 메시지, 상징적 의미에 관한 질문 포함.",
        }.get(primary_img_type, "이미지에서 보이는 구체적 요소를 언급하는 질문 포함.").format(subjects=subjects_str)

        meta_hint = f"\n[사전 분석 결과] 이미지 유형: {primary_img_type} / 등장 대상: {subjects_str}" if subjects_str else ""

        prompt_text = f"""당신은 이미지 기반 학습을 돕는 전문 비주얼 튜터입니다.
첨부된 이미지({image_names})를 직접 분석하여, 학습자가 이 이미지를 완전히 이해하기 위해 반드시 물어봐야 할 핵심 질문 3개를 생성하세요.
{meta_hint}
{asked_block}

[질문 생성 규칙]
{img_type_hint}

1. 이미지에서 실제로 보이는 구체적 요소(수치, 대상, 색상, 구조, 텍스트)를 질문에 직접 언급할 것
   ✗ "이미지가 무엇을 나타내나요?" (너무 일반적)
   ✓ "그래프에서 2023년 매출이 급등한 원인은 무엇인가요?" (구체적)

2. 카테고리별 1개씩:
   - "이해": 이미지의 특정 요소·대상·수치를 확인하는 질문
   - "분석": 이미지 전체 의미, 패턴, 시사점을 파악하는 질문
   - "적용": 이미지 내용을 실제 상황이나 다른 개념에 연결하는 질문

3. 각 질문은 완전한 문장, 40자 이내

JSON 형식으로만 응답:
{{"questions": [{{"text": "질문", "category": "이해"}}, {{"text": "질문", "category": "분석"}}, {{"text": "질문", "category": "적용"}}]}}"""

        user_content: list[dict] = [{"type": "text", "text": prompt_text}] + image_parts

    else:
        # 텍스트 문서 (+ 선택적으로 이미지 혼합) 프롬프트
        type_guidance = ""
        if "image" in file_types:
            type_guidance += "\n[이미지 포함] 이미지에서 보이는 시각적 요소, 차트 수치, 다이어그램을 직접 언급하는 질문 포함."
        if "video_audio" in file_types:
            type_guidance += "\n[영상/음성 포함] 영상에서 언급된 발언, 수치, 설명된 개념에 관한 질문 포함."
        if "ppt" in file_types:
            type_guidance += "\n[PPT 포함] 슬라이드 흐름, 핵심 주장, 데이터에 관한 질문 포함."

        prompt_text = f"""당신은 학습 내용을 깊이 이해하도록 돕는 전문 튜터입니다.
아래 문서 내용을 분석하여, 학습자가 반드시 짚고 넘어가야 할 핵심 질문 3개를 생성하세요.
{type_guidance}
══════════════════════════════
[문서 내용]
{context[:4000]}
══════════════════════════════
{asked_block}

[생성 규칙 - 반드시 준수]
1. 각 질문은 문서에 실제로 등장하는 용어, 수치, 개념을 반드시 포함할 것
   ✗ "핵심 개념이 무엇인가요?" → ✓ "SHA-256이 MD5보다 안전한 이유는?"

2. 카테고리별 1개씩:
   - "이해": 개념·사실 확인 → "~란?", "~는 어떻게?"
   - "분석": 비교·원인·관계 → "~와 ~의 차이는?", "왜 ~?"
   - "적용": 실제 활용·확장 → "~을 어떻게 활용?", "만약 ~라면?"

3. 각 질문은 완전한 문장, 40자 이내

JSON 형식으로만 응답:
{{"questions": [{{"text": "질문", "category": "이해"}}, {{"text": "질문", "category": "분석"}}, {{"text": "질문", "category": "적용"}}]}}"""

        if image_parts:
            user_content = [{"type": "text", "text": prompt_text}] + image_parts
        else:
            user_content = [{"type": "text", "text": prompt_text}]

    try:
        safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model=safe_model,
            messages=[
                {
                    "role": "system",
                    "content": "당신은 학습 내용을 깊이 이해하도록 돕는 전문 교육 튜터입니다. 자료의 실제 내용에 기반한 구체적이고 통찰력 있는 질문을 생성합니다.",
                },
                {"role": "user", "content": user_content},  # type: ignore
            ],
            response_format={"type": "json_object"},
            temperature=0.75,
        )
        result = json.loads(response.choices[0].message.content or "{}")
        questions = result.get("questions", [])
        if isinstance(questions, list):
            return [q for q in questions if isinstance(q, dict) and "text" in q][:3]
        return []
    except Exception:
        return []
