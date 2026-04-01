"use client";

import { useState, useRef, useEffect } from 'react';
import { BotMessageSquare, Mic, Send, Paperclip, Loader2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Doc {
  id: string;
  name: string;
}

interface StudentChatPanelProps {
  notebookId: string;
  userId?: string;
  activeDocIds: string[];
  docs: Doc[];
  selectedLLM?: string;
  selectedDifficulty?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function StudentChatPanel({ activeDocIds, docs, notebookId, selectedLLM, selectedDifficulty }: StudentChatPanelProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 자료별 채팅 키: 선택된 doc ID 기반 (없으면 노트북 전체)
  const chatKey = activeDocIds.length > 0
    ? `studyu_chat_${notebookId}_doc_${[...activeDocIds].sort().join('_')}`
    : `studyu_chat_${notebookId}`;

  const chatKeyRef = useRef(chatKey);

  // activeDocIds 변경 시 해당 자료의 채팅 히스토리 로드
  useEffect(() => {
    chatKeyRef.current = chatKey;
    setIsLoaded(false);
    const savedMessages = localStorage.getItem(chatKey);
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (e) {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
    setIsLoaded(true);
  }, [chatKey]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(chatKeyRef.current, JSON.stringify(messages));
    }
    
    if (messagesEndRef.current) {
      const scrollContainer = messagesEndRef.current.parentElement;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
      }
    }
  }, [messages, isLoaded]);

  // 대화 내역 초기화 기능
  const handleClearChat = () => {
    if (confirm("대화 내역을 모두 지우시겠습니까?")) {
      setMessages([]);
      localStorage.removeItem(chatKeyRef.current);
    }
  };

  const getToken = async () => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || "";
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    setInputValue(''); 
    setIsLoading(true);

    try {
      const token = await getToken();
      const targetDocIds = activeDocIds.length > 0 ? activeDocIds : docs.map(d => d.id);

      if (targetDocIds.length === 0) {
        throw new Error("학습할 소스(문서)가 없습니다. 강사님께 자료 업로드를 요청해 주세요.");
      }

      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          doc_ids: targetDocIds,
          question: userMessage,
          model: selectedLLM || "gpt-4o-mini",
          level: selectedDifficulty || "intermediate",
          session_id: notebookId 
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "AI 응답을 가져오는데 실패했습니다.");
      }

      const data = await res.json();
      setMessages(prev => [...prev, { type: 'ai', content: data.answer }]);

    } catch (error: any) {
      setMessages(prev => [...prev, { type: 'system', content: `[오류] ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* 헤더 */}
      <div className="p-4 border-b border-[#e7e9ed] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <BotMessageSquare className="w-5 h-5 text-[#155dfc]" />
          <h2 className="text-[14px] font-semibold text-[#1a1d26]">Ask AI</h2>
        </div>
        
        {messages.length > 0 && (
          <button 
            onClick={handleClearChat}
            className="p-1.5 text-[#99a1af] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
            title="대화 내역 지우기"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 메시지 리스트 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col h-full">
            {/* 인트로 */}
            <div className="flex flex-col items-start gap-2 mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#155dfc]">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor"/>
              </svg>
              <p className="text-[13px] text-[#414751] leading-relaxed">
                안녕하세요! 학습 중 궁금한 점이 있으신가요?<br />
                최선을 다해 도와드리겠습니다.
              </p>
              <p className="text-[11px] text-[#99a1af]">
                어떻게 질문해야 할지 모르겠다면 아래 예시를 눌러보세요.
              </p>
            </div>
            {/* 추천 질문 칩 */}
            <div className="flex flex-col items-end gap-2">
              {[
                "이 자료를 요약해줘",
                "핵심 개념을 설명해줘",
                "어려운 부분을 쉽게 설명해줘",
                "중요한 용어를 정리해줘",
                "퀴즈 문제를 내줘",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInputValue(q); }}
                  className="px-3 py-1.5 rounded-full border border-[#e7e9ed] bg-white text-[12px] text-[#414751] hover:border-[#155dfc] hover:text-[#155dfc] hover:bg-blue-50 transition-colors text-right"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
                msg.type === 'user' 
                  ? 'bg-[#155dfc] text-white rounded-tr-sm' 
                  : msg.type === 'system'
                  ? 'bg-red-50 text-red-600 border border-red-100'
                  : 'bg-[#f8f9fb] text-[#1a1d26] border border-[#e7e9ed] rounded-tl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-3 bg-[#f8f9fb] text-[#1a1d26] border border-[#e7e9ed] rounded-2xl rounded-tl-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#155dfc]" />
              <span className="text-[13px] text-[#99a1af] font-medium">AI가 답변을 작성 중입니다...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="p-3 bg-white flex flex-col gap-2 shrink-0 border-t border-[#e7e9ed]">
        <div className="relative flex items-end gap-2 bg-[#f8f9fb] rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-[#155dfc]/20 transition-all border border-[#e7e9ed] focus-within:border-[#155dfc]/30 shadow-sm">
          <button className="p-2 text-[#99a1af] hover:text-[#155dfc] hover:bg-white rounded-lg transition-colors shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            rows={1}
            className="flex-1 max-h-[100px] min-h-[40px] py-2 bg-transparent text-[#1a1d26] text-[13px] placeholder-[#99a1af] focus:outline-none resize-none self-center"
            placeholder="학습 내용에 대해 무엇이든 물어보세요..."
          />
          
          <div className="flex items-center gap-1 shrink-0">
            <button className="p-2 text-[#99a1af] hover:text-[#155dfc] hover:bg-white rounded-lg transition-colors">
              <Mic className="w-4 h-4" />
            </button>
            <button 
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="p-2 text-white bg-[#155dfc] hover:bg-[#0d4ac4] rounded-lg disabled:opacity-50 disabled:bg-[#99a1af] transition-colors shadow-sm"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}