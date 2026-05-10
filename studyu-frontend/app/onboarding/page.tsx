'use client'

// ============================================
// app/onboarding/page.tsx
// ============================================
// 사용자 역할 선택 페이지
// 회원가입 또는 Google 로그인 후 처음으로 방문하는 페이지
// ============================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import StudyULogo from '@/components/StudyULogo'

type UserRole = 'instructor' | 'student'

export default function OnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)

  const handleRoleSelect = async (role: UserRole) => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // 사용자 메타데이터에 역할 저장
      const { error } = await supabase.auth.updateUser({
        data: {
          role,
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        // 역할 저장 성공 → 대시보드로 이동
        router.push('/dashboard')
      }
    } catch (err) {
      setError('역할 선택 중 오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
      <div className="w-full max-w-2xl">
        {/* 헤더 */}
        <div className="text-center mb-12">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <StudyULogo size={40} />
            <span className="font-bold text-xl tracking-tight">
              STUDY<span className="text-brand-600">:U</span>
            </span>
          </Link>
          <h1 className="text-2xl font-bold text-surface-900 mb-3">
            어떤 역할로 시작할까요?
          </h1>
          <p className="text-sm text-surface-600">
            나중에 설정에서 변경할 수 있습니다
          </p>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 역할 선택 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* 교수자 카드 */}
          <button
            onClick={() => setSelectedRole('instructor')}
            disabled={loading}
            className={`group relative p-8 rounded-2xl border-2 transition-all duration-200 ${
              selectedRole === 'instructor'
                ? 'border-brand-500 bg-brand-50'
                : 'border-surface-200 bg-white hover:border-brand-300 hover:shadow-md'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {/* 선택 인디케이터 */}
            {selectedRole === 'instructor' && (
              <div className="absolute top-4 right-4 w-6 h-6 bg-brand-500 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}

            <div className="text-left">
              {/* 아이콘 */}
              <div className="w-12 h-12 rounded-lg bg-brand-100 flex items-center justify-center mb-4 group-hover:bg-brand-200 transition-colors">
                <svg className="w-6 h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>

              {/* 텍스트 */}
              <h3 className="text-lg font-bold text-surface-900 mb-2">
                교수자
              </h3>
              <p className="text-sm text-surface-600 leading-relaxed">
                교수, 강사 또는 교육 기관 관리자로서 학생들을 관리하고 교육 자료를 배포할 수 있습니다
              </p>
            </div>
          </button>

          {/* 학생 카드 */}
          <button
            onClick={() => setSelectedRole('student')}
            disabled={loading}
            className={`group relative p-8 rounded-2xl border-2 transition-all duration-200 ${
              selectedRole === 'student'
                ? 'border-brand-500 bg-brand-50'
                : 'border-surface-200 bg-white hover:border-brand-300 hover:shadow-md'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {/* 선택 인디케이터 */}
            {selectedRole === 'student' && (
              <div className="absolute top-4 right-4 w-6 h-6 bg-brand-500 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}

            <div className="text-left">
              {/* 아이콘 */}
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center mb-4 group-hover:bg-green-200 transition-colors">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C6.5 6.253 2 10.998 2 17.001c0 5.591 3.824 10.29 9 11.622m0-13c5.5 0 10-4.745 10-10.999C22 11.758 18.5 7.298 12 5.674m0 13.75V5" />
                </svg>
              </div>

              {/* 텍스트 */}
              <h3 className="text-lg font-bold text-surface-900 mb-2">
                학생
              </h3>
              <p className="text-sm text-surface-600 leading-relaxed">
                교육을 받으며 학습 자료를 분석하고 AI 코치의 도움을 받을 수 있습니다
              </p>
            </div>
          </button>
        </div>

        {/* 계속하기 버튼 */}
        <button
          onClick={() => {
            if (selectedRole) {
              handleRoleSelect(selectedRole)
            }
          }}
          disabled={loading || !selectedRole}
          className="w-full px-4 py-3 bg-brand-600 text-white rounded-lg font-medium
                     hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all duration-200"
        >
          {loading ? '저장 중...' : '계속하기'}
        </button>

        {/* 안내 */}
        <div className="mt-8 pt-8 border-t border-surface-200">
          <p className="text-center text-xs text-surface-500 mb-4">
            역할을 선택하고 시작하세요
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>역할은 나중에 설정에서 언제든 변경할 수 있습니다</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>선택한 역할에 맞는 맞춤 기능을 제공합니다</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <span className="text-brand-500 mt-0.5">✓</span>
              <span>모든 기본 기능은 두 역할 모두 사용할 수 있습니다</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
