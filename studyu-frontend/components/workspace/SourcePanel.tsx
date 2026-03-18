"use client";

import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Doc {
  id: string;
  name: string;
  chunks: number;
  sourceType?: "pdf" | "url" | "youtube";
}

interface Props {
  notebookId: string;
  docs: Doc[];
  activeDocIds: string[];
  setActiveDocIds: React.Dispatch<React.SetStateAction<string[]>>;
  setDocs: React.Dispatch<React.SetStateAction<Doc[]>>;
  getToken: () => Promise<string>;
}

function DocIcon({ sourceType, active }: { sourceType?: Doc["sourceType"]; active: boolean }) {
  const bg = active ? "#d2e3fc" : "#f1f3f4";
  const color = active ? "#1a73e8" : "#80868b";

  if (sourceType === "youtube") {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ background: bg }}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="3" stroke={color} strokeWidth="1.5" />
          <path d="M10 9l5 3-5 3V9z" fill={color} />
        </svg>
      </div>
    );
  }
  if (sourceType === "url") {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ background: bg }}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" />
          <path d="M2 12h20M12 2c-2.5 3-4 6-4 10s1.5 7 4 10M12 2c2.5 3 4 6 4 10s-1.5 7-4 10" stroke={color} strokeWidth="1.5" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ background: bg }}>
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 2v6h6" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 13h8M8 17h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
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
  const [pdfUploading, setPdfUploading] = useState(false);
  const [urlUploading, setUrlUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

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

  function startEdit(doc: Doc, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(doc.id);
    setEditingName(doc.name);
  }

  async function commitRename(docId: string) {
    const newName = editingName.trim();
    setEditingId(null);
    if (!newName || newName === docs.find((d) => d.id === docId)?.name) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/${docId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "이름 변경 실패");
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, name: data.name } : d));
    } catch (e: unknown) {
      alert(`이름 변경 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    }
  }

  async function handleDelete(docId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("이 소스를 삭제할까요?")) return;
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

  async function handleUpload(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("PDF 파일만 업로드 가능합니다.");
      return;
    }
    setPdfUploading(true);
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
        { id: data.doc_id, name: data.filename, chunks: data.chunk_count, sourceType: "pdf" },
      ]);
      setActiveDocIds((prev) => [...prev, data.doc_id]);
    } catch (e: unknown) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleUrlIngest() {
    const url = urlValue.trim();
    if (!url) return;
    setUrlUploading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/documents/ingest-url`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notebook_id: notebookId, url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "인덱싱 실패");
      setDocs((prev) => [
        ...prev,
        { id: data.doc_id, name: data.filename, chunks: data.chunk_count, sourceType: data.source_type as Doc["sourceType"] },
      ]);
      setActiveDocIds((prev) => [...prev, data.doc_id]);
      setUrlValue("");
      setShowUrlInput(false);
    } catch (e: unknown) {
      alert(`인덱싱 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setUrlUploading(false);
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
                background: activeDocIds.length > 0 ? "#dbeafe" : "#f1f3f4",
                color: activeDocIds.length > 0 ? "#1d4ed8" : "#9aa0a6",
              }}
            >
              {activeDocIds.length}/{docs.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* URL 추가 버튼 */}
          <button
            onClick={() => setShowUrlInput((v) => !v)}
            disabled={urlUploading}
            title="URL 또는 YouTube 링크 추가"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border"
            style={{
              background: showUrlInput ? "#e8f0fe" : "white",
              color: showUrlInput ? "#1a73e8" : "#5f6368",
              borderColor: showUrlInput ? "#1a73e8" : "#dadce0",
              cursor: urlUploading ? "not-allowed" : "pointer",
            }}
          >
            {urlUploading ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M2 12h20M12 2c-2.5 3-4 6-4 10s1.5 7 4 10M12 2c2.5 3 4 6 4 10s-1.5 7-4 10" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
            {urlUploading ? "처리 중" : "URL"}
          </button>

          {/* PDF 업로드 버튼 */}
          <label
            htmlFor="pdf-upload-input"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all select-none"
            style={{
              background: pdfUploading ? "#f1f3f4" : "#1a73e8",
              color: pdfUploading ? "#5f6368" : "white",
              cursor: pdfUploading ? "not-allowed" : "pointer",
              pointerEvents: pdfUploading ? "none" : "auto",
            }}
          >
            {pdfUploading ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                </svg>
                처리 중
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                PDF
              </>
            )}
          </label>
        </div>

        <input
          id="pdf-upload-input"
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

      {/* URL 입력창 */}
      {showUrlInput && (
        <div className="px-3 py-2 border-b flex gap-2" style={{ borderColor: "#e0e0e0", background: "#fff" }}>
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !urlUploading && handleUrlIngest()}
            placeholder="https:// 또는 YouTube 링크 붙여넣기"
            className="flex-1 text-xs px-3 py-1.5 rounded-lg border outline-none focus:border-blue-400"
            style={{ borderColor: "#dadce0" }}
            autoFocus
            disabled={urlUploading}
          />
          <button
            onClick={handleUrlIngest}
            disabled={urlUploading || !urlValue.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all"
            style={{
              background: urlUploading || !urlValue.trim() ? "#9aa0a6" : "#1a73e8",
              cursor: urlUploading || !urlValue.trim() ? "not-allowed" : "pointer",
            }}
          >
            {urlUploading ? "처리 중..." : "확인"}
          </button>
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
            <button
              onClick={() => inputRef.current?.click()}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              파일 선택
            </button>
            <p className="text-xs text-gray-400 mt-2">또는 URL 버튼으로 링크 추가</p>
          </div>
        ) : (
          <div className="p-3 space-y-1">
            {/* 전체 선택 */}
            <div className="flex items-center justify-between px-3 py-1.5 mb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={docs.length > 0 && activeDocIds.length === docs.length}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-blue-600 cursor-pointer"
                />
                <span className="text-xs text-gray-500 font-medium">전체 선택</span>
              </label>
              <span className="text-xs text-gray-400">{activeDocIds.length}/{docs.length} 선택됨</span>
            </div>

            {docs.map((doc) => {
              const active = activeDocIds.includes(doc.id);
              const isEditing = editingId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-white"
                  style={{
                    background: active ? "white" : "transparent",
                    border: active ? "1px solid #d2e3fc" : "1px solid transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleDoc(doc.id)}
                    className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                  />

                  <DocIcon sourceType={doc.sourceType} active={active} />

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => commitRename(doc.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(doc.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-sm font-medium text-gray-800 border border-blue-400 rounded px-1 outline-none bg-white"
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                    )}
                    <p className="text-xs text-gray-400">{doc.chunks}개 청크</p>
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => startEdit(doc, e)}
                        title="이름 변경"
                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDelete(doc.id, e)}
                        title="삭제"
                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
