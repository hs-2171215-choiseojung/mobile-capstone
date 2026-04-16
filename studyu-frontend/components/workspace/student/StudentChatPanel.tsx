"use client";

import { useState, useRef, useEffect } from 'react';
import { BotMessageSquare, Mic, Send, Paperclip, Loader2, Trash2, X, Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import MarkdownPreview from '@/components/workspace/MarkdownPreview';

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
  onPageClick?: (pageNum: number) => void;
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

const DEFAULT_INITIAL_QUESTIONS = [
  "이 자료의 핵심 개념을 설명해줘",
  "주요 내용들 간의 관계를 분석해줘",
  "실제로 어떻게 활용할 수 있을까?",
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


export function StudentChatPanel({ activeDocIds, docs, notebookId, selectedLLM, selectedDifficulty, onClose }: StudentChatPanelProps) {
  const [messages, setMessages]           = useState<any[]>([]);
  const [inputValue, setInputValue]       = useState('');
  const [isLoading, setIsLoading]         = useState(false);
  const [isLoaded, setIsLoaded]           = useState(false);

  interface Suggestion { text: string; category: "이해" | "분석" | "적용"; }
  const [suggestions, setSuggestions] = useState<Suggestion[]>([
    { text: "이 자료의 핵심 개념을 설명해줘", category: "이해" },
    { text: "주요 내용들 간의 관계를 분석해줘", category: "분석" },
    { text: "실제로 어떻게 활용할 수 있을까?",  category: "적용" },
  ]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [initialQuestions, setInitialQuestions] = useState<string[]>(DEFAULT_INITIAL_QUESTIONS);
  const askedQuestionsRef = useRef<string[]>([]);

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
  const [currentWordIdx,   setCurrentWordIdx]   = useState<number | null>(null);
  const [audioProgress,    setAudioProgress]    = useState<number>(0);

  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const wordsRef         = useRef<WordSegment[]>([]);       // 현재 재생 메시지 단어 세그먼트
  const playbackRateRef  = useRef<number>(
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('studyu_playback_rate') || '1')
      : 1
  );                                                        // stale closure 방지
  const audioCacheRef    = useRef<Map<string, CachedAudio>>(new Map()); // 인메모리 캐시
  const autoSpeakRef     = useRef<string | null>(null);     // 자동 재생 예약 텍스트
  const podcastModeRef   = useRef(false);
  const messagesRef      = useRef<any[]>([]);
  const podcastNextRef   = useRef<number | null>(null);

  // ── STT 상태 ─────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [sttError,    setSttError]    = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

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
  onSeekToTimestamp,
  onClose,
  onCitationClick,
  onSlideClick,
  onPageClick,
}: StudentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  interface Suggestion { text: string; category: "이해" | "분석" | "적용"; isOld?: boolean; }
  const CATEGORY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
    이해: { bg: "bg-blue-50",   text: "text-blue-600",  border: "border-blue-200" },
    분석: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200" },
    적용: { bg: "bg-green-50",  text: "text-green-600",  border: "border-green-200" },
  };
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
      { text: "이 자료의 핵심 개념을 설명해줘", category: "이해" },
      { text: "주요 내용들 간의 관계를 분석해줘", category: "분석" },
      { text: "실제로 어떻게 활용할 수 있을까?", category: "적용" },
    ];
  });
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsPage, setSuggestionsPage] = useState(0);
  const askedQuestionsRef = useRef<string[]>([]);
  const clickedIndexRef = useRef<number>(-1);
  const suggestionFromChatRef = useRef(false);
  const suggestionFetchAbortRef = useRef<AbortController | null>(null);
  const suggestionsRef = useRef<Suggestion[]>(suggestions);
  const lastAnswerRef = useRef<string>("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 항상 최신 값을 ref에 동기화 (stale closure 방지)
  podcastModeRef.current = podcastMode;
  messagesRef.current    = messages;

  const chatKey = activeDocIds.length > 0
    ? `studyu_chat_${notebookId}_doc_${[...activeDocIds].sort().join('_')}`
    : `studyu_chat_${notebookId}`;
  const chatKeyRef = useRef(chatKey);

  // 언마운트 시 오디오·마이크 정리
  useEffect(() => {
    return () => {
      stopSpeaking();
      audioCacheRef.current.clear();
      recognitionRef.current?.stop();
    };
  }, []);

  // activeDocIds 변경 시 추천 질문 fetch
  useEffect(() => {
    const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);
    if (targetDocIds.length === 0) return;
    suggestionFromChatRef.current = false;
    setSuggestionsPage(0);

    // localStorage에 저장된 추천 질문 복원 시도
    const savedKey = `${chatKey}_suggestions`;
    const saved = localStorage.getItem(savedKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSuggestions(parsed as Suggestion[]);
          setSuggestionsPage(Math.floor((parsed.length - 1) / 3));
          askedQuestionsRef.current = [];
          return;
        }
      } catch {}
    }

    // 없으면 fetch
    const abort = new AbortController();
    suggestionFetchAbortRef.current = abort;
    setSuggestionsLoading(true);
    getToken().then(token =>
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
    setIsLoaded(true);
  }, [chatKey]);

  useEffect(() => {
    if (isLoaded) localStorage.setItem(chatKeyRef.current, JSON.stringify(messages));
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(chatKeyRef.current, JSON.stringify(messages));
    }
    
    if (messagesEndRef.current) {
      const el = messagesEndRef.current.parentElement;
      el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    // 음성 모드 자동 재생 처리
    if (autoSpeakRef.current) {
      const text = autoSpeakRef.current;
      autoSpeakRef.current = null;
      const idx = messages.length - 1;
      if (messages[idx]?.type === 'ai' && messages[idx]?.content === text) {
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    wordsRef.current = [];
    setSpeakingMsgIdx(null);
    setCurrentWordIdx(null);
    setLoadingAudioIdx(null);
  };

  const createAndPlayAudio = (audioBase64: string, words: WordSegment[], msgIdx: number) => {
    const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const url   = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    audio.playbackRate = playbackRateRef.current;

    audioRef.current   = audio;
    wordsRef.current   = words;
    setSpeakingMsgIdx(msgIdx);
    setCurrentWordIdx(words.length > 0 ? 0 : null);
    setLoadingAudioIdx(null);
    setAudioProgress(0);

    audio.ontimeupdate = () => {
      const t = audio.currentTime;
      // 진행 바
      if (audio.duration > 0) setAudioProgress(t / audio.duration);
      // 단어 하이라이팅
      const ws = wordsRef.current;
      if (!ws.length) return;
      let active = 0;
      for (let i = 0; i < ws.length; i++) {
        if (ws[i].start <= t) active = i;
        else break;
      }
      setCurrentWordIdx(prev => (prev === active ? prev : active));
    };
    const cleanup = () => {
      setSpeakingMsgIdx(null);
      setCurrentWordIdx(null);
      setAudioProgress(0);
      wordsRef.current = [];
      URL.revokeObjectURL(url);
      // 팟캐스트 모드: 다음 AI 메시지 예약
      if (podcastModeRef.current) {
        const msgs = messagesRef.current;
        for (let i = msgIdx + 1; i < msgs.length; i++) {
          if (msgs[i].type === 'ai') { podcastNextRef.current = i; break; }
        }
      }
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play();
  };

  const speakMessage = async (text: string, msgIdx: number) => {
    if (speakingMsgIdx === msgIdx) { stopSpeaking(); return; }
    stopSpeaking();

    const cacheKey = `${selectedVoice}:${text}`;

    // 1. 인메모리 캐시
    const memHit = audioCacheRef.current.get(cacheKey);
    if (memHit) { createAndPlayAudio(memHit.audioBase64, memHit.words, msgIdx); return; }

    setLoadingAudioIdx(msgIdx);

    // 2. IndexedDB 캐시
    try {
      const idbHit = await idbGet(cacheKey);
      if (idbHit) {
        audioCacheRef.current.set(cacheKey, idbHit);
        createAndPlayAudio(idbHit.audioBase64, idbHit.words, msgIdx);
        return;
      }
    } catch { /* IndexedDB 실패 시 무시하고 API 호출 */ }

    // 3. API 호출
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/tts/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, voice: selectedVoice }),
      });
      if (!res.ok) throw new Error("TTS 생성 실패");
      const data = await res.json();

      const cached: CachedAudio = { audioBase64: data.audio_base64, words: data.words ?? [] };
      audioCacheRef.current.set(cacheKey, cached);
      idbSet(cacheKey, cached).catch(() => {}); // fire-and-forget

      createAndPlayAudio(data.audio_base64, data.words ?? [], msgIdx);
    } catch {
      setLoadingAudioIdx(null);
    }
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    playbackRateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    localStorage.setItem('studyu_playback_rate', String(rate));
  };

  const toggleVoiceMode = () => {
    if (voiceMode) stopSpeaking();
    setVoiceMode(v => !v);
  };

  // ── STT (음성 입력, Web Speech API) ──────────────────────
  const handleMicClick = () => {
    setSttError(null);

    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSttError("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart  = () => setIsRecording(true);
    recognition.onend    = () => setIsRecording(false);

    recognition.onresult = (e: any) => {
      const text = e.results[0]?.[0]?.transcript?.trim();
      if (text) {
        setInputValue(text);
      } else {
        setSttError("인식된 내용이 없어요. 다시 시도해 보세요.");
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setSttError("마이크 접근 권한이 필요합니다.");
      } else if (e.error !== 'no-speech') {
        setSttError("음성 인식 중 오류가 발생했습니다.");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // ── 채팅 전송 ─────────────────────────────────────────────
  const handleSendMessage = async (textOverride?: string) => {
    const userMessage = (textOverride ?? inputValue).trim();
    if (!userMessage || isLoading) return;

    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    if (!textOverride) setInputValue('');
    setIsLoading(true);

    try {
      const token        = await getToken();
      const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);

      if (targetDocIds.length === 0)
        throw new Error("학습할 소스(문서)가 없습니다. 강사님께 자료 업로드를 요청해 주세요.");

      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: targetDocIds,
          question: userMessage,
          model: selectedLLM || "gpt-4o-mini",
          level: selectedDifficulty || "intermediate",
          session_id: notebookId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "AI 응답을 가져오는데 실패했습니다.");
      }

      const data = await res.json();
      if (voiceMode) autoSpeakRef.current = data.answer;

      // 캐시된 suggestions 즉시 표시 (대기 없음)
      const cachedSugg = suggestions.slice();
      setMessages(prev => [
        ...prev,
        { type: 'ai', content: data.answer },
        ...(cachedSugg.length > 0 ? [{ type: 'suggestions', items: cachedSugg }] : []),
      ]);

    
      setMessages(prev => [
        ...prev,
        {
          type: 'ai',
          content: normalizeInlineListMarkers(
            normalizeDetachedPageRefs(
              collapseNearbyTimestampLists(data.answer ?? "")
            )
          ),
          references: Array.isArray(data.references) ? data.references : [],
          sources: Array.isArray(data.sources) ? data.sources : [],
        },
      ]);

      // 추천 질문 처리
      lastAnswerRef.current = data.answer ?? "";
      askedQuestionsRef.current = [...askedQuestionsRef.current, userMessage].slice(-6);
      const replacingIndex = clickedIndexRef.current;
      clickedIndexRef.current = -1;

      const CATS: Array<"이해" | "분석" | "적용"> = ["이해", "분석", "적용"];
      const pptSuggestions: string[] = Array.isArray(data.suggested_questions) ? data.suggested_questions : [];

      const applyNewSuggestions = (newQuestions: string[]) => {
        const currentSuggestions = suggestionsRef.current;
        const marked = replacingIndex >= 0
          ? currentSuggestions.map((s: Suggestion, idx: number) => idx === replacingIndex ? { ...s, isOld: true } : s)
          : currentSuggestions;
        const newChips = newQuestions.slice(0, 3).map((text, i) => ({
          text,
          category: CATS[i % 3],
          isOld: false,
        })) as Suggestion[];
        const nextSuggestions = [...marked, ...newChips];
        setSuggestions(nextSuggestions);
        setSuggestionsPage(Math.floor((nextSuggestions.length - 1) / 3));
        try { localStorage.setItem(`${chatKeyRef.current}_suggestions`, JSON.stringify(nextSuggestions)); } catch {}
      };

      if (pptSuggestions.length > 0) {
        // AI 답변에서 추천 질문이 왔을 때
        suggestionFetchAbortRef.current?.abort();
        suggestionFromChatRef.current = true;
        setSuggestionsLoading(false);
        applyNewSuggestions(pptSuggestions);
      } else {
        // 추천 질문이 없을 때: /api/chat/suggestions fallback 호출
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
      setMessages(prev => [...prev, { type: 'system', content: `[오류] ${error.message}` }]);
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
      setMessages(prev => prev.length === 0 ? [{ type: 'suggestions', items }] : prev);
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
        next[msgIndex] = { type: 'suggestions', items: newItems };
      }
      return next;
    });
    // 캐시에서도 제거해서 다음 스냅샷에 중복 방지
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

    const hasCitationRefs = onCitationClick && /\[\d+\]/.test(content);
    const hasSlideRefs = onSlideClick && /\[슬라이드[\s\d,~\-~]+\]/g.test(content);
    const hasPageRefs = onPageClick && /페이지\s*\d+/g.test(content);
    if (!enableTimestampLinks && !hasCitationRefs && !hasSlideRefs && !hasPageRefs) {
      return renderPlainText(content);
    }

    // Combined pattern:
    //   그룹1: [슬라이드 N] 또는 [슬라이드 N, M, ...] (복수 슬라이드 포함)
    //   그룹2: [출처 N, 페이지 N] 또는 [페이지 N] 등 "페이지 N" 포함 대괄호
    //   그룹3: 괄호 없이 "페이지 N" 단독
    //   그룹4+: timestamp ranges
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
        // [슬라이드 9, 10] 같은 복수 슬라이드 파싱
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
          // 복수: [슬라이드 9], [슬라이드 10] 버튼으로 분리
          nodes.push(
            <span key={`slide-multi-${index}`}>
              {nums.map((n, ni) => (
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
        </div>
        <div className="flex items-center gap-1">
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
          <button
            onClick={toggleVoiceMode}
            className={`p-1.5 rounded-md transition-colors ${voiceMode ? 'text-[#155dfc] bg-blue-50 hover:bg-blue-100' : 'text-[#99a1af] hover:text-gray-600 hover:bg-gray-100'}`}
            title={voiceMode ? "음성 모드 끄기" : "음성으로 답변 듣기"}
          >
            {voiceMode ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {voiceMode && (
            <button
              onClick={() => setPodcastMode(p => !p)}
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

      {/* 메시지 리스트 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col h-full">
            <div className="flex flex-col items-start gap-2 mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#155dfc]">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor"/>
              </svg>
              <p className="text-[13px] text-[#414751] leading-relaxed">
                안녕하세요! 학습 중 궁금한 점이 있으신가요?<br />
                최선을 다해 도와드리겠습니다.
              </p>
              <p className="text-[11px] text-[#99a1af]">어떻게 질문해야 할지 모르겠다면 아래 예시를 눌러보세요.</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {initialQuestions.map((q, i) => (
                <button
                  key={q}
                  onClick={() => handleInitialQuestionClick(i, q)}
                  className="px-4 py-2 rounded-full border border-[#e7e9ed] bg-white text-[13px] text-[#414751] hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-blue-50 transition-all shadow-sm text-right"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          // ── 추천 질문 그룹 (스레드에 박힌 말풍선) ──────────
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

          const isPlaying      = speakingMsgIdx === index;
          const isLoadingThis  = loadingAudioIdx === index;
          const hasWords       = isPlaying && wordsRef.current.length > 0;

          return (
            <div key={index} className="flex flex-col gap-1">
              <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} items-end gap-1`}>
                {/* 메시지 버블 */}
                <div className={`max-w-[82%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed ${
                  msg.type === 'user'
                    ? 'bg-[#155dfc] text-white rounded-tr-sm whitespace-pre-wrap'
                    : msg.type === 'system'
                    ? 'bg-red-50 text-red-600 border border-red-100 whitespace-pre-wrap'
                    : `bg-[#f8f9fb] text-[#1a1d26] border rounded-tl-sm transition-colors ${isPlaying ? 'border-[#155dfc]/30 ring-1 ring-[#155dfc]/15' : 'border-[#e7e9ed]'}`
                }`}>
                  {/* AI 메시지: 재생 중이면 단어 단위 하이라이팅 */}
                  {msg.type === 'ai' && hasWords
                    ? wordsRef.current.map((w, wi) => (
                        <span
                          key={wi}
                          className={`transition-colors duration-75 ${wi === currentWordIdx ? 'bg-blue-100 text-[#155dfc] rounded-sm px-0.5 -mx-0.5' : ''}`}
                        >
                          {w.text}{' '}
                        </span>
                      ))

: msg.type === 'ai'
? <MarkdownPreview
    content={msg.content}
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
: renderMessageContent(msg.content, false, msg.sources ?? [])                  }
                </div>

                {/* AI 메시지 재생 버튼 — 음성 모드일 때만 표시 */}
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

              {/* 재생 진행 바 — 클릭으로 seek 가능 */}
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

              {/* 재생 속도 컨트롤 — 재생 중인 메시지에만 */}
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
      {messages.length > 0 && (() => {
        const PAGE_SIZE = 3;
        const totalPages = Math.max(1, Math.ceil(suggestions.length / PAGE_SIZE));
        const clampedPage = Math.min(suggestionsPage, totalPages - 1);
        const pageSlice = suggestions.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
        const BORDER_COLORS = ["border-l-blue-400", "border-l-purple-400", "border-l-emerald-400"];
        return (
          <div className="shrink-0 px-3 py-3 border-t border-[#e7e9ed] bg-[#f8f9fb]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-[#99a1af] flex items-center gap-1.5">
                <span className="text-amber-400 text-xs">✦</span>
                이런 건 어떠세요?
              </span>
              <div className="flex items-center gap-0.5">
                {totalPages > 1 && (
                  <>
                    <button
                      onClick={() => setSuggestionsPage((p) => Math.max(0, p - 1))}
                      disabled={clampedPage === 0}
                      className="p-1 rounded-md text-[#c8cdd5] hover:text-[#155dfc] hover:bg-white transition-all disabled:opacity-30"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <span className="text-[10px] text-[#c8cdd5] px-0.5">{clampedPage + 1}/{totalPages}</span>
                    <button
                      onClick={() => setSuggestionsPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={clampedPage === totalPages - 1}
                      className="p-1 rounded-md text-[#c8cdd5] hover:text-[#155dfc] hover:bg-white transition-all disabled:opacity-30"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestionsLoading
                ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <div key={i} className="h-8 rounded-lg bg-[#e7e9ed]/60 animate-pulse" />
                  ))
                : pageSlice.map((s, i) => {
                    const globalIdx = clampedPage * PAGE_SIZE + i;
                    const borderColor = BORDER_COLORS[i % BORDER_COLORS.length];
                    return (
                      <button
                        key={s.text}
                        onClick={() => { clickedIndexRef.current = globalIdx; setInputValue(s.text); }}
                        disabled={isLoading}
                        className={`w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2.5 rounded-lg border border-l-2 ${borderColor} text-left transition-all disabled:opacity-40 group ${
                          s.isOld
                            ? "bg-[#f8f9fb] opacity-50 hover:opacity-70"
                            : "bg-white hover:border-[#c8cdd5] hover:shadow-sm"
                        }`}
                      >
                        <span className={`text-[12px] flex-1 leading-snug ${s.isOld ? "text-[#99a1af]" : "text-[#414751]"}`}>{s.text}</span>
                        <svg className="w-3.5 h-3.5 text-[#c8cdd5] group-hover:text-[#155dfc] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none">
                          <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    );
                  })
              }
            </div>
          </div>
        );
      })()}

      {/* 입력 영역 */}
      <div className="p-3 bg-white flex flex-col gap-2 shrink-0">
        {/* STT 에러 메시지 */}
        {sttError && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
            <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[11px] text-red-600 flex-1">{sttError}</span>
            <button onClick={() => setSttError(null)} className="text-red-400 hover:text-red-600">
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
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            rows={1}
            className="flex-1 max-h-[100px] min-h-[40px] py-2 bg-transparent text-[#1a1d26] text-[13px] placeholder-[#99a1af] focus:outline-none resize-none self-center"
            placeholder={isRecording ? "듣고 있어요... (다시 클릭하면 완료)" : "학습 내용에 대해 무엇이든 물어보세요..."}
          />
          <div className="flex items-center gap-1 shrink-0">
            {/* 마이크 버튼 (STT) */}
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
