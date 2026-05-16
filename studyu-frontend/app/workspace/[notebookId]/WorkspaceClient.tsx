"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SourcePanel, { inferDocType, type Doc } from "@/components/workspace/SourcePanel";
import ChatPanel from "@/components/workspace/ChatPanel";
import StudioPanel from "@/components/workspace/StudioPanel";
import InstructorWorkspace from "@/components/workspace/InstructorWorkspace";
import StudyULogo from "@/components/StudyULogo";

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

interface Props {
  notebook: Notebook;
  initialDocs: InitialDoc[];
  backUrl: string;
  role?: "instructor" | "student";
}

function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="w-1 shrink-0 h-full cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors"
      onMouseDown={onMouseDown}
    />
  );
}

async function getToken(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export default function WorkspaceClient({ notebook, initialDocs, backUrl, role = "student" }: Props) {
  if (role === "instructor") {
    return <InstructorWorkspace notebook={notebook} initialDocs={initialDocs} backUrl={backUrl} />;
  }
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>(
    initialDocs.map((d) => ({
      id: d.id,
      name: d.filename,
      chunks: d.chunk_count ?? 0,
      type: inferDocType(d.file_type, d.filename, d.storage_path ?? undefined),
    }))
  );
  const [activeDocIds, setActiveDocIds] = useState<string[]>(
    initialDocs.map((d) => d.id)
  );
  const [sourceWidth, setSourceWidth] = useState(272);
  const [studioWidth, setStudioWidth] = useState(304);

  const dragging = useRef<"source" | "studio" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (dragging.current === "source") {
      setSourceWidth(Math.max(180, Math.min(480, e.clientX - rect.left)));
    } else {
      setStudioWidth(Math.max(180, Math.min(480, rect.right - e.clientX)));
    }
  }, []);

  const stopDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const startDrag = (type: "source" | "studio") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = type;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* 상단 네비게이션 바 */}
      <header className="shrink-0 border-b border-gray-200 bg-white z-10">
        {/* 메인 헤더 */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { router.push(backUrl); router.refresh(); }}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              대시보드
            </button>
            <span className="text-gray-300">›</span>
            <span className="text-sm font-semibold text-gray-800 truncate max-w-[200px]">{notebook.title}</span>
          </div>
          <button
            type="button"
            onClick={() => { router.push(backUrl); router.refresh(); }}
            className="flex items-center gap-2"
            aria-label="대시보드로 이동"
          >
            <StudyULogo size={28} />
            <span className="text-sm font-bold text-gray-800">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </button>
        </div>

        {/* 탭 바 */}
        <div className="flex items-center gap-1 px-4 h-10 bg-gray-50">
          <button
            className="px-4 py-2 text-sm font-medium text-blue-600 border-b-2 border-blue-600 transition-colors"
          >
            📁 소스
          </button>
          <button
            onClick={() => router.push(`/dashboard/students?notebook=${notebook.id}`)}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 border-b-2 border-transparent hover:border-blue-300 transition-colors"
          >
            👥 학생관리
          </button>
          <button
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 border-b-2 border-transparent hover:border-blue-300 transition-colors cursor-not-allowed"
            disabled
          >
            ⚙️ 설정
          </button>
        </div>
      </header>

      {/* 3-패널 레이아웃 */}
      <div
        ref={containerRef}
        className="flex flex-1 overflow-hidden"
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        {/* 좌측: 소스 패널 */}
        <div style={{ width: sourceWidth, flexShrink: 0 }} className="h-full overflow-hidden">
          <SourcePanel
            notebookId={notebook.id}
            docs={docs}
            activeDocIds={activeDocIds}
            setActiveDocIds={setActiveDocIds}
            setDocs={setDocs}
            getToken={getToken}
          />
        </div>

        <Divider onMouseDown={startDrag("source")} />

        {/* 가운데: 채팅 패널 */}
        <div className="flex-1 h-full overflow-hidden min-w-0">
          <ChatPanel
            activeDocIds={activeDocIds}
            docs={docs}
            getToken={getToken}
            notebookTitle={notebook.title}
          />
        </div>

        <Divider onMouseDown={startDrag("studio")} />

        {/* 우측: 스튜디오 패널 */}
        <div style={{ width: studioWidth, flexShrink: 0 }} className="h-full overflow-hidden">
          <StudioPanel
            notebookId={notebook.id}
            activeDocIds={activeDocIds}
            docs={docs}
            getToken={getToken}
          />
        </div>
      </div>
    </div>
  );
}
