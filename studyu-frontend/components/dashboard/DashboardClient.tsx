"use client";

import { useRouter } from "next/navigation";
import StudyULogo from "@/components/StudyULogo";
import InstructorDashboard from "./InstructorDashboard";
import StudentDashboard from "./StudentDashboard";
import UserMenu from "./UserMenu";

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

  // 역할별 노트북: 분리된 props 우선, 없으면 공통 notebooks 사용
  const instructorNbs = instructorNotebooks ?? notebooks ?? [];
  const studentNbs = studentNotebooks ?? notebooks ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          {/* 로고 */}
          <button
            type="button"
            onClick={() => router.push(`/dashboard/${role}`)}
            className="flex items-center gap-2"
            aria-label="대시보드 홈으로 이동"
          >
            <StudyULogo size={32} />
            <span className="font-bold text-lg">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </button>

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

            <UserMenu userName={userName} avatarUrl={avatarUrl} />
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
