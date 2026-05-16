"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import StudyULogo from "@/components/StudyULogo";
import { createClient } from "@/lib/supabase/client";

interface Student {
  enrollment_id: string;
  joined_at: string;
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
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
  backHref: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDate(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function getStudentLabel(student: Student) {
  return student.display_name?.trim() || student.email?.trim() || "이름 없음";
}

export default function StudentsPageClient({
  notebookData,
  errorMsg,
  notebookList = [],
  currentNotebookId,
  backHref,
}: Props) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<Student[]>(notebookData?.students ?? []);
  const [confirmStudentId, setConfirmStudentId] = useState<string | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStudents(notebookData?.students ?? []);
    setSearch("");
    setConfirmStudentId(null);
    setDeletingStudentId(null);
  }, [currentNotebookId, notebookData]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filteredStudents = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return students;

    return students.filter((student) => {
      const name = student.display_name?.toLowerCase() ?? "";
      const email = student.email?.toLowerCase() ?? "";
      return name.includes(keyword) || email.includes(keyword);
    });
  }, [search, students]);

  const confirmStudent = students.find((student) => student.id === confirmStudentId) ?? null;

  const handleDeleteStudent = async (studentId: string) => {
    setDeletingStudentId(studentId);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token) {
        throw new Error("로그인이 필요합니다.");
      }

      const response = await fetch(
        `${API}/api/notebooks/${currentNotebookId}/students/${studentId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail ?? "학생 삭제에 실패했습니다.");
      }

      setStudents((prev) => prev.filter((item) => item.id !== studentId));
      setConfirmStudentId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "학생 삭제에 실패했습니다.");
    } finally {
      setDeletingStudentId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="h-14 shrink-0 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => {
                router.push(backHref);
                router.refresh();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
              aria-label="이전 화면으로 이동"
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

            <div ref={dropdownRef} className="relative min-w-0">
              <button
                onClick={() => setDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-w-0"
              >
                <span className="font-semibold truncate">
                  {notebookData?.title || "학생 관리"}
                </span>
                <span className="text-xs text-gray-500 shrink-0">
                  ({students.length}명)
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${dropdownOpen ? "rotate-180" : ""}`}
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

              {dropdownOpen && notebookList.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  <div className="max-h-64 overflow-y-auto">
                    {notebookList.map((notebook) => {
                      const notebookId = notebook.id || notebook.notebook_id;
                      const nextBackHref = backHref.startsWith("/workspace/")
                        ? `/workspace/${notebookId}`
                        : backHref;
                      const notebookHref = `/dashboard/students?notebook=${notebookId}&from=${encodeURIComponent(nextBackHref)}`;
                      return (
                        <button
                          key={notebookId}
                          onClick={() => {
                            router.push(notebookHref);
                            setDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${
                            notebookId === currentNotebookId ? "bg-blue-50" : ""
                          }`}
                        >
                          <div className="font-medium text-gray-900 truncate">{notebook.title}</div>
                          <div className="text-xs text-gray-500">{notebook.student_count ?? 0}명</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              router.push("/dashboard/instructor");
              router.refresh();
            }}
            className="flex items-center gap-2"
            aria-label="강사 대시보드로 이동"
          >
            <StudyULogo size={28} />
            <span className="text-sm font-bold text-gray-800">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </button>
        </div>
      </header>

      {errorMsg ? (
        <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-6">
          <div className="text-center">
            <p className="text-base font-semibold text-gray-800">학생 목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-sm text-gray-500">{errorMsg}</p>
          </div>
        </div>
      ) : (
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">학생 관리</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    등록된 학생 목록을 확인하고 필요 시 삭제할 수 있습니다.
                  </p>
                </div>

                <div className="w-full sm:w-72">
                  <label htmlFor="student-search" className="sr-only">
                    학생 검색
                  </label>
                  <div className="relative">
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
                      id="student-search"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="이름 또는 이메일 검색"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <p className="text-sm text-gray-600">
                총 <span className="font-semibold text-gray-900">{students.length}</span>명의 학생이 등록되어 있습니다.
              </p>
            </div>

            {students.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-gray-500">
                아직 등록된 학생이 없습니다.
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-gray-500">
                검색 조건에 맞는 학생이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-white border-b border-gray-200">
                      <th className="px-6 py-3 text-left font-semibold text-gray-600">학생</th>
                      <th className="px-6 py-3 text-left font-semibold text-gray-600">이메일</th>
                      <th className="px-6 py-3 text-left font-semibold text-gray-600">등록일</th>
                      <th className="px-6 py-3 text-right font-semibold text-gray-600">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => {
                      const initial = getStudentLabel(student).charAt(0).toUpperCase();
                      const isDeleting = deletingStudentId === student.id;

                      return (
                        <tr key={student.enrollment_id} className="border-b border-gray-100 last:border-b-0">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {student.avatar_url ? (
                                <Image
                                  src={student.avatar_url}
                                  alt={getStudentLabel(student)}
                                  width={40}
                                  height={40}
                                  className="rounded-full w-10 h-10 object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold">
                                  {initial}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{getStudentLabel(student)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{student.email || "-"}</td>
                          <td className="px-6 py-4 text-gray-600">{formatDate(student.joined_at)}</td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => setConfirmStudentId(student.id)}
                              disabled={isDeleting}
                              className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {isDeleting ? "삭제 중..." : "삭제"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      )}

      {confirmStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmStudentId(null);
            }
          }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">학생 삭제</h2>
                <p className="text-sm text-gray-500">{getStudentLabel(confirmStudent)}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">이 학생을 현재 노트북의 목록에서 삭제하시겠어요?</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmStudentId(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={() => void handleDeleteStudent(confirmStudent.id)}
                disabled={deletingStudentId === confirmStudent.id}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deletingStudentId === confirmStudent.id ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
