"use client";

import { useState } from 'react';
import { FileText, ChevronUp, ChevronDown, Video, Image as ImageIcon, FileQuestion, Book, Mic, Map, Layout, PenTool, Database } from 'lucide-react';

interface WeeklyPlanCardProps {
  weekNumber: number;
  items?: any[];
  onOpenItem?: (item: any) => void;
}

export function WeeklyPlanCard({ weekNumber, items = [], onOpenItem }: WeeklyPlanCardProps) {
  const [isExpanded, setIsExpanded] = useState(weekNumber === 1); 

  const getIconAndColor = (type: string) => {
    switch (type) {
      case 'quiz': return { icon: <FileQuestion className="w-6 h-6 text-yellow-600" />, bg: 'bg-[#FFFBEC]' }; // 퀴즈 (노랑)
      case 'memo': return { icon: <PenTool className="w-6 h-6 text-gray-500" />, bg: 'bg-[#F1F3F5]' }; // 메모 (회색)
      case 'summary': return { icon: <FileText className="w-6 h-6 text-blue-600" />, bg: 'bg-[#EEF6FF]' }; // 요약 (파랑)
      case 'audio': return { icon: <Mic className="w-6 h-6 text-purple-600" />, bg: 'bg-[#F3F0FF]' }; // 오디오 (보라)
      case 'slides': return { icon: <Layout className="w-6 h-6 text-orange-600" />, bg: 'bg-[#FFF4E6]' }; // 슬라이드 (주황)
      case 'report': return { icon: <FileText className="w-6 h-6 text-green-600" />, bg: 'bg-[#EBFBEE]' }; // 보고서 (초록)
      default: return { icon: <FileText className="w-6 h-6 text-[#155dfc]" />, bg: 'bg-[#eff6ff]' }; 
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between pb-3 border-b border-gray-200 hover:bg-gray-50 transition-colors w-full text-left"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronUp className="w-5 h-5 text-gray-500" />}
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">
            Week {weekNumber}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className="text-xs text-gray-500">{items.length}개 항목</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
              할당된 학습 자료가 없습니다.
            </p>
          ) : (
            items.map((item) => {
              const { icon, bg } = getIconAndColor(item.type);
              return (
                <div 
                  key={item.id} 
                  className="flex items-center p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => onOpenItem && onOpenItem(item)}
                >
                  <div className={`w-10 h-10 flex items-center justify-center rounded-lg mr-4 shrink-0 ${bg}`}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-gray-900 truncate">{item.title}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">Assigned by instructor</p>
                  </div>
                  <button className="px-4 py-1.5 text-xs font-semibold text-white bg-[#155dfc] hover:bg-[#0d4ac4] rounded-lg transition-colors shrink-0">
                    시작하기
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}