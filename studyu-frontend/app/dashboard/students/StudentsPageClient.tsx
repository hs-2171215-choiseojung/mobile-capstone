"use client";

import { useRouter } from "next/navigation";
import StudyULogo from "@/components/StudyULogo";
import Image from "next/image";
import { useState, useEffect } from "react";

interface Student {
  enrollment_id: string;
  joined_at: string;
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  progress?: number; // 진도도 (0-100)
}

interface NotebookData {
  notebook_id: string;
  title: string;
  students: Student[];
}

interface Notebook {
  id?: string;
  notebook_id?: string;
  title: string;
  student_count?: number;
}

interface Props {
  notebookData: NotebookData | null;
  errorMsg: string | null;
  notebookList: Notebook[];
  currentNotebookId: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function getStudentStatus(progress: number = 0) {
  if (progress >= 85) return { label: "우수", color: "bg-emerald-100 text-emerald-700", icon: "✓" };
  if (progress >= 60) return { label: "주의", color: "bg-amber-100 text-amber-700", icon: "!" };
  return { label: "위험", color: "bg-red-100 text-red-700", icon: "⚠" };
}

// 더미 데이터
const DUMMY_STUDENTS: Student[] = [
  {
    enrollment_id: "enroll-001",
    joined_at: "2024-09-01T10:00:00Z",
    id: "student-001",
    display_name: "이지은",
    email: "jieun@example.com",
    avatar_url: null,
    progress: 92,
  },
  {
    enrollment_id: "enroll-002",
    joined_at: "2024-09-02T10:00:00Z",
    id: "student-002",
    display_name: "정하은",
    email: "haun@example.com",
    avatar_url: null,
    progress: 78,
  },
  {
    enrollment_id: "enroll-003",
    joined_at: "2024-09-03T10:00:00Z",
    id: "student-003",
    display_name: "최우나",
    email: "woona@example.com",
    avatar_url: null,
    progress: 25,
  },
];

export default function StudentsPageClient({ notebookData, errorMsg, notebookList = [], currentNotebookId }: Props) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // 실제 데이터가 없으면 더미 데이터 사용
  const initialStudents =
    (notebookData?.students && notebookData.students.length > 0)
      ? notebookData.students
      : DUMMY_STUDENTS;

  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [statusFilter, setStatusFilter] = useState<"all" | "excellent" | "caution" | "danger">("all");

  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  // 노트북이 변경될 때마다 학생 데이터 업데이트
  useEffect(() => {
    const newStudents =
      (notebookData?.students && notebookData.students.length > 0)
        ? notebookData.students
        : DUMMY_STUDENTS;
    setStudents(newStudents);
    setSelectedStudentId(null);
  }, [currentNotebookId, notebookData]);

  const filtered = students.filter((s) => {
    // 검색 필터
    const matchesSearch =
      (s.display_name?.toLowerCase() ?? "").includes(search.toLowerCase()) ||
      (s.email?.toLowerCase() ?? "").includes(search.toLowerCase());

    // 상태 필터
    let matchesStatus = true;
    if (statusFilter !== "all") {
      const progress = s.progress ?? 0;
      if (statusFilter === "excellent") matchesStatus = progress >= 85;
      else if (statusFilter === "caution") matchesStatus = progress >= 60 && progress < 85;
      else if (statusFilter === "danger") matchesStatus = progress < 60;
    }

    return matchesSearch && matchesStatus;
  });

  // 통계 계산
  const excellentCount = students.filter((s) => (s.progress ?? 0) >= 85).length;
  const cautionCount = students.filter((s) => (s.progress ?? 0) >= 60 && (s.progress ?? 0) < 85).length;
  const averageProgress = students.length > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.progress ?? 0), 0) / students.length)
    : 0;
  const dangerStudents = students.filter((s) => (s.progress ?? 0) < 60);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="h-14 shrink-0 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                <path
                  d="M15 18l-6-6 6-6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {/* 노트북 선택 드롭다운 */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <span className="font-semibold">{notebookData?.title || "노트북"}</span>
                <span className="text-xs text-gray-500">({notebookData?.students?.length ?? 0}명)</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {/* 드롭다운 메뉴 */}
              {dropdownOpen && notebookList.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  <div className="max-h-64 overflow-y-auto">
                    {notebookList.map((notebook) => {
                      const notebookId = notebook.id || notebook.notebook_id;
                      return (
                        <button
                          key={notebookId}
                          onClick={() => {
                            router.push(`/dashboard/students?notebook=${notebookId}`);
                            setDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${
                            notebookId === currentNotebookId ? "bg-blue-50" : ""
                          }`}
                        >
                          <div className="font-medium text-gray-900">{notebook.title}</div>
                          <div className="text-xs text-gray-500">{notebook.student_count ?? 0}명</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StudyULogo size={28} />
            <span className="text-sm font-bold text-gray-800">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      {errorMsg ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-12 h-12 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                fill="currentColor"
              />
            </svg>
            <p className="text-gray-700 font-semibold mb-1">데이터를 불러올 수 없습니다</p>
            <p className="text-sm text-gray-500">잠시 후 다시 시도해주세요.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden bg-white">
          {/* 좌측: 테이블 */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="px-6 sm:px-8 py-6 border-b border-gray-100">
              <h1 className="text-xl font-bold text-gray-900 mb-4">
                {notebookData?.title || "학생 관리"}
              </h1>

              {/* 통계 섹션 */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {students.length}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">전체 학생</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {excellentCount}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">우수 학생</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {cautionCount}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">주의 학생</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-600">
                    {averageProgress}<span className="text-xs">%</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">평균 진도</div>
                </div>
              </div>

              {/* 경고 메시지 - 위험 상태 학생이 있을 때만 표시 */}
              {dangerStudents.length > 0 && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                  <svg
                    className="w-4 h-4 text-red-500 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M12 8v4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="16" r="0.5" fill="currentColor" />
                  </svg>
                  <p className="text-xs text-red-600">
                    {dangerStudents.map((s) => s.display_name).join(", ")}
                    {dangerStudents.length === 1 ? "의 참여도" : "들의 참여도"}가 저조합니다.
                  </p>
                </div>
              )}

              {/* 검색과 필터 */}
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="text"
                    placeholder="학생 이름이나 이메일 검색..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 상태 필터 드롭다운 */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="all">전체 학생</option>
                  <option value="excellent">✓ 우수</option>
                  <option value="caution">! 주의</option>
                  <option value="danger">⚠ 위험</option>
                </select>
              </div>

              {/* 뷰 전환 버튼 */}
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setViewMode("table")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    viewMode === "table"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <path d="M3 10h18M3 14h18M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  목록
                </button>
                <button
                  onClick={() => setViewMode("card")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    viewMode === "card"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <path d="M4 6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM14 6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V6zM4 16a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4zM14 16a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  카드
                </button>
              </div>
            </div>

            {/* 학생 목록 */}
            {students.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                아직 참여한 학생이 없습니다.
              </div>
            ) : filtered.length === 0 && search ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                "<strong>{search}</strong>"에 해당하는 학생이 없습니다.
              </div>
            ) : viewMode === "table" ? (
              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-6 py-3 text-gray-600 font-semibold">
                        학생
                      </th>
                      <th className="text-left px-6 py-3 text-gray-600 font-semibold">
                        진도도
                      </th>
                      <th className="text-left px-6 py-3 text-gray-600 font-semibold">
                        출석률
                      </th>
                      <th className="text-left px-6 py-3 text-gray-600 font-semibold">
                        상태
                      </th>
                      <th className="text-right px-6 py-3 text-gray-600 font-semibold">
                        작업
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((student, idx) => {
                      const initial =
                        (student.display_name || student.email || "?")[0].toUpperCase();
                      const isSelected = selectedStudentId === student.id;

                      return (
                        <tr
                          key={student.enrollment_id}
                          onClick={() => setSelectedStudentId(student.id)}
                          className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-blue-50"
                              : idx % 2 === 0
                              ? "bg-white"
                              : "bg-gray-50"
                          } hover:bg-blue-50`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {student.avatar_url ? (
                                <Image
                                  src={student.avatar_url}
                                  alt="프로필"
                                  width={36}
                                  height={36}
                                  className="rounded-full w-9 h-9 object-cover"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-600 flex-shrink-0">
                                  {initial}
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-gray-900">
                                  {student.display_name || "이름 없음"}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {student.email || "-"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500"
                                  style={{ width: `${student.progress ?? 0}%` }}
                                />
                              </div>
                              <span className="text-gray-600 font-medium">{student.progress ?? 0}%</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{Math.floor((student.progress ?? 0) * 0.14)}/14</td>
                          <td className="px-6 py-4">
                            {(() => {
                              const status = getStudentStatus(student.progress);
                              return (
                                <span className={`px-2.5 py-1 text-xs font-medium ${status.color} rounded-full`}>
                                  {status.icon} {status.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors"
                                title="메세지 보내기"
                              >
                                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                                  <path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                className="p-1.5 hover:bg-purple-100 rounded-lg transition-colors"
                                title="맞춤 퀴즈 만들기"
                              >
                                <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                                  <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-2 gap-4">
                  {filtered.map((student) => {
                    const initial = (student.display_name || student.email || "?")[0].toUpperCase();
                    const status = getStudentStatus(student.progress);

                    return (
                      <div
                        key={student.enrollment_id}
                        onClick={() => setSelectedStudentId(student.id)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${
                          selectedStudentId === student.id
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          {student.avatar_url ? (
                            <Image
                              src={student.avatar_url}
                              alt="프로필"
                              width={40}
                              height={40}
                              className="rounded-full w-10 h-10 object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-600 flex-shrink-0">
                              {initial}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 text-sm">{student.display_name || "이름 없음"}</p>
                            <p className="text-xs text-gray-500 truncate">{student.email || "-"}</p>
                          </div>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-gray-600">진도도</span>
                              <span className="font-semibold text-gray-900">{student.progress ?? 0}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${student.progress ?? 0}%` }} />
                            </div>
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">출석률</span>
                            <span className="font-semibold text-gray-900">{Math.floor((student.progress ?? 0) * 0.14)}/14</span>
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">상태</span>
                            <span className={`px-2 py-0.5 text-xs font-medium ${status.color} rounded-full`}>
                              {status.icon} {status.label}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                          <button className="flex-1 flex items-center justify-center p-1.5 hover:bg-blue-100 rounded transition-colors" title="메세지 보내기">
                            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24">
                              <path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button className="flex-1 flex items-center justify-center p-1.5 hover:bg-purple-100 rounded transition-colors" title="맞춤 퀴즈 만들기">
                            <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                              <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 우측: 학생 상세 정보 */}
          {selectedStudent ? (
            <div className="w-80 shrink-0 flex flex-col bg-white border-l border-gray-200 overflow-hidden">
              {/* 헤더 */}
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {selectedStudent.avatar_url ? (
                      <Image
                        src={selectedStudent.avatar_url}
                        alt="프로필"
                        width={48}
                        height={48}
                        className="rounded-full w-12 h-12 object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600">
                        {(selectedStudent.display_name || selectedStudent.email || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="font-semibold text-gray-900">
                        {selectedStudent.display_name || "이름 없음"}
                      </h2>
                      <p className="text-xs text-gray-500 truncate">
                        {selectedStudent.email || "-"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedStudentId(null)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* 진도 통계 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {selectedStudent.progress ?? 0}<span className="text-xs text-gray-500">%</span>
                    </div>
                    <div className="text-xs text-gray-500">진도율</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {Math.floor((selectedStudent.progress ?? 0) * 1.01)}<span className="text-xs text-gray-500">%</span>
                    </div>
                    <div className="text-xs text-gray-500">출석률</div>
                  </div>
                </div>
              </div>

              {/* 주간 진행 */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-3">주간 진행</h3>
                  <div className="space-y-2">
                    {["1주차", "2주차", "3주차", "4주차", "5주차"].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 border border-gray-300 rounded shrink-0" />
                        <span className="text-gray-600">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 빠른섹션 */}
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-3">빠른섹션</h3>
                  <div className="space-y-2">
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                        <path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      메세지 보내기
                    </button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24">
                        <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      학습 리포트
                    </button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                      <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      맞춤 퀴즈 만들기
                    </button>
                  </div>
                </div>
              </div>

            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
