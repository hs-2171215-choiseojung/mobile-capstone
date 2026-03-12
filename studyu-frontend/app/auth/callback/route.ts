// ============================================
// app/auth/callback/route.ts
// ============================================
// Google 로그인 후 Supabase가 이 URL로 리다이렉트함
// code를 받아서 세션으로 교환하는 역할
// ============================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // 로그인 성공 → 대시보드로 이동
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // 에러 발생 시 → 로그인 페이지로 (에러 메시지 포함)
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
