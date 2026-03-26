"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import LogoutButton from "@/components/auth/LogoutButton";
import InstructorDashboard from "./InstructorDashboard";
import StudentDashboard from "./StudentDashboard";

type Role = "instructor" | "student";

interface Notebook {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  documents?: { count: number }[];
}

interface Props {
  role: Role;
  instructorNotebooks?: Notebook[];
  studentNotebooks?: Notebook[];
  enrolledNotebooks?: Notebook[];
  notebooks?: Notebook[];
  userName: string;
  avatarUrl?: string;
}

export default function DashboardClient({ role, instructorNotebooks, studentNotebooks, enrolledNotebooks, notebooks, userName, avatarUrl }: Props) {
  const router = useRouter();
  const initial = userName[0]?.toUpperCase() || "U";

  // 역할별 노트북: 분리된 props 우선, 없으면 공통 notebooks 사용
  const instructorNbs = instructorNotebooks ?? notebooks ?? [];
  const studentNbs = studentNotebooks ?? notebooks ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </div>

          {/* 우측 메뉴 */}
          <div className="flex items-center gap-4">
            {/* 이전 버튼 */}
            <button
              onClick={() => router.push("/role-select")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              이전
            </button>

            {/* 사용자 정보 */}
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="프로필" width={32} height={32} className="rounded-full w-8 h-8" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-xs font-semibold text-pink-600">
                  {initial}
                </div>
              )}
              <span className="text-sm text-gray-700 hidden sm:block">{userName}</span>
            </div>

            <div className="h-5 w-px bg-gray-200" />
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* 대시보드 본문 */}
      {role === "instructor" ? (
        <InstructorDashboard notebooks={instructorNbs} userName={userName} />
      ) : (
        <StudentDashboard notebooks={studentNbs} enrolledNotebooks={enrolledNotebooks ?? []} userName={userName} />
      )}

      {/* 푸터 */}
      <footer className="border-t border-gray-100 py-6 text-center text-sm text-gray-400 mt-8">
        STUDY:U · 기업연계 캡스톤
      </footer>
    </div>
  );
}
