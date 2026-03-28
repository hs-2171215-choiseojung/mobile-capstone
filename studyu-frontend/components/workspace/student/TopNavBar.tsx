"use client";

import { Bell, Settings, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface TopNavBarProps {
  title?: string;
}

export function TopNavBar({ title }: TopNavBarProps) {
  const router = useRouter();

  return (
    <div className="absolute backdrop-blur-[12px] bg-white/90 flex items-center justify-between left-0 px-6 py-3 shadow-sm top-0 w-full z-30 border-b border-gray-200">
      <div className="flex items-center gap-4">
        {/* 뒤로 가기 버튼 */}
        <button 
          onClick={() => router.push('/dashboard/student')}
          className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
          title="대시보드로 돌아가기"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
        </div>
        <div className="h-5 w-px bg-gray-300" />
        <div className="flex flex-col">
          <p className="text-lg font-semibold text-gray-800">
            {title || "노트북 제목 불러오는 중..."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors relative">
          <Bell className="w-5 h-5 text-gray-700" />
          <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </button>
        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <Settings className="w-5 h-5 text-gray-700" />
        </button>
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 border border-blue-200 cursor-pointer">
          ST
        </div>
      </div>
    </div>
  );
}