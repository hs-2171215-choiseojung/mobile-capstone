"use client";

import { useState } from 'react';
import { Plus, X, FileText, Video, Image as ImageIcon, FileQuestion, Book, Mic, Map, Layout, PenTool, Database, ChevronDown, Link as LinkIcon, Presentation, Loader2, ChevronLeft, Sparkles } from 'lucide-react';

const STUDIO_CREATION_OPTIONS = [
  { id: 'audio', label: 'AI 오디오 오버뷰', icon: Mic, color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 'slide', label: '슬라이드 자료', icon: Layout, color: 'text-orange-500', bg: 'bg-orange-50' },
  { id: 'mindmap', label: '마인드맵', icon: Map, color: 'text-green-500', bg: 'bg-green-50' },
  { id: 'quiz', label: '퀴즈', icon: FileQuestion, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'report', label: '보고서', icon: FileText, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { id: 'flashcard', label: '플래시카드', icon: Book, color: 'text-pink-500', bg: 'bg-pink-50' },
  { id: 'infographic', label: '인포그래픽', icon: ImageIcon, color: 'text-teal-500', bg: 'bg-teal-50' },
  { id: 'data', label: '데이터표', icon: Database, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { id: 'video', label: '동영상', icon: Video, color: 'text-red-500', bg: 'bg-red-50' },
  { id: 'notepad', label: '메모장', icon: PenTool, color: 'text-gray-600', bg: 'bg-gray-100' },
];

interface StudioItemData {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  created_at: string;
}

interface Props {
  studioItems?: StudioItemData[];
  docs?: any[];
  notebookId?: string;
  onRefresh?: () => void;
  onOpenItem?: (item: any) => void;
}

export function StudentStudioPanel({ studioItems = [], docs = [], notebookId, onRefresh, onOpenItem }: Props) {
  const [activeTab, setActiveTab] = useState<'week' | 'type'>('week');
  const [collapsedWeeks, setCollapsedWeeks] = useState<number[]>([]);
  const [collapsedTypes, setCollapsedTypes] = useState<string[]>([]);
  
  // 모달 및 2단계 설정 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [configStep, setConfigStep] = useState<'select' | 'config'>('select');
  const [selectedConfig, setSelectedConfig] = useState<any>(null);
  
  // 상세 옵션 상태
  const [optDifficulty, setOptDifficulty] = useState('intermediate');
  const [optAmount, setOptAmount] = useState('standard');
  const [optLanguage, setOptLanguage] = useState('ko');

  const [isGenerating, setIsGenerating] = useState<string | null>(null);

  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => {
      setConfigStep('select');
      setSelectedConfig(null);
    }, 200);
  };

  const handleCreateStudio = async () => {
    if (!selectedConfig) return;
    
    if (!docs || docs.length === 0) {
      alert("학습할 소스(문서)가 없습니다. 강사님이 자료를 업로드해야 합니다.");
      return;
    }
    
    setIsGenerating(selectedConfig.id); 

    setTimeout(() => {
      setIsGenerating(null); // 로딩 종료
      alert(`[${selectedConfig.label}] 생성이 완료되었습니다\n적용된 옵션 - 난이도: ${optDifficulty}, 분량: ${optAmount}, 언어: ${optLanguage}`);
      closeModal(); 
      // if (onRefresh) onRefresh(); 
    }, 2000);
  };
  
  const getMappedOption = (rawType: string) => {
    const typeMap: Record<string, string> = {
      'memo': 'notepad',
      'summary': 'report',
      'plan': 'mindmap',
    };
    const mappedId = typeMap[rawType] || rawType;
    return STUDIO_CREATION_OPTIONS.find(opt => opt.id === mappedId) || 
           { id: rawType, label: '학습 자료', icon: FileText, color: 'text-gray-500', bg: 'bg-gray-50' };
  };

  const getSourceIcon = (type?: string) => {
    if (!type) return <FileText size={11} className="text-blue-500" />;
    const lowerType = type.toLowerCase();
    if (lowerType === 'url' || lowerType === 'link') return <LinkIcon size={11} className="text-indigo-500" />;
    if (lowerType === 'image') return <ImageIcon size={11} className="text-green-500" />;
    if (lowerType === 'video') return <Video size={11} className="text-red-500" />;
    if (lowerType === 'ppt' || lowerType === 'pptx') return <Presentation size={11} className="text-orange-500" />;
    return <FileText size={11} className="text-blue-500" />;
  };

  const toggleWeekCollapse = (weekNum: number) => {
    setCollapsedWeeks(prev => prev.includes(weekNum) ? prev.filter(w => w !== weekNum) : [...prev, weekNum]);
  };

  const toggleTypeCollapse = (typeId: string) => {
    setCollapsedTypes(prev => prev.includes(typeId) ? prev.filter(t => t !== typeId) : [...prev, typeId]);
  };

  const groupedByType = studioItems.reduce((acc, item) => {
    const option = getMappedOption(item.type);
    if (!acc[option.id]) {
      acc[option.id] = { option, items: [] };
    }
    acc[option.id].items.push(item);
    return acc;
  }, {} as Record<string, { option: any; items: StudioItemData[] }>);

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 overflow-hidden" style={{ minHeight: 44 }}>
        <span className="text-gray-800 whitespace-nowrap" style={{ fontSize: "0.92rem", fontWeight: 700 }}>
          스튜디오
        </span>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-blue-100 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors shrink-0"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('week')} className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${activeTab === 'week' ? 'bg-blue-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`} style={{ fontSize: "0.75rem", fontWeight: 600 }}>주차별</button>
          <button onClick={() => setActiveTab('type')} className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${activeTab === 'type' ? 'bg-blue-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`} style={{ fontSize: "0.75rem", fontWeight: 600 }}>종류별</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {activeTab === 'week' ? (
          <div className="flex flex-col pb-4">
            {[1, 2, 3].map((weekNum) => {
              const isCollapsed = collapsedWeeks.includes(weekNum);
              const weekDocs = weekNum === 1 ? docs : [];
              const weekStudio = weekNum === 1 ? studioItems : [];
              const allItems = [...weekDocs, ...weekStudio];

              return (
                <div key={weekNum} className="border-b border-gray-100 last:border-0 relative">
                  <div className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleWeekCollapse(weekNum)}>
                    <div className="text-gray-400 transition-transform shrink-0" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}><ChevronDown size={13} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>Week {weekNum}</p>
                      <p className="text-gray-400" style={{ fontSize: "0.63rem" }}>{allItems.length}개</p>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="pb-1">
                      {allItems.length === 0 ? (
                        <div className="px-4 py-2"><p className="text-gray-300" style={{ fontSize: "0.7rem" }}>항목 없음</p></div>
                      ) : (
                        allItems.map((item, i) => {
                          const isSource = 'file_type' in item || 'byte_size' in item;
                          let iconNode, titleStr, typeLabel;

                          if (isSource) {
                            iconNode = getSourceIcon(item.file_type);
                            titleStr = item.filename || item.name || `Source ${i + 1}`;
                            typeLabel = "소스";
                          } else {
                            const option = getMappedOption(item.type);
                            const Icon = option.icon;
                            iconNode = <Icon size={11} className="text-blue-500" />;
                            titleStr = item.title || `Studio Item ${i + 1}`;
                            typeLabel = option.label;
                          }

                          return (
                            <div key={item.id || i} onClick={() => !isSource && onOpenItem && onOpenItem(item)} className={`flex items-center gap-2 px-4 py-1.5 transition-colors group ${isSource ? 'cursor-default opacity-80' : 'cursor-pointer hover:bg-gray-50'}`}>
                              <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "#EFF6FF" }}>{iconNode}</div>
                              <div className="flex-1 min-w-0 flex items-center justify-between">
                                <p className={`truncate transition-colors ${isSource ? 'text-gray-600' : 'text-gray-700 group-hover:text-blue-600'}`} style={{ fontSize: "0.72rem", fontWeight: 500 }}>{titleStr}</p>
                                <span className="text-gray-400 shrink-0 ml-2" style={{ fontSize: "0.6rem" }}>{typeLabel}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col pb-4">
            {studioItems.length === 0 ? (
              <p className="text-gray-400 text-center py-8" style={{ fontSize: "0.75rem" }}>생성된 스튜디오 자료가 없습니다.</p>
            ) : (
              Object.values(groupedByType).map(({ option, items }) => {
                const isCollapsed = collapsedTypes.includes(option.id);
                const Icon = option.icon;

                return (
                  <div key={option.id} className="border-b border-gray-100 last:border-0 relative">
                    <div className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleTypeCollapse(option.id)}>
                      <div className="text-gray-400 transition-transform shrink-0" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}><ChevronDown size={13} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 truncate" style={{ fontSize: "0.78rem", fontWeight: 600 }}>{option.label}</p>
                        <p className="text-gray-400" style={{ fontSize: "0.63rem" }}>{items.length}개</p>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="pb-1">
                        {items.map((item) => (
                          <div key={item.id} onClick={() => onOpenItem && onOpenItem(item)} className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors group">
                            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "#EFF6FF" }}><Icon size={11} className="text-blue-500" /></div>
                            <div className="flex-1 min-w-0 flex items-center justify-between">
                              <p className="text-gray-700 truncate transition-colors group-hover:text-blue-600" style={{ fontSize: "0.72rem", fontWeight: 500 }}>{item.title}</p>
                              <span className="text-gray-400 shrink-0 ml-2" style={{ fontSize: "0.6rem" }}>{item.subtitle || option.label}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4" onClick={closeModal}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col min-h-[400px]" onClick={(e) => e.stopPropagation()}>
            
            {/* 헤더 */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-white z-10">
              <div className="flex items-center gap-3">
                {configStep === 'config' && (
                  <button onClick={() => setConfigStep('select')} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                  </button>
                )}
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {configStep === 'config' ? `${selectedConfig?.label} 맞춤 설정` : 'AI 학습 자료 자동 생성'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {configStep === 'config' ? '원하는 학습 스타일에 맞게 옵션을 조정하세요.' : '강사님이 공유한 소스를 바탕으로 나만의 학습 자료를 만듭니다.'}
                  </p>
                </div>
              </div>
              <button onClick={closeModal} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors mb-auto">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            {/* 종류 선택 화면 */}
            {configStep === 'select' && (
              <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-4 overflow-y-auto max-h-[60vh] bg-gray-50 flex-1">
                {STUDIO_CREATION_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setSelectedConfig(option);
                        setConfigStep('config');
                      }}
                      className="relative flex flex-col items-center justify-center p-5 border bg-white rounded-2xl transition-all group border-gray-100 hover:border-blue-400 hover:shadow-md cursor-pointer"
                    >
                      <div className={`w-12 h-12 flex items-center justify-center rounded-full mb-3 transition-transform group-hover:scale-110 ${option.bg}`}>
                        <Icon className={`w-6 h-6 ${option.color}`} />
                      </div>
                      <span className="text-[13px] font-bold text-gray-700 text-center break-keep">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 옵션 설정 화면 */}
            {configStep === 'config' && selectedConfig && (
              <div className="p-6 flex flex-col gap-6 bg-gray-50 flex-1 overflow-y-auto max-h-[60vh]">
                
                {/* 난이도 설정 */}
                {['quiz', 'flashcard'].includes(selectedConfig.id) && (
                  <div className="flex flex-col gap-2.5">
                    <span className="text-sm font-bold text-gray-700">난이도 설정</span>
                    <div className="flex gap-2">
                      {[
                        { id: 'beginner', label: '초급' },
                        { id: 'intermediate', label: '중급' },
                        { id: 'advanced', label: '고급' },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setOptDifficulty(opt.id)}
                          className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all border ${
                            optDifficulty === opt.id
                              ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm'
                              : 'bg-white border-gray-200 text-gray-500 hover:border-blue-200 hover:bg-blue-50/50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 분량 설정 */}
                {['quiz', 'flashcard', 'slide', 'report', 'audio'].includes(selectedConfig.id) && (
                  <div className="flex flex-col gap-2.5">
                    <span className="text-sm font-bold text-gray-700">학습 분량</span>
                    <div className="flex gap-2">
                      {[
                        { id: 'small', label: '적게 (핵심만)' },
                        { id: 'standard', label: '보통 (기본)' },
                        { id: 'large', label: '많게 (상세히)' },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setOptAmount(opt.id)}
                          className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all border ${
                            optAmount === opt.id
                              ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm'
                              : 'bg-white border-gray-200 text-gray-500 hover:border-blue-200 hover:bg-blue-50/50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 언어 설정 */}
                <div className="flex flex-col gap-2.5">
                  <span className="text-sm font-bold text-gray-700">출력 언어</span>
                  <div className="flex gap-2">
                    {[
                      { id: 'ko', label: '한국어 (Korean)' },
                      { id: 'en', label: '영어 (English)' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setOptLanguage(opt.id)}
                        className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all border ${
                          optLanguage === opt.id
                            ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-blue-200 hover:bg-blue-50/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 최종 생성 버튼 */}
                <div className="mt-4 pt-2 border-t border-gray-200">
                  <button
                    onClick={handleCreateStudio}
                    disabled={isGenerating !== null}
                    className="w-full py-4 rounded-xl text-white font-bold transition-all flex items-center justify-center gap-2 hover:shadow-lg disabled:opacity-50 text-[15px]"
                    style={{ background: "linear-gradient(135deg, #155dfc, #0d4ac4)" }}
                  >
                    {isGenerating === selectedConfig.id ? (
                      <><Loader2 className="w-5 h-5 animate-spin" />자료를 생성하는 중...</>
                    ) : (
                      <><Sparkles className="w-5 h-5" />생성하기</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}