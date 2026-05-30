import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import StudyULogo from '@/components/StudyULogo'

export default async function RoleSelectPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) redirect('/login')

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-lg">
        {/* 로고 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <StudyULogo size={36} />
            <span className="font-bold text-xl">STUDY<span className="text-blue-600">:U</span></span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">어떤 화면으로 이동할까요?</h1>
          <p className="text-sm text-gray-500">역할을 선택해주세요</p>
        </div>

        {/* 역할 카드 */}
        <div className="grid grid-cols-2 gap-5 mb-6">
          <Link
            href="/dashboard/instructor"
            className="group p-8 rounded-2xl border-2 border-gray-200 bg-white hover:border-blue-400 hover:shadow-md transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">강사</h3>
            <p className="text-sm text-gray-500">노트북 생성 및 학생 관리</p>
          </Link>

          <Link
            href="/dashboard/student"
            className="group p-8 rounded-2xl border-2 border-gray-200 bg-white hover:border-green-400 hover:shadow-md transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-4 group-hover:bg-green-200 transition-colors">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">학생</h3>
            <p className="text-sm text-gray-500">학습 자료 탐색 및 AI 코치</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
