"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import StudyULogo from "@/components/StudyULogo";

interface TopNavBarProps {
  title?: string;
  rightSlot?: ReactNode;
}

export function TopNavBar({ title, rightSlot }: TopNavBarProps) {
  const router = useRouter();

  return (
    <header className="absolute top-0 left-0 w-full h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0 shadow-sm z-30">
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={() => {
            router.push("/dashboard/student");
            router.refresh();
          }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
          aria-label="대시보드로 돌아가기"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <StudyULogo size={28} />
        <span className="text-gray-300 text-lg">|</span>
        <span className="text-blue-500 font-semibold truncate max-w-[240px]" style={{ fontSize: "0.9rem" }}>
          {title || "노트북 제목 불러오는 중..."}
        </span>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-600">학생</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {rightSlot}
      </div>
    </header>
  );
}
