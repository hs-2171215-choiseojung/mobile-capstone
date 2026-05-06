"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Play, Pause, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import MarkdownPreview from "@/components/workspace/MarkdownPreview";

const VOICES = [
  { key: "sarah",  label: "Sarah",  desc: "차분한 여성" },
  { key: "rachel", label: "Rachel", desc: "명확한 여성" },
  { key: "josh",   label: "Josh",   desc: "친근한 남성" },
  { key: "adam",   label: "Adam",   desc: "전문적인 남성" },
] as const;
type VoiceKey = typeof VOICES[number]["key"];
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Slide {
  slide_number: number;
  image_url: string;
  video_url: string;
}

interface PptSlideViewerProps {
  docId: string;
  currentSlide?: number | null;
  onSlideChange?: (slideNum: number) => void;
}

export function PptSlideViewer({ docId, currentSlide, onSlideChange }: PptSlideViewerProps) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [total, setTotal] = useState(0);
  const [activeSlide, setActiveSlide] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imgError, setImgError] = useState<Record<number, boolean>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 줌/패닝 상태
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [editingSlide, setEditingSlide] = useState(false);
  const [slideInput, setSlideInput] = useState("");
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 슬라이드 설명 패널
  const [slideDescriptions, setSlideDescriptions] = useState<Record<number, string>>({});
  const [descOpen, setDescOpen] = useState(true);
  const [descLoading, setDescLoading] = useState(false);

  // 설명재생
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceKey>("sarah");
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(() =>
    typeof window !== "undefined"
      ? parseFloat(localStorage.getItem("studyu_playback_rate") || "1")
      : 1
  );
  const playbackRateRef = useRef<number>(
    typeof window !== "undefined"
      ? parseFloat(localStorage.getItem("studyu_playback_rate") || "1")
      : 1
  );
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayRef = useRef(false);
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);

  // 슬라이드 바뀌면 줌/패닝 리셋
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeSlide]);

  // 슬라이드 에셋 로드
  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    setError("");
    setSlides([]);
    setActiveSlide(1);
    setSlideDescriptions({});

    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) { setError("로그인이 필요합니다."); return; }

        const res = await fetch(`${API}/api/documents/${docId}/slides`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.detail || "슬라이드를 불러올 수 없습니다.");
          return;
        }
        const data2 = await res.json();
        setSlides(data2.slides ?? []);
        setTotal(data2.total ?? 0);
        setActiveSlide(1);
        onSlideChange?.(1);
        setLoading(false); // 뷰어 즉시 표시

        // 슬라이드 설명은 백그라운드에서 별도 로드
        setDescLoading(true);
        fetch(`${API}/api/documents/${docId}/slide-descriptions`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setSlideDescriptions(d.descriptions ?? {}); })
          .catch(() => {})
          .finally(() => setDescLoading(false));
      } catch {
        setError("슬라이드 로드 중 오류가 발생했습니다.");
        setLoading(false);
      }
    })();
  }, [docId]);

  // 외부에서 currentSlide 변경 시 동기화 (채팅 클릭)
  useEffect(() => {
    if (currentSlide && currentSlide >= 1 && currentSlide <= total) {
      setActiveSlide(currentSlide);
      onSlideChange?.(currentSlide);
    }
  }, [currentSlide, total]);

  const goTo = useCallback((n: number) => {
    if (n < 1 || n > total) return;
    setActiveSlide(n);
    onSlideChange?.(n);
  }, [total, onSlideChange]);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!voiceDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node))
        setVoiceDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [voiceDropdownOpen]);

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    playbackRateRef.current = rate;
    localStorage.setItem("studyu_playback_rate", String(rate));
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  // 키보드 좌/우 화살표
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(activeSlide + 1);
      if (e.key === "ArrowLeft") goTo(activeSlide - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSlide, goTo]);

  // 자동재생 — 클릭 동기 컨텍스트에서 audio 요소를 활성화한 뒤 src 교체
  const playSlideAudio = useCallback(async (slideNum: number) => {
    if (!autoPlayRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;

    setAudioLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || !autoPlayRef.current) { setAutoPlaying(false); autoPlayRef.current = false; return; }

      const res = await fetch(`${API}/api/documents/${docId}/slides/${slideNum}/audio?voice=${selectedVoice}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || !autoPlayRef.current) { setAudioLoading(false); setAutoPlaying(false); autoPlayRef.current = false; return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (!autoPlayRef.current) { URL.revokeObjectURL(url); return; }

      audio.pause();
      audio.src = url;
      audio.playbackRate = playbackRateRef.current;
      audio.load();
      setAudioLoading(false);
      await audio.play();

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (!autoPlayRef.current) return;
        if (slideNum < total) {
          goTo(slideNum + 1);
          playSlideAudio(slideNum + 1);
        } else {
          setAutoPlaying(false);
          autoPlayRef.current = false;
        }
      };
    } catch {
      setAudioLoading(false);
      setAutoPlaying(false);
      autoPlayRef.current = false;
    }
  }, [docId, total, goTo, selectedVoice]);

  const startAutoPlay = useCallback(() => {
    if (!audioRef.current) return;
    autoPlayRef.current = true;
    setAutoPlaying(true);
    audioRef.current.play().catch(() => {}); // 브라우저 자동재생 잠금 해제
    playSlideAudio(activeSlide);
  }, [activeSlide, playSlideAudio]);

  const pauseAutoPlay = useCallback(() => {
    autoPlayRef.current = false;
    setAutoPlaying(false);
    setAudioLoading(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    nextAudioRef.current = null;
  }, []);

  // 문서 바뀌면 자동재생 초기화
  useEffect(() => {
    autoPlayRef.current = false;
    setAutoPlaying(false);
    setAudioLoading(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    nextAudioRef.current = null;
  }, [docId]);

  const current = slides.find(s => s.slide_number === activeSlide);


  // [슬라이드 N] 패턴을 클릭 가능한 링크로 렌더링
  function renderWithSlideLinks(text: string) {
    const normalized = text.replace(/슬라이드\s*(\d+)/g, (match, n, offset, str) => {
      if (offset > 0 && str[offset - 1] === "[") return match;
      return `[슬라이드 ${n}]`;
    });
    const parts = normalized.split(/(\[슬라이드\s*\d+\])/g);
    return parts.map((part, i) => {
      const m = part.match(/^\[슬라이드\s*(\d+)\]$/);
      if (m) {
        const n = parseInt(m[1], 10);
        return (
          <button
            key={i}
            onClick={() => goTo(n)}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#155dfc] hover:bg-blue-100 transition-colors"
          >
            슬라이드 {n}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">슬라이드 불러오는 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm text-center px-6">
        {error}
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="h-full flex flex-col bg-[#f0f2f5] select-none">
      {/* 자동재생용 숨겨진 오디오 요소 */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} className="hidden" />

      {/* 슬라이드 영역 */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 flex items-center justify-center p-4 relative overflow-hidden"
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          setZoom(prev => Math.min(5, Math.max(1, prev + delta)));
          if (zoom + delta <= 1) setPan({ x: 0, y: 0 });
        }}
        onMouseDown={(e) => {
          if (zoom <= 1) return;
          isPanning.current = true;
          panStart.current = { x: e.clientX, y: e.clientY };
          panOrigin.current = { ...pan };
        }}
        onMouseMove={(e) => {
          if (!isPanning.current) return;
          setPan({
            x: panOrigin.current.x + (e.clientX - panStart.current.x),
            y: panOrigin.current.y + (e.clientY - panStart.current.y),
          });
        }}
        onMouseUp={() => { isPanning.current = false; }}
        onMouseLeave={() => { isPanning.current = false; }}
        style={{ cursor: zoom > 1 ? "grab" : "default" }}
      >
        {/* 이전 버튼 */}
        <button
          onClick={() => goTo(activeSlide - 1)}
          disabled={activeSlide <= 1}
          className="absolute left-2 z-10 p-2 rounded-full bg-white/80 shadow hover:bg-white disabled:opacity-20 transition"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>

        {/* 슬라이드 콘텐츠 */}
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: "center center",
            transition: isPanning.current ? "none" : "transform 0.1s ease",
          }}
        >
          {current.video_url ? (
            <video
              ref={videoRef}
              key={current.video_url}
              src={current.video_url}
              controls
              className="max-w-full max-h-full rounded-lg shadow-lg bg-black"
              style={{ maxHeight: "calc(100% - 8px)" }}
            />
          ) : imgError[activeSlide] ? (
            <div className="flex items-center justify-center w-full h-64 bg-white rounded-lg shadow text-gray-400 text-sm">
              슬라이드 {activeSlide} 이미지를 불러올 수 없습니다.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.image_url}
              src={current.image_url}
              alt={`슬라이드 ${activeSlide}`}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg bg-white"
              style={{ maxHeight: "calc(100% - 8px)" }}
              onError={() => setImgError(prev => ({ ...prev, [activeSlide]: true }))}
              draggable={false}
            />
          )}
        </div>

        {/* 다음 버튼 */}
        <button
          onClick={() => goTo(activeSlide + 1)}
          disabled={activeSlide >= total}
          className="absolute right-2 z-10 p-2 rounded-full bg-white/80 shadow hover:bg-white disabled:opacity-20 transition"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>

        {/* 줌 레벨 표시 (1배 초과일 때만) */}
        {zoom > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[11px] px-2 py-0.5 rounded-full pointer-events-none">
            {Math.round(zoom * 100)}%
          </div>
        )}
      </div>

      {/* 슬라이드 설명 패널 */}
      {(descLoading || slideDescriptions[activeSlide]) && (
        <div className="shrink-0 bg-white border-t border-gray-200">
          <button
            onClick={() => setDescOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span>슬라이드 {activeSlide} 설명</span>
            {descOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {descOpen && (
            <div className="px-4 pb-3 text-[13px] text-gray-700 leading-relaxed max-h-40 overflow-y-auto">
              {descLoading ? (
                <span className="flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  슬라이드 설명을 생성하는 중입니다...
                </span>
              ) : (
                <MarkdownPreview
                  content={slideDescriptions[activeSlide] ?? ""}
                  className="text-[#374151]"
                  transformText={(text) => renderWithSlideLinks(text)}
                />
              )}
            </div>
          )}
        </div>
      )}


      {/* 하단 컨트롤 */}
      <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
        {/* 슬라이드 썸네일 스크롤 */}
        <div className="flex gap-1.5 overflow-x-auto py-1 flex-1 min-w-0">
          {slides.map(s => (
            <button
              key={s.slide_number}
              onClick={() => goTo(s.slide_number)}
              className={`shrink-0 relative rounded border-2 transition-all ${
                s.slide_number === activeSlide
                  ? "border-[#155dfc] shadow-md"
                  : "border-transparent hover:border-gray-300"
              }`}
              style={{ width: 56, height: 36 }}
              title={`슬라이드 ${s.slide_number}`}
            >
              {s.video_url ? (
                <div className="w-full h-full bg-gray-800 rounded flex items-center justify-center text-white text-[9px]">
                  ▶
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.image_url}
                  alt={`슬라이드 ${s.slide_number}`}
                  className="w-full h-full object-cover rounded"
                />
              )}
              <span className="absolute bottom-0 right-0 bg-black/50 text-white text-[8px] px-0.5 rounded-tl leading-tight">
                {s.slide_number}
              </span>
            </button>
          ))}
        </div>

        {/* 자동재생 버튼 */}
        <div className="shrink-0 flex items-center gap-1">
          <button
            onClick={autoPlaying ? pauseAutoPlay : startAutoPlay}
            disabled={descLoading || Object.keys(slideDescriptions).length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[12px] font-medium bg-[#155dfc] text-white hover:bg-[#1249c9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={autoPlaying ? "일시정지" : "설명재생"}
          >
            {audioLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : autoPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{autoPlaying ? "일시정지" : "설명재생"}</span>
          </button>
          {autoPlaying && (
            <button
              onClick={pauseAutoPlay}
              className="p-1 rounded text-gray-500 hover:bg-gray-100 transition-colors"
              title="정지"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          {/* 재생 중 속도 버튼 */}
          {autoPlaying && SPEED_OPTIONS.map(rate => (
            <button
              key={rate}
              onClick={() => changeSpeed(rate)}
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                playbackRate === rate
                  ? "bg-[#155dfc] text-white"
                  : "bg-[#f0f2f5] text-[#99a1af] hover:bg-[#e7e9ed] hover:text-[#414751]"
              }`}
            >
              {rate}x
            </button>
          ))}
          {/* 목소리 드롭다운 */}
          <div className="relative" ref={voiceDropdownRef}>
            <button
              onClick={() => setVoiceDropdownOpen(o => !o)}
              className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-[#155dfc] text-[11px] font-medium rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
              title="목소리 선택"
            >
              <span>{VOICES.find(v => v.key === selectedVoice)?.label}</span>
              <svg className={`w-2.5 h-2.5 transition-transform duration-150 ${voiceDropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {voiceDropdownOpen && (
              <div className="absolute right-0 bottom-full mb-1.5 w-44 bg-white rounded-xl border border-[#e7e9ed] shadow-lg z-50 overflow-hidden">
                {VOICES.map(v => (
                  <button
                    key={v.key}
                    onClick={() => { setSelectedVoice(v.key); setVoiceDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#f8f9fb] ${selectedVoice === v.key ? "bg-blue-50" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] font-medium ${selectedVoice === v.key ? "text-[#155dfc]" : "text-[#1a1d26]"}`}>{v.label}</div>
                      <div className="text-[10px] text-[#99a1af]">{v.desc}</div>
                    </div>
                    {selectedVoice === v.key && (
                      <svg className="w-3 h-3 text-[#155dfc] shrink-0" viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 페이지 표시 — 클릭하면 직접 입력 */}
        {editingSlide ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={total}
            value={slideInput}
            onChange={e => setSlideInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                const n = parseInt(slideInput, 10);
                if (!isNaN(n)) goTo(n);
                setEditingSlide(false);
              }
              if (e.key === "Escape") setEditingSlide(false);
            }}
            onBlur={() => {
              const n = parseInt(slideInput, 10);
              if (!isNaN(n)) goTo(n);
              setEditingSlide(false);
            }}
            className="shrink-0 w-16 text-center text-[13px] font-medium border border-[#155dfc] rounded px-1 py-0.5 outline-none"
          />
        ) : (
          <button
            onClick={() => { setSlideInput(String(activeSlide)); setEditingSlide(true); }}
            className="shrink-0 text-[13px] text-gray-500 font-medium whitespace-nowrap hover:text-[#155dfc] hover:underline transition-colors"
            title="클릭해서 슬라이드 번호 입력"
          >
            {activeSlide} / {total}
          </button>
        )}
      </div>
    </div>
  );
}
