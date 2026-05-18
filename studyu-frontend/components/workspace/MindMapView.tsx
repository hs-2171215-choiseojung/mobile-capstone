"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface MindmapNode {
  id: string;
  text: string;
  parent?: string;
  children?: MindmapNode[];
  source_ref?: { page?: number | null; text?: string | null; timestamp?: number | null } | null;
}

interface Props {
  nodes: MindmapNode[];
  title: string;
  onBack: () => void;
  initialState?: { expandedNodeIds?: string[] };
  onStateChange?: (state: { expandedNodeIds: string[] }) => void;
  docs?: { id: string }[];
  onRequestSource?: (docId: string, page: number | null, text?: string | null, timestamp?: number | null) => void;
}

function buildTree(flatNodes: MindmapNode[]): MindmapNode[] {
  const map: Record<string, MindmapNode & { children: MindmapNode[] }> = {};
  flatNodes.forEach((node) => {
    map[node.id] = { ...node, children: [] };
  });

  const roots: MindmapNode[] = [];
  flatNodes.forEach((node) => {
    if (node.parent && map[node.parent]) map[node.parent].children.push(map[node.id]);
    else roots.push(map[node.id]);
  });

  return roots;
}

function NodeItem({
  node,
  level,
  expandedNodes,
  onToggle,
  docs,
  onRequestSource,
}: {
  node: MindmapNode;
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
  docs?: { id: string }[];
  onRequestSource?: (docId: string, page: number | null, text?: string | null, timestamp?: number | null) => void;
}) {
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isLeaf = !hasChildren;
  const hasSourceRef = isLeaf && node.source_ref && (node.source_ref.text || node.source_ref.page != null);
  const colorClass =
    level === 0
      ? "bg-indigo-100 text-indigo-700 border-indigo-300 font-black text-sm"
      : level === 1
        ? "bg-blue-50 text-blue-700 border-blue-200 font-bold text-sm"
        : "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium";

  return (
    <div className="flex items-center">
      <div className="flex flex-col items-center mx-6">
        <div
          id={`node-${node.id}`}
          onClick={() => hasChildren && onToggle(node.id)}
          className={`min-w-[110px] max-w-[170px] p-2.5 rounded-xl border-2 transition-all text-center select-none ${colorClass} ${
            hasChildren ? "cursor-pointer hover:brightness-95 active:scale-95" : "cursor-default"
          }`}
        >
          <span className="break-words leading-snug block">{node.text}</span>
          {hasChildren && <span className="opacity-30 text-[9px] ml-1">{isExpanded ? "-" : "+"}</span>}
        </div>
        {hasSourceRef && onRequestSource && docs && docs.length > 0 && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestSource(
                docs[0].id,
                node.source_ref?.page ?? null,
                node.source_ref?.text ?? null,
                node.source_ref?.timestamp ?? null,
              );
            }}
            className="mt-1.5 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400 transition-colors select-none"
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            참고 자료
          </button>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div className="flex flex-col justify-center gap-5">
          {(node.children ?? []).map((child) => (
            <NodeItem
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              docs={docs}
              onRequestSource={onRequestSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MindMapView({ nodes, title, onBack, initialState, onStateChange, docs, onRequestSource }: Props) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set(initialState?.expandedNodeIds?.length ? initialState.expandedNodeIds : ["root"])
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const treeData = buildTree(nodes);

  const updateLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const nextLines: string[] = [];

    expandedNodes.forEach((parentId) => {
      const parentEl = document.getElementById(`node-${parentId}`);
      if (!parentEl) return;

      const parentRect = parentEl.getBoundingClientRect();
      const px = parentRect.right - containerRect.left + container.scrollLeft;
      const py = parentRect.top + parentRect.height / 2 - containerRect.top + container.scrollTop;

      nodes
        .filter((node) => node.parent === parentId)
        .forEach((child) => {
          const childEl = document.getElementById(`node-${child.id}`);
          if (!childEl) return;

          const childRect = childEl.getBoundingClientRect();
          const cx = childRect.left - containerRect.left + container.scrollLeft;
          const cy = childRect.top + childRect.height / 2 - containerRect.top + container.scrollTop;
          const cpx = px + (cx - px) / 2;
          nextLines.push(`M ${px} ${py} C ${cpx} ${py}, ${cpx} ${cy}, ${cx} ${cy}`);
        });
    });

    setLines(nextLines);
  }, [expandedNodes, nodes]);

  useEffect(() => {
    const timer = setTimeout(updateLines, 120);
    window.addEventListener("resize", updateLines);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateLines);
    };
  }, [updateLines]);

  useEffect(() => {
    onStateChange?.({ expandedNodeIds: Array.from(expandedNodes) });
  }, [expandedNodes, onStateChange]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      containerRef.current.scrollLeft = dragStart.current.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsGrabbing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[id^="node-"]')) return;
    isDragging.current = true;
    setIsGrabbing(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current?.scrollLeft ?? 0,
      scrollTop: containerRef.current?.scrollTop ?? 0,
    };
    e.preventDefault();
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="shrink-0 flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-blue-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
            <path
              d="M19 12H5M12 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          돌아가기
        </button>
        <div className="h-4 w-px bg-gray-200 shrink-0" />
        <span className="text-sm font-medium text-gray-700 truncate min-w-0">{title}</span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-white p-12 flex items-start relative"
        style={{ cursor: isGrabbing ? "grabbing" : "grab", userSelect: "none" }}
        onMouseDown={handleCanvasMouseDown}
        onScroll={updateLines}
      >
        <svg
          className="absolute top-0 left-0 pointer-events-none z-0"
          style={{ width: "100%", height: "100%" }}
        >
          {lines.map((path, index) => (
            <path
              key={index}
              d={path}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
        </svg>

        <div className="relative z-10 flex items-center">
          {treeData.map((rootNode) => (
            <NodeItem
              key={rootNode.id}
              node={rootNode}
              level={0}
              expandedNodes={expandedNodes}
              onToggle={toggleNode}
              docs={docs}
              onRequestSource={onRequestSource}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
