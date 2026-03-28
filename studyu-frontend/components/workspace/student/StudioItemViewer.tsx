"use client";

import { useState, useEffect } from 'react';
import { X, Mic, FileQuestion, FileText, BookOpen, Presentation, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface StudioItemViewerProps {
  item: any;
  onClose: () => void;
}

const OPTION_ALPHA = ["A", "B", "C", "D", "E"];

function StudentQuizView({ quiz, itemInfo, onClose }: { quiz: any, itemInfo: any, onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(0);

  const total = quiz.questions?.length || 0;
  const q = quiz.questions?.[idx];

  useEffect(() => {
    if (done && total > 0) saveProgressToDB(itemInfo, score, total - score);
  }, [done]);

  if (!q) return <div className="p-10 text-center">문제가 없습니다.</div>;

  function select(i: number) {
    if (answered) return;
    setSelected(i);
    setAnswered(true);
    if (i === q.answer) setScore((s) => s + 1);
  }

  function next() {
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setShowHint(false);
  }

  if (done) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="flex flex-col h-full">
        <div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 text-center pt-10">
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
            style={{ background: pct >= 70 ? "#e6f4ea" : "#fce8e6", color: pct >= 70 ? "#137333" : "#c5221f" }}>
            {pct}%
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 mb-1">
              {pct >= 80 ? "훌륭해요! 🎉" : pct >= 60 ? "잘하셨어요!" : "조금 더 공부해봐요"}
            </p>
            <p className="text-sm text-gray-500">{total}문제 중 {score}개 정답</p>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => { setIdx(0); setSelected(null); setAnswered(false); setShowHint(false); setDone(false); setScore(0); }}
              className="px-6 py-2.5 rounded-full text-sm font-semibold bg-blue-600 text-white">다시 풀기</button>
            <button onClick={onClose} className="px-6 py-2.5 rounded-full text-sm font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50">학습 종료</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
      <div className="px-6 pt-6 pb-2 shrink-0">
        <span className="text-sm font-bold text-blue-600">Question {idx + 1} / {total}</span>
      </div>
      <div className="px-6 flex-1 pb-10 overflow-y-auto">
        <div className="rounded-2xl p-6 mb-4 bg-white border border-gray-200 shadow-sm">
          <p className="text-lg font-bold text-gray-800 mb-6">{q.question}</p>
          <div className="space-y-3">
            {q.options.map((opt: string, i: number) => {
              let bg = "white", borderColor = "#e0e0e0", color = "#202124";
              if (answered) {
                if (i === q.answer) { bg = "#e6f4ea"; borderColor = "#34a853"; color = "#137333"; }
                else if (i === selected) { bg = "#fce8e6"; borderColor = "#ea4335"; color = "#c5221f"; }
              } else if (selected === i) { bg = "#e8f0fe"; borderColor = "#1a73e8"; color = "#1a73e8"; }
              return (
                <button key={i} onClick={() => select(i)}
                  className="w-full flex items-center gap-4 px-5 py-4 rounded-xl text-[16px] text-left transition-all border"
                  style={{ background: bg, borderColor, color }}>
                  <span className="w-7 h-7 rounded-full border flex items-center justify-center shrink-0 text-sm font-bold" style={{ borderColor }}>
                    {OPTION_ALPHA[i]}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
        {answered && (
          <div className="rounded-xl p-5 text-sm text-gray-700 bg-blue-50 border border-blue-100 mb-4">
            <p className="font-bold text-blue-800 mb-1">해설</p>
            <p className="leading-relaxed text-[15px]">{q.explanation}</p>
          </div>
        )}
        {!answered && (
          <button onClick={() => setShowHint((v) => !v)} className="text-sm text-blue-600 hover:underline mb-4 font-medium px-2">
            {showHint ? "힌트 숨기기" : "힌트 보기"}
          </button>
        )}
        {showHint && !answered && (
          <div className="rounded-xl p-5 text-[15px] text-gray-700 bg-yellow-50 border border-yellow-200 mb-4">💡 {q.hint}</div>
        )}
        {answered && (
          <button onClick={next} className="w-full py-4 mt-2 rounded-xl text-[16px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            {idx + 1 >= total ? "결과 보기" : "다음 문제"}
          </button>
        )}
      </div>
    </div>
  );
}

function StudentFlashcardView({ cards, itemInfo, onClose }: { cards: any[], itemInfo: any, onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [known, setKnown] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);

  const total = cards.length;
  const card = cards[idx];

  useEffect(() => {
    if (done && total > 0) {
      const correct = known.filter(Boolean).length;
      saveProgressToDB(itemInfo, correct, total - correct);
    }
  }, [done]);

  function handleKnow(isKnown: boolean) {
    setKnown((prev) => { const n = [...prev]; n[idx] = isKnown; return n; });
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx((i) => i + 1);
    setFlipped(false);
    setShowHint(false);
  }

  function restart() {
    setIdx(0);
    setFlipped(false);
    setShowHint(false);
    setKnown([]);
    setDone(false);
  }

  if (done) {
    const knownCount = known.filter(Boolean).length;
    const pct = Math.round((knownCount / total) * 100);
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10 px-6 text-center">
        <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
          style={{ background: pct >= 70 ? "#fde0ea" : "#fce8e6", color: pct >= 70 ? "#be123c" : "#c5221f" }}>
          {pct}%
        </div>
        <div className="mt-5">
          <p className="text-xl font-bold text-gray-800 mb-1">
            {pct >= 80 ? "완벽해요! 🎉" : pct >= 60 ? "잘하셨어요!" : "다시 한번 복습해봐요"}
          </p>
          <p className="text-sm text-gray-500">{total}장 중 {knownCount}장 알고 있음</p>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={restart} className="px-6 py-2.5 rounded-full text-sm font-semibold text-white" style={{ background: "#be123c" }}>다시 학습하기</button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-full text-sm font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50">학습 종료</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-6 py-6 max-w-4xl mx-auto w-full">
      <div className="pt-2 pb-6 shrink-0">
        <div className="flex justify-between text-xs text-gray-400 mb-2 font-medium">
          <span>{idx + 1} / {total}</span>
          <span className="text-pink-500">{known.filter(Boolean).length}개 알고 있음</span>
        </div>
        <div className="w-full h-2 rounded-full bg-gray-100">
          <div className="h-2 rounded-full transition-all" style={{ width: `${((idx) / total) * 100}%`, background: "#be123c" }} />
        </div>
        <p className="text-xs text-gray-400 mt-3 text-center">
          클릭하거나 <kbd className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Space</kbd> 키를 눌러 뒤집기
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 pb-10">
        <div
          className="w-full cursor-pointer select-none outline-none"
          style={{ perspective: "1200px" }}
          onClick={() => { setFlipped((v) => !v); setShowHint(false); }}
          onKeyDown={(e) => {
            if (e.key === " ") { e.preventDefault(); setFlipped((v) => !v); }
            if (e.key === "ArrowRight") handleKnow(true);
            if (e.key === "ArrowLeft") handleKnow(false);
          }}
          tabIndex={0}
        >
          <div
            className="relative transition-transform duration-500 w-full"
            style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight: "400px" }}
          >
            <div
              className="absolute inset-0 rounded-[32px] flex flex-col items-center justify-center p-12 text-center shadow-lg border border-gray-200"
              style={{ backfaceVisibility: "hidden", background: "#1e1e2e" }}
            >
              <p className="text-white text-4xl font-bold leading-relaxed">{card?.front}</p>
              {!flipped && <p className="text-gray-400 text-sm mt-10 font-medium">정답 보기</p>}
            </div>
            <div
              className="absolute inset-0 rounded-[32px] flex flex-col items-center justify-center p-12 text-center shadow-lg border-2 border-pink-100"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "white" }}
            >
              <p className="text-gray-800 text-3xl font-bold leading-relaxed">{card?.back}</p>
              {card?.hint && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowHint((v) => !v); }}
                  className="mt-8 text-sm font-semibold text-pink-500 hover:underline flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                  설명 보기
                </button>
              )}
              {showHint && card?.hint && (
                <p className="mt-4 text-[16px] font-medium text-gray-600 bg-pink-50 rounded-2xl px-6 py-4 border border-pink-100">{card.hint}</p>
              )}
            </div>
          </div>
        </div>

        {flipped ? (
          <div className="flex items-center gap-4 w-full">
            <button onClick={() => handleKnow(false)} className="flex-1 py-5 rounded-2xl text-[16px] font-bold border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
              <X className="w-6 h-6" /> 모르겠어요
            </button>
            <button onClick={() => handleKnow(true)} className="flex-1 py-5 rounded-2xl text-[16px] font-bold border-2 border-green-200 text-green-600 hover:bg-green-50 transition-colors flex items-center justify-center gap-2">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              알고 있어요
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-8 w-full justify-center h-[64px]">
            <button onClick={() => { if (idx > 0) { setIdx((i) => i - 1); setFlipped(false); setShowHint(false); } }} disabled={idx === 0}
              className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors"
              style={idx === 0 ? { borderColor: "#e0e0e0", color: "#ccc", cursor: "not-allowed" } : { borderColor: "#f9a8c0", color: "#be123c", background: "white" }}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <p className="text-[15px] font-medium text-gray-400">카드를 클릭해 정답 확인</p>
            <button onClick={() => { if (idx < total - 1) { setIdx((i) => i + 1); setFlipped(false); setShowHint(false); } else { setDone(true); } }}
              className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors"
              style={{ borderColor: "#f9a8c0", color: "#be123c", background: "white" }}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StudentSlideView({ slides, coverImageB64 }: { slides: any[], coverImageB64?: string }) {
  const [idx, setIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const total = slides.length;
  const slide = slides[idx] || { title: "", bullets: [], layout: "content" };

  const SLIDE_THEMES = [
    { bg: "#0f172a", accent: "#60a5fa", sub: "#94a3b8" },
    { bg: "#1e1b4b", accent: "#a78bfa", sub: "#c4b5fd" },
  ];
  const theme = idx === 0 ? SLIDE_THEMES[0] : SLIDE_THEMES[idx % SLIDE_THEMES.length];

  return (
    <div className="flex flex-col h-full bg-[#f1f3f4] overflow-hidden">
      <div className="flex items-center justify-end px-6 py-3 bg-white border-b border-gray-200">
        <button onClick={() => setShowNotes((v) => !v)}
          className="text-sm px-4 py-2 rounded-full border transition-colors font-semibold"
          style={showNotes ? { background: "#fef0da", color: "#d97706", borderColor: "#d97706" } : { color: "#6b7280", borderColor: "#e5e7eb" }}>
          발표자 노트 보기
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-10 py-8 gap-8 overflow-y-auto">
        <div className="w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden shrink-0" style={{ background: theme.bg, aspectRatio: "16/9", position: "relative" }}>
          {slide.layout === "title" ? (
            <div className="absolute inset-0 flex flex-col justify-center px-12 py-10 z-10">
              <p className="text-white text-5xl font-bold leading-tight mb-6">{slide.title}</p>
              {slide.subtitle && <p className="text-2xl" style={{ color: theme.sub }}>{slide.subtitle}</p>}
              <div className="mt-10 h-1 w-20 rounded" style={{ background: theme.accent }} />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col px-12 py-10">
              <div className="flex items-center gap-5 mb-10">
                <div className="w-2 h-10 rounded-full" style={{ background: theme.accent }} />
                <p className="text-3xl font-bold" style={{ color: theme.accent }}>{slide.title}</p>
              </div>
              <ul className="flex flex-col gap-6">
                {slide.bullets?.map((b: string, i: number) => (
                  <li key={i} className="flex items-start gap-5 text-white/90 text-xl">
                    <span className="mt-3 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: theme.accent }} />{b}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="absolute bottom-6 right-8 z-20">
            <span className="text-white/30 text-base font-semibold">{idx + 1} / {total}</span>
          </div>
        </div>

        <div className="flex items-center gap-8 shrink-0">
          <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
            className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors bg-white shadow-sm"
            style={idx === 0 ? { borderColor: "#e0e0e0", color: "#ccc" } : { borderColor: "#fdd89a", color: "#d97706" }}>
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="text-base font-bold text-gray-500 tracking-widest">{idx + 1} / {total}</span>
          <button onClick={() => setIdx((i) => Math.min(i + 1, total - 1))} disabled={idx === total - 1}
            className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors bg-white shadow-sm"
            style={idx === total - 1 ? { borderColor: "#e0e0e0", color: "#ccc" } : { borderColor: "#fdd89a", color: "#d97706" }}>
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        {showNotes && slide.speaker_notes && (
          <div className="w-full max-w-4xl bg-amber-50 border border-amber-200 rounded-2xl px-8 py-6 shrink-0 shadow-sm">
            <p className="text-base font-bold text-amber-700 mb-3">발표자 노트</p>
            <p className="text-[16px] text-gray-800 leading-relaxed">{slide.speaker_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const saveProgressToDB = async (item: any, correct: number, incorrect: number) => {
  try {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return;

    await supabase.from('student_progress').upsert({
      user_id: user.id,
      notebook_id: item.notebook_id,
      item_id: item.id,
      status: 'completed',
      correct_count: correct,
      incorrect_count: incorrect,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id, item_id' });
  } catch (e) {
    console.error('진도 저장 실패:', e);
  }
};

// 메인 뷰어 컴포넌트 (일반 패널용 레이아웃)
export function StudioItemViewer({ item, onClose }: StudioItemViewerProps) {
  if (!item) return null;

  const getTypeConfig = (type: string) => {
    switch (type) {
      case 'quiz': return { icon: FileQuestion, color: 'text-yellow-600', bg: 'bg-yellow-50', label: '퀴즈' };
      case 'memo': return { icon: FileText, color: 'text-gray-600', bg: 'bg-gray-100', label: '메모' };
      case 'summary': return { icon: BookOpen, color: 'text-blue-600', bg: 'bg-blue-50', label: '요약 보고서' };
      case 'audio': return { icon: Mic, color: 'text-purple-600', bg: 'bg-purple-50', label: '오디오 강의' };
      case 'flashcard': return { icon: RefreshCw, color: 'text-pink-500', bg: 'bg-pink-50', label: '플래시카드' };
      case 'slide': return { icon: Presentation, color: 'text-orange-600', bg: 'bg-orange-50', label: '슬라이드' };
      case 'report': return { icon: FileText, color: 'text-green-600', bg: 'bg-green-50', label: '보고서' };
      default: return { icon: FileText, color: 'text-[#155dfc]', bg: 'bg-[#eff6ff]', label: '학습 자료' };
    }
  };

  const config = getTypeConfig(item.type);
  const Icon = config.icon;

  let content = item.content;
  if (typeof content === 'string') {
    try { content = JSON.parse(content); } catch { content = {}; }
  }

  const renderViewer = () => {
    if (item.type === 'quiz' && content.questions) return <StudentQuizView quiz={content} itemInfo={item} onClose={onClose} />;
    if (item.type === 'flashcard' && content.cards) return <StudentFlashcardView cards={content.cards} itemInfo={item} onClose={onClose} />;
    if (item.type === 'slides' && content.slides) return <StudentSlideView slides={content.slides} coverImageB64={content.cover_image_b64} />;
    
    if (content.sections) {
      return (
        <div className="p-10 space-y-8 max-w-4xl mx-auto">
          {content.sections.map((s: any, i: number) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
              <h3 className="text-xl font-bold text-gray-900 mb-6 pb-3 border-b border-green-100 text-green-800">{s.heading}</h3>
              <div className="text-[16px] text-gray-700 leading-loose whitespace-pre-wrap">{s.content}</div>
            </div>
          ))}
        </div>
      );
    }
    if (content.text) return <div className="p-10 max-w-4xl mx-auto text-[16px] text-gray-800 leading-loose whitespace-pre-wrap">{content.text}</div>;
    return <div className="p-10 text-center text-gray-500">열람할 수 있는 내용이 없습니다.</div>;
  };

  return (
    <div className="flex flex-col w-full h-full bg-white overflow-hidden">
      {/* 헤더 영역 */}
      <div className="px-6 py-3 border-b border-[#e7e9ed] flex items-center justify-between bg-white shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.bg}`}>
            <Icon className={`w-5 h-5 ${config.color}`} />
          </div>
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-[#1a1d26] tracking-tight">{item.title}</h2>
            {item.subtitle && <p className="text-xs font-medium text-[#99a1af] mt-0.5">{item.subtitle}</p>}
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="px-4 py-2 hover:bg-red-50 rounded-lg transition-colors shrink-0 flex items-center gap-2 border border-gray-200 hover:border-red-200 group"
        >
          <span className="text-xs font-bold text-gray-600 group-hover:text-red-600 transition-colors">학습 종료</span>
          <X className="w-4 h-4 text-gray-500 group-hover:text-red-500 transition-colors" />
        </button>
      </div>

      {item.audio_path && (
        <div className="px-8 py-5 bg-[#f8f9fb] border-b border-[#e7e9ed] shrink-0">
          <p className="text-[15px] font-bold text-[#1a1d26] mb-3 flex items-center gap-2">
            <Mic className="w-5 h-5 text-[#155dfc]" /> 오디오 강의 재생
          </p>
          <audio controls className="w-full h-12 outline-none rounded-xl shadow-sm bg-white">
            <source src={item.audio_path} type="audio/mpeg" />
          </audio>
        </div>
      )}

      {/* 렌더러 영역 */}
      <div className="flex-1 overflow-y-auto bg-[#fcfcfd]">
        {renderViewer()}
      </div>
    </div>
  );
}