"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  X, BookOpen, NotebookPen, Sparkles, GripVertical,
  Loader2, Clock, CheckCircle2, Send, Trash2, Pencil,
  ArrowUpRight, Plus, Wand2, ChevronLeft,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ACTION_OPTIONS = [
  "읽기", "훑어보기", "요약 복습", "퀴즈 풀기", "플래시카드 암기", "메모 확인", "오디오 듣기",
];

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface StudyPlanStep {
  order: number;
  item_id: string;
  item_name: string;
  item_type: "document" | "studio";
  action: string;
  duration_minutes: number;
  tip: string;
}

interface StudyPlanResult {
  title: string;
  purpose: string;
  total_estimated_hours: number;
  steps: StudyPlanStep[];
}

interface SavedNote {
  id: string;
  text: string;
  plan?: StudyPlanResult;
}

interface TextMsg {
  id: string;
  role: "ai" | "user";
  type: "text";
  text: string;
}

interface QuickReplyMsg {
  id: string;
  role: "ai";
  type: "quick_reply";
  text: string;
  replyType: "week" | "purpose";
  options: Array<{ label: string; value: string; description?: string }>;
  answered: boolean;
}

interface PlanMsg {
  id: string;
  role: "ai";
  type: "plan";
  plan: StudyPlanResult;
  week: number;
}

type ChatMessage = TextMsg | QuickReplyMsg | PlanMsg;
type ChatStep = "selecting_week" | "selecting_purpose" | "generating" | "done";

interface DocItem {
  id: string;
  name?: string;
  filename?: string;
  type?: string;
}

interface StudyPlanChatPanelProps {
  notebookId: string;
  selectedLLM: string;
  onClose: () => void;
  weeklyDocIds: Record<number, string[]>;
  weeklyStudioIds: Record<number, string[]>;
  onStudyPlanSaved?: () => void;
  onOpenDoc: (docId: string) => void;
  onOpenStudioItem: (itemId: string) => void;
  docs?: DocItem[];
  onStudioItemCreated?: () => void;
}

// ─── 로컬스토리지 ─────────────────────────────────────────────────────────────

function planStorageKey(notebookId: string) {
  return `studyu_study_plan_${notebookId}`;
}

function loadPersistedState(notebookId: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(planStorageKey(notebookId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// ─── EditablePlanCard ─────────────────────────────────────────────────────────

function EditablePlanCard({
  plan,
  onPlanChange,
  onOpenDoc,
  onOpenStudioItem,
  headerAction,
}: {
  plan: StudyPlanResult;
  onPlanChange: (plan: StudyPlanResult) => void;
  onOpenDoc: (id: string) => void;
  onOpenStudioItem: (id: string) => void;
  headerAction?: ReactNode;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [editDurationIdx, setEditDurationIdx] = useState<number | null>(null);
  const [durationVal, setDurationVal] = useState("");
  const [editActionIdx, setEditActionIdx] = useState<number | null>(null);

  const actionIcon = (a: string) => {
    if (a.includes("퀴즈")) return "📝";
    if (a.includes("플래시카드") || a.includes("암기")) return "🃏";
    if (a.includes("요약") || a.includes("복습")) return "📋";
    if (a.includes("오디오") || a.includes("듣기")) return "🎧";
    return "📖";
  };

  const purposeBadgeClass = (p: string) => {
    if (p.includes("개념")) return "bg-blue-50 text-blue-600 border-blue-100";
    if (p.includes("시험")) return "bg-amber-50 text-amber-600 border-amber-100";
    if (p.includes("벼락")) return "bg-red-50 text-red-500 border-red-100";
    return "bg-gray-50 text-gray-500 border-gray-100";
  };

  const recalcHours = (steps: StudyPlanStep[]) =>
    Math.round(steps.reduce((s, x) => s + x.duration_minutes, 0) / 60 * 10) / 10;

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const steps = [...plan.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    const renum = steps.map((s, i) => ({ ...s, order: i + 1 }));
    onPlanChange({ ...plan, steps: renum });
  };

  const deleteStep = (idx: number) => {
    const steps = plan.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 }));
    onPlanChange({ ...plan, steps, total_estimated_hours: recalcHours(steps) });
  };

  const commitDuration = (idx: number) => {
    const mins = parseInt(durationVal);
    if (!isNaN(mins) && mins > 0) {
      const steps = plan.steps.map((s, i) =>
        i === idx ? { ...s, duration_minutes: mins } : s
      );
      onPlanChange({ ...plan, steps, total_estimated_hours: recalcHours(steps) });
    }
    setEditDurationIdx(null);
  };

  const commitAction = (idx: number, action: string) => {
    const steps = plan.steps.map((s, i) => i === idx ? { ...s, action } : s);
    onPlanChange({ ...plan, steps });
    setEditActionIdx(null);
  };

  return (
    <div className="bg-white border border-[#e7e9ed] rounded-xl overflow-hidden shadow-sm">
      {/* 헤더 */}
      <div className="px-4 py-3 bg-[#f8f9ff] border-b border-[#e8ecff]">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[13px] font-bold text-[#1a202c] leading-snug">{plan.title}</p>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${purposeBadgeClass(plan.purpose)}`}>
            {plan.purpose}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#6b7280] mb-2">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            총 {plan.total_estimated_hours}시간 예상
          </span>
          <span className="text-[#d1d5db]">·</span>
          <span>{plan.steps.length}단계</span>
        </div>
        {headerAction}
      </div>

      {/* 스텝 */}
      <div className="divide-y divide-[#f0f1f3]">
        {plan.steps.map((step, i) => (
          <div
            key={i}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
            onDrop={() => {
              if (dragIdx !== null) reorder(dragIdx, i);
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            className={`px-3 py-3 group transition-colors ${
              dragOverIdx === i && dragIdx !== i ? "bg-[#eff4ff] border-t-2 border-[#155dfc]" : "hover:bg-[#fafbff]"
            } ${dragIdx === i ? "opacity-40" : ""}`}
          >
            <div className="flex items-start gap-2">
              {/* 드래그 핸들 */}
              <GripVertical className="shrink-0 w-3.5 h-3.5 text-[#d1d5db] group-hover:text-[#9ca3af] mt-1 cursor-grab active:cursor-grabbing transition-colors" />
              {/* 순서 번호 */}
              <div className="shrink-0 w-5 h-5 rounded-full bg-[#155dfc] text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                {step.order}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[#1a202c] leading-snug mb-1.5">
                  {actionIcon(step.action)} {step.item_name}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* 액션 뱃지 — 클릭 시 드롭다운 */}
                  {editActionIdx === i ? (
                    <select
                      autoFocus
                      value={step.action}
                      onChange={e => commitAction(i, e.target.value)}
                      onBlur={() => setEditActionIdx(null)}
                      className="text-[11px] text-[#155dfc] bg-[#eff4ff] px-1.5 py-0.5 rounded-full border border-[#155dfc] outline-none"
                    >
                      {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : (
                    <button
                      onClick={() => setEditActionIdx(i)}
                      title="클릭해서 변경"
                      className="inline-flex items-center gap-1 text-[11px] text-[#155dfc] bg-[#eff4ff] px-2 py-0.5 rounded-full hover:bg-[#dbeafe] transition-colors"
                    >
                      {step.action}
                      <Pencil className="w-2.5 h-2.5 opacity-60" />
                    </button>
                  )}
                  {/* 소요시간 */}
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-[#9ca3af] bg-[#f5f6f8] px-2 py-0.5 rounded-full">
                    <Clock className="w-3 h-3" />
                    {editDurationIdx === i ? (
                      <input
                        autoFocus
                        type="number"
                        min={1}
                        value={durationVal}
                        onChange={e => setDurationVal(e.target.value)}
                        onBlur={() => commitDuration(i)}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitDuration(i);
                          if (e.key === "Escape") setEditDurationIdx(null);
                        }}
                        className="w-10 text-[11px] bg-transparent outline-none text-[#2d3748]"
                      />
                    ) : (
                      <button
                        onClick={() => { setEditDurationIdx(i); setDurationVal(String(step.duration_minutes)); }}
                        title="클릭해서 수정"
                        className="hover:text-[#155dfc] transition-colors"
                      >
                        {step.duration_minutes}분
                      </button>
                    )}
                  </span>
                </div>
                {step.tip && (
                  <p className="text-[11px] text-[#9ca3af] mt-1.5 leading-relaxed italic">{step.tip}</p>
                )}
                <button
                  onClick={() => step.item_type === "document" ? onOpenDoc(step.item_id) : onOpenStudioItem(step.item_id)}
                  className="mt-2 inline-flex items-center gap-0.5 text-[11px] text-[#155dfc] bg-[#eff4ff] hover:bg-[#dbeafe] px-2 py-0.5 rounded-full transition-colors"
                >
                  바로가기 <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
              {/* 단계 삭제 */}
              <button
                onClick={() => deleteStep(i)}
                className="shrink-0 p-1 rounded-lg hover:bg-red-50 text-[#d1d5db] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all mt-0.5"
                title="단계 삭제"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── StudyPlanChatPanel ───────────────────────────────────────────────────────

// ── 스튜디오 타입 정의 ────────────────────────────────────────────────────────
const STUDIO_ITEMS_DEF = [
  { id: "audio",      label: "AI 오디오 오버뷰", icon: "🎧", presets: ["강의 요약 오디오","핵심 개념 설명","Q&A 형식","스토리텔링 방식"] },
  { id: "slides",    label: "슬라이드 자료",    icon: "📊", presets: ["강의 슬라이드","요약 슬라이드","발표 자료","학습 정리 슬라이드"] },
  { id: "mindmap",   label: "마인드맵",         icon: "🧠", presets: ["개념 구조도","인과관계 맵","비교 분석 맵","학습 흐름도"] },
  { id: "report",    label: "보고서",           icon: "📝", presets: ["학습 가이드","기술 개념 설명서","사례 분석 보고서"] },
  { id: "flashcard", label: "플래시카드",       icon: "🃏", presets: ["단어·정의 카드","Q&A 카드","공식 암기 카드"] },
  { id: "quiz",      label: "퀴즈",             icon: "✅", presets: ["객관식 퀴즈","O/X 퀴즈"] },
  { id: "infographic", label: "인포그래픽",   icon: "🎨", presets: ["개요형","프로세스형","비교형","통계형","타임라인형"] },
  { id: "table",     label: "데이터 표",        icon: "📋", presets: ["핵심 내용 정리표","비교 분석 표","개념 정의 표"] },
] as const;

type StudioItemId = typeof STUDIO_ITEMS_DEF[number]["id"];

const API_STUDENT = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function StudyPlanChatPanel({
  notebookId,
  selectedLLM,
  onClose,
  weeklyDocIds,
  weeklyStudioIds,
  onStudyPlanSaved,
  onOpenDoc,
  onOpenStudioItem,
  docs = [],
  onStudioItemCreated,
}: StudyPlanChatPanelProps) {
  // ── 탭 ──
  const [activeTab, setActiveTab] = useState<"plan" | "notepad" | "studio">(() => {
    const saved = loadPersistedState(notebookId);
    return saved?.activeTab ?? "plan";
  });

  // ── 스튜디오 탭 상태 ──
  const [studioStep, setStudioStep] = useState<"grid" | "config">("grid");
  const [studioSelectedItem, setStudioSelectedItem] = useState<typeof STUDIO_ITEMS_DEF[number] | null>(null);
  const [studioConfig, setStudioConfig] = useState({ format: "", instructions: "", length: "10문제", language: "한국어", selectedDocIds: [] as string[] });
  const [studioGenerating, setStudioGenerating] = useState(false);
  const [studioGeneratingLabel, setStudioGeneratingLabel] = useState("");
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioDone, setStudioDone] = useState(false);

  // ── 챗 상태 ──
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadPersistedState(notebookId);
    const msgs = saved?.messages;
    if (Array.isArray(msgs) && msgs.length > 0 && saved?.chatStep !== "generating") return msgs;
    return [];
  });

  const [chatStep, setChatStep] = useState<ChatStep>(() => {
    const saved = loadPersistedState(notebookId);
    if (saved?.chatStep === "generating") return "selecting_week";
    return saved?.chatStep ?? "selecting_week";
  });

  const [currentPlan, setCurrentPlan] = useState<StudyPlanResult | null>(() => {
    const saved = loadPersistedState(notebookId);
    return saved?.currentPlan ?? null;
  });

  const [planTargetWeek, setPlanTargetWeek] = useState<number>(() => {
    const saved = loadPersistedState(notebookId);
    return saved?.planTargetWeek ?? 1;
  });

  // ── 입력 ──
  const [inputText, setInputText] = useState("");
  const [inputLoading, setInputLoading] = useState(false);

  // ── 계획 저장 상태 ──
  const [planNoteSaving, setPlanNoteSaving] = useState(false);
  const [planNoteSaved, setPlanNoteSaved] = useState(false);

  // ── 메모장 ──
  const [noteWeek, setNoteWeek] = useState<number | null>(() => {
    const saved = loadPersistedState(notebookId);
    return saved?.noteWeek ?? null;
  });
  const [noteText, setNoteText] = useState<string>(() => {
    const saved = loadPersistedState(notebookId);
    return saved?.noteText ?? "";
  });
  const [allNotes, setAllNotes] = useState<Record<number, SavedNote>>({});
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  // ── 자료 있는 주차만 ──
  const availableWeeks = useMemo(() =>
    Array.from(new Set([
      ...Object.keys(weeklyDocIds).map(Number),
      ...Object.keys(weeklyStudioIds).map(Number),
    ]))
    .filter(w => (weeklyDocIds[w]?.length ?? 0) + (weeklyStudioIds[w]?.length ?? 0) > 0)
    .sort((a, b) => a - b),
  [weeklyDocIds, weeklyStudioIds]);

  // ── 초기 메시지 ──
  useEffect(() => {
    if (messages.length > 0) return;
    const initMsg: QuickReplyMsg = {
      id: genId(),
      role: "ai",
      type: "quick_reply",
      text: availableWeeks.length === 0
        ? "안녕하세요! 현재 공개된 학습 자료가 없습니다. 자료가 공개된 후 다시 시도해주세요."
        : "안녕하세요! 어떤 주차의 학습계획을 세울까요?",
      replyType: "week",
      options: availableWeeks.map(w => ({ label: `${w}주차`, value: String(w) })),
      answered: availableWeeks.length === 0,
    };
    setMessages([initMsg]);
    setChatStep("selecting_week");
  }, [availableWeeks, messages.length]);

  // ── 메시지가 새로 추가될 때만 스크롤 (기존 메시지 수정 시 스크롤 안 함) ──
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // ── localStorage 동기화 ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(planStorageKey(notebookId), JSON.stringify({
        activeTab, messages, chatStep, currentPlan, planTargetWeek, noteWeek, noteText,
      }));
    } catch {}
  }, [activeTab, messages, chatStep, currentPlan, planTargetWeek, noteWeek, noteText, notebookId]);

  // ── 토큰 헬퍼 ──
  const getToken = async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  };

  // ── 메모 전체 로드 ──
  const loadAllNotes = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setNoteLoading(true);
    try {
      const res = await fetch(`${API}/api/studio/notes?notebook_id=${notebookId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const rows: { id: string; content: { week_id?: number; text?: string; plan?: StudyPlanResult } }[] = await res.json();
      const map: Record<number, SavedNote> = {};
      for (const row of rows) {
        const wid = row.content?.week_id;
        if (typeof wid === "number") {
          map[wid] = { id: row.id, text: row.content.text ?? "", plan: row.content.plan };
        }
      }
      setAllNotes(map);
      setNotesLoaded(true);
      setNoteWeek(prev => {
        if (prev === null && availableWeeks.length > 0) {
          setNoteText(map[availableWeeks[0]]?.text ?? "");
          return availableWeeks[0];
        }
        return prev;
      });
    } catch {}
    finally { setNoteLoading(false); }
  }, [notebookId, availableWeeks]);

  useEffect(() => {
    if (activeTab === "notepad" && !notesLoaded) loadAllNotes();
  }, [activeTab, notesLoaded, loadAllNotes]);

  // ── 주차 선택 ──
  const handleSelectWeek = (weekStr: string) => {
    const week = Number(weekStr);
    setPlanTargetWeek(week);
    setMessages(prev => prev.map(m =>
      m.type === "quick_reply" && m.replyType === "week" && !m.answered ? { ...m, answered: true } : m
    ));
    const userMsg: TextMsg = { id: genId(), role: "user", type: "text", text: `${week}주차` };
    const aiMsg: QuickReplyMsg = {
      id: genId(), role: "ai", type: "quick_reply",
      text: `${week}주차 학습계획을 세울게요! 어떤 목적으로 공부할 건가요?`,
      replyType: "purpose",
      options: [
        { label: "📚 개념정립", value: "concept", description: "기초부터 차근차근, 이해 중심" },
        { label: "📝 시험대비", value: "exam_cram", description: "핵심 암기 → 문제풀이, 효율 중심" },
        { label: "⚡ 벼락치기", value: "cram_mode", description: "시간 없을 때, 핵심만 2시간 이내" },
      ],
      answered: false,
    };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setChatStep("selecting_purpose");
  };

  // ── 목적 선택 → 계획 생성 ──
  const handleSelectPurpose = async (purpose: "concept" | "exam_cram" | "cram_mode", week: number) => {
    const purposeLabel = { concept: "개념정립", exam_cram: "시험대비", cram_mode: "벼락치기" }[purpose];
    setMessages(prev => prev.map(m =>
      m.type === "quick_reply" && m.replyType === "purpose" && !m.answered ? { ...m, answered: true } : m
    ));
    const userMsg: TextMsg = { id: genId(), role: "user", type: "text", text: purposeLabel };
    const loadingId = genId();
    const loadingMsg: TextMsg = { id: loadingId, role: "ai", type: "text", text: "__loading__" };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setChatStep("generating");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API}/api/generate/study-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: weeklyDocIds[week] ?? [],
          studio_item_ids: weeklyStudioIds[week] ?? [],
          notebook_id: notebookId,
          target_weeks: week,
          purpose,
          model: selectedLLM,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "학습계획 생성에 실패했습니다.");
      }
      const data = await res.json();
      const plan: StudyPlanResult = data.result;
      setCurrentPlan(plan);
      if (data.item_id) onStudyPlanSaved?.();

      const planMsg: PlanMsg = { id: loadingId, role: "ai", type: "plan", plan, week };
      setMessages(prev => prev.map(m => m.id === loadingId ? planMsg : m));

      const guideMsg: TextMsg = {
        id: genId(), role: "ai", type: "text",
        text: "학습계획이 완성됐어요! 각 단계를 드래그해서 순서를 바꾸거나, 소요시간·액션을 클릭해서 수정할 수 있어요. AI에게 수정을 요청할 수도 있어요.",
      };
      setMessages(prev => [...prev, guideMsg]);
      setChatStep("done");
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === loadingId
          ? { id: loadingId, role: "ai" as const, type: "text" as const, text: `⚠️ ${(e as Error).message}` }
          : m
      ));
      setChatStep("selecting_week");
    }
  };

  // ── 스마트 채팅 전송 (질문 답변 + 필요 시 계획 수정 자동 판단) ──
  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || inputLoading) return;
    setInputText("");
    const userMsg: TextMsg = { id: genId(), role: "user", type: "text", text };
    const loadingId = genId();
    const loadingMsg: TextMsg = { id: loadingId, role: "ai", type: "text", text: "__loading__" };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInputLoading(true);
    const token = await getToken();
    if (!token) { setInputLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/generate/study-plan/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notebook_id: notebookId, message: text, plan: currentPlan ?? {}, model: selectedLLM }),
      });
      if (!res.ok) throw new Error("응답 생성에 실패했습니다.");
      const data = await res.json();

      // 답변 텍스트 버블
      setMessages(prev => prev.map(m =>
        m.id === loadingId ? { id: loadingId, role: "ai" as const, type: "text" as const, text: data.answer } : m
      ));

      // 계획이 수정됐으면 새 계획 카드 추가
      if (data.updated_plan) {
        const newPlan: StudyPlanResult = data.updated_plan;
        setCurrentPlan(newPlan);
        const planMsg: PlanMsg = { id: genId(), role: "ai", type: "plan", plan: newPlan, week: planTargetWeek };
        setMessages(prev => [...prev, planMsg]);
      }
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === loadingId ? { id: loadingId, role: "ai" as const, type: "text" as const, text: `⚠️ ${(e as Error).message}` } : m
      ));
    } finally {
      setInputLoading(false);
    }
  };

  // ── 대화 전체 삭제 ──
  const handleClearChat = () => {
    setMessages([]);
    setChatStep("selecting_week");
    setCurrentPlan(null);
  };

  // ── 새 학습계획 시작 ──
  const handleReset = () => {
    const newMsg: QuickReplyMsg = {
      id: genId(), role: "ai", type: "quick_reply",
      text: "새 학습계획을 세울게요! 어떤 주차를 선택할까요?",
      replyType: "week",
      options: availableWeeks.map(w => ({ label: `${w}주차`, value: String(w) })),
      answered: false,
    };
    setMessages(prev => [...prev, newMsg]);
    setChatStep("selecting_week");
    setCurrentPlan(null);
  };

  // ── 계획을 메모장에 저장 ──
  const savePlanToNote = async (week: number, plan: StudyPlanResult) => {
    const token = await getToken();
    if (!token) return;
    setPlanNoteSaving(true);
    try {
      const existingText = allNotes[week]?.text ?? "";
      const res = await fetch(`${API}/api/studio/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notebook_id: notebookId, week_id: week, text: existingText, plan }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAllNotes(prev => ({ ...prev, [week]: { id: data.item_id, text: existingText, plan } }));
      setNotesLoaded(true);
      setNoteWeek(week);
      setNoteText(existingText);
      setPlanNoteSaved(true);
      setTimeout(() => setPlanNoteSaved(false), 2500);
    } catch {
      alert("저장에 실패했습니다.");
    } finally {
      setPlanNoteSaving(false);
    }
  };

  // ── 자유 메모 저장 ──
  const saveNote = async () => {
    if (noteWeek === null) return;
    const token = await getToken();
    if (!token) return;
    setNoteSaving(true);
    const currentPlanForNote = allNotes[noteWeek]?.plan;
    try {
      const res = await fetch(`${API}/api/studio/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          notebook_id: notebookId,
          week_id: noteWeek,
          text: noteText,
          ...(currentPlanForNote ? { plan: currentPlanForNote } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAllNotes(prev => ({ ...prev, [noteWeek]: { id: data.item_id, text: noteText, plan: currentPlanForNote } }));
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      alert("저장에 실패했습니다.");
    } finally {
      setNoteSaving(false);
    }
  };

  const deletePlanFromNote = async (week: number) => {
    const token = await getToken();
    if (!token) return;
    const currentText = allNotes[week]?.text ?? "";
    try {
      const res = await fetch(`${API}/api/studio/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notebook_id: notebookId, week_id: week, text: currentText }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAllNotes(prev => ({ ...prev, [week]: { id: data.item_id, text: currentText } }));
    } catch {
      alert("삭제에 실패했습니다.");
    }
  };

  const handleNoteWeekChange = (w: number) => {
    setNoteWeek(w);
    setNoteText(allNotes[w]?.text ?? "");
  };

  // ── 스튜디오 생성 ──
  const handleStudioGenerate = async () => {
    if (!studioSelectedItem) return;
    const item = studioSelectedItem;
    const effectiveDocIds = studioConfig.selectedDocIds.length > 0 ? studioConfig.selectedDocIds : docs.map((d) => d.id);
    if (effectiveDocIds.length === 0) { setStudioError("소스를 선택해주세요."); return; }
    const token = await getToken();
    if (!token) { setStudioError("로그인이 필요합니다."); return; }
    setStudioGenerating(true);
    setStudioError(null);
    setStudioGeneratingLabel(item.label);
    const lengthMap: Record<string, string> = { "5문제": "short", "10문제": "medium", "15문제": "long" };
    const diffMap: Record<string, string> = { "5문제": "easy", "10문제": "intermediate", "15문제": "hard" };
    const countMap: Record<string, string> = { "5문제": "fewer", "10문제": "standard", "15문제": "more" };
    const countNumMap: Record<string, number> = { "5문제": 5, "10문제": 10, "15문제": 15 };
    try {
      let res: Response;
      if (item.id === "audio") {
        res = await fetch(`${API_STUDENT}/api/generate/audio`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: studioConfig.format || "overview", language: studioConfig.language, length: lengthMap[studioConfig.length] || "medium", focus: studioConfig.instructions, notebook_id: notebookId }) });
      } else if (item.id === "quiz") {
        const quizStyleMap: Record<string, string> = { "객관식 퀴즈": "multiple_choice", "O/X 퀴즈": "ox" };
        res = await fetch(`${API_STUDENT}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, type: "quiz", difficulty: diffMap[studioConfig.length] || "intermediate", quiz_count: countNumMap[studioConfig.length] || 10, quiz_style: quizStyleMap[studioConfig.format] || "multiple_choice", topic: studioConfig.instructions || "", notebook_id: notebookId }) });
      } else if (item.id === "mindmap") {
        res = await fetch(`${API_STUDENT}/api/generate/mindmap`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, language: studioConfig.language, focus: studioConfig.instructions || studioConfig.format, notebook_id: notebookId }) });
      } else if (item.id === "flashcard") {
        res = await fetch(`${API_STUDENT}/api/generate/flashcard`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, count: countMap[studioConfig.length] || "standard", difficulty: diffMap[studioConfig.length] || "intermediate", topic: studioConfig.format || studioConfig.instructions || "", language: studioConfig.language, notebook_id: notebookId }) });
      } else if (item.id === "slides") {
        res = await fetch(`${API_STUDENT}/api/generate/slides`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: studioConfig.format || "lecture", length: lengthMap[studioConfig.length] || "medium", language: studioConfig.language, prompt: studioConfig.instructions, notebook_id: notebookId }) });
      } else if (item.id === "report") {
        res = await fetch(`${API_STUDENT}/api/generate/report`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: studioConfig.format || "report", language: studioConfig.language, length: lengthMap[studioConfig.length] || "medium", tone: "formal", instructions: studioConfig.instructions, notebook_id: notebookId }) });
      } else if (item.id === "infographic") {
        const infographicFormatMap: Record<string, string> = { "개요형": "overview", "프로세스형": "process", "비교형": "comparison", "통계형": "statistics", "타임라인형": "timeline" };
        res = await fetch(`${API_STUDENT}/api/generate/infographic`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: infographicFormatMap[studioConfig.format] || "overview", language: studioConfig.language || "ko", instructions: studioConfig.instructions || "", notebook_id: notebookId }) });
      } else {
        const tableFormatMap: Record<string, string> = { "핵심 내용 정리표": "summary_table", "비교 분석 표": "comparison_table", "개념 정의 표": "concept_definition" };
        res = await fetch(`${API_STUDENT}/api/generate/data`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: tableFormatMap[studioConfig.format] || "summary_table", language: studioConfig.language || "ko", instructions: studioConfig.instructions || "", notebook_id: notebookId }) });
      }
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? "생성 실패"); }
      setStudioDone(true);
      onStudioItemCreated?.();
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setStudioGenerating(false);
    }
  };

  // ── 노트패드 계획 수정 시 자동 저장 ──
  const handleNotepadPlanChange = async (newPlan: StudyPlanResult, week: number, text: string) => {
    setAllNotes(prev => ({ ...prev, [week]: { ...prev[week], plan: newPlan } }));
    const token = await getToken();
    if (!token) return;
    await fetch(`${API}/api/studio/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notebook_id: notebookId, week_id: week, text, plan: newPlan }),
    }).catch(() => {});
  };

  // ── 메시지 렌더 ──
  const renderMessage = (msg: ChatMessage) => {
    if (msg.type === "text") {
      const isUser = msg.role === "user";
      const isLoading = msg.text === "__loading__";
      return (
        <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
          {!isUser && (
            <div className="shrink-0 w-7 h-7 rounded-full bg-[#155dfc] flex items-center justify-center mr-2 mt-0.5">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
          )}
          <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
            isUser ? "bg-[#155dfc] text-white rounded-tr-sm" : "bg-[#f5f6f8] text-[#2d3748] rounded-tl-sm"
          }`}>
            {isLoading ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9ca3af]" />
                <span className="text-[#9ca3af]">생각 중...</span>
              </div>
            ) : msg.text}
          </div>
        </div>
      );
    }

    if (msg.type === "quick_reply") {
      return (
        <div key={msg.id} className="mb-3">
          <div className="flex justify-start mb-2">
            <div className="shrink-0 w-7 h-7 rounded-full bg-[#155dfc] flex items-center justify-center mr-2 mt-0.5">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="max-w-[82%] px-3.5 py-2.5 bg-[#f5f6f8] text-[#2d3748] rounded-2xl rounded-tl-sm text-[13px] leading-relaxed">
              {msg.text}
            </div>
          </div>
          {!msg.answered && (
            <div className={`ml-9 ${msg.replyType === "purpose" ? "flex flex-col gap-1.5" : "flex flex-wrap gap-1.5"}`}>
              {msg.options.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    if (msg.replyType === "week") handleSelectWeek(opt.value);
                    else handleSelectPurpose(opt.value as "concept" | "exam_cram" | "cram_mode", planTargetWeek);
                  }}
                  className={`bg-white border border-[#e2e8f0] hover:border-[#155dfc] hover:bg-[#f5f8ff] transition-colors ${
                    opt.description
                      ? "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl gap-3"
                      : "px-3 py-1.5 rounded-full text-[12px] font-medium text-[#155dfc] border-[#155dfc]"
                  }`}
                >
                  {opt.description ? (
                    <>
                      <span className="text-[13px] font-semibold text-[#1a202c] shrink-0">{opt.label}</span>
                      <span className="text-[11px] text-[#9ca3af] text-right leading-snug">{opt.description}</span>
                    </>
                  ) : (
                    <div className="text-[12px] font-medium">{opt.label}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (msg.type === "plan") {
      return (
        <div key={msg.id} className="mb-3 flex justify-start">
          <div className="shrink-0 w-7 h-7 rounded-full bg-[#155dfc] flex items-center justify-center mr-2 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <EditablePlanCard
              plan={msg.plan}
              onPlanChange={newPlan => {
                setMessages(prev => prev.map(m =>
                  m.id === msg.id && m.type === "plan" ? { ...m, plan: newPlan } : m
                ));
                setCurrentPlan(newPlan);
              }}
              onOpenDoc={onOpenDoc}
              onOpenStudioItem={onOpenStudioItem}
              headerAction={
                <button
                  onClick={() => savePlanToNote(msg.week, msg.plan)}
                  disabled={planNoteSaving || planNoteSaved}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#155dfc] text-[#155dfc] text-[12px] font-medium rounded-lg hover:bg-[#eff4ff] disabled:opacity-50 transition-colors"
                >
                  {planNoteSaved ? (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> 저장됨</>
                  ) : planNoteSaving ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 저장 중...</>
                  ) : (
                    <><NotebookPen className="w-3.5 h-3.5" /> 메모장에 저장</>
                  )}
                </button>
              }
            />
          </div>
        </div>
      );
    }

    return null;
  };

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 헤더 */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-[#e7e9ed]">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setActiveTab("plan")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
              activeTab === "plan" ? "bg-[#eff4ff] text-[#155dfc]" : "text-[#6b7280] hover:bg-[#f5f6f8]"
            }`}
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            AI 학습계획
          </button>
          <button
            onClick={() => setActiveTab("notepad")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
              activeTab === "notepad" ? "bg-[#eff4ff] text-[#155dfc]" : "text-[#6b7280] hover:bg-[#f5f6f8]"
            }`}
          >
            <NotebookPen className="w-3 h-3 shrink-0" />
            메모장
          </button>
          <button
            onClick={() => {
              setActiveTab("studio");
              setStudioStep("grid");
              setStudioSelectedItem(null);
              setStudioConfig({ format: "", instructions: "", length: "10문제", language: "한국어", selectedDocIds: [] });
              setStudioError(null);
              setStudioDone(false);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
              activeTab === "studio" ? "bg-[#eff4ff] text-[#155dfc]" : "text-[#6b7280] hover:bg-[#f5f6f8]"
            }`}
          >
            <Wand2 className="w-3 h-3 shrink-0" />
            스튜디오
          </button>
        </div>
        <div className="flex items-center gap-1">
          {activeTab === "plan" && messages.length > 0 && (
            <button
              onClick={handleClearChat}
              title="대화 삭제"
              className="p-1 rounded hover:bg-[#f5f6f8] text-[#9ca3af] hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-[#f5f6f8] text-[#9ca3af] hover:text-[#6b7280]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── 스튜디오 탭 ── */}
      {activeTab === "studio" && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* 스튜디오 그리드 화면 */}
          {studioStep === "grid" && (
            <div className="p-4">
              <p className="text-[12px] text-[#9ca3af] mb-3">강사가 올린 소스를 이용해 학습 자료를 만들어보세요.</p>
              <div className="grid grid-cols-3 gap-2">
                {STUDIO_ITEMS_DEF.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setStudioSelectedItem(item);
                      setStudioConfig((c) => ({ ...c, format: item.id === "quiz" ? item.presets[0] : "", selectedDocIds: docs.map((d) => d.id) }));
                      setStudioStep("config");
                      setStudioError(null);
                      setStudioDone(false);
                    }}
                    className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border border-[#e7e9ed] hover:border-[#155dfc] hover:bg-[#f5f8ff] transition-all"
                  >
                    <span className="text-xl">{item.icon}</span>
                    <span className="text-[11px] text-[#374151] font-medium text-center leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 스튜디오 설정 화면 */}
          {studioStep === "config" && studioSelectedItem && (
            <div className="flex flex-col h-full">
              {/* 서브 헤더 */}
              <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[#e7e9ed]">
                <button onClick={() => setStudioStep("grid")} className="p-1 rounded hover:bg-[#f5f6f8] text-[#9ca3af]">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[13px] font-semibold text-[#374151]">{studioSelectedItem.icon} {studioSelectedItem.label}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 소스 선택 */}
                {docs.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-[#374151] mb-2">참고 소스 <span className="text-[#9ca3af] font-normal">(선택)</span></p>
                    <div className="space-y-1.5">
                      {docs.map((doc) => {
                        const checked = studioConfig.selectedDocIds.includes(doc.id);
                        const ext = (doc.type ?? "").toLowerCase();
                        const icon = ext === "pdf" ? "📜" : ext === "url" ? "🔗" : ["jpg","jpeg","png","gif","webp"].includes(ext) ? "🖼️" : "📄";
                        return (
                          <button key={doc.id}
                            onClick={() => setStudioConfig((c) => ({ ...c, selectedDocIds: checked ? c.selectedDocIds.filter((id) => id !== doc.id) : [...c.selectedDocIds, doc.id] }))}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                              checked ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"
                            }`}
                          >
                            <span className="text-base">{icon}</span>
                            <span className={`flex-1 truncate text-[12px] font-semibold ${checked ? "text-blue-700" : "text-gray-600"}`}>{doc.filename || doc.name}</span>
                            {checked && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 형식 선택 — 강사 모달과 동일한 스타일 */}
                <div>
                  <p className="text-[12px] font-semibold text-[#374151] mb-2">형식</p>
                  {studioSelectedItem.id !== "quiz" && (
                    <button
                      onClick={() => setStudioConfig((c) => ({ ...c, format: "" }))}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 mb-2 transition-all ${
                        studioConfig.format === "" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <span className={`text-[12px] font-semibold ${studioConfig.format === "" ? "text-blue-600" : "text-gray-600"}`}>직접 만들기</span>
                      {studioConfig.format === "" && <svg className="ml-auto" width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  )}
                  {studioSelectedItem.id !== "quiz" && <p className="text-[11px] text-gray-400 font-semibold mb-1.5">추천 형식</p>}
                  <div className="grid grid-cols-2 gap-1.5">
                    {studioSelectedItem.presets.map((preset) => (
                      <button key={preset}
                        onClick={() => setStudioConfig((c) => ({ ...c, format: preset }))}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-left transition-all ${
                          studioConfig.format === preset ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"
                        }`}
                      >
                        <span className="text-sm">{studioSelectedItem.icon}</span>
                        <span className={`text-[11px] leading-tight ${studioConfig.format === preset ? "text-blue-600 font-medium" : "text-gray-600"}`}>{preset}</span>
                        {studioConfig.format === preset && <svg className="ml-auto shrink-0" width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 추가 지시사항 */}
                <div>
                  <p className="text-[12px] font-semibold text-[#374151] mb-1.5">추가 지시사항 <span className="text-[#9ca3af] font-normal">(선택)</span></p>
                  <textarea
                    value={studioConfig.instructions}
                    onChange={(e) => setStudioConfig((c) => ({ ...c, instructions: e.target.value }))}
                    placeholder="예) 초등학생도 이해할 수 있도록 쉽게 작성해주세요..."
                    rows={2}
                    className="w-full text-[12px] border-2 border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-blue-300 text-gray-700 placeholder-gray-300 bg-gray-50 focus:bg-white transition-all"
                  />
                </div>

                {/* 문제 수 (quiz/flashcard) */}
                {["quiz", "flashcard"].includes(studioSelectedItem.id) && (
                  <div>
                    <p className="text-[12px] font-semibold text-[#374151] mb-2">문제 수</p>
                    <div className="flex gap-2">
                      {["5문제", "10문제", "15문제"].map((len) => (
                        <button key={len}
                          onClick={() => setStudioConfig((c) => ({ ...c, length: len }))}
                          className={`flex-1 py-2 rounded-xl border-2 text-[12px] transition-all ${
                            studioConfig.length === len ? "border-blue-400 bg-blue-50 text-blue-600 font-bold" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                          }`}
                        >{len}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 오류 */}
                {studioError && (
                  <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">{studioError}</p>
                )}

                {/* 완료 */}
                {studioDone && (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    <p className="text-[13px] font-semibold text-[#374151]">{studioGeneratingLabel} 생성 완료!</p>
                    <p className="text-[11px] text-[#9ca3af] text-center">좌측 스튜디오 목록에서 확인할 수 있어요.</p>
                    <button
                      onClick={() => { setStudioStep("grid"); setStudioDone(false); }}
                      className="mt-1 px-4 py-2 bg-[#155dfc] text-white rounded-xl text-[12px] font-semibold hover:bg-[#1249cc] transition-colors"
                    >다른 자료 만들기</button>
                  </div>
                )}
              </div>

              {/* 생성 버튼 */}
              {!studioDone && (
                <div className="shrink-0 p-4 border-t border-[#e7e9ed]">
                  <button
                    onClick={handleStudioGenerate}
                    disabled={studioGenerating}
                    className="w-full py-2.5 bg-[#155dfc] text-white rounded-xl text-[13px] font-semibold hover:bg-[#1249cc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {studioGenerating ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />{studioGeneratingLabel} 생성 중...</>
                    ) : (
                      <><Wand2 className="w-4 h-4" />만들기</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AI 학습계획 탭 (챗) ── */}
      {activeTab === "plan" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.map(renderMessage)}
            {chatStep === "done" && (
              <div className="flex justify-center mt-1 mb-2">
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 text-[12px] text-[#6b7280] border border-[#e7e9ed] px-3 py-1.5 rounded-full hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-[#f5f8ff] transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  새 학습계획 만들기
                </button>
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>

          {chatStep === "done" && (
            <div className="shrink-0 border-t border-[#e7e9ed]">
              {/* 예시 질문 칩 */}
              <div className="flex gap-1.5 px-3 pt-2 pb-0.5">
                {["너무 많아, 줄여줘", "개념은 다 알아", "시험이 3일 남았어"].map(chip => (
                  <button
                    key={chip}
                    onClick={() => setInputText(chip)}
                    disabled={inputLoading}
                    className="px-2.5 py-0.5 text-[10px] text-[#6b7280] bg-[#f5f6f8] hover:bg-[#eff4ff] hover:text-[#155dfc] rounded-full transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              {/* 입력창 */}
              <div className="px-3 py-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder="질문하거나 상황을 말해보세요..."
                  disabled={inputLoading}
                  className="flex-1 px-3 py-2 text-[13px] border border-[#e7e9ed] rounded-xl outline-none focus:border-[#155dfc] focus:ring-1 focus:ring-[#155dfc] placeholder:text-[#d1d5db] disabled:bg-[#f5f6f8]"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={inputLoading || !inputText.trim()}
                  className="shrink-0 w-9 h-9 flex items-center justify-center bg-[#155dfc] text-white rounded-xl hover:bg-[#0d4ac4] disabled:opacity-50 transition-colors"
                >
                  {inputLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 메모장 탭 ── */}
      {activeTab === "notepad" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 pt-3 pb-2 border-b border-[#f0f1f3]">
            {availableWeeks.length === 0 ? (
              <p className="text-[12px] text-[#9ca3af]">공개된 주차가 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableWeeks.map(w => (
                  <button
                    key={w}
                    onClick={() => handleNoteWeekChange(w)}
                    className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition-colors ${
                      noteWeek === w
                        ? "bg-[#155dfc] border-[#155dfc] text-white"
                        : "bg-white border-[#d1d5db] text-[#374151] hover:border-[#155dfc] hover:text-[#155dfc]"
                    }`}
                  >
                    {w}주차
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {noteLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[#9ca3af]" />
              </div>
            ) : noteWeek !== null ? (
              <>
                {allNotes[noteWeek]?.plan && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <NotebookPen className="w-3.5 h-3.5 text-[#155dfc]" />
                        <span className="text-[12px] font-semibold text-[#155dfc]">저장된 학습계획</span>
                      </div>
                      <button
                        onClick={() => deletePlanFromNote(noteWeek)}
                        className="p-0.5 rounded hover:bg-red-50 text-[#9ca3af] hover:text-red-400 transition-colors"
                        title="계획 삭제"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <EditablePlanCard
                      plan={allNotes[noteWeek].plan!}
                      onPlanChange={newPlan => handleNotepadPlanChange(newPlan, noteWeek, noteText)}
                      onOpenDoc={onOpenDoc}
                      onOpenStudioItem={onOpenStudioItem}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#9ca3af]" />
                    <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wide">자유 메모</span>
                  </div>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder={`${noteWeek}주차 메모를 작성하세요...`}
                    className="w-full min-h-[140px] px-3 py-2.5 text-[13px] text-[#2d3748] border border-[#e7e9ed] rounded-xl resize-none outline-none focus:border-[#155dfc] focus:ring-1 focus:ring-[#155dfc] placeholder:text-[#d1d5db] leading-relaxed"
                  />
                  <button
                    onClick={saveNote}
                    disabled={noteSaving || noteSaved}
                    className="self-end flex items-center gap-1.5 px-4 py-2 bg-[#155dfc] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0d4ac4] disabled:opacity-50 transition-colors"
                  >
                    {noteSaved ? (
                      <><CheckCircle2 className="w-3.5 h-3.5" /> 저장됨</>
                    ) : noteSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 저장 중...</>
                    ) : "저장하기"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-[#9ca3af] text-center py-8">주차를 선택하세요.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
