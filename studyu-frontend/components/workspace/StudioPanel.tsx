"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { Doc } from "./SourcePanel";

const MindMapView = dynamic(() => import("./MindMapView"), { ssr: false });

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

interface AudioConfig {
  format: "deep_analysis" | "summary" | "critique" | "debate";
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

interface SavedItem {
  id: string;
  type: "summary" | "quiz" | "audio" | "mindmap" | "flashcard" | "slides" | "report";
  title: string;
  subtitle: string;
  createdAt: Date;
  summaryContent?: string;
  quiz?: SavedQuiz;
  audio?: { base64?: string; script: string };
  audioUrl?: string;  // Supabase Storage 서명 URL (DB 로드 시)
  mindmap?: { nodes: MindmapNode[] };
  flashcard?: { cards: FlashCard[]; difficulty: string };
  slides?: { slides: Slide[]; format: string; cover_image_b64?: string };
  report?: { sections: ReportSection[]; format: string };
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

// ── AudioModal ─────────────────────────────────────────────────────────────
function AudioModal({
  loading,
  onClose,
  onGenerate,
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: AudioConfig) => void;
}) {
  const [cfg, setCfg] = useState<AudioConfig>({
    format: "deep_analysis",
    language: "ko",
    length: "default",
    focus: "",
  });

  const formats: { id: AudioConfig["format"]; label: string; desc: string }[] = [
    { id: "deep_analysis", label: "심층 분석", desc: "핵심 개념을 깊이 파헤치는 대화" },
    { id: "summary", label: "요약", desc: "핵심 아이디어를 간결하게 정리" },
    { id: "critique", label: "비평", desc: "장단점을 전문가 시각으로 분석" },
    { id: "debate", label: "토론", desc: "다른 관점으로 주제를 논쟁" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <span className="font-semibold text-gray-800">AI 오디오 오버뷰 맞춤설정</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* Format */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2.5">형식</p>
            <div className="grid grid-cols-2 gap-2">
              {formats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setCfg((p) => ({ ...p, format: f.id }))}
                  className="flex flex-col items-start px-3 py-2.5 rounded-xl text-left border transition-all"
                  style={
                    cfg.format === f.id
                      ? { background: "#e8f0fe", borderColor: "#1a73e8" }
                      : { background: "white", borderColor: "#e0e0e0" }
                  }
                >
                  <span className="text-sm font-medium" style={{ color: cfg.format === f.id ? "#1a73e8" : "#202124" }}>{f.label}</span>
                  <span className="text-[11px] text-gray-400 mt-0.5 leading-tight">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Language */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
            <select
              value={cfg.language}
              onChange={(e) => setCfg((p) => ({ ...p, language: e.target.value as AudioConfig["language"] }))}
              className="w-full text-sm rounded-xl px-4 py-2.5 border border-gray-200 outline-none focus:border-blue-400 text-gray-800 bg-white"
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </div>
          {/* Length */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2.5">길이</p>
            <div className="flex gap-2">
              {(["short", "default"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setCfg((p) => ({ ...p, length: l }))}
                  className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                  style={
                    cfg.length === l
                      ? { background: "#e8f0fe", color: "#1a73e8", borderColor: "#1a73e8" }
                      : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }
                  }
                >
                  {l === "short" ? "짧게" : "기본값"}
                </button>
              ))}
            </div>
          </div>
          {/* Focus */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">AI 호스트가 이 에피소드의 어떤 부분에 집중해야 하나요?</p>
            <textarea
              value={cfg.focus}
              onChange={(e) => setCfg((p) => ({ ...p, focus: e.target.value }))}
              placeholder={"예시:\n• 2장의 핵심 이론에 집중해줘\n• 실생활 적용 사례 위주로 얘기해줘"}
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

// ── MindmapModal ───────────────────────────────────────────────────────────
function MindmapModal({
  loading,
  onClose,
  onGenerate,
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: MindmapConfig) => void;
}) {
  const [cfg, setCfg] = useState<MindmapConfig>({ language: "ko", focus: "" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <span className="font-semibold text-gray-800">마인드맵 맞춤설정</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
            <select
              value={cfg.language}
              onChange={(e) => setCfg((p) => ({ ...p, language: e.target.value as MindmapConfig["language"] }))}
              className="w-full text-sm rounded-xl px-4 py-2.5 border border-gray-200 outline-none focus:border-purple-400 text-gray-800 bg-white"
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">집중할 주제 (선택)</p>
            <textarea
              value={cfg.focus}
              onChange={(e) => setCfg((p) => ({ ...p, focus: e.target.value }))}
              placeholder={"예시:\n• 2장의 핵심 개념만 포함해줘\n• 실생활 응용 사례 위주로 정리해줘"}
              rows={3}
              className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-purple-400 text-gray-800"
              style={{ lineHeight: 1.6 }}
            />
          </div>
        </div>
        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={() => onGenerate(cfg)}
            disabled={loading}
            className="px-8 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all bg-purple-600 text-white"
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

// ── SlideModal ─────────────────────────────────────────────────────────────
function SlideModal({
  loading,
  onClose,
  onGenerate,
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: SlideConfig) => void;
}) {
  const [cfg, setCfg] = useState<SlideConfig>({
    format: "presenter",
    length: "default",
    language: "ko",
    prompt: "",
  });
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-800">슬라이드 자료 만들기</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* 형식 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">형식</p>
            <div className="flex gap-2">
              {(["presenter", "detailed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setCfg((p) => ({ ...p, format: f }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.format === f ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {f === "presenter" ? "발표자 슬라이드" : "자세한 자료"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {cfg.format === "presenter" ? "핵심 키워드 위주의 깔끔한 발표용 슬라이드" : "전체 텍스트와 세부정보가 담긴 자료형 슬라이드"}
            </p>
          </div>
          {/* 길이 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">길이</p>
            <div className="flex gap-2">
              {(["short", "default", "long"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setCfg((p) => ({ ...p, length: l }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.length === l ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {l === "short" ? "짧게" : l === "default" ? "기본" : "길게"}
                </button>
              ))}
            </div>
          </div>
          {/* 언어 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
            <div className="flex gap-2">
              {(["ko", "en", "ja", "zh"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setCfg((p) => ({ ...p, language: lang }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.language === lang ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {lang === "ko" ? "한국어" : lang === "en" ? "English" : lang === "ja" ? "日本語" : "中文"}
                </button>
              ))}
            </div>
          </div>
          {/* 커스텀 프롬프트 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">추가 지시사항 (선택)</p>
            <textarea
              value={cfg.prompt}
              onChange={(e) => setCfg((p) => ({ ...p, prompt: e.target.value }))}
              placeholder={"예:\n• 초보자를 위한 단계별 안내식으로 만들어줘\n• 논문 발표용으로 학술적인 톤으로"}
              rows={3}
              className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-amber-400 text-gray-800"
              style={{ lineHeight: 1.6 }}
            />
          </div>
        </div>
        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={() => onGenerate(cfg)}
            disabled={loading}
            className="px-8 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all"
            style={{ background: "#d97706", color: "white", opacity: loading ? 0.75 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading && <Spinner />}
            {loading ? "생성 중..." : "만들기"}
          </button>
        </div>
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
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: FlashcardConfig) => void;
}) {
  const [cfg, setCfg] = useState<FlashcardConfig>({
    count: "standard",
    difficulty: "intermediate",
    topic: "",
    language: "ko",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl shadow-2xl bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#f9a8c0" }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#be123c" strokeWidth="1.5">
                <rect x="2" y="6" width="20" height="13" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2l-2 4M12 2v4M8 2l2 4" />
              </svg>
            </div>
            <span className="font-semibold text-gray-800">플래시카드 맞춤설정</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* 카드 수 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2.5">카드 수</p>
            <div className="flex gap-2">
              {(["fewer", "standard", "more"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCfg((p) => ({ ...p, count: c }))}
                  className="flex-1 py-2 rounded-full text-sm font-medium border transition-all"
                  style={
                    cfg.count === c
                      ? { background: "#fde0ea", color: "#be123c", borderColor: "#f9a8c0" }
                      : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }
                  }
                >
                  {c === "fewer" ? "간략히 보기" : c === "standard" ? "표준(기본)" : "더보기"}
                </button>
              ))}
            </div>
          </div>
          {/* 난이도 */}
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
                      ? { background: "#fde0ea", color: "#be123c", borderColor: "#f9a8c0" }
                      : { background: "white", color: "#5f6368", borderColor: "#e0e0e0" }
                  }
                >
                  {d === "easy" ? "쉬움" : d === "intermediate" ? "보통(기본)" : "어려움"}
                </button>
              ))}
            </div>
          </div>
          {/* 주제 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">주제는 무엇인가요?</p>
            <textarea
              value={cfg.topic}
              onChange={(e) => setCfg((p) => ({ ...p, topic: e.target.value }))}
              placeholder={"다음과 같이 시도해 보세요.\n  • 플래시카드는 특정 소스로 제한해 줘 (예: '이탈리아에 대한 기사만')\n  • 플래시카드는 특정 주제 위주로 해 줘 (예: '뉴턴의 제2법칙')\n  • 기억하기 쉽도록 카드 앞면은 짧게 작성해 줘 (영문 기준 1~3단어)"}
              rows={5}
              className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 border-pink-300 text-gray-800"
              style={{ lineHeight: 1.6 }}
            />
          </div>
        </div>
        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={() => onGenerate(cfg)}
            disabled={loading}
            className="px-8 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all"
            style={{ background: "#be123c", color: "white", opacity: loading ? 0.75 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading && <Spinner className="w-3.5 h-3.5" />}
            {loading ? "생성 중..." : "만들기"}
          </button>
        </div>
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
          onKeyDown={(e) => {
            if (e.key === " ") { e.preventDefault(); setFlipped((v) => !v); }
            if (e.key === "ArrowRight") handleKnow(true);
            if (e.key === "ArrowLeft") handleKnow(false);
          }}
          tabIndex={0}
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
}: {
  loading: boolean;
  onClose: () => void;
  onGenerate: (cfg: ReportConfig) => void;
}) {
  const [cfg, setCfg] = useState<ReportConfig>({
    format: "briefing",
    language: "ko",
    length: "default",
    tone: "formal",
    instructions: "",
  });

  const formats: { id: ReportConfig["format"]; label: string; desc: string; recommended?: boolean }[] = [
    { id: "custom", label: "직접 만들기", desc: "구조, 스타일, 어조 등을 지정하여 원하는 방식으로 보고서를 작성하세요." },
    { id: "briefing", label: "브리핑 문서", desc: "주요 인사이트와 인용문을 포함한 소스 개요" },
    { id: "study_guide", label: "학습 가이드", desc: "단답형 퀴즈, 추천 에세이 질문, 핵심 용어집", recommended: true },
    { id: "blog", label: "블로그 게시물", desc: "읽기 쉬운 기사 형식으로 요약된 유용한 정보", recommended: true },
    { id: "prd", label: "제품 요구사항 정의서", desc: "STUDY U 서비스의 핵심 기능 요구사항과 기술적 제약을 상세히 정의하여 개발 방향을 제시하는 문서", recommended: true },
    { id: "architecture", label: "시스템 아키텍처 설계서", desc: "Next.js, FastAPI, RAG 기술 스택을 활용한 서비스의 데이터 흐름과 시스템 구조를 설계하는 문서", recommended: true },
    { id: "tech_explainer", label: "기술 개념 설명서", desc: "AI가 사용자의 문서를 이해하고 답변을 생성하는 핵심 원리인 RAG 시스템을 쉽게 설명합니다.", recommended: true },
    { id: "learning_guide", label: "학습 활용 가이드", desc: "STUDY U의 주요 기능을 활용하여 자기주도 학습 효율을 높이는 방법을 안내하는 입문용 자료입니다.", recommended: true },
  ];

  const recommendedFormats = formats.filter((f) => f.recommended);
  const isCustom = cfg.format === "custom";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#a3e8c4" }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#166534" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-gray-800">보고서 생성</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
          {/* 형식 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">형식</p>
            {/* 직접 만들기 */}
            <button
              onClick={() => setCfg((p) => ({ ...p, format: "custom" }))}
              className="w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left mb-3 transition-all"
              style={cfg.format === "custom" ? { background: "#f0fdf4", borderColor: "#166534" } : { background: "white", borderColor: "#e5e7eb" }}
            >
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={cfg.format === "custom" ? "#166534" : "#9ca3af"} strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
              <div>
                <p className="text-sm font-semibold" style={{ color: cfg.format === "custom" ? "#166534" : "#374151" }}>직접 만들기</p>
                <p className="text-xs text-gray-400 mt-0.5">구조, 스타일, 어조 등을 지정하여 원하는 방식으로 보고서를 작성하세요.</p>
              </div>
            </button>

            {/* 추천 형식 */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              추천 형식
            </p>
            <div className="grid grid-cols-2 gap-2">
              {recommendedFormats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setCfg((p) => ({ ...p, format: f.id }))}
                  className="flex flex-col items-start px-3 py-2.5 rounded-xl border-2 text-left transition-all"
                  style={cfg.format === f.id ? { background: "#f0fdf4", borderColor: "#166534" } : { background: "white", borderColor: "#e5e7eb" }}
                >
                  <span className="text-sm font-medium leading-tight" style={{ color: cfg.format === f.id ? "#166534" : "#374151" }}>{f.label}</span>
                  <span className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 커스텀 지시사항 (직접 만들기 선택 시 or 추가 설명) */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              {isCustom ? "원하는 형식을 직접 설명해주세요" : "추가 지시사항 (선택)"}
            </p>
            <textarea
              value={cfg.instructions}
              onChange={(e) => setCfg((p) => ({ ...p, instructions: e.target.value }))}
              placeholder={isCustom
                ? "예시:\n• 서론, 본론 3개 섹션, 결론 구조로 만들어줘\n• SWOT 분석 형식으로 작성해줘\n• 경영진을 위한 1페이지 보고서로 만들어줘"
                : "예시:\n• 2장의 핵심 내용에 집중해줘\n• 예시와 비유를 많이 포함해줘"}
              rows={isCustom ? 4 : 3}
              className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none border-2 text-gray-800 transition-colors"
              style={{ lineHeight: 1.6, borderColor: "#86efac" }}
            />
          </div>

          {/* 길이 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">길이</p>
            <div className="flex gap-2">
              {(["short", "default", "long"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setCfg((p) => ({ ...p, length: l }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.length === l ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {l === "short" ? "간결하게" : l === "default" ? "기본값" : "상세하게"}
                </button>
              ))}
            </div>
          </div>

          {/* 언어 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">언어</p>
            <div className="flex gap-2">
              {(["ko", "en", "ja", "zh"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setCfg((p) => ({ ...p, language: lang }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.language === lang ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {lang === "ko" ? "한국어" : lang === "en" ? "English" : lang === "ja" ? "日本語" : "中文"}
                </button>
              ))}
            </div>
          </div>

          {/* 문체 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">문체</p>
            <div className="flex gap-2">
              {(["formal", "casual", "academic"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setCfg((p) => ({ ...p, tone: t }))}
                  className="flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all"
                  style={cfg.tone === t ? { background: "#f0fdf4", color: "#166534", borderColor: "#166534" } : { background: "white", color: "#6b7280", borderColor: "#e5e7eb" }}
                >
                  {t === "formal" ? "격식체" : t === "casual" ? "구어체" : "학술체"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            onClick={() => onGenerate(cfg)}
            disabled={loading || (isCustom && !cfg.instructions.trim())}
            className="px-8 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all text-white"
            style={{ background: "#166534", opacity: (loading || (isCustom && !cfg.instructions.trim())) ? 0.6 : 1, cursor: (loading || (isCustom && !cfg.instructions.trim())) ? "not-allowed" : "pointer" }}
          >
            {loading && <Spinner className="w-3.5 h-3.5" />}
            {loading ? "생성 중..." : "만들기"}
          </button>
        </div>
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
export default function StudioPanel({ activeDocIds, docs, getToken }: Props) {  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showMindmapModal, setShowMindmapModal] = useState(false);
  const [showFlashcardModal, setShowFlashcardModal] = useState(false);
  const [showSlideModal, setShowSlideModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [activeAudio, setActiveAudio] = useState<{ base64?: string; audioUrl?: string; script: string; title: string } | null>(null);
  const [activeMindmap, setActiveMindmap] = useState<{ nodes: MindmapNode[]; title: string } | null>(null);
  const [activeFlashcard, setActiveFlashcard] = useState<{ cards: FlashCard[]; title: string } | null>(null);
  const [activeSlides, setActiveSlides] = useState<{ slides: Slide[]; title: string; cover_image_b64?: string } | null>(null);
  const [activeReport, setActiveReport] = useState<{ sections: ReportSection[]; title: string; format: string } | null>(null);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const hasDoc = activeDocIds.length > 0;

  // DB에서 저장된 아이템 불러오기
  useEffect(() => {
    async function loadItems() {
      try {
        const token = await getToken();
        const res = await fetch(`${API}/api/studio`, {
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
        }));
        setSavedItems(loaded);
      } catch { /* 로드 실패 시 빈 목록 유지 */ }
    }
    loadItems();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeleteItem(itemId: string) {
    setSavedItems((prev) => prev.filter((i) => i.id !== itemId));
    setOpenMenuId(null);
    try {
      const token = await getToken();
      await fetch(`${API}/api/studio/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* 삭제 실패 무시 */ }
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
          item_title: docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ") || "퀴즈",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");

      // data.result는 백엔드에서 파싱된 객체: { title, questions: [{id, question, options, answerIndex, hint, explanation}] }
      const quizData = data.result as {
        title: string;
        questions: {
          id: number;
          question: string;
          options: string[];
          answerIndex: number;
          hint: string;
          explanation: string;
        }[];
      };

      const questions: QuizQuestion[] = quizData.questions.map((q) => ({
        question: q.question,
        options: q.options,
        answer: q.answerIndex,
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

  async function handleAudioGenerate(cfg: AudioConfig) {
    setLoadingType("audio");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          format: cfg.format,
          language: cfg.language,
          length: cfg.length,
          focus: cfg.focus,
          item_title: docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ") || "오디오 오버뷰",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const docNames = docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ");
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "audio",
        title: data.title || docNames || "오디오 오버뷰",
        subtitle: `오디오 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        audio: { base64: data.audio_base64, script: data.script },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveAudio({ base64: data.audio_base64, script: data.script, title: data.title || "오디오 오버뷰" });
      setShowAudioModal(false);
    } catch (e: unknown) {
      alert(`오디오 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleMindmapGenerate(cfg: MindmapConfig) {
    setLoadingType("mindmap");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/mindmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          language: cfg.language,
          focus: cfg.focus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");

      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "mindmap",
        title: data.title || "마인드맵",
        subtitle: `마인드맵 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        mindmap: { nodes: data.nodes || [] },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveMindmap({ nodes: data.nodes || [], title: data.title || "마인드맵" });
      setShowMindmapModal(false);
    } catch (e: unknown) {
      alert(`마인드맵 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleFlashcardGenerate(cfg: FlashcardConfig) {
    setLoadingType("flashcard");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/flashcard`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          count: cfg.count,
          difficulty: cfg.difficulty,
          topic: cfg.topic,
          language: cfg.language,
          item_title: docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ") || "플래시카드",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "flashcard",
        title: data.title || "플래시카드",
        subtitle: `플래시카드 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        flashcard: { cards: data.cards || [], difficulty: cfg.difficulty },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveFlashcard({ cards: data.cards || [], title: data.title || "플래시카드" });
      setShowFlashcardModal(false);
    } catch (e: unknown) {
      alert(`플래시카드 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleSlideGenerate(cfg: SlideConfig) {
    setLoadingType("slides");
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/generate/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          format: cfg.format,
          length: cfg.length,
          language: cfg.language,
          prompt: cfg.prompt,
          item_title: docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ") || "슬라이드 자료",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "slides",
        title: data.title || "슬라이드 자료",
        subtitle: `슬라이드 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        slides: { slides: data.slides || [], format: cfg.format, cover_image_b64: data.cover_image_b64 || "" },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveSlides({ slides: data.slides || [], title: data.title || "슬라이드 자료", cover_image_b64: data.cover_image_b64 || "" });
      setShowSlideModal(false);
    } catch (e: unknown) {
      alert(`슬라이드 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  async function handleReportGenerate(cfg: ReportConfig) {
    setLoadingType("report");
    try {
      const token = await getToken();
      const docNames = docs.filter((d) => activeDocIds.includes(d.id)).map((d) => d.name).join(", ");
      const res = await fetch(`${API}/api/generate/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          format: cfg.format,
          language: cfg.language,
          length: cfg.length,
          tone: cfg.tone,
          instructions: cfg.instructions,
          item_title: docNames || "보고서",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      const newItem: SavedItem = {
        id: data.item_id || Date.now().toString(),
        type: "report",
        title: data.title || docNames || "보고서",
        subtitle: `보고서 · 소스 ${activeDocIds.length}개`,
        createdAt: new Date(),
        report: { sections: data.sections || [], format: cfg.format },
      };
      setSavedItems((prev) => [newItem, ...prev]);
      setActiveReport({ sections: data.sections || [], title: data.title || "보고서", format: cfg.format });
      setShowReportModal(false);
    } catch (e: unknown) {
      alert(`보고서 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoadingType(null);
    }
  }

  function handleCardClick(typeId: string) {
    if (!hasDoc) { alert("소스를 먼저 선택해주세요."); return; }
    if (typeId === "report") setShowReportModal(true);
    else if (typeId === "quiz") setShowQuizModal(true);
    else if (typeId === "audio") setShowAudioModal(true);
    else if (typeId === "mindmap") setShowMindmapModal(true);
    else if (typeId === "flashcard") setShowFlashcardModal(true);
    else if (typeId === "slides") setShowSlideModal(true);
    else alert("곧 지원 예정인 기능입니다 ✨");
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

  const subviewContent =
    activeQuiz ? <QuizView quiz={activeQuiz} onBack={() => setActiveQuiz(null)} /> :
    summaryContent ? <SummaryView content={summaryContent} onBack={() => setSummaryContent(null)} /> :
    activeAudio ? <AudioView audioBase64={activeAudio.base64} audioUrl={activeAudio.audioUrl} script={activeAudio.script} title={activeAudio.title} onBack={() => setActiveAudio(null)} /> :
    activeMindmap ? <MindMapView nodes={activeMindmap.nodes} title={activeMindmap.title} onBack={() => setActiveMindmap(null)} /> :
    activeFlashcard ? <FlashcardView cards={activeFlashcard.cards} title={activeFlashcard.title} onBack={() => setActiveFlashcard(null)} /> :
    activeSlides ? <SlideView slides={activeSlides.slides} title={activeSlides.title} coverImageB64={activeSlides.cover_image_b64} onBack={() => setActiveSlides(null)} /> :
    activeReport ? <ReportView sections={activeReport.sections} title={activeReport.title} format={activeReport.format} onBack={() => setActiveReport(null)} /> :
    null;

  if (subviewContent) {
    const inner = (
      <div className="fixed inset-0 z-[9999] bg-white">
        {subviewContent}
        {expandToggleBtn}
      </div>
    );
    return isExpanded ? createPortal(inner, document.body) : <div className="h-full w-full relative">{subviewContent}{expandToggleBtn}</div>;
  }

  return (
    <aside className={`flex flex-col bg-[#f8f9fa] overflow-hidden ${isExpanded ? "fixed inset-0 z-50" : "w-full h-full"}`}>
      {showQuizModal && (
        <QuizModal loading={loadingType === "quiz"} onClose={() => setShowQuizModal(false)} onGenerate={handleQuizGenerate} />
      )}
      {showAudioModal && (
        <AudioModal loading={loadingType === "audio"} onClose={() => setShowAudioModal(false)} onGenerate={handleAudioGenerate} />
      )}
      {showMindmapModal && (
        <MindmapModal loading={loadingType === "mindmap"} onClose={() => setShowMindmapModal(false)} onGenerate={handleMindmapGenerate} />
      )}
      {showFlashcardModal && (
        <FlashcardModal loading={loadingType === "flashcard"} onClose={() => setShowFlashcardModal(false)} onGenerate={handleFlashcardGenerate} />
      )}
      {showSlideModal && (
        <SlideModal loading={loadingType === "slides"} onClose={() => setShowSlideModal(false)} onGenerate={handleSlideGenerate} />
      )}
      {showReportModal && (
        <ReportModal loading={loadingType === "report"} onClose={() => setShowReportModal(false)} onGenerate={handleReportGenerate} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-[15px] font-semibold text-[#1f2937]">스튜디오</span>
        <button
          onClick={() => setIsExpanded((v) => !v)}
          title={isExpanded ? "축소" : "전체화면"}
          className="p-1.5 rounded-lg hover:bg-black/5 text-[#5f6368] hover:text-blue-600 transition-colors"
        >
          {isExpanded ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
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
                  style={{
                    background: item.type === "quiz" ? "#dbeafe" : item.type === "audio" ? "#d0f5f1" : item.type === "mindmap" ? "#f0e6ff" : item.type === "flashcard" ? "#fde0ea" : item.type === "slides" ? "#fef0da" : "#dcf2e8",
                    color: item.type === "quiz" ? "#1d4ed8" : item.type === "audio" ? "#0d9488" : item.type === "mindmap" ? "#7c3aed" : item.type === "flashcard" ? "#be123c" : item.type === "slides" ? "#d97706" : "#166534",
                  }}>
                  {item.type === "quiz" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
                    </svg>
                  ) : item.type === "audio" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                    </svg>
                  ) : item.type === "mindmap" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                      <circle cx="5" cy="5" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="19" cy="19" r="1.5" fill="currentColor" stroke="none" />
                      <path strokeLinecap="round" d="M10.5 10.5L6.5 6.5M13.5 10.5L17.5 6.5M10.5 13.5L6.5 17.5M13.5 13.5L17.5 17.5" />
                    </svg>
                  ) : item.type === "flashcard" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <rect x="2" y="6" width="20" height="13" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2l-2 4M12 2v4M8 2l2 4" />
                    </svg>
                  ) : item.type === "slides" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <rect x="2" y="3" width="20" height="15" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 18v3" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  )}
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  {renamingItemId === item.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(item.id); }
                        if (e.key === "Escape") setRenamingItemId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-sm font-semibold text-[#202124] bg-transparent border-b-2 border-[#1a73e8] outline-none truncate"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-[#202124] truncate">{item.title}</p>
                  )}
                  <p className="text-[11px] text-[#80868b] mt-0.5">{item.subtitle} · {timeAgo(item.createdAt)}</p>
                </div>
                {/* Play button */}
                <button
                  onClick={() => {
                    if (item.type === "quiz" && item.quiz) setActiveQuiz(item.quiz);
                    else if (item.type === "audio") setActiveAudio({ base64: item.audio?.base64, audioUrl: item.audioUrl, script: item.audio?.script || "", title: item.title });
                    else if (item.type === "mindmap" && item.mindmap) setActiveMindmap({ nodes: item.mindmap.nodes, title: item.title });
                    else if (item.type === "flashcard" && item.flashcard) setActiveFlashcard({ cards: item.flashcard.cards, title: item.title });
    else if (item.type === "slides" && item.slides) setActiveSlides({ slides: item.slides.slides, title: item.title, cover_image_b64: item.slides.cover_image_b64 });
                    else if (item.type === "report" && item.report) setActiveReport({ sections: item.report.sections, title: item.title, format: item.report.format });
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
                    <div className="absolute right-0 top-7 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1 w-32">
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(item); }}
                        className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left flex items-center gap-2"
                      >
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        </svg>
                        이름 변경
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left flex items-center gap-2"
                      >
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                        삭제
                      </button>
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
