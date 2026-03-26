"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CreateNotebookButton from "@/components/dashboard/CreateNotebookButton";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Notebook {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  documents?: { count: number }[];
  is_starred?: boolean;
}

interface Props {
  notebooks: Notebook[];
  enrolledNotebooks: Notebook[];
  userName: string;
}

export default function StudentDashboard({ notebooks: initial, enrolledNotebooks: initialEnrolled, userName }: Props) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState(
    initial.map((nb) => ({
      ...nb,
      is_starred: nb.is_starred ?? false,
    }))
  );
    async function toggleStar(id: string) {
      const target = notebooks.find((nb) => nb.id === id);
      if (!target) return;
      const newValue = !target.is_starred;
      setNotebooks((prev) => prev.map((nb) => (nb.id === id ? { ...nb, is_starred: newValue } : nb)));
      try {
        const supabase = createClient();
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        await fetch(`${API}/api/notebooks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ is_starred: newValue }),
        });
      } catch { /* 낙관적 업데이트 유지 */ }
    }
  const [enrolledNotebooks, setEnrolledNotebooks] = useState<Notebook[]>(initialEnrolled);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const filtered = notebooks
    .filter((nb) => nb.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return a.title.localeCompare(b.title);
    });

  const recent = notebooks.slice(0, 3);

  async function handleSaveTitle(id: string) {
    if (!editTitle.trim()) return;
    setSavingId(id);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch(`${API}/api/notebooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      if (!res.ok) throw new Error("수정 실패");
      setNotebooks((prev) => prev.map((nb) => (nb.id === id ? { ...nb, title: editTitle.trim() } : nb)));
      setEditId(null);
    } catch (e: unknown) {
      alert(`수정 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setSavingId(null);
    }
  }

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
      if (!res.ok && res.status !== 204) throw new Error("삭제 실패");
      setNotebooks((prev) => prev.filter((nb) => nb.id !== id));
      router.refresh();
    } catch (e: unknown) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setDeletingId(null);
      setConfirmId(null);
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
      if (res.status === 409) throw new Error("이미 참여한 노트북입니다.");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "참여 실패");
      }
      const nb = await res.json();
      setEnrolledNotebooks((prev) => [nb, ...prev]);
      setJoinModalOpen(false);
      setJoinCode("");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setJoining(false);
    }
  }

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const getDocCount = (nb: Notebook) =>
    Array.isArray(nb.documents) ? nb.documents[0]?.count || 0 : 0;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* 인사말 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">안녕하세요, {userName}님 👋</h1>
        <p className="text-gray-500 mt-1">계속 공부하거나 새로운 노트북을 만들어보세요</p>
      </div>

      {/* 자주 쓰는 노트북 */}
      {recent.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">⭐ 자주 쓰는 노트북</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {recent.map((nb) => (
              <Link
                key={nb.id}
                href={`/workspace/${nb.id}?from=/dashboard/student`}
                className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl hover:shadow-md hover:border-blue-300 transition-all"
              >
                <h3 className="font-semibold text-blue-900 truncate">{nb.title}</h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-blue-600">📄 {getDocCount(nb)}개 자료</span>
                  <span className="text-xs text-blue-500">바로 열기 →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 참여 중인 노트북 */}
      {enrolledNotebooks.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">🔗 참여 중인 노트북</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {enrolledNotebooks.map((nb) => (
              <Link
                key={nb.id}
                href={`/workspace/${nb.id}?from=/dashboard/student`}
                className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl hover:shadow-md hover:border-purple-300 transition-all"
              >
                <h3 className="font-semibold text-purple-900 truncate">{nb.title}</h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-purple-600">강사 노트북</span>
                  <span className="text-xs text-purple-500">바로 열기 →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 내 노트북 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">📚 내 노트북 ({notebooks.length}개)</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setJoinModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              코드로 참여
            </button>
            <CreateNotebookButton from="/dashboard/student" />
          </div>
        </div>

        {/* 검색 + 정렬 */}
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
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="name">이름순</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? "검색 결과가 없습니다." : "노트북이 없습니다. 새 노트북을 만들어보세요!"}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map((nb) => (
              <div key={nb.id} className="relative group bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-1.5 bg-blue-500" />
                {/* 별 버튼은 항상 우상단에 고정, group-hover와 분리 */}
                <button
                  onClick={() => toggleStar(nb.id)}
                  className="absolute top-4 right-3 z-10 p-1 rounded hover:bg-gray-100 transition-colors"
                  title={nb.is_starred ? "즐겨찾기 해제" : "즐겨찾기"}
                >
                  {nb.is_starred
                    ? <svg className="w-4 h-4 text-yellow-400 fill-yellow-400" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    : <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                  }
                </button>
                <div className="p-4">
                  <Link href={`/workspace/${nb.id}?from=/dashboard/student`} className="block flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate pr-6">
                      {nb.title}
                    </h3>
                  </Link>
                  {nb.description && (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-2">{nb.description}</p>
                  )}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-gray-500">📄 {getDocCount(nb)}개</span>
                    <span className="text-gray-400">{formatDate(nb.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1 absolute top-4 right-10">
                    <button
                      onClick={() => { setEditId(nb.id); setEditTitle(nb.title); }}
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-blue-50"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500" fill="none" viewBox="0 0 24 24">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => setConfirmId(nb.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이름 수정 모달 */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setEditId(null); }}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">노트북 이름 수정</h2>
            <input
              autoFocus
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveTitle(editId); if (e.key === "Escape") setEditId(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditId(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button onClick={() => handleSaveTitle(editId)} disabled={savingId === editId || !editTitle.trim()}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                {savingId === editId ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">노트북 삭제</h2>
            <p className="text-sm text-gray-500 mb-4">&ldquo;{notebooks.find((n) => n.id === confirmId)?.title}&rdquo;</p>
            <p className="text-sm text-gray-600 mb-5">삭제하면 모든 자료와 대화 기록이 사라집니다.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmId(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button
                onClick={() => handleDelete(confirmId)}
                disabled={deletingId === confirmId}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deletingId === confirmId ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 코드 참여 모달 */}
      {joinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) { setJoinModalOpen(false); setJoinCode(""); } }}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">초대 코드로 참여</h2>
            <p className="text-sm text-gray-500 mb-4">강사에게 받은 6자리 초대 코드를 입력하세요.</p>
            <input
              autoFocus
              type="text"
              placeholder="예: AB1C2D"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); if (e.key === "Escape") { setJoinModalOpen(false); setJoinCode(""); } }}
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center tracking-widest font-bold text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setJoinModalOpen(false); setJoinCode(""); }} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button
                onClick={handleJoin}
                disabled={joining || joinCode.trim().length < 1}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
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
