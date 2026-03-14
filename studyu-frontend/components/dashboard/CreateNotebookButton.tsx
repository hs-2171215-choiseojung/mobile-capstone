"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function CreateNotebookButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!title.trim()) { setError("제목을 입력해주세요."); return; }
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
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        새 노트북
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
              <h2 className="font-semibold text-surface-900">새 노트북 만들기</h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-surface-100 transition-colors"
              >
                <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* 바디 */}
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">
                  노트북 제목 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                  placeholder="예: 운영체제 정리, 자료구조 공부..."
                  className="w-full px-4 py-2.5 rounded-xl border border-surface-300 text-sm text-surface-900 placeholder-surface-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition-all"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">설명 (선택)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="노트북에 대한 간단한 설명..."
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-surface-300 text-sm text-surface-900 placeholder-surface-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition-all resize-none"
                />
              </div>
              {error && (
                <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
            </div>

            {/* 푸터 */}
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-surface-600 hover:bg-surface-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !title.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                  </svg>
                )}
                {loading ? "생성 중..." : "워크스페이스 열기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
