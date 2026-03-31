"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  X,
  FileText,
  FileQuestion,
  Book,
  Mic,
  Map,
  Layout,
  Video,
  Image as ImageIcon,
  Database,
  ChevronDown,
} from "lucide-react";
import {
  UnifiedGenerateModal,
  UnifiedStudioConfig,
} from "../StudioViews";

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
  { id: "video", label: "동영상 개요", icon: Video, color: "text-red-500", bg: "bg-red-50" },
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

  const getReadableError = (value: unknown, fallback = "생성 실패") => {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) return String((item as any).msg);
          return "";
        })
        .filter(Boolean)
        .join(", ");
      return joined || fallback;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail;
      if (Array.isArray(obj.detail)) return getReadableError(obj.detail, fallback);
      if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
      if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
      try {
        return JSON.stringify(obj);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };

  const hasVisibleTitle = (value?: unknown) =>
    toText(value).replace(/[\s\u200B-\u200D\uFEFF]/g, "").length > 0;

  const [activeTab, setActiveTab] = useState<"week" | "type">("week");
  const [collapsedWeeks, setCollapsedWeeks] = useState<number[]>([]);
  const [collapsedTypes, setCollapsedTypes] = useState<string[]>([]);
  const [weekStateHydrated, setWeekStateHydrated] = useState(false);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);

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

      if (unassignedStudioItems.length > 0) {
        sections.push({
          id: 0,
          title: "주차 미지정",
          allItems: unassignedStudioItems,
        });
      }

      return sections;
    },
    [weeks, studioItems, studioMap]
  );

  const modalWeeks = useMemo(
    () =>
      (weeks ?? []).map((week, index) => ({
        id: week.id ?? index + 1,
        title: week.title || `Week ${week.id ?? index + 1}`,
        status: week.status || "UPCOMING",
        sources: week.sources || [],
        tasks: (week.tasks ?? []).map((task, taskIndex) => ({
          id: taskIndex + 1,
          icon: "",
          iconBg: "",
          title: "",
          subtitle: "",
          itemId: task.itemId,
        })),
      })),
    [weeks]
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

  const handleGenerate = async (typeId: string, cfg: UnifiedStudioConfig, weekId: number | null) => {
    if (!docs.length) {
      alert("학습할 소스(문서)가 없습니다.");
      return;
    }

    setIsGenerating(typeId);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const docIds = cfg.selectedDocIds.length > 0 ? cfg.selectedDocIds : docs.map((d: any) => d.id);
      const docNames = docs.filter((d: any) => docIds.includes(d.id)).map((d: any) => d.filename || d.name).filter(Boolean).join(", ");
      const langMap: Record<string, string> = { "한국어": "ko", "English": "en", "日本語": "ja", "中文": "zh" };
      const lengthMap: Record<string, string> = { "간결하게": "short", "기본값": "medium", "상세하게": "long" };
      const diffMap: Record<string, string> = { "간결하게": "easy", "기본값": "medium", "상세하게": "hard" };
      const countMap: Record<string, number> = { "간결하게": 3, "기본값": 5, "상세하게": 10 };
      const lang = langMap[cfg.language] || "ko";
      const length = lengthMap[cfg.length] || "medium";
      let endpoint = `${API}/api/generate`;
      const payload: any = { doc_ids: docIds, notebook_id: notebookId, week_id: weekId };

      if (typeId === "quiz") {
        payload.type = "quiz";
        payload.quiz_count = countMap[cfg.length] || 5;
        payload.difficulty = diffMap[cfg.length] || "medium";
        payload.topic = cfg.format || cfg.instructions || "";
        payload.item_title = docNames || "퀴즈";
      } else if (typeId === "audio") {
        endpoint += "/audio";
        const audioFormatMap: Record<string, string> = {
          "강의 요약 오디오": "lecture_summary",
          "핵심 개념 설명": "concept_explanation",
          "Q&A 형식": "qa",
          "스토리텔링 방식": "storytelling",
          "토론 형식": "debate",
          "인터뷰 형식": "interview",
        };
        payload.format = audioFormatMap[cfg.format] || "lecture_summary";
        payload.language = lang;
        payload.length = length;
        payload.focus = cfg.instructions;
        payload.item_title = docNames || "오디오";
      } else if (typeId === "mindmap") {
        endpoint += "/mindmap";
        payload.language = lang;
        payload.focus = cfg.instructions || cfg.format;
      } else if (typeId === "flashcard") {
        endpoint += "/flashcard";
        payload.count = countMap[cfg.length] || 5;
        payload.difficulty = diffMap[cfg.length] || "medium";
        payload.topic = cfg.format || cfg.instructions || "";
        payload.language = lang;
        payload.item_title = docNames || "플래시카드";
      } else if (typeId === "slides") {
        endpoint += "/slides";
        payload.format = cfg.format || "lecture";
        payload.length = length;
        payload.language = lang;
        payload.prompt = cfg.instructions;
        payload.item_title = docNames || "슬라이드";
      } else if (typeId === "report") {
        endpoint += "/report";
        payload.format = cfg.format || "report";
        payload.language = lang;
        payload.length = length;
        payload.tone = cfg.style === "구어체" ? "casual" : cfg.style === "학술체" ? "academic" : "formal";
        payload.instructions = cfg.instructions;
        payload.item_title = docNames || "보고서";
      } else if (typeId === "table") {
        throw new Error("데이터 표 생성은 아직 연동 전입니다.");
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getReadableError(data, "생성 실패"));

      setActiveModal(null);
      onRefresh?.();
    } catch (error: any) {
      const message = getReadableError(error?.message ?? error, "생성 중 오류가 발생했습니다.");
      alert(`오류: ${message}`);
    } finally {
      setIsGenerating(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 overflow-hidden" style={{ minHeight: 44 }}>
        <span className="text-gray-800 whitespace-nowrap" style={{ fontSize: "0.92rem", fontWeight: 700 }}>스튜디오</span>
        <button
          onClick={() => setIsMenuOpen(true)}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-blue-100 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors shrink-0"
        >
          <Plus size={14} />
        </button>
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

      {isMenuOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4" onClick={() => setIsMenuOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col min-h-[400px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-white z-10">
              <div>
                <h3 className="text-lg font-bold text-gray-900">AI 학습 자료 자동 생성</h3>
                <p className="text-sm text-gray-500 mt-0.5">강사 소스를 바탕으로 학습 자료를 생성합니다.</p>
              </div>
              <button onClick={() => setIsMenuOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors mb-auto">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-4 overflow-y-auto max-h-[60vh] bg-gray-50 flex-1">
              {STUDIO_CREATION_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (["video", "infographic"].includes(option.id)) {
                        alert("해당 기능은 곧 지원 예정입니다.");
                        return;
                      }
                      setIsMenuOpen(false);
                      setActiveModal(option.id === "slide" ? "slides" : option.id);
                    }}
                    className="relative flex flex-col items-center justify-center p-5 border bg-white rounded-2xl transition-all group border-gray-100 hover:border-blue-400 hover:shadow-md cursor-pointer"
                  >
                    <div className={`w-12 h-12 flex items-center justify-center rounded-full mb-3 transition-transform group-hover:scale-110 ${option.bg}`}>
                      <Icon className={`w-6 h-6 ${option.color}`} />
                    </div>
                    <span className="text-[13px] font-bold text-gray-700 text-center break-keep">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeModal && (
        <UnifiedGenerateModal
          typeId={activeModal}
          loading={isGenerating === activeModal}
          docs={docs as any[]}
          activeDocIds={docs.map((d: any) => d.id)}
          weeks={modalWeeks as any[]}
          initialWeekId={null}
          onClose={() => setActiveModal(null)}
          onGenerate={(cfg, weekId) => handleGenerate(activeModal, cfg, weekId)}
        />
      )}
    </div>
  );
}
