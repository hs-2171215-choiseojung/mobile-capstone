"use client";

import { useState, useRef, useEffect } from "react";
import type { Doc } from "./SourcePanel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

const MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "gpt-4o", label: "GPT-4o" },
];

const LEVELS = [
  { value: "beginner", label: "입문" },
  { value: "intermediate", label: "중급" },
  { value: "advanced", label: "심화" },
];

const SUGGESTIONS = [
  "이 문서의 핵심 내용을 요약해줘",
  "가장 중요한 개념 3가지를 알려줘",
  "더 공부해야 할 부분은 어디야?",
];

interface Props {
  activeDocIds: string[];
  docs: Doc[];
  getToken: () => Promise<string>;
  notebookTitle: string;
}

export default function ChatPanel({ activeDocIds, docs, getToken, notebookTitle }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("gpt-4o-mini");
  const [level, setLevel] = useState("intermediate");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasDoc = activeDocIds.length > 0;
  const activeDocs = docs.filter((d) => activeDocIds.includes(d.id));
  const titleLabel =
    activeDocs.length === 0
      ? notebookTitle
      : activeDocs.length === 1
      ? activeDocs[0].name.replace(/\.pdf$/i, "")
      : `${activeDocs[0].name.replace(/\.pdf$/i, "")} 외 ${activeDocs.length - 1}개`;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text?: string) {
    const question = (text ?? input).trim();
    if (!question || !hasDoc) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);
    const docNames = Object.fromEntries(activeDocs.map((d) => [d.id, d.name]));
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          doc_ids: activeDocIds,
          doc_names: docNames,
          question,
          model,
          level,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, sources: data.sources },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "오류가 발생했습니다. 백엔드 서버가 실행 중인지 확인하세요." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }

  return (
    <div className="flex flex-col w-full min-w-0 h-full bg-white">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#1a73e8"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-800">{titleLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            {hasDoc ? (
              <>
                <p className="text-sm text-gray-500">업로드된 문서에 대해 질문하세요</p>
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-sm text-left px-4 py-2.5 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-gray-600"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">왼쪽에서 PDF를 업로드한 뒤 질문하세요</p>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-1 mr-2">
                <span className="text-xs font-bold text-blue-600">AI</span>
              </div>
            )}
            <div
              className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
              style={{
                background: msg.role === "user" ? "#1a73e8" : "#f8f9fa",
                color: msg.role === "user" ? "white" : "#202124",
                borderBottomRightRadius: msg.role === "user" ? "4px" : undefined,
                borderBottomLeftRadius: msg.role === "assistant" ? "4px" : undefined,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap gap-1">
                  {msg.sources.map((src) => (
                    <span key={src} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      {src}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-1 mr-2">
              <span className="text-xs font-bold text-blue-600">AI</span>
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 영역 */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm focus-within:border-blue-400 focus-within:shadow-md transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={hasDoc ? "문서에 대해 질문하세요... (Shift+Enter: 줄바꿈)" : "PDF를 먼저 업로드하세요"}
            disabled={!hasDoc || loading}
            rows={1}
            className="flex-1 resize-none outline-none text-sm text-gray-800 placeholder-gray-400 bg-transparent"
            style={{ maxHeight: "160px" }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || !hasDoc || loading}
            className="flex items-center justify-center w-8 h-8 rounded-full transition-all shrink-0"
            style={{
              background: input.trim() && hasDoc && !loading ? "#1a73e8" : "#f1f3f4",
              color: input.trim() && hasDoc && !loading ? "white" : "#bdc1c6",
            }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
