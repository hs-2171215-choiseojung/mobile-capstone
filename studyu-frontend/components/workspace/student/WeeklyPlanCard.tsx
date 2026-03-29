"use client";

import { useMemo, useState } from 'react';
import { FileText, ChevronUp, ChevronDown, FileQuestion, Mic, Layout, PenTool } from 'lucide-react';

interface WeeklyPlanCardProps {
  weekNumber: number;
  weekTitle?: string;
  instruct?: string;
  items?: any[];
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  onOpenItem?: (item: any) => void;
  onOpenDoc?: (doc: any) => void;
}

export function WeeklyPlanCard({
  weekNumber,
  weekTitle,
  instruct,
  items = [],
  isExpanded: controlledExpanded,
  onToggleExpanded,
  onOpenItem,
  onOpenDoc,
}: WeeklyPlanCardProps) {
  const toText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "title" in (value as Record<string, unknown>)) {
      return toText((value as Record<string, unknown>).title, fallback);
    }
    return fallback;
  };

  const [internalExpanded, setInternalExpanded] = useState(weekNumber === 1);
  const isControlled = typeof controlledExpanded === "boolean";
  const isExpanded = useMemo(
    () => (isControlled ? Boolean(controlledExpanded) : internalExpanded),
    [isControlled, controlledExpanded, internalExpanded]
  );

  const toggleExpanded = () => {
    if (onToggleExpanded) {
      onToggleExpanded();
      return;
    }
    setInternalExpanded((prev) => !prev);
  };

  const getIconAndColor = (type: string) => {
    switch (type) {
      case 'quiz': return { icon: <FileQuestion className="w-6 h-6 text-yellow-600" />, bg: 'bg-[#FFFBEC]' };
      case 'memo': return { icon: <PenTool className="w-6 h-6 text-gray-500" />, bg: 'bg-[#F1F3F5]' };
      case 'summary': return { icon: <FileText className="w-6 h-6 text-blue-600" />, bg: 'bg-[#EEF6FF]' };
      case 'audio': return { icon: <Mic className="w-6 h-6 text-purple-600" />, bg: 'bg-[#F3F0FF]' };
      case 'slides': return { icon: <Layout className="w-6 h-6 text-orange-600" />, bg: 'bg-[#FFF4E6]' };
      case 'report': return { icon: <FileText className="w-6 h-6 text-green-600" />, bg: 'bg-[#EBFBEE]' };
      default: return { icon: <FileText className="w-6 h-6 text-[#155dfc]" />, bg: 'bg-[#eff6ff]' };
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <button
        onClick={toggleExpanded}
        className="flex items-center justify-between pb-3 border-b border-gray-200 hover:bg-gray-50 transition-colors w-full text-left"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronUp className="w-5 h-5 text-gray-500" />}
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">{toText(weekTitle, `Week ${weekNumber}`)}</h2>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className="text-xs text-gray-500">{items.length}개 항목</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3">
          {instruct && (
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs font-semibold text-blue-700 mb-1">Instructor Guide</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap leading-relaxed">{toText(instruct)}</p>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
              해당 주차에 학습 자료가 없습니다.
            </p>
          ) : (
            items.map((item) => {
              const isSource = 'file_type' in item || 'filename' in item || 'byte_size' in item;
              const { icon, bg } = getIconAndColor(item.type);
              const title = isSource
                ? toText(item.filename || item.name, "Source")
                : toText(item.title, "Studio Item");

              return (
                <div
                  key={item.id}
                  className={`flex items-center p-4 bg-white border border-gray-200 rounded-xl transition-shadow ${
                    isSource || onOpenItem ? "cursor-pointer hover:shadow-md" : ""
                  }`}
                  onClick={() => {
                    if (isSource) {
                      if (onOpenDoc && (item.sourceDocId || item.id)) onOpenDoc(item);
                      return;
                    }
                    if (onOpenItem) onOpenItem(item);
                  }}
                >
                  <div className={`w-10 h-10 flex items-center justify-center rounded-lg mr-4 shrink-0 ${bg}`}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-gray-900 truncate">{title}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">{isSource ? 'Source document' : 'Assigned by instructor'}</p>
                  </div>
                  {!isSource && (
                    <button className="px-4 py-1.5 text-xs font-semibold text-white bg-[#155dfc] hover:bg-[#0d4ac4] rounded-lg transition-colors shrink-0">
                      시작하기
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
