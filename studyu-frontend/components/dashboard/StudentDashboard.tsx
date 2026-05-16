"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type MaybeTitle = string | { id?: string; type?: string; title?: string } | null | undefined;

interface Notebook {
  id: string;
  title: MaybeTitle;
  description?: string;
  created_at: string;
  documents?: { count: number }[];
  is_starred?: boolean;
  user_id?: string;
  instructor_name?: string;
}

interface Props {
  notebooks?: Notebook[];
  enrolledNotebooks: Notebook[];
  userName: string;
}

function toText(value: MaybeTitle, fallback = "제목 없음"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value && typeof value === "object") {
    const inner = typeof value.title === "string" ? value.title.trim() : "";
    return inner || fallback;
  }
  return fallback;
}

function normalizeNotebook(nb: Notebook): Notebook {
  return {
    ...nb,
    title: toText(nb.title),
    is_starred: nb.is_starred ?? false,
  };
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeDetail = (error as { detail?: unknown }).detail;
    if (typeof maybeDetail === "string") return maybeDetail;
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const RECENT_NOTEBOOKS_STORAGE_KEY = "student-recent-notebooks";

function getRecentNotebookOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_NOTEBOOKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function removeRecentNotebook(id: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const next = getRecentNotebookOrder().filter((value) => value !== id);
    localStorage.setItem(RECENT_NOTEBOOKS_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export default function StudentDashboard({ enrolledNotebooks: initialEnrolled, userName }: Props) {
  const router = useRouter();
  const [enrolledNotebooks, setEnrolledNotebooks] = useState<Notebook[]>(() => initialEnrolled.map(normalizeNotebook));
  const [recentNotebookOrder, setRecentNotebookOrder] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [enrolledConfirmId, setEnrolledConfirmId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const searchText = search.toLowerCase();
    return [...enrolledNotebooks]
      .filter((nb) => toText(nb.title).toLowerCase().includes(searchText))
      .sort((a, b) => {
        // 즐겨찾기가 항상 맨 앞
        if (a.is_starred && !b.is_starred) return -1;
        if (!a.is_starred && b.is_starred) return 1;
        if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return toText(a.title).localeCompare(toText(b.title));
      });
  }, [enrolledNotebooks, search, sort]);

  useEffect(() => {
    setRecentNotebookOrder(getRecentNotebookOrder());
  }, []);

  const recent = useMemo(() => {
    if (recentNotebookOrder.length === 0) return [];

    const notebookById = new Map(enrolledNotebooks.map((nb) => [nb.id, nb]));
    return recentNotebookOrder
      .map((id) => notebookById.get(id))
      .filter((nb): nb is Notebook => Boolean(nb))
      .slice(0, 3);
  }, [enrolledNotebooks, recentNotebookOrder]);

  async function toggleEnrolledStar(id: string) {
    setEnrolledNotebooks((prev) =>
      prev.map((nb) => (nb.id === id ? { ...nb, is_starred: !nb.is_starred } : nb))
    );
  }

  async function handleLeave(id: string) {
    setLeavingId(id);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/notebooks/${id}/leave`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error("나가기에 실패했습니다.");

      setEnrolledNotebooks((prev) => prev.filter((nb) => nb.id !== id));
      setRecentNotebookOrder(removeRecentNotebook(id));
      router.refresh();
    } catch (error: unknown) {
      alert(`나가기 실패: ${parseErrorMessage(error, "오류")}`);
    } finally {
      setLeavingId(null);
      setEnrolledConfirmId(null);
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;

    setJoining(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch(`${API}/api/notebooks/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invite_code: joinCode.trim() }),
      });

      if (res.status === 409) {
        setJoinModalOpen(false);
        setJoinCode("");
        router.refresh();
        alert("이미 참여한 노트북입니다. 목록을 새로고침했어요.");
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "참여 실패");
      }

      const joined = await res.json();
      const joinedNotebookId = joined?.id || joined?.notebook_id || joined?.notebook?.id || null;
      if (!joinedNotebookId) {
        throw new Error("참여는 되었지만 노트북 정보를 찾을 수 없습니다.");
      }

      const { data: joinedNotebook, error: joinedNotebookError } = await supabase
        .from("notebooks")
        .select("*, documents(count)")
        .eq("id", joinedNotebookId)
        .single();

      if (joinedNotebookError || !joinedNotebook) {
        const fallbackNotebook: Notebook = normalizeNotebook({
          id: joinedNotebookId,
          title: joined?.title || joined?.notebook?.title || "참여한 노트북",
          description: joined?.description || joined?.notebook?.description || "",
          created_at: joined?.created_at || joined?.notebook?.created_at || new Date().toISOString(),
          documents: [{ count: 0 }],
          is_starred: false,
        });

        setEnrolledNotebooks((prev) => {
          const next = prev.filter((nb) => nb.id !== fallbackNotebook.id);
          return [fallbackNotebook, ...next];
        });
      } else {
        setEnrolledNotebooks((prev) => {
          const normalized = normalizeNotebook(joinedNotebook as Notebook);
          const next = prev.filter((nb) => nb.id !== normalized.id);
          return [normalized, ...next];
        });
      }

      setRecentNotebookOrder(removeRecentNotebook(joinedNotebookId));
      setJoinModalOpen(false);
      setJoinCode("");
      router.refresh();
    } catch (error: unknown) {
      alert(parseErrorMessage(error, "오류가 발생했습니다."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">안녕하세요, {userName}님</h1>
        <p className="text-gray-500 mt-2">오늘도 열심히 학습해봐요!</p>
      </div>

      {recent.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">최근에 연 노트북</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {recent.map((nb) => (
              <Link
                key={nb.id}
                href={`/student/workspace/${nb.id}?from=/dashboard/student`}
                className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl hover:shadow-md hover:border-purple-300 transition-all"
              >
                <h3 className="font-semibold text-purple-900 truncate">{toText(nb.title)}</h3>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="min-w-0 flex-1 text-xs text-purple-600 truncate">{nb.instructor_name ? `${nb.instructor_name} 강사` : "강사"}</span>
                  <span className="shrink-0 text-xs text-purple-500 whitespace-nowrap">바로 열기</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">참여 중인 노트북 ({enrolledNotebooks.length}개)</h2>
          <button
            onClick={() => setJoinModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-purple-300 text-purple-600 text-sm font-medium rounded-lg hover:bg-purple-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            코드로 참여
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
              <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="노트북 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="name">이름순</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? "검색 결과가 없습니다." : "참여 중인 노트북이 없습니다. 강사에게 초대 코드를 받아보세요!"}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map((nb) => (
              <div key={nb.id} className="relative group bg-white border border-purple-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-1.5 bg-purple-400" />
                <button
                  onClick={() => toggleEnrolledStar(nb.id)}
                  className="absolute top-4 right-3 z-10 p-1 rounded hover:bg-gray-100 transition-colors"
                  title={nb.is_starred ? "즐겨찾기 해제" : "즐겨찾기"}
                >
                  {nb.is_starred
                    ? <svg className="w-4 h-4 text-yellow-400 fill-yellow-400" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    : <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                  }
                </button>
                <div className="p-4">
                  <Link href={`/student/workspace/${nb.id}?from=/dashboard/student`} className="block flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 transition-colors truncate pr-6">
                      {toText(nb.title)}
                    </h3>
                  </Link>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-purple-500 truncate">{nb.instructor_name ? `${nb.instructor_name} 강사` : "강사"}</span>
                  </div>
                  <div className="flex items-center gap-1 absolute top-4 right-10">
                    <button
                      onClick={() => setEnrolledConfirmId(nb.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {enrolledConfirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setEnrolledConfirmId(null); }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">노트북 나가기</h2>
            <p className="text-sm text-gray-500 mb-4">&ldquo;{toText(enrolledNotebooks.find((n) => n.id === enrolledConfirmId)?.title)}&rdquo;</p>
            <p className="text-sm text-gray-600 mb-5">이 노트북에서 나가면 더 이상 접근할 수 없습니다.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEnrolledConfirmId(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button
                onClick={() => handleLeave(enrolledConfirmId)}
                disabled={leavingId === enrolledConfirmId}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              >
                {leavingId === enrolledConfirmId ? "나가는 중..." : "나가기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {joinModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setJoinModalOpen(false);
              setJoinCode("");
            }
          }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">초대 코드로 참여</h2>
            <p className="text-sm text-gray-500 mb-4">강사에게 받은 6자리 초대 코드를 입력하세요.</p>
            <input
              autoFocus
              type="text"
              placeholder="예: AB1C2D"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
                if (e.key === "Escape") {
                  setJoinModalOpen(false);
                  setJoinCode("");
                }
              }}
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center tracking-widest font-bold text-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setJoinModalOpen(false); setJoinCode(""); }} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button
                onClick={handleJoin}
                disabled={joining || joinCode.trim().length < 1}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {joining ? "참여 중..." : "참여하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
