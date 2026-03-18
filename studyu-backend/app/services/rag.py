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
# 인덱싱 (PDF)
# ─────────────────────────────────────────────

def ingest_document(file_bytes: bytes, doc_id: str, filename: str = "") -> tuple[int, int]:
    """PDF 바이트를 청크로 분할하고 임베딩을 포함하여 Supabase에 저장.

    Returns:
        (chunk_count, page_count)
    """
    chunks: list[str] = []
    page_count = 0

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            raw = page.extract_text() or ""
            text = _hard_sanitize(_sanitize(raw)).strip()
            if not text:
                continue
            step = CHUNK_SIZE - CHUNK_OVERLAP
            for i in range(0, len(text), step):
                chunk = _hard_sanitize(_sanitize(text[i: i + CHUNK_SIZE]))
                if chunk.strip():
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
    print(f"[INFO] ingest_document: {len(records)} chunks 저장 완료")
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


def chat_with_docs(
    doc_ids: list[str],
    question: str,
    model: str = "gpt-4o-mini",
    level: str = "intermediate",
    chat_history: list | None = None,
) -> tuple[str, list[str]]:
    """문서 기반 RAG 질의응답. (answer, sources) 반환."""
    is_multi = len(doc_ids) > 1

    # 임베딩 기반 유사도 검색으로 컨텍스트 구성
    context = _get_context_semantic(doc_ids, question, top_k=TOP_K, labeled=is_multi)

    level_hint = LEVEL_PROMPTS.get(level, LEVEL_PROMPTS["intermediate"])

    if is_multi:
        doc_names = _get_filenames(doc_ids)
        names_str = ", ".join(f"'{n}'" for n in doc_names)
        system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
총 {len(doc_ids)}개의 문서({names_str})가 제공됩니다.
반드시 각 문서를 모두 참조하여 답변하세요.
'**[문서명]** 에서는 ~', '**[문서명]** 에 따르면 ~' 형식으로 각 문서의 내용을 명확히 구분하여 서술하세요.
답변 시 {level_hint}
제공된 문서 내용에서 최대한 찾아서 답변하세요.

<context>
{context}
</context>"""
    else:
        system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
아래 문서 내용을 바탕으로 질문에 답변하세요.
답변 시 {level_hint}
제공된 문서 내용에서 최대한 찾아서 답변하세요. 정말로 알 수 없을 때만 "문서에서 찾을 수 없습니다"라고 하세요.

<context>
{context}
</context>"""

    messages: list[dict] = [{"role": "system", "content": system_msg}]
    if chat_history:
        for msg in chat_history[-6:]:
            messages.append(msg)
    messages.append({"role": "user", "content": question})

    safe_model = model if model.startswith("gpt") else "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=safe_model,
        messages=messages,  # type: ignore
        temperature=0.3,
    )
    answer = response.choices[0].message.content or ""
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
