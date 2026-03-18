"""
RAG 파이프라인 (Supabase 영속 저장, pdfplumber + OpenAI)

문서 청크는 Supabase document_chunks 테이블에 저장되어
서버 재시작 / 배포 후에도 데이터가 유지됩니다.
"""

import io
import json
import re
import pdfplumber
from openai import OpenAI
from app.core.config import settings
from app.core.supabase import supabase_admin

CHUNK_SIZE = 900
CHUNK_OVERLAP = 100


def _sanitize(text: str) -> str:
    """PostgreSQL TEXT에 저장할 수 없는 문자를 모두 제거."""
    # translate로 null 바이트 제거 (가장 확실한 방법)
    text = text.translate({0: None})
    # 그 외 제어 문자 제거 (\t=9, \n=10, \r=13 유지)
    text = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    # lone surrogate 등 UTF-8 불가 문자 제거
    text = text.encode('utf-8', errors='ignore').decode('utf-8')
    # 한 번 더 null 검증
    text = text.translate({0: None})
    return text


def _hard_sanitize(text: str) -> str:
    """최종 방어선: 문자 단위 순회로 NULL 바이트(ordinal 0)를 완전히 제거."""
    return "".join(ch for ch in text if ord(ch) != 0)


def _db_safe_insert(table: str, records: list[dict]) -> None:
    """PostgreSQL 22P05 오류 방지:
    supabase-py/httpx의 JSON 직렬화를 우회하여 직접 sanitized JSON 바이트를
    REST API로 전송. null byte(\u0000)가 절대 PostgREST에 전달되지 않도록 한다."""
    import httpx
    # 1) JSON 직렬화 후 \u0000 이스케이프(6글자) 제거
    serialized = json.dumps(records, ensure_ascii=True)
    cleaned = serialized.replace('\\u0000', '')
    # 2) 한 번 더 역직렬화 후 재직렬화 — 혹시 남은 null byte 완전 제거
    safe_records = json.loads(cleaned)
    final_json = json.dumps(safe_records, ensure_ascii=True).replace('\\u0000', '')
    final_bytes = final_json.encode('utf-8')

    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    batch_size = 50
    for i in range(0, len(safe_records), batch_size):
        batch_json = json.dumps(safe_records[i:i + batch_size], ensure_ascii=True)
        batch_json = batch_json.replace('\\u0000', '')
        print(f"[_db_safe_insert] batch {i//batch_size+1}, rows={min(batch_size, len(safe_records)-i)}")
        response = httpx.post(url, content=batch_json.encode('utf-8'), headers=headers, timeout=30)
        if response.status_code not in (200, 201):
            raise Exception(f"document_chunks insert 실패: {response.status_code} {response.text[:200]}")


def ingest_document(file_bytes: bytes, doc_id: str, filename: str = "") -> tuple[int, int]:
    """PDF 바이트를 청크로 분할하여 Supabase document_chunks에 저장.

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
                chunk = _hard_sanitize(_sanitize(text[i : i + CHUNK_SIZE]))
                if chunk.strip():
                    chunks.append(chunk)

    if not chunks:
        return 0, page_count

    records = [
        {"doc_id": doc_id, "chunk_index": idx, "content": content}
        for idx, content in enumerate(chunks)
    ]

    # 진단: null 바이트 잔존 여부 확인
    null_found = [(idx, r["content"].count('\x00')) for idx, r in enumerate(records) if '\x00' in r["content"]]
    if null_found:
        print(f"[WARNING] ingest_document: null bytes still present in {len(null_found)} chunks after sanitize!")
        for idx, cnt in null_found:
            records[idx]["content"] = _hard_sanitize(records[idx]["content"])
    else:
        print(f"[INFO] ingest_document: {len(records)} chunks, null bytes = 0 ✓")

    _db_safe_insert("document_chunks", records)

    return len(chunks), page_count


def _get_context(doc_ids: list[str], max_chars: int = 10000) -> str:
    """Supabase document_chunks에서 청크를 가져와 컨텍스트 문자열 반환."""
    if not doc_ids:
        return ""

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
    """Supabase documents 테이블에서 파일명 목록 조회."""
    if not doc_ids:
        return []

    result = (
        supabase_admin.table("documents")
        .select("filename")
        .in_("id", doc_ids)
        .execute()
    )
    return [row["filename"] for row in result.data]


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
    context = _get_context(doc_ids)
    level_hint = LEVEL_PROMPTS.get(level, LEVEL_PROMPTS["intermediate"])

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
    """2인 토크쇼 형식의 오디오 오버뷰 생성.

    Returns:
        (audio_bytes, script_text, title)
    """
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

    # 스크립트 텍스트 빌드
    script = "\n".join(
        f"{'Host A' if l.get('speaker') == 'A' else 'Host B'}: {l.get('text', '')}"
        for l in lines
    )

    # TTS 변환: A = alloy (여성), B = echo (남성)
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
    """문서 내용을 평면 노드 배열 형식의 마인드맵 JSON으로 변환.

    Returns:
        (nodes_list, title)
        nodes_list: [{"id": "root", "text": "..."}, {"id": "1", "text": "...", "parent": "root"}, ...]
    """
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
