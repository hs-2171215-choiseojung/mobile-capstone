'use client'

// ============================================
// app/signup/page.tsx
// ============================================
// 이메일/비밀번호 회원가입 페이지
// ============================================

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import StudyULogo from '@/components/StudyULogo'

export default function SignupPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!email || !password || !confirmPassword) {
      setError('이메일과 비밀번호를 입력해주세요.')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      console.log('Supabase 클라이언트:', supabase)
      console.log('회원가입 시도:', { email })

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: nickname || email.split('@')[0],
          },
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        setSuccess(true)
        setEmail('')
        setPassword('')
        setConfirmPassword('')
        setNickname('')
      }
    } catch (err) {
      console.error('회원가입 예외:', err)
      setError('회원가입 중 오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-1">
            <StudyULogo size={56} />
            <span className="font-bold text-2xl tracking-tight">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </Link>
          <p className="mt-3 text-sm text-surface-500">
            새로운 계정을 만들어보세요
          </p>
        </div>

        {/* 회원가입 카드 */}
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
          {/* 성공 메시지 */}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700 font-medium">가입 완료!</p>
              <p className="text-xs text-green-600 mt-1">
                이메일을 확인하여 계정을 인증해주세요.
              </p>
            </div>
          )}

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* 회원가입 폼 */}
          {!success ? (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-surface-700 mb-2">
                  이메일 <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="example@email.com"
                  required
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                             disabled:bg-surface-50 disabled:cursor-not-allowed
                             transition-all duration-200"
                />
              </div>

              <div>
                <label htmlFor="nickname" className="block text-xs font-medium text-surface-700 mb-2">
                  닉네임 (선택)
                </label>
                <input
                  id="nickname"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  disabled={loading}
                  placeholder="홍길동"
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                             disabled:bg-surface-50 disabled:cursor-not-allowed
                             transition-all duration-200"
                />
                <p className="mt-1 text-xs text-surface-400">입력하지 않으면 이메일 앞부분이 닉네임이 됩니다</p>
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-medium text-surface-700 mb-2">
                  비밀번호 <span className="text-red-500">*</span>
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                             disabled:bg-surface-50 disabled:cursor-not-allowed
                             transition-all duration-200"
                />
                <p className="mt-1 text-xs text-surface-400">최소 6자 이상</p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-medium text-surface-700 mb-2">
                  비밀번호 확인 <span className="text-red-500">*</span>
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                             disabled:bg-surface-50 disabled:cursor-not-allowed
                             transition-all duration-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-brand-600 text-white rounded-lg font-medium text-sm
                           hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-200"
              >
                {loading ? '가입 중...' : '회원가입'}
              </button>
            </form>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-surface-600 mb-4">
                이메일 인증 후 로그인할 수 있습니다.
              </p>
            </div>
          )}

          {/* 로그인 링크 */}
          {!success && (
            <p className="mt-4 text-center text-sm text-surface-600">
              이미 계정이 있으신가요?{' '}
              <Link href="/login" className="text-brand-600 font-medium hover:text-brand-700 transition-colors">
                로그인
              </Link>
            </p>
          )}

          {success && (
            <p className="mt-4 text-center text-sm text-surface-600">
              <Link href="/" className="text-brand-600 font-medium hover:text-brand-700 transition-colors">
                홈으로 돌아가기
              </Link>
            </p>
          )}

          {/* 안내 */}
          {!success && (
            <div className="mt-6 pt-6 border-t border-surface-200 space-y-2">
              <div className="flex items-start gap-2 text-xs text-surface-500">
                <span className="text-brand-500 mt-0.5">✓</span>
                <span>안전한 비밀번호를 사용해주세요</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-surface-500">
                <span className="text-brand-500 mt-0.5">✓</span>
                <span>가입 후 이메일 인증이 필요합니다</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-surface-500">
                <span className="text-brand-500 mt-0.5">✓</span>
                <span>업로드한 자료는 본인만 접근할 수 있습니다</span>
              </div>
            </div>
          )}
        </div>

        {/* 홈으로 */}
        {!success && (
          <p className="mt-6 text-center text-xs text-surface-400">
            <Link href="/" className="hover:text-surface-600 transition-colors">
              ← 홈으로 돌아가기
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
