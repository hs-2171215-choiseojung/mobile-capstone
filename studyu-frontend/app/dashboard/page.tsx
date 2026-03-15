import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LogoutButton from '@/components/auth/LogoutButton'
import Image from 'next/image'
import CreateNotebookButton from '@/components/dashboard/CreateNotebookButton'
import NotebookList from '@/components/dashboard/NotebookList'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user || error) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: notebooks } = await supabase
    .from('notebooks')
    .select('*, documents(count)')
    .order('created_at', { ascending: false })

  const isFirstTime = !notebooks || notebooks.length === 0


  return (
    <div className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="border-b border-surface-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </div>

          {/* 사용자 메뉴 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {profile?.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt="프로필"
                  width={32}
                  height={32}
                  className="rounded-full w-8 h-8"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-semibold text-brand-600">
                  {(profile?.display_name || user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm text-surface-700 hidden sm:block">
                {profile?.display_name || user.email?.split('@')[0] || '사용자'}
              </span>
            </div>
            <div className="h-6 w-px bg-surface-200" />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* 첫 사용자 온보딩 */}
        {isFirstTime && (
          <section className="py-12 sm:py-16">
            <div className="text-center mb-12">
              <h1 className="text-4xl sm:text-5xl font-bold text-surface-900 mb-4">
                환영합니다! 👋
              </h1>
              <p className="text-xl text-surface-600 max-w-2xl mx-auto">
                첫 번째 노트북을 만들고 AI 학습을 시작해보세요
              </p>
            </div>

            {/* 온보딩 스텝 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {[
                {
                  step: '1️⃣',
                  title: '노트북 만들기',
                  desc: '"이산수학" 또는 "Python 프로젝트" 같이 목적별로 만들어요',
                },
                {
                  step: '2️⃣',
                  title: '자료 업로드',
                  desc: 'PDF 강의노트, 텍스트 파일 등을 한 노트북에 여러 개 올려요',
                },
                {
                  step: '3️⃣',
                  title: '공부 시작',
                  desc: '자료에 대해 질문하고 요약받고 퀴즈를 풀어요',
                },
              ].map((item, idx) => (
                <div key={idx} className="bg-surface-50 rounded-lg p-6 border border-surface-200">
                  <div className="text-3xl mb-3">{item.step}</div>
                  <h3 className="font-semibold text-surface-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-surface-600">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="flex justify-center mb-12">
              <CreateNotebookButton />
            </div>

            {/* FAQ */}
            <div className="bg-surface-50 rounded-lg p-8 border border-surface-200">
              <h2 className="text-lg font-semibold text-surface-900 mb-6">🤔 궁금한 점</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  {
                    q: '먼저 설정이 필요한가요?',
                    a: '아니요! 바로 노트북을 만들고 시작할 수 있습니다.',
                  },
                  {
                    q: '어떤 파일을 올릴 수 있나요?',
                    a: 'PDF, 텍스트 파일, Markdown, URL 등 다양한 형식을 지원합니다.',
                  },
                  {
                    q: '한 번에 몇 개까지 올릴 수 있나요?',
                    a: '제한 없이 여러 자료를 한 노트북에 업로드할 수 있어요.',
                  },
                  {
                    q: '자료는 어디에 저장되나요?',
                    a: '당신의 계정에 안전하게 암호화되어 저장됩니다.',
                  },
                ].map((item, idx) => (
                  <div key={idx}>
                    <h3 className="font-medium text-surface-900 mb-2">{item.q}</h3>
                    <p className="text-sm text-surface-600">{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 기존 노트북이 있을 때 */}
        {!isFirstTime && (
          <section className="py-8 space-y-8">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-surface-900 mb-2">
                안녕하세요, {profile?.display_name || user.email?.split('@')[0]}님 👋
              </h1>
              <p className="text-surface-600">
                계속 공부하거나 새로운 노트북을 만들어보세요
              </p>
            </div>

            {/* 최근 본 노트북 (상위 3개) */}
            {notebooks && notebooks.length > 0 && (
              <div className="bg-white rounded-lg border border-surface-200 p-6">
                <h2 className="text-lg font-semibold text-surface-900 mb-4">
                  ⭐ 자주 쓰는 노트북
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {notebooks.slice(0, 3).map((nb) => (
                    <a
                      key={nb.id}
                      href={`/workspace/${nb.id}`}
                      className="p-4 bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-200 rounded-lg hover:shadow-md hover:border-brand-300 transition-all cursor-pointer"
                    >
                      <h3 className="font-semibold text-brand-900 truncate">{nb.title}</h3>
                      <p className="text-xs text-brand-700 mt-2">
                        바로 열기 →
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* 모든 노트북 섹션 */}
            <div className="bg-white rounded-lg border border-surface-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-surface-900">
                  📚 내 노트북 ({notebooks?.length || 0}개)
                </h2>
                <CreateNotebookButton />
              </div>

              <NotebookList notebooks={notebooks} />
            </div>
          </section>
        )}

        {/* 노트북 없을 때만 표시 */}
        {!isFirstTime && notebooks && notebooks.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📚</span>
            </div>
            <p className="text-surface-600 mb-4">아직 노트북이 없습니다</p>
            <CreateNotebookButton />
          </div>
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-surface-100 py-6 text-center text-sm text-surface-500 mt-12">
        STUDY:U · 기업연계 캡스톤
      </footer>
    </div>
  )
}
