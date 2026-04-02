"use client";

import { useCallback, useEffect, useRef } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";

async function downloadUrl(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl; a.download = filename; a.click();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}
function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

interface SourceInfo {
  id: string;
  filename: string;
  file_type: string;
}

interface StudentSourceViewerProps {
  source: SourceInfo;
  sourceUrl?: string;
  sourceFileUrl?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  transcriptText?: string;
}

export function StudentSourceViewer({
  source,
  sourceUrl,
  sourceFileUrl,
  loading = false,
  error,
  onClose,
  transcriptText,
}: StudentSourceViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lowerType = source.file_type.toLowerCase();
  const isImage = ["image", "jpg", "jpeg", "png", "gif", "webp"].includes(lowerType);
  const isVideo = ["video", "mp4", "mov", "avi", "mkv", "webm"].includes(lowerType);
  const isAudio = ["audio", "mp3", "m4a", "wav"].includes(lowerType);
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
    } catch {
      return "";
    }

    return "";
  };
  const youtubeEmbedUrl = sourceUrl ? getYoutubeEmbedUrl(sourceUrl) : "";
  const isEmbeddableYoutube = Boolean(youtubeEmbedUrl);

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

  const handleClose = () => {
    stopPlayback();
    onClose();
  };

  return (
    <div className="h-full w-full bg-white flex flex-col">
      <div className="shrink-0 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-gray-900 truncate leading-tight">{source.filename}</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {lowerType === "url" ? "웹 소스" : `${source.file_type.toUpperCase()} 문서`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {sourceFileUrl && !isEmbeddableYoutube && lowerType !== "url" && (
            <button
              onClick={() => downloadUrl(sourceFileUrl, source.filename)}
              title="다운로드"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
            >
              <Download className="w-4 h-4" />
              저장
            </button>
          )}
          {!sourceUrl && transcriptText && (
            <button
              onClick={() => downloadText(transcriptText, `${source.filename}.txt`)}
              title="텍스트 다운로드"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
            >
              <Download className="w-4 h-4" />
              저장
            </button>
          )}
          {sourceFileUrl && (
            <a
              href={sourceFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
            >
              <ExternalLink className="w-4 h-4" />
              새 탭
            </a>
          )}
          <button
            onClick={handleClose}
            className="px-2.5 py-1 rounded-lg bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#f8f9fb] p-3 overflow-auto">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">문서를 불러오는 중입니다.</p>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 gap-3">
            <p className="text-sm">{error}</p>
          </div>
        ) : !sourceUrl && transcriptText ? (
          <div className="h-full p-4 overflow-y-auto">
            <div className="bg-white rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-200">
              {transcriptText}
            </div>
          </div>
        ) : !sourceUrl ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 gap-3">
            <p className="text-sm">표시할 문서 URL이 없습니다.</p>
          </div>
        ) : isImage ? (
          <div className="h-full flex items-center justify-center">
            <img src={sourceUrl} alt={source.filename} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
          </div>
        ) : isEmbeddableYoutube ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-full max-w-5xl aspect-video rounded-lg overflow-hidden bg-black shadow-sm">
              <iframe
                ref={iframeRef}
                src={youtubeEmbedUrl}
                title={source.filename}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : isVideo ? (
          <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto">
            <div className="bg-black rounded-xl overflow-hidden flex items-center justify-center">
              <video ref={videoRef} src={sourceUrl} controls className="max-w-full rounded-lg" style={{ maxHeight: "calc(100vh - 320px)" }} />
            </div>
            {transcriptText && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">변환된 텍스트</p>
                <div className="bg-white rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-200">
                  {transcriptText}
                </div>
              </div>
            )}
          </div>
        ) : isAudio ? (
          <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto">
            <div className="flex justify-center">
              <audio ref={audioRef} src={sourceUrl} controls className="w-full max-w-xl" />
            </div>
            {transcriptText && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">변환된 텍스트</p>
                <div className="bg-white rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-200">
                  {transcriptText}
                </div>
              </div>
            )}
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={sourceUrl}
            title={source.filename}
            className="w-full h-full rounded-lg border border-gray-200 bg-white"
          />
        )}
      </div>
    </div>
  );
}
