"use client";

import { useState, useRef } from 'react';

interface InfographicSection {
  title: string;
  icon: string;
  color: string;
  stat?: string;
  stat_label?: string;
  points: string[];
}

interface InfographicViewProps {
  data: {
    title: string;
    description?: string;
    sections: InfographicSection[];
  };
  onBack?: () => void;
}

function toGradient(hex: string): string {
  return `linear-gradient(135deg, ${hex}ee, ${hex}99)`;
}

export function InfographicView({ data, onBack }: InfographicViewProps) {
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const exportAsPng = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#f9fafb',
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
      });
      const link = document.createElement('a');
      link.download = `${data.title.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('PNG 내보내기 실패:', e);
      alert(`PNG 저장 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 헤더 */}
      <div className="px-6 py-6 border-b border-gray-200 shrink-0 bg-white flex items-start justify-between">
        <div className="flex-1">
          {onBack && (
            <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1 mb-3">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              스튜디오
            </button>
          )}
          <h2 className="text-2xl font-bold text-gray-900">{data.title}</h2>
          {data.description && (
            <p className="text-sm text-gray-600 mt-2">{data.description}</p>
          )}
        </div>
        {/* PNG 내보내기 버튼 */}
        <button
          onClick={exportAsPng}
          disabled={exporting}
          className="ml-4 mt-1 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" opacity="0.25" />
                <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="text-xs text-gray-500">저장 중...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>PNG 저장</span>
            </>
          )}
        </button>
      </div>

      {/* 섹션 그리드 */}
      <div className="flex-1 overflow-auto">
        <div ref={exportRef} className="p-6 bg-gray-50">
          <div className="mb-6 bg-white px-4 py-3 rounded-lg">
            <h2 className="text-2xl font-bold text-gray-900">{data.title}</h2>
            {data.description && (
              <p className="text-sm text-gray-600 mt-2">{data.description}</p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.sections.map((section, idx) => (
              <div key={idx} className="rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow bg-white">
                {/* 색상 헤더 */}
                <div
                  style={{ backgroundImage: toGradient(section.color), minHeight: '160px' }}
                  className="px-6 text-white flex flex-col items-center justify-center"
                >
                  <div className="text-5xl mb-3">{section.icon}</div>
                  {section.stat && (
                    <div className="text-center">
                      <div className="text-5xl font-black tracking-tight drop-shadow-md">{section.stat}</div>
                      {section.stat_label && (
                        <div className="text-sm mt-2 opacity-80 font-medium">{section.stat_label}</div>
                      )}
                    </div>
                  )}
                </div>
                {/* 콘텐츠 */}
                <div className="px-6 py-5">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{section.title}</h3>
                  <ul className="space-y-2">
                    {section.points.map((point, pidx) => (
                      <li key={pidx} className="text-sm text-gray-700 flex gap-2">
                        <span className="text-gray-400 font-semibold">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
