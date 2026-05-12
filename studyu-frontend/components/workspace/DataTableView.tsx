"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Download } from "lucide-react";

interface Column {
  id: string;
  title: string;
  type: "text" | "number" | "date";
}

interface Row {
  [key: string]: any;
}

interface DataTableViewProps {
  data: {
    title: string;
    description?: string;
    columns: Column[];
    rows: Row[];
  };
  itemInfo?: any;
  onBack?: () => void;
}

export function DataTableView({ data, onBack }: DataTableViewProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredAndSortedData = useMemo(() => {
    let result = [...(data.rows || [])];

    if (searchTerm) {
      result = result.filter((row) =>
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    if (sortColumn) {
      result.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];

        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        let comparison = 0;
        if (typeof aValue === "number" && typeof bValue === "number") {
          comparison = aValue - bValue;
        } else {
          comparison = String(aValue).localeCompare(String(bValue));
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [data.rows, sortColumn, sortDirection, searchTerm]);

  const totalPages = Math.ceil(filteredAndSortedData.length / pageSize);
  const paginatedData = filteredAndSortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
  };

  const downloadCSV = () => {
    const headers = data.columns.map((col) => col.title).join(",");
    const rows = filteredAndSortedData.map((row) =>
      data.columns
        .map((col) => {
          const value = row[col.id];
          return typeof value === "string" && value.includes(",") ? `"${value}"` : value ?? "";
        })
        .join(",")
    );

    const csv = '﻿' + [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `${data.title}.csv`);
    link.style.visibility = "hidden";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {onBack && (
              <>
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
              </>
            )}
            <h2 className="text-sm font-medium text-gray-700 truncate">{data.title}</h2>
          </div>
          <button
            onClick={downloadCSV}
            className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-500 text-xs rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            <Download size={14} />
            저장
          </button>
        </div>

        {data.description && <p className="text-sm text-gray-600 mb-4">{data.description}</p>}

        <div className="flex gap-3 items-center">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="표 안에서 검색..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {data.columns.map((col) => (
                <th
                  key={col.id}
                  onClick={() => handleSort(col.id)}
                  className="px-6 py-3 text-left font-semibold text-gray-700 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span>{col.title}</span>
                    {sortColumn === col.id ? (
                      sortDirection === "asc" ? (
                        <ChevronUp size={16} className="text-blue-600" />
                      ) : (
                        <ChevronDown size={16} className="text-blue-600" />
                      )
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={data.columns.length} className="px-6 py-8 text-center text-gray-500">
                  {searchTerm ? "검색 결과가 없습니다." : "데이터가 없습니다."}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, index) => (
                <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  {data.columns.map((col) => (
                    <td key={col.id} className="px-6 py-4 text-gray-700">
                      {col.type === "number" ? (
                        <span className="font-semibold">{row[col.id]}</span>
                      ) : col.type === "date" ? (
                        new Date(row[col.id]).toLocaleDateString("ko-KR")
                      ) : (
                        row[col.id]
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">페이지 크기:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
