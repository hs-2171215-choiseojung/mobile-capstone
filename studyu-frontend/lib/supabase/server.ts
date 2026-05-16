// ============================================
// lib/supabase/server.ts
// ============================================
// 서버(서버 컴포넌트, API Route, 미들웨어)에서 사용하는 Supabase 클라이언트
// 쿠키를 통해 사용자 세션을 관리
//
// Firebase Hosting의 쿠키 strip 정책을 우회하기 위해 모든 Supabase 쿠키를
// `__session` 단일 쿠키에 다중화해서 저장한다. (./session-cookie 참조)
// ============================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  applyUpdates,
  decodeSession,
  encodeSession,
  mapToEntries,
  type CookieToSet,
} from './session-cookie'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return mapToEntries(decodeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value))
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            const current = decodeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value)
            const next = applyUpdates(current, cookiesToSet)
            cookieStore.set(SESSION_COOKIE_NAME, encodeSession(next), SESSION_COOKIE_OPTIONS)
          } catch {
            // Server Component에서 호출 시 setAll이 실패할 수 있음
            // 미들웨어에서 세션을 갱신하므로 무시해도 됨
          }
        },
      },
    }
  )
}
