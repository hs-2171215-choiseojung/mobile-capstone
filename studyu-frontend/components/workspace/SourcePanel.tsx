"use client";

import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Doc {
  id: string;
  name: string;
  chunks: number;
}

interface Props {
  notebookId: string;
  docs: Doc[];
  activeDocIds: string[];
  setActiveDocIds: React.Dispatch<React.SetStateAction<string[]>>;
  setDocs: React.Dispatch<React.SetStateAction<Doc[]>>;
  getToken: () => Promise<string>;
}

function PdfIcon({ active }: { active: boolean }) {
  return (
    <div
      className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
      style={{ background: active ? "#d2e3fc" : "#f1f3f4" }}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
          stroke={active ? "#1a73e8" : "#80868b"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6" stroke={active ? "#1a73e8" : "#80868b"} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 13h8M8 17h5" stroke={active ? "#1a73e8" : "#80868b"} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function SourcePanel({
  notebookId,
  docs,
  activeDocIds,
  setActiveDocIds,
  setDocs,
  getToken,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggleDoc(id: string) {
    setActiveDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    setActiveDocIds((prev) =>
      prev.length === docs.length ? [] : docs.map((d) => d.id)
    );
  }

  async function handleUpload(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("PDF 파일만 업로드 가능합니다.");
      return;
    }
    setUploading(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("notebook_id", notebookId);
      const res = await fetch(`${API}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "업로드 실패");
      setDocs((prev) => [
        ...prev,
        { id: data.doc_id, name: data.filename, chunks: data.chunk_count },
      ]);
      setActiveDocIds((prev) => [...prev, data.doc_id]);
    } catch (e: unknown) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside
      className="flex flex-col w-full h-full border-r"
      style={{ borderColor: "#e0e0e0", background: "#f8f9fa" }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleUpload(file);
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#e0e0e0" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">소스</span>
          {docs.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
              {activeDocIds.length}/{docs.length}
            </span>
          )}
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
          style={{
            background: uploading ? "#f1f3f4" : "#1a73e8",
            color: uploading ? "#5f6368" : "white",
            cursor: uploading ? "not-allowed" : "pointer",
          }}
        >
          {uploading ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
              </svg>
              업로드 중
            </>
          ) : (
            <>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              추가
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* 문서 목록 */}
      <div className="flex-1 overflow-y-auto">
        {docs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full px-4 text-center"
            style={{
              border: dragOver ? "2px dashed #1a73e8" : "2px dashed transparent",
              margin: "12px",
              borderRadius: "12px",
              background: dragOver ? "#e8f0fe" : "transparent",
            }}
          >
            <svg className="w-10 h-10 text-gray-300 mb-3" viewBox="0 0 24 24" fill="none">
              <path
                d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="text-sm text-gray-500 mb-1">PDF를 드래그하거나</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              파일 선택
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-1">
            {docs.length > 1 && (
              <button
                onClick={toggleAll}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors"
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={activeDocIds.length === docs.length}
                  className="pointer-events-none"
                />
                전체 선택 ({docs.length}개)
              </button>
            )}
            {docs.map((doc) => {
              const active = activeDocIds.includes(doc.id);
              return (
                <button
                  key={doc.id}
                  onClick={() => toggleDoc(doc.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all hover:bg-white"
                  style={{
                    background: active ? "white" : "transparent",
                    border: active ? "1px solid #d2e3fc" : "1px solid transparent",
                  }}
                >
                  <PdfIcon active={active} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400">{doc.chunks}개 청크</p>
                  </div>
                  {active && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
