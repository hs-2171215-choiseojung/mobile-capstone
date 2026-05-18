"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
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

const InfographicView = dynamic(
  () => import("../InfographicView").then((m) => ({ default: m.InfographicView })),
  { ssr: false }
);

const DataTableView = dynamic(
  () => import("../DataTableView").then((m) => ({ default: m.DataTableView })),
  { ssr: false }
);

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
  sessionState?: any;
  onSessionStateChange?: (state: any) => void;
  docs?: { id: string; filename?: string; name?: string; file_type?: string }[];
  onRequestSource?: (docId: string, page: number | null, text?: string | null, timestamp?: number | null) => void;
}

export function StudioItemViewer({ item, onClose, sessionState, onSessionStateChange, docs, onRequestSource }: StudioItemViewerProps) {
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
    // content.doc_ids가 있으면 우선 사용, 없으면 상위에서 넘어온 docs 사용
    const quizDocIds: string[] = c.doc_ids || [];
    const sourceDocs = quizDocIds.length > 0
      ? quizDocIds.map((id: string) => {
          const found = (docs || []).find((d) => d.id === id);
          return found || { id };
        })
      : (docs || []);

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
        sourceDocs={sourceDocs}
        onBack={onClose}
        initialState={sessionState ?? undefined}
        onStateChange={onSessionStateChange}
        onRequestSource={onRequestSource}
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
    return (
      <MindMapView
        nodes={c.nodes || item.mindmap?.nodes || []}
        title={toText(item.title, "마인드맵")}
        onBack={onClose}
        initialState={sessionState ?? undefined}
        onStateChange={onSessionStateChange}
      />
    );
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
        initialState={sessionState ?? undefined}
        onStateChange={onSessionStateChange}
      />
    );
  }

  if (t === "flashcard") {
    return (
      <FlashcardView
        cards={c.cards || item.flashcard?.cards || []}
        title={toText(item.title, "플래시카드")}
        onBack={onClose}
        initialState={sessionState ?? undefined}
        onStateChange={onSessionStateChange}
      />
    );
  }

  if (t === "slides") {
    return (
      <SlideView
        slides={c.slides || item.slides?.slides || []}
        title={toText(item.title, "슬라이드")}
        coverImageB64={c.cover_image_b64 || item.slides?.cover_image_b64 || ""}
        onBack={onClose}
        initialState={sessionState ?? undefined}
        onStateChange={onSessionStateChange}
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
    return (
      <DataTableView
        data={{
          title: toText(item.title, "데이터 표"),
          description: c.description || "",
          columns: c.columns || [],
          rows: c.rows || c.data || [],
        }}
        onBack={onClose}
      />
    );
  }

  if (t === "infographic") {
    const sections = c.sections || item.infographic?.sections || [];
    const title = toText(item.title, "인포그래픽");
    const description = c.description || item.infographic?.description || "";
    return (
      <InfographicView
        data={{ title, description, sections }}
        onBack={onClose}
      />
    );
  }

  return (
    <div className="p-10 flex flex-col items-center justify-center h-full text-center">
      <p className="text-gray-500 mb-4">현재 화면에서 지원하지 않는 항목입니다.</p>
      <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200">
        돌아가기
      </button>
    </div>
  );
}

