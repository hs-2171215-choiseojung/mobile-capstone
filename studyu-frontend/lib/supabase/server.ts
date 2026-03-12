// ============================================
// lib/supabase/server.ts
// ============================================
// 서버(서버 컴포넌트, API Route, 미들웨어)에서 사용하는 Supabase 클라이언트
// 쿠키를 통해 사용자 세션을 관리
// ============================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서 호출 시 setAll이 실패할 수 있음
            // 미들웨어에서 세션을 갱신하므로 무시해도 됨
          }
        },
      },
    }
  )
}
