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
  initialPage?: number | null;
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
  initialPage,
}: SharedSourceViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const highlightMarkRef = useRef<HTMLElement | null>(null);
  const textScrollRef = useRef<HTMLDivElement | null>(null);

  const [markdownText, setMarkdownText] = useState<string | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);

  const [imgZoom, setImgZoom] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const imgIsPanning = useRef(false);
  const imgPanStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const videoSectionRef = useRef<HTMLDivElement | null>(null);
  const [videoPaneHeight, setVideoPaneHeight] = useState(420);
  const [activeTab, setActiveTab] = useState<"document" | "text">("document");
  const [showMediaTranscript, setShowMediaTranscript] = useState(false);

  // highlightRange 가 설정되면 자동으로 텍스트 탭으로 전환 (DOCX/HWP/HWPX) — PPTX/PPT 제외
  useEffect(() => {
    if (!highlightRange) return;
    const ext = source.filename.toLowerCase().split(".").pop() ?? "";
    if (ext === "pptx" || ext === "ppt") return; // 슬라이드 뷰어에서 currentSlide로 처리
    setActiveTab("text");
  }, [highlightRange, source.filename]);

  useEffect(() => {
    if (highlightRange && highlightMarkRef.current) {
      highlightMarkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightRange]);

  // scrollToText 가 설정되면 DOM에서 해당 텍스트를 찾아 스크롤 + 하이라이트
  useEffect(() => {
    if (!scrollToText) return;
    const ext = source.filename.toLowerCase().split(".").pop() ?? "";
    if (ext === "pptx" || ext === "ppt") {
      // PPTX/PPT: 슬라이드 뷰어(문서 보기)를 유지하고 currentSlide prop으로 이동
      setActiveTab("document");
      return;
    }
    setActiveTab("text");
    const search = scrollToText.slice(0, 80).trim();
    if (!search) return;
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const removeHighlights = (container: HTMLElement) => {
      // <mark data-quiz-ref> 언래핑
      container.querySelectorAll("mark[data-quiz-ref]").forEach((mark) => {
        const parent = mark.parentNode;
        if (parent) {
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        }
      });
      // 블록 요소에 붙인 인라인 스타일 제거
      container.querySelectorAll("[data-quiz-ref]").forEach((el) => {
        (el as HTMLElement).removeAttribute("data-quiz-ref");
        (el as HTMLElement).style.removeProperty("background-color");
        (el as HTMLElement).style.removeProperty("border-radius");
        (el as HTMLElement).style.removeProperty("outline");
        (el as HTMLElement).style.removeProperty("outline-offset");
      });
    };

    const attempt = (retries: number) => {
      if (cancelled) return;
      const container = textScrollRef.current;
      if (!container) {
        if (retries > 0) timeouts.push(setTimeout(() => attempt(retries - 1), 200));
        return;
      }
      removeHighlights(container);

      // 검색 변형 목록: 정확 일치 → 소문자 비교 → 앞 40자 단축 → 마크다운 기호 제거
      const lowerSearch = search.toLowerCase();
      const shortSearch = search.length > 40 ? search.slice(0, 40) : "";
      const shortLower = shortSearch ? shortSearch.toLowerCase() : "";
      // DOCX → 마크다운 변환 시 **CPU** 같은 깨진 기호가 textContent에 남는 경우 대응
      const stripMd = (t: string) => t.replace(/\*+|_+|`+/g, " ").replace(/\s+/g, " ").trim();
      const strippedSearch = stripMd(search);
      const strippedShort = strippedSearch.length > 40 ? strippedSearch.slice(0, 40) : strippedSearch;
      // "디스크 유틸리티 사용" → "디스크 유틸리티" (마지막 단어 제거)
      // 짧은 노드 텍스트 fallback 시 한국어 조사/접미어로 인한 불일치 해결
      const withoutLastWord = (() => {
        const s = strippedSearch.trim();
        if (s.length > 25) return ""; // 긴 텍스트는 stripMd 검색으로 충분
        const lastSpace = s.lastIndexOf(" ");
        return lastSpace > 0 ? s.slice(0, lastSpace) : "";
      })();

      const matchBlock = (text: string) => {
        const stripped = stripMd(text);
        const strippedLower = stripped.toLowerCase();
        return (
          text.includes(search) ||
          text.toLowerCase().includes(lowerSearch) ||
          (shortSearch !== "" && (text.includes(shortSearch) || text.toLowerCase().includes(shortLower))) ||
          strippedLower.includes(strippedSearch.toLowerCase()) ||
          strippedLower.includes(strippedShort.toLowerCase()) ||
          (withoutLastWord.length >= 3 && strippedLower.includes(withoutLastWord.toLowerCase()))
        );
      };

      // 1단계: 블록 레벨 요소의 textContent 전체에서 검색
      // (마크다운 렌더링 시 bold/italic 등으로 텍스트가 여러 인라인 노드로 분리된 경우 대응)
      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre")
      );
      let targetEl: HTMLElement | null = null;
      for (const block of blocks) {
        if (matchBlock(block.textContent ?? "")) {
          targetEl = block;
          break;
        }
      }

      // 2단계: 블록에서 못 찾으면 텍스트 노드 직접 탐색
      if (!targetEl) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (matchBlock(node.textContent ?? "") && node.parentElement) {
            targetEl = node.parentElement;
            break;
          }
        }
      }

      if (!targetEl) {
        // 아직 렌더링 안 됐을 수 있으므로 재시도
        if (retries > 0) timeouts.push(setTimeout(() => attempt(retries - 1), 300));
        return;
      }

      // 3단계: targetEl 안의 텍스트 노드에서 정확한 위치에 <mark> 삽입 시도
      // 정확 → 소문자 → 단축 순으로 시도
      const findInNode = (t: string): { idx: number; len: number } | null => {
        let idx = t.indexOf(search);
        if (idx !== -1) return { idx, len: search.length };
        idx = t.toLowerCase().indexOf(lowerSearch);
        if (idx !== -1) return { idx, len: lowerSearch.length };
        if (shortSearch) {
          idx = t.indexOf(shortSearch);
          if (idx !== -1) return { idx, len: shortSearch.length };
          idx = t.toLowerCase().indexOf(shortLower);
          if (idx !== -1) return { idx, len: shortLower.length };
        }
        return null;
      };

      const innerWalker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT);
      let textNode: Text | null;
      let highlighted = false;
      let markedEl: HTMLElement | null = null;
      while ((textNode = innerWalker.nextNode() as Text | null)) {
        const hit = findInNode(textNode.textContent ?? "");
        if (hit) {
          try {
            const range = document.createRange();
            range.setStart(textNode, hit.idx);
            range.setEnd(textNode, hit.idx + hit.len);
            const mark = document.createElement("mark");
            mark.setAttribute("data-quiz-ref", "1");
            mark.style.cssText = "background-color:#fde68a;border-radius:3px;padding:0 2px;box-shadow:0 0 0 2px #fbbf24;";
            range.surroundContents(mark);
            markedEl = mark;
            highlighted = true;
            break;
          } catch { /* 범위가 인라인 요소 경계를 넘는 경우 → fallback */ }
        }
      }

      if (!highlighted) {
        // fallback: 블록 요소 전체를 노란 배경 + 테두리로 강조
        targetEl.setAttribute("data-quiz-ref", "1");
        targetEl.style.cssText += ";background-color:#fde68a;border-radius:4px;outline:2px solid #fbbf24;outline-offset:2px;";
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // mark 삽입 성공: mark 위치로 스크롤 (targetEl이 전체 span일 경우 잘못된 위치로 스크롤되는 문제 수정)
        markedEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    timeouts.push(setTimeout(() => attempt(6), 150));
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  // loading·markdownText 가 바뀔 때도 재시도 (문서 로드/마크다운 변환 완료 후 하이라이트)
  }, [scrollToText, loading, markdownText]);

  function renderTranscript(text: string, range?: { start: number; length: number }) {
    const lines = text.split('\n');
    if (!range || range.start < 0 || range.length <= 0) {
      return (
        <>
          {lines.map((line, i) => (
            <p key={i} className="mb-1">{line || '\u00a0'}</p>
          ))}
        </>
      );
    }
    // highlight range 를 각 줄(paragraph)에 적용
    const hlStart = Math.max(0, Math.min(range.start, text.length));
    const hlEnd = Math.min(hlStart + range.length, text.length);
    if (hlStart >= hlEnd) {
      return (
        <>
          {lines.map((line, i) => (
            <p key={i} className="mb-1">{line || '\u00a0'}</p>
          ))}
        </>
      );
    }
    let offset = 0;
    return (
      <>
        {lines.map((line, i) => {
          const lineStart = offset;
          const lineEnd = offset + line.length;
          offset += line.length + 1; // +1 for '\n'
          if (hlStart >= lineEnd || hlEnd <= lineStart) {
            return <p key={i} className="mb-1">{line || '\u00a0'}</p>;
          }
          const s = Math.max(0, hlStart - lineStart);
          const e = Math.min(line.length, hlEnd - lineStart);
          return (
            <p key={i} className="mb-1">
              {s > 0 && line.slice(0, s)}
              <mark
                ref={(el) => { highlightMarkRef.current = el; }}
                className="bg-yellow-300 text-gray-900 rounded-sm"
              >
                {line.slice(s, e)}
              </mark>
              {e < line.length && line.slice(e)}
            </p>
          );
        })}
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

  useEffect(() => {
    setImgZoom(1);
    setImgPan({ x: 0, y: 0 });
  }, [source.id]);

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
  const showHeaderActions = !loading;

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
          {showHeaderActions ? (
            <>
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
                  <Download className="w-4 h-4" /> 다운로드
                </button>
              ) : null}
              {!mediaUrl && transcriptText ? (
                <button onClick={() => downloadText(transcriptText, `${source.filename}.txt`)} title="텍스트 다운로드"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
                  <Download className="w-4 h-4" /> 다운로드
                </button>
              ) : null}
              {sourceFileUrl ? (
                <a href={sourceFileUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
                  <ExternalLink className="w-4 h-4" /> 새 탭
                </a>
              ) : null}
            </>
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
                <div className="text-gray-700 text-sm leading-relaxed">{renderTranscript(transcriptText, highlightRange)}</div>
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
                <div className="text-gray-700 text-sm leading-relaxed">{renderTranscript(transcriptText, highlightRange)}</div>
              ) : (
                <span className="text-gray-400">텍스트를 불러오는 중입니다...</span>
              )}
            </div>
          </div>
        ) : isImage ? (
          <div
            className="h-full flex items-center justify-center overflow-hidden"
            style={{ cursor: imgZoom > 1 ? "grab" : "default" }}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              const next = Math.min(5, Math.max(1, imgZoom + delta));
              setImgZoom(next);
              if (next <= 1) setImgPan({ x: 0, y: 0 });
            }}
            onMouseDown={(e) => {
              if (imgZoom <= 1) return;
              imgIsPanning.current = true;
              imgPanStart.current = { mx: e.clientX, my: e.clientY, px: imgPan.x, py: imgPan.y };
            }}
            onMouseMove={(e) => {
              if (!imgIsPanning.current) return;
              setImgPan({
                x: imgPanStart.current.px + (e.clientX - imgPanStart.current.mx),
                y: imgPanStart.current.py + (e.clientY - imgPanStart.current.my),
              });
            }}
            onMouseUp={() => { imgIsPanning.current = false; }}
            onMouseLeave={() => { imgIsPanning.current = false; }}
          >
            {imgZoom > 1 && (
              <div className="absolute top-3 right-3 z-10 bg-black/50 text-white text-xs px-2 py-1 rounded-full pointer-events-none">
                {Math.round(imgZoom * 100)}%
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl}
              alt={source.filename}
              draggable={false}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm transition-transform duration-75"
              style={{ transform: `scale(${imgZoom}) translate(${imgPan.x / imgZoom}px, ${imgPan.y / imgZoom}px)` }}
            />
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
            key={initialPage ? `${mediaUrl}#page${initialPage}` : mediaUrl}
            ref={iframeRef}
            src={initialPage ? `${mediaUrl}#page=${initialPage}` : mediaUrl}
            title={source.filename}
            className="w-full h-full rounded-lg border border-gray-200 bg-white"
          />
        )}
      </div>
    </div>
  );
}
