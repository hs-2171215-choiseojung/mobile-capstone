"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Notebook {
  id: string;
  title: string;
  description?: string;
  created_at: string;
}

interface Props {
  notebooks: Notebook[];
}

export default function NotebookList({ notebooks: initial }: Props) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/notebooks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "삭제 실패");
      }

      setNotebooks((prev) => prev.filter((nb) => nb.id !== id));
      router.refresh();
    } catch (e: unknown) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "오류가 발생했습니다."}`);
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  if (notebooks.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {notebooks.map((nb) => (
          <div key={nb.id} className="relative group">
            <Link
              href={`/workspace/${nb.id}`}
              className="p-4 border border-surface-200 rounded-xl hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer block"
            >
              <div className="flex items-start justify-between gap-2 pr-6">
                <h3 className="font-medium text-surface-900 group-hover:text-brand-600 transition-colors">{nb.title}</h3>
                <svg className="w-4 h-4 text-surface-400 shrink-0 mt-0.5 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {nb.description && (
                <p className="mt-1 text-xs text-surface-500">{nb.description}</p>
              )}
              <p className="mt-2 text-xs text-surface-400">
                {new Date(nb.created_at).toLocaleDateString("ko-KR")}
              </p>
            </Link>

            {/* 삭제 버튼 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirmId(nb.id);
              }}
              className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
              title="노트북 삭제"
            >
              <svg className="w-3.5 h-3.5 text-surface-400 hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* 삭제 확인 모달 */}
      {confirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-surface-900">노트북 삭제</h2>
                <p className="text-sm text-surface-500 mt-0.5">
                  &ldquo;{notebooks.find((n) => n.id === confirmId)?.title}&rdquo;
                </p>
              </div>
            </div>
            <p className="text-sm text-surface-600 mb-5">
              삭제하면 업로드된 문서와 대화 기록이 모두 사라집니다. 계속하시겠어요?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmId(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-surface-600 hover:bg-surface-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleDelete(confirmId)}
                disabled={deletingId === confirmId}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deletingId === confirmId && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                  </svg>
                )}
                {deletingId === confirmId ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
