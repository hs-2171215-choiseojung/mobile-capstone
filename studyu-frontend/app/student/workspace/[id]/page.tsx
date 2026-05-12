"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, BotMessageSquare } from 'lucide-react';
import { Resizable } from 're-resizable';

import { TopNavBar } from "@/components/workspace/student/TopNavBar";
import { WeeklyPlanCard } from "@/components/workspace/student/WeeklyPlanCard";
import { StudentChatPanel, SourceChunk } from "@/components/workspace/student/StudentChatPanel";
import { StudioItemViewer } from "@/components/workspace/student/StudioItemViewer";
import { StudentSourceViewer } from "@/components/workspace/student/StudentSourceViewer";
import { PptSlideViewer } from "@/components/workspace/PptSlideViewer";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const RECENT_NOTEBOOKS_STORAGE_KEY = "student-recent-notebooks";
const MODEL_STORAGE_KEY = "studyu_default_model";
const LEVEL_STORAGE_KEY = "studyu_default_level";
const LEGACY_MODEL_KEY = "student-selected-llm";

function normalizeLearningLevel(value: string | null | undefined): "easy" | "normal" | "brief" {
  switch (value) {
    case "beginner":
    case "easy":
      return "easy";
    case "advanced":
    case "brief":
      return "brief";
    case "intermediate":
    case "normal":
    default:
      return "normal";
  }
}

interface WeekTask {
  itemId?: string;
}

interface WeekPlan {
  id: number;
  title?: string;
  instruct?: string;
  instruction?: string;
  instructions?: string;
  description?: string;
  tasks?: WeekTask[];
  sources?: { docId?: string; doc_id?: string; name?: string; title?: string }[];
}

interface DocumentInfo {
  id: string;
  filename: string;
  storage_path?: string;
  file_type: string;
  status?: string;
}

interface MediaTimelineEntry {
  time_sec: number;
  label?: string;
  text: string;
}

interface MediaSummarySection {
  title: string;
  summary: string;
  start_sec?: number | null;
  end_sec?: number | null;
}

interface MediaSummary {
  title?: string;
  overview?: string;
  sections?: MediaSummarySection[];
}

const PREVIEWABLE_OFFICE_EXTS = new Set(["docx", "pptx", "ppt"]);

function getOfficeEmbedUrl(url: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
}

function isYoutubeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host);
  } catch {
    return false;
  }
}

function isHttpUrl(url?: string): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function canGenerateMediaSummary(doc: DocumentInfo | null, resolvedUrl?: string): boolean {
  if (!doc) return false;
  const normalizedFileType = (doc.file_type || "").toLowerCase();
  const ext = doc.filename.toLowerCase().split(".").pop() ?? normalizedFileType;
  const youtubeCandidates = [doc.storage_path, doc.filename, resolvedUrl].filter(Boolean) as string[];
  const isYoutubeSource = youtubeCandidates.some((value) => isYoutubeUrl(value));
  return (
    normalizedFileType === "url" ||
    normalizedFileType === "link" ||
    normalizedFileType === "youtube" ||
    isYoutubeSource ||
    ["mp4", "mov", "avi", "mkv", "webm", "video", "mp3", "m4a", "wav", "audio"].includes(ext)
  );
}

export default function StudentWorkspacePage() {
  const params = useParams();
  const notebookId = params.id as string;

  const [notebookTitle, setNotebookTitle] = useState<string>("");

  const [activeDocIds, setActiveDocIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [studioItems, setStudioItems] = useState<any[]>([]);
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedSource, setSelectedSource] = useState<DocumentInfo | null>(null);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [selectedSourceDownloadUrl, setSelectedSourceDownloadUrl] = useState("");
  const [selectedSourceError, setSelectedSourceError] = useState("");
  const [isSourceLoading, setIsSourceLoading] = useState(false);
  const [selectedSourceTranscript, setSelectedSourceTranscript] = useState<string | undefined>(undefined);
  const [selectedSourceTimeline, setSelectedSourceTimeline] = useState<MediaTimelineEntry[]>([]);
  const [selectedSourceSummary, setSelectedSourceSummary] = useState<MediaSummary | null>(null);
  const [selectedSourceSummaryLoading, setSelectedSourceSummaryLoading] = useState(false);
  const [selectedSourceMediaDuration, setSelectedSourceMediaDuration] = useState(0);
  const [selectedSourceMediaType, setSelectedSourceMediaType] = useState<"audio" | "video" | null>(null);
  const [selectedSourceSeekRequest, setSelectedSourceSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const [highlightRange, setHighlightRange] = useState<{ start: number; length: number } | null>(null);
  const pendingHighlightRef = useRef<{ start: number; length: number } | null>(null);
  const [citationScrollText, setCitationScrollText] = useState<string | undefined>(undefined);
  const pendingScrollTextRef = useRef<string | undefined>(undefined);
  const [currentSlide, setCurrentSlide] = useState<number | null>(null);
  const [chatRequestedSlide, setChatRequestedSlide] = useState<number | null>(null);

  // 챗 링크로 슬라이드 이동 시 currentSlide도 동기화
  useEffect(() => {
    if (chatRequestedSlide !== null) setCurrentSlide(chatRequestedSlide);
  }, [chatRequestedSlide]);

  // 소스 변경 시 현재 페이지/슬라이드 초기화
  useEffect(() => {
    setCurrentSlide(null);
    setChatRequestedSlide(null);
  }, [selectedSource?.id]);

  const [selectedLLM, setSelectedLLM] = useState('claude-haiku-4-5-20251001');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'normal' | 'brief'>('normal');
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  useEffect(() => {
    try {
      // 레거시 키(student-selected-llm)에 값이 있고 새 키가 비었으면 한 번만 이관
      const legacy = localStorage.getItem(LEGACY_MODEL_KEY);
      if (legacy && !localStorage.getItem(MODEL_STORAGE_KEY)) {
        localStorage.setItem(MODEL_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_MODEL_KEY);
      }
      const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
      if (savedModel) setSelectedLLM(savedModel);
      const savedLevel = localStorage.getItem(LEVEL_STORAGE_KEY);
      if (savedLevel) setSelectedDifficulty(normalizeLearningLevel(savedLevel));
    } catch {
      // ignore storage errors
    } finally {
      setPrefsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, selectedLLM);
      localStorage.setItem(LEVEL_STORAGE_KEY, selectedDifficulty);
    } catch {
      // ignore storage errors
    }
  }, [selectedLLM, selectedDifficulty, prefsHydrated]);

  const [expandedCenterWeeks, setExpandedCenterWeeks] = useState<number[]>([]);
  const [centerWeeksHydrated, setCenterWeeksHydrated] = useState(false);

  const [isDataLoading, setIsDataLoading] = useState(true);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(380);

  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const centerScrollTopRef = useRef(0);
  const shouldRestoreCenterScrollRef = useRef(false);
  const weekCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const toText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "title" in (value as Record<string, unknown>)) {
      return toText((value as Record<string, unknown>).title, fallback);
    }
    return fallback;
  };

  const normalizeDocumentName = (value: unknown) =>
    toText(value).trim().toLowerCase();

  const isReadyDocument = (doc: Partial<DocumentInfo> | null | undefined) =>
    !!doc?.id && (!doc.status || doc.status === "ready");

  const getDocumentIdentityKey = (doc: Partial<DocumentInfo>) => {
    const id = typeof doc.id === "string" ? doc.id.trim() : "";
    if (id) return `id:${id}`;

    const storagePath = typeof doc.storage_path === "string" ? doc.storage_path.trim().toLowerCase() : "";
    if (storagePath) return `path:${storagePath}`;

    const filename = typeof doc.filename === "string" ? doc.filename.trim().toLowerCase() : "";
    if (filename) return `name:${filename}`;

    return "";
  };

  const mergeUniqueDocuments = (...groups: Array<Partial<DocumentInfo>[]>) => {
    const uniqueDocs: DocumentInfo[] = [];
    const seenKeys = new Set<string>();

    groups.flat().forEach((rawDoc) => {
      if (!rawDoc) return;

      const normalizedDoc: DocumentInfo = {
        id: toText(rawDoc.id),
        filename: toText(rawDoc.filename, "Source"),
        storage_path: toText(rawDoc.storage_path),
        file_type: toText(rawDoc.file_type, "file"),
        status: toText(rawDoc.status),
      };

      const identityKey = getDocumentIdentityKey(normalizedDoc);
      if (!identityKey) return;
      if (seenKeys.has(identityKey)) return;

      seenKeys.add(identityKey);
      uniqueDocs.push(normalizedDoc);
    });

    return uniqueDocs;
  };

  const fetchData = async () => {
    setIsDataLoading(true);
    try {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    const [notebookRes, studioRes, studyPlanRes] = await Promise.all([
      fetch(`${API}/api/notebooks/${notebookId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      fetch(`${API}/api/studio?notebook_id=${notebookId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      fetch(`${API}/api/notebooks/${notebookId}/study-plan`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
    ]);

    if (notebookRes.ok) {
      const notebookData = await notebookRes.json();
      const customTitle = (() => {
        try { return localStorage.getItem(`notebook-custom-title:${notebookId}`) || ""; } catch { return ""; }
      })();
      setNotebookTitle(customTitle || toText(notebookData?.title));
      setDocs(
        Array.isArray(notebookData?.documents)
          ? notebookData.documents.filter((doc: Partial<DocumentInfo>) => isReadyDocument(doc))
          : []
      );
    } else {
      setNotebookTitle("");
      setDocs([]);
    }

    if (studyPlanRes.ok) {
      const studyPlanData = await studyPlanRes.json();
      setWeekPlans(Array.isArray(studyPlanData?.plan_data) ? studyPlanData.plan_data : []);
    } else {
      setWeekPlans([]);
    }

    if (studioRes.ok) {
      const studioData = await studioRes.json();
      setStudioItems(Array.isArray(studioData) ? studioData : []);
    } else {
      setStudioItems([]);
    }
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    if (notebookId) fetchData();
  }, [notebookId]);

  useEffect(() => {
    if (!notebookId) return;
    try {
      const raw = localStorage.getItem(RECENT_NOTEBOOKS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const current = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
      const next = [notebookId, ...current.filter((id) => id !== notebookId)].slice(0, 20);
      localStorage.setItem(RECENT_NOTEBOOKS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }, [notebookId]);

  const displayDocs = useMemo(() => mergeUniqueDocuments(docs), [docs]);

  const displayDocsMap = useMemo(
    () => new Map(displayDocs.map((doc) => [doc.id, doc])),
    [displayDocs]
  );

  const displayDocsByName = useMemo(
    () =>
      new Map(
        displayDocs
          .map((doc) => [normalizeDocumentName(doc.filename), doc] as const)
          .filter(([name]) => Boolean(name))
      ),
    [displayDocs]
  );

  const studioItemMap = new Map(studioItems.map((item) => [item.id, item]));
  const assignedStudioItemIds = new Set(
    weekPlans
      .flatMap((week) => week.tasks ?? [])
      .map((task) => task.itemId)
      .filter(Boolean) as string[]
  );

  const cards = weekPlans
    .filter((week) => (week as any).status === "ACTIVE")
    .map((week, index) => {
    const weekSources = week.sources ?? [];
    const weekDocs = mergeUniqueDocuments(
      weekSources
      .map((source, sourceIndex) => {
        const docId = source.docId || source.doc_id;
        const sourceName = source.name || source.title || "Source";

        if (docId) {
          const matched =
            displayDocsMap.get(docId) ||
            displayDocsByName.get(normalizeDocumentName(sourceName));
          if (!matched) return null;
          return { ...matched, sourceDocId: docId, resolvedDocId: matched.id };
        }

        return {
          id: `week-source-${week.id ?? index + 1}-${sourceIndex}`,
          sourceDocId: "",
          resolvedDocId: "",
          filename: sourceName,
          file_type: "file",
        };
      })
      .filter(Boolean) as any[]
    );

    const weekItemIds = (week.tasks ?? []).map((task) => task.itemId).filter(Boolean) as string[];
    const weekItemsFromPlan = weekItemIds
      .map((itemId) => studioItemMap.get(itemId))
      .filter(Boolean) as any[];
    const weekItemsFromTag = studioItems.filter((item) => {
      if (!item?.id) return false;
      if (assignedStudioItemIds.has(item.id)) return false;
      return item?.content?.week_id === (week.id ?? index + 1);
    });
    const instruct =
      week.instruct ||
      week.instruction ||
      week.instructions ||
      week.description ||
      "";
    return {
      key: week.id ?? index + 1,
      weekNumber: week.id ?? index + 1,
      weekTitle: toText(week.title),
      instruct: toText(instruct),
      items: [...weekDocs, ...weekItemsFromPlan, ...weekItemsFromTag],
    };
  });


  useEffect(() => {
    if (!notebookId) return;
    const storageKey = `student-center-expanded-weeks:${notebookId}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setExpandedCenterWeeks(parsed.filter((v): v is number => typeof v === "number"));
          setCenterWeeksHydrated(true);
          return;
        }
      }
    } catch {
      // ignore parse errors
    }

    const defaultOpen = weekPlans.length > 0 ? [weekPlans[0].id ?? 1] : [1];
    setExpandedCenterWeeks(defaultOpen);
    setCenterWeeksHydrated(true);
  }, [notebookId, weekPlans]);

  useEffect(() => {
    if (!notebookId || !centerWeeksHydrated) return;
    const storageKey = `student-center-expanded-weeks:${notebookId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(expandedCenterWeeks));
    } catch {
      // ignore storage errors
    }
  }, [notebookId, expandedCenterWeeks, centerWeeksHydrated]);

  useEffect(() => {
    if (selectedItem !== null || selectedSource !== null) return;
    if (!shouldRestoreCenterScrollRef.current) return;
    const target = centerScrollRef.current;
    if (!target) return;
    target.scrollTop = centerScrollTopRef.current;
    shouldRestoreCenterScrollRef.current = false;
  }, [selectedItem, selectedSource]);

  useEffect(() => {
    return () => {
      if (selectedSourceUrl.startsWith("blob:")) {
        URL.revokeObjectURL(selectedSourceUrl);
      }
    };
  }, [selectedSourceUrl]);

  const AUDIO_EXTS = new Set(["mp3", "m4a", "wav"]);
  const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
  const PDF_EXTS = new Set(["pdf"]);
  const TEXT_ONLY_EXTS = new Set(["docx", "pptx", "ppt", "hwp", "hwpx"]);

  const loadMediaSummary = async (docId: string) => {
    if (!docId || selectedSourceSummaryLoading) return;
    if (selectedSourceSummary?.sections?.length) return;

    setSelectedSourceSummaryLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const response = await fetch(`${API}/api/documents/${docId}/media-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        setSelectedSourceSummary(null);
        return;
      }
      setSelectedSourceSummary(data);
    } catch {
      setSelectedSourceSummary(null);
    } finally {
      setSelectedSourceSummaryLoading(false);
    }
  };

  const deleteMediaSummary = async (docId: string) => {
    if (!docId) return;
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    await fetch(`${API}/api/documents/${docId}/media-summary`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setSelectedSourceSummary(null);
    setSelectedSourceSummaryLoading(false);
  };

  const openSourceDocument = async (doc: DocumentInfo) => {
    if (selectedSourceUrl.startsWith("blob:")) {
      URL.revokeObjectURL(selectedSourceUrl);
    }
    setActiveDocIds([doc.id]);
    setSelectedItem(null);
    setSelectedSource(doc);
    setSelectedSourceUrl("");
    setSelectedSourceDownloadUrl("");
    setSelectedSourceError("");
    setSelectedSourceTranscript(undefined);
    setSelectedSourceTimeline([]);
    setSelectedSourceSummary(null);
    setSelectedSourceSummaryLoading(false);
    setSelectedSourceMediaDuration(0);
    setSelectedSourceMediaType(null);
    setSelectedSourceSeekRequest(null);
    setIsSourceLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { setSelectedSourceError("로그인이 필요합니다."); return; }

      const ext = doc.filename.toLowerCase().split(".").pop() ?? doc.file_type;
      const rawTypeIsUrl = doc.file_type === "url" || doc.file_type === "link";
      const isYoutubeSource = isYoutubeUrl(doc.storage_path);
      const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);
      const HWPX_EXTS = new Set(["hwpx", "hwp"]);
      const needsAccessUrl = rawTypeIsUrl || !TEXT_ONLY_EXTS.has(ext) || PREVIEWABLE_OFFICE_EXTS.has(ext) || !ext;
      const needsText = rawTypeIsUrl || isYoutubeSource || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext) || TEXT_ONLY_EXTS.has(ext);
      const needsPreviewPdf = PREVIEWABLE_OFFICE_EXTS.has(ext) && !HWPX_EXTS.has(ext);
      const isKnownFileExt =
        AUDIO_EXTS.has(ext) ||
        VIDEO_EXTS.has(ext) ||
        TEXT_ONLY_EXTS.has(ext) ||
        PREVIEWABLE_OFFICE_EXTS.has(ext) ||
        IMAGE_EXTS.has(ext) ||
        PDF_EXTS.has(ext);

      let resolvedAccessUrl = "";
      const _unusedNextSourceTextPromise = needsText
        ? fetch(`${API}/api/documents/${doc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json().catch(() => ({})))
            .then((data) => {
              // TEXT_ONLY 파일(HWP 등)은 텍스트가 없어도 transcript 뷰를 표시하기 위해 항상 설정
              if (TEXT_ONLY_EXTS.has(ext)) {
                setSelectedSourceTranscript(data?.text ?? "");
              } else if (data?.text) {
                setSelectedSourceTranscript(data.text);
              }
            })
        : Promise.resolve();
      if (needsAccessUrl) {
        const accessResponse = await fetch(`${API}/api/documents/${doc.id}/access-url`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const accessData = await accessResponse.json().catch(() => ({}));

        if (accessResponse.ok && accessData?.url) {
          resolvedAccessUrl = accessData.url;
          setSelectedSourceDownloadUrl(accessData.url);
        } else if (!needsText && !needsPreviewPdf) {
          setSelectedSourceError(accessData?.detail || "문서 URL을 가져오지 못했습니다.");
        }
      }

      const shouldUseUrlDocumentFlow =
        rawTypeIsUrl ||
        isYoutubeSource ||
        isYoutubeUrl(resolvedAccessUrl) ||
        (isHttpUrl(resolvedAccessUrl) && !isKnownFileExt);

      if (shouldUseUrlDocumentFlow) {
        const textRes = await fetch(`${API}/api/documents/${doc.id}/chunks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const textData = await textRes.json().catch(() => ({}));

        if (resolvedAccessUrl) {
          setSelectedSourceUrl(resolvedAccessUrl);
        } else {
          setSelectedSourceError("문서 URL을 가져오지 못했습니다.");
        }

        if (textRes.ok) {
          setSelectedSourceTranscript(typeof textData?.text === "string" ? textData.text : "");
          setSelectedSourceTimeline(Array.isArray(textData?.timeline) ? textData.timeline : []);
        } else {
          const detail = typeof textData?.detail === "string" ? textData.detail : "텍스트를 불러오지 못했습니다.";
          setSelectedSourceTranscript(detail);
          setSelectedSourceTimeline([]);
        }
        return;
      }

      const nextSourceTextPromise = needsText
        ? fetch(`${API}/api/documents/${doc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } })
            .then(async (r) => {
              const data = await r.json().catch(() => ({}));
              if (!r.ok) {
                const detail = typeof data?.detail === "string" ? data.detail : "텍스트를 불러오지 못했습니다.";
                setSelectedSourceTranscript(detail);
                setSelectedSourceTimeline([]);
                return;
              }
              if (typeof data?.text === "string") {
                setSelectedSourceTranscript(data.text);
              } else {
                setSelectedSourceTranscript("");
              }
              if (Array.isArray(data?.timeline)) setSelectedSourceTimeline(data.timeline);
            })
        : Promise.resolve();

      if (resolvedAccessUrl) {
        if (!needsPreviewPdf) {
          setSelectedSourceUrl(resolvedAccessUrl);
        }
      }

      if (needsPreviewPdf) {
        if (resolvedAccessUrl) {
          setSelectedSourceUrl(getOfficeEmbedUrl(resolvedAccessUrl));
        }
      }

      await nextSourceTextPromise;
    } catch {
      setSelectedSourceError("문서를 여는 중 오류가 발생했습니다.");
    } finally {
      setIsSourceLoading(false);
    }
  };

  // 소스 로딩 완료 후 대기 중인 하이라이트 적용
  useEffect(() => {
    if (!isSourceLoading && pendingHighlightRef.current) {
      setHighlightRange(pendingHighlightRef.current);
      pendingHighlightRef.current = null;
    }
    if (!isSourceLoading && pendingScrollTextRef.current) {
      setCitationScrollText(pendingScrollTextRef.current);
      pendingScrollTextRef.current = undefined;
    }
  }, [isSourceLoading]);

  const handleCitationClick = (chunk: SourceChunk) => {
    const doc = docs.find((d: DocumentInfo) => d.id === chunk.doc_id);
    if (!doc) return;
    // char_offset 이 있으면 정확한 위치, 없으면 null (븷어가 fallback 처리)
    const range =
      chunk.char_offset !== undefined && chunk.char_offset >= 0 && chunk.char_length
        ? { start: chunk.char_offset, length: chunk.char_length }
        : null;
    const scrollText = chunk.text?.slice(0, 80) || undefined;
    if (selectedSource?.id === chunk.doc_id) {
      setHighlightRange(range);
      setCitationScrollText(scrollText);
    } else {
      setHighlightRange(null);
      pendingHighlightRef.current = range;
      pendingScrollTextRef.current = scrollText;
      void openSourceDocument(doc as DocumentInfo);
    }
  };

  const scrollToWeek = (weekNumber: number) => {
    setExpandedCenterWeeks((prev) =>
      prev.includes(weekNumber) ? prev : [...prev, weekNumber]
    );
    setTimeout(() => {
      const el = weekCardRefs.current.get(weekNumber);
      if (el && centerScrollRef.current) {
        const container = centerScrollRef.current;
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + elRect.top - containerRect.top - 16, behavior: "smooth" });
      }
    }, 50);
  };

  const closeSource = () => {
    if (selectedSourceUrl.startsWith("blob:")) {
      URL.revokeObjectURL(selectedSourceUrl);
    }
    setSelectedSource(null);
    setSelectedSourceUrl("");
    setSelectedSourceDownloadUrl("");
    setSelectedSourceError("");
    setSelectedSourceTranscript(undefined);
    setSelectedSourceTimeline([]);
    setSelectedSourceSummary(null);
    setSelectedSourceSummaryLoading(false);
    setSelectedSourceMediaDuration(0);
    setSelectedSourceMediaType(null);
    setSelectedSourceSeekRequest(null);
    setActiveDocIds([]);
    shouldRestoreCenterScrollRef.current = true;
  };

  const renderModelControls = () => (
    <>
      <div className="relative">
        <select value={selectedLLM} onChange={(e) => setSelectedLLM(e.target.value)} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
          <option value="gpt-4o-mini">GPT-4o mini</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku</option>
          <option value="claude-sonnet-4-6">Claude Sonnet</option>
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      <div className="relative">
        <select value={selectedDifficulty} onChange={(e) => setSelectedDifficulty(normalizeLearningLevel(e.target.value))} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
          <option value="easy">쉽게</option>
          <option value="normal">보통</option>
          <option value="brief">간략하게</option>
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <TopNavBar title={notebookTitle} rightSlot={renderModelControls()} />
      <div className="flex flex-1 pt-[64px] overflow-hidden relative">

        {/* 채팅 없이 단독으로 열리는 스튜디오 타입 */}
        {(() => {
          const CHAT_TYPES = new Set(["quiz", "mindmap", "plan", "table", "data", "flashcard"]);
          const normalizeType = (t: string) => ({ memo: "notepad", summary: "report", plan: "mindmap", data: "table" }[t] || t);
          const itemNeedsNoChat = selectedItem && CHAT_TYPES.has(normalizeType(selectedItem.type ?? ""));

          if (selectedSource) {
            const srcExt = selectedSource.filename.toLowerCase().split(".").pop() ?? selectedSource.file_type;
            const isPpt = (srcExt === "pptx" || srcExt === "ppt") && !selectedSource.storage_path?.startsWith("http");
            const isPdf = srcExt === "pdf";
            const isDocx = srcExt === "docx";
            const isHwpx = srcExt === "hwpx" || srcExt === "hwp";
            return (
              /* 소스 문서: 뷰어 + 우측 채팅 (Resizable) */
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative min-h-0">
                  <StudentSourceViewer
                    source={selectedSource}
                    sourceUrl={selectedSourceUrl}
                    sourceFileUrl={selectedSourceDownloadUrl || selectedSourceUrl}
                    loading={isSourceLoading}
                    error={selectedSourceError}
                    transcriptText={selectedSourceTranscript}
                    mediaTimeline={selectedSourceTimeline}
                    seekRequest={selectedSourceSeekRequest}
                    onMediaInfoChange={({ kind, duration }) => {
                      setSelectedSourceMediaType(kind);
                      setSelectedSourceMediaDuration(duration);
                    }}
                    highlightRange={highlightRange ?? undefined}
                    scrollToText={citationScrollText}
                    onClose={closeSource}
                    customViewer={(isPpt || isDocx || isHwpx) ? (
                      <PptSlideViewer
                        docId={selectedSource.id}
                        currentSlide={chatRequestedSlide}
                        onSlideChange={(n) => setCurrentSlide(n)}
                      />
                    ) : undefined}
                  />
                </div>
                <Resizable
                  size={{ width: chatWidth, height: '100%' }}
                  minWidth={280}
                  maxWidth={640}
                  enable={{ left: true }}
                  onResizeStop={(_e, _dir, _ref, d) => setChatWidth(prev => prev + d.width)}
                  handleStyles={{ left: { width: '12px', left: '-6px', zIndex: 50, cursor: 'col-resize' } }}
                  handleComponent={{ left: <div className="w-full h-full flex items-center justify-center group"><div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors" /></div> }}
                  className="shrink-0 border-l border-[#e7e9ed] bg-white flex flex-col"
                >
                  <StudentChatPanel
                    activeDocIds={activeDocIds}
                    docs={docs}
                    notebookId={notebookId}
                    selectedLLM={selectedLLM}
                    selectedDifficulty={selectedDifficulty}
                    difficultyReady={prefsHydrated}
                    activeSourceId={selectedSource.id}
                    activeSourceMediaType={selectedSourceMediaType}
                    activeSourceMediaDuration={selectedSourceMediaDuration}
                    activeSourceSummary={selectedSourceSummary}
                    activeSourceSummaryLoading={selectedSourceSummaryLoading}
                    canOpenSummary={canGenerateMediaSummary(
                      selectedSource,
                      selectedSourceDownloadUrl || selectedSourceUrl
                    )}
                    onOpenSummary={() => {
                      if (selectedSourceSummary || selectedSourceSummaryLoading) return;
                      void loadMediaSummary(selectedSource.id);
                    }}
                    onDeleteSummary={() => deleteMediaSummary(selectedSource.id)}
                    onSeekToTimestamp={(seconds) => setSelectedSourceSeekRequest({ seconds, nonce: Date.now() })}
                    onCitationClick={handleCitationClick}
                    onSlideClick={isPpt ? (n) => setChatRequestedSlide(n) : undefined}
                    onPageClick={(isPdf || isDocx || isHwpx) ? (n) => {
                      if (isPdf) {
                        setSelectedSourceUrl((prev) => {
                          const base = prev.split("#")[0];
                          return `${base}#page=${n}`;
                        });
                        setCurrentSlide(n);
                      } else {
                        // DOCX/HWPX: PptSlideViewer의 페이지로 이동
                        setChatRequestedSlide(n);
                      }
                    } : undefined}
                    currentSlide={
                      isPdf ? currentSlide
                      : (isPpt || isDocx || isHwpx) ? currentSlide
                      : undefined
                    }
                  />
                </Resizable>
              </div>
            );
          }

          if (selectedItem && itemNeedsNoChat) return (
            /* 퀴즈·마인드맵·표·플래시카드: 단독 전체화면 */
            <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative">
              <StudioItemViewer
                item={selectedItem}
                onClose={() => { setSelectedItem(null); shouldRestoreCenterScrollRef.current = true; }}
              />
            </div>
          );

          if (selectedItem) return (
            /* 일반 스튜디오 아이템: 뷰어 + 우측 채팅 (Resizable) */
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative min-h-0">
                <StudioItemViewer
                  item={selectedItem}
                  onClose={() => { setSelectedItem(null); shouldRestoreCenterScrollRef.current = true; }}
                />
              </div>
              <Resizable
                size={{ width: chatWidth, height: '100%' }}
                minWidth={280}
                maxWidth={640}
                enable={{ left: true }}
                onResizeStop={(_e, _dir, _ref, d) => setChatWidth(prev => prev + d.width)}
                handleStyles={{ left: { width: '12px', left: '-6px', zIndex: 50, cursor: 'col-resize' } }}
                handleComponent={{ left: <div className="w-full h-full flex items-center justify-center group"><div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors" /></div> }}
                className="shrink-0 border-l border-[#e7e9ed] bg-white flex flex-col"
              >
                <StudentChatPanel activeDocIds={activeDocIds} docs={docs} notebookId={notebookId} selectedLLM={selectedLLM} selectedDifficulty={selectedDifficulty} difficultyReady={prefsHydrated} onCitationClick={handleCitationClick} />
              </Resizable>
            </div>
          );

          return null;
        })()}

        {!selectedSource && !selectedItem && (
          /* 기본: Weekly Study Plan */
          <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
            {/* 진도현황 고정 헤더 */}
            <div className="shrink-0 bg-white border-b border-[#e7e9ed] px-[20px] py-3 z-10">
              <div className="max-w-[900px] mx-auto">
                {isDataLoading ? (
                  <div className="animate-pulse">
                    <div className="h-3 w-16 bg-[#d1d5db] rounded mb-2" />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: '6px' }}>
                      {Array.from({ length: 16 }).map((_, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="w-7 h-7 rounded-full bg-[#e7e9ed]" />
                          <div className="h-2 w-3 bg-[#e7e9ed] rounded" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (() => {
                  const totalWeeks = Math.max(16, weekPlans.length);
                  const weekNums = Array.from({ length: totalWeeks }, (_, i) => i + 1);
                  const cols = totalWeeks <= 16 ? 16 : Math.ceil(totalWeeks / Math.ceil(totalWeeks / 16));
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-semibold text-[#2d3748]">진도현황</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-[10px] text-[#414751]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#155dfc] inline-block" />
                            활성 {cards.length}주차
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-[#414751]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#d1d5db] inline-block" />
                            미공개 {totalWeeks - cards.length}주차
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '4px' }}>
                        {weekNums.map((weekNum) => {
                          const isActive = cards.some((c) => c.weekNumber === weekNum);
                          return (
                            <button
                              key={weekNum}
                              onClick={() => isActive && scrollToWeek(weekNum)}
                              disabled={!isActive}
                              className={`flex flex-col items-center gap-0.5 ${isActive ? "group cursor-pointer" : "cursor-default"}`}
                              title={isActive ? `${weekNum}주차로 이동` : `${weekNum}주차`}
                            >
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${isActive ? "group-hover:scale-110" : ""} ${
                                isActive
                                  ? "bg-[#155dfc] border-[#155dfc] text-white shadow-sm"
                                  : "bg-white border-[#d1d5db] text-[#9ca3af]"
                              }`}>
                                {weekNum}
                              </div>
                              <span className={`text-[8px] font-medium leading-none ${isActive ? "text-[#155dfc]" : "text-[#9ca3af]"}`}>
                                {isActive ? `${weekNum}주` : "-"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* 콘텐츠 + 우측 채팅 패널 */}
            <div className="flex flex-1 overflow-hidden">
              <div ref={centerScrollRef} className="flex-1 overflow-y-auto px-[20px] py-[20px]">
                <div className="max-w-[900px] mx-auto">
                  <div className="mb-[16px]">
                    <h1 className="font-['Inter'] text-[22px] font-semibold text-[#1a1d26] tracking-[-0.5px] leading-[28px]">
                      Weekly Study Plan
                    </h1>
                    <p className="font-['Inter'] text-[13px] text-[#99a1af] mt-[2px] leading-[20px]">
                      {toText(notebookTitle, "노트북")} • Student Mode
                    </p>
                  </div>

                  {/* 카드 로딩 스켈레톤 */}
                  {isDataLoading && (
                    <div className="animate-pulse">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="mb-[28px]">
                          <div className="flex items-center gap-2.5 pb-2.5 border-b border-gray-200 mb-3">
                            <div className="w-4 h-4 rounded bg-[#e7e9ed]" />
                            <div className="h-4 w-32 bg-[#e7e9ed] rounded" />
                          </div>
                          <div className="flex flex-col gap-2">
                            {Array.from({ length: 2 }).map((_, j) => (
                              <div key={j} className="flex items-center px-3 py-2.5 border border-gray-200 rounded-lg">
                                <div className="w-8 h-8 rounded-lg bg-[#e7e9ed] mr-3 shrink-0" />
                                <div className="flex-1">
                                  <div className="h-3.5 w-40 bg-[#e7e9ed] rounded mb-1.5" />
                                  <div className="h-2.5 w-24 bg-[#f3f4f6] rounded" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 카드 */}
                  {!isDataLoading && (
                    <div className="flex flex-col gap-[28px] pb-10">
                      {cards.length === 0 ? (
                        <div className="text-sm text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-xl px-5 py-6 text-center">
                          강사가 추가한 주차가 아직 없습니다.
                        </div>
                      ) : (
                        cards.map((card) => (
                          <div
                            key={card.key}
                            ref={(el) => {
                              if (el) weekCardRefs.current.set(card.weekNumber, el);
                              else weekCardRefs.current.delete(card.weekNumber);
                            }}
                          >
                            <WeeklyPlanCard
                              weekNumber={card.weekNumber}
                              weekTitle={card.weekTitle}
                              instruct={card.instruct}
                              items={card.items}
                              isExpanded={expandedCenterWeeks.includes(card.weekNumber)}
                              onToggleExpanded={() => {
                                setExpandedCenterWeeks((prev) =>
                                  prev.includes(card.weekNumber)
                                    ? prev.filter((id) => id !== card.weekNumber)
                                    : [...prev, card.weekNumber]
                                );
                              }}
                              onOpenItem={(item) => {
                                centerScrollTopRef.current = centerScrollRef.current?.scrollTop ?? 0;
                                setSelectedItem(item);
                              }}
                              onOpenDoc={(doc) => {
                                const targetDocId = doc?.resolvedDocId || doc?.sourceDocId || doc?.id;
                                if (!targetDocId) return;
                                const targetDoc = displayDocs.find((candidate) => candidate.id === targetDocId);
                                if (!targetDoc) return;
                                centerScrollTopRef.current = centerScrollRef.current?.scrollTop ?? 0;
                                void openSourceDocument(targetDoc);
                              }}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 우측 채팅 패널 */}
              {isChatOpen && (
                <Resizable
                  size={{ width: chatWidth, height: '100%' }}
                  minWidth={280}
                  maxWidth={640}
                  enable={{ left: true }}
                  onResizeStop={(_e, _dir, _ref, d) => setChatWidth(prev => prev + d.width)}
                  handleStyles={{ left: { width: '12px', left: '-6px', zIndex: 50, cursor: 'col-resize' } }}
                  handleComponent={{
                    left: (
                      <div className="w-full h-full flex items-center justify-center group">
                        <div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors" />
                      </div>
                    )
                  }}
                  className="shrink-0 border-l border-[#e7e9ed] bg-white flex flex-col"
                >
                  <StudentChatPanel activeDocIds={activeDocIds} docs={docs} notebookId={notebookId} selectedLLM={selectedLLM} selectedDifficulty={selectedDifficulty} difficultyReady={prefsHydrated} onClose={() => setIsChatOpen(false)} onCitationClick={handleCitationClick} />
                </Resizable>
              )}
            </div>

            {/* 플로팅 버튼 (채팅 닫혀있을 때) */}
            {!isChatOpen && (
              <button
                onClick={() => setIsChatOpen(true)}
                className="absolute bottom-6 right-6 w-14 h-14 bg-[#155dfc] text-white rounded-full flex items-center justify-center shadow-[0_8px_16px_rgba(21,93,252,0.3)] hover:bg-[#0d4ac4] hover:scale-105 transition-all z-50"
                title="Ask AI 열기"
              >
                <BotMessageSquare className="w-6 h-6" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
