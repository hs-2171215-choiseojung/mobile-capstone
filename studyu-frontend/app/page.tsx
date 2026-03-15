import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 헤더 */}
      <header className="border-b border-surface-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg text-surface-900">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
          >
            로그인
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {/* 히어로 섹션 */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <h1 className="text-5xl sm:text-6xl font-bold text-surface-900 mb-6 leading-tight">
            학습 자료로<br />
            <span className="text-brand-600">AI 과외를 받으세요</span>
          </h1>

          <p className="text-xl text-surface-600 mb-4 max-w-2xl mx-auto leading-relaxed">
            PDF나 강의노트를 올리면 AI가 질문에 답하고, 요약하고, 퀴즈를 만들어줍니다.
          </p>

          <p className="text-lg text-surface-500 mb-12 max-w-2xl mx-auto">
            복잡한 설정 없이 바로 시작할 수 있습니다.
          </p>

          <Link
            href="/login"
            className="inline-block px-8 py-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl hover:scale-105 duration-200"
          >
            지금 시작하기
          </Link>

          <p className="text-sm text-surface-500 mt-4">
            Google 계정으로 무료 사용 가능
          </p>
        </section>

        {/* 기능 설명 */}
        <section className="bg-surface-50 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-surface-900 text-center mb-12">
              이런 일들을 할 수 있어요
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[
                { icon: '💬', title: '질문하기', desc: '자료에 대해 궁금한 것을 물어보세요' },
                { icon: '📝', title: '요약받기', desc: '긴 자료의 핵심을 짧게 요약해드려요' },
                { icon: '❓', title: '퀴즈 풀기', desc: '자료로 만든 문제를 풀며 이해도를 확인해요' },
                { icon: '📚', title: '계획 세우기', desc: '공부 기간을 정하면 학습 계획을 만들어요' },
              ].map((item, idx) => (
                <div key={idx} className="bg-white rounded-lg p-6 border border-surface-200">
                  <div className="text-4xl mb-3">{item.icon}</div>
                  <h3 className="text-lg font-semibold text-surface-900 mb-2">{item.title}</h3>
                  <p className="text-surface-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 시작 방법 */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <h2 className="text-3xl sm:text-4xl font-bold text-surface-900 text-center mb-12">
            3단계로 시작하기
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { num: '1', title: '로그인', desc: 'Google 계정으로 들어가요' },
              { num: '2', title: '자료 올리기', desc: 'PDF나 텍스트를 업로드해요' },
              { num: '3', title: '공부하기', desc: '질문하고 요약받고 퀴즈 풀어요' },
            ].map((step, idx) => (
              <div key={idx} className="text-center">
                <div className="w-12 h-12 rounded-full bg-brand-600 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">
                  {step.num}
                </div>
                <h3 className="text-lg font-semibold text-surface-900 mb-2">{step.title}</h3>
                <p className="text-surface-600 text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-surface-50 py-16 sm:py-24">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-surface-900 text-center mb-12">
              자주 묻는 질문
            </h2>

            <div className="space-y-4">
              {[
                { q: '정말 무료인가요?', a: '네! 무료로 모든 기능을 사용할 수 있습니다.' },
                { q: '내 자료는 안전한가요?', a: '당신의 자료는 암호화되어 저장되며, 본인만 볼 수 있습니다.' },
                { q: 'AI 답변이 항상 맞나요?', a: '자료를 기반으로 답변하지만, 오류가 있을 수 있으니 확인해주세요.' },
              ].map((item, idx) => (
                <details key={idx} className="border border-surface-200 rounded-lg">
                  <summary className="px-6 py-4 cursor-pointer font-semibold text-surface-900 hover:bg-surface-100 transition-colors">
                    {item.q}
                  </summary>
                  <div className="px-6 py-4 bg-surface-100 border-t border-surface-200 text-surface-600">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 마지막 CTA */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <div className="bg-brand-600 rounded-2xl p-12 text-white">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              지금 시작하세요
            </h2>
            <p className="text-lg text-brand-100 mb-8 max-w-xl mx-auto">
              로그인하고 첫 번째 자료를 올려보세요
            </p>
            <Link
              href="/login"
              className="inline-block px-8 py-3 bg-white text-brand-600 font-semibold rounded-lg hover:bg-brand-50 transition-colors"
            >
              무료로 시작하기
            </Link>
          </div>
        </section>
      </main>

      {/* 푸터 */}
      <footer className="border-t border-surface-100 py-6 text-center text-sm text-surface-500 mt-auto">
        STUDY:U · ㈜에브리아이 기업연계 캡스톤
      </footer>
    </div>
  )
}
