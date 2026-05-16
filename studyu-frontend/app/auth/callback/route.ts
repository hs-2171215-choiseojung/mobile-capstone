// ============================================
// app/auth/callback/route.ts
// ============================================
// Google 로그인 후 Supabase가 이 URL로 리다이렉트함
// code를 받아서 세션으로 교환하는 역할
// ============================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // 로그인 성공 → 사용자 역할 확인
      const { data: { user } } = await supabase.auth.getUser()

      if (user?.user_metadata?.role) {
        // 역할이 있으면 → 대시보드로 이동
        return NextResponse.redirect(`${origin}${next}`)
      } else {
        // 역할이 없으면 → 온보딩으로 이동
        return NextResponse.redirect(`${origin}/onboarding`)
      }
    }
  // 잠깐 테스트 추가(서정)
    console.error('exchangeCodeForSession 실패:', error.message, error)
  }

  console.error('code 없음 또는 세션 교환 실패, origin:', origin)
  // 에러 발생 시 → 로그인 페이지로 (에러 메시지 포함)
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
