"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import MarkdownPreview from "@/components/workspace/MarkdownPreview";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

/** DOCX/HWPX 마크다운 렌더러 */
function MarkdownViewer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url}
      components={{
        h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-3 text-gray-900 border-b border-gray-200 pb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-bold mt-5 mb-2 text-gray-800">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 text-gray-800">{children}</h3>,
        h4: ({ children }) => <h4 className="text-base font-semibold mt-3 mb-1 text-gray-700">{children}</h4>,
        p: ({ children }) => <p className="mb-3 text-gray-700 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
        ul: ({ children }) => <ul className="list-disc ml-5 mb-3 space-y-1 text-gray-700">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal ml-5 mb-3 space-y-1 text-gray-700">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        table: ({ children }) => <div className="overflow-x-auto mb-4"><table className="min-w-full border-collapse text-sm">{children}</table></div>,
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-gray-200">{children}</tbody>,
        tr: ({ children }) => <tr className="hover:bg-gray-50">{children}</tr>,
        th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border border-gray-200">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2 text-gray-700 border border-gray-200">{children}</td>,
        blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600 mb-3">{children}</blockquote>,
        hr: () => <hr className="border-gray-200 my-4" />,
        // eslint-disable-next-line @next/next/no-img-element
        img: ({ src, alt }) => <img src={src} alt={alt ?? "이미지"} className="max-w-full rounded-lg shadow-sm my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
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

export interface SharedSourceViewerProps {
  source: SharedSourceInfo;
  sourceUrl?: string;
  sourceFileUrl?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  transcriptText?: string;
  mediaTimeline?: MediaTimelineEntry[];
  seekRequest?: { seconds: number; nonce: number } | null;
  onMediaInfoChange?: (info: { kind: "audio" | "video" | null; duration: number }) => void;
  highlightRange?: { start: number; length: number };
  scrollToText?: string;
  customViewer?: ReactNode;
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
  seekRequest,
  onMediaInfoChange,
  highlightRange,
  scrollToText,
  customViewer,
}: SharedSourceViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const highlightMarkRef = useRef<HTMLElement | null>(null);
  const textScrollRef = useRef<HTMLDivElement | null>(null);

  const [markdownText, setMarkdownText] = useState<string | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);

  const videoSectionRef = useRef<HTMLDivElement | null>(null);
  const [videoPaneHeight, setVideoPaneHeight] = useState(420);
  const [activeTab, setActiveTab] = useState<"document" | "text">("document");
  const [showMediaTranscript, setShowMediaTranscript] = useState(false);

  // highlightRange 가 설정되면 자동으로 텍스트 탭으로 전환 (DOCX/HWP/HWPX)
  useEffect(() => {
    if (highlightRange) setActiveTab("text");
  }, [highlightRange]);

  useEffect(() => {
    if (highlightRange && highlightMarkRef.current) {
      highlightMarkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightRange]);

  // scrollToText 가 설정되면 DOM에서 해당 텍스트를 찾아 스크롤
  useEffect(() => {
    if (!scrollToText) return;
    setActiveTab("text");
    const search = scrollToText.slice(0, 80).trim();
    if (!search) return;
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const attempt = (retries: number) => {
      if (cancelled) return;
      const container = textScrollRef.current;
      if (!container) {
        if (retries > 0) timeouts.push(setTimeout(() => attempt(retries - 1), 100));
        return;
      }
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.includes(search)) {
          const el = node.parentElement;
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      }
    };
    timeouts.push(setTimeout(() => attempt(3), 150));
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, [scrollToText]);

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

  const mediaUrl = sourceUrl || sourceFileUrl;
  const timelineEntries = useMemo(
    () => mediaTimeline.filter((entry) => entry && typeof entry.text === "string" && entry.text.trim()),
    [mediaTimeline]
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
  const hasMediaTranscript = timelineEntries.length > 0 || typeof transcriptText === "string";

  useEffect(() => {
    setShowMediaTranscript(false);
  }, [source.id]);

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
  }, []);

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
    if (isEmbeddableYoutube) {
      setVideoPaneHeight(360);
    }
  }, [isEmbeddableYoutube, source.id]);

  // DOCX/HWPX: 마크다운 변환 텍스트 fetch
  useEffect(() => {
    const ext = source.filename.toLowerCase().split(".").pop() ?? "";
    if (ext !== "docx" && ext !== "hwpx") {
      setMarkdownText(null);
      return;
    }
    let cancelled = false;
    setMarkdownText(null);
    setMarkdownLoading(true);
    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token || cancelled) return;
        const res = await fetch(`${API}/api/documents/${source.id}/markdown`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setMarkdownText(data.markdown ?? null);
      } catch {
        // 변환 실패 시 기존 텍스트로 폴백 (setMarkdownText(null) 유지)
      } finally {
        if (!cancelled) setMarkdownLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source.id, source.filename]);

  const handleClose = () => {
    stopPlayback();
    onClose();
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
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
            {timelineEntries.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n")}
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

  const renderMediaContentSection = () => {
    return renderTranscriptBody("");
  };

  // DOCX/HWP/HWPX: sourceUrl + transcriptText 둘 다 있고, 이미지/비디오/오디오/유튜브가 아닌 경우 탭 표시
  const hasBothViews = Boolean(
    (sourceUrl || customViewer) && transcriptText !== undefined && !isImage && !isVideo && !isAudio && !isEmbeddableYoutube && !isUrlSource
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
          {isMediaLike && hasMediaTranscript ? (
            <button
              type="button"
              onClick={() => setShowMediaTranscript((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
            >
              {showMediaTranscript ? "자막 숨기기" : "자막 보기"}
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
            {(fileExt === "docx" || fileExt === "hwpx") ? "마크다운 보기" : "텍스트 보기"}
            {hasHighlight && activeTab !== "text" && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[#155dfc] inline-block align-middle" />
            )}
          </button>
        </div>
      )}

      {/* 본문 */}
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
        ) : !customViewer && !mediaUrl && transcriptText !== undefined ? (
          <div ref={(el) => { textScrollRef.current = el; }} className="h-full p-4 overflow-y-auto">
            <div className="bg-white rounded-xl p-4 text-sm leading-relaxed border border-gray-200">
              {fileExt === "hwpx" && markdownText ? (
                <MarkdownViewer content={markdownText} />
              ) : transcriptText ? (
                <span className="text-gray-700 whitespace-pre-wrap">{renderTranscript(transcriptText, highlightRange)}</span>
              ) : markdownLoading ? (
                <span className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />불러오는 중...</span>
              ) : (
                <span className="text-gray-400">텍스트를 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.</span>
              )}
            </div>
          </div>
        ) : !customViewer && !mediaUrl ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 gap-3">
            <p className="text-sm">표시할 문서 URL이 없습니다.</p>
          </div>
        ) : hasBothViews && activeTab === "text" ? (
          /* 마크다운/텍스트 탭 (DOCX 등) */
          <div ref={(el) => { textScrollRef.current = el; }} className="h-full p-4 overflow-y-auto">
            <div className="bg-white rounded-xl p-4 text-sm leading-relaxed border border-gray-200">
              {(fileExt === "docx" || fileExt === "hwpx") && markdownText ? (
                <MarkdownViewer content={markdownText} />
              ) : (fileExt === "docx" || fileExt === "hwpx") && markdownLoading ? (
                <span className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />마크다운 변환 중...</span>
              ) : transcriptText ? (
                <span className="text-gray-700 whitespace-pre-wrap">{renderTranscript(transcriptText, highlightRange)}</span>
              ) : (
                <span className="text-gray-400">텍스트를 불러오는 중입니다...</span>
              )}
            </div>
          </div>
        ) : isImage ? (
          <div className="h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl} alt={source.filename} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
          </div>
        ) : isEmbeddableYoutube ? (
          <div ref={videoSectionRef} className="h-full flex flex-col p-4 overflow-hidden">
            <div className="shrink-0" style={{ height: showMediaTranscript ? videoPaneHeight : "100%" }}>
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
            {showMediaTranscript ? (
              <>
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
              </>
            ) : null}
          </div>
        ) : isVideo ? (
          <div ref={videoSectionRef} className="h-full flex flex-col p-4 overflow-hidden">
            <div className="shrink-0" style={{ height: showMediaTranscript ? videoPaneHeight : "100%" }}>
              <div className="h-full w-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  className="h-full w-full object-contain rounded-xl bg-black"
                />
              </div>
            </div>
            {showMediaTranscript ? (
              <>
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
              </>
            ) : null}
          </div>
        ) : isAudio ? (
          <div className="h-full flex flex-col gap-4 p-4 overflow-hidden">
            <div className="shrink-0 flex justify-center">
              <audio ref={audioRef} src={mediaUrl} controls className="w-full max-w-xl" />
            </div>
            {showMediaTranscript ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {renderMediaContentSection()}
              </div>
            ) : null}
          </div>
        ) : customViewer ? (
          <div className="w-full h-full">{customViewer}</div>
        ) : (
          <iframe
            key={mediaUrl}
            ref={iframeRef}
            src={mediaUrl}
            title={source.filename}
            className="w-full h-full rounded-lg border border-gray-200 bg-white"
          />
        )}
      </div>
    </div>
  );
}
