// ============================================
// middleware.ts (프로젝트 루트)
// ============================================
// 모든 요청에서 Supabase 세션(쿠키)을 갱신하는 미들웨어
// 이게 없으면 로그인 세션이 만료되어도 갱신되지 않음
//
// Firebase Hosting의 쿠키 strip 정책을 우회하기 위해 모든 Supabase 쿠키를
// `__session` 단일 쿠키에 다중화해서 저장한다. (./lib/supabase/session-cookie 참조)
// ============================================

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  applyUpdates,
  decodeSession,
  encodeSession,
  mapToEntries,
  type CookieToSet,
} from './lib/supabase/session-cookie'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return mapToEntries(decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value))
        },
        setAll(cookiesToSet: CookieToSet[]) {
          const current = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value)
          const next = applyUpdates(current, cookiesToSet)
          const encoded = encodeSession(next)

          request.cookies.set(SESSION_COOKIE_NAME, encoded)
          supabaseResponse = NextResponse.next({
            request,
          })
          supabaseResponse.cookies.set(
            SESSION_COOKIE_NAME,
            encoded,
            SESSION_COOKIE_OPTIONS as Parameters<typeof supabaseResponse.cookies.set>[2]
          )
        },
      },
    }
  )

  // 세션 갱신 (중요! 이 줄이 없으면 세션이 만료됨)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 로그인 안 한 사용자가 보호된 페이지에 접근하면 → 로그인 페이지로
  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/signup') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    request.nextUrl.pathname !== '/'
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 이미 로그인한 사용자가 /login이나 /signup에 접근하면 → 온보딩 또는 대시보드로
  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/signup'))) {
    const url = request.nextUrl.clone()
    // 역할이 없으면 온보딩으로, 있으면 대시보드로
    url.pathname = user.user_metadata?.role ? '/dashboard' : '/onboarding'
    return NextResponse.redirect(url)
  }

  // 역할이 없는 사용자가 /onboarding이 아닌 다른 페이지에 접근하면 → 온보딩으로
  if (user && !user.user_metadata?.role && request.nextUrl.pathname !== '/onboarding') {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

// 미들웨어가 동작할 경로 설정
export const config = {
  matcher: [
    // 정적 파일과 이미지는 제외
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
