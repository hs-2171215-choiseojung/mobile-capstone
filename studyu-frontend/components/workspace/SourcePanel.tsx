"use client";

import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Doc {
  id: string;
  name: string;
  chunks: number;
  type?: "pdf" | "url";
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

function LinkIcon({ active }: { active: boolean }) {
  return (
    <div
      className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
      style={{ background: active ? "#d2e3fc" : "#f1f3f4" }}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
        <path
          d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
          stroke={active ? "#1a73e8" : "#80868b"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
          stroke={active ? "#1a73e8" : "#80868b"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function DocIcon({ doc, active }: { doc: Doc; active: boolean }) {
  if (doc.type === "url") return <LinkIcon active={active} />;
  return <PdfIcon active={active} />;
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
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
        { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: "pdf" },
      ]);
      setActiveDocIds((prev) => [...prev, data.doc_id]);
    } catch (e: unknown) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleIngestUrl() {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      alert("올바른 URL을 입력해주세요 (http:// 또는 https://)");
      return;
    }
    setUrlLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/ingest_url`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notebook_id: notebookId, url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "URL 추가 실패");
      setDocs((prev) => [
        ...prev,
        { id: data.doc_id, name: data.filename, chunks: data.chunk_count, type: "url" },
      ]);
      setActiveDocIds((prev) => [...prev, data.doc_id]);
      setUrlValue("");
      setShowUrlInput(false);
    } catch (e: unknown) {
      alert(`URL 추가 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUrlLoading(false);
    }
  }

  async function handleRenameSubmit(docId: string) {
    const newName = renameValue.trim();
    if (!newName) { setRenamingId(null); return; }
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/${docId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filename: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "이름 변경 실패");
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, name: data.filename } : d));
    } catch (e: unknown) {
      alert(`이름 변경 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setRenamingId(null);
    }
  }

  async function handleDelete(docId: string) {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/${docId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? "삭제 실패");
      }
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      setActiveDocIds((prev) => prev.filter((id) => id !== docId));
    } catch (e: unknown) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
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
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded-full"
              style={{
                background: activeDocIds.length > 0 ? "#d2e3fc" : "#f1f3f4",
                color: activeDocIds.length > 0 ? "#1a73e8" : "#80868b",
              }}
            >
              {activeDocIds.length}/{docs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* PDF 버튼 — label로 파일 다이얼로그 직접 열기 (버튼 텍스트 안 바뀜) */}
          <label
            htmlFor="pdf-file-input"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all select-none"
            style={{ background: "#1a73e8", color: "white" }}
            title="PDF 파일 추가"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            PDF
          </label>
          <input
            id="pdf-file-input"
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

          {/* URL 버튼 */}
          <button
            onClick={() => { setShowUrlInput((v) => !v); setUrlValue(""); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: showUrlInput ? "#e8f0fe" : "#1a73e8",
              color: showUrlInput ? "#1a73e8" : "white",
              border: showUrlInput ? "1px solid #1a73e8" : "1px solid transparent",
            }}
            title="URL 추가"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            URL
          </button>
        </div>
      </div>

      {/* PDF 업로드 진행 표시 */}
      {uploading && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
          </svg>
          <span className="text-xs text-blue-600">PDF 업로드 중...</span>
        </div>
      )}

      {/* URL 입력 폼 */}
      {showUrlInput && (
        <div className="px-3 py-2 border-b bg-white" style={{ borderColor: "#e0e0e0" }}>
          <div className="flex items-center gap-1.5">
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleIngestUrl();
                if (e.key === "Escape") { setShowUrlInput(false); setUrlValue(""); }
              }}
              placeholder="https://..."
              disabled={urlLoading}
              autoFocus
              className="flex-1 px-2.5 py-1.5 text-xs border rounded-lg outline-none focus:border-blue-400"
              style={{ borderColor: "#d2d2d2" }}
            />
            <button
              onClick={handleIngestUrl}
              disabled={urlLoading || !urlValue.trim()}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
              style={{
                background: urlLoading || !urlValue.trim() ? "#f1f3f4" : "#1a73e8",
                color: urlLoading || !urlValue.trim() ? "#9aa0a6" : "white",
                cursor: urlLoading || !urlValue.trim() ? "not-allowed" : "pointer",
              }}
            >
              {urlLoading ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                </svg>
              ) : "추가"}
            </button>
          </div>
          {urlLoading && (
            <p className="text-xs text-blue-500 mt-1">URL에서 텍스트를 추출하고 있습니다...</p>
          )}
        </div>
      )}

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
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="text-sm text-gray-500 mb-1">PDF를 드래그하거나</p>
            <label htmlFor="pdf-file-input" className="text-sm font-medium text-blue-600 hover:underline cursor-pointer">
              파일 선택
            </label>
          </div>
        ) : (
          <div className="p-3 space-y-1">
            {/* 전체 선택 */}
            {docs.length > 1 && (
              <button
                onClick={toggleAll}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors"
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={activeDocIds.length === docs.length}
                  className="pointer-events-none accent-blue-600"
                />
                전체 선택 ({docs.length}개)
              </button>
            )}

            {/* 문서 항목 */}
            {docs.map((doc) => {
              const active = activeDocIds.includes(doc.id);
              const isRenaming = renamingId === doc.id;
              const isHovered = hoveredId === doc.id;

              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    background: active ? "white" : "transparent",
                    border: active ? "1px solid #d2e3fc" : "1px solid transparent",
                  }}
                  onMouseEnter={() => setHoveredId(doc.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* 체크박스 */}
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => !isRenaming && toggleDoc(doc.id)}
                    className="shrink-0 accent-blue-600 cursor-pointer"
                  />

                  {/* 아이콘 + 내용 */}
                  <button
                    onClick={() => !isRenaming && toggleDoc(doc.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    style={{ cursor: isRenaming ? "default" : "pointer" }}
                  >
                    <DocIcon doc={doc} active={active} />
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleRenameSubmit(doc.id); }
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => handleRenameSubmit(doc.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-sm font-medium text-gray-800 border-b border-blue-400 bg-transparent outline-none"
                        />
                      ) : (
                        <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                      )}
                      <p className="text-xs text-gray-400">{doc.chunks}개 청크</p>
                    </div>
                  </button>

                  {/* 액션 버튼 (호버 시 표시) */}
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    style={{ opacity: isHovered && !isRenaming ? 1 : 0, transition: "opacity 0.15s" }}
                  >
                    {/* 이름 변경 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingId(doc.id); setRenameValue(doc.name); }}
                      className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                      title="이름 변경"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {/* 삭제 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                      className="p-1 rounded-md hover:bg-red-50 transition-colors"
                      title="삭제"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" viewBox="0 0 24 24" fill="none">
                        <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
