"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Props {
  size?: "default" | "large";
}

const TEMPLATES = [
  { emoji: "📘", title: "", desc: "빈 노트북으로 시작" },
  { emoji: "🎓", title: "기말고사 준비", desc: "시험 대비 학습" },
  { emoji: "💻", title: "프로그래밍 학습", desc: "코딩 자료 정리" },
  { emoji: "📊", title: "프로젝트 리서치", desc: "자료 조사 및 분석" },
  { emoji: "📝", title: "자격증 준비", desc: "자격증 시험 대비" },
];

export default function CreateNotebookButton({ size = "default" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"template" | "form">("template");

  function handleOpenModal() {
    setTitle("");
    setDescription("");
    setStep("template");
    setOpen(true);
    setError("");
  }

  function handleClose() {
    setOpen(false);
    setTitle("");
    setDescription("");
    setError("");
    setStep("template");
  }

  function handleTemplateSelect(template: typeof TEMPLATES[0]) {
    setTitle(template.title);
    setDescription(template.desc === "빈 노트북으로 시작" ? "" : template.desc);
    setStep("form");
  }

  async function handleCreate() {
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/notebooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "노트북 생성 실패");

      router.push(`/workspace/${data.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      setLoading(false);
    }
  }

  return (
    <>
      {/* ── 트리거 버튼 ── */}
      <button
        onClick={handleOpenModal}
        disabled={loading}
        className={`
          inline-flex items-center gap-2 font-semibold
          bg-brand-600 text-white hover:bg-brand-700
          shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30
          transition-all duration-200 hover:-translate-y-0.5
          disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
          ${size === "large"
            ? "px-8 py-3.5 rounded-2xl text-base"
            : "px-4 py-2.5 rounded-xl text-sm"
          }
        `}
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
          </svg>
        ) : (
          <svg className={size === "large" ? "w-5 h-5" : "w-4 h-4"} fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {loading ? "생성 중..." : size === "large" ? "첫 번째 노트북 만들기" : "새 노트북"}
      </button>

      {/* ── 모달 ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          {/* 오버레이 */}
          <div className="absolute inset-0 bg-surface-900/30 backdrop-blur-sm" />

          {/* 모달 본체 */}
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl shadow-surface-900/10 overflow-hidden">
            {/* 상단 그라데이션 바 */}
            <div className="h-1.5 bg-gradient-to-r from-brand-400 via-violet-400 to-brand-600" />

            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                {step === "form" && (
                  <button
                    onClick={() => setStep("template")}
                    className="p-1 rounded-lg hover:bg-surface-100 transition-colors"
                  >
                    <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24">
                      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <h2 className="font-bold text-surface-900 text-lg">
                  {step === "template" ? "새 노트북 만들기" : "노트북 설정"}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-surface-100 transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* ── Step 1: 템플릿 선택 ── */}
            {step === "template" && (
              <div className="px-6 pb-6">
                <p className="text-sm text-surface-500 mb-4">
                  템플릿으로 빠르게 시작하거나, 직접 만들어보세요.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {TEMPLATES.map((tmpl, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleTemplateSelect(tmpl)}
                      className="flex items-center gap-4 p-4 rounded-xl border border-surface-200
                                 text-left hover:border-brand-300 hover:bg-brand-50/30
                                 transition-all duration-200 group"
                    >
                      <span className="text-2xl">{tmpl.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-surface-900 text-sm group-hover:text-brand-700 transition-colors">
                          {tmpl.title || "빈 노트북"}
                        </span>
                        <p className="text-xs text-surface-400 mt-0.5">{tmpl.desc}</p>
                      </div>
                      <svg className="w-4 h-4 text-surface-300 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24">
                        <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2: 폼 입력 ── */}
            {step === "form" && (
              <>
                <div className="px-6 pb-4 space-y-4">
                  {/* 제목 */}
                  <div>
                    <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                      노트북 제목 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) handleCreate(); }}
                      placeholder="예: 운영체제 기말고사 준비"
                      className="w-full px-4 py-3 rounded-xl border border-surface-200 text-sm
                                 text-surface-900 placeholder-surface-400
                                 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100
                                 transition-all bg-surface-50 focus:bg-white"
                      autoFocus
                    />
                  </div>

                  {/* 설명 */}
                  <div>
                    <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                      설명 <span className="text-surface-400 font-normal">(선택)</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="이 노트북에 대한 간단한 설명..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-surface-200 text-sm
                                 text-surface-900 placeholder-surface-400
                                 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100
                                 transition-all resize-none bg-surface-50 focus:bg-white"
                    />
                  </div>

                  {/* 에러 */}
                  {error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-2.5 rounded-xl">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                        <path d="M12 9v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      {error}
                    </div>
                  )}
                </div>

                {/* 푸터 버튼 */}
                <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-surface-100 bg-surface-50/50">
                  <button
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold
                               text-surface-600 hover:bg-surface-200 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={loading || !title.trim()}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold
                               bg-brand-600 text-white hover:bg-brand-700
                               shadow-lg shadow-brand-600/20
                               transition-all disabled:opacity-50 disabled:cursor-not-allowed
                               disabled:shadow-none"
                  >
                    {loading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                        </svg>
                        생성 중...
                      </>
                    ) : (
                      <>
                        만들기
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <path d="M13 7l5 5-5 5M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
