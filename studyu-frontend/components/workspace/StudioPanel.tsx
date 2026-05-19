"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { Doc } from "./SourcePanel";

const MindMapView = dynamic(() => import("./MindMapView"), { ssr: false });
const DataTableView = dynamic(() => import("./DataTableView").then(m => ({ default: m.DataTableView })), { ssr: false });
const InfographicView = dynamic(() => import("./InfographicView").then(m => ({ default: m.InfographicView })), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────
interface QuizQuestion {
  question: string;
  type: "multiple_choice" | "ox" | "short_answer";
  options: string[];
  answer: number;
  answerText?: string;
  hint: string;
  explanation: string;
}

interface SavedQuiz {
  id: string;
  title: string;
  questions: QuizQuestion[];
  createdAt: Date;
  difficulty: string;
}

interface QuizConfig {
  count: "fewer" | "standard" | "more";
  difficulty: "easy" | "intermediate" | "hard";
  topic: string;
  quizStyle: "multiple_choice" | "ox" | "short_answer";
}

interface AudioConfig {
  format: "lecture_summary" | "concept_explanation" | "qa" | "storytelling" | "debate" | "interview";
  language: "ko" | "en" | "ja" | "zh";
  length: "short" | "default";
  focus: string;
}

interface MindmapConfig {
  language: "ko" | "en" | "ja" | "zh";
  focus: string;
}

interface FlashcardConfig {
  count: "fewer" | "standard" | "more";
  difficulty: "easy" | "intermediate" | "hard";
  topic: string;
  language: "ko" | "en" | "ja" | "zh";
}

interface SlideConfig {
  format: "presenter" | "detailed";
  length: "short" | "default" | "long";
  language: "ko" | "en" | "ja" | "zh";
  prompt: string;
}

interface ReportConfig {
  format: "briefing" | "study_guide" | "blog" | "prd" | "architecture" | "tech_explainer" | "learning_guide" | "custom";
  language: "ko" | "en" | "ja" | "zh";
  length: "short" | "default" | "long";
  tone: "formal" | "casual" | "academic";
  instructions: string;
}

interface ReportSection {
  heading: string;
  content: string;
}

interface Slide {
  title: string;
  subtitle?: string;
  bullets: string[];
  speaker_notes?: string;
  layout: "title" | "content" | "two_column" | "summary";
  image_b64?: string;
}

interface FlashCard {
  front: string;
  back: string;
  hint: string;
}

interface MindmapNode {
  id: string;
  text: string;
  parent?: string;
}

export interface SavedItem {
  id: string;
  type: "summary" | "quiz" | "audio" | "mindmap" | "memo" | "flashcard" | "slides" | "report" | "data" | "infographic";
  title: string;
  subtitle: string;
  createdAt: Date;
  generating?: boolean;
  generatingError?: string;
  summaryContent?: string;
  quiz?: SavedQuiz;
  audio?: { base64?: string; script: string };
  audioUrl?: string;  // Supabase Storage 서명 URL (DB 로드 시)
  mindmap?: { nodes: MindmapNode[] };
  memoContent?: string;
  flashcard?: { cards: FlashCard[]; difficulty: string };
  slides?: { slides: Slide[]; format: string; cover_image_b64?: string };
  report?: { sections: ReportSection[]; format: string };
  dataTable?: { title: string; description?: string; columns: any[]; rows: any[] };
  infographic?: { title: string; description?: string; sections: any[] };
}

interface WeekSource {
  id: number;
  name: string;
  icon: string;
  iconBg: string;
  docId?: string;
}

interface WeekTask {
  id: number;
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
  itemId?: string;
  studioType?: string;
}

interface Week {
  id: number;
  title: string;
  status: string;
  sources: WeekSource[];
  tasks: WeekTask[];
}

interface Props {
  notebookId: string;
  activeDocIds: string[];
  docs: Doc[];
  getToken: () => Promise<string>;
  weeks?: Week[];
  onAddWeekTask?: (weekId: number, task: WeekTask) => void;
  onRenameItem?: (itemId: string, newTitle: string) => void;
  onDeleteItem?: (itemId: string) => void;
  openItemId?: string | null;
  onOpenItemHandled?: () => void;
  openCreateType?: string | null;
  openCreateWeekId?: number | null;
  onOpenCreateHandled?: () => void;
  openMemoRequest?: number;
  onOpenMemoHandled?: () => void;
  forcePortalSubviews?: boolean;
  onViewItem?: (item: any) => void;
  onSavedItemsChange?: (items: SavedItem[]) => void;
  hideCollections?: boolean;
}

const COUNT_MAP: Record<string, number> = { fewer: 3, standard: 5, more: 10 };
const OPTION_ALPHA = ["A", "B", "C", "D"];

// ── Content type definitions ───────────────────────────────────────────────
const CONTENT_TYPES = [
  { id: "audio",      label: "AI 오디오 오버뷰", shortLabel: "오디오",    cardBg: "#d0f5f1", iconBg: "#a1ece4", iconColor: "#0d9488" },
  { id: "slides",     label: "슬라이드 자료",   shortLabel: "슬라이드",  cardBg: "#fef0da", iconBg: "#fdd89a", iconColor: "#d97706" },
  { id: "mindmap",    label: "마인드맵",        shortLabel: "마인드맵",  cardBg: "#f0e6ff", iconBg: "#d8b4fe", iconColor: "#7c3aed" },
  { id: "report",     label: "보고서",          shortLabel: "문서",      cardBg: "#dcf2e8", iconBg: "#a3e8c4", iconColor: "#166534" },
  { id: "flashcard",  label: "플래시카드",      shortLabel: "플래시카드",cardBg: "#fde0ea", iconBg: "#f9a8c0", iconColor: "#be123c" },
  { id: "quiz",       label: "퀴즈",            shortLabel: "퀴즈",      cardBg: "#dbeafe", iconBg: "#bfdbfe", iconColor: "#1d4ed8" },
  { id: "infographic",label: "인포그래픽",      shortLabel: "인포그릭",  cardBg: "#ede8ff", iconBg: "#c4b5fd", iconColor: "#6d28d9" },
  { id: "table",      label: "데이터 표",       shortLabel: "데이터표",  cardBg: "#f1f3f4", iconBg: "#dadce0", iconColor: "#3c4043" },
];

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
    </svg>
  );
}

function TypeIcon({ id, color, size = 16 }: { id: string; color: string; size?: number }) {
  const cls = `shrink-0`;
  const s = { className: cls, width: size, height: size, fill: "none", viewBox: "0 0 24 24", stroke: color, strokeWidth: "1.5" } as const;
  if (id === "audio") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
  if (id === "slides") return <svg {...s}><rect x="2" y="3" width="20" height="14" rx="2" stroke={color} fill="none" /><path strokeLinecap="round" d="M8 21h8M12 17v4" /></svg>;
  if (id === "mindmap") return <svg {...s}><circle cx="12" cy="12" r="2.5" fill={color} stroke="none" /><circle cx="5" cy="5" r="1.5" fill={color} stroke="none" /><circle cx="19" cy="5" r="1.5" fill={color} stroke="none" /><circle cx="5" cy="19" r="1.5" fill={color} stroke="none" /><circle cx="19" cy="19" r="1.5" fill={color} stroke="none" /><path strokeLinecap="round" d="M10.5 10.5L6.5 6.5M13.5 10.5L17.5 6.5M10.5 13.5L6.5 17.5M13.5 13.5L17.5 17.5" /></svg>;
  if (id === "report") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
  if (id === "flashcard") return <svg {...s}><rect x="2" y="6" width="20" height="13" rx="2" stroke={color} fill="none" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2l-2 4M12 2v4M8 2l2 4" /></svg>;
  if (id === "quiz") return <svg {...s}><circle cx="12" cy="12" r="10" stroke={color} fill="none" /><path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" /></svg>;
  if (id === "infographic") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
  return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" /></svg>;
}

// ── Studio task items (unified modal) ─────────────────────────────────────
interface StudioTaskItem {
  id: string;
  label: string;
  icon: string;
  presets: string[];
}

const STUDIO_TASK_ITEMS: StudioTaskItem[] = [
  { id: "audio",     label: "AI 오디오 오버뷰", icon: "🎧",
    presets: ["강의 요약 오디오","핵심 개념 설명","Q&A 형식","스토리텔링 방식","토론 형식","인터뷰 형식"] },
  { id: "slides",    label: "슬라이드 자료",    icon: "📊",
    presets: ["강의 슬라이드","요약 슬라이드","발표 자료","학습 정리 슬라이드","비교 분석 슬라이드","사례 연구 슬라이드"] },
  { id: "mindmap",   label: "마인드맵",         icon: "🧠",
    presets: ["개념 구조도","인과관계 맵","비교 분석 맵","학습 흐름도","키워드 맵","프로세스 맵"] },
  { id: "report",    label: "보고서",           icon: "📝",
    presets: ["학습 가이드","블로그 게시물","제품 요구사항 정의서","기술 개념 설명서","학습 활용 가이드","사례 분석 보고서"] },
  { id: "flashcard", label: "플래시카드",       icon: "🃏",
    presets: ["단어·정의 카드","Q&A 카드","빈칸 채우기 카드","이미지 연상 카드","공식 암기 카드","사례 카드"] },
  { id: "quiz",      label: "퀴즈",             icon: "✅",
    presets: ["객관식 퀴즈","O/X 퀴즈"] },
  { id: "table",     label: "데이터 표",       icon: "📋",
    presets: ["핵심 내용 정리표","비교 분석 표","개념 정의 표","학습 점검표","진도 추적 표","요약 데이터표"] },
  { id: "infographic", label: "인포그래픽",   icon: "🎨",
    presets: ["개요형","프로세스형","비교형","통계형","타임라인형"] },
];

interface UnifiedConfig {
  format: string;
  instructions: string;
  length: string;
  language: string;
  style: string;
  selectedDocIds: string[];
}

// ── UnifiedGenerateModal (Add Task 스타일 통합 모달) ──────────────────────────
function UnifiedGenerateModal({
  item, loading, docs, activeDocIds, weeks, initialWeekId, onClose, onGenerate,
}: {
  item: StudioTaskItem;
  loading: boolean;
  docs: Doc[];
  activeDocIds: string[];
  weeks: Week[];
  initialWeekId: number | null;
  onClose: () => void;
  onGenerate: (cfg: UnifiedConfig, weekId: number | null) => void;
}) {
  const [cfg, setCfg] = useState<UnifiedConfig>({
    format: item.id === "quiz" ? (item.presets[0] ?? "") : "", instructions: "", length: "10문제", language: "한국어", style: "격식체",
    selectedDocIds: activeDocIds.length > 0 ? activeDocIds : docs.map((d) => d.id),
  });
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(initialWeekId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
        style={{ width: 560, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-gray-800 font-bold" style={{ fontSize: "1.05rem" }}>{item.label} 생성</p>
            <p className="text-gray-400" style={{ fontSize: "0.78rem" }}>상세 옵션을 설정하고 만들기를 누르세요</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          <div className="p-6 space-y-5">

            {/* Source selection */}
            {docs.length > 0 && (
              <div>
                <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>참고 소스 <span className="text-gray-400 font-normal">(선택)</span></p>
                <div className="space-y-2">
                  {docs.map((doc) => {
                    const checked = cfg.selectedDocIds.includes(doc.id);
                    const ext = (doc.type ?? "").toLowerCase();
                    const icon = ext === "pdf" ? "📜" : ext === "url" ? "🔗" : ["jpg","jpeg","png","gif","webp"].includes(ext) ? "🖼️" : "📄";
                    return (
                      <button key={doc.id}
                        onClick={() => setCfg((c) => ({ ...c, selectedDocIds: checked ? c.selectedDocIds.filter((id) => id !== doc.id) : [...c.selectedDocIds, doc.id] }))}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${checked ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"}`}
                      >
                        <span className="text-lg">{icon}</span>
                        <span className={`flex-1 truncate font-semibold ${checked ? "text-blue-700" : "text-gray-600"}`} style={{ fontSize: "0.83rem" }}>{doc.name}</span>
                        {checked && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Format */}
            <div>
              <p className="text-gray-700 mb-3 font-bold" style={{ fontSize: "0.88rem" }}>형식</p>
              {item.id !== "quiz" && (
                <button
                  onClick={() => setCfg((c) => ({ ...c, format: "" }))}
                  className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border-2 mb-3 transition-all ${cfg.format === "" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <span className={cfg.format === "" ? "text-blue-600 font-semibold" : "text-gray-600 font-semibold"} style={{ fontSize: "0.85rem" }}>직접 만들기</span>
                  {cfg.format === "" && <svg className="ml-auto" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
              )}
              {item.id !== "quiz" && <p className="text-gray-400 mb-2 font-semibold" style={{ fontSize: "0.75rem" }}>추천 형식</p>}
              <div className="grid grid-cols-2 gap-2">
                {item.presets.map((preset) => (
                  <button key={preset}
                    onClick={() => setCfg((c) => ({ ...c, format: preset }))}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${cfg.format === preset ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"}`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span className={cfg.format === preset ? "text-blue-600 font-medium" : "text-gray-600"} style={{ fontSize: "0.8rem" }}>{preset}</span>
                    {cfg.format === preset && <svg className="ml-auto shrink-0" width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
              </div>
            </div>

            {/* Instructions */}
            <div>
              <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>추가 지시사항 <span className="text-gray-400 font-normal">(선택)</span></p>
              <textarea
                value={cfg.instructions}
                onChange={(e) => setCfg((c) => ({ ...c, instructions: e.target.value }))}
                placeholder="예) 초등학생도 이해할 수 있도록 쉽게 작성해주세요..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-300 focus:outline-none resize-none text-gray-700 placeholder-gray-300 bg-gray-50 focus:bg-white transition-all"
                style={{ fontSize: "0.84rem" }}
              />
            </div>

            {/* Length */}
            <div>
              <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>문제 수</p>
              <div className="flex gap-2">
                {["5문제","10문제","15문제"].map((opt) => (
                  <button key={opt} onClick={() => setCfg((c) => ({ ...c, length: opt }))}
                    className={`flex-1 py-2 rounded-xl border-2 transition-all ${cfg.length === opt ? "border-blue-400 bg-blue-50 text-blue-600 font-bold" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                    style={{ fontSize: "0.82rem" }}
                  >{opt}</button>
                ))}
              </div>
            </div>

            {/* Week assignment */}
            {weeks.length > 0 && (
              <div>
                <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>주차 등록 <span className="text-gray-400 font-normal">(선택)</span></p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedWeekId(null)}
                    className={`px-3 py-1.5 rounded-xl border-2 font-semibold transition-all ${selectedWeekId === null ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                    style={{ fontSize: "0.82rem" }}
                  >등록 안 함</button>
                  {weeks.map((w, idx) => (
                    <button key={w.id}
                      onClick={() => setSelectedWeekId(w.id)}
                      className={`px-3 py-1.5 rounded-xl border-2 font-semibold transition-all ${selectedWeekId === w.id ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                      style={{ fontSize: "0.82rem" }}
                    >{w.title || `Week ${idx + 1}`}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Create button */}
            <button
              onClick={() => onGenerate(cfg, selectedWeekId)}
              disabled={loading || cfg.selectedDocIds.length === 0}
              className="w-full py-3.5 rounded-2xl text-white transition-all hover:opacity-90 shadow-md disabled:opacity-70"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", fontSize: "0.95rem", fontWeight: 700 }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>
                  생성 중...
                </span>
              ) : (
                <>{item.icon} {item.label} 만들기</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WeekPickerStep (공통 주차 선택 2단계) ────────────────────────────────────
function WeekPickerStep({
  weeks,
  selectedWeekId,
  onSelect,
  onConfirm,
  onClose,
  loading,
  chips,
}: {
  weeks: Week[];
  selectedWeekId: number | null;
  onSelect: (id: number) => void;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
  chips: string[]; // 하단에 표시할 선택 정보 칩
}) {
  return (
    <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {weeks.map((w) => {
          const sel = selectedWeekId === w.id;
          return (
            <button
              key={w.id}
              onClick={() => onSelect(w.id)}
              className="relative flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all"
              style={sel
                ? { background: "#EFF6FF", borderColor: "#2563EB" }
                : { background: "white", borderColor: "#E5E7EB" }}
            >
              {sel && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2 text-xs font-bold text-white"
                style={{ background: sel ? "#2563EB" : "#93C5FD" }}>
                W{w.id}
              </div>
              <p className="text-sm font-semibold text-gray-800 leading-tight">{w.title}</p>
              <p className="text-xs text-gray-400 mt-1">{w.tasks.length}개 태스크</p>
            </button>
          );
        })}
      </div>
      {/* 하단 칩 + 버튼 */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip, i) => (
            <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: "#EFF6FF", color: "#2563EB" }}>
              {chip}
            </span>
          ))}
        </div>
        <button
          onClick={onConfirm}
          disabled={loading || selectedWeekId === null}
          className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all text-white"
          style={{
            background: selectedWeekId !== null ? "#2563EB" : "#93C5FD",
            opacity: loading ? 0.75 : 1,
            cursor: loading || selectedWeekId === null ? "not-allowed" : "pointer",
          }}
        >
          {loading && <Spinner className="w-3.5 h-3.5" />}
          {loading ? "생성 중..." : "추가하기"}
        </button>
      </div>
    </div>
  );
}

// 2단계 모달 공통 헤더
function TwoStepHeader({
  step, title, subtitle, onClose,
  step1Label, step2Label,
}: {
  step: 1 | 2;
  title: string;
  subtitle: string;
  onClose: () => void;
  step1Label: string;
  step2Label: string;
}) {
  return (
    <div className="shrink-0 px-6 pt-5 pb-4 border-b border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          </div>
          <div>
            <p className="text-base font-bold text-gray-800 leading-tight">{title}</p>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {/* Steps */}
      <div className="flex items-center gap-1">
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${step === 1 ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>
          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 1 ? "bg-white/30 text-white" : "bg-gray-300 text-white"}`}>1</span>
          {step1Label}
        </div>
        <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${step === 2 ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>
          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 2 ? "bg-white/30 text-white" : "bg-gray-300 text-white"}`}>2</span>
          {step2Label}
        </div>
      </div>
    </div>
  );
}

// ── AudioModal ─────────────────────────────────────────────────────────────
function AudioModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: AudioConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<AudioConfig>({
    format: "lecture_summary",
    language: "ko",
    length: "default",
    focus: "",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const formats: { id: AudioConfig["format"]; label: string; desc: string }[] = [
    { id: "lecture_summary",      label: "강의 요약 오디오",   desc: "AI가 생성한 오디오 요약" },
    { id: "concept_explanation",  label: "핵심 개념 설명",     desc: "AI가 생성한 오디오 요약" },
    { id: "qa",                   label: "Q&A 형식",           desc: "AI가 생성한 오디오 요약" },
    { id: "storytelling",         label: "스토리텔링 방식",    desc: "AI가 생성한 오디오 요약" },
    { id: "debate",               label: "토론 형식",          desc: "AI가 생성한 오디오 요약" },
    { id: "interview",            label: "인터뷰 형식",        desc: "AI가 생성한 오디오 요약" },
  ];

  const selectedFormat = formats.find((f) => f.id === cfg.format);
  const formatLabel = selectedFormat?.label ?? "오디오";

  function handleNext() {
    if (weeks.length === 0) {
      onGenerate(cfg, null);
    } else {
      setStep(2);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white flex flex-col max-h-[90vh]">
        <TwoStepHeader
          step={step}
          title={step === 1 ? "AI 오디오 오버뷰 생성" : "주차 선택"}
          subtitle={step === 1 ? "원하는 형식을 선택하세요" : `"${formatLabel}" 형식 · 추가할 주차를 선택하세요`}
          onClose={onClose}
          step1Label="형식 선택"
          step2Label="주차 선택"
        />
        {step === 1 ? (
          <>
            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              {/* 형식 카드 그리드 */}
              <div className="grid grid-cols-2 gap-2.5">
                {formats.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setCfg((p) => ({ ...p, format: f.id }))}
                    className="flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all"
                    style={cfg.format === f.id
                      ? { background: "#EFF6FF", borderColor: "#2563EB" }
                      : { background: "white", borderColor: "#E5E7EB" }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5"
                      style={{ background: cfg.format === f.id ? "#DBEAFE" : "#F3F4F6" }}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={cfg.format === f.id ? "#2563EB" : "#9CA3AF"} strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold leading-tight" style={{ color: cfg.format === f.id ? "#2563EB" : "#111827" }}>{f.label}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{f.desc}</p>
                  </button>
                ))}
              </div>
              {/* 언어 / 길이 (컴팩트) */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">언어</p>
                  <select
                    value={cfg.language}
                    onChange={(e) => setCfg((p) => ({ ...p, language: e.target.value as AudioConfig["language"] }))}
                    className="w-full text-xs rounded-xl px-3 py-2 border border-gray-200 outline-none focus:border-blue-400 bg-white text-gray-700"
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">길이</p>
                  <div className="flex gap-1.5">
                    {(["short", "default"] as const).map((l) => (
                      <button key={l} onClick={() => setCfg((p) => ({ ...p, length: l }))}
                        className="flex-1 py-2 rounded-xl text-xs font-medium border-2 transition-all"
                        style={cfg.length === l ? { background: "#EFF6FF", color: "#2563EB", borderColor: "#2563EB" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                        {l === "short" ? "짧게" : "기본값"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {/* 하단 버튼 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0">
              <div className="flex items-center gap-1.5">
                {selectedWeekId !== null && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-600">
                    W{selectedWeekId}
                  </span>
                )}
              </div>
              <button
                onClick={handleNext}
                disabled={loading}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all bg-blue-600 text-white"
                style={{ opacity: loading ? 0.75 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              >
                {loading && <Spinner className="w-3.5 h-3.5" />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep
            weeks={weeks}
            selectedWeekId={selectedWeekId}
            onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)}
            onClose={onClose}
            loading={loading}
            chips={[formatLabel, ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]}
          />
        )}
      </div>
    </div>
  );
}

// ── AudioView ──────────────────────────────────────────────────────────────
function AudioView({ audioBase64, audioUrl: propAudioUrl, script, title, onBack }: {
  audioBase64?: string;
  audioUrl?: string;
  script: string;
  title: string;
  onBack: () => void;
}) {
  // data URI 방식 — Blob URL revoke 문제 없음
  const audioSrc = propAudioUrl || (audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : "");

  const scriptLines = script.split("\n").filter(Boolean);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
      </div>
      <div className="p-4 space-y-4">
        {/* Audio player */}
        <div className="rounded-2xl p-4 bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-teal-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0d9488" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{title}</p>
              <p className="text-xs text-gray-500">AI 오디오 오버뷰</p>
            </div>
          </div>
          <audio controls className="w-full" src={audioSrc} style={{ height: 40 }} />
        </div>
        {/* Script */}
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">스크립트</p>
          </div>
          <div className="p-4 space-y-3 text-sm leading-relaxed">
            {scriptLines.map((line, i) => {
              const isA = line.startsWith("Host A:");
              const isB = line.startsWith("Host B:");
              const text = line.replace(/^Host [AB]: /, "");
              return (
                <div key={i} className={`flex gap-2.5 ${isB ? "flex-row-reverse" : ""}`}>
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white mt-0.5"
                    style={{ background: isA ? "#0d9488" : "#7c3aed" }}
                  >
                    {isA ? "A" : isB ? "B" : "?"}
                  </div>
                  <div
                    className="rounded-xl px-3 py-2 text-sm max-w-[80%]"
                    style={{
                      background: isA ? "#f0fdfb" : isB ? "#f5f3ff" : "#f3f4f6",
                      color: "#1f2937",
                    }}
                  >
                    {text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── QuizModal ──────────────────────────────────────────────────────────────
function QuizModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: QuizConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<QuizConfig>({
    count: "standard",
    difficulty: "intermediate",
    topic: "",
    quizStyle: "multiple_choice",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const diffLabel = cfg.difficulty === "easy" ? "쉬움" : cfg.difficulty === "intermediate" ? "중간" : "어려움";

  function handleNext() {
    if (weeks.length === 0) onGenerate(cfg, null);
    else setStep(2);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white flex flex-col max-h-[90vh]">
        <TwoStepHeader step={step} title={step === 1 ? "퀴즈 만들기" : "주차 선택"}
          subtitle={step === 1 ? "퀴즈 옵션을 설정하세요" : `퀴즈 · ${diffLabel} · 추가할 주차를 선택하세요`}
          onClose={onClose} step1Label="설정" step2Label="주차 선택" />
        {step === 1 ? (
          <>
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2.5">유형</p>
                <div className="flex gap-2">
                  {(["multiple_choice", "ox", "short_answer"] as const).map((s) => (
                    <button key={s} onClick={() => setCfg((p) => ({ ...p, quizStyle: s }))}
                      className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                      style={cfg.quizStyle === s ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" } : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }}>
                      {s === "multiple_choice" ? "객관식" : s === "ox" ? "O / X" : "단답형"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2.5">질문 수</p>
                <div className="flex gap-2">
                  {(["fewer", "standard", "more"] as const).map((c) => (
                    <button key={c} onClick={() => setCfg((p) => ({ ...p, count: c }))}
                      className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                      style={cfg.count === c ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" } : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }}>
                      {c === "fewer" ? "더 적게" : c === "standard" ? "표준(기본값)" : "더 많이"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2.5">난이도</p>
                <div className="flex gap-2">
                  {(["easy", "intermediate", "hard"] as const).map((d) => (
                    <button key={d} onClick={() => setCfg((p) => ({ ...p, difficulty: d }))}
                      className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                      style={cfg.difficulty === d ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" } : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }}>
                      {d === "easy" ? "쉬움" : d === "intermediate" ? "중간(기본값)" : "어려움"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">주제 (선택)</p>
                <textarea value={cfg.topic} onChange={(e) => setCfg((p) => ({ ...p, topic: e.target.value }))}
                  placeholder={"예시:\n• 핵심 개념만 포함해줘\n• 시험 대비용 퀴즈 만들어줘"} rows={3}
                  className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-blue-400 text-gray-800" style={{ lineHeight: 1.6 }} />
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={handleNext} disabled={loading}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all bg-blue-600 text-white"
                style={{ opacity: loading ? 0.75 : 1 }}>
                {loading && <Spinner className="w-3.5 h-3.5" />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep weeks={weeks} selectedWeekId={selectedWeekId} onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)} onClose={onClose} loading={loading}
            chips={["퀴즈", diffLabel, ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]} />
        )}
      </div>
    </div>
  );
}

// ── QuizView ───────────────────────────────────────────────────────────────
function QuizView({ quiz, onBack }: { quiz: SavedQuiz; onBack: () => void }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [selfGraded, setSelfGraded] = useState<boolean | null>(null);
  const total = quiz.questions.length;
  const q = quiz.questions[idx];
  const qType = q.type ?? "multiple_choice";

  function select(i: number) {
    if (answered) return;
    setSelected(i);
    setAnswered(true);
    if (i === q.answer) setScore((s) => s + 1);
  }

  function next() {
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setShowHint(false);
    setUserInput("");
    setSelfGraded(null);
  }

  if (done) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            스튜디오
          </button>
          <span className="text-gray-300">›</span>
          <span className="text-sm font-medium text-gray-700">퀴즈</span>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 text-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
            style={{ background: pct >= 70 ? "#e6f4ea" : "#fce8e6", color: pct >= 70 ? "#137333" : "#c5221f" }}>
            {pct}%
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 mb-1">
              {pct >= 80 ? "훌륭해요! 🎉" : pct >= 60 ? "잘하셨어요!" : "조금 더 공부해봐요"}
            </p>
            <p className="text-sm text-gray-500">{total}문제 중 {score}개 정답</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setIdx(0); setSelected(null); setAnswered(false); setShowHint(false); setDone(false); setScore(0); }}
              className="px-6 py-2.5 rounded-full text-sm font-semibold bg-blue-600 text-white">다시 풀기</button>
            <button onClick={onBack} className="px-6 py-2.5 rounded-full text-sm font-semibold border border-gray-200 text-gray-500">스튜디오로</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700">퀴즈 {idx + 1}/{total}</span>
      </div>
      <div className="p-4 flex-1">
        <div className="rounded-2xl p-4 mb-3 bg-white border border-gray-200">
          <p className="text-sm font-semibold text-gray-800 mb-4">{q.question}</p>
          {qType === "ox" ? (
            <div className="flex gap-6 justify-center py-4">
              {["O", "X"].map((opt, i) => {
                const defaultColor = i === 0 ? "#1a73e8" : "#c5221f";
                let bg = "white", borderColor = defaultColor, color = defaultColor;
                if (answered) {
                  if (i === q.answer) { bg = "#e6f4ea"; borderColor = "#34a853"; color = "#137333"; }
                  else if (i === selected) { bg = "#fce8e6"; borderColor = "#ea4335"; color = "#c5221f"; }
                } else if (selected === i) { bg = i === 0 ? "#e8f0fe" : "#fce8e6"; borderColor = defaultColor; }
                return (
                  <button key={i} onClick={() => select(i)}
                    className="w-24 h-24 rounded-full text-4xl font-black border-4 transition-all"
                    style={{ background: bg, borderColor, color }}>
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : qType === "short_answer" ? (
            !answered ? (
              <div className="space-y-2">
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && userInput.trim()) { e.preventDefault(); setAnswered(true); } }}
                  placeholder="답을 입력하세요..."
                  rows={2}
                  className="w-full text-sm rounded-xl px-4 py-3 border-2 border-gray-200 outline-none resize-none focus:border-blue-400"
                />
                <button onClick={() => setAnswered(true)} disabled={!userInput.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white"
                  style={{ opacity: userInput.trim() ? 1 : 0.45 }}>
                  정답 확인
                </button>
              </div>
            ) : (
              <div className="rounded-xl p-4 bg-green-50 border border-green-200 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-green-700 mb-1">정답</p>
                  <p className="text-sm font-bold text-green-900">{q.answerText}</p>
                </div>
                {selfGraded === null && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setSelfGraded(true); setScore((s) => s + 1); }}
                      className="flex-1 py-2 rounded-lg text-sm font-medium bg-green-500 text-white">
                      맞았어요 ✓
                    </button>
                    <button onClick={() => setSelfGraded(false)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-400 text-white">
                      틀렸어요 ✗
                    </button>
                  </div>
                )}
                {selfGraded !== null && (
                  <p className="text-xs text-center font-semibold pt-1" style={{ color: selfGraded ? "#137333" : "#c5221f" }}>
                    {selfGraded ? "정답이에요! 🎉" : "아쉽네요. 다음에 잘 할 수 있어요!"}
                  </p>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2">
              {q.options.map((opt, i) => {
                let bg = "white", borderColor = "#e0e0e0", color = "#202124";
                if (answered) {
                  if (i === q.answer) { bg = "#e6f4ea"; borderColor = "#34a853"; color = "#137333"; }
                  else if (i === selected) { bg = "#fce8e6"; borderColor = "#ea4335"; color = "#c5221f"; }
                } else if (selected === i) { bg = "#e8f0fe"; borderColor = "#1a73e8"; color = "#1a73e8"; }
                return (
                  <button key={i} onClick={() => select(i)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-all border"
                    style={{ background: bg, borderColor, color }}>
                    <span className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0 text-xs font-bold" style={{ borderColor }}>
                      {OPTION_ALPHA[i]}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {answered && (
          <div className="rounded-xl p-4 text-sm text-gray-700 bg-blue-50 border border-blue-100 mb-3">
            <p className="font-medium text-blue-800 mb-1">해설</p>
            <p>{q.explanation}</p>
          </div>
        )}
        {!answered && (
          <button onClick={() => setShowHint((v) => !v)} className="text-xs text-blue-600 hover:underline mb-3">
            {showHint ? "힌트 숨기기" : "힌트 보기"}
          </button>
        )}
        {showHint && !answered && (
          <div className="rounded-xl p-3 text-sm text-gray-600 bg-yellow-50 border border-yellow-200 mb-3">💡 {q.hint}</div>
        )}
        {(qType === "short_answer" ? selfGraded !== null : answered) && (
          <button onClick={next} className="w-full py-3 rounded-xl text-sm font-semibold bg-blue-600 text-white">
            {idx + 1 >= total ? "결과 보기" : "다음 문제"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── SummaryView ────────────────────────────────────────────────────────────
function SummaryView({ content, onBack }: { content: string; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700">요약</span>
      </div>
      <div className="p-5">
        <div className="rounded-2xl p-4 bg-white border border-gray-200 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

// ── MemoView ───────────────────────────────────────────────────────────────
function MemoView({
  initialId,
  initialTitle,
  initialContent,
  weeks,
  initialWeekId,
  onBack,
  onSave,
}: {
  initialId: string | null;
  initialTitle: string;
  initialContent: string;
  weeks: Week[];
  initialWeekId: number | null;
  onBack: () => void;
  onSave: (id: string | null, title: string, content: string, weekId: number | null) => Promise<string>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(initialWeekId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(initialId, title, content, selectedWeekId);
      onBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          스튜디오
        </button>
        <div className="flex items-center gap-2">
          <select
            value={selectedWeekId === null ? "" : String(selectedWeekId)}
            onChange={(e) => setSelectedWeekId(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600 outline-none"
          >
            <option value="">주차 없음</option>
            {weeks.map((week, idx) => (
              <option key={week.id} value={week.id}>
                {week.title || `Week ${idx + 1}`}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5"
            style={{
              background: saved ? "#e6f4ea" : "#1a73e8",
              color: saved ? "#137333" : "white",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (
              <Spinner className="w-3 h-3" />
            ) : saved ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                저장됨
              </>
            ) : "저장"}
          </button>
        </div>
      </div>

      {/* 제목 */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        className="w-full px-5 pt-5 pb-2 text-xl font-bold text-gray-900 outline-none placeholder-gray-300 bg-white"
      />

      {/* 본문 */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="내용을 입력하세요..."
        className="flex-1 w-full px-5 py-2 text-sm text-gray-800 leading-relaxed outline-none resize-none bg-white placeholder-gray-300"
      />

      {/* 하단 정보 */}
      <div className="px-5 py-2 border-t border-gray-100 shrink-0">
        <p className="text-[11px] text-gray-400">{content.length}자</p>
      </div>
    </div>
  );
}

// ── MindmapModal ───────────────────────────────────────────────────────────
function MindmapModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: MindmapConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<MindmapConfig>({ language: "ko", focus: "" });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const langLabel = cfg.language === "ko" ? "한국어" : cfg.language === "en" ? "English" : cfg.language === "ja" ? "日本語" : "中文";

  function handleNext() {
    if (weeks.length === 0) onGenerate(cfg, null);
    else setStep(2);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white flex flex-col max-h-[90vh]">
        <TwoStepHeader step={step} title={step === 1 ? "마인드맵 만들기" : "주차 선택"}
          subtitle={step === 1 ? "마인드맵 옵션을 설정하세요" : `마인드맵 · ${langLabel} · 추가할 주차를 선택하세요`}
          onClose={onClose} step1Label="설정" step2Label="주차 선택" />
        {step === 1 ? (
          <>
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
                <select value={cfg.language}
                  onChange={(e) => setCfg((p) => ({ ...p, language: e.target.value as MindmapConfig["language"] }))}
                  className="w-full text-sm rounded-xl px-4 py-2.5 border border-gray-200 outline-none focus:border-purple-400 text-gray-800 bg-white">
                  <option value="ko">한국어</option><option value="en">English</option>
                  <option value="ja">日本語</option><option value="zh">中文</option>
                </select>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">집중할 주제 (선택)</p>
                <textarea value={cfg.focus} onChange={(e) => setCfg((p) => ({ ...p, focus: e.target.value }))}
                  placeholder={"예시:\n• 2장의 핵심 개념만 포함해줘\n• 실생활 응용 사례 위주로 정리해줘"} rows={3}
                  className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-purple-400 text-gray-800" style={{ lineHeight: 1.6 }} />
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={handleNext} disabled={loading}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all bg-purple-600 text-white"
                style={{ opacity: loading ? 0.75 : 1 }}>
                {loading && <Spinner className="w-3.5 h-3.5" />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep weeks={weeks} selectedWeekId={selectedWeekId} onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)} onClose={onClose} loading={loading}
            chips={["마인드맵", langLabel, ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]} />
        )}
      </div>
    </div>
  );
}

// ── SlideModal ─────────────────────────────────────────────────────────────
function SlideModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: SlideConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<SlideConfig>({
    format: "presenter",
    length: "default",
    language: "ko",
    prompt: "",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const formatLabel = cfg.format === "presenter" ? "발표자 슬라이드" : "자세한 자료";

  function handleNext() {
    if (weeks.length === 0) onGenerate(cfg, null);
    else setStep(2);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <TwoStepHeader step={step} title={step === 1 ? "슬라이드 자료 만들기" : "주차 선택"}
          subtitle={step === 1 ? "슬라이드 옵션을 설정하세요" : `슬라이드 · ${formatLabel} · 추가할 주차를 선택하세요`}
          onClose={onClose} step1Label="설정" step2Label="주차 선택" />
        {step === 1 ? (
          <>
            <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto flex-1">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">형식</p>
                <div className="flex gap-2">
                  {(["presenter", "detailed"] as const).map((f) => (
                    <button key={f} onClick={() => setCfg((p) => ({ ...p, format: f }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.format === f ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {f === "presenter" ? "발표자 슬라이드" : "자세한 자료"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {cfg.format === "presenter" ? "핵심 키워드 위주의 깔끔한 발표용 슬라이드" : "전체 텍스트와 세부정보가 담긴 자료형 슬라이드"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">길이</p>
                <div className="flex gap-2">
                  {(["short", "default", "long"] as const).map((l) => (
                    <button key={l} onClick={() => setCfg((p) => ({ ...p, length: l }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.length === l ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {l === "short" ? "짧게" : l === "default" ? "기본" : "길게"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
                <div className="flex gap-2">
                  {(["ko", "en", "ja", "zh"] as const).map((lang) => (
                    <button key={lang} onClick={() => setCfg((p) => ({ ...p, language: lang }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.language === lang ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {lang === "ko" ? "한국어" : lang === "en" ? "English" : lang === "ja" ? "日本語" : "中文"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">추가 지시사항 (선택)</p>
                <textarea value={cfg.prompt} onChange={(e) => setCfg((p) => ({ ...p, prompt: e.target.value }))}
                  placeholder={"예:\n• 초보자를 위한 단계별 안내식으로 만들어줘\n• 논문 발표용으로 학술적인 톤으로"} rows={3}
                  className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-amber-400 text-gray-800" style={{ lineHeight: 1.6 }} />
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={handleNext} disabled={loading}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all"
                style={{ background: "#d97706", color: "white", opacity: loading ? 0.75 : 1 }}>
                {loading && <Spinner />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep weeks={weeks} selectedWeekId={selectedWeekId} onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)} onClose={onClose} loading={loading}
            chips={["슬라이드", formatLabel, ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]} />
        )}
      </div>
    </div>
  );
}

// ── SlideView ──────────────────────────────────────────────────────────────
function SlideView({
  slides,
  title,
  coverImageB64,
  onBack,
}: {
  slides: Slide[];
  title: string;
  coverImageB64?: string;
  onBack: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const total = slides.length;
  const slide = slides[idx] || { title: "", bullets: [], layout: "content" };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  // 슬라이드별 배경색
  const SLIDE_THEMES = [
    { bg: "#0f172a", accent: "#60a5fa", sub: "#94a3b8" },  // 딥 네이비
    { bg: "#1e1b4b", accent: "#a78bfa", sub: "#c4b5fd" },  // 인디고
    { bg: "#0c4a6e", accent: "#38bdf8", sub: "#7dd3fc" },  // 딥 블루
    { bg: "#14532d", accent: "#4ade80", sub: "#86efac" },  // 딥 그린
    { bg: "#1c1917", accent: "#fb923c", sub: "#fdba74" },  // 딥 브라운
    { bg: "#1e1e2e", accent: "#c084fc", sub: "#e9d5ff" },  // 다크 퍼플
  ];
  const theme = idx === 0 ? SLIDE_THEMES[0] : SLIDE_THEMES[idx % SLIDE_THEMES.length];

  return (
    <div className="flex flex-col h-full bg-[#f1f3f4]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-sm font-medium text-gray-700 truncate max-w-[160px]">{title}</span>
        <button
          onClick={() => setShowNotes((v) => !v)}
          className="text-xs px-2.5 py-1 rounded-full border transition-colors"
          style={showNotes ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { color: "#6b7280", borderColor: "#e5e7eb" }}
        >
          발표자 노트
        </button>
      </div>

      {/* Slide area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 gap-4 overflow-hidden">
        {/* Card */}
        <div
          className="w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden"
          style={{ background: theme.bg, aspectRatio: "16/9", maxHeight: "60vh", position: "relative" }}
        >
          {slide.layout === "title" ? (
            // ── 표지 슬라이드 ──
            <div className="absolute inset-0 flex">
              {/* 왼쪽: 텍스트 */}
              <div className="flex flex-col justify-center px-8 py-6 z-10" style={{ width: coverImageB64 ? "55%" : "100%", textAlign: coverImageB64 ? "left" : "center", alignItems: coverImageB64 ? "flex-start" : "center" }}>
                <div className="mb-3 flex gap-2 flex-wrap">
                  {[title.split(" ")[0], "AI", "학습"].map((tag, i) => (
                    <span key={i} className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${theme.accent}22`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>
                      #{tag}
                    </span>
                  ))}
                </div>
                <p className="text-white text-2xl font-bold leading-tight mb-2">{slide.title}</p>
                {slide.subtitle && (
                  <p className="text-sm leading-relaxed" style={{ color: theme.sub }}>{slide.subtitle}</p>
                )}
                <div className="mt-4 h-0.5 w-12 rounded" style={{ background: theme.accent }} />
              </div>
              {/* 오른쪽: AI 생성 이미지 */}
              {coverImageB64 && (
                <div className="absolute right-0 top-0 bottom-0" style={{ width: "48%" }}>
                  {/* 그라데이션 페이드 */}
                  <div className="absolute inset-y-0 left-0 w-16 z-10" style={{ background: `linear-gradient(to right, ${theme.bg}, transparent)` }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${coverImageB64}`}
                    alt="표지 일러스트"
                    className="w-full h-full object-cover opacity-90"
                  />
                </div>
              )}
            </div>
          ) : slide.layout === "summary" ? (
            // ── 정리 슬라이드 ──
            <div className="absolute inset-0 flex flex-col px-8 py-6">
              {/* 상단 강조 바 */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-6 rounded-full" style={{ background: theme.accent }} />
                <p className="text-lg font-bold" style={{ color: theme.accent }}>{slide.title}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 flex-1">
                {slide.bullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white" style={{ background: theme.accent }}>
                      {i + 1}
                    </span>
                    <span className="text-sm text-white/90">{b}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : slide.layout === "two_column" ? (
            // ── 두 컬럼 슬라이드 ──
            <div className="absolute inset-0 flex flex-col px-8 py-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-5 rounded-full" style={{ background: theme.accent }} />
                <p className="text-base font-bold" style={{ color: theme.accent }}>{slide.title}</p>
              </div>
              <div className="flex gap-4 flex-1">
                <div className="flex-1 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <ul className="flex flex-col gap-2">
                    {slide.bullets.slice(0, Math.ceil(slide.bullets.length / 2)).map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-white/85 text-xs">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />{b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex-1 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <ul className="flex flex-col gap-2">
                    {slide.bullets.slice(Math.ceil(slide.bullets.length / 2)).map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-white/85 text-xs">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />{b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            // ── 일반 content 슬라이드 ──
            <div className="absolute inset-0 flex flex-col px-8 py-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-5 rounded-full" style={{ background: theme.accent }} />
                <p className="text-base font-bold" style={{ color: theme.accent }}>{slide.title}</p>
              </div>
              <ul className="flex flex-col gap-2.5">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-3 text-white/85 text-sm">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />{b}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* 슬라이드 번호 */}
          <div className="absolute bottom-3 right-4 z-20">
            <span className="text-white/30 text-[10px]">{idx + 1} / {total}</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIdx((i) => Math.max(i - 1, 0))}
            disabled={idx === 0}
            className="w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors"
            style={idx === 0 ? { borderColor: "#e0e0e0", color: "#ccc", cursor: "not-allowed" } : { borderColor: "#fdd89a", color: "#d97706", background: "white" }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {/* Dot indicators */}
          <div className="flex gap-1.5 max-w-[200px] overflow-hidden">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className="rounded-full transition-all"
                style={{ width: i === idx ? "20px" : "6px", height: "6px", background: i === idx ? "#d97706" : "#d1d5db", flexShrink: 0 }}
              />
            ))}
          </div>
          <button
            onClick={() => setIdx((i) => Math.min(i + 1, total - 1))}
            disabled={idx === total - 1}
            className="w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors"
            style={idx === total - 1 ? { borderColor: "#e0e0e0", color: "#ccc", cursor: "not-allowed" } : { borderColor: "#fdd89a", color: "#d97706", background: "white" }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        {/* Speaker notes */}
        {showNotes && slide.speaker_notes && (
          <div className="w-full max-w-3xl bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">발표자 노트</p>
            <p className="text-sm text-gray-700 leading-relaxed">{slide.speaker_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FlashcardModal ─────────────────────────────────────────────────────────
function FlashcardModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: FlashcardConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<FlashcardConfig>({
    count: "standard",
    difficulty: "intermediate",
    topic: "",
    language: "ko",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const diffLabel = cfg.difficulty === "easy" ? "쉬움" : cfg.difficulty === "intermediate" ? "보통" : "어려움";

  function handleNext() {
    if (weeks.length === 0) onGenerate(cfg, null);
    else setStep(2);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <TwoStepHeader step={step} title={step === 1 ? "플래시카드 맞춤설정" : "주차 선택"}
          subtitle={step === 1 ? "플래시카드 옵션을 설정하세요" : `플래시카드 · ${diffLabel} · 추가할 주차를 선택하세요`}
          onClose={onClose} step1Label="설정" step2Label="주차 선택" />
        {step === 1 ? (
          <>
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2.5">카드 수</p>
                <div className="flex gap-2">
                  {(["fewer", "standard", "more"] as const).map((c) => (
                    <button key={c} onClick={() => setCfg((p) => ({ ...p, count: c }))}
                      className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                      style={cfg.count === c ? { background: "#fde0ea", color: "#be123c", borderColor: "#f9a8c0" } : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }}>
                      {c === "fewer" ? "간략히 보기" : c === "standard" ? "표준(기본)" : "더보기"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2.5">난이도</p>
                <div className="flex gap-2">
                  {(["easy", "intermediate", "hard"] as const).map((d) => (
                    <button key={d} onClick={() => setCfg((p) => ({ ...p, difficulty: d }))}
                      className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                      style={cfg.difficulty === d ? { background: "#fde0ea", color: "#be123c", borderColor: "#f9a8c0" } : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }}>
                      {d === "easy" ? "쉬움" : d === "intermediate" ? "보통(기본)" : "어려움"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">주제는 무엇인가요?</p>
                <textarea value={cfg.topic} onChange={(e) => setCfg((p) => ({ ...p, topic: e.target.value }))}
                  placeholder={"다음과 같이 시도해 보세요.\n  • 플래시카드는 특정 소스로 제한해 줘 (예: '이탈리아에 대한 기사만')\n  • 플래시카드는 특정 주제 위주로 해 줘 (예: '뉴턴의 제2법칙')\n  • 기억하기 쉽도록 카드 앞면은 짧게 작성해 줘"}
                  rows={4} className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-pink-300 text-gray-800"
                  style={{ lineHeight: 1.6 }} />
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={handleNext} disabled={loading}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all"
                style={{ background: "#be123c", color: "white", opacity: loading ? 0.75 : 1 }}>
                {loading && <Spinner className="w-3.5 h-3.5" />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep weeks={weeks} selectedWeekId={selectedWeekId} onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)} onClose={onClose} loading={loading}
            chips={["플래시카드", diffLabel, ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]} />
        )}
      </div>
    </div>
  );
}

// ── FlashcardView ──────────────────────────────────────────────────────────
function FlashcardView({
  cards,
  title,
  onBack,
}: {
  cards: FlashCard[];
  title: string;
  onBack: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [known, setKnown] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);

  const total = cards.length;
  const card = cards[idx];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setFlipped((v) => !v);
        setShowHint(false);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFlipped(false);
        setShowHint(false);
        setIdx((i) => (i + 1 < total ? i + 1 : i));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFlipped(false);
        setShowHint(false);
        setIdx((i) => (i > 0 ? i - 1 : i));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  function handleKnow(isKnown: boolean) {
    setKnown((prev) => { const n = [...prev]; n[idx] = isKnown; return n; });
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx((i) => i + 1);
    setFlipped(false);
    setShowHint(false);
  }

  function restart() {
    setIdx(0);
    setFlipped(false);
    setShowHint(false);
    setKnown([]);
    setDone(false);
  }

  if (done) {
    const knownCount = known.filter(Boolean).length;
    const pct = Math.round((knownCount / total) * 100);
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-pink-600 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            스튜디오
          </button>
          <span className="text-gray-300">›</span>
          <span className="text-sm font-medium text-gray-700">{title}</span>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 text-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
            style={{ background: pct >= 70 ? "#fde0ea" : "#fce8e6", color: pct >= 70 ? "#be123c" : "#c5221f" }}>
            {pct}%
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 mb-1">
              {pct >= 80 ? "완벽해요! 🎉" : pct >= 60 ? "잘하셨어요!" : "다시 한번 복습해봐요"}
            </p>
            <p className="text-sm text-gray-500">{total}장 중 {knownCount}장 알고 있음</p>
          </div>
          <div className="flex gap-3">
            <button onClick={restart}
              className="px-6 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ background: "#be123c" }}>다시 학습하기</button>
            <button onClick={onBack} className="px-6 py-2.5 rounded-full text-sm font-semibold border border-gray-200 text-gray-500">스튜디오로</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-pink-600 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
      </div>

      {/* Progress */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>{idx + 1} / {total}</span>
          <span className="text-pink-500">{known.filter(Boolean).length}개 알고 있음</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-gray-200">
          <div className="h-1.5 rounded-full transition-all" style={{ width: `${((idx) / total) * 100}%`, background: "#be123c" }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5 text-center">
          {'스페이스바'}를 눌러 뒤집기, {'←/→'} 키를 눌러 이동
        </p>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-2 gap-4">
        {/* Flip card */}
        <div
          className="w-full max-w-3xl cursor-pointer select-none"
          style={{ perspective: "1200px" }}
          onClick={() => { setFlipped((v) => !v); setShowHint(false); }}
        >
          <div
            className="relative transition-transform duration-500"
            style={{
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              minHeight: "320px",
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center p-10 text-center shadow-md border border-gray-100"
              style={{ backfaceVisibility: "hidden", background: "#1e1e2e", minHeight: "320px" }}
            >
              <p className="text-white text-2xl font-semibold leading-relaxed">{card.front}</p>
              {!flipped && (
                <p className="text-gray-400 text-sm mt-5">정답 보기</p>
              )}
            </div>
            {/* Back */}
            <div
              className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center p-10 text-center shadow-md border border-pink-100"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "white", minHeight: "320px" }}
            >
              <p className="text-gray-800 text-xl font-medium leading-relaxed">{card.back}</p>
              {card.hint && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowHint((v) => !v); }}
                  className="mt-4 text-sm text-pink-500 hover:underline flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                  설명
                </button>
              )}
              {showHint && card.hint && (
                <p className="mt-2 text-sm text-gray-500 bg-pink-50 rounded-lg px-4 py-2.5">{card.hint}</p>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        {flipped ? (
          <div className="flex items-center gap-3 w-full max-w-3xl">
            <button
              onClick={() => handleKnow(false)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
              모르겠어요
            </button>
            <button
              onClick={() => handleKnow(true)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold border-2 border-green-200 text-green-600 hover:bg-green-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              알고 있어요
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4 w-full max-w-3xl justify-center">
            {/* 이전 버튼 */}
            <button
              onClick={() => { if (idx > 0) { setIdx((i) => i - 1); setFlipped(false); setShowHint(false); } }}
              disabled={idx === 0}
              className="w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors"
              style={idx === 0 ? { borderColor: "#e0e0e0", color: "#ccc", cursor: "not-allowed" } : { borderColor: "#f9a8c0", color: "#be123c", background: "white" }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="text-sm text-gray-400">카드를 클릭하면 뒷면을 볼 수 있어요</p>
            {/* 다음 버튼 */}
            <button
              onClick={() => { if (idx < total - 1) { setIdx((i) => i + 1); setFlipped(false); setShowHint(false); } else { setDone(true); } }}
              className="w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors"
              style={{ borderColor: "#f9a8c0", color: "#be123c", background: "white" }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ReportModal ────────────────────────────────────────────────────────────
function ReportModal({
  loading,
  onClose,
  onGenerate,
  weeks = [],
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: ReportConfig, weekId: number | null) => void;
  weeks?: Week[];
}) {
  const [cfg, setCfg] = useState<ReportConfig>({
    format: "briefing",
    language: "ko",
    length: "default",
    tone: "formal",
    instructions: "",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  const formats: { id: ReportConfig["format"]; label: string; desc: string; recommended?: boolean }[] = [
    { id: "custom", label: "직접 만들기", desc: "구조, 스타일, 어조 등을 지정하여 원하는 방식으로 보고서를 작성하세요." },
    { id: "briefing", label: "브리핑 문서", desc: "주요 인사이트와 인용문을 포함한 소스 개요" },
    { id: "study_guide", label: "학습 가이드", desc: "단답형 퀴즈, 추천 에세이 질문, 핵심 용어집", recommended: true },
    { id: "blog", label: "블로그 게시물", desc: "읽기 쉬운 기사 형식으로 요약된 유용한 정보", recommended: true },
    { id: "prd", label: "제품 요구사항 정의서", desc: "핵심 기능 요구사항과 기술적 제약을 상세히 정의", recommended: true },
    { id: "architecture", label: "시스템 아키텍처 설계서", desc: "데이터 흐름과 시스템 구조를 설계하는 문서", recommended: true },
    { id: "tech_explainer", label: "기술 개념 설명서", desc: "핵심 기술 원리를 쉽게 설명합니다.", recommended: true },
    { id: "learning_guide", label: "학습 활용 가이드", desc: "자기주도 학습 효율을 높이는 방법을 안내합니다.", recommended: true },
  ];

  const recommendedFormats = formats.filter((f) => f.recommended);
  const isCustom = cfg.format === "custom";

  const formatLabelMap: Record<string, string> = {
    briefing: "브리핑 문서", study_guide: "학습 가이드", blog: "블로그 게시물",
    prd: "제품 요구사항 정의서", architecture: "시스템 아키텍처 설계서",
    tech_explainer: "기술 개념 설명서", learning_guide: "학습 활용 가이드", custom: "보고서",
  };

  function handleNext() {
    if (weeks.length === 0) onGenerate(cfg, null);
    else setStep(2);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <TwoStepHeader step={step} title={step === 1 ? "보고서 생성" : "주차 선택"}
          subtitle={step === 1 ? "보고서 옵션을 설정하세요" : `${formatLabelMap[cfg.format]} · 추가할 주차를 선택하세요`}
          onClose={onClose} step1Label="설정" step2Label="주차 선택" />
        {step === 1 ? (
          <>
            <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">형식</p>
                <button onClick={() => setCfg((p) => ({ ...p, format: "custom" }))}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left mb-3 transition-all"
                  style={cfg.format === "custom" ? { background: "#f0fdf4", borderColor: "#166534" } : { background: "white", borderColor: "#e5e7eb" }}>
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={cfg.format === "custom" ? "#166534" : "#9ca3af"} strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: cfg.format === "custom" ? "#166534" : "#374151" }}>직접 만들기</p>
                    <p className="text-xs text-gray-400 mt-0.5">구조, 스타일, 어조 등을 지정하여 원하는 방식으로 보고서를 작성하세요.</p>
                  </div>
                </button>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">추천 형식</p>
                <div className="grid grid-cols-2 gap-2">
                  {recommendedFormats.map((f) => (
                    <button key={f.id} onClick={() => setCfg((p) => ({ ...p, format: f.id }))}
                      className="flex flex-col items-start px-3 py-2.5 rounded-xl border-2 text-left transition-all"
                      style={cfg.format === f.id ? { background: "#f0fdf4", borderColor: "#166534" } : { background: "white", borderColor: "#e5e7eb" }}>
                      <span className="text-sm font-medium leading-tight" style={{ color: cfg.format === f.id ? "#166534" : "#374151" }}>{f.label}</span>
                      <span className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">{f.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {isCustom ? "원하는 형식을 직접 설명해주세요" : "추가 지시사항 (선택)"}
                </p>
                <textarea value={cfg.instructions} onChange={(e) => setCfg((p) => ({ ...p, instructions: e.target.value }))}
                  placeholder={isCustom ? "예시:\n• 서론, 본론 3개 섹션, 결론 구조로 만들어줘\n• SWOT 분석 형식으로 작성해줘" : "예시:\n• 2장의 핵심 내용에 집중해줘\n• 예시와 비유를 많이 포함해줘"}
                  rows={isCustom ? 4 : 3} className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 text-gray-800 transition-colors"
                  style={{ lineHeight: 1.6, borderColor: "#86efac" }} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">길이</p>
                <div className="flex gap-2">
                  {(["short", "default", "long"] as const).map((l) => (
                    <button key={l} onClick={() => setCfg((p) => ({ ...p, length: l }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.length === l ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {l === "short" ? "간결하게" : l === "default" ? "기본값" : "상세하게"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
                <div className="flex gap-2">
                  {(["ko", "en", "ja", "zh"] as const).map((lang) => (
                    <button key={lang} onClick={() => setCfg((p) => ({ ...p, language: lang }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.language === lang ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {lang === "ko" ? "한국어" : lang === "en" ? "English" : lang === "ja" ? "日本語" : "中文"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">문체</p>
                <div className="flex gap-2">
                  {(["formal", "casual", "academic"] as const).map((t) => (
                    <button key={t} onClick={() => setCfg((p) => ({ ...p, tone: t }))}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                      style={cfg.tone === t ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}>
                      {t === "formal" ? "격식체" : t === "casual" ? "구어체" : "학술체"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={handleNext} disabled={loading || (isCustom && !cfg.instructions.trim())}
                className="px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all text-white"
                style={{ background: "#166534", opacity: (loading || (isCustom && !cfg.instructions.trim())) ? 0.6 : 1 }}>
                {loading && <Spinner className="w-3.5 h-3.5" />}
                {loading ? "생성 중..." : weeks.length > 0 ? "다음" : "만들기"}
              </button>
            </div>
          </>
        ) : (
          <WeekPickerStep weeks={weeks} selectedWeekId={selectedWeekId} onSelect={setSelectedWeekId}
            onConfirm={() => onGenerate(cfg, selectedWeekId)} onClose={onClose} loading={loading}
            chips={[formatLabelMap[cfg.format], ...(selectedWeekId !== null ? [`W${selectedWeekId}`] : [])]} />
        )}
      </div>
    </div>
  );
}

// ── ReportView ─────────────────────────────────────────────────────────────
const FORMAT_LABEL: Record<string, string> = {
  briefing: "브리핑 문서",
  study_guide: "학습 가이드",
  blog: "블로그 게시물",
  prd: "제품 요구사항 정의서",
  architecture: "시스템 아키텍처 설계서",
  tech_explainer: "기술 개념 설명서",
  learning_guide: "학습 활용 가이드",
  custom: "보고서",
};

function ReportView({
  sections,
  title,
  format,
  onBack,
}: {
  sections: ReportSection[];
  title: string;
  format: string;
  onBack: () => void;
}) {
  function renderContent(text: string) {
    return text.split("\n").map((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
        return (
          <li key={i} className="flex items-start gap-2 text-gray-700">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-green-600" />
            <span>{trimmed.slice(2)}</span>
          </li>
        );
      }
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        return <p key={i} className="font-semibold text-gray-800">{trimmed.slice(2, -2)}</p>;
      }
      if (!trimmed) return <div key={i} className="h-1" />;
      return <p key={i} className="text-gray-700 leading-relaxed">{trimmed}</p>;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-green-700 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* 보고서 헤더 카드 */}
        <div className="rounded-2xl p-4 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#a3e8c4" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#166534" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-800 leading-snug">{title}</p>
              <span className="mt-1 inline-block text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "#dcfce7", color: "#166534" }}>
                {FORMAT_LABEL[format] || "보고서"}
              </span>
            </div>
          </div>
        </div>

        {/* 섹션들 */}
        {sections.map((section, i) => (
          <div key={i} className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2" style={{ background: "#f0fdf4" }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: "#166534" }}>
                {i + 1}
              </span>
              <p className="text-sm font-semibold text-gray-800">{section.heading}</p>
            </div>
            <div className="p-4 text-sm space-y-1.5">
              <ul className="space-y-1.5">
                {renderContent(section.content)}
              </ul>
            </div>
          </div>
        ))}

        {/* 유용/유용하지 않음 피드백 */}
        <div className="flex items-center justify-center gap-4 py-2">
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
            </svg>
            유용한 보고서
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398C20.613 14.547 19.833 15 19 15h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 00.303-.54m.023-8.25H16.48a4.5 4.5 0 01-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H6.504c-.618 0-1.217.247-1.605.729A11.95 11.95 0 002.25 12c0 .434.023.863.068 1.285C2.427 14.306 3.346 15 4.372 15h3.126c.618 0 .991.724.725 1.282A7.471 7.471 0 007.5 19.5a2.25 2.25 0 002.25 2.25.75.75 0 00.75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 002.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384" />
            </svg>
            유용하지 않은 보고서
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main StudioPanel ───────────────────────────────────────────────────────
export default function StudioPanel({ notebookId, activeDocIds, docs, getToken, weeks = [], onAddWeekTask, onRenameItem, onDeleteItem, openItemId, onOpenItemHandled, openCreateType, openCreateWeekId, onOpenCreateHandled, openMemoRequest, onOpenMemoHandled, forcePortalSubviews = false, onViewItem, onSavedItemsChange, hideCollections = false }: Props) {
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showMindmapModal, setShowMindmapModal] = useState(false);
  const [showFlashcardModal, setShowFlashcardModal] = useState(false);
  const [showSlideModal, setShowSlideModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showUnifiedModal, setShowUnifiedModal] = useState(false);
  const [unifiedModalItem, setUnifiedModalItem] = useState<StudioTaskItem | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [activeAudio, setActiveAudio] = useState<{ base64?: string; audioUrl?: string; script: string; title: string } | null>(null);
  const [activeMindmap, setActiveMindmap] = useState<{ nodes: MindmapNode[]; title: string } | null>(null);
  const [activeFlashcard, setActiveFlashcard] = useState<{ cards: FlashCard[]; title: string } | null>(null);
  const [activeSlides, setActiveSlides] = useState<{ slides: Slide[]; title: string; cover_image_b64?: string } | null>(null);
  const [activeReport, setActiveReport] = useState<{ sections: ReportSection[]; title: string; format: string } | null>(null);
  const [activeDataTable, setActiveDataTable] = useState<{ title: string; description?: string; columns: any[]; rows: any[] } | null>(null);
  const [activeInfographic, setActiveInfographic] = useState<{ title: string; description?: string; sections: any[] } | null>(null);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [activeMemo, setActiveMemo] = useState<{ id: string | null; title: string; content: string } | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [pendingOpenItemId, setPendingOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    onSavedItemsChange?.(savedItems);
  }, [onSavedItemsChange, savedItems]);

  // openItemId: 외부에서 특정 아이템을 전체화면으로 열도록 요청
  useEffect(() => {
    if (!openItemId) return;
    const item = savedItems.find((s) => s.id === openItemId);
    if (!item) {
      // savedItems에 없으면 DB 재로드 후 pendingOpenItemId로 열기
      setPendingOpenItemId(openItemId);
      setRefreshTrigger((n) => n + 1);
      return;
    }
    if (item.type === "quiz" && item.quiz) setActiveQuiz(item.quiz);
    else if (item.type === "audio") setActiveAudio({ base64: item.audio?.base64, audioUrl: item.audioUrl, script: item.audio?.script || "", title: item.title });
    else if (item.type === "mindmap" && item.mindmap) setActiveMindmap({ nodes: item.mindmap.nodes, title: item.title });
    else if (item.type === "memo") setActiveMemo({ id: item.id, title: item.title, content: item.memoContent ?? "" });
    else if (item.type === "flashcard" && item.flashcard) setActiveFlashcard({ cards: item.flashcard.cards, title: item.title });
    else if (item.type === "slides" && item.slides) setActiveSlides({ slides: item.slides.slides, title: item.title, cover_image_b64: item.slides.cover_image_b64 });
    else if (item.type === "report" && item.report) setActiveReport({ sections: item.report.sections, title: item.title, format: item.report.format });
    else if (item.type === "data" && item.dataTable) setActiveDataTable({ title: item.dataTable.title, description: item.dataTable.description, columns: item.dataTable.columns, rows: item.dataTable.rows });
    else if (item.type === "infographic" && item.infographic) setActiveInfographic({ title: item.infographic.title, description: item.infographic.description, sections: item.infographic.sections });
    else if (item.summaryContent) setSummaryContent(item.summaryContent);
    setIsExpanded(true);
    onOpenItemHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItemId]);

  // savedItems 재로드 완료 후 pendingOpenItemId 처리
  useEffect(() => {
    if (!pendingOpenItemId) return;
    const item = savedItems.find((s) => s.id === pendingOpenItemId);
    if (!item) return;
    if (item.type === "quiz" && item.quiz) setActiveQuiz(item.quiz);
    else if (item.type === "audio") setActiveAudio({ base64: item.audio?.base64, audioUrl: item.audioUrl, script: item.audio?.script || "", title: item.title });
    else if (item.type === "mindmap" && item.mindmap) setActiveMindmap({ nodes: item.mindmap.nodes, title: item.title });
    else if (item.type === "flashcard" && item.flashcard) setActiveFlashcard({ cards: item.flashcard.cards, title: item.title });
    else if (item.type === "slides" && item.slides) setActiveSlides({ slides: item.slides.slides, title: item.title, cover_image_b64: item.slides.cover_image_b64 });
    else if (item.type === "report" && item.report) setActiveReport({ sections: item.report.sections, title: item.title, format: item.report.format });
    else if (item.type === "data" && item.dataTable) setActiveDataTable({ title: item.dataTable.title, description: item.dataTable.description, columns: item.dataTable.columns, rows: item.dataTable.rows });
    else if (item.type === "infographic" && item.infographic) setActiveInfographic({ title: item.infographic.title, description: item.infographic.description, sections: item.infographic.sections });
    else if (item.summaryContent) setSummaryContent(item.summaryContent);
    setIsExpanded(true);
    setPendingOpenItemId(null);
    onOpenItemHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedItems, pendingOpenItemId]);

  // openCreateType: 외부에서 특정 타입의 콘텐츠 생성 모달을 열도록 요청
  useEffect(() => {
    if (!openCreateType) return;
    if (openCreateWeekId !== undefined && openCreateWeekId !== null) {
      setWeekGeneratingFor(openCreateWeekId);
    }
    const foundItem = STUDIO_TASK_ITEMS.find((i) => i.id === openCreateType);
    if (foundItem) {
      setUnifiedModalItem(foundItem);
      setShowUnifiedModal(true);
    }
    onOpenCreateHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateType]);

  useEffect(() => {
    if (!openMemoRequest) return;
    setActiveMemo({ id: null, title: "", content: "" });
    onOpenMemoHandled?.();
  }, [onOpenMemoHandled, openMemoRequest]);

  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsedWeeks, setCollapsedWeeks] = useState<number[]>([]);
  const toggleWeekCollapse = (id: number) =>
    setCollapsedWeeks((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const [weekGeneratingFor, setWeekGeneratingFor] = useState<number | null>(null);
  const [showWeekTypePickerForId, setShowWeekTypePickerForId] = useState<number | null>(null);

  function getEffectiveDocIds(): string[] {
    if (weekGeneratingFor !== null) {
      const week = weeks.find((w) => w.id === weekGeneratingFor);
      if (week) return week.sources.filter((s) => s.docId).map((s) => s.docId!);
    }
    return activeDocIds;
  }

  function buildWeekTask(type: string, title: string, subtitle: string, weekId?: number, itemId?: string): WeekTask {
    const icons: Record<string, { icon: string; iconBg: string }> = {
      audio: { icon: "🎧", iconBg: "#d0f5f1" },
      slides: { icon: "📊", iconBg: "#fef0da" },
      mindmap: { icon: "🗺️", iconBg: "#f0e6ff" },
      quiz: { icon: "❓", iconBg: "#dbeafe" },
      flashcard: { icon: "🃏", iconBg: "#fde0ea" },
      report: { icon: "📝", iconBg: "#dcf2e8" },
      memo: { icon: "📝", iconBg: "#e8f0fe" },
    };
    const { icon, iconBg } = icons[type] || { icon: "📄", iconBg: "#f1f3f4" };
    const resolvedWeekId = weekId !== undefined ? weekId : weekGeneratingFor!;
    const week = weeks.find((w) => w.id === resolvedWeekId);
    const maxId = week && week.tasks.length > 0 ? Math.max(...week.tasks.map((t) => t.id)) : 0;
    return { id: maxId + 1, icon, iconBg, title, subtitle, itemId, studioType: type };
  }

  const hasDoc = activeDocIds.length > 0;

  // DB에서 저장된 아이템 불러오기
  useEffect(() => {
    async function loadItems() {
      try {
        const token = await getToken();
        const res = await fetch(`${API}/api/studio?notebook_id=${notebookId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const loaded: SavedItem[] = rows.map((item: {
          id: string; type: string; title: string; subtitle: string;
          created_at: string; content: Record<string, unknown>; audio_url?: string;
        }) => ({
          id: item.id,
          type: item.type as SavedItem["type"],
          title: item.title,
          subtitle: item.subtitle || "",
          createdAt: new Date(item.created_at),
          summaryContent: item.type === "summary" ? (item.content?.text as string) : undefined,
          quiz: item.type === "quiz" ? {
            id: item.id,
            title: item.title,
            questions: ((item.content?.questions as unknown[]) || []).map((q: unknown) => {
              const qq = q as { question: string; options: string[]; answerIndex?: number; answer?: number; hint: string; explanation: string };
              return { question: qq.question, options: qq.options, answer: qq.answerIndex ?? qq.answer ?? 0, hint: qq.hint || "", explanation: qq.explanation || "" };
            }),
            createdAt: new Date(item.created_at),
            difficulty: (item.content?.difficulty as string) || "intermediate",
          } : undefined,
          audio: item.type === "audio" ? { script: (item.content?.script as string) || "" } : undefined,
          audioUrl: item.audio_url,
          mindmap: item.type === "mindmap" ? { nodes: (item.content?.nodes as MindmapNode[]) || [] } : undefined,
          memoContent: item.type === "memo" ? (item.content?.text as string) || "" : undefined,
          flashcard: item.type === "flashcard" ? {
            cards: (item.content?.cards as FlashCard[]) || [],
            difficulty: (item.content?.difficulty as string) || "intermediate",
          } : undefined,
          slides: item.type === "slides" ? {
            slides: (item.content?.slides as Slide[]) || [],
            format: (item.content?.format as string) || "presenter",
            cover_image_b64: (item.content?.cover_image_b64 as string) || "",
          } : undefined,
          report: item.type === "report" ? {
            sections: (item.content?.sections as ReportSection[]) || [],
            format: (item.content?.format as string) || "briefing",
          } : undefined,
          dataTable: item.type === "data" ? {
            title: (item.content?.title as string) || item.title,
            description: (item.content?.description as string) || "",
            columns: (item.content?.columns as any[]) || (item.content?.headers as any[]) || [],
            rows: (item.content?.rows as any[]) || (item.content?.data as any[]) || [],
          } : undefined,
          infographic: item.type === "infographic" ? {
            title: (item.content?.title as string) || item.title,
            description: (item.content?.description as string) || "",
            sections: (item.content?.sections as any[]) || [],
          } : undefined,
          content: item.content,
        }));
        setSavedItems(loaded);
      } catch { /* 로드 실패 시 빈 목록 유지 */ }
    }
    loadItems();
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeleteItem(itemId: string) {
    setSavedItems((prev) => prev.filter((i) => i.id !== itemId));
    setOpenMenuId(null);
    onDeleteItem?.(itemId);
    try {
      const token = await getToken();
      await fetch(`${API}/api/studio/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* 삭제 실패 무시 */ }
  }

  async function handleSaveMemo(id: string | null, title: string, content: string, weekId: number | null): Promise<string> {
    const token = await getToken();
    const resolvedTitle = title || "제목 없음";
    const resolvedSubtitle = "메모";

    if (id) {
      // 기존 메모 수정
      await fetch(`${API}/api/studio/memo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, content }),
      });
      setSavedItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, title: resolvedTitle, memoContent: content } : item
        )
      );
      onRenameItem?.(id, resolvedTitle);
      onDeleteItem?.(id);
      if (weekId !== null) {
        onAddWeekTask?.(weekId, buildWeekTask("memo", resolvedTitle, resolvedSubtitle, weekId, id));
      }
      return id;
    } else {
      // 새 메모 생성
      const res = await fetch(`${API}/api/studio/memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, content, notebook_id: notebookId }),
      });
      const data = await res.json();
      const newId = data.item_id;
      const newItem: SavedItem = {
        id: newId,
        type: "memo",
        title: resolvedTitle,
        subtitle: resolvedSubtitle,
        createdAt: new Date(),
        memoContent: content,
      };
      setSavedItems((prev) => [newItem, ...prev]);
      if (weekId !== null) {
        onAddWeekTask?.(weekId, buildWeekTask("memo", resolvedTitle, resolvedSubtitle, weekId, newId));
      }
      // 새로 생성된 id로 activeMemo 업데이트 (이후 수정 시 PATCH 사용)
      setActiveMemo((prev) => prev ? { ...prev, id: newId } : null);
      return newId;
    }
  }

  function startRename(item: SavedItem) {
    setOpenMenuId(null);
    setRenamingItemId(item.id);
    setRenameValue(item.title);
  }

  async function commitRename(itemId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingItemId(null); return; }
    setSavedItems((prev) => prev.map((i) => i.id === itemId ? { ...i, title: trimmed } : i));
    setRenamingItemId(null);
    // InstructorWorkspace weeks 동기화
    onRenameItem?.(itemId, trimmed);
    try {
      const token = await getToken();
      await fetch(`${API}/api/studio/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: trimmed }),
      });
    } catch { /* 실패 시 낙관적 업데이트 유지 */ }
  }

  async function handleSummary() {
    if (!hasDoc) return;
    setLoadingType("report");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doc_ids: activeDocIds, type: "summary", notebook_id: notebookId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const docNames = docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ");
      const newItem: SavedItem = {
        id: Date.now().toString(),
        type: "summary",
        title: docNames || "요약",
        subtitle: `요약 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        summaryContent: data.result,
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setSummaryContent(data.result);
    } catch (e: unknown) {
      alert(`요약 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleQuizGenerate(cfg: QuizConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("quiz");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          type: "quiz",
          quiz_count: COUNT_MAP[cfg.count],
          difficulty: cfg.difficulty,
          topic: cfg.topic,
          quiz_style: cfg.quizStyle,
          item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "퀴즈",
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");

      // data.result는 백엔드에서 파싱된 객체: { title, questions: [{id, type, question, options, answerIndex, answerText, hint, explanation}] }
      const quizData = data.result as {
        title: string;
        questions: {
          id: number;
          type?: string;
          question: string;
          options: string[];
          answerIndex: number;
          answerText?: string;
          hint: string;
          explanation: string;
        }[];
      };

      const questions: QuizQuestion[] = quizData.questions.map((q) => ({
        question: q.question,
        type: (q.type as QuizQuestion["type"]) ?? "multiple_choice",
        options: q.options ?? [],
        answer: q.answerIndex ?? -1,
        answerText: q.answerText,
        hint: q.hint,
        explanation: q.explanation,
      }));

      const quiz: SavedQuiz = {
        id: data.item_id || Date.now().toString(),
        title: quizData.title || "퀴즈",
        questions,
        createdAt: new Date(),
        difficulty: cfg.difficulty,
      };
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "quiz",
        title: quizData.title || "퀴즈",
        subtitle: `퀴즈 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        quiz,
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const saveWeekIdQ = weekGeneratingFor ?? saveToWeekId;
      if (saveWeekIdQ !== null) {
        onAddWeekTask?.(saveWeekIdQ, buildWeekTask("quiz", quizData.title || "퀴즈", `퀴즈 · 소스 ${docIds.length}개`, saveWeekIdQ, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveQuiz(quiz);
      }
      setShowQuizModal(false);
    } catch (e: unknown) {
      alert(`퀴즈 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleAudioGenerate(cfg: AudioConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("audio");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          format: cfg.format,
          language: cfg.language,
          length: cfg.length,
          focus: cfg.focus,
          item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "오디오 오버뷰",
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const docNames = docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ");
      const audioTitle = data.title || docNames || "오디오 오버뷰";
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "audio",
        title: audioTitle,
        subtitle: `오디오 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        audio: { base64: data.audio_base64, script: data.script },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
      if (resolvedWeekId !== null) {
        onAddWeekTask?.(resolvedWeekId, buildWeekTask("audio", audioTitle, `오디오 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveAudio({ base64: data.audio_base64, script: data.script, title: audioTitle });
      }
      setShowAudioModal(false);
    } catch (e: unknown) {
      alert(`오디오 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleMindmapGenerate(cfg: MindmapConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("mindmap");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/mindmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          language: cfg.language,
          focus: cfg.focus,
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");

      const mindmapTitle = data.title || "마인드맵";
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "mindmap",
        title: mindmapTitle,
        subtitle: `마인드맵 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        mindmap: { nodes: data.nodes || [] },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
      if (resolvedWeekId !== null) {
        onAddWeekTask?.(resolvedWeekId, buildWeekTask("mindmap", mindmapTitle, `마인드맵 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveMindmap({ nodes: data.nodes || [], title: mindmapTitle });
      }
      setShowMindmapModal(false);
    } catch (e: unknown) {
      alert(`마인드맵 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleFlashcardGenerate(cfg: FlashcardConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("flashcard");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/flashcard`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          count: cfg.count,
          difficulty: cfg.difficulty,
          topic: cfg.topic,
          language: cfg.language,
          item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "플래시카드",
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const flashcardTitle = data.title || "플래시카드";
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "flashcard",
        title: flashcardTitle,
        subtitle: `플래시카드 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        flashcard: { cards: data.cards || [], difficulty: cfg.difficulty },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
      if (resolvedWeekId !== null) {
        onAddWeekTask?.(resolvedWeekId, buildWeekTask("flashcard", flashcardTitle, `플래시카드 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveFlashcard({ cards: data.cards || [], title: flashcardTitle });
      }
      setShowFlashcardModal(false);
    } catch (e: unknown) {
      alert(`플래시카드 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleSlideGenerate(cfg: SlideConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("slides");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          format: cfg.format,
          length: cfg.length,
          language: cfg.language,
          prompt: cfg.prompt,
          item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "슬라이드 자료",
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const slidesTitle = data.title || "슬라이드 자료";
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "slides",
        title: slidesTitle,
        subtitle: `슬라이드 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        slides: { slides: data.slides || [], format: cfg.format, cover_image_b64: data.cover_image_b64 || "" },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
      if (resolvedWeekId !== null) {
        onAddWeekTask?.(resolvedWeekId, buildWeekTask("slides", slidesTitle, `슬라이드 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveSlides({ slides: data.slides || [], title: slidesTitle, cover_image_b64: data.cover_image_b64 || "" });
      }
      setShowSlideModal(false);
    } catch (e: unknown) {
      alert(`슬라이드 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleReportGenerate(cfg: ReportConfig, saveToWeekId: number | null) {
    const docIds = getEffectiveDocIds();
    setLoadingType("report");
    try {
      const token = await getToken();
      const docNames = docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ");
      const res = await fetch(`${API}/api/generate/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: docIds,
          format: cfg.format,
          language: cfg.language,
          length: cfg.length,
          tone: cfg.tone,
          instructions: cfg.instructions,
          item_title: docNames || "보고서",
          notebook_id: notebookId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const reportTitle = data.title || docNames || "보고서";
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "report",
        title: reportTitle,
        subtitle: `보고서 · 소스 ${docIds.length}개`,
        createdAt: new Date(),
        report: { sections: data.sections || [], format: cfg.format },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
      if (resolvedWeekId !== null) {
        onAddWeekTask?.(resolvedWeekId, buildWeekTask("report", reportTitle, `보고서 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id));
        setWeekGeneratingFor(null);
      } else {
        setActiveReport({ sections: data.sections || [], title: reportTitle, format: cfg.format });
      }
      setShowReportModal(false);
    } catch (e: unknown) {
      alert(`보고서 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  function handleUnifiedGenerate(typeId: string, cfg: UnifiedConfig, saveToWeekId: number | null) {
    const docIds = cfg.selectedDocIds.length > 0 ? cfg.selectedDocIds : activeDocIds;
    const langMap: Record<string, string> = { "한국어": "ko", "English": "en", "日本語": "ja", "中文": "zh" };
    const lengthMap: Record<string, string> = { "5문제": "short", "10문제": "medium", "15문제": "long" };
    const diffMap: Record<string, string> = { "5문제": "easy", "10문제": "medium", "15문제": "hard" };
    const countMap: Record<string, number> = { "5문제": 5, "10문제": 10, "15문제": 15 };
    const lang = langMap[cfg.language] || "ko";
    const length = lengthMap[cfg.length] || "medium";

    // 타입 라벨
    const typeLabel: Record<string, string> = {
      audio: "AI 오디오 오버뷰", quiz: "퀴즈", mindmap: "마인드맵", flashcard: "플래시카드",
      slides: "슬라이드 자료", report: "보고서", table: "데이터 표", infographic: "인포그래픽",
    };
    const savedType = (typeId === "table" ? "data" : typeId) as SavedItem["type"];

    // 1. 플레이스홀더 즉시 추가
    const tempId = `pending-${typeId}-${Date.now()}`;
    const pendingItem: SavedItem = {
      id: tempId,
      type: savedType,
      title: `${typeLabel[typeId] || typeId} 생성 중...`,
      subtitle: `기반:소스 ${docIds.length}개`,
      createdAt: new Date(),
      generating: true,
    };
    setSavedItems((prev) => [pendingItem, ...prev]);

    // 2. 모달 즉시 닫기
    setShowUnifiedModal(false);
    setUnifiedModalItem(null);

    // 3. 백그라운드 생성
    (async () => {
    try {
      const token = await getToken();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      if (typeId === "audio") {
        const audioFormatMap: Record<string, string> = {
          "강의 요약 오디오": "lecture_summary", "핵심 개념 설명": "concept_explanation",
          "Q&A 형식": "qa", "스토리텔링 방식": "storytelling", "토론 형식": "debate", "인터뷰 형식": "interview",
        };
        const res = await fetch(`${API}/api/generate/audio`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, format: audioFormatMap[cfg.format] || "lecture_summary", language: lang, length, focus: cfg.instructions, notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "오디오 오버뷰";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "audio", title, subtitle: `오디오 · 소스 ${docIds.length}개`, createdAt: new Date(), audio: { base64: data.audio_base64, script: data.script } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdA = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdA !== null) { onAddWeekTask?.(resolvedWeekIdA, buildWeekTask("audio", title, `오디오 · 소스 ${docIds.length}개`, resolvedWeekIdA, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveAudio({ base64: data.audio_base64, script: data.script, title }); }
      } else if (typeId === "quiz") {
        const toneMap: Record<string, string> = { "격식체": "formal", "구어체": "casual", "학술체": "academic" };
        const quizStyleFromFormat: Record<string, string> = { "객관식 퀴즈": "multiple_choice", "O/X 퀴즈": "ox" };
        const res = await fetch(`${API}/api/generate`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            doc_ids: docIds,
            type: "quiz",
            difficulty: diffMap[cfg.length] || "medium",
            quiz_count: countMap[cfg.length] || 5,
            topic: cfg.instructions || "",
            quiz_style: quizStyleFromFormat[cfg.format] || "multiple_choice",
            language: lang,
            tone: toneMap[cfg.style] || "formal",
            instructions: cfg.instructions || "",
            notebook_id: notebookId,
          }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const quizData = data.result as { title: string; questions: { id: number; type?: string; question: string; options: string[]; answerIndex: number; answerText?: string; hint: string; explanation: string }[] };
        const questions: QuizQuestion[] = quizData.questions.map((q) => ({
          question: q.question,
          type: (q.type as QuizQuestion["type"]) ?? "multiple_choice",
          options: q.options ?? [],
          answer: q.answerIndex ?? -1,
          answerText: q.answerText,
          hint: q.hint,
          explanation: q.explanation,
        }));
        const quiz: SavedQuiz = { id: data.item_id || Date.now().toString(), title: quizData.title || "퀴즈", questions, createdAt: new Date(), difficulty: diffMap[cfg.length] || "medium" };
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "quiz", title: quiz.title, subtitle: `퀴즈 · 소스 ${docIds.length}개`, createdAt: new Date(), quiz };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdQ = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdQ !== null) { onAddWeekTask?.(resolvedWeekIdQ, buildWeekTask("quiz", quiz.title, `퀴즈 · 소스 ${docIds.length}개`, resolvedWeekIdQ, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveQuiz(quiz); }
      } else if (typeId === "mindmap") {
        const res = await fetch(`${API}/api/generate/mindmap`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, language: lang, focus: cfg.instructions || cfg.format, notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "마인드맵";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "mindmap", title, subtitle: `마인드맵 · 소스 ${docIds.length}개`, createdAt: new Date(), mindmap: { nodes: data.nodes || [] } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdM = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdM !== null) { onAddWeekTask?.(resolvedWeekIdM, buildWeekTask("mindmap", title, `마인드맵 · 소스 ${docIds.length}개`, resolvedWeekIdM, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveMindmap({ nodes: data.nodes || [], title }); }
      } else if (typeId === "flashcard") {
        const res = await fetch(`${API}/api/generate/flashcard`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, count: countMap[cfg.length] || 5, difficulty: diffMap[cfg.length] || "medium", topic: cfg.format || cfg.instructions || "", language: lang, item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "플래시카드", notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "플래시카드";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "flashcard", title, subtitle: `플래시카드 · 소스 ${docIds.length}개`, createdAt: new Date(), flashcard: { cards: data.cards || [], difficulty: diffMap[cfg.length] || "medium" } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdF = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdF !== null) { onAddWeekTask?.(resolvedWeekIdF, buildWeekTask("flashcard", title, `플래시카드 · 소스 ${docIds.length}개`, resolvedWeekIdF, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveFlashcard({ cards: data.cards || [], title }); }
      } else if (typeId === "slides") {
        const res = await fetch(`${API}/api/generate/slides`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, format: cfg.format || "lecture", length, language: lang, prompt: cfg.instructions, item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "슬라이드 자료", notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "슬라이드 자료";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "slides", title, subtitle: `슬라이드 · 소스 ${docIds.length}개`, createdAt: new Date(), slides: { slides: data.slides || [], format: cfg.format, cover_image_b64: data.cover_image_b64 || "" } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdS = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdS !== null) { onAddWeekTask?.(resolvedWeekIdS, buildWeekTask("slides", title, `슬라이드 · 소스 ${docIds.length}개`, resolvedWeekIdS, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveSlides({ slides: data.slides || [], title, cover_image_b64: data.cover_image_b64 || "" }); }
      } else if (typeId === "report") {
        const res = await fetch(`${API}/api/generate/report`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, format: cfg.format || "report", language: lang, length, tone: cfg.style === "구어체" ? "casual" : cfg.style === "학술체" ? "academic" : "formal", instructions: cfg.instructions, item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "보고서", notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "보고서";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "report", title, subtitle: `보고서 · 소스 ${docIds.length}개`, createdAt: new Date(), report: { sections: data.sections || [], format: cfg.format } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdR = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdR !== null) { onAddWeekTask?.(resolvedWeekIdR, buildWeekTask("report", title, `보고서 · 소스 ${docIds.length}개`, resolvedWeekIdR, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveReport({ sections: data.sections || [], title, format: cfg.format }); }
      } else if (typeId === "table") {
        const tableFormatMap: Record<string, string> = {
          "핵심 내용 정리표": "summary_table",
          "비교 분석 표": "comparison_table",
          "개념 정의 표": "concept_definition",
          "학습 점검표": "learning_checklist",
          "진도 추적 표": "progress_tracking",
          "요약 데이터표": "summary_table",
        };
        const tableFormat = tableFormatMap[cfg.format] || "summary_table";
        const res = await fetch(`${API}/api/generate/data`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, format: tableFormat, language: lang, instructions: cfg.instructions, item_title: docs.filter((d) => docIds.includes(d.id)).map((d) => d.name).join(", ") || "데이터표", notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "데이터표";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "data", title, subtitle: `데이터표 · 소스 ${docIds.length}개`, createdAt: new Date(), dataTable: { title: data.title || "데이터표", description: data.description || "", columns: data.columns || [], rows: data.rows || [] } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekIdT = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekIdT !== null) { onAddWeekTask?.(resolvedWeekIdT, buildWeekTask("data", title, `데이터표 · 소스 ${docIds.length}개`, resolvedWeekIdT, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveDataTable({ title: data.title || "데이터표", description: data.description || "", columns: data.columns || [], rows: data.rows || [] }); }
      } else if (typeId === "infographic") {
        const infographicFormatMap: Record<string, string> = {
          "개요형": "overview", "프로세스형": "process", "비교형": "comparison",
          "통계형": "statistics", "타임라인형": "timeline",
        };
        const infographicFormat = infographicFormatMap[cfg.format] || "overview";
        const res = await fetch(`${API}/api/generate/infographic`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: docIds, format: infographicFormat, language: lang, instructions: cfg.instructions, notebook_id: notebookId }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        const title = data.title || "인포그래픽";
        const newItem: SavedItem = { id: data.item_id || Date.now().toString(), type: "infographic", title, subtitle: `인포그래픽 · 소스 ${docIds.length}개`, createdAt: new Date(), infographic: { title: data.title || "인포그래픽", description: data.description || "", sections: data.sections || [] } };
        setSavedItems((prev) => prev.map((i) => i.id === tempId ? newItem : i));
        const resolvedWeekId = weekGeneratingFor ?? saveToWeekId;
        if (resolvedWeekId !== null) { onAddWeekTask?.(resolvedWeekId, buildWeekTask("infographic", title, `인포그래픽 · 소스 ${docIds.length}개`, resolvedWeekId, data.item_id)); setWeekGeneratingFor(null); }
        else { setActiveInfographic({ title: data.title || "인포그래픽", description: data.description || "", sections: data.sections || [] }); }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "오류가 발생했습니다";
      setSavedItems((prev) => prev.map((i) => i.id === tempId ? { ...i, generating: false, generatingError: errMsg } : i));
    }
    })();
  }

  function handleCardClick(typeId: string, forWeekId?: number) {
    const effectiveDocIds = forWeekId !== undefined
      ? (weeks.find((w) => w.id === forWeekId)?.sources.filter((s) => s.docId).map((s) => s.docId!) ?? [])
      : activeDocIds;
    if (effectiveDocIds.length === 0) {
      alert(forWeekId !== undefined ? "이 주차에 소스를 먼저 추가해주세요." : "소스를 먼저 선택해주세요.");
      return;
    }
    if (forWeekId !== undefined) {
      setWeekGeneratingFor(forWeekId);
    }
    setShowWeekTypePickerForId(null);
    const taskItem = STUDIO_TASK_ITEMS.find((i) => i.id === typeId);
    if (taskItem) {
      setUnifiedModalItem(taskItem);
      setShowUnifiedModal(true);
    } else {
      if (forWeekId !== undefined) setWeekGeneratingFor(null);
      alert("곧 지원 예정인 기능입니다 ✨");
    }
  }

  const expandToggleBtn = (
    <button
      onClick={() => setIsExpanded((v) => !v)}
      title={isExpanded ? "축소" : "전체화면"}
      className="absolute top-2.5 right-2.5 z-20 p-1.5 rounded-lg bg-white/90 border border-gray-200 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
    >
      {isExpanded ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
      )}
    </button>
  );

  const handleSubviewBack = (clearFn: () => void) => {
    clearFn();
    if (isExpanded) setIsExpanded(false);
  };

  const subviewContent =
    activeQuiz ? <QuizView quiz={activeQuiz} onBack={() => handleSubviewBack(() => setActiveQuiz(null))} /> :
    summaryContent ? <SummaryView content={summaryContent} onBack={() => handleSubviewBack(() => setSummaryContent(null))} /> :
    activeAudio ? <AudioView audioBase64={activeAudio.base64} audioUrl={activeAudio.audioUrl} script={activeAudio.script} title={activeAudio.title} onBack={() => handleSubviewBack(() => setActiveAudio(null))} /> :
    activeMindmap ? <MindMapView nodes={activeMindmap.nodes} title={activeMindmap.title} onBack={() => handleSubviewBack(() => setActiveMindmap(null))} /> :
    activeMemo !== null ? (
      <MemoView
        initialId={activeMemo.id}
        initialTitle={activeMemo.title}
        initialContent={activeMemo.content}
        initialWeekId={activeMemo.id ? (weeks.find((week) => week.tasks.some((task) => task.itemId === activeMemo.id))?.id ?? null) : null}
        weeks={weeks}
        onBack={() => handleSubviewBack(() => setActiveMemo(null))}
        onSave={handleSaveMemo}
      />
    ) :
    activeFlashcard ? <FlashcardView cards={activeFlashcard.cards} title={activeFlashcard.title} onBack={() => handleSubviewBack(() => setActiveFlashcard(null))} /> :
    activeSlides ? <SlideView slides={activeSlides.slides} title={activeSlides.title} coverImageB64={activeSlides.cover_image_b64} onBack={() => handleSubviewBack(() => setActiveSlides(null))} /> :
    activeReport ? <ReportView sections={activeReport.sections} title={activeReport.title} format={activeReport.format} onBack={() => handleSubviewBack(() => setActiveReport(null))} /> :
    activeDataTable ? <DataTableView data={activeDataTable} onBack={() => handleSubviewBack(() => setActiveDataTable(null))} /> :
    activeInfographic ? <InfographicView data={activeInfographic} onBack={() => handleSubviewBack(() => setActiveInfographic(null))} /> :
    null;

  if (subviewContent) {
    const inner = (
      <div className="fixed inset-0 z-[9999] bg-white">
        {subviewContent}
        {expandToggleBtn}
      </div>
    );
    return (isExpanded || forcePortalSubviews) ? createPortal(inner, document.body) : <div className="h-full w-full relative">{subviewContent}{expandToggleBtn}</div>;
  }

  return (
    <aside className={`flex flex-col bg-white overflow-hidden ${isExpanded ? "fixed inset-0 z-50" : "w-full h-full"}`}>
      {showUnifiedModal && unifiedModalItem && (
        <UnifiedGenerateModal
          item={unifiedModalItem}
          loading={loadingType === unifiedModalItem.id}
          docs={docs}
          activeDocIds={activeDocIds}
          weeks={weeks}
          initialWeekId={weekGeneratingFor}
          onClose={() => { setShowUnifiedModal(false); setUnifiedModalItem(null); setWeekGeneratingFor(null); }}
          onGenerate={(cfg, weekId) => handleUnifiedGenerate(unifiedModalItem.id, cfg, weekId)}
        />
      )}

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100" style={{ minHeight: 44 }}>
        <span className="text-gray-800 whitespace-nowrap" style={{ fontSize: "0.92rem", fontWeight: 700 }}>스튜디오</span>
        <button
          onClick={() => setIsExpanded((v) => !v)}
          title={isExpanded ? "축소" : "전체화면"}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-blue-100 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors shrink-0"
        >
          {isExpanded ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Content type grid */}
        <div className="shrink-0 grid grid-cols-3 gap-1.5 p-3 border-b border-gray-100">
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => handleCardClick(ct.id)}
              disabled={loadingType !== null}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl transition-colors group ${
                loadingType === ct.id
                  ? "bg-blue-500 ring-2 ring-blue-300"
                  : "hover:bg-blue-100"
              }`}
              style={{ background: loadingType === ct.id ? undefined : "#EFF6FF" }}
            >
              <div className={`transition-colors ${
                loadingType === ct.id ? "text-white" : "text-blue-600 group-hover:text-blue-700"
              }`}>
                {loadingType === ct.id
                  ? <Spinner className="w-[18px] h-[18px]" />
                  : <TypeIcon id={ct.id} color={loadingType === ct.id ? "#fff" : "#2563eb"} size={18} />}
              </div>
              <span
                className={`transition-colors text-center leading-tight ${
                  loadingType === ct.id ? "text-white" : "text-blue-600 group-hover:text-blue-700"
                }`}
                style={{ fontSize: "0.62rem", fontWeight: 500 }}
              >
                {ct.shortLabel}
              </span>
            </button>
          ))}
        </div>

        {/* Saved items list */}
        {!hideCollections && savedItems.length > 0 && (
          <div className="pb-1">
            <div className="px-4 pt-2 pb-1">
              <span className="text-gray-400" style={{ fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>생성된 자료</span>
            </div>
            {savedItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 px-4 py-1.5 transition-colors group ${item.generating || item.generatingError ? "cursor-default" : "cursor-grab hover:bg-gray-50"}`}
                draggable={!item.generating && !item.generatingError}
                onDragStart={(e) => {
                  if (item.generating || item.generatingError) { e.preventDefault(); return; }
                  const ICONS: Record<string, { icon: string; iconBg: string }> = {
                    audio: { icon: "🎧", iconBg: "#d0f5f1" },
                    slides: { icon: "📊", iconBg: "#fef0da" },
                    video: { icon: "🎬", iconBg: "#dcf5dc" },
                    mindmap: { icon: "🗺️", iconBg: "#f0e6ff" },
                    report: { icon: "📝", iconBg: "#dcf2e8" },
                    flashcard: { icon: "🃏", iconBg: "#fde0ea" },
                    quiz: { icon: "❓", iconBg: "#dbeafe" },
                    infographic: { icon: "📈", iconBg: "#ede8ff" },
                    data: { icon: "📋", iconBg: "#f1f3f4" },
                  };
                  const { icon, iconBg } = ICONS[item.type] ?? { icon: "📄", iconBg: "#f1f3f4" };
                  e.dataTransfer.setData("application/studio-item", JSON.stringify({
                    id: item.id, type: item.type, title: item.title, subtitle: item.subtitle, icon, iconBg,
                  }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                {/* Type icon */}
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${item.generating ? "text-blue-400" : item.generatingError ? "text-red-400" : "text-blue-500"}`}
                  style={{ background: item.generatingError ? "#FEF2F2" : "#EFF6FF" }}
                >
                  {item.generating
                    ? <Spinner className="w-3 h-3" />
                    : <TypeIcon id={item.type} color={item.generatingError ? "#ef4444" : "#2563eb"} size={11} />
                  }
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  {item.generating ? (
                    <p className="text-blue-500 truncate animate-pulse" style={{ fontSize: "0.72rem", fontWeight: 500 }}>{item.title}</p>
                  ) : item.generatingError ? (
                    <p className="text-red-500 truncate" style={{ fontSize: "0.72rem", fontWeight: 500 }}>생성 실패</p>
                  ) : renamingItemId === item.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitRename(item.id); }
                          if (e.key === "Escape") setRenamingItemId(null);
                        }}
                        className="w-full bg-transparent border-b border-blue-400 outline-none truncate"
                        style={{ fontSize: "0.72rem", fontWeight: 500 }}
                      />
                      <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); commitRename(item.id); }} className="w-4 h-4 rounded bg-blue-500 text-white flex items-center justify-center shrink-0">
                        <svg width="8" height="8" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setRenamingItemId(null); }} className="w-4 h-4 rounded bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
                        <svg width="8" height="8" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  ) : (
                    <p className="text-gray-700 truncate" style={{ fontSize: "0.72rem", fontWeight: 500 }}>{item.title}</p>
                  )}
                  {item.generatingError && (
                    <p className="text-red-400 truncate" style={{ fontSize: "0.62rem" }}>{item.generatingError}</p>
                  )}
                  {item.generating && (
                    <p className="text-gray-400 truncate" style={{ fontSize: "0.62rem" }}>{item.subtitle}</p>
                  )}
                </div>
                {/* 생성중: X 버튼 | 오류: 빨간 X | 완료: 기존 버튼 */}
                {item.generating && (
                  <button
                    onClick={() => setSavedItems((prev) => prev.filter((i) => i.id !== item.id))}
                    className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center shrink-0 hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                    title="취소"
                  >
                    <svg className="w-2.5 h-2.5 text-gray-400" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 2L12 12M12 2L2 12"/></svg>
                  </button>
                )}
                {!item.generating && !item.generatingError && (
                  <button
                    onClick={() => {
                      if (onViewItem) { onViewItem(item); return; }
                      if (item.type === "quiz" && item.quiz) setActiveQuiz(item.quiz);
                      else if (item.type === "audio") setActiveAudio({ base64: item.audio?.base64, audioUrl: item.audioUrl, script: item.audio?.script || "", title: item.title });
                      else if (item.type === "mindmap" && item.mindmap) setActiveMindmap({ nodes: item.mindmap.nodes, title: item.title });
                      else if (item.type === "memo") setActiveMemo({ id: item.id, title: item.title, content: item.memoContent ?? "" });
                      else if (item.type === "flashcard" && item.flashcard) setActiveFlashcard({ cards: item.flashcard.cards, title: item.title });
                      else if (item.type === "slides" && item.slides) setActiveSlides({ slides: item.slides.slides, title: item.title, cover_image_b64: item.slides.cover_image_b64 });
                      else if (item.type === "report" && item.report) setActiveReport({ sections: item.report.sections, title: item.title, format: item.report.format });
                      else if (item.type === "data" && item.dataTable) setActiveDataTable({ title: item.dataTable.title, description: item.dataTable.description, columns: item.dataTable.columns, rows: item.dataTable.rows });
                      else if (item.type === "infographic" && item.infographic) setActiveInfographic({ title: item.infographic.title, description: item.infographic.description, sections: item.infographic.sections });
                      else if (item.summaryContent) setSummaryContent(item.summaryContent);
                    }}
                    className="w-5 h-5 rounded-md bg-blue-500 flex items-center justify-center shrink-0 hover:bg-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <svg className="w-2.5 h-2.5 text-white ml-px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </button>
                )}
                {item.generatingError && (
                  <button
                    onClick={() => setSavedItems((prev) => prev.filter((i) => i.id !== item.id))}
                    className="w-5 h-5 rounded-md bg-red-100 flex items-center justify-center shrink-0 hover:bg-red-200 transition-colors"
                    title="삭제"
                  >
                    <svg className="w-2.5 h-2.5 text-red-500" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 2L12 12M12 2L2 12"/></svg>
                  </button>
                )}
                {/* Three-dots menu (완료 아이템만) */}
                {!item.generating && !item.generatingError && (
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === item.id ? null : item.id); }}
                      className="p-0.5 rounded hover:bg-gray-200 text-gray-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                      </svg>
                    </button>
                    {openMenuId === item.id && (
                      <div className="absolute right-0 top-6 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1 w-32">
                        <button onClick={(e) => { e.stopPropagation(); startRename(item); }} className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left flex items-center gap-2">
                          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                          이름 변경
                        </button>
                        <button onClick={() => handleDeleteItem(item.id)} className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left flex items-center gap-2">
                          <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Week list */}
        {!hideCollections && weeks.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="px-4 pt-2 pb-1">
              <span className="text-gray-400" style={{ fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>주차별 자료</span>
            </div>
            {weeks.map((week, index) => {
              const isCollapsed = collapsedWeeks.includes(week.id);
              const allItems = [...(week.sources || []), ...(week.tasks || [])];
              return (
                <div key={week.id} className="border-b border-gray-100 last:border-0">
                  {/* Week header */}
                  <div
                    className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleWeekCollapse(week.id)}
                  >
                    <svg
                      className="w-3 h-3 text-gray-400 shrink-0 transition-transform"
                      style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                        {week.title || `W${index + 1} 제목`}
                      </p>
                      <p className="text-gray-400" style={{ fontSize: "0.63rem" }}>{allItems.length}개</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowWeekTypePickerForId((prev) => prev === week.id ? null : week.id); }}
                      className="w-5 h-5 rounded flex items-center justify-center shrink-0 hover:bg-blue-200 transition-colors"
                      style={{ background: showWeekTypePickerForId === week.id ? "#BFDBFE" : "#EFF6FF" }}
                      title="스튜디오 자료 생성"
                    >
                      <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                  {/* Content type mini picker */}
                  {showWeekTypePickerForId === week.id && (
                    <div className="px-2 pb-2">
                      <div className="grid grid-cols-3 gap-1 rounded-xl p-1.5" style={{ background: "#EFF6FF" }}>
                        {CONTENT_TYPES.filter((ct) => ct.id !== "infographic").map((ct) => (
                          <button
                            key={ct.id}
                            onClick={() => handleCardClick(ct.id, week.id)}
                            disabled={loadingType !== null}
                            className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
                          >
                            {loadingType === ct.id && weekGeneratingFor === week.id
                              ? <Spinner className="w-3.5 h-3.5 text-blue-500" />
                              : <TypeIcon id={ct.id} color="#2563eb" size={14} />}
                            <span className="text-blue-600 text-center leading-tight" style={{ fontSize: "0.58rem", fontWeight: 500 }}>{ct.shortLabel}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Items */}
                  {!isCollapsed && (
                    <div className="pb-1">
                      {allItems.length === 0 ? (
                        <div className="px-4 py-1.5">
                          <p className="text-gray-300" style={{ fontSize: "0.7rem" }}>항목 없음</p>
                        </div>
                      ) : (
                        allItems.map((item: any, i: number) => (
                          <div
                            key={`week-${week.id}-item-${i}`}
                            className="flex items-center gap-2 px-4 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <div
                              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                              style={{ background: "#EFF6FF" }}
                            >
                              {item.icon ? (
                                <span style={{ fontSize: "0.7rem" }}>{item.icon}</span>
                              ) : (
                                <svg className="w-2.5 h-2.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              )}
                            </div>
                            <p className="text-gray-700 truncate flex-1" style={{ fontSize: "0.72rem", fontWeight: 500 }}>
                              {item.name ?? item.title ?? `항목 ${i + 1}`}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 메모 추가 button */}
      <div className="px-3 py-3 shrink-0 border-t border-gray-100">
        <button
          onClick={() => setActiveMemo({ id: null, title: "", content: "" })}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-blue-600 hover:bg-blue-50 transition-colors"
          style={{ fontSize: "0.75rem", fontWeight: 500, background: "#EFF6FF" }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          메모 추가
        </button>
      </div>
    </aside>
  );
}
