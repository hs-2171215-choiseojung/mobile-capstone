"use client";

import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Download } from 'lucide-react';

interface Column {
  id: string;
  title: string;
  type: 'text' | 'number' | 'date';
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
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // 정렬 및 필터링된 데이터
  const filteredAndSortedData = useMemo(() => {
    let result = [...(data.rows || [])];

    // 검색 필터링
    if (searchTerm) {
      result = result.filter(row =>
        Object.values(row).some(val =>
          String(val).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // 정렬
    if (sortColumn) {
      result.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];

        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        let comparison = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [data.rows, sortColumn, sortDirection, searchTerm]);

  // 페이지네이션
  const totalPages = Math.ceil(filteredAndSortedData.length / pageSize);
  const paginatedData = filteredAndSortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  };

  const downloadCSV = () => {
    const headers = data.columns.map(col => col.title).join(',');
    const rows = filteredAndSortedData.map(row =>
      data.columns.map(col => {
        const val = row[col.id];
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val ?? '';
      }).join(',')
    );

    const csv = '﻿' + [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${data.title}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-6 py-6 border-b border-gray-200 shrink-0">
        {onBack && (
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-blue-600 flex items-center gap-1 mb-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            스튜디오
          </button>
        )}
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-gray-900">{data.title}</h2>
          {data.description && (
            <p className="text-sm text-gray-600 mt-2">{data.description}</p>
          )}
        </div>

        {/* 검색 및 도구 */}
        <div className="flex gap-3 items-center">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="표에서 검색..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={downloadCSV}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download size={16} />
            CSV 다운로드
          </button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {data.columns.map(col => (
                <th
                  key={col.id}
                  onClick={() => handleSort(col.id)}
                  className="px-6 py-3 text-left font-semibold text-gray-700 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span>{col.title}</span>
                    {sortColumn === col.id && (
                      sortDirection === 'asc' ?
                        <ChevronUp size={16} className="text-blue-600" /> :
                        <ChevronDown size={16} className="text-blue-600" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={data.columns.length} className="px-6 py-8 text-center text-gray-500">
                  {searchTerm ? '검색 결과가 없습니다.' : '데이터가 없습니다.'}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  {data.columns.map(col => (
                    <td key={col.id} className="px-6 py-4 text-gray-700">
                      {col.type === 'number' ? (
                        <span className="font-semibold">{row[col.id]}</span>
                      ) : col.type === 'date' ? (
                        new Date(row[col.id]).toLocaleDateString('ko-KR')
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

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              페이지 크기:
            </span>
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          </div>

          <div className="text-sm text-gray-600">
            총 {filteredAndSortedData.length}개 행
          </div>
        </div>
      )}
    </div>
  );
}
