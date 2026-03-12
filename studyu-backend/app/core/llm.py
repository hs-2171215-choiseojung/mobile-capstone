"""
LLM 추상화 레이어.

여러 LLM 제공자(OpenAI, Claude 등)를 통일된 인터페이스로 사용.
지금은 OpenAI만 구현하고, 나중에 Claude를 추가하면 됩니다.

사용법:
    from app.core.llm import get_provider
    provider = get_provider("openai")
    response = await provider.chat(messages=[...])
"""

from abc import ABC, abstractmethod
from openai import AsyncOpenAI
from app.core.config import settings


# ─────────────────────────────────────────────
# 추상 클래스 (모든 Provider가 따라야 하는 규격)
# ─────────────────────────────────────────────
class LLMProvider(ABC):
    """LLM 제공자의 공통 인터페이스."""

    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        stream: bool = False,
    ):
        """채팅 완성 요청."""
        ...

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """텍스트를 임베딩 벡터로 변환."""
        ...


# ─────────────────────────────────────────────
# OpenAI Provider
# ─────────────────────────────────────────────
class OpenAIProvider(LLMProvider):
    """OpenAI API를 사용하는 Provider."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.default_chat_model = "gpt-4o-mini"  # 비용 효율적인 기본 모델
        self.default_embed_model = "text-embedding-3-small"

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        stream: bool = False,
    ):
        """
        OpenAI 채팅 완성 요청.

        messages 형식:
            [
                {"role": "system", "content": "너는 학습 코치이다."},
                {"role": "user", "content": "프로세스와 스레드의 차이는?"}
            ]
        """
        response = await self.client.chat.completions.create(
            model=model or self.default_chat_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=stream,
        )

        if stream:
            return response  # AsyncIterator 반환 (스트리밍용)
        else:
            return response.choices[0].message.content

    async def embed(self, text: str) -> list[float]:
        """
        텍스트 → 임베딩 벡터 변환.
        RAG에서 문서 청크와 질문을 벡터로 만들 때 사용.
        """
        response = await self.client.embeddings.create(
            model=self.default_embed_model,
            input=text,
        )
        return response.data[0].embedding


# ─────────────────────────────────────────────
# Claude Provider (나중에 구현)
# ─────────────────────────────────────────────
class ClaudeProvider(LLMProvider):
    """Anthropic Claude API를 사용하는 Provider. (9주차에 구현 예정)"""

    def __init__(self):
        # from anthropic import AsyncAnthropic
        # self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        raise NotImplementedError("Claude Provider는 아직 구현되지 않았습니다.")

    async def chat(self, messages, **kwargs):
        raise NotImplementedError

    async def embed(self, text: str) -> list[float]:
        # Claude는 자체 임베딩이 없으므로 OpenAI 임베딩을 공유하거나
        # 다른 임베딩 모델을 사용
        raise NotImplementedError


# ─────────────────────────────────────────────
# Provider 팩토리 (이름으로 Provider 가져오기)
# ─────────────────────────────────────────────
_providers: dict[str, type[LLMProvider]] = {
    "openai": OpenAIProvider,
    # "claude": ClaudeProvider,  # 나중에 활성화
}


def get_provider(provider_name: str = "openai") -> LLMProvider:
    """
    이름으로 LLM Provider 인스턴스를 가져옵니다.

    사용법:
        provider = get_provider("openai")
        answer = await provider.chat(messages=[...])
    """
    if provider_name not in _providers:
        raise ValueError(
            f"지원하지 않는 LLM: '{provider_name}'. "
            f"사용 가능: {list(_providers.keys())}"
        )
    return _providers[provider_name]()
