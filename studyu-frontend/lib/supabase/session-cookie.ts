// ============================================
// lib/supabase/session-cookie.ts
// ============================================
// Firebase Hosting은 Cloud Run rewrite로 요청을 넘길 때 `__session`
// 쿠키 하나만 통과시키고 나머지는 모두 제거함.
// (https://firebase.google.com/docs/hosting/manage-cache#using_cookies)
//
// Supabase auth가 내부적으로 사용하는 여러 쿠키(sb-*-auth-token,
// code-verifier 등)를 JSON으로 묶어 `__session` 단일 쿠키에 저장하고,
// 읽을 때 다시 펼쳐서 개별 쿠키처럼 반환하는 어댑터.
// ============================================

export const SESSION_COOKIE_NAME = '__session'

export type CookieEntry = { name: string; value: string }

export type CookieToSet = {
  name: string
  value: string
  options?: {
    maxAge?: number
    expires?: Date | string
    [key: string]: unknown
  }
}

export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
  httpOnly: false,
  maxAge: 60 * 60 * 24 * 365,
}

export function decodeSession(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(decodeURIComponent(raw)) as Record<string, string>
  } catch {
    return {}
  }
}

export function encodeSession(map: Record<string, string>): string {
  return encodeURIComponent(JSON.stringify(map))
}

function isDeletion(value: string, options?: CookieToSet['options']): boolean {
  if (value === '') return true
  if (!options) return false
  if (options.maxAge !== undefined && Number(options.maxAge) <= 0) return true
  if (options.expires) {
    const t =
      options.expires instanceof Date
        ? options.expires.getTime()
        : new Date(options.expires as string).getTime()
    if (!Number.isNaN(t) && t <= Date.now()) return true
  }
  return false
}

export function applyUpdates(
  current: Record<string, string>,
  updates: CookieToSet[]
): Record<string, string> {
  const next = { ...current }
  for (const { name, value, options } of updates) {
    if (isDeletion(value, options)) {
      delete next[name]
    } else {
      next[name] = value
    }
  }
  return next
}

export function mapToEntries(map: Record<string, string>): CookieEntry[] {
  return Object.entries(map).map(([name, value]) => ({ name, value }))
}
