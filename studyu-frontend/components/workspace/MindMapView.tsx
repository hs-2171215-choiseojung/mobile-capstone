"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface MindmapNode {
  id: string;
  text: string;
  parent?: string;
  children?: MindmapNode[];
}

interface Props {
  nodes: MindmapNode[];
  title: string;
  onBack: () => void;
}

function buildTree(flatNodes: MindmapNode[]): MindmapNode[] {
  const map: Record<string, MindmapNode & { children: MindmapNode[] }> = {};
  flatNodes.forEach((n) => (map[n.id] = { ...n, children: [] }));
  const roots: MindmapNode[] = [];
  flatNodes.forEach((n) => {
    if (n.parent && map[n.parent]) map[n.parent].children.push(map[n.id]);
    else roots.push(map[n.id]);
  });
  return roots;
}

function NodeItem({
  node,
  level,
  expandedNodes,
  onToggle,
}: {
  node: MindmapNode;
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = (node.children?.length ?? 0) > 0;

  const colorClass =
    level === 0
      ? "bg-indigo-100 text-indigo-700 border-indigo-300 font-black text-sm"
      : level === 1
      ? "bg-blue-50 text-blue-700 border-blue-200 font-bold text-sm"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium";

  return (
    <div className="flex items-center">
      <div
        id={`node-${node.id}`}
        onClick={() => hasChildren && onToggle(node.id)}
        className={`min-w-[110px] max-w-[170px] p-2.5 rounded-xl border-2 transition-all text-center select-none mx-6 ${colorClass} ${
          hasChildren ? "cursor-pointer hover:brightness-95 active:scale-95" : "cursor-default"
        }`}
      >
        <span className="break-words leading-snug block">{node.text}</span>
        {hasChildren && (
          <span className="opacity-30 text-[9px] ml-1">{isExpanded ? "◀" : "▶"}</span>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MindMapView({ nodes, title, onBack }: Props) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["root"]));
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
    const newLines: string[] = [];

    expandedNodes.forEach((parentId) => {
      const parentEl = document.getElementById(`node-${parentId}`);
      if (!parentEl) return;
      const pr = parentEl.getBoundingClientRect();
      const px = pr.right - containerRect.left + container.scrollLeft;
      const py = pr.top + pr.height / 2 - containerRect.top + container.scrollTop;

      nodes
        .filter((n) => n.parent === parentId)
        .forEach((child) => {
          const childEl = document.getElementById(`node-${child.id}`);
          if (!childEl) return;
          const cr = childEl.getBoundingClientRect();
          const cx = cr.left - containerRect.left + container.scrollLeft;
          const cy = cr.top + cr.height / 2 - containerRect.top + container.scrollTop;
          const cpx = px + (cx - px) / 2;
          newLines.push(`M ${px} ${py} C ${cpx} ${py}, ${cpx} ${cy}, ${cx} ${cy}`);
        });
    });

    setLines(newLines);
  }, [expandedNodes, nodes]);

  useEffect(() => {
    const timer = setTimeout(updateLines, 120);
    window.addEventListener("resize", updateLines);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateLines);
    };
  }, [updateLines]);

  // 드래그 패닝
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      containerRef.current.scrollLeft = dragStart.current.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.current.scrollTop - dy;
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsGrabbing(false);
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 노드 클릭은 드래그로 처리하지 않음
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
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
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
          스튜디오
        </button>
        <span className="text-gray-300">›</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
      </div>

      {/* Mind map canvas */}
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
          {lines.map((path, i) => (
            <path
              key={i}
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
