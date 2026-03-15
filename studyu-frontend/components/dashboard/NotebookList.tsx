"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Notebook {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  updated_at?: string;
  documents?: { count: number }[];
}

interface Props {
  notebooks: Notebook[];
}

type SortOption = "newest" | "oldest" | "name";

export default function NotebookList({ notebooks: initial }: Props) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("newest");

  // ── 검색 + 정렬 ──
  const filtered = useMemo(() => {
    let result = notebooks;

    // 검색
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (nb) =>
          nb.title.toLowerCase().includes(q) ||
          nb.description?.toLowerCase().includes(q)
      );
    }

    // 정렬
    result = [...result].sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return a.title.localeCompare(b.title, "ko");
    });

    return result;
  }, [notebooks, search, sort]);

  // ── 삭제 ──
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

  // ── 유틸 ──
  const getDocCount = (nb: Notebook) => {
    if (!nb.documents) return 0;
    return Array.isArray(nb.documents) ? nb.documents[0]?.count || 0 : 0;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "방금 전";
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;
    return date.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
  };

  const getRandomGradient = (index: number) => {
    const gradients = [
      "from-brand-500/10 to-blue-500/10",
      "from-violet-500/10 to-purple-500/10",
      "from-emerald-500/10 to-teal-500/10",
      "from-amber-500/10 to-orange-500/10",
      "from-rose-500/10 to-pink-500/10",
      "from-cyan-500/10 to-sky-500/10",
    ];
    return gradients[index % gradients.length];
  };

  const getAccentColor = (index: number) => {
    const colors = [
      "bg-brand-500",
      "bg-violet-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-cyan-500",
    ];
    return colors[index % colors.length];
  };

  if (notebooks.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* ── 검색 + 정렬 바 ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* 검색 */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
            fill="none" viewBox="0 0 24 24"
          >
            <path
              d="M21 21l-5.197-5.197M15.803 15.803A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="노트북 검색..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-surface-200 text-sm
                       text-surface-900 placeholder-surface-400
                       outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100
                       bg-white transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-surface-100"
            >
              <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* 정렬 */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="px-4 py-2.5 rounded-xl border border-surface-200 text-sm text-surface-700
                     bg-white outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100
                     cursor-pointer transition-all"
        >
          <option value="newest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      {/* ── 검색 결과 없음 ── */}
      {filtered.length === 0 && search && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-surface-500 text-sm">
            &ldquo;{search}&rdquo;에 대한 검색 결과가 없습니다.
          </p>
        </div>
      )}

      {/* ── 노트북 카드 그리드 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((nb, idx) => {
          const docCount = getDocCount(nb);
          const globalIdx = notebooks.indexOf(nb);

          return (
            <div key={nb.id} className="relative group">
              <Link
                href={`/workspace/${nb.id}`}
                className="block h-full rounded-2xl border border-surface-200 bg-white
                           overflow-hidden
                           hover:border-brand-300 hover:shadow-lg hover:shadow-brand-100/40
                           transition-all duration-300 hover:-translate-y-0.5"
              >
                {/* 상단 컬러 바 */}
                <div className={`h-1.5 ${getAccentColor(globalIdx)}`} />

                {/* 카드 바디 */}
                <div className="p-5">
                  {/* 제목 */}
                  <h3 className="font-bold text-surface-900 group-hover:text-brand-600
                                 transition-colors leading-snug mb-1 pr-8 line-clamp-2">
                    {nb.title}
                  </h3>

                  {/* 설명 */}
                  {nb.description ? (
                    <p className="text-xs text-surface-400 line-clamp-2 mb-4 leading-relaxed">
                      {nb.description}
                    </p>
                  ) : (
                    <div className="mb-4" />
                  )}

                  {/* 하단 메타정보 */}
                  <div className="flex items-center justify-between pt-3 border-t border-surface-100">
                    <div className="flex items-center gap-3">
                      {/* 문서 수 */}
                      <span className="inline-flex items-center gap-1.5 text-xs text-surface-500">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                          <path
                            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                          />
                        </svg>
                        {docCount}개
                      </span>
                    </div>

                    {/* 날짜 */}
                    <span className="text-xs text-surface-400">
                      {formatDate(nb.created_at)}
                    </span>
                  </div>
                </div>
              </Link>

              {/* 삭제 버튼 */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmId(nb.id);
                }}
                className="absolute top-5 right-3 w-7 h-7 flex items-center justify-center rounded-lg
                           bg-white/80 backdrop-blur-sm border border-surface-200
                           opacity-0 group-hover:opacity-100
                           hover:bg-red-50 hover:border-red-200
                           transition-all duration-200"
                title="노트북 삭제"
              >
                <svg className="w-3.5 h-3.5 text-surface-400 hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 삭제 확인 모달 ── */}
      {confirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}
        >
          {/* 배경 오버레이 */}
          <div className="absolute inset-0 bg-surface-900/30 backdrop-blur-sm" />

          {/* 모달 */}
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl shadow-surface-900/10 overflow-hidden">
            {/* 상단 빨간 바 */}
            <div className="h-1 bg-gradient-to-r from-red-400 to-red-500" />

            <div className="p-6">
              {/* 아이콘 + 제목 */}
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24">
                    <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-surface-900 mb-1">노트북 삭제</h2>
                  <p className="text-sm text-surface-900 font-medium truncate">
                    &ldquo;{notebooks.find((n) => n.id === confirmId)?.title}&rdquo;
                  </p>
                </div>
              </div>

              {/* 경고 메시지 */}
              <div className="bg-red-50/50 border border-red-100 rounded-xl p-3.5 mb-5">
                <p className="text-sm text-red-700 leading-relaxed">
                  삭제하면 업로드된 문서, 대화 기록, 퀴즈가 모두 함께 삭제됩니다.
                  이 작업은 되돌릴 수 없습니다.
                </p>
              </div>

              {/* 버튼 */}
              <div className="flex gap-2.5">
                <button
                  onClick={() => setConfirmId(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                             text-surface-700 bg-surface-100 hover:bg-surface-200
                             transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => handleDelete(confirmId)}
                  disabled={deletingId === confirmId}
                  className="flex-1 flex items-center justify-center gap-2
                             px-4 py-2.5 rounded-xl text-sm font-semibold
                             bg-red-500 text-white hover:bg-red-600
                             transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deletingId === confirmId ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                      </svg>
                      삭제 중...
                    </>
                  ) : (
                    "삭제하기"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
