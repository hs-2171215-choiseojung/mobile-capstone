"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Notebook {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  documents?: { count: number }[];
  notebook_enrollments?: { count: number }[];
  student_count?: number;
  is_starred?: boolean;
}

interface Props {
  notebooks: Notebook[];
  userName: string;
}

export default function InstructorDashboard({ notebooks: initial, userName }: Props) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState(
    initial.map((nb) => ({
      ...nb,
      is_starred: nb.is_starred ?? false,
      student_count: Array.isArray(nb.notebook_enrollments) ? nb.notebook_enrollments[0]?.count || 0 : 0,
    }))
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [inviteLoading, setInviteLoading] = useState(false);

  const starred = notebooks.filter((nb) => nb.is_starred);

  const filtered = notebooks
    .filter((nb) => nb.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return a.title.localeCompare(b.title);
    });

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

  function startEdit(id: string, currentTitle: string) {
    setEditId(id);
    setEditTitle(currentTitle);
    setMenuOpenId(null);
  }

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

  async function handleShare(id: string) {
    setShareId(id);
    setInviteCode("");
    setInviteLoading(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch(`${API}/api/notebooks/${id}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("코드 생성 실패");
      const data = await res.json();
      setInviteCode(data.invite_code);
    } catch (e: unknown) {
      alert(`오류: ${e instanceof Error ? e.message : "오류"}`);
      setShareId(null);
    } finally {
      setInviteLoading(false);
    }
  }

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const cardProps = { onStar: toggleStar, onDelete: (id: string) => setConfirmId(id), onEdit: startEdit, onShare: handleShare, menuOpenId, setMenuOpenId, formatDate, userName } as const;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* 인사말 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">안녕하세요, {userName} 강사님</h1>
        <p className="text-gray-500 mt-2">노트북을 생성하고 학생들과 공유해보세요</p>
      </div>

      {/* 자주 쓰는 노트북 */}
      {starred.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">⭐ 자주 쓰는 노트북</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {starred.map((nb) => (
              <NotebookCard key={`starred-${nb.id}`} nb={nb} menuScope="starred" {...cardProps} />
            ))}
          </div>
        </div>
      )}

      {/* 내 노트북 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">내 노트북 ({notebooks.length}개)</h2>
          <CreateNotebookBtn onCreated={(nb) => setNotebooks((prev) => [{ ...nb, is_starred: false, student_count: 0 }, ...prev])} />
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
              <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input type="text" placeholder="노트북 검색..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
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
              <NotebookCard key={`all-${nb.id}`} nb={nb} menuScope="all" {...cardProps} />
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
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">노트북 삭제</h2>
                <p className="text-sm text-gray-500">&ldquo;{notebooks.find((n) => n.id === confirmId)?.title}&rdquo;</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">삭제하면 모든 자료와 학생 데이터가 사라집니다. 계속하시겠어요?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmId(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button onClick={() => handleDelete(confirmId)} disabled={deletingId === confirmId}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60">
                {deletingId === confirmId ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 공유 모달 */}
      {shareId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setShareId(null); }}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-1">초대 코드 공유</h2>
            <p className="text-sm text-gray-500 mb-4">&ldquo;{notebooks.find((n) => n.id === shareId)?.title}&rdquo;</p>
            {inviteLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">코드 생성 중...</div>
            ) : (
              <>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-3">
                  <span className="flex-1 text-2xl font-bold tracking-widest text-blue-600 text-center">{inviteCode}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(inviteCode); }}
                    className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                    title="복사"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-gray-400 text-center mb-4">학생에게 이 코드를 알려주세요. 학생이 코드를 입력하면 이 노트북에 참여할 수 있습니다.</p>
              </>
            )}
            <div className="flex justify-end">
              <button onClick={() => setShareId(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">닫기</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ── 노트북 카드 ──
function ResponsiveActionLabel({
  singleLine,
  mediumLines,
  narrowLines,
}: {
  singleLine: string;
  mediumLines: string[];
  narrowLines?: string[];
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const singleRef = useRef<HTMLSpanElement | null>(null);
  const mediumRef = useRef<HTMLSpanElement | null>(null);
  const narrowRef = useRef<HTMLSpanElement | null>(null);
  const [layout, setLayout] = useState<"single" | "medium" | "narrow">("single");

  useEffect(() => {
    const container = containerRef.current;
    const single = singleRef.current;
    const medium = mediumRef.current;
    const narrow = narrowRef.current;
    if (!container || !single || !medium) return;

    const updateLayout = () => {
      const availableWidth = container.clientWidth;
      const singleWidth = single.getBoundingClientRect().width;
      const mediumWidth = medium.getBoundingClientRect().width;
      const narrowWidth = narrow?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;

      if (singleWidth <= availableWidth) {
        setLayout("single");
        return;
      }

      if (mediumWidth <= availableWidth || !narrowLines) {
        setLayout("medium");
        return;
      }

      setLayout(narrowWidth <= availableWidth ? "narrow" : "narrow");
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);

    return () => observer.disconnect();
  }, [mediumLines, narrowLines, singleLine]);

  const visibleLines =
    layout === "single" ? [singleLine] : layout === "medium" ? mediumLines : narrowLines ?? mediumLines;

  return (
    <span ref={containerRef} className="relative min-w-0 flex-1 text-center leading-tight">
      <span ref={singleRef} className="invisible absolute left-0 top-0 whitespace-nowrap" aria-hidden="true">
        {singleLine}
      </span>
      <span ref={mediumRef} className="invisible absolute left-0 top-0 inline-block" aria-hidden="true">
        {mediumLines.map((line) => (
          <span key={line} className="block whitespace-nowrap">
            {line}
          </span>
        ))}
      </span>
      {narrowLines ? (
        <span ref={narrowRef} className="invisible absolute left-0 top-0 inline-block" aria-hidden="true">
          {narrowLines.map((line) => (
            <span key={line} className="block whitespace-nowrap">
              {line}
            </span>
          ))}
        </span>
      ) : null}
      <span className="block">
        {visibleLines.map((line) => (
          <span key={line} className="block whitespace-nowrap">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

function NotebookCard({ nb, menuScope, onStar, onDelete, onEdit, onShare, menuOpenId, setMenuOpenId, formatDate, userName }: {
  nb: Notebook & { is_starred: boolean; student_count: number };
  menuScope: "starred" | "all";
  onStar: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, title: string) => void;
  onShare: (id: string) => void;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  formatDate: (d: string) => string;
  userName: string;
}) {
  const menuKey = `${menuScope}-${nb.id}`;

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white hover:border-blue-300 hover:shadow-md transition-all relative flex flex-col gap-2">
      {/* 제목 + 즐겨찾기 + 메뉴 */}
      <div className="flex items-center justify-between gap-1">
        <Link href={`/workspace/${nb.id}?from=/dashboard/instructor`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate flex-1 text-sm">
          {nb.title}
        </Link>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onStar(nb.id)} className="p-1 rounded hover:bg-gray-100 transition-colors">
            {nb.is_starred
              ? <svg className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              : <svg className="w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            }
          </button>
          <div className="relative">
            <button onClick={() => setMenuOpenId(menuOpenId === menuKey ? null : menuKey)} className="p-1 rounded hover:bg-gray-100 transition-colors">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
            {menuOpenId === menuKey && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                <div className="absolute right-0 top-7 z-20 w-32 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                  <button onClick={() => onEdit(nb.id, nb.title)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    수정
                  </button>
                  <button onClick={() => { setMenuOpenId(null); onDelete(nb.id); }}
                    className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex items-center gap-1.5">
        <Link href={`/workspace/${nb.id}?from=/dashboard/instructor`}
          className="notebook-action-button flex-1 min-w-0 gap-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/></svg>
          <ResponsiveActionLabel
            singleLine="학습 생성"
            mediumLines={["학습", "생성"]}
          />
        </Link>
        <Link href={`/dashboard/students?notebook=${nb.id}`}
          className="notebook-action-button flex-1 min-w-0 gap-1 px-2 py-1 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <ResponsiveActionLabel
            singleLine="학생 관리"
            mediumLines={["학생", "관리"]}
            narrowLines={["학생", "관리"]}
          />
        </Link>
        <button onClick={() => onShare(nb.id)} className="w-6 h-6 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors shrink-0" title="초대 코드 공유">
          <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      {/* 학생 수 */}
      <div className="flex items-center gap-1 text-xs text-blue-500">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        {nb.student_count}명
      </div>

      {/* 날짜 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        {userName} · {formatDate(nb.created_at)}
      </div>
    </div>
  );
}

// ── 노트북 생성 버튼 ──
function CreateNotebookBtn({ onCreated }: { onCreated: (nb: Notebook) => void }) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch(`${API}/api/notebooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), notebook_type: "instructor" }),
      });
      if (!res.ok) throw new Error("생성 실패");
      const nb = await res.json();
      onCreated(nb);
      setOpen(false);
      setTitle("");
    } catch (e: unknown) {
      alert(`생성 실패: ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setTitle("");
          setOpen(true);
        }}
        disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        새 노트북
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget && !loading) setOpen(false); }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">노트북 이름 입력</h2>
            <input
              autoFocus
              type="text"
              value={title}
              placeholder="새 노트북"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape" && !loading) setOpen(false);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-60"
              >
                취소
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={loading || !title.trim()}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "생성 중..." : "생성"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
