// ============================================
// middleware.ts (프로젝트 루트)
// ============================================
// 모든 요청에서 Supabase 세션(쿠키)을 갱신하는 미들웨어
// 이게 없으면 로그인 세션이 만료되어도 갱신되지 않음
// ============================================

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string; options?: Record<string, unknown> }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: Record<string, unknown> }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
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
