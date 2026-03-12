import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  // 이미 로그인한 사용자는 바로 대시보드로
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* 헤더 */}
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="font-bold text-lg tracking-tight">
            STUDY<span className="text-brand-600">:U</span>
          </span>
        </div>
        <Link
          href="/login"
          className="px-4 py-2 text-sm font-medium text-brand-700 hover:text-brand-800 
                     bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
        >
          로그인
        </Link>
      </header>

      {/* 히어로 */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          {/* 뱃지 */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 mb-6
                          bg-brand-50 border border-brand-200 rounded-full text-xs font-medium text-brand-700">
            <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse" />
            기업연계 캡스톤 프로젝트
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-surface-900 mb-4 leading-tight">
            학습 자료를 업로드하면,<br />
            <span className="bg-clip-text text-transparent"
                  style={{ backgroundImage: 'var(--brand-gradient)' }}>
              AI가 학습을 코치합니다
            </span>
          </h1>

          <p className="text-lg text-surface-600 mb-8 max-w-lg mx-auto leading-relaxed">
            PDF, 강의노트를 올리면 즉시 질의응답, 요약, 퀴즈를 생성합니다.
            문서에 근거한 정확한 답변으로 효율적인 학습을 도와드립니다.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white 
                         rounded-xl font-semibold text-sm transition-colors
                         shadow-lg shadow-brand-600/25"
            >
              Google로 시작하기
            </Link>
            <span className="text-sm text-surface-500">
              무료로 사용할 수 있어요
            </span>
          </div>

          {/* 기능 태그들 */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-12">
            {['RAG 질의응답', '자료 요약', '퀴즈 생성', '학습 계획', '멀티 LLM'].map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 bg-white border border-surface-200 rounded-lg 
                           text-xs font-medium text-surface-600 shadow-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="px-6 py-4 text-center text-xs text-surface-400">
        STUDY:U · ㈜에브리아이 기업연계 캡스톤
      </footer>
    </div>
  )
}
