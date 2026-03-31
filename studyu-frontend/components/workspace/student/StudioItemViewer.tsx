"use client";

import { useState, useEffect } from "react";
import {
  QuizView,
  AudioView,
  FlashcardView,
  SlideView,
  ReportView,
  SummaryView,
  MemoView,
  MindMapView,
} from "../StudioViews";

function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const normalizeStudioType = (rawType: string) => {
  const typeMap: Record<string, string> = {
    slide: "slides",
    notepad: "memo",
    plan: "mindmap",
    data: "table",
  };
  return typeMap[rawType] || rawType;
};

interface StudioItemViewerProps {
  item: any;
  onClose: () => void;
}

export function StudioItemViewer({ item, onClose }: StudioItemViewerProps) {
  if (!item) return null;

  const toText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "title" in (value as Record<string, unknown>)) {
      return toText((value as Record<string, unknown>).title, fallback);
    }
    return fallback;
  };

  const t = normalizeStudioType(item.type);
  const c = item.content || {};

  if (t === "quiz") {
    return (
      <QuizView
        quiz={
          item.quiz || {
            id: item.id,
            title: toText(item.title, "퀴즈"),
            questions: c.questions || [],
            createdAt: new Date(),
            difficulty: c.difficulty || "intermediate",
          }
        }
        onBack={onClose}
      />
    );
  }

  if (t === "summary") {
    return <SummaryView content={c.text || item.summaryContent || ""} onBack={onClose} />;
  }

  if (t === "audio") {
    return (
      <AudioView
        audioBase64={c.audio_base64 || item.audio?.base64}
        audioUrl={item.audioUrl || item.audio_url}
        script={c.script || item.audio?.script || ""}
        title={toText(item.title, "오디오")}
        onBack={onClose}
      />
    );
  }

  if (t === "mindmap") {
    return <MindMapView nodes={c.nodes || item.mindmap?.nodes || []} title={toText(item.title, "마인드맵")} onBack={onClose} />;
  }

  if (t === "memo") {
    return (
      <MemoView
        initialId={item.id}
        initialTitle={toText(item.title, "메모")}
        initialContent={c.text || item.memoContent || ""}
        onBack={onClose}
        onSave={async () => ""}
        readOnly
      />
    );
  }

  if (t === "flashcard") {
    return <FlashcardView cards={c.cards || item.flashcard?.cards || []} title={toText(item.title, "플래시카드")} onBack={onClose} />;
  }

  if (t === "slides") {
    return (
      <SlideView
        slides={c.slides || item.slides?.slides || []}
        title={toText(item.title, "슬라이드")}
        coverImageB64={c.cover_image_b64 || item.slides?.cover_image_b64 || ""}
        onBack={onClose}
      />
    );
  }

  if (t === "report") {
    return (
      <ReportView
        sections={c.sections || item.report?.sections || []}
        title={toText(item.title, "보고서")}
        format={c.format || item.report?.format || "custom"}
        onBack={onClose}
      />
    );
  }

  if (t === "table") {
    const headers = (c.headers || c.columns || []) as string[];
    const rows = (c.rows || c.data || []) as Array<string[] | Record<string, any>>;
    const normalizedRows: string[][] = rows.map((row) => {
      if (Array.isArray(row)) return row.map((cell) => String(cell ?? ""));
      if (headers.length > 0) return headers.map((h) => String((row as Record<string, any>)[h] ?? ""));
      return Object.values(row as Record<string, any>).map((v) => String(v ?? ""));
    });
    const fallbackHeaders = headers.length > 0
      ? headers
      : (normalizedRows[0] ? normalizedRows[0].map((_, idx) => `열 ${idx + 1}`) : []);

    return (
      <div className="h-full w-full bg-white flex flex-col">
        <div className="shrink-0 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{toText(item.title, "데이터 표")}</h2>
            <p className="text-xs text-gray-500 mt-1">AI가 생성한 표 형식 학습 자료</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadCsv(fallbackHeaders, normalizedRows, `${toText(item.title, "데이터표")}.csv`)}
              title="CSV 다운로드"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-500 transition-colors text-xs"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              저장
            </button>
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-100 text-sm text-gray-700 hover:bg-gray-200">
              학습 종료
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          {normalizedRows.length === 0 ? (
            <div className="text-sm text-gray-500">표 데이터가 없습니다.</div>
          ) : (
            <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                {fallbackHeaders.length > 0 && (
                  <thead className="bg-gray-100">
                    <tr>
                      {fallbackHeaders.map((h, idx) => (
                        <th key={`${h}-${idx}`} className="px-4 py-2 text-left font-semibold text-gray-700 border-b border-gray-200 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {normalizedRows.map((row, rIdx) => (
                    <tr key={`r-${rIdx}`} className="odd:bg-white even:bg-gray-50">
                      {row.map((cell, cIdx) => (
                        <td key={`c-${rIdx}-${cIdx}`} className="px-4 py-2 text-gray-700 border-b border-gray-100 align-top">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (t === "video") {
    return <VideoItemViewer item={item} c={c} toText={toText} onClose={onClose} />;
  }

  return (
    <div className="p-10 flex flex-col items-center justify-center h-full text-center">
      <p className="text-gray-500 mb-4">현재 화면에서 지원하지 않는 항목입니다.</p>
      <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200">
        학습 종료
      </button>
    </div>
  );
}

function VideoItemViewer({ item, c, toText, onClose }: { item: any; c: any; toText: (v: unknown, f?: string) => string; onClose: () => void }) {
  const slides = c.slides || item.videoData?.slides || [];
  const title = toText(item.title, "동영상 개요");
  const [rendering, setRendering] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!slides.length) return;
    setRendering(true);
    setRenderError(null);
    fetch("/api/render-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slides }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "렌더링 실패");
        setVideoSrc(`data:video/mp4;base64,${data.videoBase64}`);
      })
      .catch((e: unknown) => setRenderError(e instanceof Error ? e.message : "렌더링 실패"))
      .finally(() => setRendering(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full bg-white flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
        <button onClick={onClose} className="text-sm font-semibold text-red-500 hover:text-red-600">학습 종료</button>
      </div>

      <div className="flex-1 flex items-center justify-center bg-black">
        {videoSrc ? (
          <video controls autoPlay src={videoSrc} className="max-w-full max-h-full" style={{ maxHeight: "calc(100vh - 120px)" }} />
        ) : renderError ? (
          <div className="text-center text-white space-y-3">
            <p className="text-sm text-red-400">{renderError}</p>
            <button
              onClick={() => {
                setRenderError(null);
                setRendering(true);
                fetch("/api/render-video", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slides }),
                })
                  .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                  .then(({ ok, data }) => {
                    if (!ok) throw new Error(data.error ?? "렌더링 실패");
                    setVideoSrc(`data:video/mp4;base64,${data.videoBase64}`);
                  })
                  .catch((e: unknown) => setRenderError(e instanceof Error ? e.message : "렌더링 실패"))
                  .finally(() => setRendering(false));
              }}
              className="px-4 py-2 rounded-lg bg-white text-gray-800 text-sm font-medium hover:bg-gray-100"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-white">
            <svg className="w-8 h-8 animate-spin text-white/60" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
            </svg>
            <p className="text-sm text-white/70">동영상 렌더링 중... (최대 3분 소요)</p>
          </div>
        )}
      </div>
    </div>
  );
}
