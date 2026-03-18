"""
경량 RAG 파이프라인 (in-memory, pdfplumber + OpenAI embeddings + cosine similarity)

인덱싱: pdfplumber(PDF) / httpx+BS4(URL) / youtube-transcript-api(YouTube)로 텍스트 추출
        → 청크 분할 → OpenAI text-embedding-3-small로 벡터 생성
검색:   질문 임베딩 → 코사인 유사도 계산 → 상위 top_k 청크만 컨텍스트로 사용
생성:   generate_content(요약/퀴즈/학습계획)은 전체 문서 내용 사용 (기존 방식 유지)
"""

import re
import xml.etree.ElementTree as ET
import numpy as np
import pdfplumber
import httpx
import trafilatura
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
from openai import OpenAI
from app.core.config import settings

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

# in-memory 문서 저장소
# doc_id -> {"chunks": [str], "embeddings": np.ndarray (N x D), "filename": str}
_doc_store: dict[str, dict] = {}

CHUNK_SIZE = 900
CHUNK_OVERLAP = 100
EMBED_MODEL = "text-embedding-3-small"
TOP_K = 8  # 질문과 가장 유사한 청크 수


# ─────────────────────────────────────────────
# 임베딩 헬퍼
# ─────────────────────────────────────────────

def _embed(texts: list[str]) -> np.ndarray:
    """텍스트 리스트를 임베딩 벡터 배열로 변환. shape: (len(texts), D)"""
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vectors = [item.embedding for item in response.data]
    return np.array(vectors, dtype=np.float32)


def _cosine_similarity(query_vec: np.ndarray, chunk_vecs: np.ndarray) -> np.ndarray:
    """query_vec (D,) 와 chunk_vecs (N, D) 간 코사인 유사도. shape: (N,)"""
    query_norm = query_vec / (np.linalg.norm(query_vec) + 1e-9)
    chunk_norms = chunk_vecs / (np.linalg.norm(chunk_vecs, axis=1, keepdims=True) + 1e-9)
    return chunk_norms @ query_norm


# ─────────────────────────────────────────────
# 텍스트 추출 헬퍼
# ─────────────────────────────────────────────

def _extract_youtube_id(url: str) -> str | None:
    """YouTube URL에서 video ID 추출."""
    patterns = [
        r"youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})",
        r"youtu\.be/([a-zA-Z0-9_-]{11})",
        r"youtube\.com/embed/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None


def _text_to_chunks(text: str) -> list[str]:
    """텍스트를 CHUNK_SIZE 단위로 분할."""
    chunks: list[str] = []
    step = CHUNK_SIZE - CHUNK_OVERLAP
    for i in range(0, len(text), step):
        chunk = text[i : i + CHUNK_SIZE]
        if chunk.strip():
            chunks.append(chunk)
    return chunks


def _store_chunks(doc_id: str, chunks: list[str], title: str, source_type: str) -> int:
    """청크 임베딩 생성 후 저장. 청크 수 반환."""
    if not chunks:
        _doc_store[doc_id] = {
            "chunks": [],
            "embeddings": np.empty((0, 0)),
            "filename": title,
            "source_type": source_type,
        }
        return 0

    embeddings = _embed(chunks)
    _doc_store[doc_id] = {
        "chunks": chunks,
        "embeddings": embeddings,
        "filename": title,
        "source_type": source_type,  # "pdf" | "url" | "youtube"
    }
    return len(chunks)


# ─────────────────────────────────────────────
# 인덱싱
# ─────────────────────────────────────────────

def ingest_document(file_path: str, doc_id: str, filename: str = "") -> int:
    """PDF를 청크로 분할하고 임베딩을 생성하여 메모리에 저장. 청크 수 반환."""
    chunks: list[str] = []

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = (page.extract_text() or "").strip()
            if text:
                chunks.extend(_text_to_chunks(text))

    return _store_chunks(doc_id, chunks, filename, "pdf")


def _fetch_naver_blog(url: str) -> tuple[str, str]:
    """네이버 블로그 본문을 mobile URL로 재시도하여 추출. (text, title) 반환."""
    # 네이버 블로그 모바일 URL로 변환 (JS 렌더링 없이 본문 제공)
    mobile_url = re.sub(
        r"blog\.naver\.com/([^/]+)/(\d+)",
        r"m.blog.naver.com/\1/\2",
        url,
    )
    try:
        resp = httpx.get(mobile_url, follow_redirects=True, timeout=20, headers=_BROWSER_HEADERS)
        resp.raise_for_status()
    except Exception:
        return "", ""

    soup = BeautifulSoup(resp.content, "html.parser")

    # 모바일 블로그 본문 선택자 순서대로 시도
    for sel in [
        "div.se-main-container",   # 스마트에디터 본문
        "div#postViewArea",        # 구형 에디터
        "div.post_ct",
        "div#SE-TEXT-AREA",
        "article",
    ]:
        container = soup.select_one(sel)
        if container:
            for tag in container(["script", "style"]):
                tag.decompose()
            text = container.get_text(separator="\n", strip=True)
            if len(text) > 200:
                title_tag = soup.find("title")
                title = title_tag.string.strip() if title_tag else url
                return text, title

    return "", ""


def ingest_url(url: str, doc_id: str) -> tuple[int, str]:
    """웹 URL에서 텍스트를 추출하고 임베딩을 생성하여 저장. (청크 수, 페이지 제목) 반환."""
    try:
        response = httpx.get(url, follow_redirects=True, timeout=20, headers=_BROWSER_HEADERS)
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise ValueError(f"페이지를 가져올 수 없습니다 (HTTP {e.response.status_code}): {url}")
    except httpx.RequestError as e:
        raise ValueError(f"네트워크 오류로 페이지를 가져올 수 없습니다: {e}")

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type and "text" not in content_type:
        raise ValueError(
            f"HTML/텍스트가 아닌 콘텐츠입니다 (content-type: {content_type}). 일반 웹 페이지 URL을 입력하세요."
        )

    html_bytes = response.content
    text = ""
    title = url

    # ── 1단계: 네이버 블로그 전용 처리 ─────────────────────────────────
    if "blog.naver.com" in url or "m.blog.naver.com" in url:
        text, title = _fetch_naver_blog(url)

    # ── 2단계: trafilatura (일반 사이트 본문 추출) ──────────────────────
    if not text or len(text.strip()) < 200:
        extracted = trafilatura.extract(
            html_bytes,
            url=url,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_recall=True,
        )
        if extracted and len(extracted.strip()) >= 200:
            text = extracted
            meta = trafilatura.extract_metadata(html_bytes, default_url=url)
            if meta and meta.title:
                title = meta.title

    # ── 3단계: BS4 폴백 ────────────────────────────────────────────────
    if not text or len(text.strip()) < 200:
        soup = BeautifulSoup(html_bytes, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "button", "form", "noscript"]):
            tag.decompose()
        # 본문 영역 우선 탐색
        body = (
            soup.find("main")
            or soup.find("article")
            or soup.find(id=re.compile(r"(content|main|article|post)", re.I))
            or soup.find(class_=re.compile(r"(content|main|article|post|body)", re.I))
            or soup.body
        )
        raw = (body or soup).get_text(separator="\n", strip=True)
        if raw:
            text = raw
        # BS4에서 title 보완
        if title == url:
            soup_title = soup.find("title")
            if soup_title and soup_title.string:
                title = soup_title.string.strip()

    if not text or not text.strip():
        raise ValueError(
            "페이지에서 텍스트를 추출할 수 없습니다. "
            "JavaScript로만 렌더링되는 페이지는 지원되지 않을 수 있습니다."
        )

    # 연속 빈 줄 정리
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    chunks = _text_to_chunks(text)
    count = _store_chunks(doc_id, chunks, title, "url")
    return count, title


def ingest_youtube(url: str, doc_id: str) -> tuple[int, str]:
    """YouTube 영상의 자막을 추출하고 임베딩을 생성하여 저장. (청크 수, 영상 제목) 반환."""
    video_id = _extract_youtube_id(url)
    if not video_id:
        raise ValueError(f"유효하지 않은 YouTube URL입니다: {url}")

    api = YouTubeTranscriptApi()

    try:
        # 1단계: 한국어/영어 우선 시도
        fetched = api.fetch(video_id, languages=["ko", "ko-KR", "en", "en-US"])
        snippets = list(fetched)
    except Exception:
        try:
            # 2단계: 사용 가능한 자막 목록에서 첫 번째 언어로 시도
            transcript_list = api.list(video_id)
            transcript = transcript_list.find_generated_transcript(
                ["ko", "ko-KR", "en", "en-US"]
            )
            snippets = list(transcript.fetch())
        except Exception:
            try:
                transcript_list = api.list(video_id)
                # 수동/자동 구분 없이 아무 언어나 사용
                transcript = next(iter(transcript_list))
                snippets = list(transcript.fetch())
            except Exception as e:
                err_str = str(e).lower()
                if "disabled" in err_str or "no transcript" in err_str:
                    raise ValueError(f"이 영상에는 자막(CC)이 없거나 비활성화되어 있습니다: {video_id}")
                if "unavailable" in err_str or "private" in err_str:
                    raise ValueError(f"이 영상은 비공개이거나 재생할 수 없습니다: {video_id}")
                raise ValueError(f"자막을 가져올 수 없습니다: {e}")

    # snippet은 dict 또는 객체일 수 있음
    def _get_text(s) -> str:
        return s["text"] if isinstance(s, dict) else s.text

    text = " ".join(_get_text(s) for s in snippets)

    if not text.strip():
        raise ValueError("자막 내용이 비어 있습니다.")

    # 영상 제목을 oEmbed API로 가져옴
    try:
        oembed = httpx.get(
            f"https://www.youtube.com/oembed?url={url}&format=json",
            timeout=5,
            headers=_BROWSER_HEADERS,
        ).json()
        title = oembed.get("title", f"YouTube: {video_id}")
    except Exception:
        title = f"YouTube: {video_id}"

    chunks = _text_to_chunks(text)
    count = _store_chunks(doc_id, chunks, title, "youtube")
    return count, title


# ─────────────────────────────────────────────
# 검색
# ─────────────────────────────────────────────

def _get_relevant_chunks(doc_ids: list[str], question: str, top_k: int = TOP_K) -> list[str]:
    """단일 문서용: 질문과 코사인 유사도가 높은 상위 top_k 청크를 반환."""
    all_chunks: list[str] = []
    all_vecs: list[np.ndarray] = []

    for did in doc_ids:
        store = _doc_store.get(did)
        if not store or not store["chunks"]:
            continue
        all_chunks.extend(store["chunks"])
        all_vecs.append(store["embeddings"])

    if not all_chunks:
        return []

    chunk_vecs = np.vstack(all_vecs)
    query_vec = _embed([question])[0]
    scores = _cosine_similarity(query_vec, chunk_vecs)
    top_indices = np.argsort(scores)[::-1][:top_k]
    return [all_chunks[i] for i in top_indices]


def _get_chunks_per_doc(doc_ids: list[str], question: str, per_doc_k: int = 4) -> dict[str, list[str]]:
    """다중 문서용: 각 문서에서 독립적으로 top per_doc_k 청크 수집. {doc_id: [chunk, ...]} 반환."""
    query_vec = _embed([question])[0]
    result: dict[str, list[str]] = {}
    for did in doc_ids:
        store = _doc_store.get(did)
        if not store or not store["chunks"]:
            continue
        scores = _cosine_similarity(query_vec, store["embeddings"])
        top_indices = np.argsort(scores)[::-1][:per_doc_k]
        result[did] = [store["chunks"][i] for i in top_indices]
    return result


def _get_context(doc_ids: list[str], max_chars: int = 12000) -> str:
    """모든 청크를 이어붙인 컨텍스트 반환 (generate용 — 전체 문서 내용 필요)."""
    all_chunks: list[str] = []
    for did in doc_ids:
        store = _doc_store.get(did, {})
        all_chunks.extend(store.get("chunks", []))
    return "\n\n".join(all_chunks)[:max_chars]


# ─────────────────────────────────────────────
# 채팅 (RAG)
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
    """벡터 검색 기반 RAG 질의응답. (answer, sources) 반환."""
    loaded = [did for did in doc_ids if did in _doc_store and _doc_store[did].get("chunks")]
    missing_ids = [did for did in doc_ids if did not in loaded]

    if not loaded:
        raise ValueError(
            "선택된 소스의 데이터가 서버에 없습니다. "
            "소스를 삭제 후 다시 추가(재인덱싱)해 주세요."
        )

    # 일부 문서 데이터가 없는 경우 호출자에게 알림 (raise 하지 않고 계속 진행)
    missing_warn = ""
    if missing_ids:
        missing_warn = (
            f"⚠️ {len(missing_ids)}개 문서의 데이터가 서버에 없습니다. "
            "해당 소스를 삭제 후 다시 추가해주세요.\n\n"
        )

    level_hint = LEVEL_PROMPTS.get(level, LEVEL_PROMPTS["intermediate"])
    multi_doc = len(loaded) > 1
    doc_titles = {did: _doc_store[did].get("filename", did) for did in loaded}

    if multi_doc:
        # 각 문서에서 독립적으로 청크 수집 (per_doc_k=6으로 충분한 맥락 확보)
        per_doc_map = _get_chunks_per_doc(loaded, question, per_doc_k=6)
        tagged_parts: list[str] = []
        missing: list[str] = []
        for did in loaded:
            chunks = per_doc_map.get(did, [])
            title = doc_titles.get(did, did)
            if chunks:
                tagged_parts.append(f"=== 문서: {title} ===\n" + "\n\n".join(chunks))
            else:
                missing.append(title)
        context = "\n\n".join(tagged_parts)

        doc_list = "\n".join(f"- {doc_titles[d]}" for d in loaded)
        multi_instruction = f"""아래 {len(loaded)}개의 문서가 제공됩니다:
{doc_list}

[필수 규칙]
1. 위 문서 각각에 대해 반드시 모두 언급하며 답변하세요.
2. 각 문서의 내용을 설명할 때는 반드시 "**문서명** 에서는:" 또는 "**문서명** 에 따르면:" 형식으로 문서 이름을 명시하세요.
3. 어떤 문서도 빠뜨리지 마세요. 내용이 적더라도 해당 문서에서 찾을 수 있는 내용을 반드시 포함하세요."""
    else:
        relevant_chunks = _get_relevant_chunks(loaded, question)
        context = "\n\n".join(relevant_chunks)
        multi_instruction = ""

    system_msg = f"""당신은 학습 자료를 분석하는 AI 학습 코치입니다.
{multi_instruction}
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
    answer = missing_warn + (response.choices[0].message.content or "")

    sources = [
        _doc_store[did]["filename"]
        for did in doc_ids
        if did in _doc_store and _doc_store[did].get("filename")
    ]
    return answer, sources


# ─────────────────────────────────────────────
# 콘텐츠 생성 (요약 / 퀴즈 / 학습계획)
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
    loaded = [did for did in doc_ids if did in _doc_store]
    if not loaded:
        raise ValueError(
            "선택된 소스의 데이터가 서버에 없습니다. "
            "소스를 삭제 후 다시 추가(재인덱싱)해 주세요."
        )

    # 생성 작업은 전체 문서 내용이 필요하므로 기존 방식 유지
    context = _get_context(loaded, max_chars=10000)

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
반드시 아래 JSON 배열 형식만 출력하세요. 앞뒤에 다른 텍스트를 절대 추가하지 마세요:

[{{"question": "질문 내용", "options": ["선택지1", "선택지2", "선택지3", "선택지4"], "answer": 0, "hint": "정답을 직접 알려주지 말고 방향만 제시하는 힌트", "explanation": "정답 해설"}}]

규칙:
- answer는 정답 options의 0부터 시작하는 인덱스
- options는 반드시 4개
- hint는 정답을 직접 언급하지 말 것

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
    response = client.chat.completions.create(
        model=safe_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    return response.choices[0].message.content or ""
