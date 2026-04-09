"use client";

import { useState, useRef, useEffect } from 'react';
import { BotMessageSquare, Mic, Send, Paperclip, Loader2, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Doc {
  id: string;
  name: string;
}

export interface SourceChunk {
  num: number;
  doc_id: string;
  filename: string;
  chunk_index: number;
  text: string;
  char_offset?: number;
  char_length?: number;
}

interface StudentChatPanelProps {
  notebookId: string;
  userId?: string;
  activeDocIds: string[];
  docs: Doc[];
  selectedLLM?: string;
  selectedDifficulty?: string;
  activeSourceId?: string;
  activeSourceMediaType?: "audio" | "video" | null;
  activeSourceMediaDuration?: number;
  onSeekToTimestamp?: (seconds: number) => void;
  onClose?: () => void;
  onCitationClick?: (chunk: SourceChunk) => void;
  onSlideClick?: (slideNum: number) => void;
}

interface ChatReference {
  doc_id: string;
  filename: string;
  chunk_index: number;
  total_chunks: number;
  start_sec?: number | null;
  end_sec?: number | null;
  excerpt: string;
}

interface ChatMessage {
  type: 'user' | 'ai' | 'system';
  content: string;
  sources?: SourceChunk[];
  references?: ChatReference[];
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getReferenceSeconds(reference: ChatReference, duration: number) {
  if (typeof reference.start_sec === "number" && Number.isFinite(reference.start_sec)) {
    return Math.max(0, reference.start_sec);
  }
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(reference.total_chunks) || reference.total_chunks <= 0) return null;
  const ratio = (reference.chunk_index + 0.5) / reference.total_chunks;
  return Math.max(0, Math.min(duration, duration * ratio));
}

function isApproximateReference(reference: ChatReference) {
  return !(typeof reference.start_sec === "number" && Number.isFinite(reference.start_sec));
}

function parseTimestampToSeconds(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^((\d+):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;
  const hours = match[2] ? Number(match[2]) : 0;
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function containsTimestampText(content: string) {
  return /\b(?:(\d+):)?([0-5]?\d):([0-5]\d)\b/.test(content);
}

function collapseNearbyTimestampLists(content: string) {
  const timestampPattern = /(?:(?:\d+):)?(?:[0-5]?\d):(?:[0-5]\d)/;
  const listPattern = new RegExp(`${timestampPattern.source}(?:\\s*,\\s*${timestampPattern.source})+`, "g");

  return content.replace(listPattern, (matched) => {
    const rawParts = matched.split(/\s*,\s*/).filter(Boolean);
    const parsed = rawParts
      .map((part) => ({ raw: part, seconds: parseTimestampToSeconds(part) }))
      .filter((item): item is { raw: string; seconds: number } => item.seconds !== null);

    if (parsed.length < 2) {
      return matched;
    }

    const groups: Array<{ start: number; end: number }> = [];
    parsed.forEach(({ seconds }) => {
      const current = groups[groups.length - 1];
      if (!current) {
        groups.push({ start: seconds, end: seconds });
        return;
      }

      if (seconds - current.end <= 12) {
        current.end = seconds;
        return;
      }

      groups.push({ start: seconds, end: seconds });
    });

    return groups
      .map((group) =>
        group.start === group.end
          ? formatTimestamp(group.start)
          : `${formatTimestamp(group.start)}-${formatTimestamp(group.end)}`
      )
      .join(", ");
  });
}

function injectReferenceTimesIntoAnswer(
  content: string,
  mediaReferences: Array<{ reference: ChatReference; seconds: number }>
) {
  if (!content.trim() || mediaReferences.length === 0 || containsTimestampText(content)) {
    return content;
  }

  const uniqueTimes = mediaReferences
    .map(({ seconds }) => formatTimestamp(seconds))
    .filter((time, index, arr) => arr.indexOf(time) === index);

  if (uniqueTimes.length === 0) {
    return content;
  }

  const lines = content.split("\n");
  let timeIndex = 0;
  let numberedLineCount = 0;
  let appliedInlineTime = false;

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    const isNumbered = /^\d+\.\s+/.test(trimmed);
    const isBullet = /^[-*]\s+/.test(trimmed);

    if (!isNumbered && !isBullet) {
      return line;
    }
    if (containsTimestampText(line)) {
      return line;
    }

    const nextTime = uniqueTimes[Math.min(timeIndex, uniqueTimes.length - 1)];
    if (!nextTime) {
      return line;
    }

    if (isNumbered) {
      numberedLineCount += 1;
      timeIndex += 1;
    } else if (numberedLineCount === 0) {
      timeIndex += 1;
    }

    const boldTitleMatch = line.match(/^(\s*(?:\d+\.|[-*])\s+\*\*[^*]+\*\*)(.*)$/);
    if (boldTitleMatch) {
      appliedInlineTime = true;
      return `${boldTitleMatch[1]}(${nextTime})${boldTitleMatch[2]}`;
    }

    const plainTitleMatch = line.match(/^(\s*(?:\d+\.|[-*])\s+[^:：]+)(:\s*.*)$/);
    if (plainTitleMatch) {
      appliedInlineTime = true;
      return `${plainTitleMatch[1]}(${nextTime})${plainTitleMatch[2]}`;
    }

    appliedInlineTime = true;
    return `${line} (${nextTime})`;
  });

  if (appliedInlineTime) {
    return updatedLines.join("\n");
  }

  const sentenceParts = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length === 0) {
    return content;
  }

  const inlineSentences = sentenceParts.map((sentence, index) => {
    if (containsTimestampText(sentence)) {
      return sentence;
    }

    const nextTime = uniqueTimes[Math.min(index, uniqueTimes.length - 1)];
    if (!nextTime) {
      return sentence;
    }

    const featureMatch = sentence.match(/^(기능\s*\d+)/);
    if (featureMatch) {
      return `${featureMatch[1]}(${nextTime}): ${sentence}`;
    }

    const titleMatch = sentence.match(/^([^:：]{2,24}?)(은|는|이|가)\s+/);
    if (titleMatch) {
      return `${titleMatch[1]}(${nextTime})${titleMatch[2]} ${sentence.slice(titleMatch[0].length)}`;
    }

    return `${sentence} (${nextTime})`;
  });

  return inlineSentences.join("\n");
}
function renderWithCitations(
  content: string,
  sources: SourceChunk[],
  onCitationClick?: (chunk: SourceChunk) => void,
  renderText?: (text: string) => any,
) {
  const parts = content.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = parseInt(match[1], 10);
      const chunk = sources.find((s) => s.num === num);
      if (chunk) {
        return (
          <button
            key={i}
            onClick={() => onCitationClick?.(chunk)}
            title={chunk.text}
            className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-[#155dfc] text-white text-[9px] font-bold mx-0.5 align-super leading-none hover:bg-[#0d4ac4] transition-colors shrink-0"
          >
            {num}
          </button>
        );
      }
    }
    return <span key={i}>{renderText ? renderText(part) : part}</span>;
  });
}

export function StudentChatPanel({
  activeDocIds,
  docs,
  notebookId,
  selectedLLM,
  selectedDifficulty,
  activeSourceId,
  activeSourceMediaType,
  activeSourceMediaDuration,
  onSeekToTimestamp,
  onClose,
  onCitationClick,
  onSlideClick,
}: StudentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  interface Suggestion { text: string; category: "이해" | "분석" | "적용"; }
  const CATEGORY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
    이해: { bg: "bg-blue-50",   text: "text-blue-600",  border: "border-blue-200" },
    분석: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200" },
    적용: { bg: "bg-green-50",  text: "text-green-600",  border: "border-green-200" },
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([
    { text: "이 자료의 핵심 개념을 설명해줘", category: "이해" },
    { text: "주요 내용들 간의 관계를 분석해줘", category: "분석" },
    { text: "실제로 어떻게 활용할 수 있을까?", category: "적용" },
  ]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const askedQuestionsRef = useRef<string[]>([]);
  const clickedIndexRef = useRef<number>(-1);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 자료별 채팅 키: 선택된 doc ID 기반 (없으면 노트북 전체)
  const chatKey = activeDocIds.length > 0
    ? `studyu_chat_${notebookId}_doc_${[...activeDocIds].sort().join('_')}`
    : `studyu_chat_${notebookId}`;

  const chatKeyRef = useRef(chatKey);

  // activeDocIds 변경 시 추천 질문 fetch
  useEffect(() => {
    const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);
    if (targetDocIds.length === 0) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    getToken().then((token) =>
      fetch(`${API}/api/chat/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doc_ids: targetDocIds, asked_questions: [] }),
      })
        .then((r) => r.json())
        .then((data) => { if (!cancelled && data.questions?.length) setSuggestions(data.questions.slice(0, 3) as Suggestion[]); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setSuggestionsLoading(false); })
    );
    askedQuestionsRef.current = [];
    return () => { cancelled = true; };
  }, [activeDocIds.join(","), docs.map(d => d.id).join(",")]);

  // activeDocIds 변경 시 해당 자료의 채팅 히스토리 로드
  useEffect(() => {
    chatKeyRef.current = chatKey;
    setIsLoaded(false);
    const savedMessages = localStorage.getItem(chatKey);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
    setIsLoaded(true);
  }, [chatKey]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(chatKeyRef.current, JSON.stringify(messages));
    }
    
    if (messagesEndRef.current) {
      const scrollContainer = messagesEndRef.current.parentElement;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
      }
    }
  }, [messages, isLoaded]);

  // 대화 내역 초기화 기능
  const handleClearChat = () => {
    if (confirm("대화 내역을 모두 지우시겠습니까?")) {
      setMessages([]);
      localStorage.removeItem(chatKeyRef.current);
    }
  };

  const getToken = async () => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || "";
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    setInputValue(''); 
    setIsLoading(true);

    try {
      const token = await getToken();
      const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);

      if (targetDocIds.length === 0) {
        throw new Error("학습할 소스(문서)가 없습니다. 강사님께 자료 업로드를 요청해 주세요.");
      }

      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          doc_ids: targetDocIds,
          question: userMessage,
          model: selectedLLM || "gpt-4o-mini",
          level: selectedDifficulty || "intermediate",
          session_id: notebookId 
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "AI 응답을 가져오는데 실패했습니다.");
      }

      const data = await res.json();
      setMessages(prev => [
        ...prev,
        {
          type: 'ai',
          content: collapseNearbyTimestampLists(data.answer ?? ""),
          references: Array.isArray(data.references) ? data.references : [],
          sources: Array.isArray(data.sources) ? data.sources : [],
        },
      ]);

      // PPT 추천 질문이 있으면 칩 전체 교체 (기존 setSuggestions 방식 그대로)
      const pptSuggestions: string[] = Array.isArray(data.suggested_questions) ? data.suggested_questions : [];
      if (pptSuggestions.length > 0) {
        const CATS: Array<"이해" | "분석" | "적용"> = ["이해", "분석", "적용"];
        setSuggestions(pptSuggestions.slice(0, 3).map((text, i) => ({ text, category: CATS[i % 3] })) as Suggestion[]);
      }

      // 클릭한 인덱스 자리만 새 질문으로 교체
      askedQuestionsRef.current = [...askedQuestionsRef.current, userMessage].slice(-6);
      const replacingIndex = clickedIndexRef.current;
      clickedIndexRef.current = -1; // 리셋
      if (replacingIndex >= 0 && pptSuggestions.length === 0) {
        setSuggestions((prev) => {
          const currentTexts = prev.map((s) => s.text);
          getToken().then((t) =>
            fetch(`${API}/api/chat/suggestions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
              body: JSON.stringify({
                doc_ids: targetDocIds,
                asked_questions: [...askedQuestionsRef.current, ...currentTexts],
              }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (d.questions?.length) {
                  setSuggestions((p) => {
                    const next = [...p];
                    next[replacingIndex] = d.questions[0] as Suggestion;
                    return next;
                  });
                }
              })
              .catch(() => {})
          );
          return prev;
        });
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { type: 'system', content: `[오류] ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (content: string, enableTimestampLinks: boolean) => {
    const hasSlideRefs = onSlideClick && /\[슬라이드\s*\d+\]/g.test(content);
    if (!enableTimestampLinks && !hasSlideRefs) {
      return <>{content}</>;
    }

    // Combined pattern: timestamp ranges OR [슬라이드 N]
    const combinedPattern = /(\[슬라이드\s*(\d+)\])|(\b(?:(\d+):)?([0-5]?\d):([0-5]\d)\b(?:\s*-\s*\b(?:(\d+):)?([0-5]?\d):([0-5]\d)\b)?)/g;
    const matches = Array.from(content.matchAll(combinedPattern));

    if (matches.length === 0) {
      return <>{content}</>;
    }

    const nodes: JSX.Element[] = [];
    let lastIndex = 0;

    matches.forEach((match, index) => {
      const matchedText = match[0];
      const matchIndex = match.index ?? 0;
      const isSlideRef = Boolean(match[1]); // [슬라이드 N] group
      const slideNum = match[2] ? parseInt(match[2], 10) : null;

      if (matchIndex > lastIndex) {
        nodes.push(<span key={`text-${index}-${lastIndex}`}>{content.slice(lastIndex, matchIndex)}</span>);
      }

      if (isSlideRef && slideNum !== null && onSlideClick) {
        nodes.push(
          <button
            key={`slide-${index}-${slideNum}`}
            type="button"
            onClick={() => onSlideClick(slideNum)}
            className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
          >
            {matchedText}
          </button>
        );
      } else if (!isSlideRef && enableTimestampLinks) {
        const rangeStart = matchedText.split(/\s*-\s*/)[0] ?? matchedText;
        const seconds = parseTimestampToSeconds(rangeStart);
        if (seconds === null) {
          nodes.push(<span key={`raw-${index}`}>{matchedText}</span>);
        } else {
          nodes.push(
            <button
              key={`ts-${index}-${matchedText}`}
              type="button"
              onClick={() => onSeekToTimestamp?.(seconds)}
              className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
            >
              {matchedText}
            </button>
          );
        }
      } else {
        nodes.push(<span key={`raw-${index}`}>{matchedText}</span>);
      }

      lastIndex = matchIndex + matchedText.length;
    });

    if (lastIndex < content.length) {
      nodes.push(<span key={`tail-${lastIndex}`}>{content.slice(lastIndex)}</span>);
    }

    return <>{nodes}</>;
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* 헤더 */}
      <div className="p-4 border-b border-[#e7e9ed] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <BotMessageSquare className="w-5 h-5 text-[#155dfc]" />
          <h2 className="text-[14px] font-semibold text-[#1a1d26]">Ask AI</h2>
        </div>

        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="p-1.5 text-[#99a1af] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              title="대화 내역 지우기"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-[#99a1af] hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 메시지 리스트 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col h-full">
            {/* 인트로 */}
            <div className="flex flex-col items-start gap-2 mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#155dfc]">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor"/>
              </svg>
              <p className="text-[13px] text-[#414751] leading-relaxed">
                안녕하세요! 학습 중 궁금한 점이 있으신가요?<br />
                최선을 다해 도와드리겠습니다.
              </p>
              <p className="text-[11px] text-[#99a1af]">
                어떻게 질문해야 할지 모르겠다면 아래 예시를 눌러보세요.
              </p>
            </div>
            {/* 추천 질문 칩 */}
            <div className="flex flex-col items-end gap-2">
              {[
                "이 자료를 요약해줘",
                "핵심 개념을 설명해줘",
                "어려운 부분을 쉽게 설명해줘",
                "중요한 용어를 정리해줘",
                "퀴즈 문제를 내줘",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInputValue(q); }}
                  className="px-3 py-1.5 rounded-full border border-[#e7e9ed] bg-white text-[12px] text-[#414751] hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-blue-50 transition-colors text-right"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {messages.map((msg, index) => {
          const enrichedContent = msg.content;

          return (
            <div key={index} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%] space-y-2">
                <div
                  className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
                    msg.type === 'user'
                      ? 'bg-[#155dfc] text-white rounded-tr-sm'
                      : msg.type === 'system'
                      ? 'bg-red-50 text-red-600 border border-red-100'
                      : 'bg-[#f8f9fb] text-[#1a1d26] border border-[#e7e9ed] rounded-tl-sm'
                  }`}
                >
                  {msg.type === 'ai' && msg.sources && msg.sources.length > 0 ? (
                    <span className="whitespace-pre-wrap">
                      {renderWithCitations(
                        enrichedContent,
                        msg.sources,
                        onCitationClick,
                        (part) =>
                          renderMessageContent(
                            part,
                            msg.type === "ai" && Boolean(activeSourceId && activeSourceMediaType && onSeekToTimestamp)
                          )
                      )}
                    </span>
                  ) : renderMessageContent(
                    enrichedContent,
                    msg.type === "ai" && Boolean(activeSourceId && activeSourceMediaType && onSeekToTimestamp)
                  )}
                </div>
              </div>
            </div>
          );
        })}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-3 bg-[#f8f9fb] text-[#1a1d26] border border-[#e7e9ed] rounded-2xl rounded-tl-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#155dfc]" />
              <span className="text-[13px] text-[#99a1af] font-medium">AI가 답변을 작성 중입니다...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 추천 질문 — 채팅 시작 후에만 표시 */}
      {messages.length > 0 && <div className="shrink-0 px-3 py-3 border-t border-[#e7e9ed] bg-[#f8f9fb]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-[#99a1af] flex items-center gap-1.5">
            <span className="text-amber-400 text-xs">✦</span>
            이런 건 어떠세요?
          </span>
          <button
            onClick={() => {
              const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);
              if (!targetDocIds.length || suggestionsLoading) return;
              setSuggestionsLoading(true);
              getToken().then((token) =>
                fetch(`${API}/api/chat/suggestions`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ doc_ids: targetDocIds, asked_questions: [...askedQuestionsRef.current, ...suggestions.map(s => s.text)] }),
                })
                  .then((r) => r.json())
                  .then((d) => { if (d.questions?.length) setSuggestions(d.questions.slice(0, 3) as Suggestion[]); })
                  .catch(() => {})
                  .finally(() => setSuggestionsLoading(false))
              );
            }}
            disabled={suggestionsLoading}
            title="새 질문 추천받기"
            className="p-1 rounded-md text-[#c8cdd5] hover:text-[#155dfc] hover:bg-white transition-all disabled:opacity-30"
          >
            <svg className={`w-3.5 h-3.5 ${suggestionsLoading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none">
              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {suggestionsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 rounded-lg bg-[#e7e9ed]/60 animate-pulse" />
              ))
            : suggestions.map((s, i) => {
                const borderColor = ["border-l-blue-400", "border-l-purple-400", "border-l-emerald-400"][i] ?? "border-l-blue-400";
                return (
                  <button
                    key={s.text}
                    onClick={() => { clickedIndexRef.current = i; setInputValue(s.text); }}
                    disabled={isLoading}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2.5 bg-white rounded-lg border border-[#e7e9ed] border-l-2 ${borderColor} text-left hover:border-[#c8cdd5] hover:shadow-sm transition-all disabled:opacity-40 group`}
                  >
                    <span className="text-[12px] text-[#414751] flex-1 leading-snug">{s.text}</span>
                    <svg className="w-3.5 h-3.5 text-[#c8cdd5] group-hover:text-[#155dfc] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                );
              })
          }
        </div>
      </div>}

      {/* 입력 영역 */}
      <div className="p-3 bg-white flex flex-col gap-2 shrink-0">
        <div className="relative flex items-end gap-2 bg-[#f8f9fb] rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-[#155dfc]/20 transition-all border border-[#e7e9ed] focus-within:border-[#155dfc]/30 shadow-sm">
          <button className="p-2 text-[#99a1af] hover:text-[#155dfc] hover:bg-white rounded-lg transition-colors shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            rows={1}
            className="flex-1 max-h-[100px] min-h-[40px] py-2 bg-transparent text-[#1a1d26] text-[13px] placeholder-[#99a1af] focus:outline-none resize-none self-center"
            placeholder="학습 내용에 대해 무엇이든 물어보세요..."
          />
          
          <div className="flex items-center gap-1 shrink-0">
            <button className="p-2 text-[#99a1af] hover:text-[#155dfc] hover:bg-white rounded-lg transition-colors">
              <Mic className="w-4 h-4" />
            </button>
            <button 
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="p-2 text-white bg-[#155dfc] hover:bg-[#0d4ac4] rounded-lg disabled:opacity-50 disabled:bg-[#99a1af] transition-colors shadow-sm"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
