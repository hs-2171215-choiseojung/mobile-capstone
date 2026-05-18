"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FileText,
  FileQuestion,
  Book,
  Mic,
  Map,
  Layout,
  Image as ImageIcon,
  Database,
  ChevronDown,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface StudioItemData {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  created_at: string;
  content?: { week_id?: number; [key: string]: any };
  user_id?: string;
  created_by?: string;
  owner_id?: string;
}

interface WeekPlan {
  id: number;
  title?: string;
  status?: string;
  sources?: any[];
  tasks?: { itemId?: string }[];
}

interface Props {
  studioItems?: StudioItemData[];
  docs?: any[];
  weeks?: WeekPlan[];
  notebookId?: string;
  currentUserId?: string;
  onRefresh?: () => void;
  onOpenItem?: (item: any) => void;
  onOpenDoc?: (docId: string) => void;
}

const STUDIO_CREATION_OPTIONS = [
  { id: "audio", label: "AI 오디오 오버뷰", icon: Mic, color: "text-blue-500", bg: "bg-blue-50" },
  { id: "slide", label: "슬라이드 자료", icon: Layout, color: "text-orange-500", bg: "bg-orange-50" },
  { id: "mindmap", label: "마인드맵", icon: Map, color: "text-green-500", bg: "bg-green-50" },
  { id: "quiz", label: "퀴즈", icon: FileQuestion, color: "text-yellow-600", bg: "bg-yellow-50" },
  { id: "report", label: "보고서", icon: FileText, color: "text-indigo-500", bg: "bg-indigo-50" },
  { id: "flashcard", label: "플래시카드", icon: Book, color: "text-pink-500", bg: "bg-pink-50" },
  { id: "infographic", label: "인포그래픽", icon: ImageIcon, color: "text-teal-500", bg: "bg-teal-50" },
  { id: "table", label: "데이터 표", icon: Database, color: "text-cyan-500", bg: "bg-cyan-50" },
];

function ActionMenu({ onRename, onDelete }: { onRename?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-28 bg-white border border-gray-200 shadow-lg rounded-xl z-[120] overflow-hidden py-1">
            <button
              onClick={() => {
                setOpen(false);
                onRename?.();
              }}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
            >
              이름 변경
            </button>
            <button
              onClick={() => {
                setOpen(false);
                if (window.confirm("정말 삭제하시겠습니까?")) onDelete?.();
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50"
            >
              삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function StudentStudioPanel({
  studioItems = [],
  docs = [],
  weeks = [],
  notebookId,
  currentUserId,
  onRefresh,
  onOpenItem,
}: Props) {
  const toText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "title" in (value as Record<string, unknown>)) {
      return toText((value as Record<string, unknown>).title, fallback);
    }
    return fallback;
  };

  const hasVisibleTitle = (value?: unknown) =>
    toText(value).replace(/[\s\u200B-\u200D\uFEFF]/g, "").length > 0;

  const [activeTab, setActiveTab] = useState<"week" | "type">("week");
  const [collapsedWeeks, setCollapsedWeeks] = useState<number[]>([]);
  const [collapsedTypes, setCollapsedTypes] = useState<string[]>([]);
  const [weekStateHydrated, setWeekStateHydrated] = useState(false);

  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const canManageItem = (item: StudioItemData) => {
    if (!currentUserId) return false;
    const owner = item.user_id || item.created_by || item.owner_id;
    return owner === currentUserId;
  };

  const weekCollapseStorageKey = useMemo(
    () => `student-studio-collapsed-weeks:${notebookId || "default"}`,
    [notebookId]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(weekCollapseStorageKey);
      if (!raw) {
        setCollapsedWeeks([]);
        setWeekStateHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setCollapsedWeeks(
          parsed.filter((value): value is number => typeof value === "number")
        );
        setWeekStateHydrated(true);
      } else {
        setCollapsedWeeks([]);
        setWeekStateHydrated(true);
      }
    } catch {
      setCollapsedWeeks([]);
      setWeekStateHydrated(true);
    }
  }, [weekCollapseStorageKey]);

  useEffect(() => {
    if (!weekStateHydrated) return;
    try {
      localStorage.setItem(weekCollapseStorageKey, JSON.stringify(collapsedWeeks));
    } catch {
      // ignore storage errors
    }
  }, [collapsedWeeks, weekCollapseStorageKey, weekStateHydrated]);

  const studioMap = useMemo(
    () => new globalThis.Map(studioItems.map((item) => [item.id, item])),
    [studioItems]
  );

  const weekSections = useMemo(
    () => {
      const assignedByStudyPlan = new Set(
        weeks
          .flatMap((week) => week.tasks ?? [])
          .map((task) => task.itemId)
          .filter(Boolean) as string[]
      );

      const sections = weeks.map((week, index) => {
        const studyPlanItems = (week.tasks ?? [])
          .map((task) => task.itemId)
          .filter(Boolean)
          .map((itemId) => studioMap.get(itemId as string))
          .filter((item): item is StudioItemData => {
            if (!item) return false;
            return hasVisibleTitle(item.title);
          });

        const weekTaggedItems = studioItems.filter((item) => {
          if (!item?.id) return false;
          if (assignedByStudyPlan.has(item.id)) return false;
          if (!hasVisibleTitle(item.title)) return false;
          return item.content?.week_id === week.id;
        });

        const allItems = [...studyPlanItems, ...weekTaggedItems];

        return {
          id: week.id ?? index + 1,
          title: week.title || `Week ${week.id ?? index + 1}`,
          allItems,
        };
      });

      const unassignedStudioItems = studioItems.filter((item) => {
        if (!item?.id) return false;
        if (assignedByStudyPlan.has(item.id)) return false;
        if (typeof item.content?.week_id === "number") return false;
        return hasVisibleTitle(item.title);
      });

      // 주차 미지정 항목은 학생에게 표시하지 않음

      return sections;
    },
    [weeks, studioItems, studioMap]
  );

  const groupedByType = useMemo(() => {
    const getMappedOption = (rawType: string) => {
      const typeMap: Record<string, string> = { memo: "notepad", summary: "report", plan: "mindmap", slides: "slide", data: "table" };
      const mappedId = typeMap[rawType] || rawType;
      return (
        STUDIO_CREATION_OPTIONS.find((opt) => opt.id === mappedId) ||
        { id: rawType, label: "학습 자료", icon: FileText, color: "text-gray-500", bg: "bg-gray-50" }
      );
    };

    return studioItems.reduce((acc, item) => {
      const option = getMappedOption(item.type);
      if (!acc[option.id]) acc[option.id] = { option, items: [] as StudioItemData[] };
      acc[option.id].items.push(item);
      return acc;
    }, {} as Record<string, { option: any; items: StudioItemData[] }>);
  }, [studioItems]);

  const toggleWeekCollapse = (weekNum: number) => {
    setCollapsedWeeks((prev) => (prev.includes(weekNum) ? prev.filter((w) => w !== weekNum) : [...prev, weekNum]));
  };

  const toggleTypeCollapse = (typeId: string) => {
    setCollapsedTypes((prev) => (prev.includes(typeId) ? prev.filter((t) => t !== typeId) : [...prev, typeId]));
  };

  const startRename = (item: StudioItemData) => {
    setRenamingItemId(item.id);
    setRenameValue(toText(item.title));
  };

  const commitRename = async (itemId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingItemId(null);
      return;
    }
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${API}/api/studio/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) onRefresh?.();
    } finally {
      setRenamingItemId(null);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${API}/api/studio/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) onRefresh?.();
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 overflow-hidden" style={{ minHeight: 44 }}>
        <span className="text-gray-800 whitespace-nowrap" style={{ fontSize: "0.92rem", fontWeight: 700 }}>스튜디오</span>
      </div>

      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex gap-2">
          <button onClick={() => setActiveTab("week")} className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${activeTab === "week" ? "bg-blue-500 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`} style={{ fontSize: "0.75rem", fontWeight: 600 }}>주차별</button>
          <button onClick={() => setActiveTab("type")} className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${activeTab === "type" ? "bg-blue-500 text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`} style={{ fontSize: "0.75rem", fontWeight: 600 }}>종류별</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {activeTab === "week" ? (
          <div className="flex flex-col pb-4">
            {weekSections.length === 0 ? (
              <div className="px-4 py-6">
                <p className="text-gray-400 text-center text-sm">강사가 추가한 주차가 아직 없습니다.</p>
              </div>
            ) : (
              weekSections.map((week) => {
                const isCollapsed = collapsedWeeks.includes(week.id);
                const allItems = week.allItems;

                return (
                  <div key={week.id} className="border-b border-gray-100 last:border-0 relative">
                    <div className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleWeekCollapse(week.id)}>
                      <div className="text-gray-400 transition-transform shrink-0" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}><ChevronDown size={13} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>{toText(week.title, "주차")}</p>
                        <p className="text-gray-400" style={{ fontSize: "0.63rem" }}>{allItems.length}개</p>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="pb-1">
                        {allItems.length === 0 ? (
                          <div className="px-4 py-2"><p className="text-gray-300" style={{ fontSize: "0.7rem" }}>항목 없음</p></div>
                        ) : (
                          allItems.map((item, i) => {
                              const option = STUDIO_CREATION_OPTIONS.find((o) =>
                                o.id === item.type ||
                                (o.id === "slide" && item.type === "slides") ||
                                (o.id === "table" && item.type === "data")
                              ) || STUDIO_CREATION_OPTIONS[0];
                              const Icon = option.icon;
                              const iconNode = <Icon size={11} className="text-blue-500" />;

                              return (
                                <div
                                  key={item.id || i}
                                  onClick={() => onOpenItem && onOpenItem(item)}
                                  className="flex items-center gap-2 px-4 py-1.5 transition-colors group cursor-pointer hover:bg-gray-50"
                                >
                                  {renamingItemId !== item.id && (
                                    <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "#EFF6FF" }}>
                                      {iconNode}
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
                                    <div className="flex-1 min-w-0">
                                      {renamingItemId === item.id ? (
                                        <input
                                          autoFocus
                                          value={renameValue}
                                          onChange={(e) => setRenameValue(e.target.value)}
                                          onBlur={() => commitRename(item.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              commitRename(item.id);
                                            }
                                            if (e.key === "Escape") setRenamingItemId(null);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full bg-transparent border-b border-blue-400 outline-none truncate text-gray-700 py-0.5"
                                          style={{ fontSize: "0.72rem", fontWeight: 500 }}
                                        />
                                      ) : (
                                        <p className="text-gray-700 truncate" style={{ fontSize: "0.72rem", fontWeight: 500 }}>
                                          {toText(item.title, "제목 없음")}
                                        </p>
                                      )}
                                    </div>

                                    {renamingItemId !== item.id && canManageItem(item) && (
                                      <ActionMenu onRename={() => startRename(item)} onDelete={() => handleDeleteItem(item.id)} />
                                    )}
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex flex-col pb-4">
            {studioItems.filter((item) => hasVisibleTitle(item.title)).length === 0 ? (
              <p className="text-gray-400 text-center py-8" style={{ fontSize: "0.75rem" }}>생성된 스튜디오 자료가 없습니다.</p>
            ) : (
              Object.values(groupedByType).map(({ option, items }) => {
                const visibleItems = items.filter((item) => hasVisibleTitle(item.title));
                if (visibleItems.length === 0) return null;
                const isCollapsed = collapsedTypes.includes(option.id);
                const Icon = option.icon;

                return (
                  <div key={option.id} className="border-b border-gray-100 last:border-0 relative">
                    <div className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleTypeCollapse(option.id)}>
                      <div className="text-gray-400 transition-transform shrink-0" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}><ChevronDown size={13} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>{option.label}</p>
                        <p className="text-gray-400" style={{ fontSize: "0.63rem" }}>{visibleItems.length}개</p>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="pb-1">
                        {visibleItems.map((item) => (
                          <div key={item.id} onClick={() => onOpenItem && onOpenItem(item)} className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors group">
                            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "#EFF6FF" }}><Icon size={11} className="text-blue-500" /></div>
                            <div className="flex-1 min-w-0 flex items-center justify-between">
                              <p className="text-gray-700 truncate transition-colors group-hover:text-blue-600" style={{ fontSize: "0.72rem", fontWeight: 500 }}>{toText(item.title, "제목 없음")}</p>
                              <span className="text-gray-400 shrink-0 ml-2" style={{ fontSize: "0.6rem" }}>{toText(item.subtitle, option.label)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

    </div>
  );
}
