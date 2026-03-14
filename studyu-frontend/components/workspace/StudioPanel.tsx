"use client";

import { useState } from "react";
import type { Doc } from "./SourcePanel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────
interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
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
}

interface SavedItem {
  id: string;
  type: "summary" | "quiz";
  title: string;
  subtitle: string;
  createdAt: Date;
  summaryContent?: string;
  quiz?: SavedQuiz;
}

interface Props {
  activeDocIds: string[];
  docs: Doc[];
  getToken: () => Promise<string>;
}

const COUNT_MAP: Record<string, number> = { fewer: 3, standard: 5, more: 10 };
const OPTION_ALPHA = ["A", "B", "C", "D"];

// ── Content type definitions ───────────────────────────────────────────────
const CONTENT_TYPES = [
  {
    id: "audio",
    label: "AI 오디오 오버뷰",
    cardBg: "#d0f5f1",
    iconBg: "#a1ece4",
    iconColor: "#0d9488",
  },
  {
    id: "slides",
    label: "슬라이드 자료",
    cardBg: "#fef0da",
    iconBg: "#fdd89a",
    iconColor: "#d97706",
  },
  {
    id: "video",
    label: "동영상 개요",
    cardBg: "#dcf5dc",
    iconBg: "#a8e8a8",
    iconColor: "#15803d",
  },
  {
    id: "mindmap",
    label: "마인드맵",
    cardBg: "#f0e6ff",
    iconBg: "#d8b4fe",
    iconColor: "#7c3aed",
  },
  {
    id: "report",
    label: "보고서",
    cardBg: "#dcf2e8",
    iconBg: "#a3e8c4",
    iconColor: "#166534",
  },
  {
    id: "flashcard",
    label: "플래시카드",
    cardBg: "#fde0ea",
    iconBg: "#f9a8c0",
    iconColor: "#be123c",
  },
  {
    id: "quiz",
    label: "퀴즈",
    cardBg: "#dbeafe",
    iconBg: "#bfdbfe",
    iconColor: "#1d4ed8",
  },
  {
    id: "infographic",
    label: "인포그래픽",
    cardBg: "#ede8ff",
    iconBg: "#c4b5fd",
    iconColor: "#6d28d9",
  },
  {
    id: "table",
    label: "데이터 표",
    cardBg: "#f1f3f4",
    iconBg: "#dadce0",
    iconColor: "#3c4043",
  },
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
  if (id === "video") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>;
  if (id === "mindmap") return <svg {...s}><circle cx="12" cy="12" r="2.5" fill={color} stroke="none" /><circle cx="5" cy="5" r="1.5" fill={color} stroke="none" /><circle cx="19" cy="5" r="1.5" fill={color} stroke="none" /><circle cx="5" cy="19" r="1.5" fill={color} stroke="none" /><circle cx="19" cy="19" r="1.5" fill={color} stroke="none" /><path strokeLinecap="round" d="M10.5 10.5L6.5 6.5M13.5 10.5L17.5 6.5M10.5 13.5L6.5 17.5M13.5 13.5L17.5 17.5" /></svg>;
  if (id === "report") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
  if (id === "flashcard") return <svg {...s}><rect x="2" y="6" width="20" height="13" rx="2" stroke={color} fill="none" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2l-2 4M12 2v4M8 2l2 4" /></svg>;
  if (id === "quiz") return <svg {...s}><circle cx="12" cy="12" r="10" stroke={color} fill="none" /><path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" /></svg>;
  if (id === "infographic") return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
  return <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" /></svg>;
}

// ── QuizModal ──────────────────────────────────────────────────────────────
function QuizModal({
  loading,
  onClose,
  onGenerate,
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: QuizConfig) => void;
}) {
  const [cfg, setCfg] = useState<QuizConfig>({
    count: "standard",
    difficulty: "intermediate",
    topic: "",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <span className="font-semibold text-gray-800">퀴즈 맞춤설정</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2.5">질문 수</p>
            <div className="flex gap-2">
              {(["fewer", "standard", "more"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCfg((p) => ({ ...p, count: c }))}
                  className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                  style={
                    cfg.count === c
                      ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" }
                      : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }
                  }
                >
                  {c === "fewer" ? "더 적게" : c === "standard" ? "표준(기본값)" : "더 많이"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2.5">난이도</p>
            <div className="flex gap-2">
              {(["easy", "intermediate", "hard"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setCfg((p) => ({ ...p, difficulty: d }))}
                  className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                  style={
                    cfg.difficulty === d
                      ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" }
                      : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }
                  }
                >
                  {d === "easy" ? "쉬움" : d === "intermediate" ? "중간(기본값)" : "어려움"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">주제 (선택)</p>
            <textarea
              value={cfg.topic}
              onChange={(e) => setCfg((p) => ({ ...p, topic: e.target.value }))}
              placeholder={"예시:\n• 핵심 개념만 포함해줘\n• 시험 대비용 퀴즈 만들어줘"}
              rows={3}
              className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-blue-400 text-gray-800"
              style={{ lineHeight: 1.6 }}
            />
          </div>
        </div>
        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={() => onGenerate(cfg)}
            disabled={loading}
            className="px-8 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all bg-blue-600 text-white"
            style={{ opacity: loading ? 0.75 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading && <Spinner className="w-3.5 h-3.5" />}
            {loading ? "생성 중..." : "만들기"}
          </button>
        </div>
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

  const total = quiz.questions.length;
  const q = quiz.questions[idx];

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
        {answered && (
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

// ── Main StudioPanel ───────────────────────────────────────────────────────
export default function StudioPanel({ activeDocIds, docs, getToken }: Props) {
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const hasDoc = activeDocIds.length > 0;

  async function handleSummary() {
    if (!hasDoc) return;
    setLoadingType("report");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doc_ids: activeDocIds, type: "summary" }),
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

  async function handleQuizGenerate(cfg: QuizConfig) {
    setLoadingType("quiz");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          type: "quiz",
          quiz_count: COUNT_MAP[cfg.count],
          difficulty: cfg.difficulty,
          topic: cfg.topic,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      let questions: QuizQuestion[] = [];
      const raw = data.result as string;
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) questions = JSON.parse(match[0]);
      const quiz: SavedQuiz = {
        id: Date.now().toString(),
        title: "퀴즈",
        questions,
        createdAt: new Date(),
        difficulty: cfg.difficulty,
      };
      const newItem: SavedItem = {
        id: Date.now().toString(),
        type: "quiz",
        title: "퀴즈",
        subtitle: `퀴즈 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        quiz,
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveQuiz(quiz);
      setShowQuizModal(false);
    } catch (e: unknown) {
      alert(`퀴즈 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  function handleCardClick(typeId: string) {
    if (!hasDoc) { alert("소스를 먼저 선택해주세요."); return; }
    if (typeId === "report") handleSummary();
    else if (typeId === "quiz") setShowQuizModal(true);
    else alert("곧 지원 예정인 기능입니다 ✨");
  }

  if (activeQuiz) return <QuizView quiz={activeQuiz} onBack={() => setActiveQuiz(null)} />;
  if (summaryContent) return <SummaryView content={summaryContent} onBack={() => setSummaryContent(null)} />;

  return (
    <aside className="flex flex-col w-full h-full bg-[#f8f9fa] overflow-hidden">
      {showQuizModal && (
        <QuizModal loading={loadingType === "quiz"} onClose={() => setShowQuizModal(false)} onGenerate={handleQuizGenerate} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-[15px] font-semibold text-[#1f2937]">스튜디오</span>
        <button className="p-1.5 rounded-lg hover:bg-black/5 text-[#5f6368] transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="5" height="18" rx="1" />
            <rect x="10" y="3" width="11" height="18" rx="1" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Content type grid */}
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => handleCardClick(ct.id)}
              disabled={loadingType !== null}
              className="relative rounded-xl p-2 text-left transition-all hover:brightness-[0.96] active:scale-[0.98]"
              style={{ background: ct.cardBg }}
            >
              {/* Pencil icon — top right */}
              <span className="absolute top-2 right-2 opacity-70 hover:opacity-100 transition-opacity" style={{ color: ct.iconColor }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </span>
              {/* Type icon */}
              <div className="w-6 h-6 rounded-lg flex items-center justify-center mb-1.5" style={{ background: ct.iconBg }}>
                {loadingType === ct.id ? <Spinner className="w-3 h-3" /> : <TypeIcon id={ct.id} color={ct.iconColor} size={12} />}
              </div>
              {/* Label */}
              <span className="text-[10px] font-medium text-[#3c4043] leading-tight">{ct.label}</span>
            </button>
          ))}
        </div>

        {/* Saved items list */}
        {savedItems.length > 0 && (
          <div className="px-2 pb-2">
            {savedItems.map((item) => (
              <div key={item.id} className="relative flex items-center gap-2.5 px-2 py-2.5 rounded-xl hover:bg-black/5 transition-colors">
                {/* Type icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: item.type === "quiz" ? "#dbeafe" : "#dcf2e8", color: item.type === "quiz" ? "#1d4ed8" : "#166534" }}>
                  {item.type === "quiz" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  )}
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#202124] truncate">{item.title}</p>
                  <p className="text-[11px] text-[#80868b] mt-0.5">{item.subtitle} · {timeAgo(item.createdAt)}</p>
                </div>
                {/* Play button */}
                <button
                  onClick={() => {
                    if (item.type === "quiz" && item.quiz) setActiveQuiz(item.quiz);
                    else if (item.summaryContent) setSummaryContent(item.summaryContent);
                  }}
                  className="w-7 h-7 rounded-full bg-[#1a73e8] flex items-center justify-center shrink-0 hover:bg-[#1557b0] transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                {/* Three-dots menu */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === item.id ? null : item.id); }}
                    className="p-1 rounded-lg hover:bg-black/10 text-[#80868b] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                  {openMenuId === item.id && (
                    <div className="absolute right-0 top-7 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1 w-20">
                      <button
                        onClick={() => { setSavedItems((prev) => prev.filter((i) => i.id !== item.id)); setOpenMenuId(null); }}
                        className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left"
                      >삭제</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 메모 추가 button */}
      <div className="px-4 py-3 shrink-0 flex justify-center">
        <button className="flex items-center gap-2 px-6 py-2.5 bg-[#1f2937] text-white text-sm font-medium rounded-full hover:bg-[#374151] transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          메모 추가
        </button>
      </div>
    </aside>
  );
}
