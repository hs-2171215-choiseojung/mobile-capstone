"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState } from "react";
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

interface Props {
  notebookData: NotebookData | null;
  errorMsg: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function StudentsPageClient({ notebookData, errorMsg }: Props) {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>(notebookData?.students ?? []);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const notebookId = notebookData?.notebook_id;

  async function handleRemove(studentId: string) {
    if (!notebookId) return;
    setRemovingId(studentId);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const res = await fetch(
        `${API_BASE}/api/notebooks/${notebookId}/students/${studentId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok || res.status === 204) {
        setStudents((prev) => prev.filter((s) => s.id !== studentId));
      }
    } finally {
      setRemovingId(null);
      setConfirmId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </div>
          <button
            onClick={() => router.push("/dashboard/instructor")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
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
            이전
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMsg ? (
          <div className="text-center py-20 text-red-500">{errorMsg}</div>
        ) : !notebookData ? (
          <div className="text-center py-20 text-gray-400">
            노트북 정보를 찾을 수 없습니다.
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">
                {notebookData.title}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                참여 중인 학생 {students.length}명
              </p>
            </div>

            {students.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
                <p className="text-gray-400 text-sm">
                  아직 참여한 학생이 없습니다.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">
                        학생
                      </th>
                      <th className="text-left px-6 py-3 text-gray-500 font-medium hidden sm:table-cell">
                        이메일
                      </th>
                      <th className="text-left px-6 py-3 text-gray-500 font-medium">
                        참여일
                      </th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student, idx) => {
                      const initial =
                        (student.display_name || student.email || "?")[0].toUpperCase();
                      const isConfirming = confirmId === student.id;
                      const isRemoving = removingId === student.id;

                      return (
                        <tr
                          key={student.enrollment_id}
                          className={`border-b border-gray-50 last:border-0 ${
                            idx % 2 === 0 ? "" : "bg-gray-50/50"
                          }`}
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
                              <span className="font-medium text-gray-900">
                                {student.display_name || "이름 없음"}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">
                            {student.email || "-"}
                          </td>
                          <td className="px-6 py-4 text-gray-500">
                            {formatDate(student.joined_at)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {isConfirming ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-gray-500">내보낼까요?</span>
                                <button
                                  onClick={() => handleRemove(student.id)}
                                  disabled={isRemoving}
                                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                >
                                  {isRemoving ? "..." : "확인"}
                                </button>
                                <button
                                  onClick={() => setConfirmId(null)}
                                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmId(student.id)}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                              >
                                내보내기
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
