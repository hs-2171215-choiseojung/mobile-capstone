"use client";

import { Download, ExternalLink, Loader2, X, Volume2, Play, Pause, Square, ChevronDown, ChevronUp, Copy, Check, ArrowUpToLine, ArrowDownToLine } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

async function downloadUrl(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTimestamp(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const KNOWN_EXTS = new Set([
  "pdf", "docx", "doc", "pptx", "ppt", "hwp", "hwpx", "txt", "xlsx", "xls",
  "jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "avi", "mkv", "webm", "mp3", "m4a", "wav",
]);
const AUDIO_SUMMARY_EXTS = new Set([
  "jpg","jpeg","png","gif","webp",
  "pdf","docx","doc","pptx","ppt","hwp","hwpx","txt",
]);

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Waveform() {
  const bars = [3, 5, 8, 5, 7, 4, 6, 3, 7, 5];
  return (
    <span className="flex items-end gap-[2px] h-4">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-blue-500"
          style={{
            height: `${h * 2}px`,
            animation: `waveBar 0.8s ease-in-out ${(i * 0.08).toFixed(2)}s infinite alternate`,
          }}
        />
      ))}
    </span>
  );
}

interface SubtitleSegment { text: string; start: number; end: number; }

interface SummaryCache {
  summaryText: string;
  audioBase64: string;
  sentences: SubtitleSegment[];
}

export interface SharedSourceInfo {
  id: string;
  filename: string;
  file_type: string;
  storage_path?: string;
}

export interface MediaTimelineEntry {
  time_sec: number;
  label?: string;
  text: string;
}

export interface MediaSummarySection {
  title: string;
  start_sec: number;
  end_sec?: number;
  summary: string;
}

export interface MediaSummaryData {
  title: string;
  overview: string;
  sections: MediaSummarySection[];
}

export interface SharedSourceViewerProps {
  source: SharedSourceInfo;
  sourceUrl?: string;
  sourceFileUrl?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  transcriptText?: string;
  mediaTimeline?: MediaTimelineEntry[];
  mediaSummaryData?: MediaSummaryData | null;
  mediaSummaryLoading?: boolean;
  showMediaSummaryToggle?: boolean;
  onRequestMediaSummary?: () => void;
  seekRequest?: { seconds: number; nonce: number } | null;
  onMediaInfoChange?: (info: { kind: "audio" | "video" | null; duration: number }) => void;
  highlightRange?: { start: number; length: number };
}

export function SharedSourceViewer({
  source,
  sourceUrl,
  sourceFileUrl,
  loading = false,
  error,
  onClose,
  transcriptText,
  mediaTimeline = [],
  mediaSummaryData = null,
  mediaSummaryLoading = false,
  showMediaSummaryToggle = false,
  onRequestMediaSummary,
  seekRequest,
  onMediaInfoChange,
  highlightRange,
}: SharedSourceViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const summaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const summaryCache = useRef<Map<string, SummaryCache>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const highlightMarkRef = useRef<HTMLElement | null>(null);

  const [audioSummaryState, setAudioSummaryState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [hasSummary, setHasSummary] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [sentences, setSentences] = useState<SubtitleSegment[]>([]);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioCurrent, setAudioCurrent] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [copied, setCopied] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("sarah");
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [summaryError, setSummaryError] = useState("");
  
  const videoSectionRef = useRef<HTMLDivElement | null>(null);
  const [videoPaneHeight, setVideoPaneHeight] = useState(420);
  const [mediaTextView, setMediaTextView] = useState<"transcript" | "summary">("transcript");
  const [activeTab, setActiveTab] = useState<"document" | "text">("document");

  // highlightRange 가 설정되면 자동으로 텍스트 탭으로 전환 (DOCX/HWP/HWPX)
  useEffect(() => {
    if (highlightRange) setActiveTab("text");
  }, [highlightRange]);

  useEffect(() => {
    if (highlightRange && highlightMarkRef.current) {
      highlightMarkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightRange]);

  function renderTranscript(text: string, range?: { start: number; length: number }) {
    if (!range || range.start < 0 || range.length <= 0) return <>{text}</>;
    const start = Math.max(0, Math.min(range.start, text.length));
    const end = Math.min(start + range.length, text.length);
    if (start >= end) return <>{text}</>;
    return (
      <>
        {text.slice(0, start)}
        <mark
          ref={(el) => { highlightMarkRef.current = el; }}
          className="bg-yellow-300 text-gray-900 rounded-sm"
        >
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </>
    );
  }

  const lowerType = source.file_type.toLowerCase();
  const fileExt = source.filename.toLowerCase().split(".").pop() ?? "";
  const storagePath = source.storage_path ?? "";
  const isUrlSource =
    lowerType === "url" ||
    lowerType === "link" ||
    (storagePath.startsWith("http") && !KNOWN_EXTS.has(fileExt));
  const effectiveExt = isUrlSource ? "" : (KNOWN_EXTS.has(fileExt) ? fileExt : lowerType);
  const isImage = ["image", "jpg", "jpeg", "png", "gif", "webp"].includes(effectiveExt);
  const isVideo = ["video", "mp4", "mov", "avi", "mkv", "webm"].includes(effectiveExt);
  const isAudio = ["audio", "mp3", "m4a", "wav"].includes(effectiveExt);
  
  const canAudioSummary = !isUrlSource && AUDIO_SUMMARY_EXTS.has(effectiveExt);

  // 현재 재생 위치에 해당하는 자막 문장
  const currentSentence = sentences.find(
    (s) => audioCurrent >= s.start && audioCurrent <= s.end + 0.3
  ) ?? null;

  const mediaUrl = sourceUrl || sourceFileUrl;
  const timelineEntries = useMemo(
    () => mediaTimeline.filter((entry) => entry && typeof entry.text === "string" && entry.text.trim()),
    [mediaTimeline]
  );
  const summaryTitle = mediaSummaryData?.title?.trim() || "전체 내용 요약";
  const summaryOverview = mediaSummaryData?.overview?.trim() || "";
  const summarySections = useMemo(
    () => (mediaSummaryData?.sections ?? []).filter((section) => section && typeof section.summary === "string" && section.summary.trim()),
    [mediaSummaryData]
  );

  const getYoutubeEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "youtu.be") {
        const id = parsed.pathname.split("/").filter(Boolean)[0];
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }
      if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
        if (parsed.pathname === "/watch") {
          const id = parsed.searchParams.get("v");
          return id ? `https://www.youtube.com/embed/${id}` : "";
        }
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0] === "embed" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}`;
        if (parts[0] === "shorts" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}`;
        if (parts[0] === "live" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}`;
      }
    } catch { return ""; }
    return "";
  };

  const youtubeEmbedUrl = mediaUrl ? getYoutubeEmbedUrl(mediaUrl) : "";
  const isEmbeddableYoutube = Boolean(youtubeEmbedUrl);
  const isMediaLike = isVideo || isAudio || isEmbeddableYoutube;

  const seekMedia = useCallback((seconds: number) => {
    if (isEmbeddableYoutube && iframeRef.current) {
      const targetUrl = new URL(youtubeEmbedUrl);
      targetUrl.searchParams.set("start", String(Math.max(0, Math.floor(seconds))));
      targetUrl.searchParams.set("autoplay", "1");
      iframeRef.current.src = targetUrl.toString();
      return;
    }
    const target = isVideo ? videoRef.current : audioRef.current;
    if (!target || Number.isNaN(seconds)) return;
    target.currentTime = Math.max(0, seconds);
    void target.play().catch(() => undefined);
  }, [isEmbeddableYoutube, isVideo, youtubeEmbedUrl]);

  const stopSummaryAudio = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (summaryAudioRef.current) {
      summaryAudioRef.current.pause();
      summaryAudioRef.current.ontimeupdate = null;
      summaryAudioRef.current.onloadedmetadata = null;
      summaryAudioRef.current.onended = null;
      summaryAudioRef.current.onerror = null;
      summaryAudioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setAudioSummaryState("idle");
    setAudioProgress(0);
    setAudioCurrent(0);
    setAudioDuration(0);
  }, []);

  const stopPlayback = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (iframeRef.current) {
      iframeRef.current.src = "about:blank";
    }
    stopSummaryAudio();
  }, [stopSummaryAudio]);

  // 파일 변경 시 오디오 중지, 캐시 복원
  useEffect(() => {
    stopSummaryAudio();
    const cached = summaryCache.current.get(source.id);
    if (cached) {
      setSummaryText(cached.summaryText);
      setSentences(cached.sentences);
      setHasSummary(true);
    } else {
      setSummaryText("");
      setSentences([]);
      setHasSummary(false);
    }
    setSummaryExpanded(false);
    setPlaybackRate(1);
    setSelectedVoice("sarah");
    setSummaryError("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  useEffect(() => {
    if (!seekRequest) return;
    seekMedia(seekRequest.seconds);
  }, [seekMedia, seekRequest]);

  useEffect(() => {
    const target = isVideo ? videoRef.current : isAudio ? audioRef.current : null;
    if (!target || !onMediaInfoChange) return;

    const notify = () => {
      onMediaInfoChange({
        kind: isVideo ? "video" : "audio",
        duration: Number.isFinite(target.duration) ? target.duration : 0,
      });
    };

    target.addEventListener("loadedmetadata", notify);
    target.addEventListener("durationchange", notify);
    notify();

    return () => {
      target.removeEventListener("loadedmetadata", notify);
      target.removeEventListener("durationchange", notify);
    };
  }, [isAudio, isVideo, mediaUrl, onMediaInfoChange]);

  useEffect(() => {
    if (isEmbeddableYoutube && onMediaInfoChange) {
      onMediaInfoChange({ kind: "video", duration: 0 });
    } else if (!isAudio && !isVideo && onMediaInfoChange) {
      onMediaInfoChange({ kind: null, duration: 0 });
    }
  }, [isAudio, isEmbeddableYoutube, isVideo, onMediaInfoChange]);

  useEffect(() => {
    setMediaTextView("transcript");
  }, [source.id]);

  useEffect(() => {
    if (isEmbeddableYoutube) {
      setVideoPaneHeight(360);
    }
  }, [isEmbeddableYoutube, source.id]);

  const handleClose = () => {
    stopPlayback();
    onClose();
  };

  const playAudioFromBase64 = async (audioBase64: string) => {
    const byteChars = atob(audioBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "audio/mpeg" });
    const audioUrl = URL.createObjectURL(blob);
    audioUrlRef.current = audioUrl;

    const audio = new Audio(audioUrl);
    audio.playbackRate = playbackRate;
    summaryAudioRef.current = audio;

    audio.onloadedmetadata = () => setAudioDuration(audio.duration);
    let lastUpdate = 0;
    audio.ontimeupdate = () => {
      const now = Date.now();
      if (now - lastUpdate < 200) return; // 200ms throttle
      lastUpdate = now;
      setAudioCurrent(audio.currentTime);
      setAudioProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    audio.onended = () => stopSummaryAudio();
    audio.onerror = () => stopSummaryAudio();

    await audio.play();
    setAudioSummaryState("playing");
  };

  const handleAudioSummary = async () => {
    if (audioSummaryState === "loading") return;

    // 재생 중 → 일시정지
    if (audioSummaryState === "playing") {
      summaryAudioRef.current?.pause();
      setAudioSummaryState("paused");
      return;
    }

    // 일시정지 → 재개
    if (audioSummaryState === "paused" && summaryAudioRef.current) {
      await summaryAudioRef.current.play();
      setAudioSummaryState("playing");
      return;
    }

    // 캐시에 오디오 있으면 재생성 없이 바로 재생
    const cached = summaryCache.current.get(source.id);
    if (cached) {
      await playAudioFromBase64(cached.audioBase64);
      return;
    }

    // 새로 생성
    setSummaryError("");
    setAudioSummaryState("loading");
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/documents/${source.id}/audio-summary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ voice: selectedVoice }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "음성 요약 생성에 실패했습니다.");
      }

      const data = await res.json();
      const { summary_text, audio_base64, sentences: segs } = data;

      summaryCache.current.set(source.id, {
        summaryText: summary_text,
        audioBase64: audio_base64,
        sentences: segs,
      });
      setSummaryText(summary_text);
      setSentences(segs);
      setHasSummary(true);

      await playAudioFromBase64(audio_base64);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return; // 취소는 에러 아님
      setSummaryError(e instanceof Error ? e.message : "음성 요약 생성에 실패했습니다.");
      setAudioSummaryState("idle");
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = summaryAudioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (summaryAudioRef.current) summaryAudioRef.current.playbackRate = rate;
  };

  const handleDownloadAudio = () => {
    const cached = summaryCache.current.get(source.id);
    if (!cached) return;
    const byteChars = atob(cached.audioBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${source.filename}_요약.mp3`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVoiceChange = async (voice: string) => {
    if (voice === selectedVoice) return;
    stopSummaryAudio();
    summaryCache.current.delete(source.id);
    setSummaryText("");
    setSentences([]);
    setHasSummary(false);
    setSelectedVoice(voice);

    // 즉시 새 음성으로 재생성 + 재생
    setSummaryError("");
    setAudioSummaryState("loading");
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/documents/${source.id}/audio-summary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "음성 요약 생성에 실패했습니다.");
      }

      const data = await res.json();
      summaryCache.current.set(source.id, {
        summaryText: data.summary_text,
        audioBase64: data.audio_base64,
        sentences: data.sentences,
      });
      setSummaryText(data.summary_text);
      setSentences(data.sentences);
      setHasSummary(true);
      await playAudioFromBase64(data.audio_base64);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setSummaryError(e instanceof Error ? e.message : "음성 생성에 실패했습니다.");
      setAudioSummaryState("idle");
    }
  };

  const handleCopyText = async () => {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = summaryText;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSelectMediaTextView = (nextView: "transcript" | "summary") => {
    setMediaTextView(nextView);
    if (nextView === "summary" && summarySections.length === 0) {
      onRequestMediaSummary?.();
    }
  };

  const startVideoResize = useCallback((clientY: number) => {
    const containerRect = videoSectionRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const startHeight = videoPaneHeight;
    const startY = clientY;
    const minHeight = 220;
    const maxHeight = Math.max(minHeight, Math.min(760, containerRect.height - 120));

    const handlePointerMove = (event: PointerEvent) => {
      const nextHeight = startHeight + (event.clientY - startY);
      setVideoPaneHeight(Math.max(minHeight, Math.min(maxHeight, nextHeight)));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [videoPaneHeight]);

  const renderTranscriptBody = (heading: string) => {
    if (timelineEntries.length > 0) {
      return (
        <div>
          {heading ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{heading}</p>
          ) : null}
          <div className="space-y-3">
            {timelineEntries.map((entry, index) => (
              <div key={`${entry.time_sec}-${index}`} className="rounded-xl border border-gray-200 bg-white p-4">
                <button
                  type="button"
                  onClick={() => seekMedia(entry.time_sec)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {formatTimestamp(entry.time_sec)}
                </button>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{entry.text}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (typeof transcriptText !== "string") return null;

    return (
      <div>
        {heading ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{heading}</p>
        ) : null}
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
          {transcriptText}
        </div>
      </div>
    );
  };

  const renderSummarySection = () => {
    if (mediaSummaryLoading) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">
          주제별 요약을 생성하는 중입니다.
        </div>
      );
    }

    if (summarySections.length === 0) {
      if (summaryOverview) {
        return (
          <article className="rounded-2xl border border-gray-200 bg-white px-6 py-7">
            <header>
              <h3 className="text-2xl font-bold tracking-tight text-gray-950">{summaryTitle}</h3>
            </header>
            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-gray-700">{summaryOverview}</p>
          </article>
        );
      }
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-500">
          아직 요약이 준비되지 않았습니다.
        </div>
      );
    }

    return (
      <article className="rounded-2xl border border-gray-200 bg-white px-6 py-7">
        <header>
          <h3 className="text-2xl font-bold tracking-tight text-gray-950">{summaryTitle}</h3>
          {summaryOverview ? (
            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-gray-700">{summaryOverview}</p>
          ) : null}
        </header>
        {summarySections.map((section, index) => (
          <section
            key={`${section.start_sec}-${index}`}
            className="mt-8"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-xl font-semibold tracking-tight text-gray-950">{section.title}</h4>
              <button
                type="button"
                onClick={() => seekMedia(section.start_sec)}
                className="shrink-0 text-base font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                ({formatTimestamp(section.start_sec)})
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-8 text-gray-700">{section.summary}</p>
          </section>
        ))}
      </article>
    );
  };

  const renderMediaContentSection = () => {
    const heading = "";
    const canShowSummaryToggle = showMediaSummaryToggle && isMediaLike;

    if (!canShowSummaryToggle) {
      return renderTranscriptBody(heading);
    }

    return (
      <div>
        <div className="mb-3 flex justify-end">
          <div className="inline-flex rounded-full border border-gray-200 bg-white p-1">
            <button
              type="button"
              onClick={() => handleSelectMediaTextView("transcript")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mediaTextView === "transcript" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              텍스트
            </button>
            <button
              type="button"
              onClick={() => handleSelectMediaTextView("summary")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mediaTextView === "summary" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              요약
            </button>
          </div>
        </div>
        {mediaTextView === "summary" ? renderSummarySection() : renderTranscriptBody(heading)}
      </div>
    );
  };
  // DOCX/HWP/HWPX: sourceUrl + transcriptText 둘 다 있고, 이미지/비디오/오디오/유튜브가 아닌 경우 탭 표시
  const hasBothViews = Boolean(
    sourceUrl && transcriptText !== undefined && !isImage && !isVideo && !isAudio && !isEmbeddableYoutube && !isUrlSource
  );

  // 탭바: 하이라이트 점 표시 여부 (DOCX/HWP/HWPX)
  const hasHighlight = Boolean(highlightRange && highlightRange.start >= 0);

  return (
    <div className="h-full w-full bg-white flex flex-col">
      {/* 헤더 */}
      <div className="shrink-0 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-gray-900 truncate leading-tight">{source.filename}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {canAudioSummary ? (
            <button
              onClick={handleAudioSummary}
              disabled={audioSummaryState === "loading"}
              title={
                audioSummaryState === "playing" ? "일시정지"
                : audioSummaryState === "paused" ? "이어서 듣기"
                : "음성으로 요약 듣기"
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-60 ${
                audioSummaryState === "playing" || audioSummaryState === "paused"
                  ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {audioSummaryState === "loading" ? <Loader2 className="w-4 h-4 animate-spin" />
                : audioSummaryState === "playing" ? <Pause className="w-3.5 h-3.5 fill-current" />
                : audioSummaryState === "paused" ? <Play className="w-3.5 h-3.5 fill-current" />
                : <Volume2 className="w-4 h-4" />}
              {audioSummaryState === "loading" ? "생성 중..."
                : audioSummaryState === "playing" ? "일시정지"
                : audioSummaryState === "paused" ? "이어서 듣기"
                : "음성 요약"}
            </button>
          ) : null}
          {(sourceFileUrl && !isEmbeddableYoutube && lowerType !== "url") ? (
            <button onClick={() => downloadUrl(sourceFileUrl, source.filename)} title="다운로드"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
              <Download className="w-4 h-4" /> 저장
            </button>
          ) : null}
          {!mediaUrl && transcriptText && (
            <button
              onClick={() => downloadText(transcriptText, `${source.filename}.txt`)}
              title="텍스트 다운로드"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
            >
              <Download className="w-4 h-4" />
              저장
            </button>
          )}
          {(!sourceUrl && transcriptText) ? (
            <button onClick={() => downloadText(transcriptText, `${source.filename}.txt`)} title="텍스트 다운로드"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
              <Download className="w-4 h-4" /> 저장
            </button>
          ) : null}
          {sourceFileUrl ? (
            <a href={sourceFileUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
              <ExternalLink className="w-4 h-4" /> 새 탭
            </a>
          ) : null}
          <button onClick={handleClose} className="px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 탭 바 — DOCX/HWP/HWPX: sourceUrl + transcriptText 둘 다 있을 때만 표시 */}
      {hasBothViews && (
        <div className="shrink-0 flex border-b border-gray-200 bg-white px-4">
          <button
            onClick={() => setActiveTab("document")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "document"
                ? "border-[#155dfc] text-[#155dfc]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            문서 보기
          </button>
          <button
            onClick={() => setActiveTab("text")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "text"
                ? "border-[#155dfc] text-[#155dfc]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            텍스트 보기
            {hasHighlight && activeTab !== "text" && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[#155dfc] inline-block align-middle" />
            )}
          </button>
        </div>
      )}

      {/* 본문 (자막 오버레이 포함) */}
      <div className="flex-1 bg-[#f8f9fb] p-3 overflow-auto relative">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">문서를 불러오는 중입니다.</p>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 gap-3">
            <p className="text-sm">{error}</p>
          </div>
        ) : !mediaUrl && transcriptText !== undefined ? (
          <div className="h-full p-4 overflow-y-auto">
            <div className="bg-white rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-200">
              {transcriptText
                ? renderTranscript(transcriptText, highlightRange)
                : <span className="text-gray-400">텍스트를 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.</span>
              }
            </div>
          </div>
        ) : !mediaUrl ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 gap-3">
            <p className="text-sm">표시할 문서 URL이 없습니다.</p>
          </div>
        ) : hasBothViews && activeTab === "text" ? (
          /* 텍스트 탭 (DOCX·PPTX 등) */
          <div className="h-full p-4 overflow-y-auto">
            <div className="bg-white rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-200">
              {transcriptText
                ? renderTranscript(transcriptText, highlightRange)
                : <span className="text-gray-400">텍스트를 불러오는 중입니다...</span>
              }
            </div>
          </div>
        ) : isImage ? (
          <div className="h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl} alt={source.filename} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
          </div>
        ) : isEmbeddableYoutube ? (
          <div ref={videoSectionRef} className="h-full flex flex-col p-4 overflow-hidden">
            <div className="shrink-0" style={{ height: videoPaneHeight }}>
              <div className="h-full w-full rounded-xl overflow-hidden bg-black shadow-sm">
                <iframe
                  ref={iframeRef}
                  src={youtubeEmbedUrl}
                  title={source.filename}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
            <button
              type="button"
              aria-label="Resize video and transcript panels"
              onPointerDown={(event) => {
                event.preventDefault();
                startVideoResize(event.clientY);
              }}
              className="shrink-0 mt-2 mb-2 flex h-6 w-full cursor-row-resize items-center justify-center"
            >
              <span className="flex w-full items-center gap-3 px-1">
                <span className="h-px flex-1 bg-[#d7dce5]" />
                <span className="h-1.5 w-20 rounded-full bg-[#b8c0cc]" />
                <span className="h-px flex-1 bg-[#d7dce5]" />
              </span>
            </button>
            <div className="min-h-[240px] flex-1 overflow-y-auto pr-1 pt-2">
              {renderMediaContentSection()}
              <a
                href={mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                영상이 차단되는 경우 YouTube에서 보기
              </a>
            </div>
          </div>
        ) : isVideo ? (
          <div ref={videoSectionRef} className="h-full flex flex-col p-4 overflow-hidden">
            <div className="shrink-0" style={{ height: videoPaneHeight }}>
              <div className="h-full w-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  className="h-full w-full object-contain rounded-xl bg-black"
                />
              </div>
            </div>
            <button
              type="button"
              aria-label="Resize video and transcript panels"
              onPointerDown={(event) => {
                event.preventDefault();
                startVideoResize(event.clientY);
              }}
              className="shrink-0 mt-2 mb-2 flex h-6 w-full cursor-row-resize items-center justify-center"
            >
              <span className="flex w-full items-center gap-3 px-1">
                <span className="h-px flex-1 bg-[#d7dce5]" />
                <span className="h-1.5 w-20 rounded-full bg-[#b8c0cc]" />
                <span className="h-px flex-1 bg-[#d7dce5]" />
              </span>
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-2">
              {renderMediaContentSection()}
            </div>
          </div>
        ) : isAudio ? (
          <div className="h-full flex flex-col gap-4 p-4 overflow-hidden">
            <div className="shrink-0 flex justify-center">
              <audio ref={audioRef} src={mediaUrl} controls className="w-full max-w-xl" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {renderMediaContentSection()}
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={mediaUrl}
            title={source.filename}
            className="w-full h-full rounded-lg border border-gray-200 bg-white"
          />
        )}

        {/* 실시간 자막 오버레이 — DOM 노드 유지, opacity로 표시/숨김 */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-[90%] max-w-2xl pointer-events-none transition-opacity duration-200 ${subtitlePosition === "top" ? "top-5" : "bottom-5"}`}
          style={{
            opacity: (audioSummaryState === "playing" || audioSummaryState === "paused") && currentSentence ? 1 : 0,
          }}
        >
          <div className="bg-black/70 text-white text-[14px] leading-relaxed rounded-xl px-5 py-3 text-center backdrop-blur-sm shadow-lg">
            {currentSentence?.text ?? ""}
          </div>
        </div>
      </div>

      {/* 음성 요약 패널 — canAudioSummary면 항상 표시 */}
      {canAudioSummary ? (
        <div className="shrink-0 border-t border-gray-100 bg-white">

          {/* ── 상태별 메인 영역 (단일 삼항 체인 — &&로 분기하면 DOM 조정 오류) ── */}
          {audioSummaryState === "loading" ? (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-800">음성 요약 생성 중...</p>
                <p className="text-[11px] text-gray-400 mt-0.5">AI가 내용을 분석하고 있습니다</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex gap-[3px] items-end h-5">
                  {[4,6,9,6,8,5,7].map((h, i) => (
                    <span key={i} className="w-1 rounded-full bg-blue-300"
                      style={{ height: `${h * 2}px`, animation: `waveBar 0.8s ease-in-out ${(i * 0.1).toFixed(1)}s infinite alternate` }} />
                  ))}
                </div>
                {/* 취소 버튼 */}
                <button
                  onClick={stopSummaryAudio}
                  className="px-2.5 py-1 rounded-full bg-gray-100 text-[11px] text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors font-medium"
                >
                  취소
                </button>
              </div>
            </div>
          ) : audioSummaryState === "playing" || audioSummaryState === "paused" ? (
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2.5 mb-2.5">
                <button onClick={handleAudioSummary}
                  className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center shrink-0 transition-all active:scale-95 shadow-sm">
                  {audioSummaryState === "playing"
                    ? <Pause className="w-3.5 h-3.5 fill-white text-white" />
                    : <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />}
                </button>
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {audioSummaryState === "playing"
                      ? <Waveform />
                      : <span className="flex items-end gap-[2px] h-4">
                          {[3,5,8,5,7,4,6,3,7,5].map((h, i) => (
                            <span key={i} className="w-[3px] rounded-full bg-gray-300" style={{ height: `${h * 2}px` }} />
                          ))}
                        </span>
                    }
                    <span className="text-[11px] text-gray-400 tabular-nums ml-auto shrink-0">
                      {formatTime(audioCurrent)} / {formatTime(audioDuration)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full cursor-pointer relative overflow-hidden group" onClick={handleSeek}>
                    <div className="absolute left-0 top-0 h-full bg-blue-500 rounded-full transition-all group-hover:bg-blue-600"
                      style={{ width: `${audioProgress * 100}%` }} />
                  </div>
                </div>
                <button onClick={stopSummaryAudio}
                  className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center shrink-0 transition-colors" title="정지">
                  <Square className="w-3 h-3 fill-gray-500 text-gray-500" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {[0.75, 1, 1.25, 1.5].map((rate) => (
                    <button key={rate} onClick={() => handleSpeedChange(rate)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                        playbackRate === rate ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}>
                      {rate}x
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setSubtitlePosition((p) => p === "bottom" ? "top" : "bottom")}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-[11px] text-gray-500 hover:bg-gray-200 transition-colors">
                    {subtitlePosition === "bottom" ? <ArrowUpToLine className="w-3 h-3" /> : <ArrowDownToLine className="w-3 h-3" />}
                    자막
                  </button>
                  <button onClick={handleDownloadAudio}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-[11px] text-gray-500 hover:bg-gray-200 transition-colors">
                    <Download className="w-3 h-3" /> MP3
                  </button>
                </div>
              </div>
            </div>
          ) : hasSummary ? (
            <div className="px-4 py-2.5 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Volume2 className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="flex-1 flex items-center gap-2 flex-wrap">
                {([
                  { key: "sarah", label: "Sarah" }, { key: "rachel", label: "Rachel" },
                  { key: "josh",  label: "Josh"  }, { key: "adam",   label: "Adam"  },
                ] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => handleVoiceChange(key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                      selectedVoice === key ? "bg-blue-500 text-white shadow-sm" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={handleAudioSummary}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500 text-white text-[12px] font-semibold hover:bg-blue-600 active:scale-95 transition-all shadow-sm">
                <Play className="w-3.5 h-3.5 fill-current" /> 다시 듣기
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* 에러 메시지 */}
              {summaryError ? (
                <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
                  <span className="text-red-400 text-[13px] mt-0.5 shrink-0">⚠</span>
                  <p className="text-[12px] text-red-600 leading-relaxed flex-1">{summaryError}</p>
                  <button onClick={() => setSummaryError("")} className="text-red-300 hover:text-red-500 shrink-0 mt-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
              <div className="px-4 py-3 flex items-center gap-3">
                <Volume2 className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] text-gray-500 shrink-0">음성 요약</span>
                  <div className="flex items-center gap-1">
                    {([
                      { key: "sarah",  label: "Sarah",  desc: "차분한 여성" },
                      { key: "rachel", label: "Rachel", desc: "명확한 여성" },
                      { key: "josh",   label: "Josh",   desc: "친근한 남성" },
                      { key: "adam",   label: "Adam",   desc: "전문적인 남성" },
                    ] as const).map(({ key, label, desc }) => (
                      <button key={key} onClick={() => setSelectedVoice(key)} title={desc}
                        className={`px-2.5 py-1 rounded-full text-[12px] font-medium transition-all ${
                          selectedVoice === key ? "bg-blue-500 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleAudioSummary}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500 text-white text-[12px] font-semibold hover:bg-blue-600 active:scale-95 transition-all shadow-sm">
                  <Play className="w-3.5 h-3.5 fill-current" /> 생성하기
                </button>
              </div>
            </div>
          )}

          {/* 요약 텍스트 접기/펼치기 (생성 후) */}
          {summaryText ? (
            <div className="border-t border-gray-50">
              <div className="px-4 py-2 flex items-center justify-between">
                <button onClick={() => setSummaryExpanded((v) => !v)}
                  className="flex items-center gap-1.5 text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
                  {summaryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {summaryExpanded ? "요약 텍스트 접기" : "요약 텍스트 보기"}
                </button>
                <button onClick={handleCopyText}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    copied ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "복사됨" : "복사"}
                </button>
              </div>
              {summaryExpanded ? (
                <div className="mx-4 mb-3 bg-gray-50 rounded-xl p-3 text-[12px] text-gray-600 leading-relaxed max-h-44 overflow-y-auto border border-gray-100">
                  {sentences.length > 0
                    ? sentences.map((seg, i) => (
                        <span
                          key={i}
                          className={`transition-colors duration-200 ${
                            currentSentence === seg
                              ? "bg-blue-100 text-blue-700 rounded px-0.5"
                              : ""
                          }`}
                        >
                          {seg.text}{" "}
                        </span>
                      ))
                    : <span className="whitespace-pre-wrap">{summaryText}</span>
                  }
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
