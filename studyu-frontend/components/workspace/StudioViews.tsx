"use client";

import { useEffect, useState } from "react";

type Doc = { id: string; name?: string; filename?: string; type?: string };
type WeekTask = { id: number; title?: string; itemId?: string };
type Week = { id: number; title?: string; status?: string; sources?: unknown[]; tasks?: WeekTask[] };

export interface UnifiedStudioConfig {
  format: string;
  instructions: string;
  length: string;
  language: string;
  style: string;
  selectedDocIds: string[];
}

type StudioTaskItem = {
  id: string;
  label: string;
  icon: string;
  presets: string[];
};

export const STUDIO_TASK_ITEMS: StudioTaskItem[] = [
  { id: "audio", label: "AI 오디오 오버뷰", icon: "A", presets: ["강의 요약 오디오", "핵심 개념 설명", "Q&A 형식", "스토리텔링 방식", "토론 형식", "인터뷰 형식"] },
  { id: "slides", label: "슬라이드 자료", icon: "S", presets: ["강의 슬라이드", "요약 슬라이드", "발표 자료", "학습 정리 슬라이드", "비교 분석 슬라이드", "사례 연구 슬라이드"] },
  { id: "mindmap", label: "마인드맵", icon: "M", presets: ["개념 구조도", "인과관계 맵", "비교 분석 맵", "학습 흐름도", "키워드 맵", "프로세스 맵"] },
  { id: "report", label: "보고서", icon: "R", presets: ["학습 가이드", "블로그 게시물", "제품 요구사항 정의서", "기술 개념 설명서", "학습 활용 가이드", "사례 분석 보고서"] },
  { id: "flashcard", label: "플래시카드", icon: "F", presets: ["단어·정의 카드", "Q&A 카드", "빈칸 채우기 카드", "이미지 연상 카드", "공식 암기 카드", "사례 카드"] },
  { id: "quiz", label: "퀴즈", icon: "Q", presets: ["객관식 퀴즈", "O/X 퀴즈", "단답형 퀴즈", "빈칸 채우기", "서술형 퀴즈", "사례 분석 퀴즈"] },
  { id: "table", label: "데이터 표", icon: "T", presets: ["비교 분석 표", "개념 정리 표", "요약 표", "항목 분류 표", "체크리스트 표", "학습 계획 표"] },
];

const END_STUDY_BTN_CLASS = "text-sm font-semibold text-red-500 hover:text-red-600";
const OPTION_ALPHA = ["A", "B", "C", "D"];
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

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "title" in (value as Record<string, unknown>)) {
    return toText((value as Record<string, unknown>).title, fallback);
  }
  return fallback;
}

function resolveQuizAnswerIndex(question: any): number {
  const options = Array.isArray(question?.options) ? question.options : [];
  const candidates = [
    question?.answerIndex,
    question?.answer,
    question?.correctAnswerIndex,
    question?.correct_answer_index,
    question?.correctOption,
    question?.correct_option,
    question?.correctAnswer,
    question?.correct_answer,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      if (candidate >= 0 && candidate < options.length) return candidate;
      if (candidate >= 1 && candidate <= options.length) return candidate - 1;
    }

    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (!trimmed) continue;

      const alphaIndex = OPTION_ALPHA.indexOf(trimmed.toUpperCase());
      if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;

      const numeric = Number(trimmed);
      if (Number.isInteger(numeric)) {
        if (numeric >= 0 && numeric < options.length) return numeric;
        if (numeric >= 1 && numeric <= options.length) return numeric - 1;
      }

      const optionTextIndex = options.findIndex((opt: unknown) => toText(opt).trim() === trimmed);
      if (optionTextIndex >= 0) return optionTextIndex;
    }
  }

  return -1;
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
    </svg>
  );
}

export function UnifiedGenerateModal({
  typeId,
  loading,
  docs,
  activeDocIds,
  weeks,
  initialWeekId,
  onClose,
  onGenerate,
}: {
  typeId: string;
  loading: boolean;
  docs: Doc[];
  activeDocIds: string[];
  weeks: Week[];
  initialWeekId: number | null;
  onClose: () => void;
  onGenerate: (cfg: UnifiedStudioConfig, weekId: number | null) => void;
}) {
  const item = STUDIO_TASK_ITEMS.find((it) => it.id === typeId);
  const [cfg, setCfg] = useState<UnifiedStudioConfig>({
    format: "",
    instructions: "",
    length: "기본값",
    language: "한국어",
    style: "격식체",
    selectedDocIds: activeDocIds.length > 0 ? activeDocIds : docs.map((d) => d.id),
  });
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(initialWeekId);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-base font-bold text-gray-800">{item.label} 생성</p>
            <p className="text-xs text-gray-400">상세 옵션을 설정하고 만들기를 누르세요</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {docs.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">참고 소스</p>
              <div className="space-y-2">
                {docs.map((doc) => {
                  const checked = cfg.selectedDocIds.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setCfg((c) => ({
                        ...c,
                        selectedDocIds: checked ? c.selectedDocIds.filter((id) => id !== doc.id) : [...c.selectedDocIds, doc.id],
                      }))}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${checked ? "border-blue-400 bg-blue-50" : "border-gray-100 bg-gray-50 hover:border-gray-300"}`}
                    >
                      <span className="text-sm font-medium text-gray-700">{doc.filename || doc.name || "소스"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">형식</p>
            <div className="grid grid-cols-2 gap-2">
              {item.presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setCfg((c) => ({ ...c, format: preset }))}
                  className={`px-3 py-2.5 rounded-xl border-2 text-sm text-left transition-all ${cfg.format === preset ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-300"}`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">추가 지시사항</p>
            <textarea
              value={cfg.instructions}
              onChange={(e) => setCfg((c) => ({ ...c, instructions: e.target.value }))}
              rows={3}
              placeholder="예) 초등학생도 이해할 수 있도록 쉽게 작성해주세요."
              className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {["간결하게", "기본값", "상세하게"].map((opt) => (
              <button key={opt} onClick={() => setCfg((c) => ({ ...c, length: opt }))} className={`py-2 rounded-lg border text-sm ${cfg.length === opt ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>
                {opt}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {["한국어", "English", "日本語", "中文"].map((opt) => (
              <button key={opt} onClick={() => setCfg((c) => ({ ...c, language: opt }))} className={`py-2 rounded-lg border text-sm ${cfg.language === opt ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>
                {opt}
              </button>
            ))}
          </div>

          {weeks.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">주차 등록</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSelectedWeekId(null)} className={`px-3 py-1.5 rounded-lg border text-sm ${selectedWeekId === null ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>등록 안 함</button>
                {weeks.map((w, idx) => (
                  <button key={w.id} onClick={() => setSelectedWeekId(w.id)} className={`px-3 py-1.5 rounded-lg border text-sm ${selectedWeekId === w.id ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>
                    {toText(w.title, `Week ${idx + 1}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <button
            onClick={() => onGenerate(cfg, selectedWeekId)}
            disabled={loading || cfg.selectedDocIds.length === 0}
            className="w-full py-3 rounded-2xl text-white font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Spinner className="w-4 h-4" />}
            {loading ? "생성 중..." : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SummaryView({ content, onBack }: { content: string; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">요약</span>
        <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
      </div>
      <div className="p-5">
        <div className="rounded-2xl p-4 bg-white border border-gray-200 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

export function MemoView({
  initialId,
  initialTitle,
  initialContent,
  onBack,
  onSave,
  readOnly = false,
}: {
  initialId: string | null;
  initialTitle: string;
  initialContent: string;
  onBack: () => void;
  onSave: (id: string | null, title: string, content: string) => Promise<string>;
  readOnly?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (readOnly) return;
    setSaving(true);
    try {
      await onSave(initialId, title, content);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <span className="text-sm font-medium text-gray-700">메모</span>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded-full text-xs font-semibold bg-blue-600 text-white disabled:opacity-60"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          )}
          <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
        </div>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        readOnly={readOnly}
        placeholder="제목"
        className="w-full px-5 pt-5 pb-2 text-xl font-bold text-gray-900 outline-none placeholder-gray-300 bg-white"
      />

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        readOnly={readOnly}
        placeholder="내용을 입력하세요..."
        className="flex-1 w-full px-5 py-2 text-sm text-gray-800 leading-relaxed outline-none resize-none bg-white placeholder-gray-300"
      />

      <div className="px-5 py-2 border-t border-gray-100 shrink-0">
        <p className="text-[11px] text-gray-400">{content.length}자</p>
      </div>
    </div>
  );
}

export function QuizView({ quiz, onBack }: { quiz: any; onBack: () => void }) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(0);
  const q = questions[idx];
  const total = questions.length;
  const correctAnswerIndex = resolveQuizAnswerIndex(q);
  const correctAnswerLabel = correctAnswerIndex >= 0 ? OPTION_ALPHA[correctAnswerIndex] || String(correctAnswerIndex + 1) : null;
  const correctAnswerText = correctAnswerIndex >= 0 ? toText(q?.options?.[correctAnswerIndex]) : "";
  const isCorrectSelection = selected !== null && selected === correctAnswerIndex;

  function select(i: number) {
    if (!q || answered) return;
    setSelected(i);
    setAnswered(true);
    if (i === correctAnswerIndex) setScore((s) => s + 1);
  }

  function next() {
    if (idx + 1 >= total) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setShowHint(false);
  }

  if (total === 0 || !q) {
    return (
      <div className="h-full bg-white p-6">
        <div className="flex justify-end">
          <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
        </div>
        <p className="mt-6 text-gray-500">퀴즈 문항이 없습니다.</p>
      </div>
    );
  }

  if (done) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">퀴즈 결과</span>
          <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 text-center">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
            style={{ background: pct >= 70 ? "#e6f4ea" : "#fce8e6", color: pct >= 70 ? "#137333" : "#c5221f" }}
          >
            {pct}%
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 mb-1">
              {pct >= 80 ? "훌륭해요!" : pct >= 60 ? "잘하셨어요!" : "조금 더 공부해봐요"}
            </p>
            <p className="text-sm text-gray-500">{total}문제 중 {score}개 정답</p>
          </div>
          <button
            onClick={() => {
              setIdx(0);
              setSelected(null);
              setAnswered(false);
              setShowHint(false);
              setDone(false);
              setScore(0);
            }}
            className="px-6 py-2.5 rounded-full text-sm font-semibold bg-blue-600 text-white"
          >
            다시 풀기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{toText(quiz?.title, "퀴즈")} {idx + 1}/{total}</span>
        <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <div className="rounded-2xl p-4 mb-3 bg-white border border-gray-200">
        <h3 className="text-base font-semibold text-gray-900">{toText(q.question, "문항")}</h3>
          <div className="space-y-2 mt-4">
            {(q.options || []).map((opt: string, i: number) => {
              let bg = "white";
              let borderColor = "#e0e0e0";
              let color = "#202124";
              if (answered) {
                if (i === correctAnswerIndex) {
                  bg = "#e6f4ea";
                  borderColor = "#34a853";
                  color = "#137333";
                } else if (i === selected) {
                  bg = "#fce8e6";
                  borderColor = "#ea4335";
                  color = "#c5221f";
                }
              } else if (selected === i) {
                bg = "#e8f0fe";
                borderColor = "#1a73e8";
                color = "#1a73e8";
              }
              return (
                <button
                  key={i}
                  onClick={() => select(i)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-all border"
                  style={{ background: bg, borderColor, color }}
                >
                  <span className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0 text-xs font-bold" style={{ borderColor }}>
                    {OPTION_ALPHA[i] || i + 1}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {answered && (
          <div className="rounded-xl p-4 text-sm text-gray-700 bg-blue-50 border border-blue-100 mb-3 space-y-3">
            <div className={`rounded-lg px-3 py-2 text-sm font-medium ${isCorrectSelection ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
              {isCorrectSelection ? "정답입니다." : "오답입니다."}
            </div>
            <div>
              <p className="font-medium text-blue-800 mb-1">정답</p>
              <p>{correctAnswerLabel ? `${correctAnswerLabel}. ${correctAnswerText}` : "정답 정보를 확인할 수 없습니다."}</p>
            </div>
            <div>
              <p className="font-medium text-blue-800 mb-1">해설</p>
              <p>{toText(q.explanation, "해설이 없습니다.")}</p>
            </div>
          </div>
        )}

        {!answered && (
          <button onClick={() => setShowHint((v) => !v)} className="text-xs text-blue-600 hover:underline mb-3">
            {showHint ? "힌트 숨기기" : "힌트 보기"}
          </button>
        )}

        {showHint && !answered && (
          <div className="rounded-xl p-3 text-sm text-gray-600 bg-yellow-50 border border-yellow-200 mb-3">
            💡 {toText(q.hint)}
          </div>
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

export function AudioView({ audioBase64, audioUrl: propAudioUrl, script, title, onBack }: {
  audioBase64?: string;
  audioUrl?: string;
  script: string;
  title: string;
  onBack: () => void;
}) {
  const audioSrc = propAudioUrl || (audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : "");
  const scriptLines = script.split("\n").filter(Boolean);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-white">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
        <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
      </div>
      <div className="p-4 space-y-4">
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
          {audioSrc ? <audio controls className="w-full" src={audioSrc} style={{ height: 40 }} /> : <p className="text-sm text-gray-500">오디오가 없습니다.</p>}
        </div>

        {scriptLines.length > 0 && (
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
                      style={{ background: isA ? "#0d9488" : isB ? "#7c3aed" : "#6b7280" }}
                    >
                      {isA ? "A" : isB ? "B" : "?"}
                    </div>
                    <div
                      className="rounded-xl px-3 py-2 text-sm max-w-[80%]"
                      style={{ background: isA ? "#f0fdfb" : isB ? "#f5f3ff" : "#f3f4f6", color: "#1f2937" }}
                    >
                      {text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FlashcardView({ cards, title, onBack }: { cards: any[]; title: string; onBack: () => void }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [known, setKnown] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);
  const card = cards[idx];
  const total = cards.length;

  function handleKnow(isKnown: boolean) {
    setKnown((prev) => {
      const next = [...prev];
      next[idx] = isKnown;
      return next;
    });
    if (idx + 1 >= total) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setFlipped(false);
    setShowHint(false);
  }

  if (done && total > 0) {
    const knownCount = known.filter(Boolean).length;
    const pct = Math.round((knownCount / total) * 100);
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
          <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 text-center">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
            style={{ background: pct >= 70 ? "#fde0ea" : "#fce8e6", color: pct >= 70 ? "#be123c" : "#c5221f" }}
          >
            {pct}%
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 mb-1">
              {pct >= 80 ? "완벽해요!" : pct >= 60 ? "잘하셨어요!" : "다시 한번 복습해봐요"}
            </p>
            <p className="text-sm text-gray-500">{total}장 중 {knownCount}장 알고 있음</p>
          </div>
          <button
            onClick={() => {
              setIdx(0);
              setFlipped(false);
              setShowHint(false);
              setKnown([]);
              setDone(false);
            }}
            className="px-6 py-2.5 rounded-full text-sm font-semibold text-white"
            style={{ background: "#be123c" }}
          >
            다시 학습하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
      </div>
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>{Math.min(idx + 1, Math.max(total, 1))} / {total}</span>
          <span className="text-pink-500">{known.filter(Boolean).length}개 알고 있음</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-gray-200">
          <div className="h-1.5 rounded-full transition-all" style={{ width: `${total > 0 ? (idx / total) * 100 : 0}%`, background: "#be123c" }} />
        </div>
      </div>
      <div className="p-6 space-y-4 flex-1 flex flex-col justify-center">
        {card ? (
          <>
            <div
              className="w-full cursor-pointer select-none"
              style={{ perspective: "1200px" }}
              onClick={() => { setFlipped((v) => !v); setShowHint(false); }}
            >
              <div
                className="relative transition-transform duration-500"
                style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight: "280px" }}
              >
                <div
                  className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center p-10 text-center shadow-md border border-gray-100"
                  style={{ backfaceVisibility: "hidden", background: "#1e1e2e", minHeight: "280px" }}
                >
                  <p className="text-white text-2xl font-semibold leading-relaxed">{toText(card.front)}</p>
                  {!flipped && <p className="text-gray-400 text-sm mt-5">정답 보기</p>}
                </div>
                <div
                  className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center p-10 text-center shadow-md border border-pink-100"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "white", minHeight: "280px" }}
                >
                  <p className="text-gray-800 text-xl font-medium leading-relaxed">{toText(card.back)}</p>
                  {toText(card.hint) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowHint((v) => !v); }}
                      className="mt-4 text-sm text-pink-500 hover:underline"
                    >
                      설명
                    </button>
                  )}
                  {showHint && toText(card.hint) && (
                    <p className="mt-2 text-sm text-gray-500 bg-pink-50 rounded-lg px-4 py-2.5">{toText(card.hint)}</p>
                  )}
                </div>
              </div>
            </div>

            {flipped ? (
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={() => handleKnow(false)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  모르겠어요
                </button>
                <button
                  onClick={() => handleKnow(true)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold border-2 border-green-200 text-green-600 hover:bg-green-50 transition-colors"
                >
                  알고 있어요
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => {
                    if (idx === 0) return;
                    setIdx((i) => i - 1);
                    setFlipped(false);
                    setShowHint(false);
                  }}
                  disabled={idx === 0}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  onClick={() => {
                    if (idx < total - 1) {
                      setIdx((i) => i + 1);
                      setFlipped(false);
                      setShowHint(false);
                    } else {
                      setDone(true);
                    }
                  }}
                  className="px-4 py-2 rounded-lg border border-pink-300 text-sm text-pink-600"
                >
                  다음
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500 text-center">카드가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

export function SlideView({ slides, title, coverImageB64, onBack }: { slides: any[]; title: string; coverImageB64?: string; onBack: () => void }) {
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

  const SLIDE_THEMES = [
    { bg: "#0f172a", accent: "#60a5fa", sub: "#94a3b8" },
    { bg: "#1e1b4b", accent: "#a78bfa", sub: "#c4b5fd" },
    { bg: "#0c4a6e", accent: "#38bdf8", sub: "#7dd3fc" },
    { bg: "#14532d", accent: "#4ade80", sub: "#86efac" },
    { bg: "#1c1917", accent: "#fb923c", sub: "#fdba74" },
    { bg: "#1e1e2e", accent: "#c084fc", sub: "#e9d5ff" },
  ];
  const theme = idx === 0 ? SLIDE_THEMES[0] : SLIDE_THEMES[idx % SLIDE_THEMES.length];

  return (
    <div className="h-full bg-[#f1f3f4] flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 truncate max-w-[280px]">{title}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-full border transition-colors"
            style={showNotes ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { color: "#6b7280", borderColor: "#e5e7eb" }}
          >
            발표자 노트
          </button>
          <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 gap-4 overflow-hidden">
        {total === 0 ? (
          <p className="text-sm text-gray-500">슬라이드 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden" style={{ background: theme.bg, aspectRatio: "16/9", maxHeight: "60vh", position: "relative" }}>
              {slide.layout === "title" ? (
                <div className="absolute inset-0 flex">
                  <div className="flex flex-col justify-center px-8 py-6 z-10" style={{ width: coverImageB64 ? "55%" : "100%", textAlign: coverImageB64 ? "left" : "center", alignItems: coverImageB64 ? "flex-start" : "center" }}>
                    <div className="mb-3 flex gap-2 flex-wrap">
                      {[title.split(" ")[0], "AI", "학습"].map((tag, i) => (
                        <span key={i} className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${theme.accent}22`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-white text-2xl font-bold leading-tight mb-2">{toText(slide.title)}</p>
                    {toText(slide.subtitle) && <p className="text-sm leading-relaxed" style={{ color: theme.sub }}>{toText(slide.subtitle)}</p>}
                    <div className="mt-4 h-0.5 w-12 rounded" style={{ background: theme.accent }} />
                  </div>
                  {coverImageB64 && (
                    <div className="absolute right-0 top-0 bottom-0" style={{ width: "48%" }}>
                      <div className="absolute inset-y-0 left-0 w-16 z-10" style={{ background: `linear-gradient(to right, ${theme.bg}, transparent)` }} />
                      <img src={`data:image/png;base64,${coverImageB64}`} alt="표지 일러스트" className="w-full h-full object-cover opacity-90" />
                    </div>
                  )}
                </div>
              ) : slide.layout === "summary" ? (
                <div className="absolute inset-0 flex flex-col px-8 py-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-6 rounded-full" style={{ background: theme.accent }} />
                    <p className="text-lg font-bold" style={{ color: theme.accent }}>{toText(slide.title)}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 flex-1">
                    {(slide.bullets || []).map((b: string, i: number) => (
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
                <div className="absolute inset-0 flex flex-col px-8 py-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-5 rounded-full" style={{ background: theme.accent }} />
                    <p className="text-base font-bold" style={{ color: theme.accent }}>{toText(slide.title)}</p>
                  </div>
                  <div className="flex gap-4 flex-1">
                    <div className="flex-1 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      <ul className="flex flex-col gap-2">
                        {(slide.bullets || []).slice(0, Math.ceil((slide.bullets || []).length / 2)).map((b: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-white/85 text-xs">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex-1 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      <ul className="flex flex-col gap-2">
                        {(slide.bullets || []).slice(Math.ceil((slide.bullets || []).length / 2)).map((b: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-white/85 text-xs">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col px-8 py-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-5 rounded-full" style={{ background: theme.accent }} />
                    <p className="text-base font-bold" style={{ color: theme.accent }}>{toText(slide.title)}</p>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {(slide.bullets || []).map((b: string, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-white/85 text-sm">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="absolute bottom-3 right-4 z-20">
                <span className="text-white/30 text-[10px]">{idx + 1} / {total}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => setIdx((i) => Math.max(i - 1, 0))}
                disabled={idx === 0}
                className="w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors"
                style={idx === 0 ? { borderColor: "#e0e0e0", color: "#ccc", cursor: "not-allowed" } : { borderColor: "#fdd89a", color: "#d97706", background: "white" }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div className="flex gap-1.5 max-w-[200px] overflow-hidden">
                {slides.map((_: any, i: number) => (
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

            {showNotes && toText(slide.speaker_notes) && (
              <div className="w-full max-w-3xl bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
                <p className="text-xs font-semibold text-amber-700 mb-1">발표자 노트</p>
                <p className="text-sm text-gray-700 leading-relaxed">{toText(slide.speaker_notes)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ReportView({ sections, title, format, onBack }: { sections: any[]; title: string; format: string; onBack: () => void }) {
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
    <div className="h-full bg-white flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700 truncate">{title}</p>
        <button onClick={onBack} className={END_STUDY_BTN_CLASS}>학습 종료</button>
      </div>
      <div className="p-4 space-y-4">
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

        {sections?.length ? sections.map((section, i) => (
          <div key={i} className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2" style={{ background: "#f0fdf4" }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: "#166534" }}>
                {i + 1}
              </span>
              <p className="text-sm font-semibold text-gray-800">{toText(section.heading, `섹션 ${i + 1}`)}</p>
            </div>
            <div className="p-4 text-sm space-y-1.5">
              <ul className="space-y-1.5">
                {renderContent(toText(section.content))}
              </ul>
            </div>
          </div>
        )) : <p className="text-sm text-gray-500">보고서 내용이 없습니다.</p>}
      </div>
    </div>
  );
}
