"""
경량 RAG 파이프라인 (in-memory, pdfplumber + OpenAI)
chromadb 없이 pdfplumber로 텍스트 추출 후 OpenAI로 답변 생성.
"""

import pdfplumber
from openai import OpenAI
from app.core.config import settings

# in-memory 문서 저장소: doc_id -> {"chunks": [str], "filename": str}
_doc_store: dict[str, dict] = {}

CHUNK_SIZE = 900
CHUNK_OVERLAP = 100


def ingest_document(file_path: str, doc_id: str, filename: str = "") -> int:
    """PDF를 청크로 분할하여 메모리에 저장. 청크 수 반환."""
    chunks: list[str] = []

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            text = text.strip()
            if not text:
                continue
            # 페이지 텍스트를 CHUNK_SIZE 단위로 분할
            step = CHUNK_SIZE - CHUNK_OVERLAP
            for i in range(0, len(text), step):
                chunk = text[i : i + CHUNK_SIZE]
                if chunk.strip():
                    chunks.append(chunk)

    _doc_store[doc_id] = {"chunks": chunks, "filename": filename}
    return len(chunks)


def _get_context(doc_ids: list[str], max_chars: int = 12000) -> str:
    """여러 문서의 청크를 합쳐서 컨텍스트 문자열 반환."""
    all_chunks: list[str] = []
    for did in doc_ids:
        store = _doc_store.get(did, {})
        all_chunks.extend(store.get("chunks", []))
    return "\n\n".join(all_chunks)[:max_chars]


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

    sources = [
        _doc_store[did]["filename"]
        for did in doc_ids
        if did in _doc_store and _doc_store[did].get("filename")
    ]
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
