"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, BotMessageSquare } from 'lucide-react';
import { Resizable } from 're-resizable';

import { TopNavBar } from "@/components/workspace/student/TopNavBar";
import { StudentSourcePanel } from "@/components/workspace/student/StudentSourcePanel";
import { WeeklyPlanCard } from "@/components/workspace/student/WeeklyPlanCard";
import { StudentStudioPanel } from "@/components/workspace/student/StudentStudioPanel";
import { StudentChatPanel } from "@/components/workspace/student/StudentChatPanel";
import { StudioItemViewer } from "@/components/workspace/student/StudioItemViewer"; 

export default function StudentWorkspacePage() {
  const params = useParams();
  const notebookId = params.id as string;
  
  const [notebookTitle, setNotebookTitle] = useState<string>("");

  const [activeDocIds, setActiveDocIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [studioItems, setStudioItems] = useState<any[]>([]); 
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const [selectedLLM, setSelectedLLM] = useState('gpt-4o');
  const [selectedDifficulty, setSelectedDifficulty] = useState('intermediate');

  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);

  const [chatHeight, setChatHeight] = useState(320);
  const [isChatOpen, setIsChatOpen] = useState(true);

  const [leftWidth, setLeftWidth] = useState(288);
  const [rightWidth, setRightWidth] = useState(360);
  const [isLeftResizing, setIsLeftResizing] = useState(false);
  const [isRightResizing, setIsRightResizing] = useState(false);
  const [leftOpenBefore, setLeftOpenBefore] = useState(true);
  
  const fetchData = async () => {
    const supabase = createClient();

    const { data: notebookData } = await supabase
      .from('notebooks')
      .select('title')
      .eq('id', notebookId)
      .single();
    if (notebookData) setNotebookTitle(notebookData.title);

    const { data: docsData } = await supabase
      .from('documents')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false });
    if (docsData) setDocs(docsData);

    const { data: studioData } = await supabase
      .from('studio_items')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false });
    if (studioData) setStudioItems(studioData);
  };

  useEffect(() => {
    if (notebookId) fetchData();
  }, [notebookId]);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: notebookData } = await supabase
        .from('notebooks')
        .select('title')
        .eq('id', notebookId)
        .single();
      if (notebookData) setNotebookTitle(notebookData.title);

      const { data: docsData } = await supabase
        .from('documents')
        .select('*')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: false });
      if (docsData) setDocs(docsData);

      const { data: studioData } = await supabase
        .from('studio_items')
        .select('*')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: false });
      if (studioData) setStudioItems(studioData);
    };

    if (notebookId) fetchData();
  }, [notebookId]);

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden min-w-[1200px]">
      <TopNavBar title={notebookTitle} />

      <div className="w-full h-[64px] shrink-0 pointer-events-none" />

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* 왼쪽: 소스 패널 */}
        <Resizable
          size={{ width: isLeftOpen ? leftWidth : 0, height: '100%' }}
          minWidth={isLeftOpen ? 200 : 0}
          maxWidth={isLeftOpen ? 600 : 0}
          enable={{ right: isLeftOpen }}
          onResizeStart={() => setIsLeftResizing(true)}
          onResizeStop={(e, direction, ref, d) => {
            setIsLeftResizing(false);
            setLeftWidth(prev => prev + d.width);
          }}
          handleStyles={{ right: { width: '12px', right: '-6px', zIndex: 50, cursor: 'col-resize' } }}
          handleComponent={{
            right: isLeftOpen ? (
              <div className="w-full h-full flex items-center justify-center group">
                <div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div>
              </div>
            ) : <></>
          }}
          className={`shrink-0 bg-white flex flex-col relative z-10 border-[#e7e9ed] ${
            !isLeftResizing ? "transition-all duration-300 ease-in-out" : ""
          } ${isLeftOpen ? "border-r" : "border-r-0 overflow-hidden"}`}
        >
          <div className="w-full h-full flex flex-col min-w-[200px]">
            <StudentSourcePanel sources={docs} />
          </div>
        </Resizable>

        {/* 가운데: 메인 패널 */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative transition-all duration-300">
          
          <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#e7e9ed] shrink-0 z-10">
            <button onClick={() => setIsLeftOpen(!isLeftOpen)} className="p-1.5 text-gray-400 hover:text-[#155dfc] hover:bg-blue-50 rounded-lg transition-colors">
              {isLeftOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select value={selectedLLM} onChange={(e) => setSelectedLLM(e.target.value)} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    <option value="claud-3-opus">Claude 3 Opus</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="relative">
                  <select value={selectedDifficulty} onChange={(e) => setSelectedDifficulty(e.target.value)} className="appearance-none bg-[#f8f9fb] border border-[#e7e9ed] hover:bg-[#e7e9ed] text-[#414751] text-[12px] font-medium pl-4 pr-8 py-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-[#155dfc]/20 transition-colors cursor-pointer shadow-sm">
                    <option value="beginner">초급</option>
                    <option value="intermediate">중급</option>
                    <option value="advanced">고급</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[#99a1af] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <button onClick={() => setIsRightOpen(!isRightOpen)} className="p-1.5 text-gray-400 hover:text-[#155dfc] hover:bg-blue-50 rounded-lg transition-colors">
                {isRightOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {selectedItem ? (
            <div className="flex-1 overflow-hidden bg-[#fcfcfd] flex flex-col relative">
              <StudioItemViewer 
                item={selectedItem} 
                onClose={() => {
                  setSelectedItem(null);
                  setIsLeftOpen(leftOpenBefore);
                }} 
              />
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-[32px] py-[32px]">
                <div className="max-w-[800px] mx-auto">
                  <div className="mb-[32px]">
                    <h1 className="font-['Inter'] text-[30px] font-semibold text-[#1a1d26] tracking-[-0.75px] leading-[36px]">
                      Weekly Study Plan
                    </h1>
                    <p className="font-['Inter'] text-[16px] text-[#99a1af] mt-[4px] leading-[24px]">
                      {notebookTitle || "노트북"} • Student Mode
                    </p>
                  </div>
                  <div className="flex flex-col gap-[48px] pb-10">
                    {[1, 2, 3].map((weekNum) => (
                      <WeeklyPlanCard 
                        key={weekNum} 
                        weekNumber={weekNum}
                        items={weekNum === 1 ? studioItems : []} 
                        onOpenItem={(item) => {
                          setSelectedItem(item);
                          setLeftOpenBefore(isLeftOpen);
                          setIsLeftOpen(false);
                          if (!isRightOpen) setIsRightOpen(true);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {isChatOpen && (
                <Resizable
                  size={{ width: '100%', height: chatHeight }}
                  onResizeStop={(e, direction, ref, d) => {
                    const newHeight = chatHeight + d.height;
                    if (newHeight <= 100) {
                      setIsChatOpen(false);
                      setChatHeight(320); // 다음에 다시 열 때를 대비해 기본 크기로 복구해둠
                    } else {
                      setChatHeight(newHeight);
                    }
                  }}
                  minHeight={50}
                  maxHeight="80%"
                  enable={{ top: true }}
                  handleStyles={{ top: { marginTop: '-4px', height: '8px', cursor: 'row-resize', width: '100%', zIndex: 20 } }}
                  handleComponent={{ top: <div className="w-full h-full flex items-center justify-center group"><div className="w-16 h-1 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div></div> }}
                  className="border-t border-[#e7e9ed] bg-white shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.05)] shrink-0 flex flex-col z-10"
                >
                  <StudentChatPanel activeDocIds={activeDocIds} docs={docs} notebookId={notebookId} selectedLLM={selectedLLM} selectedDifficulty={selectedDifficulty} />
                </Resizable>
              )}
              {!isChatOpen && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="absolute bottom-6 right-6 w-14 h-14 bg-[#155dfc] text-white rounded-full flex items-center justify-center shadow-[0_8px_16px_rgba(21,93,252,0.3)] hover:bg-[#0d4ac4] hover:scale-105 transition-all z-50 group"
                  title="Ask AI 열기"
                >
                  <BotMessageSquare className="w-6 h-6" />
                </button>
              )}
            </>
          )}
        </div>

        {/* 오른쪽: 스튜디오 패널 */}
        <Resizable
          size={{ width: isRightOpen ? rightWidth : 0, height: '100%' }}
          minWidth={isRightOpen ? 250 : 0}
          maxWidth={isRightOpen ? 800 : 0}
          enable={{ left: isRightOpen }}
          onResizeStart={() => setIsRightResizing(true)}
          onResizeStop={(e, direction, ref, d) => {
            setIsRightResizing(false);
            setRightWidth(prev => prev + d.width);
          }}
          handleStyles={{ left: { width: '12px', left: '-6px', zIndex: 50, cursor: 'col-resize' } }}
          handleComponent={{
            left: isRightOpen ? (
              <div className="w-full h-full flex items-center justify-center group">
                <div className="w-1 h-8 bg-[#e7e9ed] rounded-full group-hover:bg-[#155dfc] transition-colors shadow-sm"></div>
              </div>
            ) : <></>
          }}
          className={`shrink-0 bg-[#f8f9fa] flex flex-col relative z-10 border-[#e7e9ed] ${
            !isRightResizing ? "transition-all duration-300 ease-in-out" : ""
          } ${isRightOpen ? "border-l" : "border-l-0 overflow-hidden"}`}
        >
          <div className="w-full h-full flex flex-col min-w-[250px]">
            {selectedItem ? (
              <StudentChatPanel 
                activeDocIds={activeDocIds} 
                docs={docs} 
                notebookId={notebookId}
                selectedLLM={selectedLLM}
                selectedDifficulty={selectedDifficulty}
              />
            ) : (
              <StudentStudioPanel 
                studioItems={studioItems} 
                docs={docs}
                notebookId={notebookId}
                onRefresh={() => fetchData()}
                onOpenItem={(item) => {
                  setSelectedItem(item);
                  setLeftOpenBefore(isLeftOpen);
                  setIsLeftOpen(false);
                  if (!isRightOpen) setIsRightOpen(true);
                }} 
              />
            )}
          </div>
        </Resizable>
      </div>
    </div>
  );
}