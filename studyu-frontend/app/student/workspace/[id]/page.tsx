"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, BotMessageSquare } from 'lucide-react';
import { Resizable } from 're-resizable';

import { TopNavBar } from "@/components/workspace/student/TopNavBar";
import { StudentSourcePanel } from "@/components/workspace/student/StudentSourcePanel";
import { WeeklyPlanCard } from "@/components/workspace/student/WeeklyPlanCard";
import { StudentStudioPanel } from "@/components/workspace/student/StudentStudioPanel";
import { StudentChatPanel } from "@/components/workspace/student/StudentChatPanel";
import { StudioItemViewer } from "@/components/workspace/student/StudioItemViewer"; 
import { StudentSourceViewer } from "@/components/workspace/student/StudentSourceViewer";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export default function StudentWorkspacePage() {
  const params = useParams();
  const notebookId = params.id as string;
  
  const [notebookTitle, setNotebookTitle] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");

  const [activeDocIds, setActiveDocIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [studioItems, setStudioItems] = useState<any[]>([]); 
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedSource, setSelectedSource] = useState<DocumentInfo | null>(null);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [selectedSourceError, setSelectedSourceError] = useState("");
  const [isSourceLoading, setIsSourceLoading] = useState(false);
  const [selectedSourceTranscript, setSelectedSourceTranscript] = useState<string | undefined>(undefined);

  const [selectedLLM, setSelectedLLM] = useState('gpt-4o');
  const [selectedDifficulty, setSelectedDifficulty] = useState('intermediate');
  const [expandedCenterWeeks, setExpandedCenterWeeks] = useState<number[]>([]);
  const [centerWeeksHydrated, setCenterWeeksHydrated] = useState(false);

  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [leftOpenBefore, setLeftOpenBefore] = useState(true);

  const [chatHeight, setChatHeight] = useState(320);
  const [isChatOpen, setIsChatOpen] = useState(true);

  const [leftWidth, setLeftWidth] = useState(288);
  const [rightWidth, setRightWidth] = useState(360);
  const [isLeftResizing, setIsLeftResizing] = useState(false);
  const [isRightResizing, setIsRightResizing] = useState(false);
  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const centerScrollTopRef = useRef(0);
  const shouldRestoreCenterScrollRef = useRef(false);

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

  const getDocumentIdentityKeys = (doc: Partial<DocumentInfo>) => {
    const keys: string[] = [];
    const id = typeof doc.id === "string" ? doc.id.trim() : "";
    if (id) keys.push(`id:${id}`);

    const storagePath = typeof doc.storage_path === "string" ? doc.storage_path.trim().toLowerCase() : "";
    if (storagePath) keys.push(`path:${storagePath}`);

    const filename = typeof doc.filename === "string" ? doc.filename.trim().toLowerCase() : "";
    if (filename) keys.push(`name:${filename}`);

    return keys;
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

      const identityKeys = getDocumentIdentityKeys(normalizedDoc);
      if (identityKeys.length === 0) return;
      if (identityKeys.some((key) => seenKeys.has(key))) return;

      identityKeys.forEach((key) => seenKeys.add(key));
      uniqueDocs.push(normalizedDoc);
    });

    return uniqueDocs;
  };

  const fetchData = async () => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const me = sessionData.session?.user?.id || "";
    setCurrentUserId(me);
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
      setNotebookTitle(toText(notebookData?.title));
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
  };

  useEffect(() => {
    if (notebookId) fetchData();
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

  const unassignedStudioItems = studioItems.filter((item) => {
    if (!item?.id) return false;
    if (assignedStudioItemIds.has(item.id)) return false;
    return typeof item?.content?.week_id !== "number";
  });

  const cardsWithUnassigned = unassignedStudioItems.length > 0
    ? [
        ...cards,
        {
          key: "unassigned-studio",
          weekNumber: 0,
          weekTitle: "주차 미지정",
          instruct: "",
          items: unassignedStudioItems,
        },
      ]
    : cards;

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

  const AUDIO_EXTS = new Set(["mp3", "m4a", "wav"]);
  const TEXT_ONLY_EXTS = new Set(["docx", "pptx", "ppt", "hwp", "hwpx"]);

  const openSourceDocument = async (doc: DocumentInfo) => {
    setActiveDocIds([doc.id]);
    setLeftOpenBefore(isLeftOpen);
    setIsLeftOpen(false);
    if (!isRightOpen) setIsRightOpen(true);
    setSelectedItem(null);
    setSelectedSource(doc);
    setSelectedSourceUrl("");
    setSelectedSourceError("");
    setSelectedSourceTranscript(undefined);
    setIsSourceLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { setSelectedSourceError("로그인이 필요합니다."); return; }

      const ext = doc.filename.toLowerCase().split(".").pop() ?? doc.file_type;
      const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);
      const needsUrl = !TEXT_ONLY_EXTS.has(ext);
      const needsText = AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext) || TEXT_ONLY_EXTS.has(ext);

      const fetches: Promise<void>[] = [];

      if (needsUrl) {
        fetches.push(
          fetch(`${API}/api/documents/${doc.id}/access-url`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json().catch(() => ({})))
            .then((data) => {
              if (data?.url) setSelectedSourceUrl(data.url);
              else setSelectedSourceError(data?.detail || "문서 URL을 가져오지 못했습니다.");
            })
        );
      }

      if (needsText) {
        fetches.push(
          fetch(`${API}/api/documents/${doc.id}/chunks`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json().catch(() => ({})))
            .then((data) => { if (data?.text) setSelectedSourceTranscript(data.text); })
        );
      }

      await Promise.all(fetches);
    } catch {
      setSelectedSourceError("문서를 여는 중 오류가 발생했습니다.");
    } finally {
      setIsSourceLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden min-w-[1200px]">
      <TopNavBar title={notebookTitle} />
      <div className="flex flex-1 pt-[64px] overflow-hidden relative">
        
        {/* 왼쪽: 소스 패널 */}
        <Resizable
          size={{ width: isLeftOpen ? leftWidth : 0, height: '100%' }}
          minWidth={isLeftOpen ? 200 : 0}
          maxWidth={isLeftOpen ? 600 : 0}
          enable={{ right: isLeftOpen }}
          onResizeStart={() => setIsLeftResizing(true)}
          onResizeStop={(e, direction, ref, d) => {
            setIsLeftResizing(false);
            setLeftWidth(prev => prev + d.width);
          }}
          handleStyles={{ right: { width: '12px', right: '-6px', zIndex: 50, cursor: 'col-resize' } }}
          handleComponent={{
            right: isLeftOpen ? (
              <div className="w-full h-full flex items-center justify-center group">
                <div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div>
              </div>
            ) : <></>
          }}
          className={`shrink-0 bg-white flex flex-col relative z-10 border-[#e7e9ed] ${
            !isLeftResizing ? "transition-all duration-300 ease-in-out" : ""
          } ${isLeftOpen ? "border-r" : "border-r-0 overflow-hidden"}`}
        >
          <div className="w-full h-full flex flex-col min-w-[200px]">
            <StudentSourcePanel
              sources={displayDocs}
              onOpenSource={openSourceDocument}
              selectedSourceId={selectedSource?.id ?? null}
              isOpen={isLeftOpen}
              onToggleOpen={() => setIsLeftOpen((prev) => !prev)}
            />
          </div>
        </Resizable>

        {/* 가운데: 메인 패널 */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative transition-all duration-300">
          
          <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#e7e9ed] shrink-0 z-10">
            <button onClick={() => setIsLeftOpen(!isLeftOpen)} className="p-1.5 text-gray-400 hover:text-[#155dfc] hover:bg-blue-50 rounded-lg transition-colors">
              {isLeftOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select value={selectedLLM} onChange={(e) => setSelectedLLM(e.target.value)} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    <option value="claud-3-opus">Claude 3 Opus</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="relative">
                  <select value={selectedDifficulty} onChange={(e) => setSelectedDifficulty(e.target.value)} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
                    <option value="beginner">초급</option>
                    <option value="intermediate">중급</option>
                    <option value="advanced">고급</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <button onClick={() => setIsRightOpen(!isRightOpen)} className="p-1.5 text-gray-400 hover:text-[#155dfc] hover:bg-blue-50 rounded-lg transition-colors">
                {isRightOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {selectedItem ? (
            <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative">
              <StudioItemViewer 
                item={selectedItem} 
                onClose={() => {
                  setSelectedItem(null);
                  setIsLeftOpen(leftOpenBefore);
                  shouldRestoreCenterScrollRef.current = true;
                }} 
              />
            </div>
          ) : selectedSource ? (
            <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative">
              <StudentSourceViewer
                source={selectedSource}
                sourceUrl={selectedSourceUrl}
                loading={isSourceLoading}
                error={selectedSourceError}
                transcriptText={selectedSourceTranscript}
                onClose={() => {
                  setSelectedSource(null);
                  setSelectedSourceUrl("");
                  setSelectedSourceError("");
                  setSelectedSourceTranscript(undefined);
                  setIsLeftOpen(leftOpenBefore);
                  shouldRestoreCenterScrollRef.current = true;
                }}
              />
            </div>
          ) : (
            <>
              <div ref={centerScrollRef} className="flex-1 overflow-y-auto px-[32px] py-[32px]">
                <div className="max-w-[800px] mx-auto">
                  <div className="mb-[32px]">
                    <h1 className="font-['Inter'] text-[30px] font-semibold text-[#1a1d26] tracking-[-0.75px] leading-[36px]">
                      Weekly Study Plan
                    </h1>
                    <p className="font-['Inter'] text-[16px] text-[#99a1af] mt-[4px] leading-[24px]">
                      {toText(notebookTitle, "노트북")} • Student Mode
                    </p>
                  </div>
                  <div className="flex flex-col gap-[48px] pb-10">
                    {cardsWithUnassigned.length === 0 ? (
                      <div className="text-sm text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-xl px-5 py-6 text-center">
                        강사가 추가한 주차가 아직 없습니다.
                      </div>
                    ) : (
                      cardsWithUnassigned.map((card) => (
                        <WeeklyPlanCard 
                          key={card.key} 
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
                            setSelectedSource(null);
                            setSelectedSourceUrl("");
                            setSelectedSourceError("");
                            setSelectedItem(item);
                            setLeftOpenBefore(isLeftOpen);
                            setIsLeftOpen(false);
                            if (!isRightOpen) setIsRightOpen(true);
                          }}
                          onOpenDoc={(doc) => {
                            const targetDocId = doc?.resolvedDocId || doc?.sourceDocId || doc?.id;
                            if (!targetDocId) return;
                            const targetDoc = displayDocs.find((candidate) => candidate.id === targetDocId);
                            if (!targetDoc) return;
                            centerScrollTopRef.current = centerScrollRef.current?.scrollTop ?? 0;
                            setActiveDocIds([targetDoc.id]);
                            setIsLeftOpen(true);
                            void openSourceDocument(targetDoc);
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>

              {isChatOpen && (
                <Resizable
                  size={{ width: '100%', height: chatHeight }}
                  onResizeStop={(e, direction, ref, d) => {
                    const newHeight = chatHeight + d.height;
                    if (newHeight <= 100) {
                      setIsChatOpen(false);
                      setChatHeight(320);
                    } else {
                      setChatHeight(newHeight);
                    }
                  }}
                  minHeight={50}
                  maxHeight="80%"
                  enable={{ top: true }}
                  handleStyles={{ top: { marginTop: '-4px', height: '8px', cursor: 'row-resize', width: '100%', zIndex: 20 } }}
                  handleComponent={{ top: <div className="w-full h-full flex items-center justify-center group"><div className="w-16 h-1 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div></div> }}
                  className="border-t border-[#e7e9ed] bg-white shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.05)] shrink-0 flex flex-col z-10"
                >
                  <StudentChatPanel activeDocIds={activeDocIds} docs={docs} notebookId={notebookId} selectedLLM={selectedLLM} selectedDifficulty={selectedDifficulty} />
                </Resizable>
              )}
              {!isChatOpen && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="absolute bottom-6 right-6 w-14 h-14 bg-[#155dfc] text-white rounded-full flex items-center justify-center shadow-[0_8px_16px_rgba(21,93,252,0.3)] hover:bg-[#0d4ac4] hover:scale-105 transition-all z-50 group"
                  title="Ask AI 열기"
                >
                  <BotMessageSquare className="w-6 h-6" />
                </button>
              )}
            </>
          )}
        </div>

        {/* 오른쪽: 스튜디오 패널 */}
        <Resizable
          size={{ width: isRightOpen ? rightWidth : 0, height: '100%' }}
          minWidth={isRightOpen ? 250 : 0}
          maxWidth={isRightOpen ? 800 : 0}
          enable={{ left: isRightOpen }}
          onResizeStart={() => setIsRightResizing(true)}
          onResizeStop={(e, direction, ref, d) => {
            setIsRightResizing(false);
            setRightWidth(prev => prev + d.width);
          }}
          handleStyles={{ left: { width: '12px', left: '-6px', zIndex: 50, cursor: 'col-resize' } }}
          handleComponent={{
            left: isRightOpen ? (
              <div className="w-full h-full flex items-center justify-center group">
                <div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div>
              </div>
            ) : <></>
          }}
          className={`shrink-0 bg-[#f8f9fa] flex flex-col relative z-10 border-[#e7e9ed] ${
            !isRightResizing ? "transition-all duration-300 ease-in-out" : ""
          } ${isRightOpen ? "border-l" : "border-l-0 overflow-hidden"}`}
        >
          <div className="w-full h-full flex flex-col min-w-[250px]">
            {selectedItem || selectedSource ? (
              <StudentChatPanel 
                activeDocIds={activeDocIds} 
                docs={docs} 
                notebookId={notebookId}
                selectedLLM={selectedLLM}
                selectedDifficulty={selectedDifficulty}
              />
            ) : (
              <StudentStudioPanel 
                studioItems={studioItems} 
                docs={displayDocs}
                weeks={weekPlans.filter((w) => (w as any).status === "ACTIVE")}
                notebookId={notebookId}
                currentUserId={currentUserId}
                onRefresh={() => fetchData()}
                onOpenItem={(item) => {
                  centerScrollTopRef.current = centerScrollRef.current?.scrollTop ?? 0;
                  setSelectedItem(item);
                  setLeftOpenBefore(isLeftOpen);
                  setIsLeftOpen(false);
                  if (!isRightOpen) setIsRightOpen(true);
                }} 
              />
            )}
          </div>
        </Resizable>
      </div>
    </div>
  );
}
