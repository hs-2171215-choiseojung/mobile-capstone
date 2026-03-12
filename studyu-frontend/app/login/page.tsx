'use client'

// ============================================
// app/login/page.tsx
// ============================================
// Google 로그인 페이지
// "Google로 계속하기" 버튼을 누르면 → Google 로그인 팝업 → 
// 성공 시 /auth/callback → /dashboard로 이동
// ============================================

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Google 로그인 성공 후 돌아올 URL
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      }
      // 성공하면 Google 로그인 페이지로 리다이렉트되므로
      // 여기서 setLoading(false)를 할 필요 없음
    } catch (err) {
      setError('로그인 중 오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="font-bold text-xl tracking-tight">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </Link>
          <p className="mt-3 text-sm text-surface-500">
            학습 자료 기반 AI 코치에 로그인하세요
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Google 로그인 버튼 */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 
                       px-4 py-3 bg-white border-2 border-surface-200 
                       rounded-xl font-medium text-sm text-surface-700
                       hover:border-surface-300 hover:bg-surface-50
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
          >
            {loading ? (
              // 로딩 스피너
              <svg className="animate-spin h-5 w-5 text-surface-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              // Google 아이콘
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            {loading ? '로그인 중...' : 'Google로 계속하기'}
          </button>

          {/* 구분선 */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white text-xs text-surface-400">
                안내사항
              </span>
            </div>
          </div>

          {/* 안내 */}
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>Google 계정으로 간편하게 시작할 수 있습니다</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>업로드한 자료는 본인만 접근할 수 있습니다</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>AI 응답에는 오류 가능성이 있을 수 있습니다</span>
            </div>
          </div>
        </div>

        {/* 홈으로 */}
        <p className="mt-6 text-center text-xs text-surface-400">
          <Link href="/" className="hover:text-surface-600 transition-colors">
            ← 홈으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  )
}
