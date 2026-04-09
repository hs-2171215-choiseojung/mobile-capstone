"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

  // 슬라이드 에셋 로드
  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    setError("");
    setSlides([]);
    setActiveSlide(1);

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
      } catch {
        setError("슬라이드 로드 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [docId]);

  // 외부에서 currentSlide 변경 시 동기화 (채팅 클릭)
  useEffect(() => {
    if (currentSlide && currentSlide >= 1 && currentSlide <= total) {
      setActiveSlide(currentSlide);
    }
  }, [currentSlide, total]);

  const goTo = useCallback((n: number) => {
    if (n < 1 || n > total) return;
    setActiveSlide(n);
    onSlideChange?.(n);
  }, [total, onSlideChange]);

  // 키보드 좌/우 화살표
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(activeSlide + 1);
      if (e.key === "ArrowLeft") goTo(activeSlide - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSlide, goTo]);

  const current = slides.find(s => s.slide_number === activeSlide);

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
      {/* 슬라이드 영역 */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
        {/* 이전 버튼 */}
        <button
          onClick={() => goTo(activeSlide - 1)}
          disabled={activeSlide <= 1}
          className="absolute left-2 z-10 p-2 rounded-full bg-white/80 shadow hover:bg-white disabled:opacity-20 transition"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>

        {/* 슬라이드 콘텐츠 */}
        <div className="max-w-full max-h-full flex items-center justify-center">
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
      </div>

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

        {/* 페이지 표시 */}
        <span className="shrink-0 text-[13px] text-gray-500 font-medium whitespace-nowrap">
          {activeSlide} / {total}
        </span>
      </div>
    </div>
  );
}
