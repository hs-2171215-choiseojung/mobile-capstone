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
  type: "summary" | "quiz" | "audio" | "mindmap" | "flashcard";
  title: string;
  subtitle: string;
  createdAt: Date;
  summaryContent?: string;
  quiz?: SavedQuiz;
  audio?: { base64?: string; script: string };
  audioUrl?: string;  // Supabase Storage 서명 URL (DB 로드 시)
  mindmap?: { nodes: MindmapNode[] };
  flashcard?: { cards: FlashCard[]; difficulty: string };
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

// ── Main StudioPanel ───────────────────────────────────────────────────────
export default function StudioPanel({ activeDocIds, docs, getToken }: Props) {  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showMindmapModal, setShowMindmapModal] = useState(false);
  const [showFlashcardModal, setShowFlashcardModal] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [activeAudio, setActiveAudio] = useState<{ base64?: string; audioUrl?: string; script: string; title: string } | null>(null);
  const [activeMindmap, setActiveMindmap] = useState<{ nodes: MindmapNode[]; title: string } | null>(null);
  const [activeFlashcard, setActiveFlashcard] = useState<{ cards: FlashCard[]; title: string } | null>(null);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

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

  function handleCardClick(typeId: string) {
    if (!hasDoc) { alert("소스를 먼저 선택해주세요."); return; }
    if (typeId === "report") handleSummary();
    else if (typeId === "quiz") setShowQuizModal(true);
    else if (typeId === "audio") setShowAudioModal(true);
    else if (typeId === "mindmap") setShowMindmapModal(true);
    else if (typeId === "flashcard") setShowFlashcardModal(true);
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
                    background: item.type === "quiz" ? "#dbeafe" : item.type === "audio" ? "#d0f5f1" : item.type === "mindmap" ? "#f0e6ff" : item.type === "flashcard" ? "#fde0ea" : "#dcf2e8",
                    color: item.type === "quiz" ? "#1d4ed8" : item.type === "audio" ? "#0d9488" : item.type === "mindmap" ? "#7c3aed" : item.type === "flashcard" ? "#be123c" : "#166534",
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
                    else if (item.type === "audio") setActiveAudio({ base64: item.audio?.base64, audioUrl: item.audioUrl, script: item.audio?.script || "", title: item.title });
                    else if (item.type === "mindmap" && item.mindmap) setActiveMindmap({ nodes: item.mindmap.nodes, title: item.title });
                    else if (item.type === "flashcard" && item.flashcard) setActiveFlashcard({ cards: item.flashcard.cards, title: item.title });
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
                        onClick={() => handleDeleteItem(item.id)}
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
