"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StudioPanel, { type SavedItem } from "@/components/workspace/StudioPanel";
import { inferDocType, type Doc } from "@/components/workspace/SourcePanel";
import StudyULogo from "@/components/StudyULogo";
import { StudioItemViewer } from "@/components/workspace/student/StudioItemViewer";
import { SharedSourceViewer } from "@/components/workspace/SharedSourceViewer";
import MarkdownPreview from "@/components/workspace/MarkdownPreview";

const PREVIEWABLE_OFFICE_EXTS = new Set(["docx", "pptx", "ppt"]);
function getOfficeEmbedUrl(url: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function downloadUrl(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl; a.download = filename; a.click();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}
function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────
interface Notebook {
  id: string;
  title: string;
  description?: string;
}

interface InitialDoc {
  id: string;
  filename: string;
  chunk_count: number | null;
  file_type?: string | null;
  storage_path?: string | null;
}

export interface WeekSource {
  id: number;
  name: string;
  icon: string;
  iconBg: string;
  docId?: string;
}

type UnassignedStudioItem = SavedItem;

export interface WeekTask {
  id: number;
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
  itemId?: string;
  studioType?: string;
  generating?: boolean;
  generatingError?: string;
}

export interface Week {
  id: number;
  title: string;
  status: string;
  sources: WeekSource[];
  tasks: WeekTask[];
}

interface StudioTaskItem {
  id: string;
  label: string;
  icon: string;
  iconBg: string;
  subtitle: string;
  presets: string[];
}

interface SourceType {
  id: string;
  label: string;
  icon: string;
  iconBg: string;
  subtitle: string;
  hasUrl: boolean;
  hasText: boolean;
}

interface Props {
  notebook: Notebook;
  initialDocs: InitialDoc[];
  backUrl: string;
}

// ── Constants ─────────────────────────────────────────────────────────
const SUPPORTED_EXTENSIONS = new Set([
  "pdf","docx","pptx","ppt","hwp","hwpx",
  "jpg","jpeg","png","gif","webp",
  "mp4","mov","avi","mkv","webm","mp3","m4a",
]);

const studioTaskItems: StudioTaskItem[] = [
  { id:"audio",      label:"AI 오디오 오버뷰", icon:"🎧", iconBg:"bg-purple-50",  subtitle:"AI가 생성한 오디오 요약",
    presets:["강의 요약 오디오","핵심 개념 설명","Q&A 형식","스토리텔링 방식","토론 형식","인터뷰 형식"] },
  { id:"slides",     label:"슬라이드 자료",   icon:"📊", iconBg:"bg-blue-50",    subtitle:"프레젠테이션 슬라이드 생성",
    presets:["강의 슬라이드","요약 슬라이드","발표 자료","학습 정리 슬라이드","비교 분석 슬라이드","사례 연구 슬라이드"] },
  { id:"video",      label:"동영상 개요",     icon:"🎬", iconBg:"bg-red-50",     subtitle:"동영상 학습 자료 개요",
    presets:["강의 개요","실습 영상 개요","애니메이션 시나리오","튜토리얼 개요","다큐멘터리 형식","인터뷰 개요"] },
  { id:"mindmap",    label:"마인드맵",        icon:"🧠", iconBg:"bg-green-50",   subtitle:"개념 연결 마인드맵",
    presets:["개념 구조도","인과관계 맵","비교 분석 맵","학습 흐름도","키워드 맵","프로세스 맵"] },
  { id:"report",     label:"보고서",          icon:"📝", iconBg:"bg-amber-50",   subtitle:"학습 내용 보고서 작성",
    presets:["학습 가이드","블로그 게시물","제품 요구사항 정의서","시스템 아키텍처 설계서","기술 개념 설명서","학습 활용 가이드"] },
  { id:"flashcard",  label:"플래시카드",      icon:"🃏", iconBg:"bg-pink-50",    subtitle:"핵심 개념 플래시카드",
    presets:["단어·정의 카드","Q&A 카드","빈칸 채우기 카드","이미지 연상 카드","공식 암기 카드","사례 카드"] },
  { id:"quiz",       label:"퀴즈",            icon:"✅", iconBg:"bg-emerald-50", subtitle:"이해도 확인 퀴즈",
    presets:["객관식 퀴즈","O/X 퀴즈"] },
  { id:"infographic",label:"인포그래픽",     icon:"📈", iconBg:"bg-orange-50",  subtitle:"시각화 인포그래픽",
    presets:["개요형","프로세스형","비교형","통계형","타임라인형"] },
  { id:"table",      label:"데이터 표",       icon:"📋", iconBg:"bg-slate-50",   subtitle:"정형화된 데이터 표",
    presets:["핵심 내용 정리표","비교 분석 표","개념 정의 표","학습 점검표","진도 추적 표"] },
];

const sourceTypes: SourceType[] = [
  { id:"pdf",         label:"PDF 파일",       icon:"📄", iconBg:"bg-red-50",    subtitle:"PDF 문서 업로드",    hasUrl:false, hasText:false },
  { id:"url",         label:"URL 링크",       icon:"🔗", iconBg:"bg-blue-50",   subtitle:"웹페이지 링크 추가", hasUrl:true,  hasText:false },
  { id:"youtube",     label:"YouTube",        icon:"🎬", iconBg:"bg-red-50",    subtitle:"유튜브 영상 링크",   hasUrl:true,  hasText:false },
  { id:"text",        label:"텍스트 입력",    icon:"📝", iconBg:"bg-amber-50",  subtitle:"직접 텍스트 작성",   hasUrl:false, hasText:true },
  { id:"image",       label:"이미지",         icon:"🖼️", iconBg:"bg-purple-50", subtitle:"이미지 파일 첨부",   hasUrl:false, hasText:false },
  { id:"spreadsheet", label:"스프레드시트",   icon:"📊", iconBg:"bg-green-50",  subtitle:"엑셀·구글 시트",     hasUrl:true,  hasText:false },
];

async function getToken(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

// ── Main Component ─────────────────────────────────────────────────────
export default function InstructorWorkspace({ notebook, initialDocs, backUrl }: Props) {
  const router = useRouter();

  // Docs (backend)
  const [docs, setDocs] = useState<Doc[]>(
    initialDocs.map((d) => ({
      id: d.id,
      name: d.filename,
      chunks: d.chunk_count ?? 0,
      type: inferDocType(d.file_type, d.filename, d.storage_path ?? undefined),
    }))
  );
  const [activeDocIds, setActiveDocIds] = useState<string[]>(initialDocs.map((d) => d.id));

  // Study plan (Supabase DB)
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [weeksLoaded, setWeeksLoaded] = useState(false);
  const [weeksReadyForSave, setWeeksReadyForSave] = useState(false);

  // 초기 로드
  useEffect(() => {
    setWeeksLoaded(false);
    setWeeksReadyForSave(false);
    getToken().then((token) => {
      fetch(`${API}/api/notebooks/${notebook.id}/study-plan`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(data?.detail ?? "주차 정보를 불러오지 못했습니다.");
          }
          return data;
        })
        .then((data) => {
          setWeeks(Array.isArray(data.plan_data) ? data.plan_data : []);
          setWeeksReadyForSave(true);
        })
        .catch((error) => {
          console.error("[study-plan] load failed", error);
        })
        .finally(() => setWeeksLoaded(true));
    });
  }, [notebook.id]);

  // 변경 시 저장 (debounce 500ms)
  useEffect(() => {
    if (!weeksLoaded || !weeksReadyForSave) return;
    const timer = setTimeout(() => {
      getToken().then((token) => {
        fetch(`${API}/api/notebooks/${notebook.id}/study-plan`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plan_data: weeks }),
        })
          .then(async (r) => {
            if (!r.ok) {
              const data = await r.json().catch(() => ({}));
              throw new Error(data?.detail ?? "주차 저장에 실패했습니다.");
            }
          })
          .catch((error) => {
            console.error("[study-plan] save failed", error);
          });
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [weeks, notebook.id, weeksLoaded, weeksReadyForSave]);

  // Sidebar widths
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(272);
  const [activeView, setActiveView] = useState("sources");
  const [studioOpenItemId, setStudioOpenItemId] = useState<string | null>(null);
  const [studioCreateType, setStudioCreateType] = useState<string | null>(null);
  const [studioCreateWeekId, setStudioCreateWeekId] = useState<number | null>(null);
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [studioMemoRequest, setStudioMemoRequest] = useState(0);
  const [studioMenuPosition, setStudioMenuPosition] = useState({ top: 0, left: 0 });
  const [studioMenuReady, setStudioMenuReady] = useState(false);
  const isResizingLeft = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  // Chunk expansion (left sidebar)
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [activeChunkDocIds, setActiveChunkDocIds] = useState<Set<string>>(new Set(initialDocs.map((d) => d.id)));

  // Upload
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [showAddSourceMenu, setShowAddSourceMenu] = useState(false);

  // Document viewer
  const [viewerDoc, setViewerDoc] = useState<{ id: string; name: string; type: string } | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerFileUrl, setViewerFileUrl] = useState<string | null>(null);
  const [viewerText, setViewerText] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  // Studio item viewer
  const [viewerStudioItem, setViewerStudioItem] = useState<any | null>(null);
  const [viewerStudioExpanded, setViewerStudioExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [studioItems, setStudioItems] = useState<UnassignedStudioItem[]>([]);

  // Drag-and-drop from Studio panel
  const [dropTargetWeekId, setDropTargetWeekId] = useState<number | null>(null);
  const [draggingCard, setDraggingCard] = useState<{ weekId: number; cardType: "source" | "task"; cardId: number } | null>(null);
  const [dragOverCard, setDragOverCard] = useState<{ weekId: number; cardType: "source" | "task"; cardId: number; half: "top" | "bottom" } | null>(null);
  const [collapsedWeekIds, setCollapsedWeekIds] = useState<Set<number>>(new Set());

  const studyPlanScrollRef = useRef<HTMLDivElement>(null);
  const studyPlanScrollTopRef = useRef(0);
  const restoreStudyPlanScrollPendingRef = useRef(false);
  const weekCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingScrollWeekIdRef = useRef<number | null>(null);

  const scrollToWeek = (weekId: number) => {
    setTimeout(() => {
      const el = weekCardRefs.current.get(weekId);
      if (el && studyPlanScrollRef.current) {
        const container = studyPlanScrollRef.current;
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + elRect.top - containerRect.top - 16, behavior: "smooth" });
      }
    }, 50);
  };

  const saveStudyPlanScrollPosition = useCallback(() => {
    if (studyPlanScrollRef.current) {
      studyPlanScrollTopRef.current = studyPlanScrollRef.current.scrollTop;
    }
  }, []);

  const restoreStudyPlanScrollPosition = useCallback(() => {
    if (!restoreStudyPlanScrollPendingRef.current) return;
    const container = studyPlanScrollRef.current;
    if (!container) return;
    container.scrollTop = studyPlanScrollTopRef.current;
    restoreStudyPlanScrollPendingRef.current = false;
  }, []);

  useEffect(() => {
    if (!viewerStudioItem) setViewerStudioExpanded(false);
  }, [viewerStudioItem]);

  useEffect(() => {
    if (!viewerDoc && !viewerStudioItem) {
      window.requestAnimationFrame(() => {
        restoreStudyPlanScrollPosition();
      });
    }
  }, [viewerDoc, viewerStudioItem, restoreStudyPlanScrollPosition]);

  useEffect(() => {
    const pendingWeekId = pendingScrollWeekIdRef.current;
    if (pendingWeekId === null) return;

    const frameId = window.requestAnimationFrame(() => {
      const el = weekCardRefs.current.get(pendingWeekId);
      const container = studyPlanScrollRef.current;
      if (!el || !container) return;

      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const isAbove = elRect.top < containerRect.top + 16;
      const isBelow = elRect.bottom > containerRect.bottom - 16;

      if (isAbove || isBelow) {
        container.scrollTo({
          top: container.scrollTop + elRect.top - containerRect.top - 16,
          behavior: "smooth",
        });
      }

      pendingScrollWeekIdRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [weeks]);

  const closeStudioViewer = () => {
    restoreStudyPlanScrollPendingRef.current = true;
    setViewerStudioExpanded(false);
    setViewerStudioItem(null);
  };

  // Add Task modal
  const [openPickerWeekId, setOpenPickerWeekId] = useState<number | null>(null);
  const [selectedPickerItem, setSelectedPickerItem] = useState<StudioTaskItem | null>(null);
  const [detailConfig, setDetailConfig] = useState({
    format: "", instructions: "", length: "10문제", language: "한국어", style: "격식체",
    selectedSources: [] as number[],
  });
  const [pickerSelectedWeekId, setPickerSelectedWeekId] = useState<number | null>(null);
  const [pickerOpenedFromStudioMenu, setPickerOpenedFromStudioMenu] = useState(false);
  const [pickerSourcesCollapsed, setPickerSourcesCollapsed] = useState(false);
  const [generatingTask, setGeneratingTask] = useState(false);

  // Add Source modal
  const [openSourcePickerWeekId, setOpenSourcePickerWeekId] = useState<number | null>(null);
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType | null>(null);
  const [sourceForm, setSourceForm] = useState({ title: "", url: "", text: "" });
  const [pickedDocIds, setPickedDocIds] = useState<string[]>([]);

  // Week editing
  const [editingWeekId, setEditingWeekId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Task renaming
  const [renamingTask, setRenamingTask] = useState<{ weekId: number; taskId: number } | null>(null);
  const [renamingTaskTitle, setRenamingTaskTitle] = useState("");
  const [renamingSource, setRenamingSource] = useState<{ weekId: number; sourceId: number; docId?: string } | null>(null);
  const [renamingSourceTitle, setRenamingSourceTitle] = useState("");
  const [leftSourcesCollapsed, setLeftSourcesCollapsed] = useState(false);
  const [leftStudioItemsCollapsed, setLeftStudioItemsCollapsed] = useState(false);
  const studioMenuButtonRef = useRef<HTMLButtonElement>(null);
  const studioMenuRef = useRef<HTMLDivElement>(null);

  // Share modal
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileInitial, setProfileInitial] = useState("I");
  const [profileName, setProfileName] = useState("Instructor");
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) return;

      const avatar =
        typeof user.user_metadata?.avatar_url === "string"
          ? user.user_metadata.avatar_url
          : typeof user.user_metadata?.picture === "string"
            ? user.user_metadata.picture
            : null;

      const metadataNameCandidates = [
        user.user_metadata?.display_name,
        user.user_metadata?.name,
        user.user_metadata?.full_name,
      ];
      const metadataName = metadataNameCandidates.find(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )?.trim();

      let resolvedName = metadataName || "";
      if (!resolvedName) {
        const { data: profile } = await supabase
          .from("users")
          .select("display_name")
          .eq("id", user.id)
          .single();
        if (typeof profile?.display_name === "string" && profile.display_name.trim()) {
          resolvedName = profile.display_name.trim();
        }
      }

      const seed = resolvedName || "Instructor";

      setProfileAvatarUrl(avatar);
      setProfileInitial(seed[0]?.toUpperCase() || "I");
      setProfileName(seed);
    });
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [profileMenuOpen]);

  const resetViewerState = useCallback((nextDocs: Doc[] = docs) => {
    restoreStudyPlanScrollPendingRef.current = true;
    setViewerDoc(null);
    setViewerUrl(null);
    setViewerFileUrl(null);
    setViewerText(null);
    setViewerStudioItem(null);
    setActiveDocIds(nextDocs.map((doc) => doc.id));
    setActiveChunkDocIds(new Set(nextDocs.map((doc) => doc.id)));
  }, [docs]);

  const openStudioViewer = useCallback((item: any) => {
    saveStudyPlanScrollPosition();
    setViewerDoc(null);
    setViewerUrl(null);
    setViewerText(null);
    setViewerFileUrl(null);
    setViewerStudioItem(item);
  }, [saveStudyPlanScrollPosition]);

  const assignedStudioItemIds = new Set(
    weeks.flatMap((week) => week.tasks.map((task) => task.itemId).filter(Boolean) as string[])
  );
  const unassignedStudioItems = studioItems.filter((item) => !assignedStudioItemIds.has(item.id));
  const bothLeftSectionsOpen = !leftSourcesCollapsed && !leftStudioItemsCollapsed;
  const sourceSectionClass = bothLeftSectionsOpen ? "flex-1" : leftSourcesCollapsed ? "shrink-0" : "flex-1";
  const studioSectionClass = bothLeftSectionsOpen ? "flex-1" : leftStudioItemsCollapsed ? "shrink-0" : "flex-1";

  // ── Resize handlers ───────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isResizingLeft.current) {
        const delta = e.clientX - startX.current;
        setLeftSidebarWidth(Math.max(180, Math.min(480, startW.current + delta)));
      }
    };
    const onUp = () => {
      isResizingLeft.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const startLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeft.current = true;
    startX.current = e.clientX;
    startW.current = leftSidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftSidebarWidth]);

  useEffect(() => {
    if (!showAddSourceMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-add-source-menu]")) setShowAddSourceMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddSourceMenu]);

  useLayoutEffect(() => {
    if (!studioMenuOpen) return;
    setStudioMenuReady(false);
    const updatePosition = () => {
      const rect = studioMenuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = studioMenuRef.current?.getBoundingClientRect().height ?? 520;
      const maxTop = Math.max(16, window.innerHeight - menuHeight - 16);
      setStudioMenuPosition({
        top: Math.min(Math.max(16, rect.top), maxTop),
        left: Math.min(window.innerWidth - 396, rect.right + 12),
      });
    };
    updatePosition();
    const rafId = window.requestAnimationFrame(() => {
      updatePosition();
      setStudioMenuReady(true);
    });
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-studio-menu]")) {
        setStudioMenuOpen(false);
        setStudioMenuReady(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handler);
    return () => {
      window.cancelAnimationFrame(rafId);
      setStudioMenuReady(false);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handler);
    };
  }, [studioMenuOpen]);

  // ── Upload handlers ───────────────────────────────────────────────
  async function handleUpload(file: File) {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      alert(`지원하지 않는 파일 형식입니다.\n지원 형식: PDF, PPTX, DOCX, HWP, 이미지(JPG/PNG/GIF/WEBP), 비디오(MP4/MOV/AVI/MKV), 오디오(MP3/M4A)`);
      return;
    }
    setUploading(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("notebook_id", notebook.id);
      const res = await fetch(`${API}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "업로드 실패");
      const newDoc: Doc = { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: data.file_type ?? ext };
      setDocs((prev) => [...prev, newDoc]);
      setActiveDocIds((prev) => [...prev, newDoc.id]);
      setActiveChunkDocIds((prev) => { const n = new Set(prev); n.add(newDoc.id); return n; });
    } catch (e) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleIngestUrl() {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      alert("올바른 URL을 입력해주세요");
      return;
    }
    setUrlLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/ingest_url`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notebook_id: notebook.id, url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "URL 추가 실패");
      const newDoc: Doc = { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: "url" };
      setDocs((prev) => [...prev, newDoc]);
      setActiveDocIds((prev) => [...prev, newDoc.id]);
      setActiveChunkDocIds((prev) => { const n = new Set(prev); n.add(newDoc.id); return n; });
      setUrlValue("");
      setShowUrlInput(false);
    } catch (e) {
      alert(`URL 추가 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUrlLoading(false);
    }
  }

  async function handleViewDoc(doc: { id: string; name: string; type: string }) {
    const resolvedDoc = docs.find((entry) => entry.id === doc.id);
    const effectiveDoc = resolvedDoc
      ? { id: resolvedDoc.id, name: resolvedDoc.name ?? doc.name, type: resolvedDoc.type ?? doc.type }
      : doc;

    saveStudyPlanScrollPosition();
    setViewerStudioItem(null);
    setViewerDoc(effectiveDoc);
    setActiveDocIds([effectiveDoc.id]);
    setActiveChunkDocIds(new Set([effectiveDoc.id]));
    setViewerUrl(null);
    setViewerFileUrl(null);
    setViewerText(null);
    setViewerLoading(true);
    try {
      const token = await getToken();
      const ext = effectiveDoc.name.toLowerCase().split(".").pop() ?? effectiveDoc.type;
      const AUDIO_EXTS = new Set(["mp3", "m4a"]);
      const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);
      const TEXT_ONLY_EXTS = new Set(["docx", "pptx", "ppt", "hwp", "hwpx"]);

      // URL 타입: 원본 URL + 텍스트
      if (effectiveDoc.type === "url") {
        const [urlRes, textRes] = await Promise.all([
          fetch(`${API}/api/documents/${effectiveDoc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/documents/${effectiveDoc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const urlData = await urlRes.json();
        const textData = await textRes.json();
        setViewerUrl(urlData.url ?? null);
        setViewerText(textData.text ?? "");
        return;
      }

      // 오디오: URL + 텍스트
      if (AUDIO_EXTS.has(ext)) {
        const [urlRes, textRes] = await Promise.all([
          fetch(`${API}/api/documents/${effectiveDoc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/documents/${effectiveDoc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const urlData = await urlRes.json();
        const textData = await textRes.json();
        setViewerUrl(urlData.url ?? null);
        setViewerFileUrl(urlData.url ?? null);
        setViewerText(textData.text ?? "");
        return;
      }

      // 비디오: URL + 텍스트
      if (VIDEO_EXTS.has(ext)) {
        const [urlRes, textRes] = await Promise.all([
          fetch(`${API}/api/documents/${effectiveDoc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/documents/${effectiveDoc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const urlData = await urlRes.json();
        const textData = await textRes.json();
        setViewerUrl(urlData.url ?? null);
        setViewerFileUrl(urlData.url ?? null);
        setViewerText(textData.text ?? "");
        return;
      }

      // DOCX: access-url + 텍스트 (Microsoft Office Online 뷰어 사용)
      if (ext === "docx") {
        const [urlRes, textRes] = await Promise.all([
          fetch(`${API}/api/documents/${doc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/documents/${doc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const urlData = await urlRes.json();
        const textData = await textRes.json();
        setViewerFileUrl(urlData.url ?? null);
        setViewerText(textData.text ?? "");
        if (urlData.url) {
          setViewerUrl(getOfficeEmbedUrl(urlData.url));
        }
        return;
      }

      // PPTX/PPT: Office Online 뷰어 (학생 화면과 동일)
      if (PREVIEWABLE_OFFICE_EXTS.has(ext)) {
        const [urlRes, textRes] = await Promise.all([
          fetch(`${API}/api/documents/${effectiveDoc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/documents/${effectiveDoc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const urlData = await urlRes.json();
        const textData = await textRes.json();
        setViewerFileUrl(urlData.url ?? null);
        setViewerText(textData.text ?? "");
        if (urlData.url) {
          setViewerUrl(getOfficeEmbedUrl(urlData.url));
        }
        return;
      }

      // HWP: 텍스트만
      if (TEXT_ONLY_EXTS.has(ext)) {
        const res = await fetch(`${API}/api/documents/${effectiveDoc.id}/chunks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setViewerText(data.text ?? "");
        return;
      }

      // PDF, 이미지: URL만
      const res = await fetch(`${API}/api/documents/${effectiveDoc.id}/access-url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setViewerUrl(data.url ?? null);
      setViewerFileUrl(data.url ?? null);
    } catch (e) {
      alert(`파일 불러오기 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      setViewerDoc(null);
      setActiveDocIds(docs.map((d) => d.id));
      setActiveChunkDocIds(new Set(docs.map((d) => d.id)));
    } finally {
      setViewerLoading(false);
    }
  }

  async function handleDeleteDoc(docId: string) {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/${docId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? "삭제 실패"); }
      let nextDocsSnapshot: Doc[] = [];
      setDocs((prev) => {
        const next = prev.filter((d) => d.id !== docId);
        nextDocsSnapshot = next;
        return next;
      });
      setWeeks((prev) =>
        prev.map((week) => ({
          ...week,
          sources: week.sources.filter((source) => source.docId !== docId && (source as any).doc_id !== docId),
        }))
      );
      if (viewerDoc?.id === docId) {
        resetViewerState(nextDocsSnapshot);
      } else {
        setActiveDocIds((prev) => prev.filter((id) => id !== docId));
        setActiveChunkDocIds((prev) => { const n = new Set(prev); n.delete(docId); return n; });
      }
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    }
  }

  // ── Add Source modal handlers ─────────────────────────────────────
  async function handleSourceFileUpload(file: File) {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      alert("지원하지 않는 파일 형식입니다.");
      return;
    }
    setSourceSubmitting(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("notebook_id", notebook.id);
      const res = await fetch(`${API}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "업로드 실패");
      const newDoc: Doc = { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: data.file_type ?? ext };
      setDocs((prev) => [...prev, newDoc]);
      setActiveDocIds((prev) => [...prev, newDoc.id]);
      setActiveChunkDocIds((prev) => { const n = new Set(prev); n.add(newDoc.id); return n; });
      // Add to week sources if a specific week was selected
      const weekId = openSourcePickerWeekId;
      if (weekId && weekId > 0) {
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== weekId) return w;
          const maxId = w.sources.length > 0 ? Math.max(...w.sources.map((s) => s.id)) : 0;
          return { ...w, sources: [...w.sources, { id: maxId + 1, name: data.filename, icon: "📄", iconBg: "bg-red-50", docId: data.doc_id }] };
        }));
      }
      closeSourceModal();
    } catch (e) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setSourceSubmitting(false);
    }
  }

  async function handleAddSource(weekId: number) {
    if (!selectedSourceType || !sourceForm.title.trim()) return;
    setSourceSubmitting(true);
    try {
      const isLinkType = ["url","youtube","spreadsheet"].includes(selectedSourceType.id);
      if (selectedSourceType.hasUrl && sourceForm.url.trim()) {
        const token = await getToken();
        const res = await fetch(`${API}/api/documents/ingest_url`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ notebook_id: notebook.id, url: sourceForm.url.trim(), filename: sourceForm.title.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "URL 추가 실패");
        const newDoc: Doc = { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: "url" };
        setDocs((prev) => [...prev, newDoc]);
        setActiveDocIds((prev) => [...prev, newDoc.id]);
        setActiveChunkDocIds((prev) => { const n = new Set(prev); n.add(newDoc.id); return n; });
        if (weekId > 0) {
          setWeeks((prev) => prev.map((w) => {
            if (w.id !== weekId) return w;
            const maxId = w.sources.length > 0 ? Math.max(...w.sources.map((s) => s.id)) : 0;
            return { ...w, sources: [...w.sources, { id: maxId + 1, name: data.filename, icon: selectedSourceType.icon, iconBg: selectedSourceType.iconBg, docId: data.doc_id }] };
          }));
        }
      } else if (selectedSourceType.hasText && sourceForm.text.trim()) {
        // Text source — add locally to sidebar only (no backend for raw text yet)
        if (weekId === -1 || weekId > 0) {
          // Just add as week source without doc
          if (weekId > 0) {
            setWeeks((prev) => prev.map((w) => {
              if (w.id !== weekId) return w;
              const maxId = w.sources.length > 0 ? Math.max(...w.sources.map((s) => s.id)) : 0;
              return { ...w, sources: [...w.sources, { id: maxId + 1, name: sourceForm.title.trim(), icon: selectedSourceType.icon, iconBg: selectedSourceType.iconBg }] };
            }));
          }
        }
      } else {
        // File-based source without URL - trigger file input
        sourceFileInputRef.current?.click();
        setSourceSubmitting(false);
        return;
      }
    } catch (e) {
      alert(`소스 추가 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setSourceSubmitting(false);
    }
    closeSourceModal();
  }

  function closeSourceModal() {
    setOpenSourcePickerWeekId(null);
    setSelectedSourceType(null);
    setSourceForm({ title: "", url: "", text: "" });
    setPickedDocIds([]);
  }

  function buildWeekSourceFromDoc(doc: Doc, nextId: number): WeekSource {
    const ext = (doc.type ?? "").toLowerCase();
    const icon =
      ext === "pdf" ? "📜" :
      ext === "url" ? "🔗" :
      ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? "🖼️" :
      ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? "🎥" :
      ["mp3", "m4a", "wav"].includes(ext) ? "🎧" :
      "📄";
    const iconBg = ext === "pdf" ? "bg-red-50" : ext === "url" ? "bg-purple-50" : "bg-blue-50";
    return { id: nextId, name: doc.name ?? doc.id, icon, iconBg, docId: doc.id };
  }

  function buildWeekTaskFromStudioItem(item: UnassignedStudioItem, nextId: number): WeekTask {
    return {
      id: nextId,
      icon:
        item.type === "audio" ? "🎧" :
        item.type === "slides" ? "📊" :
        item.type === "video" ? "🎬" :
        item.type === "mindmap" ? "🗺️" :
        item.type === "report" ? "📝" :
        item.type === "flashcard" ? "🃏" :
        item.type === "quiz" ? "❓" :
        item.type === "infographic" ? "📈" :
        item.type === "data" ? "📋" :
        "📄",
      iconBg:
        item.type === "audio" ? "bg-purple-50" :
        item.type === "slides" ? "bg-blue-50" :
        item.type === "video" ? "bg-red-50" :
        item.type === "mindmap" ? "bg-green-50" :
        item.type === "report" ? "bg-amber-50" :
        item.type === "flashcard" ? "bg-pink-50" :
        item.type === "quiz" ? "bg-emerald-50" :
        item.type === "infographic" ? "bg-orange-50" :
        item.type === "data" ? "bg-slate-50" :
        "bg-blue-50",
      title: item.title,
      subtitle: item.subtitle || "스튜디오 생성물",
      itemId: item.id,
      studioType: item.type,
    };
  }

  function mapStudioRowsToSavedItems(rows: Array<{
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    created_at: string;
    content: Record<string, unknown>;
    audio_url?: string;
  }>): SavedItem[] {
    return rows.map((item) => ({
      id: item.id,
      type: item.type as SavedItem["type"],
      title: item.title,
      subtitle: item.subtitle || "",
      createdAt: new Date(item.created_at),
      summaryContent: item.type === "summary" ? (item.content?.text as string) : undefined,
      quiz: item.type === "quiz" ? {
        id: item.id,
        title: item.title,
        questions: ((item.content?.questions as unknown[]) || []).map((q: unknown) => {
          const qq = q as {
            question: string;
            type?: "multiple_choice" | "ox" | "short_answer";
            options?: string[];
            answerIndex?: number;
            answer?: number;
            answerText?: string;
            hint?: string;
            explanation?: string;
          };
          return {
            question: qq.question,
            type: qq.type ?? "multiple_choice",
            options: qq.options ?? [],
            answer: qq.answerIndex ?? qq.answer ?? 0,
            answerText: qq.answerText,
            hint: qq.hint || "",
            explanation: qq.explanation || "",
          };
        }),
        createdAt: new Date(item.created_at),
        difficulty: (item.content?.difficulty as string) || "intermediate",
      } : undefined,
      audio: item.type === "audio" ? { script: (item.content?.script as string) || "" } : undefined,
      audioUrl: item.audio_url,
      mindmap: item.type === "mindmap" ? { nodes: (item.content?.nodes as any[]) || [] } : undefined,
      memoContent: item.type === "memo" ? (item.content?.text as string) || "" : undefined,
      flashcard: item.type === "flashcard" ? {
        cards: (item.content?.cards as any[]) || [],
        difficulty: (item.content?.difficulty as string) || "intermediate",
      } : undefined,
      slides: item.type === "slides" ? {
        slides: (item.content?.slides as any[]) || [],
        format: (item.content?.format as string) || "presenter",
        cover_image_b64: (item.content?.cover_image_b64 as string) || "",
      } : undefined,
      report: item.type === "report" ? {
        sections: (item.content?.sections as any[]) || [],
        format: (item.content?.format as string) || "briefing",
      } : undefined,
      dataTable: item.type === "data" ? {
        title: (item.content?.title as string) || item.title,
        description: (item.content?.description as string) || "",
        columns: (item.content?.columns as any[]) || (item.content?.headers as any[]) || [],
        rows: (item.content?.rows as any[]) || (item.content?.data as any[]) || [],
      } : undefined,
      infographic: item.type === "infographic" ? {
        title: (item.content?.title as string) || item.title,
        description: (item.content?.description as string) || "",
        sections: (item.content?.sections as any[]) || [],
      } : undefined,
      videoData: item.type === "video" ? { slides: (item.content?.slides as any[]) || [] } : undefined,
      content: item.content,
    }));
  }

  async function refreshStudioItems() {
    const token = await getToken();
    const res = await fetch(`${API}/api/studio?notebook_id=${notebook.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const rows = await res.json();
    setStudioItems(mapStudioRowsToSavedItems(Array.isArray(rows) ? rows : []));
  }

  function handleConfirmDocPick(weekId: number) {
    if (pickedDocIds.length === 0) return;
    setWeeks((prev) => prev.map((w) => {
      if (w.id !== weekId) return w;
      const existingDocIds = new Set(w.sources.map((s) => s.docId).filter(Boolean));
      const toAdd = pickedDocIds.filter((id) => !existingDocIds.has(id));
      if (toAdd.length === 0) return w;
      let maxId = w.sources.length > 0 ? Math.max(...w.sources.map((s) => s.id)) : 0;
      const newSources = toAdd
        .map((docId) => docs.find((d) => d.id === docId))
        .filter((doc): doc is Doc => Boolean(doc))
        .map((doc) => buildWeekSourceFromDoc(doc, ++maxId));
      return { ...w, sources: [...w.sources, ...newSources] };
    }));
    closeSourceModal();
  }

  // ── Week handlers ─────────────────────────────────────────────────
  function handleAddWeek() {
    if (weeks.length >= 16) return;
    const newId = weeks.length > 0 ? Math.max(...weeks.map((w) => w.id)) + 1 : 1;
    const newWeek: Week = { id: newId, title: `Week ${newId}: New Topic`, status: "UPCOMING", sources: [], tasks: [] };
    pendingScrollWeekIdRef.current = newId;
    setWeeks((prev) => [...prev, newWeek]);
    setEditingWeekId(newId);
    setEditingTitle(`Week ${newId}: New Topic`);
  }

  function handleRenameConfirm(id: number) {
    if (editingTitle.trim()) {
      setWeeks((prev) => prev.map((w) => w.id === id ? { ...w, title: editingTitle.trim() } : w));
    }
    setEditingWeekId(null);
    setEditingTitle("");
  }

  function handleDeleteWeek(id: number) {
    setWeeks((prev) => prev.filter((w) => w.id !== id));
  }

  function handleDeleteTask(weekId: number, taskId: number) {
    setWeeks((prev) => prev.map((w) => w.id !== weekId ? w : { ...w, tasks: w.tasks.filter((t) => t.id !== taskId) }));
  }

  async function handleRenameSourceConfirm() {
    if (!renamingSource) return;
    const newTitle = renamingSourceTitle.trim();
    if (!newTitle) {
      setRenamingSource(null);
      setRenamingSourceTitle("");
      return;
    }

    setWeeks((prev) => prev.map((w) => ({
      ...w,
      sources: w.sources.map((source) => {
        if (renamingSource.docId && source.docId === renamingSource.docId) return { ...source, name: newTitle };
        if (!renamingSource.docId && w.id === renamingSource.weekId && source.id === renamingSource.sourceId) return { ...source, name: newTitle };
        return source;
      }),
    })));

    if (renamingSource.docId) {
      try {
        const token = await getToken();
        const res = await fetch(`${API}/api/documents/${renamingSource.docId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ filename: newTitle }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "소스 이름 변경 실패");
        setDocs((prev) => prev.map((doc) => doc.id === renamingSource.docId ? { ...doc, name: data.filename } : doc));
        setWeeks((prev) => prev.map((w) => ({
          ...w,
          sources: w.sources.map((source) => source.docId === renamingSource.docId ? { ...source, name: data.filename } : source),
        })));
      } catch (e) {
        alert(`소스 이름 변경 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      }
    }

    setRenamingSource(null);
    setRenamingSourceTitle("");
  }

  function handleRenameTaskConfirm() {
    if (!renamingTask) return;
    const newTitle = renamingTaskTitle.trim();
    if (newTitle) {
      // 로컬 weeks 상태 업데이트
      let targetItemId: string | undefined;
      setWeeks((prev) => prev.map((w) => w.id !== renamingTask.weekId ? w : {
        ...w,
        tasks: w.tasks.map((t) => {
          if (t.id !== renamingTask.taskId) return t;
          targetItemId = t.itemId;
          return { ...t, title: newTitle };
        }),
      }));
      // itemId 있으면 백엔드 스튜디오 아이템도 동기화
      if (targetItemId) {
        const itemId = targetItemId;
        getToken().then((token) =>
          fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/studio/${itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ title: newTitle }),
          })
        ).catch(() => {});
      }
    }
    setRenamingTask(null);
    setRenamingTaskTitle("");
  }

  function handleToggleWeekStatus(weekId: number) {
    setWeeks((prev) => prev.map((w) => w.id !== weekId ? w : { ...w, status: w.status === "ACTIVE" ? "UPCOMING" : "ACTIVE" }));
  }

  function handleWeekDrop(e: React.DragEvent, weekId: number) {
    e.preventDefault();
    setDropTargetWeekId(null);
    setDragOverCard(null);
    setDraggingCard(null);

    // Week-card move (cross-week, drops on empty week area)
    const cardRaw = e.dataTransfer.getData("application/week-card");
    if (cardRaw) {
      try {
        const { weekId: srcWeekId, cardType: srcType, cardId: srcId } = JSON.parse(cardRaw) as { weekId: number; cardType: "source" | "task"; cardId: number };
        if (srcWeekId === weekId) return;
        setWeeks((prev) => {
          let movedSource: WeekSource | null = null;
          let movedTask: WeekTask | null = null;
          const step1 = prev.map((w) => {
            if (w.id !== srcWeekId) return w;
            if (srcType === "source") {
              movedSource = w.sources.find((s) => s.id === srcId) ?? null;
              return { ...w, sources: w.sources.filter((s) => s.id !== srcId) };
            } else {
              movedTask = w.tasks.find((t) => t.id === srcId) ?? null;
              return { ...w, tasks: w.tasks.filter((t) => t.id !== srcId) };
            }
          });
          return step1.map((w) => {
            if (w.id !== weekId) return w;
            if (movedSource) {
              const maxId = w.sources.length > 0 ? Math.max(...w.sources.map((s) => s.id)) : 0;
              return { ...w, sources: [...w.sources, { ...movedSource, id: maxId + 1 }] };
            }
            if (movedTask) {
              const maxId = w.tasks.length > 0 ? Math.max(...w.tasks.map((t) => t.id)) : 0;
              return { ...w, tasks: [...w.tasks, { ...movedTask, id: maxId + 1 }] };
            }
            return w;
          });
        });
      } catch { /* ignore */ }
      return;
    }

    const sourceDocRaw = e.dataTransfer.getData("application/source-doc");
    if (sourceDocRaw) {
      try {
        const { docId } = JSON.parse(sourceDocRaw) as { docId: string };
        const doc = docs.find((entry) => entry.id === docId);
        if (!doc) return;
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== weekId || w.sources.some((source) => source.docId === docId)) return w;
          const maxId = w.sources.length > 0 ? Math.max(...w.sources.map((source) => source.id)) : 0;
          return { ...w, sources: [...w.sources, buildWeekSourceFromDoc(doc, maxId + 1)] };
        }));
      } catch { /* ignore */ }
      return;
    }

    // Studio item drop
    const raw = e.dataTransfer.getData("application/studio-item");
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as UnassignedStudioItem;
      setWeeks((prev) => prev.map((w) => {
        if (w.id !== weekId) return w;
        if (w.tasks.some((task) => task.itemId === item.id)) return w;
        const maxId = w.tasks.length > 0 ? Math.max(...w.tasks.map((t) => t.id)) : 0;
        return { ...w, tasks: [...w.tasks, buildWeekTaskFromStudioItem(item, maxId + 1)] };
      }));
    } catch { /* 잘못된 데이터 무시 */ }
  }

  function handleCardDragOver(
    e: React.DragEvent,
    weekId: number,
    cardType: "source" | "task",
    cardId: number
  ) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const half: "top" | "bottom" = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
    setDragOverCard((prev) =>
      prev?.weekId === weekId && prev?.cardType === cardType && prev?.cardId === cardId && prev?.half === half
        ? prev
        : { weekId, cardType, cardId, half }
    );
  }

  function handleCardDrop(
    e: React.DragEvent,
    targetWeekId: number,
    targetCardType: "source" | "task",
    targetCardId: number
  ) {
    e.preventDefault();
    e.stopPropagation();
    const half = dragOverCard?.half ?? "bottom";
    setDragOverCard(null);
    setDraggingCard(null);
    setDropTargetWeekId(null);

    const sourceDocRaw = e.dataTransfer.getData("application/source-doc");
    if (sourceDocRaw && targetCardType === "source") {
      try {
        const { docId } = JSON.parse(sourceDocRaw) as { docId: string };
        const doc = docs.find((entry) => entry.id === docId);
        if (!doc) return;
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== targetWeekId || w.sources.some((source) => source.docId === docId)) return w;
          const items = [...w.sources];
          const maxId = Math.max(0, ...items.map((source) => source.id));
          const newItem = buildWeekSourceFromDoc(doc, maxId + 1);
          const toIdx = items.findIndex((source) => source.id === targetCardId);
          if (toIdx === -1) return { ...w, sources: [...items, newItem] };
          items.splice(half === "top" ? toIdx : toIdx + 1, 0, newItem);
          return { ...w, sources: items };
        }));
      } catch { /* ignore */ }
      return;
    }

    const studioItemRaw = e.dataTransfer.getData("application/studio-item");
    if (studioItemRaw && targetCardType === "task") {
      try {
        const item = JSON.parse(studioItemRaw) as UnassignedStudioItem;
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== targetWeekId || w.tasks.some((task) => task.itemId === item.id)) return w;
          const items = [...w.tasks];
          const maxId = Math.max(0, ...items.map((task) => task.id));
          const newItem = buildWeekTaskFromStudioItem(item, maxId + 1);
          const toIdx = items.findIndex((task) => task.id === targetCardId);
          if (toIdx === -1) return { ...w, tasks: [...items, newItem] };
          items.splice(half === "top" ? toIdx : toIdx + 1, 0, newItem);
          return { ...w, tasks: items };
        }));
      } catch { /* ignore */ }
      return;
    }

    const raw = e.dataTransfer.getData("application/week-card");
    if (!raw) return;
    try {
      const { weekId: srcWeekId, cardType: srcType, cardId: srcId } = JSON.parse(raw) as { weekId: number; cardType: "source" | "task"; cardId: number };

      if (srcWeekId === targetWeekId && srcType === targetCardType && srcId !== targetCardId) {
        // Same week, same type: reorder
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== srcWeekId) return w;
          if (srcType === "source") {
            const items = [...w.sources];
            const fromIdx = items.findIndex((s) => s.id === srcId);
            if (fromIdx === -1) return w;
            const [moved] = items.splice(fromIdx, 1);
            let toIdx = items.findIndex((s) => s.id === targetCardId);
            if (toIdx === -1) return { ...w, sources: [...items, moved] };
            items.splice(half === "top" ? toIdx : toIdx + 1, 0, moved);
            return { ...w, sources: items };
          } else {
            const items = [...w.tasks];
            const fromIdx = items.findIndex((t) => t.id === srcId);
            if (fromIdx === -1) return w;
            const [moved] = items.splice(fromIdx, 1);
            let toIdx = items.findIndex((t) => t.id === targetCardId);
            if (toIdx === -1) return { ...w, tasks: [...items, moved] };
            items.splice(half === "top" ? toIdx : toIdx + 1, 0, moved);
            return { ...w, tasks: items };
          }
        }));
        return;
      }

      if (srcWeekId !== targetWeekId) {
        // Cross-week: remove from source, insert at target position
        setWeeks((prev) => {
          let movedSource: WeekSource | null = null;
          let movedTask: WeekTask | null = null;
          const step1 = prev.map((w) => {
            if (w.id !== srcWeekId) return w;
            if (srcType === "source") {
              movedSource = w.sources.find((s) => s.id === srcId) ?? null;
              return { ...w, sources: w.sources.filter((s) => s.id !== srcId) };
            } else {
              movedTask = w.tasks.find((t) => t.id === srcId) ?? null;
              return { ...w, tasks: w.tasks.filter((t) => t.id !== srcId) };
            }
          });
          return step1.map((w) => {
            if (w.id !== targetWeekId) return w;
            if (movedSource) {
              const items = [...w.sources];
              const maxId = Math.max(0, ...items.map((s) => s.id));
              const newItem = { ...movedSource, id: maxId + 1 };
              const toIdx = items.findIndex((s) => s.id === targetCardId);
              if (toIdx === -1) return { ...w, sources: [...items, newItem] };
              items.splice(half === "top" ? toIdx : toIdx + 1, 0, newItem);
              return { ...w, sources: items };
            }
            if (movedTask) {
              const items = [...w.tasks];
              const maxId = Math.max(0, ...items.map((t) => t.id));
              const newItem = { ...movedTask, id: maxId + 1 };
              const toIdx = items.findIndex((t) => t.id === targetCardId);
              if (toIdx === -1) return { ...w, tasks: [...items, newItem] };
              items.splice(half === "top" ? toIdx : toIdx + 1, 0, newItem);
              return { ...w, tasks: items };
            }
            return w;
          });
        });
      }
    } catch { /* ignore */ }
  }

  async function handleOpenInvite() {
    setInviteCode("");
    setInviteLoading(true);
    setShowShareModal(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/notebooks/${notebook.id}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("코드 생성 실패");
      const data = await res.json();
      setInviteCode(data.invite_code);
    } catch (e) {
      alert(`초대 코드 생성 실패: ${e instanceof Error ? e.message : "오류"}`);
      setShowShareModal(false);
    } finally {
      setInviteLoading(false);
    }
  }

  function closeShareModal() {
    setShowShareModal(false);
    setLinkCopied(false);
    setActiveView("sources");
  }

  function handleGoToDashboard() {
    setProfileMenuOpen(false);
    router.push("/dashboard/instructor");
  }

  async function handleLogout() {
    setProfileMenuOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleAddWeekTask(weekId: number, task: WeekTask) {
    setWeeks((prev) => prev.map((w) => {
      if (w.id !== weekId) return w;
      const maxId = w.tasks.length > 0 ? Math.max(...w.tasks.map((t) => t.id)) : 0;
      return { ...w, tasks: [...w.tasks, { ...task, id: maxId + 1 }] };
    }));
    setStudioCreateType(null);
    setStudioCreateWeekId(null);
  }

  function openStudioCreateFromSidebar(item: StudioTaskItem) {
    if (weeks.length === 0) {
      alert("먼저 주차를 추가한 뒤 스튜디오 기능을 사용할 수 있습니다.");
      return;
    }
    setStudioCreateType(null);
    setStudioCreateWeekId(null);
    setOpenPickerWeekId(-1);
    setSelectedPickerItem(item);
    setPickerSelectedWeekId(null);
    setPickerOpenedFromStudioMenu(true);
    setPickerSourcesCollapsed(false);
    setDetailConfig({ format: item.id === "quiz" ? (item.presets[0] ?? "") : "", instructions: "", length: "10문제", language: "한국어", style: "격식체", selectedSources: [] });
    setStudioMenuOpen(false);
  }

  function closePickerModal() {
    setOpenPickerWeekId(null);
    setSelectedPickerItem(null);
    setPickerSelectedWeekId(null);
    setPickerOpenedFromStudioMenu(false);
    setPickerSourcesCollapsed(false);
  }

  function handlePickerBack() {
    if (pickerOpenedFromStudioMenu) {
      setOpenPickerWeekId(null);
      setSelectedPickerItem(null);
      setPickerSelectedWeekId(null);
      setPickerOpenedFromStudioMenu(false);
      setStudioMenuOpen(true);
      return;
    }
    setSelectedPickerItem(null);
  }

  function getPickerSourceOptions() {
    if (pickerSelectedWeekId === null) {
      return docs.map((doc, index) => ({
        id: -(index + 1),
        name: doc.name ?? "소스",
        icon: doc.type === "url" ? "🔗" : "📄",
        docId: doc.id,
      }));
    }

    return (weeks.find((w) => w.id === pickerSelectedWeekId)?.sources ?? []).map((src) => ({
      id: src.id,
      name: src.name,
      icon: src.icon,
      docId: src.docId,
    }));
  }

  async function handleGenerateFromModal(item: StudioTaskItem) {
    const weekId = pickerSelectedWeekId;
    const pickerSources = getPickerSourceOptions();
    const usedSources = detailConfig.selectedSources.length > 0
      ? pickerSources.filter((s) => detailConfig.selectedSources.includes(s.id))
      : pickerSources;
    const docIds = usedSources.flatMap((s) => (s.docId ? [s.docId] : []));
    const effectiveDocIds = docIds.length > 0 ? docIds : activeDocIds;

    if (["video"].includes(item.id)) {
      setOpenPickerWeekId(null);
      setSelectedPickerItem(null);
      setStudioCreateType(item.id);
      setStudioCreateWeekId(weekId);
      return;
    }

    setGeneratingTask(true);
    console.log(`[studio] 🚀 ${item.id} 생성 시작 | format="${detailConfig.format}" | docs=${JSON.stringify(effectiveDocIds)} | lang=${detailConfig.language}`);

    // 1. 주차에 플레이스홀더 즉시 추가
    const tempNumId = Date.now();
    const typeLabel: Record<string, string> = {
      audio: "AI 오디오 오버뷰", quiz: "퀴즈", mindmap: "마인드맵", flashcard: "플래시카드",
      slides: "슬라이드 자료", report: "보고서", table: "데이터 표", infographic: "인포그래픽",
    };
    const pendingTask: WeekTask = {
      id: tempNumId, icon: item.icon, iconBg: item.iconBg,
      title: `${typeLabel[item.id] || item.label} 생성 중...`,
      subtitle: `기반:소스 ${effectiveDocIds.length}개`,
      studioType: item.id,
      generating: true,
    };
    const tempStudioItemId = `pending-${item.id}-${tempNumId}`;
    const pendingStudioItem: SavedItem = {
      id: tempStudioItemId,
      type: (item.id === "table" ? "data" : item.id) as SavedItem["type"],
      title: `${typeLabel[item.id] || item.label} 생성 중...`,
      subtitle: `기반:소스 ${effectiveDocIds.length}개`,
      createdAt: new Date(),
      generating: true,
    };
    if (weekId !== null) {
      setWeeks((prev) => prev.map((w) => {
        if (w.id !== weekId) return w;
        return { ...w, tasks: [...w.tasks, pendingTask] };
      }));
    } else {
      setStudioItems((prev) => [pendingStudioItem, ...prev]);
    }

    // 2. 모달 즉시 닫기
    closePickerModal();
    const savedDetailConfig = { ...detailConfig };
    setDetailConfig({ format: selectedPickerItem?.id === "quiz" ? (selectedPickerItem.presets[0] ?? "") : "", instructions: "", length: "10문제", language: "한국어", style: "격식체", selectedSources: [] });
    setGeneratingTask(false);

    // 3. 백그라운드 생성
    (async () => {
    try {
      const token = await getToken();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      const lengthMap: Record<string, string> = { "5문제": "short", "10문제": "medium", "15문제": "long" };
      const diffMap: Record<string, string> = { "5문제": "easy", "10문제": "intermediate", "15문제": "hard" };
      const countMap: Record<string, string> = { "5문제": "fewer", "10문제": "standard", "15문제": "more" };
      const countNumMap: Record<string, number> = { "5문제": 5, "10문제": 10, "15문제": 15 };

      if (item.id === "audio") {
        const res = await fetch(`${API}/api/generate/audio`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: detailConfig.format || "overview", language: detailConfig.language, length: lengthMap[detailConfig.length] || "medium", focus: detailConfig.instructions, item_title: item.label, notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "quiz") {
        const quizStyleMap: Record<string, string> = { "객관식 퀴즈": "multiple_choice", "O/X 퀴즈": "ox" };
        const quizStyle = quizStyleMap[savedDetailConfig.format] || "multiple_choice";
        const res = await fetch(`${API}/api/generate`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, type: "quiz", difficulty: diffMap[savedDetailConfig.length] || "intermediate", quiz_count: countNumMap[savedDetailConfig.length] || 5, quiz_style: quizStyle, topic: savedDetailConfig.instructions || "", notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
        // 백엔드 응답: { result: { title, questions }, item_id }
        data = { ...data.result, item_id: data.item_id };
      } else if (item.id === "mindmap") {
        const res = await fetch(`${API}/api/generate/mindmap`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, language: savedDetailConfig.language, focus: savedDetailConfig.instructions || savedDetailConfig.format, notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "flashcard") {
        const res = await fetch(`${API}/api/generate/flashcard`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, count: countMap[savedDetailConfig.length] || "standard", difficulty: diffMap[savedDetailConfig.length] || "intermediate", topic: savedDetailConfig.format || savedDetailConfig.instructions || "", language: savedDetailConfig.language, item_title: item.label, notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "slides") {
        const res = await fetch(`${API}/api/generate/slides`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: savedDetailConfig.format || "lecture", length: lengthMap[savedDetailConfig.length] || "medium", language: savedDetailConfig.language, prompt: savedDetailConfig.instructions, item_title: item.label, notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "report") {
        const toneMap: Record<string, string> = { "구어체": "casual", "학술체": "academic", "공식체": "formal" };
        const res = await fetch(`${API}/api/generate/report`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: savedDetailConfig.format || "report", language: savedDetailConfig.language, length: lengthMap[savedDetailConfig.length] || "medium", tone: toneMap[savedDetailConfig.style] || "formal", instructions: savedDetailConfig.instructions, item_title: item.label, notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "infographic") {
        const infographicFormatMap: Record<string, string> = {
          "개요형": "overview", "프로세스형": "process", "비교형": "comparison",
          "통계형": "statistics", "타임라인형": "timeline",
        };
        const infographicFormat = infographicFormatMap[savedDetailConfig.format] || "overview";
        const res = await fetch(`${API}/api/generate/infographic`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: infographicFormat, language: savedDetailConfig.language || "ko", instructions: savedDetailConfig.instructions || "", notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      } else if (item.id === "table") {
        const tableFormatMap: Record<string, string> = {
          "핵심 내용 정리표": "summary_table",
          "비교 분석 표": "comparison_table",
          "개념 정의 표": "concept_definition",
          "학습 점검표": "learning_checklist",
          "진도 추적 표": "progress_tracking",
        };
        const tableFormat = tableFormatMap[savedDetailConfig.format] || "summary_table";
        const res = await fetch(`${API}/api/generate/data`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ doc_ids: effectiveDocIds, format: tableFormat, language: savedDetailConfig.language || "ko", instructions: savedDetailConfig.instructions || "", notebook_id: notebook.id }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "생성 실패");
      }

      const taskTitle = (data?.title as string) || item.label;
      const formatNote = savedDetailConfig.format ? ` · ${savedDetailConfig.format}` : "";
      const lengthNote = ["quiz", "flashcard"].includes(item.id) ? ` · ${savedDetailConfig.length}` : "";
      const realTask: WeekTask = {
        id: tempNumId, icon: item.icon, iconBg: item.iconBg,
        title: taskTitle,
        subtitle: `${item.subtitle}${formatNote}${lengthNote} · ${savedDetailConfig.language}`,
        itemId: data?.item_id as string | undefined,
        studioType: item.id,
      };
      if (weekId !== null) {
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== weekId) return w;
          return { ...w, tasks: w.tasks.map((t) => t.id === tempNumId ? realTask : t) };
        }));
      } else {
        await refreshStudioItems();
      }
      console.log(`[studio] ✅ ${item.id} 생성 완료 | item_id=${data?.item_id} | title="${taskTitle}"`);
    } catch (e) {
      console.error(`[studio] ❌ ${item.id} 생성 실패:`, e);
      const errMsg = e instanceof Error ? e.message : "오류가 발생했습니다";
      if (weekId !== null) {
        setWeeks((prev) => prev.map((w) => {
          if (w.id !== weekId) return w;
          return { ...w, tasks: w.tasks.map((t) => t.id === tempNumId ? { ...t, generating: false, generatingError: errMsg } : t) };
        }));
      } else {
        setStudioItems((prev) => prev.map((studioItem) => (
          studioItem.id === tempStudioItemId
            ? { ...studioItem, generating: false, generatingError: errMsg }
            : studioItem
        )));
      }
    }
    })();
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function getIconBg(iconBg: string) {
    if (iconBg.includes("blue")) return "rgba(0,93,167,0.1)";
    if (iconBg.includes("amber") || iconBg.includes("yellow")) return "rgba(160,105,0,0.1)";
    if (iconBg.includes("green")) return "rgba(0,120,60,0.1)";
    if (iconBg.includes("red")) return "rgba(220,38,38,0.1)";
    if (iconBg.includes("purple")) return "rgba(109,40,217,0.1)";
    if (iconBg.includes("pink")) return "rgba(219,39,119,0.1)";
    if (iconBg.includes("emerald")) return "rgba(4,120,87,0.1)";
    if (iconBg.includes("orange")) return "rgba(194,65,12,0.1)";
    return "rgba(100,100,100,0.1)";
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#f0f4f9] overflow-hidden">
      {/* Top Header */}
      <header className="relative h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0 shadow-sm z-30 overflow-visible">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { router.push(backUrl); router.refresh(); }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <StudyULogo size={28} />
          <span className="text-gray-300 text-lg">|</span>
          <span className="text-blue-500 font-semibold truncate max-w-[240px]" style={{ fontSize: "0.9rem" }}>
            {notebook.title}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-600">강사</span>
        </div>
        <div className="flex items-center gap-3 mr-2">
          {/* Public Link Share */}
          <button
            onClick={handleOpenInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
            style={{ fontSize: "0.78rem" }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            공유
          </button>
          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              className="flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-pink-200"
              aria-label="강사 메뉴"
            >
              {profileAvatarUrl ? (
                <Image
                  src={profileAvatarUrl}
                  alt="프로필"
                  width={32}
                  height={32}
                  className="rounded-full w-8 h-8"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-xs font-semibold text-pink-600">
                  {profileInitial}
                </div>
              )}
            </button>
            {profileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-gray-200 bg-white shadow-lg py-1.5 z-50">
                <div className="px-4 py-2">
                  <p className="text-sm font-semibold text-gray-800 break-words leading-5">{profileName}</p>
                </div>
                <div className="h-px bg-gray-100 my-1" />
                <button
                  onClick={handleGoToDashboard}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  내 대시보드로 이동
                </button>
                <button
                  onClick={() => { void handleLogout(); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* ─── Left Sidebar (Sources) ─── */}
        <aside
          className="bg-white border-gray-200 flex shrink-0 shadow-sm overflow-hidden"
          style={{ width: leftSidebarOpen ? leftSidebarWidth : 36, minWidth: leftSidebarOpen ? leftSidebarWidth : 36, transition: "none" }}
        >
          <div className="flex flex-row flex-1 min-w-0 overflow-hidden border-r border-gray-200">
            {/* Collapsed strip */}
            {!leftSidebarOpen && (
              <div className="flex flex-col items-center pt-2 w-full">
                <button
                  onClick={() => setLeftSidebarOpen(true)}
                  className="w-7 h-7 rounded-md bg-gray-100 hover:bg-blue-100 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            )}

            {/* Full sidebar content */}
            {leftSidebarOpen && (
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleUpload(file);
                }}
              >
                {/* Sidebar Header */}
                <div className="px-4 pt-4 pb-2 flex items-start justify-between shrink-0">
                  <div>
                    <p className="text-[#99a1af] uppercase tracking-wider" style={{ fontSize: "11px", fontWeight: 700 }}>SOURCES</p>
                    <p className="text-[#99a1af]" style={{ fontSize: "11.5px" }}>Knowledge Base</p>
                  </div>
                  <button
                    onClick={() => setLeftSidebarOpen(false)}
                    className="w-6 h-6 rounded-md bg-gray-100 hover:bg-blue-100 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>

                {/* Nav tabs */}
                <nav className="flex flex-col gap-[4px] px-2 shrink-0">
                  <button
                    onClick={() => router.push(`/dashboard/students?notebook=${notebook.id}`)}
                    className={`h-[41px] flex items-center gap-2.5 pl-3 rounded-[14px] transition-all ${
                      activeView === "students" ? "bg-[#eff6ff] shadow-sm" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                      <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
                        <circle cx="5" cy="3" r="2" stroke={activeView === "students" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                        <path d="M1 10.5C1 8.6 2.8 7 5 7s4 1.6 4 3.5" stroke={activeView === "students" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                        <circle cx="10" cy="3.5" r="1.5" stroke={activeView === "students" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                        <path d="M11.5 7.5C12.4 7.8 13 8.6 13 9.6" stroke={activeView === "students" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <span className={activeView === "students" ? "text-[#155dfc]" : "text-[#4a5565]"} style={{ fontSize: "13.92px", fontWeight: activeView === "students" ? 600 : 400 }}>학생 관리</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveView("link");
                      handleOpenInvite();
                    }}
                    className={`h-[41px] flex items-center gap-2.5 pl-3 rounded-[14px] transition-all ${
                      activeView === "link" ? "bg-[#eff6ff] shadow-sm" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M5.5 8.5l3-3M8 5.5l1.5-1.5a2.1 2.1 0 113 3L11 8.5" stroke={activeView === "link" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                        <path d="M6 8.5l-1.5 1.5a2.1 2.1 0 11-3-3L3 5.5" stroke={activeView === "link" ? "#2B7FFF" : "#99A1AF"} strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <span className={activeView === "link" ? "text-[#155dfc]" : "text-[#4a5565]"} style={{ fontSize: "13.92px", fontWeight: activeView === "link" ? 600 : 400 }}>Link URL</span>
                  </button>

                </nav>

                {/* Sources view */}
                <div className="mt-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* URL input */}
                    {showUrlInput && (
                      <div className="mx-3 mb-2 shrink-0">
                        <div className="flex items-center gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-xl">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
                          </svg>
                          <input
                            autoFocus
                            type="text"
                            value={urlValue}
                            onChange={(e) => setUrlValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleIngestUrl(); if (e.key === "Escape") setShowUrlInput(false); }}
                            placeholder="유튜브 또는 웹페이지 URL"
                            className="flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-400 outline-none min-w-0"
                          />
                          {urlLoading ? (
                            <svg className="w-3 h-3 text-blue-500 animate-spin shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
                          ) : (
                            <button
                              onClick={handleIngestUrl}
                              disabled={!urlValue.trim()}
                              className="text-[10px] font-medium text-white px-2 py-0.5 rounded-md shrink-0 disabled:opacity-40"
                              style={{ background: "linear-gradient(135deg, #2b7fff, #1d6eee)" }}
                            >
                              추가
                            </button>
                          )}
                          <button onClick={() => setShowUrlInput(false)} className="text-gray-400 hover:text-gray-600 shrink-0 ml-0.5">
                            <svg width="11" height="11" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.docx,.pptx,.ppt,.hwp,.hwpx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi,.mkv,.webm,.mp3,.m4a"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        files.forEach((f) => handleUpload(f));
                        e.target.value = "";
                      }}
                    />

                    {/* Uploading indicator */}
                    {uploading && (
                      <div className="mx-3 mb-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2 shrink-0">
                        <svg className="w-3 h-3 text-blue-500 animate-spin shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
                        <span className="text-xs text-blue-600">분석 중...</span>
                      </div>
                    )}

                    {/* Source + Studio split list */}
                    <div className="flex-1 px-3 pb-3 flex flex-col min-h-0 overflow-hidden">
                      <div className={`flex flex-col min-h-0 ${sourceSectionClass}`}>
                        <div className="px-1 pt-1 pb-2 flex items-center justify-between">
                          <button
                            onClick={() => setLeftSourcesCollapsed((prev) => !prev)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 tracking-[0.04em]"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="transition-transform" style={{ transform: leftSourcesCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            소스
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-gray-300">{docs.length}개</span>
                            <div className="relative" data-add-source-menu>
                              <button
                                onClick={() => { setShowAddSourceMenu((v) => !v); setShowUrlInput(false); }}
                                className="w-5 h-5 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100"
                                title="소스 추가"
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                  <path d="M5 1.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                  <path d="M1.5 5H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                </svg>
                              </button>
                              {showAddSourceMenu && (
                                <div className="absolute right-0 top-[28px] z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[140px]">
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                                    onClick={() => { setShowAddSourceMenu(false); fileInputRef.current?.click(); }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
                                      <path d="M14 2v6h6" />
                                    </svg>
                                    파일 업로드
                                  </button>
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                                    onClick={() => { setShowAddSourceMenu(false); setShowUrlInput(true); setUrlValue(""); }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                      <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
                                    </svg>
                                    URL 추가
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {!leftSourcesCollapsed && (
                        <div className="space-y-0.5 overflow-y-auto min-h-0 pr-1">
                          {docs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                              <svg className="w-8 h-8 text-gray-300 mb-2" viewBox="0 0 24 24" fill="none">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                                <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                              </svg>
                              <p className="text-xs text-gray-400">소스 추가 버튼으로<br/>파일이나 URL을 추가하세요</p>
                            </div>
                          ) : (
                            docs.map((doc) => {
                              const isExpanded = expandedDocIds.has(doc.id);
                              const isActive = activeChunkDocIds.has(doc.id);
                              const linkedSource = weeks.flatMap((week) => week.sources.map((source) => ({ weekId: week.id, source }))).find((entry) => entry.source.docId === doc.id);
                              return (
                                <div key={doc.id} className="rounded-[10px] overflow-hidden">
                                  <div
                                    className="flex items-center gap-2 pl-2 pr-2 py-2 rounded-[10px] hover:bg-gray-50 cursor-pointer group"
                                    draggable={renamingSource?.docId !== doc.id}
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("application/source-doc", JSON.stringify({ docId: doc.id }));
                                      e.dataTransfer.effectAllowed = "copy";
                                    }}
                                    onClick={() => handleViewDoc({ id: doc.id, name: doc.name ?? "", type: doc.type ?? "" })}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isActive}
                                      className="shrink-0 w-[13px] h-[13px] accent-[#2b7fff] cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveChunkDocIds((prev) => {
                                          const next = new Set(prev);
                                          next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id);
                                          return next;
                                        });
                                        setActiveDocIds((prev) =>
                                          prev.includes(doc.id) ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]
                                        );
                                      }}
                                      onChange={() => {}}
                                    />
                                    <span className="shrink-0 flex items-center justify-center w-3 h-3">
                                      {doc.type === "url" ? (
                                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                          <path d="M5.5 8.5l3-3M8 5.5l1.5-1.5a2.1 2.1 0 113 3L11 8.5" stroke="#51A2FF" strokeWidth="1.2" strokeLinecap="round"/>
                                          <path d="M6 8.5l-1.5 1.5a2.1 2.1 0 11-3-3L3 5.5" stroke="#51A2FF" strokeWidth="1.2" strokeLinecap="round"/>
                                        </svg>
                                      ) : (
                                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none">
                                          <path d="M5.5 1H1.5a1 1 0 00-1 1v7a1 1 0 001 1h6a1 1 0 001-1V4L5.5 1z" stroke="#51A2FF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.9"/>
                                          <path d="M5.5 1v3h3" stroke="#51A2FF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.9"/>
                                          <path d="M1.5 5.5H4.5M1.5 7H6.5" stroke="#51A2FF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.9"/>
                                        </svg>
                                      )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      {renamingSource?.docId === doc.id ? (
                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                          <input
                                            autoFocus
                                            value={renamingSourceTitle}
                                            onChange={(e) => setRenamingSourceTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void handleRenameSourceConfirm();
                                              }
                                              if (e.key === "Escape") {
                                                setRenamingSource(null);
                                                setRenamingSourceTitle("");
                                              }
                                            }}
                                            className="w-full rounded-md border border-blue-400 px-2 py-1 text-[12.8px] font-medium text-[#364153] outline-none"
                                          />
                                          <button
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleRenameSourceConfirm();
                                            }}
                                            className="w-5 h-5 rounded bg-blue-500 text-white flex items-center justify-center shrink-0"
                                          >
                                            <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                          </button>
                                          <button
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setRenamingSource(null);
                                              setRenamingSourceTitle("");
                                            }}
                                            className="w-5 h-5 rounded bg-gray-100 text-gray-500 flex items-center justify-center shrink-0"
                                          >
                                            <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                                          </button>
                                        </div>
                                      ) : (
                                        <>
                                          <p className="text-[#364153] truncate" style={{ fontSize: "12.8px", fontWeight: 500 }}>{doc.name}</p>
                                          <p className="text-[#99a1af]" style={{ fontSize: "11.2px" }}>
                                            {isActive ? `전체 ${doc.chunks}개 청크` : `0/${doc.chunks}개 청크 선택`}
                                          </p>
                                        </>
                                      )}
                                    </div>
                                    <div className="hidden items-center shrink-0 group-hover:flex">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRenamingSource(linkedSource ? { weekId: linkedSource.weekId, sourceId: linkedSource.source.id, docId: doc.id } : { weekId: -1, sourceId: -1, docId: doc.id });
                                          setRenamingSourceTitle(doc.name ?? "");
                                        }}
                                        onMouseDown={(e) => e.preventDefault()}
                                        className="w-4 h-4 rounded flex items-center justify-center text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                                        title="이름 변경"
                                      >
                                        <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2-8 8H1.5v-2l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}
                                        className="w-4 h-4 rounded flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                                      >
                                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                      </button>
                                    </div>
                                    <span
                                      className="shrink-0 flex items-center justify-center w-4 h-4 transition-transform duration-200"
                                      style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                                      onClick={(e) => { e.stopPropagation(); setExpandedDocIds((prev) => { const next = new Set(prev); next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id); return next; }); }}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                        <path d="M2 3.5L5 6.5L8 3.5" stroke="#99A1AF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </span>
                                  </div>
                                  {isExpanded && (
                                    <div className="ml-5 mb-1 border-l-2 border-blue-100 pl-2 flex flex-col gap-0.5">
                                      <div className={`px-2 py-1.5 rounded-lg ${isActive ? "bg-blue-50/60" : "bg-gray-50"}`}>
                                        <p className={`leading-snug ${isActive ? "text-[#2b7fff]" : "text-[#99a1af]"}`} style={{ fontSize: "11.5px" }}>
                                          전체 {doc.chunks}개 청크 {isActive ? "선택됨" : "(비활성)"}
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                        )}
                      </div>

                      <div className={`pt-4 border-t border-gray-100 flex flex-col min-h-0 ${studioSectionClass}`}>
                        <div className="px-1 pb-2 flex items-center justify-between gap-2 relative" data-studio-menu>
                          <button
                            onClick={() => setLeftStudioItemsCollapsed((prev) => !prev)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 tracking-[0.04em]"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="transition-transform" style={{ transform: leftStudioItemsCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            스튜디오
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-gray-300">주차 미지정 {unassignedStudioItems.length}개</span>
                            <button
                              ref={studioMenuButtonRef}
                              onClick={() => {
                                setStudioMenuReady(false);
                                setStudioMenuOpen((prev) => !prev);
                              }}
                              className="w-5 h-5 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100"
                              title="스튜디오 추가"
                            >
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M5 1.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                <path d="M1.5 5H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        {!leftStudioItemsCollapsed && (
                        <div className="space-y-1 overflow-y-auto min-h-0 pr-1">
                          {unassignedStudioItems.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center">
                              <p className="text-xs text-gray-400">주차가 정해지지 않은 생성물이 여기에 표시됩니다.</p>
                            </div>
                          ) : (
                            unassignedStudioItems.map((item) => (
                              <div
                                key={item.id}
                                className={`flex items-center gap-2 px-2 py-2 rounded-[10px] transition-colors group ${
                                  item.generating || item.generatingError ? "cursor-default" : "cursor-pointer hover:bg-gray-50"
                                }`}
                                draggable={!item.generating && !item.generatingError}
                                onDragStart={(e) => {
                                  if (item.generating || item.generatingError) {
                                    e.preventDefault();
                                    return;
                                  }
                                  e.dataTransfer.setData("application/studio-item", JSON.stringify(item));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onClick={() => {
                                  if (item.generating || item.generatingError) return;
                                  openStudioViewer(item);
                                }}
                              >
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                  item.generatingError ? "bg-red-50 text-red-500" : "bg-[#EFF6FF] text-blue-500"
                                }`}>
                                  {item.generating ? (
                                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                                    </svg>
                                  ) : (
                                    <span style={{ fontSize: "0.9rem" }}>
                                      {item.type === "audio" ? "🎧" :
                                       item.type === "slides" ? "📊" :
                                       item.type === "video" ? "🎬" :
                                       item.type === "mindmap" ? "🗺️" :
                                       item.type === "report" ? "📝" :
                                       item.type === "flashcard" ? "🃏" :
                                       item.type === "quiz" ? "❓" :
                                       item.type === "infographic" ? "📈" :
                                       item.type === "data" ? "📋" : "📄"}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[#364153] truncate" style={{ fontSize: "12.8px", fontWeight: 500 }}>{item.title}</p>
                                  <p className={`${item.generatingError ? "text-red-400" : "text-[#99a1af]"}`} style={{ fontSize: "11.2px" }}>
                                    {item.generating ? "생성 중..." : item.generatingError || item.subtitle || "스튜디오 생성물"}
                                  </p>
                                </div>
                                {!item.generating && !item.generatingError && (
                                  <div className="hidden items-center gap-1 shrink-0 group-hover:flex">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openStudioViewer(item);
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 text-[11px] font-semibold"
                                    >
                                      보기
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setStudioItems((prev) => prev.filter((i) => i.id !== item.id));
                                        getToken().then((token) => {
                                          fetch(`${API}/api/studio/${item.id}`, {
                                            method: "DELETE",
                                            headers: { Authorization: `Bearer ${token}` },
                                          }).catch(() => {});
                                        });
                                      }}
                                      className="w-6 h-6 rounded-lg bg-red-50 text-red-500 flex items-center justify-center"
                                      title="삭제"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                      </svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                        )}
                      </div>
                    </div>
                  </div>


              </div>
            )}

            {/* Left resize handle */}
            {leftSidebarOpen && (
              <div
                onMouseDown={startLeftResize}
                className="w-1 shrink-0 cursor-col-resize relative group z-10"
                style={{ background: "transparent" }}
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-gray-200 group-hover:bg-blue-400 transition-colors rounded-full" />
              </div>
            )}
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Studio Item Viewer */}
            {viewerStudioItem && !viewerDoc && (
              (viewerStudioExpanded
                ? createPortal(
                    <div className="fixed inset-0 z-[9999] bg-white">
                      <button
                        onClick={() => setViewerStudioExpanded(false)}
                        title="축소"
                        className="absolute top-14 right-3 z-20 p-1.5 rounded-lg bg-white/90 border border-gray-200 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
                        </svg>
                      </button>
                      <div className="h-full overflow-hidden">
                        <StudioItemViewer item={viewerStudioItem} onClose={closeStudioViewer} />
                      </div>
                    </div>,
                    document.body
                  )
                : <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                    <button
                      onClick={() => setViewerStudioExpanded(true)}
                      title="전체화면"
                      className="absolute top-14 right-3 z-20 p-1.5 rounded-lg bg-white/90 border border-gray-200 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                      </svg>
                    </button>
                    <div className="flex-1 overflow-hidden">
                      <StudioItemViewer item={viewerStudioItem} onClose={closeStudioViewer} />
                    </div>
                  </div>
              )
            )}

            {/* Document Viewer */}
            {viewerDoc && (
              <div className="flex-1 flex flex-col overflow-hidden bg-white">
                <SharedSourceViewer
                  source={{ id: viewerDoc.id, filename: viewerDoc.name, file_type: viewerDoc.type }}
                  sourceUrl={viewerUrl ?? undefined}
                  sourceFileUrl={viewerFileUrl ?? undefined}
                  loading={viewerLoading}
                  onClose={() => resetViewerState()}
                  transcriptText={viewerText ?? undefined}
                />
              </div>
            )}

            {/* 진도현황 고정 바 */}
            {!viewerDoc && !viewerStudioItem && (() => {
              const totalWeeks = Math.max(16, weeks.length);
              const weekNums = Array.from({ length: totalWeeks }, (_, i) => i + 1);
              const cols = totalWeeks <= 16 ? 16 : Math.ceil(totalWeeks / Math.ceil(totalWeeks / 16));
              const activeWeekIds = new Set(weeks.filter(w => w.status === "ACTIVE").map(w => w.id));
              return (
                <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-3.5 z-10">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] font-semibold text-[#2d3748]">진도현황</span>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#155dfc] inline-block" />
                        활성 {activeWeekIds.size}주차
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#d1d5db] inline-block" />
                        미공개 {totalWeeks - activeWeekIds.size}주차
                      </span>
                    </div>
                  </div>
                  <div className="mt-1" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '4px' }}>
                    {weekNums.map((weekNum) => {
                      const isActive = activeWeekIds.has(weekNum);
                      const exists = weeks.some(w => w.id === weekNum);
                      return (
                        <button
                          key={weekNum}
                          onClick={() => exists && scrollToWeek(weekNum)}
                          disabled={!exists}
                          className={`flex flex-col items-center gap-0.5 ${exists ? "group cursor-pointer" : "cursor-default"}`}
                          title={exists ? `${weekNum}주차로 이동` : `${weekNum}주차`}
                        >
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${exists ? "group-hover:scale-110" : ""} ${
                            isActive
                              ? "bg-[#155dfc] border-[#155dfc] text-white shadow-sm"
                              : exists
                                ? "bg-white border-[#6b7280] text-[#6b7280]"
                                : "bg-white border-[#d1d5db] text-[#d1d5db]"
                          }`}>
                            {weekNum}
                          </div>
                          <span className={`text-[8px] font-medium leading-none ${
                            isActive ? "text-[#155dfc]" : exists ? "text-[#6b7280]" : "text-[#d1d5db]"
                          }`}>
                            {isActive ? "활성" : exists ? "준비" : "-"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Study Plan */}
            {!viewerDoc && !viewerStudioItem && <div ref={studyPlanScrollRef} className="flex-1 overflow-y-auto min-h-0">
              <div className="px-8 pt-8 pb-7 bg-white min-h-full">
                <h1 className="mb-7" style={{ fontFamily: "Manrope, sans-serif", fontSize: "1.3rem", fontWeight: 700, color: "#001c39" }}>
                  Instructor Study Plan Sequence
                </h1>

                <div className="space-y-8">
                  {weeks.map((week) => (
                    <div
                      key={week.id}
                      id={`week-${week.id}`}
                      ref={(el) => {
                        if (el) weekCardRefs.current.set(week.id, el);
                        else weekCardRefs.current.delete(week.id);
                      }}
                      onDragOver={(e) => { e.preventDefault(); if (!draggingCard) setDropTargetWeekId(week.id); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetWeekId(null); }}
                      onDrop={(e) => handleWeekDrop(e, week.id)}
                      style={dropTargetWeekId === week.id ? { outline: "2px dashed #2563eb", borderRadius: 10, background: "#eff6ff" } : undefined}
                    >
                      {/* Week Header */}
                      <div className="flex items-center justify-between pb-2.5 mb-3 border-b group" style={{ borderColor: "#e7e8e9" }}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {editingWeekId === week.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                autoFocus
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameConfirm(week.id);
                                  if (e.key === "Escape") { setEditingWeekId(null); setEditingTitle(""); }
                                }}
                                className="flex-1 px-3 py-1.5 border-2 border-blue-400 rounded-lg focus:outline-none bg-blue-50"
                                style={{ fontSize: "1.05rem", fontWeight: 500 }}
                              />
                              <button onClick={() => handleRenameConfirm(week.id)} className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white">
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </button>
                              <button onClick={() => { setEditingWeekId(null); setEditingTitle(""); }} className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => setCollapsedWeekIds(prev => { const next = new Set(prev); next.has(week.id) ? next.delete(week.id) : next.add(week.id); return next; })}
                                className="flex items-center justify-center shrink-0 hover:bg-gray-100 rounded transition-colors p-0.5"
                                title={collapsedWeekIds.has(week.id) ? "펼치기" : "접기"}
                              >
                                <svg
                                  width="18"
                                  height="18"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  className="transition-transform duration-200"
                                  style={{ transform: collapsedWeekIds.has(week.id) ? "rotate(-90deg)" : "rotate(0deg)" }}
                                >
                                  <path d="M5 7.5L10 12.5L15 7.5" stroke="#4A5565" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.667"/>
                                </svg>
                              </button>
                              <h2 className="truncate" style={{ fontFamily:"Manrope,sans-serif", fontSize:"19px", fontWeight:500, color:"#001c39", letterSpacing:"-0.4px" }}>
                                {week.title}
                              </h2>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
                                <button onClick={() => { setEditingWeekId(week.id); setEditingTitle(week.title); }} className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50">
                                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2-8 8H1.5v-2l8-8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                                <button onClick={() => handleDeleteWeek(week.id)} className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50">
                                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {editingWeekId !== week.id && (
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <span style={{ fontSize:"12px", color:"#94a3b8", fontWeight:500 }}>
                              {(week.sources.length + week.tasks.length)}개 항목
                            </span>
                            <button
                              onClick={() => handleToggleWeekStatus(week.id)}
                              className="px-2 py-0.5 rounded transition-all"
                              style={{
                                background: week.status === "ACTIVE" ? "#cfe2f9" : "#edeeef",
                                fontSize:"10px", fontWeight:600, color:"#526478", letterSpacing:"0.05em",
                              }}
                            >
                              {week.status === "ACTIVE" ? "ACTIVE" : "UPCOMING"}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Cards */}
                      {!collapsedWeekIds.has(week.id) && <div className="space-y-3">
                        {/* Source cards */}
                        {week.sources.map((source) => {
                          const isDraggingThis = draggingCard?.weekId === week.id && draggingCard?.cardType === "source" && draggingCard?.cardId === source.id;
                          const isOverTop = dragOverCard?.weekId === week.id && dragOverCard?.cardType === "source" && dragOverCard?.cardId === source.id && dragOverCard?.half === "top";
                          const isOverBottom = dragOverCard?.weekId === week.id && dragOverCard?.cardType === "source" && dragOverCard?.cardId === source.id && dragOverCard?.half === "bottom";
                          return (
                          <div
                            key={`src-${source.id}`}
                            className="relative rounded-[8px] group/source"
                            style={{
                              background: "#f3f4f5",
                              opacity: isDraggingThis ? 0.4 : 1,
                              borderTop: isOverTop ? "2px solid #2563eb" : "2px solid transparent",
                              borderBottom: isOverBottom ? "2px solid #2563eb" : "2px solid transparent",
                              cursor: "grab",
                            }}
                            draggable
                            onDragStart={(e) => {
                              setDraggingCard({ weekId: week.id, cardType: "source", cardId: source.id });
                              e.dataTransfer.setData("application/week-card", JSON.stringify({ weekId: week.id, cardType: "source", cardId: source.id }));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => { setDraggingCard(null); setDragOverCard(null); }}
                            onDragOver={(e) => handleCardDragOver(e, week.id, "source", source.id)}
                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCard(null); }}
                            onDrop={(e) => handleCardDrop(e, week.id, "source", source.id)}
                          >
                            <div className="flex items-center px-4 gap-3" style={{ height: 72 }}>
                              <div className="shrink-0 grid gap-[3px]" style={{ gridTemplateColumns: "repeat(2,4px)", opacity:0.4 }}>
                                {[...Array(6)].map((_, i) => <div key={i} className="rounded-full" style={{ width:4, height:4, background:"#99A1AF" }}/>)}
                              </div>
                              <div className="shrink-0 flex items-center justify-center rounded-[4px] text-xl" style={{ width:38, height:38, background: getIconBg(source.iconBg) }}>
                                {source.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                {renamingSource?.weekId === week.id && renamingSource?.sourceId === source.id ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      autoFocus
                                      value={renamingSourceTitle}
                                      onChange={(e) => setRenamingSourceTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void handleRenameSourceConfirm();
                                        }
                                        if (e.key === "Escape") {
                                          setRenamingSource(null);
                                          setRenamingSourceTitle("");
                                        }
                                      }}
                                      className="flex-1 min-w-0 rounded-md border border-blue-400 px-2 py-0.5 text-sm font-semibold outline-none"
                                      style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", color:"#191c1d" }}
                                    />
                                    <button
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleRenameSourceConfirm();
                                      }}
                                      className="w-6 h-6 rounded bg-blue-500 text-white flex items-center justify-center shrink-0"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </button>
                                    <button
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRenamingSource(null);
                                        setRenamingSourceTitle("");
                                      }}
                                      className="w-6 h-6 rounded bg-gray-100 text-gray-500 flex items-center justify-center shrink-0"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 group/title cursor-text min-w-0">
                                    <p className="truncate" style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", fontWeight:600, color:"#191c1d" }}>{source.name}</p>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRenamingSource({ weekId: week.id, sourceId: source.id, docId: source.docId });
                                        setRenamingSourceTitle(source.name);
                                      }}
                                      onMouseDown={(e) => e.preventDefault()}
                                      className="shrink-0 opacity-0 group-hover/source:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200"
                                      title="이름 변경"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </button>
                                  </div>
                                )}
                                <p style={{ fontFamily:"Inter,sans-serif", fontSize:"12px", color:"#414751" }}>학습 소스 자료</p>
                              </div>
                              {source.docId && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleViewDoc({ id: source.docId!, name: source.name, type: source.iconBg }); }}
                                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                  style={{ background: "#1d4ed8", color: "white", fontSize: "12px" }}
                                >
                                  열기
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setWeeks((prev) => prev.map((w) =>
                                  w.id !== week.id ? w : { ...w, sources: w.sources.filter((s) => s.id !== source.id) }
                                )); }}
                                className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/source:opacity-100 transition-all"
                              >
                                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                              </button>
                            </div>
                          </div>
                        );})}

                        {/* Task cards */}
                        {week.tasks.map((task) => {
                          const isDraggingThis = draggingCard?.weekId === week.id && draggingCard?.cardType === "task" && draggingCard?.cardId === task.id;
                          const isOverTop = dragOverCard?.weekId === week.id && dragOverCard?.cardType === "task" && dragOverCard?.cardId === task.id && dragOverCard?.half === "top";
                          const isOverBottom = dragOverCard?.weekId === week.id && dragOverCard?.cardType === "task" && dragOverCard?.cardId === task.id && dragOverCard?.half === "bottom";
                          return (
                          <div
                            key={task.id}
                            className="relative rounded-[8px] group/task"
                            style={{
                              background: task.generatingError ? "#FEF2F2" : task.generating ? "#EFF6FF" : "#f3f4f5",
                              opacity: isDraggingThis ? 0.4 : 1,
                              borderTop: isOverTop ? "2px solid #2563eb" : "2px solid transparent",
                              borderBottom: isOverBottom ? "2px solid #2563eb" : "2px solid transparent",
                              cursor: task.generating || task.generatingError ? "default" : "grab",
                            }}
                            draggable={!task.generating && !task.generatingError}
                            onDragStart={(e) => {
                              if (task.generating || task.generatingError) { e.preventDefault(); return; }
                              setDraggingCard({ weekId: week.id, cardType: "task", cardId: task.id });
                              e.dataTransfer.setData("application/week-card", JSON.stringify({ weekId: week.id, cardType: "task", cardId: task.id }));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => { setDraggingCard(null); setDragOverCard(null); }}
                            onDragOver={(e) => { if (!task.generating && !task.generatingError) handleCardDragOver(e, week.id, "task", task.id); }}
                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCard(null); }}
                            onDrop={(e) => { if (!task.generating && !task.generatingError) handleCardDrop(e, week.id, "task", task.id); }}
                          >
                            <div className="flex items-center px-4 gap-3" style={{ height: 72 }}>
                              {/* drag handle — 생성 중엔 숨김 */}
                              {!task.generating && !task.generatingError && (
                                <div className="shrink-0 grid gap-[3px]" style={{ gridTemplateColumns: "repeat(2,4px)", opacity:0.4 }}>
                                  {[...Array(6)].map((_, i) => <div key={i} className="rounded-full" style={{ width:4, height:4, background:"#99A1AF" }}/>)}
                                </div>
                              )}
                              {/* icon / spinner */}
                              {task.generating ? (
                                <div className="shrink-0 flex items-center justify-center rounded-[4px]" style={{ width:38, height:38, background: getIconBg(task.iconBg) }}>
                                  <svg className="w-5 h-5 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                                  </svg>
                                </div>
                              ) : (
                                <div className="shrink-0 flex items-center justify-center rounded-[4px] text-xl" style={{ width:38, height:38, background: getIconBg(task.iconBg) }}>
                                  {task.icon}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                {task.generating ? (
                                  <>
                                    <p className="truncate animate-pulse" style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", fontWeight:600, color:"#2563eb" }}>{task.title}</p>
                                    <p style={{ fontFamily:"Inter,sans-serif", fontSize:"12px", color:"#6b7280" }}>{task.subtitle}</p>
                                  </>
                                ) : task.generatingError ? (
                                  <>
                                    <p className="truncate" style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", fontWeight:600, color:"#ef4444" }}>생성 실패</p>
                                    <p className="truncate" style={{ fontFamily:"Inter,sans-serif", fontSize:"12px", color:"#f87171" }}>{task.generatingError}</p>
                                  </>
                                ) : renamingTask?.weekId === week.id && renamingTask?.taskId === task.id ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      autoFocus
                                      value={renamingTaskTitle}
                                      onChange={(e) => setRenamingTaskTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRenameTaskConfirm();
                                        if (e.key === "Escape") { setRenamingTask(null); setRenamingTaskTitle(""); }
                                      }}
                                      className="flex-1 min-w-0 rounded-md border border-blue-400 px-2 py-0.5 text-sm font-semibold outline-none"
                                      style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", color:"#191c1d" }}
                                    />
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); handleRenameTaskConfirm(); }} className="w-6 h-6 rounded bg-blue-500 text-white flex items-center justify-center shrink-0">
                                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </button>
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setRenamingTask(null); setRenamingTaskTitle(""); }} className="w-6 h-6 rounded bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
                                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div
                                      className="flex items-center gap-1 group/title cursor-text min-w-0"
                                      onDoubleClick={() => { setRenamingTask({ weekId: week.id, taskId: task.id }); setRenamingTaskTitle(task.title); }}
                                    >
                                      <p className="truncate" style={{ fontFamily:"Inter,sans-serif", fontSize:"15px", fontWeight:600, color:"#191c1d" }}>{task.title}</p>
                                      <button onClick={(e) => { e.stopPropagation(); setRenamingTask({ weekId: week.id, taskId: task.id }); setRenamingTaskTitle(task.title); }} className="shrink-0 opacity-0 group-hover/task:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200" title="이름 변경">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                      </button>
                                    </div>
                                    <p style={{ fontFamily:"Inter,sans-serif", fontSize:"12px", color:"#414751" }}>
                                      {["quiz", "flashcard"].includes(task.studioType || "")
                                        ? task.subtitle
                                        : task.subtitle.replace(/\s·\s\d+문제/g, "")}
                                    </p>
                                  </>
                                )}
                              </div>
                              {/* 완료 아이템: 시작하기 버튼 */}
                              {!task.generating && !task.generatingError && task.itemId && (
                                <button
                                  onClick={() => {
                                    const studioItem = studioItems.find((item) => item.id === task.itemId);
                                    if (studioItem) {
                                      openStudioViewer(studioItem);
                                      return;
                                    }
                                    setStudioOpenItemId(task.itemId!);
                                  }}
                                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                  style={{ background: "#1d4ed8", color: "white", fontSize: "12px" }}
                                >
                                  시작하기
                                </button>
                              )}
                              {/* 생성중/오류: X 버튼 항상 보임 | 완료: hover시 보임 */}
                              {task.generating ? (
                                <button
                                  onClick={() => handleDeleteTask(week.id, task.id)}
                                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-all opacity-0 group-hover/task:opacity-100"
                                  title="취소"
                                >
                                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                                </button>
                              ) : task.generatingError ? (
                                <button
                                  onClick={() => handleDeleteTask(week.id, task.id)}
                                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-100 transition-all"
                                >
                                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                                </button>
                              ) : !task.generating && (
                                <button
                                  onClick={() => handleDeleteTask(week.id, task.id)}
                                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/task:opacity-100 transition-all"
                                >
                                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        );})}

                        {/* Add buttons */}
                        <div className="flex gap-3">
                          {week.sources.length === 0 ? (
                            <button
                              onClick={() => { setOpenSourcePickerWeekId(week.id); setSelectedSourceType(null); setSourceForm({ title:"", url:"", text:"" }); }}
                              className="flex-1 flex items-center justify-center gap-2 hover:bg-gray-50 transition-all"
                              style={{ minHeight:52, borderRadius:8, border:"2px dashed rgba(193,199,211,0.7)", background:"rgba(249,250,251,0.8)" }}
                            >
                              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M10 4V16" stroke="#717783" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.667"/></svg>
                              <span style={{ fontSize:"13px", fontWeight:600, color:"#717783" }}>소스를 먼저 추가해주세요</span>
                            </button>
                          ) : (
                            <>
                              <button
                              onClick={() => { setOpenPickerWeekId(week.id); setSelectedPickerItem(null); setPickerSelectedWeekId(null); setPickerOpenedFromStudioMenu(false); }}
                                className="flex-1 flex items-center justify-center gap-2 hover:bg-gray-50 transition-all"
                                style={{ minHeight:52, borderRadius:8, border:"2px dashed rgba(193,199,211,0.5)" }}
                              >
                                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M10 4V16" stroke="#717783" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.667"/></svg>
                                <span style={{ fontSize:"13px", fontWeight:600, color:"#717783" }}>Add Task</span>
                              </button>
                              <button
                                onClick={() => { setOpenSourcePickerWeekId(week.id); setSelectedSourceType(null); setSourceForm({ title:"", url:"", text:"" }); }}
                                className="flex-1 flex items-center justify-center gap-2 hover:bg-gray-50 transition-all"
                                style={{ minHeight:52, borderRadius:8, border:"2px dashed rgba(193,199,211,0.5)" }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="#717783" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 2v6h6" stroke="#717783" strokeWidth="1.8" strokeLinejoin="round"/></svg>
                                <span style={{ fontSize:"13px", fontWeight:600, color:"#717783" }}>Add Source</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>}
                    </div>
                  ))}

                  {/* Add New Week */}
                  {weeks.length < 16 && (
                    <button
                      onClick={handleAddWeek}
                      className="w-full flex items-center justify-center gap-2 transition-all hover:bg-blue-50/60"
                      style={{ minHeight:52, borderRadius:8, border:"2px dashed rgba(59,130,246,0.35)", background:"rgba(239,246,255,0.55)" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M10 4V16" stroke="#3b82f6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.667"/></svg>
                      <span style={{ fontSize:"13px", fontWeight:600, color:"#3b82f6" }}>Add New Week</span>
                    </button>
                  )}
                </div>
              </div>
            </div>}

          </div>
        </main>

      </div>

      {studioMenuOpen && createPortal(
        <div
          ref={studioMenuRef}
          className={`fixed z-[1200] w-[380px] max-w-[calc(100vw-48px)] rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden transition-opacity ${
            studioMenuReady ? "opacity-100" : "opacity-0"
          }`}
          style={{ top: studioMenuPosition.top, left: studioMenuPosition.left }}
          data-studio-menu
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">스튜디오</p>
              <p className="text-[11px] text-gray-400">아래에서 기능을 선택하세요</p>
            </div>
            <button
              onClick={() => setStudioMenuOpen(false)}
              className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-400"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {studioTaskItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openStudioCreateFromSidebar(item)}
                  className="rounded-2xl border border-gray-200 px-2 py-3 hover:border-blue-200 hover:bg-blue-50 transition-colors text-center"
                >
                  <div className="w-10 h-10 mx-auto mb-2 rounded-2xl bg-[#EFF6FF] flex items-center justify-center text-lg">
                    {item.icon}
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700 leading-tight">{item.label}</p>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => {
                  setStudioMemoRequest((prev) => prev + 1);
                  setStudioMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 px-3 py-3 hover:border-blue-200 hover:bg-blue-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-2xl bg-[#EFF6FF] flex items-center justify-center text-blue-600 shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-700">메모 추가</p>
                  <p className="text-[11px] text-gray-400">스튜디오 기능과 별도로 메모를 작성합니다</p>
                </div>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="fixed left-[-9999px] top-0 w-px h-px overflow-hidden" aria-hidden="true">
        <StudioPanel
          notebookId={notebook.id}
          activeDocIds={activeDocIds}
          docs={docs}
          getToken={getToken}
          weeks={weeks}
          hideCollections={true}
          onSavedItemsChange={setStudioItems}
          onAddWeekTask={handleAddWeekTask}
          onRenameItem={(itemId, newTitle) => {
            setWeeks((prev) => prev.map((w) => ({
              ...w,
              tasks: w.tasks.map((t) => t.itemId === itemId ? { ...t, title: newTitle } : t),
            })));
          }}
          onDeleteItem={(itemId) => {
            setWeeks((prev) => prev.map((w) => ({
              ...w,
              tasks: w.tasks.filter((t) => t.itemId !== itemId),
            })));
          }}
          openItemId={studioOpenItemId}
          onOpenItemHandled={() => setStudioOpenItemId(null)}
          openCreateType={studioCreateType}
          openCreateWeekId={studioCreateWeekId}
          onOpenCreateHandled={() => setStudioCreateType(null)}
          openMemoRequest={studioMemoRequest}
          onOpenMemoHandled={() => setStudioMemoRequest(0)}
          forcePortalSubviews={true}
          onViewItem={(item) => { openStudioViewer(item); }}
        />
      </div>

      {/* ─── Add Task Modal ─── */}
      {openPickerWeekId !== null && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={closePickerModal} />
          <div className="fixed inset-0 z-50 overflow-y-auto pointer-events-none">
            <div className="min-h-full flex items-center justify-center p-4 pt-8 pb-8">
            <div
              className="bg-white rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
              style={{ width: selectedPickerItem ? 560 : 520, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-3">
                  {selectedPickerItem && (
                    <button onClick={handlePickerBack} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  )}
                  <div>
                    <p className="text-gray-800 font-bold" style={{ fontSize: "1.05rem" }}>
                      {selectedPickerItem ? `${selectedPickerItem.label} 생성` : "태스크 추가"}
                    </p>
                    <p className="text-gray-400" style={{ fontSize: "0.78rem" }}>
                      {selectedPickerItem ? "상세 옵션을 설정하고 만들기를 누르세요" : `Week ${openPickerWeekId}에 추가할 콘텐츠 유형을 선택하세요`}
                    </p>
                  </div>
                </div>
                <button onClick={closePickerModal} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
              </div>

              {/* Step 1: Grid */}
              {!selectedPickerItem && (
                <div className="grid grid-cols-3 gap-3 p-5 overflow-y-auto">
                  {studioTaskItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { setSelectedPickerItem(item); setPickerSelectedWeekId(openPickerWeekId); setPickerOpenedFromStudioMenu(false); setPickerSourcesCollapsed(false); setDetailConfig({ format: item.id === "quiz" ? (item.presets[0] ?? "") : "", instructions:"", length:"10문제", language:"한국어", style:"격식체", selectedSources:[] }); }}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md transition-all group"
                    >
                      <div className={`w-12 h-12 rounded-2xl ${item.iconBg} flex items-center justify-center text-2xl border border-gray-100 group-hover:scale-110 transition-transform`}>
                        {item.icon}
                      </div>
                      <div className="text-center">
                        <p className="text-gray-700 group-hover:text-blue-600 transition-colors font-semibold" style={{ fontSize: "0.82rem" }}>{item.label}</p>
                        <p className="text-gray-400" style={{ fontSize: "0.7rem" }}>{item.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Step 2: Detail */}
              {selectedPickerItem && (
                <div className="overflow-y-auto flex-1">
                  <div className="p-6 space-y-5">
                    {/* Week selector */}
                    <div>
                      <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>주차</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => { setPickerSelectedWeekId(null); setDetailConfig((c) => ({ ...c, selectedSources: [] })); }}
                          className={`px-3 py-1.5 rounded-xl border-2 font-semibold transition-all ${pickerSelectedWeekId === null ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                          style={{ fontSize: "0.82rem" }}
                        >
                          주차 미지정
                        </button>
                        {weeks.map((w, idx) => (
                          <button
                            key={w.id}
                            onClick={() => { setPickerSelectedWeekId(w.id); setDetailConfig((c) => ({ ...c, selectedSources: [] })); }}
                            className={`px-3 py-1.5 rounded-xl border-2 font-semibold transition-all ${pickerSelectedWeekId === w.id ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                            style={{ fontSize: "0.82rem" }}
                          >
                            {w.title || `Week ${idx + 1}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Source selection */}
                    {(() => {
                      const pickerSources = getPickerSourceOptions();
                      if (pickerSources.length === 0) return null;
                      return (
                        <div>
                          <button
                            onClick={() => setPickerSourcesCollapsed((prev) => !prev)}
                            className="w-full mb-2 flex items-center justify-between text-left"
                          >
                            <p className="text-gray-700 font-bold" style={{ fontSize: "0.88rem" }}>
                              참고 소스 <span className="text-gray-400 font-normal">(선택)</span>
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-400">
                                {pickerSelectedWeekId === null ? "전체 소스" : "선택한 주차"}
                              </span>
                              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" className="transition-transform text-gray-400" style={{ transform: pickerSourcesCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </button>
                          {!pickerSourcesCollapsed && (
                          <div className="space-y-2">
                            {pickerSources.map((src) => {
                              const checked = detailConfig.selectedSources.includes(src.id);
                              return (
                                <button key={src.id}
                                  onClick={() => setDetailConfig((c) => ({ ...c, selectedSources: checked ? c.selectedSources.filter((id) => id !== src.id) : [...c.selectedSources, src.id] }))}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${checked ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"}`}
                                >
                                  <span className="text-lg">{src.icon}</span>
                                  <span className={`flex-1 truncate font-semibold ${checked ? "text-blue-700" : "text-gray-600"}`} style={{ fontSize: "0.83rem" }}>{src.name}</span>
                                  {checked && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </button>
                              );
                            })}
                          </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Format */}
                    <div>
                      <p className="text-gray-700 mb-3 font-bold" style={{ fontSize: "0.88rem" }}>형식</p>
                      {selectedPickerItem?.id !== "quiz" && (
                        <button
                          onClick={() => setDetailConfig((c) => ({ ...c, format: "" }))}
                          className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border-2 mb-3 transition-all ${detailConfig.format === "" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
                        >
                          <span className={detailConfig.format === "" ? "text-blue-600 font-semibold" : "text-gray-600 font-semibold"} style={{ fontSize: "0.85rem" }}>직접 만들기</span>
                          {detailConfig.format === "" && <svg className="ml-auto" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      )}
                      {selectedPickerItem?.id !== "quiz" && <p className="text-gray-400 mb-2 font-semibold" style={{ fontSize: "0.75rem" }}>추천 형식</p>}
                      <div className="grid grid-cols-2 gap-2">
                        {selectedPickerItem.presets.map((preset) => (
                          <button key={preset}
                            onClick={() => setDetailConfig((c) => ({ ...c, format: preset }))}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${detailConfig.format === preset ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-300 bg-gray-50"}`}
                          >
                            <span className="text-base">{selectedPickerItem.icon}</span>
                            <span className={detailConfig.format === preset ? "text-blue-600 font-medium" : "text-gray-600"} style={{ fontSize: "0.8rem" }}>{preset}</span>
                            {detailConfig.format === preset && <svg className="ml-auto shrink-0" width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Instructions */}
                    <div>
                      <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>추가 지시사항 <span className="text-gray-400 font-normal">(선택)</span></p>
                      <textarea
                        value={detailConfig.instructions}
                        onChange={(e) => setDetailConfig((c) => ({ ...c, instructions: e.target.value }))}
                        placeholder="예) 초등학생도 이해할 수 있도록 쉽게 작성해주세요..."
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-300 focus:outline-none resize-none text-gray-700 placeholder-gray-300 bg-gray-50 focus:bg-white transition-all"
                        style={{ fontSize: "0.84rem" }}
                      />
                    </div>

                    {/* Length - 퀴즈/플래시카드만 표시 */}
                    {["quiz", "flashcard"].includes(selectedPickerItem.id) && (
                    <div>
                      <p className="text-gray-700 mb-2 font-bold" style={{ fontSize: "0.88rem" }}>문제 수</p>
                      <div className="flex gap-2">
                        {["5문제","10문제","15문제"].map((opt) => (
                          <button key={opt} onClick={() => setDetailConfig((c) => ({ ...c, length: opt }))}
                            className={`flex-1 py-2 rounded-xl border-2 transition-all ${detailConfig.length === opt ? "border-blue-400 bg-blue-50 text-blue-600 font-bold" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                            style={{ fontSize: "0.82rem" }}
                          >{opt}</button>
                        ))}
                      </div>
                    </div>
                    )}

                    {/* Create button */}
                    <button
                      onClick={() => handleGenerateFromModal(selectedPickerItem)}
                      disabled={generatingTask}
                      className="w-full py-3.5 rounded-2xl text-white transition-all hover:opacity-90 shadow-md disabled:opacity-70"
                      style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", fontSize: "0.95rem", fontWeight: 700 }}
                    >
                      {generatingTask ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>
                          생성 중...
                        </span>
                      ) : (
                        <>{selectedPickerItem.icon} {selectedPickerItem.label} 만들기</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Add Source Modal (existing docs picker) ─── */}
      {openSourcePickerWeekId !== null && openSourcePickerWeekId > 0 && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={closeSourceModal} />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div
              className="bg-white rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
              style={{ width: 460, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-gray-800 font-bold" style={{ fontSize: "1.05rem" }}>소스에서 청크 선택</p>
                  <p className="text-gray-400" style={{ fontSize: "0.78rem" }}>
                    {(() => { const idx = weeks.findIndex(w => w.id === openSourcePickerWeekId); return idx >= 0 ? `Week ${idx + 1}에 추가할 청크를 선택하세요` : "소스를 선택하세요"; })()}
                  </p>
                </div>
                <button onClick={closeSourceModal} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
              </div>

              {/* Body — doc list */}
              <div className="flex-1 overflow-y-auto">
                {docs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                    <svg className="w-10 h-10 text-gray-200 mb-3" viewBox="0 0 24 24" fill="none">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                    </svg>
                    <p className="text-gray-400" style={{ fontSize: "0.85rem" }}>먼저 왼쪽 사이드바에서<br/>소스를 추가해주세요</p>
                  </div>
                ) : (
                  <div className="py-2 px-3 space-y-0.5">
                    <p className="px-3 pt-1 pb-2 text-gray-400" style={{ fontSize: "0.72rem" }}>소스를 선택하세요</p>
                    {docs.map((doc) => {
                      const checked = pickedDocIds.includes(doc.id);
                      const alreadyAdded = (() => {
                        const w = weeks.find(wk => wk.id === openSourcePickerWeekId);
                        return w?.sources.some(s => s.docId === doc.id) ?? false;
                      })();
                      const ext = (doc.type ?? "").toLowerCase();
                      const icon = ext === "pdf" ? "📜" : ext === "url" ? "🔗" : ["jpg","jpeg","png","gif","webp"].includes(ext) ? "🖼️" : ["mp4","mov","avi","mkv","webm"].includes(ext) ? "🎥" : ["mp3","m4a"].includes(ext) ? "🎧" : "📄";
                      return (
                        <div
                          key={doc.id}
                          onClick={() => {
                            if (alreadyAdded) return;
                            setPickedDocIds(prev => prev.includes(doc.id) ? prev.filter(id => id !== doc.id) : [...prev, doc.id]);
                          }}
                          className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                            alreadyAdded ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"
                          } ${checked ? "bg-blue-50" : ""}`}
                        >
                          <div className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center shrink-0 transition-colors ${
                            checked ? "bg-blue-500 border-blue-500" : "border-gray-300"
                          }`}>
                            {checked && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-base">
                            {icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-800 truncate" style={{ fontSize: "0.82rem", fontWeight: 500 }}>{doc.name}</p>
                            <p className="text-gray-400" style={{ fontSize: "0.68rem" }}>
                              {doc.chunks != null ? `전체 ${doc.chunks}개 청크` : "청크 미집계"}
                              {alreadyAdded ? " · 이미 추가됨" : ""}
                            </p>
                          </div>
                          {alreadyAdded && (
                            <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 px-5 py-4 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={() => handleConfirmDocPick(openSourcePickerWeekId!)}
                  disabled={pickedDocIds.length === 0}
                  className="w-full py-3 rounded-2xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  style={{ background: pickedDocIds.length > 0 ? "linear-gradient(135deg, #3b82f6, #1d4ed8)" : undefined, fontSize: "0.92rem" }}
                >
                  {pickedDocIds.length === 0 ? "청크를 선택하세요" : `${pickedDocIds.length}개 소스 추가`}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Invite Code Modal ─── */}
      {showShareModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={closeShareModal} />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] pointer-events-auto overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
                <div>
                  <h3 className="text-gray-800 font-bold" style={{ fontSize: "16px" }}>초대 코드 공유</h3>
                  <p className="text-gray-400" style={{ fontSize: "12px" }}>&quot;{notebook.title}&quot;</p>
                </div>
                <button onClick={closeShareModal} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="px-6 py-6 space-y-4">
                {inviteLoading ? (
                  <div className="flex items-center justify-center py-6 text-sm text-gray-400">코드 생성 중...</div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-4">
                      <span className="flex-1 text-2xl font-bold tracking-widest text-blue-600 text-center">{inviteCode}</span>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(inviteCode).catch(() => {}); }}
                        className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 transition-colors"
                        title="복사"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        try {
                          const ta = document.createElement("textarea");
                          ta.value = inviteCode;
                          ta.style.cssText = "position:fixed;opacity:0";
                          document.body.appendChild(ta);
                          ta.focus(); ta.select();
                          document.execCommand("copy");
                          document.body.removeChild(ta);
                        } catch {}
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2500);
                      }}
                      className="w-full py-3 rounded-xl text-white transition-all hover:opacity-90 flex items-center justify-center gap-2"
                      style={{ background: linkCopied ? "#16a34a" : "linear-gradient(135deg, #2B7FFF, #60a5fa)", fontSize: "14px", fontWeight: 600 }}
                    >
                      {linkCopied ? (
                        <><svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>복사 완료!</>
                      ) : (
                        <><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="white" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>코드 복사</>
                      )}
                    </button>
                    <p className="text-xs text-gray-400 text-center">학생에게 이 코드를 알려주세요. 학생이 코드를 입력하면 이 노트북에 참여할 수 있습니다.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
