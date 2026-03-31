"use client";

import {
  QuizView,
  AudioView,
  FlashcardView,
  SlideView,
  ReportView,
  SummaryView,
  MemoView,
} from "../StudioViews";
import MindMapView from "../MindMapView";

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
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-100 text-sm text-gray-700 hover:bg-gray-200">
            학습 종료
          </button>
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

  return (
    <div className="p-10 flex flex-col items-center justify-center h-full text-center">
      <p className="text-gray-500 mb-4">현재 화면에서 지원하지 않는 항목입니다.</p>
      <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200">
        학습 종료
      </button>
    </div>
  );
}
