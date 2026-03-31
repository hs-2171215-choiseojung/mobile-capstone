"use client";

import { FileText, Link as LinkIcon, Image as ImageIcon, Video, Presentation } from 'lucide-react';

interface DocumentInfo {
  id: string;
  filename: string;
  file_type: string;
  byte_size?: number;
  storage_path?: string;
  created_at?: string;
}

interface StudentSourcePanelProps {
  sources?: DocumentInfo[];
  onOpenSource?: (source: DocumentInfo) => void;
}

export function StudentSourcePanel({ sources = [], onOpenSource }: StudentSourcePanelProps) {
  
  const getIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType === 'url' || lowerType === 'link') return <LinkIcon size={12} className="text-indigo-500" />;
    if (lowerType === 'image') return <ImageIcon size={12} className="text-green-500" />;
    if (lowerType === 'video') return <Video size={12} className="text-red-500" />;
    if (lowerType === 'ppt' || lowerType === 'pptx') return <Presentation size={12} className="text-orange-500" />;
    if (lowerType === 'docx' || lowerType === 'hwp') return <FileText size={12} className="text-blue-500" />;
    return <FileText size={12} className="text-blue-500" />;
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div 
        className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 overflow-hidden" 
        style={{ minHeight: 44 }}
      >
        <span className="text-gray-800 whitespace-nowrap uppercase tracking-wider" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
          SOURCES
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {sources.map((source) => (
          <div 
            key={source.id} 
            onClick={() => onOpenSource?.(source)}
            className="flex items-center gap-2.5 px-4 py-2 hover:bg-gray-50 transition-colors cursor-pointer group"
          >
            <div 
              className="w-6 h-6 rounded flex items-center justify-center shrink-0" 
              style={{ background: "#EFF6FF" }}
            >
              {getIcon(source.file_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                {source.filename}
              </p>
              <p className="text-gray-400 truncate" style={{ fontSize: "0.65rem", marginTop: "1px" }}>
                {source.file_type === 'url' ? 'Link' : source.file_type.toUpperCase()}
              </p>
            </div>
          </div>
        ))}

        {sources.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-400" style={{ fontSize: "0.75rem" }}>등록된 소스가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
