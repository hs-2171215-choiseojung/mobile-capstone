// ============================================
// app/dashboard/page.tsx
// ============================================
// 로그인 후 보이는 대시보드 페이지
// 사용자 정보 표시 + 로그아웃 기능
// 나중에 노트북 목록, 자료 업로드 등이 추가될 곳
// ============================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LogoutButton from '@/components/auth/LogoutButton'
import Image from 'next/image'

export default async function DashboardPage() {
  const supabase = await createClient()

  // 현재 로그인한 사용자 정보 가져오기
  const { data: { user }, error } = await supabase.auth.getUser()

  // 로그인 안 되어 있으면 → 로그인 페이지로
  if (!user || error) {
    redirect('/login')
  }

  // public.users 테이블에서 프로필 정보 가져오기
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  // 노트북 목록 가져오기 (RLS에 의해 본인 것만)
  const { data: notebooks } = await supabase
    .from('notebooks')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-surface-50">
      {/* 상단 바 */}
      <header className="bg-white border-b border-surface-200 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          {/* 로고 */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg tracking-tight">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </div>

          {/* 사용자 정보 + 로그아웃 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {profile?.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt="프로필"
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center">
                  <span className="text-brand-600 font-medium text-sm">
                    {(profile?.display_name || user.email || '?')[0].toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-sm font-medium text-surface-700 hidden sm:block">
                {profile?.display_name || user.email}
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 환영 메시지 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-surface-900">
            안녕하세요, {profile?.display_name || '학습자'}님 👋
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            학습 자료를 업로드하고 AI와 함께 공부를 시작하세요
          </p>
        </div>

        {/* 로그인 성공 확인 카드 */}
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-surface-900">Google 로그인 성공!</h2>
              <p className="text-sm text-surface-500">Supabase Auth 연동이 정상적으로 동작하고 있습니다</p>
            </div>
          </div>

          {/* 디버그 정보 (개발 중에만 표시) */}
          <details className="mt-4">
            <summary className="text-xs text-surface-400 cursor-pointer hover:text-surface-600">
              개발자 정보 보기 (디버그용)
            </summary>
            <div className="mt-3 p-4 bg-surface-50 rounded-xl font-mono text-xs space-y-2">
              <div><span className="text-surface-400">User ID:</span> <span className="text-surface-700">{user.id}</span></div>
              <div><span className="text-surface-400">Email:</span> <span className="text-surface-700">{user.email}</span></div>
              <div><span className="text-surface-400">Provider:</span> <span className="text-surface-700">{user.app_metadata?.provider}</span></div>
              <div><span className="text-surface-400">Display Name:</span> <span className="text-surface-700">{profile?.display_name || '(없음)'}</span></div>
              <div><span className="text-surface-400">Avatar URL:</span> <span className="text-surface-700 break-all">{profile?.avatar_url || '(없음)'}</span></div>
              <div><span className="text-surface-400">public.users 존재:</span> <span className="text-surface-700">{profile ? '✅ Yes' : '❌ No (트리거 확인 필요)'}</span></div>
              <div><span className="text-surface-400">노트북 수:</span> <span className="text-surface-700">{notebooks?.length ?? 0}개</span></div>
            </div>
          </details>
        </div>

        {/* 노트북 목록 (아직 비어있을 것) */}
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
          <h2 className="font-semibold text-surface-900 mb-4">내 노트북</h2>

          {notebooks && notebooks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {notebooks.map((nb) => (
                <div
                  key={nb.id}
                  className="p-4 border border-surface-200 rounded-xl hover:border-brand-300 
                             hover:shadow-sm transition-all cursor-pointer"
                >
                  <h3 className="font-medium text-surface-900">{nb.title}</h3>
                  {nb.description && (
                    <p className="mt-1 text-xs text-surface-500">{nb.description}</p>
                  )}
                  <p className="mt-2 text-xs text-surface-400">
                    {new Date(nb.created_at).toLocaleDateString('ko-KR')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <p className="text-sm text-surface-500 mb-1">아직 노트북이 없습니다</p>
              <p className="text-xs text-surface-400">
                노트북을 만들고 학습 자료를 업로드해보세요
              </p>
              <p className="text-xs text-surface-400 mt-4 bg-surface-50 inline-block px-3 py-1.5 rounded-lg">
                🛠 노트북 생성 기능은 2주차에 구현 예정
              </p>
            </div>
          )}
        </div>

        {/* 1주차 체크리스트 */}
        <div className="mt-6 bg-brand-50 border border-brand-200 rounded-2xl p-6">
          <h2 className="font-semibold text-brand-900 mb-3">✅ 1주차 세팅 체크리스트</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-brand-700">
              <span>☑️</span> <span>Supabase 프로젝트 생성</span>
            </div>
            <div className="flex items-center gap-2 text-brand-700">
              <span>☑️</span> <span>DB 스키마 (migration SQL) 실행</span>
            </div>
            <div className="flex items-center gap-2 text-brand-700">
              <span>☑️</span> <span>Google OAuth 설정</span>
            </div>
            <div className="flex items-center gap-2 text-brand-700">
              <span>☑️</span> <span>Next.js 프로젝트 세팅</span>
            </div>
            <div className="flex items-center gap-2 text-brand-700">
              <span>{profile ? '☑️' : '⬜'}</span>
              <span>Google 로그인 → public.users 자동 생성 확인 {profile ? '← 지금 이것!' : ''}</span>
            </div>
            <div className="flex items-center gap-2 text-surface-400">
              <span>⬜</span> <span>FastAPI 프로젝트 세팅 (다음 단계)</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
