"use client";

import { useState, useRef, useEffect } from 'react';
import { BotMessageSquare, Mic, Send, Paperclip, Loader2, Trash2, X, Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import MarkdownPreview from '@/components/workspace/MarkdownPreview';
import { useSTT } from '@/hooks/useSTT';

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
  activeSourceSummary?: MediaSummary | null;
  activeSourceSummaryLoading?: boolean;
  canOpenSummary?: boolean;
  onOpenSummary?: () => void;
  onDeleteSummary?: () => Promise<void> | void;
  onSeekToTimestamp?: (seconds: number) => void;
  onClose?: () => void;
  onCitationClick?: (chunk: SourceChunk) => void;
  onSlideClick?: (slideNum: number) => void;
  onPageClick?: (pageNum: number) => void;
  currentSlide?: number | null;
}

interface MediaSummarySection {
  title: string;
  summary: string;
  start_sec?: number | null;
  end_sec?: number | null;
}

interface MediaSummary {
  title?: string;
  overview?: string;
  sections?: MediaSummarySection[];
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

// ── 음성 목록 ────────────────────────────────────────────────
const VOICES = [
  { key: "sarah",  label: "Sarah",  desc: "차분한 여성" },
  { key: "rachel", label: "Rachel", desc: "명확한 여성" },
  { key: "josh",   label: "Josh",   desc: "친근한 남성" },
  { key: "adam",   label: "Adam",   desc: "전문적인 남성" },
] as const;
type VoiceKey = typeof VOICES[number]["key"];

type WordSegment = { text: string; start: number; end: number };
type CachedAudio = { audioBase64: string; words: WordSegment[] };

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

const MAX_TTS_CHARS = 1500;

/** TTS 전송 전 마크다운 기호 제거 + 길이 제한 */
function prepareTtsText(raw: string): string {
  return raw
    .replace(/#{1,6}\s*/g, '')                        // ## 헤더
    .replace(/\*\*([^*]+)\*\*/g, '$1')                // **굵게**
    .replace(/\*([^*]+)\*/g, '$1')                    // *기울임*
    .replace(/```[^\n]*\n[\s\S]*?```/g, '코드 블록')    // ```여러 줄 코드블록``` → "코드 블록"
    .replace(/`([^`\n]+)`/g, '$1')                    // `한 줄 코드` → 내용만 읽음
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')          // [링크](url)
    .replace(/^\s*[-*+]\s+/gm, '')                    // - 목록
    .replace(/^\s*\d+\.\s+/gm, '')                    // 1. 번호 목록
    .replace(/\[슬라이드\s*(\d+[^\]]*)\]/g, '슬라이드 $1') // [슬라이드 3] → "슬라이드 3"
    .replace(/\[페이지\s*(\d+[^\]]*)\]/g, '페이지 $1')     // [페이지 5] → "페이지 5"
    .replace(/\[출처[^\]]*\]/g, '')                   // [출처 N] — 출처 레이블은 제거
    .replace(/\[\d+\]/g, '')                          // [1] 인용번호 제거
    .replace(/\n{3,}/g, '\n\n')                       // 연속 빈 줄
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

const DEFAULT_INITIAL_QUESTIONS = [
  "이 자료 요약해줘.",
  "핵심 개념이 뭐야?",
  "어떤 부분이 제일 중요해?",
];

// ── IndexedDB 헬퍼 ───────────────────────────────────────────
const IDB_NAME  = 'studyu_audio_cache';
const IDB_STORE = 'audio';

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function idbGet(key: string): Promise<CachedAudio | undefined> {
  const db = await idbOpen();
  return new Promise(resolve => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror   = () => resolve(undefined);
  });
}
async function idbSet(key: string, value: CachedAudio): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function formatTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTimestampRange(startSec?: number | null, endSec?: number | null) {
  const hasStart = typeof startSec === "number" && Number.isFinite(startSec);
  const hasEnd = typeof endSec === "number" && Number.isFinite(endSec);
  if (hasStart && hasEnd && endSec! > startSec!) {
    return `${formatTimestamp(startSec!)} - ${formatTimestamp(endSec!)}`;
  }
  if (hasStart) {
    return formatTimestamp(startSec!);
  }
  return "";
}

function stripSummaryEvidenceBlocks(markdown: string) {
  const lines = (markdown || "").split("\n");
  const cleaned: string[] = [];
  let currentHeading = "";
  let skippingEvidence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      currentHeading = trimmed.slice(3).trim();
      skippingEvidence = false;
      cleaned.push(line);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const isOverviewBlock = currentHeading === "개요" || currentHeading.toLowerCase() === "overview";
      if (!isOverviewBlock) {
        skippingEvidence = true;
        continue;
      }
    }

    if (skippingEvidence && !trimmed) {
      continue;
    }

    skippingEvidence = false;
    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

function normalizeDetachedPageRefs(content: string) {
  return content
    .replace(/\s*\n+\s*(\[(?:출처\s*\d+\s*,\s*)?페이지\s*\d+[^\]]*\])\s*\n+\s*([.,!?])/g, " $1$2")
    .replace(/([^\n])\s*\n+\s*(\[(?:출처\s*\d+\s*,\s*)?페이지\s*\d+[^\]]*\])\s*\n+\s*/g, "$1 $2 ")
    .replace(/\s{2,}/g, " ");
}

function normalizeInlineListMarkers(content: string) {
  return content
    .replace(/:\s+([*-]\s+(?=\S))/g, ":\n$1")
    .replace(/:\s+(\d+\.\s+(?=\S))/g, ":\n$1")
    .replace(/([.!?])\s+([*-]\s+(?=\S))/g, "$1\n$2")
    .replace(/([.!?])\s+(\d+\.\s+(?=\S))/g, "$1\n$2");
}

const mdContentRegex = /^[ \t]*[#\-*>|]|^[ \t]*\d+\. |[가-힣]/;
function fixMarkdownCodeFences(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inBlock = false;
  let openIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (!inBlock) {
        inBlock = true;
        openIdx = result.length;
        result.push(line); // 일단 push, 닫을 때 결정
      } else {
        inBlock = false;
        const inner = result.slice(openIdx + 1);
        const hasMarkdown = inner.some(l => mdContentRegex.test(l));
        if (hasMarkdown) {
          result.splice(openIdx, 1); // opening fence 제거
          const afterClose = line.slice(3).trim();
          if (afterClose) result.push(afterClose); // ``` 뒤 내용 보존
        } else {
          result.push(line); // 실제 코드블록: closing fence 유지
        }
      }
    } else {
      result.push(line);
    }
  }

  // 스트리밍 중 unclosed block 처리
  if (inBlock) {
    const inner = result.slice(openIdx + 1);
    if (inner.some(l => mdContentRegex.test(l))) {
      result.splice(openIdx, 1);
    }
  }

  return result.join('\n');
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
      // 소스 인용 번호 숨김
      return <span key={i} />;
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
  activeSourceSummary,
  activeSourceSummaryLoading = false,
  canOpenSummary = false,
  onOpenSummary,
  onDeleteSummary,
  onSeekToTimestamp,
  onClose,
  onCitationClick,
  onSlideClick,
  onPageClick,
  currentSlide,
}: StudentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isDeletingSummary, setIsDeletingSummary] = useState(false);
  interface Suggestion { text: string; category: "이해" | "분석" | "적용"; isOld?: boolean; }

  // 자료별 채팅 키: 선택된 doc ID 기반 (없으면 노트북 전체)
  const chatKey = activeDocIds.length > 0
    ? `studyu_chat_${notebookId}_doc_${[...activeDocIds].sort().join('_')}`
    : `studyu_chat_${notebookId}`;

  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => {
    // 마운트 시 localStorage에서 즉시 복원 (effect 순서 문제 회피)
    try {
      const saved = localStorage.getItem(`${chatKey}_suggestions`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Suggestion[];
      }
    } catch {}
    return [
      { text: "이 자료 요약해줘.", category: "이해" },
      { text: "핵심 개념이 뭐야?", category: "분석" },
      { text: "어떤 부분이 제일 중요해?", category: "적용" },
    ];
  });
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [initialQuestions, setInitialQuestions] = useState<string[]>(DEFAULT_INITIAL_QUESTIONS);
  const askedQuestionsRef = useRef<string[]>([]);
  const suggestionFromChatRef = useRef(false);
  const suggestionFetchAbortRef = useRef<AbortController | null>(null);
  const suggestionsRef = useRef<Suggestion[]>(suggestions);
  const lastAnswerRef = useRef<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatKeyRef = useRef(chatKey);
  const mediaSummarySections = activeSourceSummary?.sections ?? [];
  const hasMediaSummary = Boolean(
    activeSourceSummary && (
      (activeSourceSummary.overview && activeSourceSummary.overview.trim()) ||
      mediaSummarySections.some((section) => section?.summary?.trim())
    )
  );
  const mediaSummaryMarkdown = hasMediaSummary
    ? [
        activeSourceSummary?.title?.trim() ? `# ${activeSourceSummary.title.trim()}` : "# 자료 요약",
        activeSourceSummary?.overview?.trim() || "",
        ...mediaSummarySections.flatMap((section, index) => ([
          `## ${section.title?.trim() || `요약 ${index + 1}`}`,
          section.summary?.trim() || "",
        ])),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const showSummaryButton = canOpenSummary || hasMediaSummary || activeSourceSummaryLoading;
  const summaryButtonLabel = activeSourceSummaryLoading && !hasMediaSummary ? "요약 준비 중" : "요약";
  const summaryButtonTitle = activeSourceSummaryLoading && !hasMediaSummary ? "요약을 준비하고 있어요" : "요약 보기";
  const summaryReportMarkdown = hasMediaSummary
    ? [
        activeSourceSummary?.title?.trim() ? `# ${activeSourceSummary.title.trim()}` : "# 자료 요약",
        "> 시간 흐름에 따라 정리된 학습용 요약 보고서",
        "## 개요",
        activeSourceSummary?.overview?.trim() || "요약 개요가 아직 준비되지 않았습니다.",
        ...mediaSummarySections.flatMap((section, index) => {
          const timeRange = formatTimestampRange(section.start_sec, section.end_sec);
          return [
            `## ${(section.title?.trim() || `요약 ${index + 1}`)}${timeRange ? ` · ${timeRange}` : ""}`,
            section.summary?.trim() || "이 구간의 요약이 아직 준비되지 않았습니다.",
          ];
        }),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  useEffect(() => {
    setIsSummaryOpen(false);
  }, [activeSourceId]);

  useEffect(() => {
    if (!hasMediaSummary && !activeSourceSummaryLoading) {
      setIsSummaryOpen(false);
    }
  }, [hasMediaSummary, activeSourceId, activeSourceSummaryLoading]);

  // ── 음성 재생 상태 ────────────────────────────────────────
  const [voiceMode,        setVoiceMode]        = useState(false);
  const [podcastMode,      setPodcastMode]      = useState(false);
  const [selectedVoice,    setSelectedVoice]    = useState<VoiceKey>("sarah");
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const [playbackRate,     setPlaybackRate]     = useState<number>(() =>
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('studyu_playback_rate') || '1')
      : 1
  );
  const [speakingMsgIdx,   setSpeakingMsgIdx]   = useState<number | null>(null);
  const [loadingAudioIdx,  setLoadingAudioIdx]  = useState<number | null>(null);
  const [audioProgress,    setAudioProgress]    = useState<number>(0);

  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const wordsRef         = useRef<WordSegment[]>([]);
  const playbackRateRef  = useRef<number>(
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('studyu_playback_rate') || '1')
      : 1
  );
  const audioCacheRef    = useRef<Map<string, CachedAudio>>(new Map());
  const autoSpeakRef     = useRef<string | null>(null);
  const podcastModeRef   = useRef(false);
  const messagesRef      = useRef<any[]>([]);
  const podcastNextRef   = useRef<number | null>(null);
  // in-flight TTS fetch가 도착했을 때 대상이 바뀌었으면 버리기 위한 토큰
  const speakTargetRef   = useRef<number | null>(null);

  // ── STT ─────────────────────────────────────────────────
  const {
    isRecording,
    interimText,
    sttError,
    start: startSTT,
    stop: stopSTT,
    clearError: clearSttError,
  } = useSTT({
    onResult: (text) => setInputValue(text),
    onError: () => {},
  });

  // 항상 최신 값을 ref에 동기화 (stale closure 방지)
  podcastModeRef.current = podcastMode;
  messagesRef.current    = messages;

  // 언마운트 시 오디오·마이크 정리
  useEffect(() => {
    return () => {
      stopSpeaking();
      audioCacheRef.current.clear();
      stopSTT();
    };
  }, []);

  // activeDocIds 변경 시 추천 질문 fetch (localStorage에 없을 때만)
  useEffect(() => {
    const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);
    if (targetDocIds.length === 0) return;
    suggestionFromChatRef.current = false;

    // localStorage에 저장된 추천 질문 복원 시도
    const savedKey = `${chatKey}_suggestions`;
    const saved = localStorage.getItem(savedKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSuggestions(parsed as Suggestion[]);
          askedQuestionsRef.current = [];
          return;
        }
      } catch {}
    }

    // 없으면 fetch
    const abort = new AbortController();
    suggestionFetchAbortRef.current = abort;
    setSuggestionsLoading(true);
    getToken().then((token) =>
      fetch(`${API}/api/chat/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doc_ids: targetDocIds, asked_questions: [] }),
        signal: abort.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (!abort.signal.aborted && !suggestionFromChatRef.current && data.questions?.length) {
            const newSugs = data.questions.slice(0, 3) as Suggestion[];
            setSuggestions(newSugs);
            try { localStorage.setItem(`${chatKey}_suggestions`, JSON.stringify(newSugs)); } catch {}
          }
        })
        .catch(() => {})
        .finally(() => { if (!abort.signal.aborted) setSuggestionsLoading(false); })
    );
    askedQuestionsRef.current = [];
    return () => { abort.abort(); };
  }, [activeDocIds.join(","), docs.map(d => d.id).join(",")]);

  // activeDocIds 변경 시 해당 자료의 채팅 히스토리 로드
  useEffect(() => {
    chatKeyRef.current = chatKey;
    setIsLoaded(false);
    stopSpeaking();
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
    setInitialQuestions([...DEFAULT_INITIAL_QUESTIONS]);
    setIsLoaded(true);
  }, [chatKey]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
    if (isLoaded) {
      try { localStorage.setItem(`${chatKeyRef.current}_suggestions`, JSON.stringify(suggestions)); } catch {}
    }
  }, [suggestions]);

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
    // 음성 모드 자동 재생 처리 — suggestions 메시지가 뒤에 붙어도 마지막 AI 메시지를 정확히 찾음
    if (autoSpeakRef.current) {
      const text = autoSpeakRef.current;
      autoSpeakRef.current = null;
      const idx = [...messages].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.type === 'ai')?.i ?? -1;
      if (idx >= 0 && messages[idx]?.content === text) {
        speakMessage(text, idx);
      }
    }
  }, [messages, isLoaded]);

  // 목소리 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!voiceDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node)) {
        setVoiceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [voiceDropdownOpen]);

  // 팟캐스트 모드: 재생 종료 후 다음 AI 메시지 자동 재생
  useEffect(() => {
    if (speakingMsgIdx !== null || podcastNextRef.current === null) return;
    const idx = podcastNextRef.current;
    podcastNextRef.current = null;
    const msg = messagesRef.current[idx];
    if (msg?.type === 'ai') speakMessage(msg.content, idx);
  }, [speakingMsgIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearChat = () => {
    if (confirm("대화 내역을 모두 지우시겠습니까?")) {
      stopSpeaking();
      audioCacheRef.current.clear();
      setMessages([]);
      setInitialQuestions([...DEFAULT_INITIAL_QUESTIONS]);
      setSuggestions([
        { text: "이 자료 요약해줘.", category: "이해" },
        { text: "핵심 개념이 뭐야?", category: "분석" },
        { text: "어떤 부분이 제일 중요해?", category: "적용" },
      ]);
      askedQuestionsRef.current = [];
      localStorage.removeItem(chatKeyRef.current);
      localStorage.removeItem(`${chatKeyRef.current}_suggestions`);
    }
  };

  const getToken = async () => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || "";
  };

  // ── 음성 재생 ─────────────────────────────────────────────
  const stopSpeaking = () => {
    speakTargetRef.current = null;  // in-flight fetch 무효화
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    wordsRef.current = [];
    setSpeakingMsgIdx(null);
    setLoadingAudioIdx(null);
    setAudioProgress(0);
  };

  const createAndPlayAudio = (audioBase64: string, words: WordSegment[], msgIdx: number) => {
    const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const url   = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    audio.playbackRate = playbackRateRef.current;

    audioRef.current   = audio;
    wordsRef.current   = words;
    setSpeakingMsgIdx(msgIdx);
    setLoadingAudioIdx(null);
    setAudioProgress(0);

    audio.ontimeupdate = () => {
      if (audioRef.current !== audio) return;
      if (audio.duration > 0) setAudioProgress(audio.currentTime / audio.duration);
    };
    const cleanup = () => {
      if (audioRef.current !== audio) return;
      setSpeakingMsgIdx(null);
      setAudioProgress(0);
      wordsRef.current = [];
      URL.revokeObjectURL(url);
      if (podcastModeRef.current) {
        const msgs = messagesRef.current;
        for (let i = msgIdx + 1; i < msgs.length; i++) {
          if (msgs[i].type === 'ai') { podcastNextRef.current = i; break; }
        }
      }
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  };

  const speakMessage = async (text: string, msgIdx: number) => {
    if (speakingMsgIdx === msgIdx) { stopSpeaking(); return; }

    // 팟캐스트 대기 중인 다음 재생을 먼저 취소한 후 현재 오디오 정지
    // (stopSpeaking이 setSpeakingMsgIdx(null)을 호출해 팟캐스트 effect를 유발하기 전에
    //  podcastNextRef를 null로 만들어야 effect가 중복 재생을 하지 않음)
    podcastNextRef.current = null;
    stopSpeaking();                    // 내부에서 speakTargetRef = null 처리
    speakTargetRef.current = msgIdx;   // stopSpeaking 이후에 새 target 설정

    const ttsText = prepareTtsText(text);
    const cacheKey = `${selectedVoice}:${ttsText}`;

    // 메모리 캐시 히트
    const memHit = audioCacheRef.current.get(cacheKey);
    if (memHit) {
      if (speakTargetRef.current !== msgIdx) return;
      createAndPlayAudio(memHit.audioBase64, memHit.words, msgIdx);
      return;
    }

    setLoadingAudioIdx(msgIdx);

    // IndexedDB 캐시 히트
    try {
      const idbHit = await idbGet(cacheKey);
      if (idbHit) {
        if (speakTargetRef.current !== msgIdx) return;  // 그 사이 다른 재생 요청이 왔음
        audioCacheRef.current.set(cacheKey, idbHit);
        createAndPlayAudio(idbHit.audioBase64, idbHit.words, msgIdx);
        return;
      }
    } catch { /* IndexedDB 실패 시 무시하고 API 호출 */ }

    // API 호출
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/tts/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: ttsText, voice: selectedVoice }),
      });
      if (!res.ok) throw new Error("TTS 생성 실패");
      const data = await res.json();

      if (speakTargetRef.current !== msgIdx) return;  // fetch 완료 전에 다른 요청이 왔음

      const cached: CachedAudio = { audioBase64: data.audio_base64, words: data.words ?? [] };
      audioCacheRef.current.set(cacheKey, cached);
      idbSet(cacheKey, cached).catch(() => {});

      createAndPlayAudio(data.audio_base64, data.words ?? [], msgIdx);
    } catch {
      if (speakTargetRef.current === msgIdx) {
        setLoadingAudioIdx(null);
        // TTS 오류는 별도 상태 없이 콘솔 출력 (STT 에러 UI 재사용 불가)
        console.error("음성 생성에 실패했습니다.");
      }
    }
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    playbackRateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    localStorage.setItem('studyu_playback_rate', String(rate));
  };

  const toggleVoiceMode = () => {
    if (voiceMode) {
      stopSpeaking();
      podcastNextRef.current = null;
      autoSpeakRef.current = null;
      setPodcastMode(false);
      podcastModeRef.current = false;
    }
    setVoiceMode(v => !v);
  };

  // ── STT (음성 입력, Web Speech API) ──────────────────────
  const handleMicClick = () => {
    clearSttError();
    startSTT(inputValue);
  };

  // ── 채팅 전송 ─────────────────────────────────────────────
  const handleSendMessage = async (textOverride?: string) => {
    const userMessage = (textOverride ?? inputValue).trim();
    if (!userMessage || isLoading) return;

    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    if (!textOverride) setInputValue('');
    setIsLoading(true);

    // 스트리밍 AI 메시지 플레이스홀더 추가
    const aiMsgIndex = -1; // setMessages 후 계산
    let streamingContent = '';

    const CATS: Array<"이해" | "분석" | "적용"> = ["이해", "분석", "적용"];
    const applyNewSuggestions = (newQuestions: string[]) => {
      const newChips = newQuestions.slice(0, 3).map((text, i) => ({
        text,
        category: CATS[i % 3],
        isOld: false,
      })) as Suggestion[];
      const nextSuggestions = [...suggestionsRef.current, ...newChips];
      setSuggestions(nextSuggestions);
      try { localStorage.setItem(`${chatKeyRef.current}_suggestions`, JSON.stringify(nextSuggestions)); } catch {}
      if (newChips.length > 0) {
        setMessages(prev => [...prev, { type: 'suggestions', items: newChips } as any]);
      }
    };

    try {
      const token        = await getToken();
      const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);

      if (targetDocIds.length === 0)
        throw new Error("학습할 소스(문서)가 없습니다. 강사님께 자료 업로드를 요청해 주세요.");

      // 최근 대화 히스토리 구성 (user/ai 메시지만, 최대 10개)
      const chatHistory = messagesRef.current
        .filter(m => m.type === 'user' || m.type === 'ai')
        .slice(-10)
        .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }));

      // 스트리밍 AI 메시지 자리 잡기
      setMessages(prev => [...prev, { type: 'ai', content: '', references: [], sources: [] }]);

      const res = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: targetDocIds,
          question: userMessage,
          model: selectedLLM || "gpt-4o-mini",
          level: selectedDifficulty || "intermediate",
          session_id: notebookId,
          current_slide: currentSlide ?? null,
          chat_history: chatHistory,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "AI 응답을 가져오는데 실패했습니다.");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let finalSources: any[] = [];
      let finalReferences: any[] = [];
      let finalSuggestions: string[] = [];
      let sseBuffer = '';
      let streamError = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 청크가 SSE 경계에서 쪼개질 수 있으므로 버퍼링 처리
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? ''; // 마지막 불완전 줄은 버퍼에 보관

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.token) {
              streamingContent += parsed.token;
              setMessages(prev => {
                const next = [...prev];
                const lastIdx = next.length - 1;
                if (next[lastIdx]?.type === 'ai') {
                  next[lastIdx] = { ...next[lastIdx], content: streamingContent };
                }
                return next;
              });
            } else if (parsed.rewrite) {
              streamingContent = parsed.rewrite;
              setMessages(prev => {
                const next = [...prev];
                const lastIdx = next.length - 1;
                if (next[lastIdx]?.type === 'ai') {
                  next[lastIdx] = { ...next[lastIdx], content: parsed.rewrite };
                }
                return next;
              });
            } else if (parsed.error) {
              streamError = parsed.error;
              break outer;
            } else if (parsed.done) {
              finalSources = parsed.sources ?? [];
              finalReferences = parsed.references ?? [];
              finalSuggestions = (parsed.suggestions ?? []).map((q: any) =>
                typeof q === 'string' ? q : q?.text ?? ''
              ).filter(Boolean);
              break outer;
            }
          } catch {}
        }
      }

      // 스트리밍 실패 시 일반 엔드포인트로 폴백
      if (streamError || !streamingContent) {
        const fallbackRes = await fetch(`${API}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            doc_ids: targetDocIds,
            question: userMessage,
            model: selectedLLM || "gpt-4o-mini",
            level: selectedDifficulty || "intermediate",
            session_id: notebookId,
            current_slide: currentSlide ?? null,
          }),
        });
        if (!fallbackRes.ok) throw new Error("AI 응답을 가져오는데 실패했습니다.");
        const fallbackData = await fallbackRes.json();
        streamingContent = fallbackData.answer ?? '';
        finalSources = fallbackData.sources ?? [];
        finalReferences = fallbackData.references ?? [];
      }

      const normalizedAnswer = normalizeInlineListMarkers(
        normalizeDetachedPageRefs(
          collapseNearbyTimestampLists(streamingContent)
        )
      );

      // 스트리밍 완료 후 메타데이터(sources, references) 반영
      setMessages(prev => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (next[lastIdx]?.type === 'ai') {
          next[lastIdx] = {
            ...next[lastIdx],
            content: normalizedAnswer,
            references: finalReferences,
            sources: finalSources,
          };
        }
        return next;
      });

      if (voiceMode || podcastMode) autoSpeakRef.current = normalizedAnswer;
      lastAnswerRef.current = normalizedAnswer;
      askedQuestionsRef.current = [...askedQuestionsRef.current, userMessage].slice(-6);

      // 추천 질문: done 이벤트에 포함된 경우 즉시 적용, 없으면 별도 fetch
      if (finalSuggestions.length > 0) {
        applyNewSuggestions(finalSuggestions);
      } else {
        const currentTexts = suggestionsRef.current.map((s) => s.text);
        getToken().then((t) =>
          fetch(`${API}/api/chat/suggestions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
            body: JSON.stringify({
              doc_ids: targetDocIds,
              asked_questions: [...askedQuestionsRef.current, ...currentTexts],
              last_answer: lastAnswerRef.current,
            }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.questions?.length) {
                const texts = (d.questions as Array<string | Suggestion>).map((q) =>
                  typeof q === "string" ? q : q.text
                );
                applyNewSuggestions(texts);
              }
            })
            .catch(() => {})
        );
      }
    } catch (error: any) {
      // 스트리밍 중 오류 시 플레이스홀더를 오류 메시지로 교체
      setMessages(prev => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (next[lastIdx]?.type === 'ai' && !next[lastIdx].content) {
          next[lastIdx] = { type: 'system', content: `[오류] ${error.message}` };
        } else {
          next.push({ type: 'system', content: `[오류] ${error.message}` });
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 초기 질문 클릭 — 나머지를 스레드 맨 앞에 고정 후 전송
  const handleInitialQuestionClick = (index: number, text: string) => {
    const remaining = initialQuestions.filter((_, i) => i !== index);
    setInitialQuestions(remaining);
    if (remaining.length > 0) {
      const items = remaining.map(t => ({ text: t, category: '이해' as const }));
      setMessages(prev => prev.length === 0 ? [{ type: 'suggestions' as const, items } as any] : prev);
    }
    handleSendMessage(text);
  };

  // 스레드 내 추천 질문 클릭 — 해당 항목 제거 후 전송
  const handleSuggestionClick = (msgIndex: number, suggIndex: number, text: string) => {
    setMessages(prev => {
      const next = [...prev];
      const msg = next[msgIndex] as any;
      if (msg?.type !== 'suggestions') return prev;
      const newItems = msg.items.filter((_: Suggestion, i: number) => i !== suggIndex);
      if (newItems.length === 0) {
        next.splice(msgIndex, 1);
      } else {
        next[msgIndex] = { type: 'suggestions', items: newItems } as any;
      }
      return next;
    });
    setSuggestions(prev => prev.filter(s => s.text !== text));
    handleSendMessage(text);
  };

  // ── 렌더 ─────────────────────────────────────────────────
  const renderMessageContent = (
    content: string,
    enableTimestampLinks: boolean,
    sources: SourceChunk[] = []
  ) => {
    const renderPlainText = (text: string, key?: string) => (
      <span key={key} className="whitespace-pre-wrap">
        {text.replace(/\n[ \t]+/g, "\n")}
      </span>
    );

    if (onSlideClick) {
      content = content.replace(/슬라이드\s*(\d+)/g, (match, n, offset, str) => {
        if (offset > 0 && str[offset - 1] === "[") return match;
        return `[슬라이드 ${n}]`;
      });
    }

    const hasCitationRefs = onCitationClick && /\[\d+\]/.test(content);
    const hasSlideRefs = onSlideClick && /\[슬라이드[\s\d,~\-~]+\]/g.test(content);
    const hasPageRefs = onPageClick && /페이지\s*\d+/g.test(content);
    if (!enableTimestampLinks && !hasCitationRefs && !hasSlideRefs && !hasPageRefs) {
      return renderPlainText(content);
    }

    const combinedPattern = /(\[(\d+)\])|(\[슬라이드[\s\d,~\-~]+\])|(\[[^\]]*페이지\s*(\d+)[^\]]*\])|((?<!\[)(?<!\w)페이지\s*(\d+)(?!\])(?!\w))|(\b(?:(\d+):)?([0-5]?\d):([0-5]\d)\b(?:\s*-\s*\b(?:(\d+):)?([0-5]?\d):([0-5]\d)\b)?)/g;
    const matches = Array.from(content.matchAll(combinedPattern));

    if (matches.length === 0) {
      return renderPlainText(content);
    }

    const nodes: JSX.Element[] = [];
    let lastIndex = 0;

    matches.forEach((match, index) => {
      const matchedText = match[0];
      const matchIndex = match.index ?? 0;
      const citationNum = match[2] ? parseInt(match[2], 10) : null;
      const isCitationRef = citationNum !== null;
      const isSlideRef = Boolean(match[3]);
      const isPageRef = Boolean(match[4] || match[6]);
      const pageNum = match[5] ? parseInt(match[5], 10) : match[7] ? parseInt(match[7], 10) : null;

      if (matchIndex > lastIndex) {
        nodes.push(renderPlainText(content.slice(lastIndex, matchIndex), `text-${index}-${lastIndex}`));
      }

      if (isCitationRef && onCitationClick) {
        const source = sources[citationNum - 1];
        if (source) {
          nodes.push(
            <button
              key={`cite-${index}-${citationNum}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCitationClick(source)}
              className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
            >
              {matchedText}
            </button>
          );
        } else {
          nodes.push(renderPlainText(matchedText, `cite-raw-${index}`));
        }
      } else if (isSlideRef && onSlideClick) {
        const nums = Array.from(matchedText.matchAll(/\d+/g)).map(m => parseInt(m[0], 10));
        if (nums.length === 1) {
          nodes.push(
            <button
              key={`slide-${index}-${nums[0]}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSlideClick(nums[0])}
              className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
            >
              {matchedText}
            </button>
          );
        } else {
          nodes.push(
            <span key={`slide-multi-${index}`}>
              {nums.map((n) => (
                <button
                  key={`slide-${index}-${n}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSlideClick(n)}
                  className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff] mr-0.5"
                >
                  {`[슬라이드 ${n}]`}
                </button>
              ))}
            </span>
          );
        }
      } else if (isPageRef && pageNum !== null && onPageClick) {
        nodes.push(
          <button
            key={`page-${index}-${pageNum}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPageClick(pageNum)}
            className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
          >
            {matchedText}
          </button>
        );
      } else if (!isSlideRef && !isPageRef && enableTimestampLinks) {
        const rangeStart = matchedText.split(/\s*-\s*/)[0] ?? matchedText;
        const seconds = parseTimestampToSeconds(rangeStart);
        if (seconds === null) {
          nodes.push(renderPlainText(matchedText, `raw-${index}`));
        } else {
          nodes.push(
            <button
              key={`ts-${index}-${matchedText}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSeekToTimestamp?.(seconds)}
              className="inline rounded-md border border-[#dbe4ff] bg-white px-1.5 py-0.5 font-semibold text-[#155dfc] hover:bg-[#eef4ff]"
            >
              {matchedText}
            </button>
          );
        }
      } else {
        nodes.push(renderPlainText(matchedText, `raw-${index}`));
      }

      lastIndex = matchIndex + matchedText.length;
    });

    if (lastIndex < content.length) {
      nodes.push(renderPlainText(content.slice(lastIndex), `tail-${lastIndex}`));
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
          {/* PPT: 슬라이드 뱃지 (읽기 전용) */}
          {currentSlide != null && onSlideClick && (
            <span className="text-[11px] text-[#155dfc] font-medium bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
              슬라이드 {currentSlide}
            </span>
          )}
          {/* PDF: 페이지 뱃지 (클릭하면 수동 입력) */}
          {onPageClick && !onSlideClick && (
            editingPage ? (
              <input
                autoFocus
                type="number"
                min={1}
                value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const n = parseInt(pageInput, 10);
                    if (!isNaN(n) && n >= 1) onPageClick(n);
                    setEditingPage(false);
                  }
                  if (e.key === 'Escape') setEditingPage(false);
                }}
                onBlur={() => {
                  const n = parseInt(pageInput, 10);
                  if (!isNaN(n) && n >= 1) onPageClick(n);
                  setEditingPage(false);
                }}
                className="w-16 text-center text-[11px] font-medium border border-[#155dfc] rounded-full px-2 py-0.5 outline-none text-[#155dfc]"
              />
            ) : (
              <button
                onClick={() => { setPageInput(currentSlide != null ? String(currentSlide) : ''); setEditingPage(true); }}
                className="text-[11px] text-[#155dfc] font-medium bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors"
                title="클릭해서 페이지 번호 직접 입력"
              >
                {currentSlide != null ? `페이지 ${currentSlide}` : '페이지 입력'}
              </button>
            )
          )}
          {/* PDF: "이 페이지 설명해줘" 버튼 */}
          {onPageClick && !onSlideClick && currentSlide != null && (
            <button
              onClick={() => handleSendMessage(`[페이지 ${currentSlide}]의 내용을 자세히 설명해줘.`)}
              disabled={isLoading}
              className="text-[11px] text-[#155dfc] font-medium bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full hover:bg-blue-100 disabled:opacity-40 transition-colors"
              title="현재 페이지 설명 요청"
            >
              설명
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {showSummaryButton && voiceMode && (
            <button
              onClick={() => {
                onOpenSummary?.();
                setIsSummaryOpen(true);
              }}
              className="px-2.5 py-1.5 rounded-md text-[12px] font-medium text-[#155dfc] bg-blue-50 hover:bg-blue-100 transition-colors"
              title={summaryButtonTitle}
            >
              {summaryButtonLabel}
            </button>
          )}
          {voiceMode && (
            <div className="relative" ref={voiceDropdownRef}>
              <button
                onClick={() => setVoiceDropdownOpen(o => !o)}
                className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-[#155dfc] text-[11px] font-medium rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
                title="목소리 선택"
              >
                <span>{VOICES.find(v => v.key === selectedVoice)?.label}</span>
                <svg
                  className={`w-2.5 h-2.5 transition-transform duration-150 ${voiceDropdownOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none"
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {voiceDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-[#e7e9ed] shadow-lg z-50 overflow-hidden">
                  {VOICES.map(v => (
                    <button
                      key={v.key}
                      onClick={() => { setSelectedVoice(v.key); setVoiceDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#f8f9fb] ${
                        selectedVoice === v.key ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`text-[12px] font-medium ${selectedVoice === v.key ? 'text-[#155dfc]' : 'text-[#1a1d26]'}`}>
                          {v.label}
                        </div>
                        <div className="text-[10px] text-[#99a1af]">{v.desc}</div>
                      </div>
                      {selectedVoice === v.key && (
                        <svg className="w-3 h-3 text-[#155dfc] shrink-0" viewBox="0 0 24 24" fill="none">
                          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showSummaryButton && !voiceMode && (
            <button
              onClick={() => {
                onOpenSummary?.();
                setIsSummaryOpen(true);
              }}
              className="px-2.5 py-1.5 rounded-md text-[12px] font-medium text-[#155dfc] bg-blue-50 hover:bg-blue-100 transition-colors"
              title={summaryButtonTitle}
            >
              {summaryButtonLabel}
            </button>
          )}
          <button
            onClick={toggleVoiceMode}
            className={`p-1.5 rounded-md transition-colors ${voiceMode ? 'text-[#155dfc] bg-blue-50 hover:bg-blue-100' : 'text-[#99a1af] hover:text-gray-600 hover:bg-gray-100'}`}
            title={voiceMode ? "음성 모드 끄기" : "음성으로 답변 듣기"}
          >
            {voiceMode ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {voiceMode && (
            <button
              onClick={() => {
                  if (podcastMode) {
                    // 즉시 ref 업데이트: 렌더 전에 오디오 cleanup이 실행돼도 다음 재생 안 함
                    podcastModeRef.current = false;
                    podcastNextRef.current = null;
                  } else {
                    podcastModeRef.current = true;
                  }
                  setPodcastMode(p => !p);
                }}
              className={`p-1.5 rounded-md transition-colors ${podcastMode ? 'text-[#155dfc] bg-blue-50 hover:bg-blue-100' : 'text-[#99a1af] hover:text-gray-600 hover:bg-gray-100'}`}
              title={podcastMode ? "연속 재생 끄기" : "연속 재생 (팟캐스트 모드)"}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <polygon points="5,3 12,8 5,13" fill="currentColor"/>
                <polygon points="12,3 19,8 12,13" fill="currentColor"/>
                <line x1="5" y1="17" x2="19" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="5" y1="20" x2="19" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {messages.length > 0 && (
            <>
              <div className="w-px h-4 bg-[#e7e9ed] mx-0.5" />
              <button onClick={handleClearChat} className="p-1.5 text-[#99a1af] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors" title="대화 내역 지우기">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1.5 text-[#99a1af] hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors" title="닫기">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 메시지 리스트 영역 */}
      {isSummaryOpen && (canOpenSummary || hasMediaSummary || activeSourceSummaryLoading) && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-[1px] flex flex-col">
          <div className="shrink-0 px-4 py-3 border-b border-[#e7e9ed] flex items-center justify-between bg-white">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1a1d26] truncate">
                {activeSourceSummary?.title?.trim() || "자료 요약"}
              </p>
              <p className="text-[11px] text-[#99a1af]">Markdown 형식으로 볼 수 있어요.</p>
            </div>
            
              <button
                onClick={async () => {
                  if (isDeletingSummary) return;
                  setIsDeletingSummary(true);
                  try {
                    await onDeleteSummary?.();
                    setIsSummaryOpen(false);
                  } finally {
                    setIsDeletingSummary(false);
                  }
                }}
                className="hidden"
                disabled={isDeletingSummary}
              >
                {isDeletingSummary ? "삭제 중" : "요약 삭제"}
              </button>
            
            <button
              onClick={() => setIsSummaryOpen(false)}
              className="p-1.5 text-[#99a1af] hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 bg-[#f8f9fb]">
            {activeSourceSummaryLoading && !hasMediaSummary ? (
              <div className="rounded-2xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3 text-[#4b5563]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#155dfc]" />
                  <p className="text-[14px]">요약을 준비하고 있어요.</p>
                </div>
                <p className="mt-3 text-[12px] text-[#99a1af]">
                  요약을 생성하고 있더라도 소스 확인과 AI 채팅은 계속 할 수 있어요.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
                <MarkdownPreview
                  content={stripSummaryEvidenceBlocks(summaryReportMarkdown)}
                  className="text-[#1f2937] leading-7 [&_h1]:mb-4 [&_h1]:text-[28px] [&_h1]:font-bold [&_h1]:tracking-[-0.02em] [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-[#111827] [&_p]:text-[14px] [&_p]:leading-7 [&_blockquote]:border-blue-100 [&_blockquote]:bg-blue-50 [&_blockquote]:text-[12px] [&_blockquote]:not-italic [&_blockquote]:text-[#4b5563]"
                  transformText={(text) =>
                    renderMessageContent(
                      text,
                      Boolean(activeSourceMediaType && onSeekToTimestamp),
                      []
                    )
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {false && hasMediaSummary && (
          <div className="rounded-2xl border border-[#dbe7ff] bg-[#f7faff] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#155dfc] shadow-sm">
                <BotMessageSquare className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[#155dfc]">
                  {activeSourceSummary?.title?.trim() || "자료 요약"}
                </p>
                <p className="text-[11px] text-[#6b7280]">채팅하면서 바로 참고할 수 있는 요약이에요.</p>
              </div>
            </div>

            {activeSourceSummary?.overview?.trim() ? (
              <div className="rounded-xl bg-white/80 px-3 py-2 text-[13px] leading-6 text-[#374151] border border-white">
                <MarkdownPreview content={activeSourceSummary?.overview ?? ""} className="text-[#374151]" />
              </div>
            ) : null}

            {mediaSummarySections.length > 0 ? (
              <div className="mt-3 space-y-2">
                {mediaSummarySections.map((section, index) => {
                  const sectionStart =
                    typeof section.start_sec === "number" && Number.isFinite(section.start_sec)
                      ? Math.max(0, section.start_sec)
                      : null;

                  return (
                    <div key={`${section.title}-${index}`} className="rounded-xl bg-white px-3 py-3 border border-[#e5edff]">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] font-semibold text-[#1f2937]">
                          {section.title?.trim() || `요약 ${index + 1}`}
                        </p>
                        {sectionStart !== null && activeSourceMediaType && onSeekToTimestamp ? (
                          <button
                            type="button"
                            onClick={() => onSeekToTimestamp(sectionStart)}
                            className="shrink-0 rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] font-medium text-[#155dfc] hover:bg-[#dbe7ff]"
                          >
                            {formatTimestamp(sectionStart)}
                          </button>
                        ) : null}
                      </div>
                      {section.summary?.trim() ? (
                        <div className="mt-2 text-[13px] leading-6 text-[#4b5563]">
                          <MarkdownPreview content={section.summary} className="text-[#4b5563]" />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

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
              {initialQuestions.map((q, i) => (
                <button
                  key={q}
                  onClick={() => handleInitialQuestionClick(i, q)}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-full border border-[#e7e9ed] bg-white text-[13px] text-[#414751] hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-blue-50 transition-all shadow-sm text-right disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg: any, index) => {
          if (msg.type === 'suggestions') {
            return (
              <div key={index} className="flex flex-col items-end gap-2 py-1">
                {(msg.items as Suggestion[]).map((s, si) => (
                  <button
                    key={s.text}
                    onClick={() => handleSuggestionClick(index, si, s.text)}
                    disabled={isLoading}
                    className="px-4 py-2 rounded-full border border-[#e7e9ed] bg-white text-[13px] text-[#414751] hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-blue-50 transition-all shadow-sm disabled:opacity-40 text-right max-w-[82%]"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            );
          }

          const isPlaying     = speakingMsgIdx === index;
          const isLoadingThis = loadingAudioIdx === index;

          return (
            <div key={index} className="flex flex-col gap-1">
              <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} items-end gap-1`}>
                <div className={`max-w-[82%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed ${
                  msg.type === 'user'
                    ? 'bg-[#155dfc] text-white rounded-tr-sm whitespace-pre-wrap'
                    : msg.type === 'system'
                    ? 'bg-red-50 text-red-600 border border-red-100 whitespace-pre-wrap'
                    : `bg-[#f8f9fb] text-[#1a1d26] border rounded-tl-sm transition-colors ${isPlaying ? 'border-[#155dfc]/30 ring-1 ring-[#155dfc]/15' : 'border-[#e7e9ed]'}`
                }`}>
                  {msg.type === 'ai' && !msg.content
                    ? (
                      <div className="flex items-center gap-2 py-0.5">
                        <Loader2 className="w-4 h-4 animate-spin text-[#155dfc]" />
                        <span className="text-[13px] text-[#99a1af] font-medium">AI가 답변을 작성 중입니다...</span>
                      </div>
                    )
                    : msg.type === 'ai'
                    ? <MarkdownPreview
                        content={fixMarkdownCodeFences(msg.content
                          .replace(/\[SUGGESTED_QUESTIONS\][\s\S]*?(\[\/SUGGESTED_QUESTIONS\]|$)/g, '')
                          .replace(/~~([^~]+)~~/g, '$1')                       // ~~취소선~~ 제거
                          .trimEnd()
                          .replace(/([^\n]) +(---+)(?=\s|$)/g, '$1\n\n$2')    // 같은 줄 내 text --- 분리
                          .replace(/(---+) +(#{1,6} )/g, '$1\n\n$2')           // 같은 줄 내 --- ## 분리
                          .replace(/([^\n\-]) +(#{1,6} )/g, '$1\n\n$2')        // 같은 줄 내 text ## 분리
                          .replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2')          // 헤딩 앞 빈 줄 보장
                          .replace(/([^\n])\n(---+\s*$)/gm, '$1\n\n$2')        // --- 앞 빈 줄 보장
                          .replace(/(---+)\n([^\n])/g, '$1\n\n$2')             // --- 뒤 빈 줄 보장
                          .replace(/([^\n])\n(> )/g, '$1\n\n$2')              // blockquote 앞 빈 줄 보장
                          .replace(/([^\n])\n(\|)/g, '$1\n\n$2')              // 테이블 시작 앞 빈 줄 보장
                          .replace(/(\|[^\n]*\n)\n+(?=\|)/g, '$1')            // 테이블 행 사이 빈 줄 제거
                          .replace(/(\]\])(\[)/g, '$1 $2')                     // ][슬라이드 사이 공백
                        )}
                        className="text-[#1a1d26]"
                        transformText={(text) =>
                          renderMessageContent(
                            text,
                            Boolean(activeSourceId && activeSourceMediaType && onSeekToTimestamp),
                            msg.sources ?? []
                          )
                        }
                      />
                    : msg.type === 'system'
                    ? <span className="whitespace-pre-wrap">{msg.content}</span>
                    : renderMessageContent(msg.content, false, msg.sources ?? [])
                  }
                </div>

                {msg.type === 'ai' && voiceMode && (
                  <button
                    onClick={() => speakMessage(msg.content, index)}
                    className={`p-1.5 rounded-md transition-colors shrink-0 mb-0.5 ${
                      isPlaying || isLoadingThis ? 'text-[#155dfc]' : 'text-[#c8cdd5] hover:text-[#155dfc] hover:bg-gray-50'
                    }`}
                    title={isPlaying ? "재생 중지" : "음성으로 듣기"}
                  >
                    {isLoadingThis ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isPlaying ? (
                      <span className="flex items-end gap-[2px] w-4 h-3.5">
                        <span className="w-[2.5px] h-[6px]  bg-[#155dfc] rounded-full animate-bounce" style={{ animationDelay: '0ms',   animationDuration: '0.6s' }} />
                        <span className="w-[2.5px] h-[12px] bg-[#155dfc] rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '0.6s' }} />
                        <span className="w-[2.5px] h-[8px]  bg-[#155dfc] rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '0.6s' }} />
                      </span>
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>


              {msg.type === 'ai' && isPlaying && (
                <div
                  className="h-[3px] bg-[#e7e9ed] rounded-full overflow-hidden mx-1 cursor-pointer"
                  onClick={e => {
                    if (!audioRef.current || !audioRef.current.duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    audioRef.current.currentTime =
                      ((e.clientX - rect.left) / rect.width) * audioRef.current.duration;
                  }}
                >
                  <div
                    className="h-full bg-[#155dfc] rounded-full"
                    style={{ width: `${audioProgress * 100}%`, transition: 'width 0.1s linear' }}
                  />
                </div>
              )}

              {msg.type === 'ai' && isPlaying && (
                <div className="flex items-center gap-1 pl-1">
                  {SPEED_OPTIONS.map(rate => (
                    <button
                      key={rate}
                      onClick={() => changeSpeed(rate)}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                        playbackRate === rate ? 'bg-[#155dfc] text-white' : 'bg-[#f0f2f5] text-[#99a1af] hover:bg-[#e7e9ed] hover:text-[#414751]'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="p-3 bg-white flex flex-col gap-2 shrink-0">
        {sttError && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
            <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[11px] text-red-600 flex-1">{sttError}</span>
            <button onClick={clearSttError} className="text-red-400 hover:text-red-600">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className={`relative flex items-end gap-2 rounded-xl p-1.5 border shadow-sm transition-all ${
          isRecording
            ? 'bg-red-50 border-red-300 ring-2 ring-red-200/50'
            : 'bg-[#f8f9fb] border-[#e7e9ed] focus-within:ring-2 focus-within:ring-[#155dfc]/20 focus-within:border-[#155dfc]/30'
        }`}>
          <button className="p-2 text-[#99a1af] hover:text-[#155dfc] hover:bg-white rounded-lg transition-colors shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            value={isRecording && interimText ? interimText : inputValue}
            onChange={e => { if (!isRecording) setInputValue(e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            rows={1}
            className={`flex-1 max-h-[100px] min-h-[40px] py-2 bg-transparent text-[13px] placeholder-[#99a1af] focus:outline-none resize-none self-center ${
              isRecording && interimText ? 'text-red-500 italic' : 'text-[#1a1d26]'
            }`}
            placeholder={isRecording ? "말씀해 주세요..." : "학습 내용에 대해 무엇이든 물어보세요..."}
            readOnly={isRecording}
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleMicClick}
              className={`p-2 rounded-lg transition-colors ${
                isRecording
                  ? 'text-white bg-red-500 hover:bg-red-600 animate-pulse'
                  : 'text-[#99a1af] hover:text-[#155dfc] hover:bg-white'
              }`}
              title={isRecording ? "클릭하면 완료" : "음성으로 질문하기"}
            >
              <Mic className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSendMessage()}
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
