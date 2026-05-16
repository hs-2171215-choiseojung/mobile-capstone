// ============================================
// lib/supabase/client.ts
// ============================================
// 브라우저(클라이언트 컴포넌트)에서 사용하는 Supabase 클라이언트
// 'use client' 컴포넌트에서 import해서 사용
//
// Firebase Hosting의 쿠키 strip 정책을 우회하기 위해 모든 Supabase 쿠키를
// `__session` 단일 쿠키에 다중화해서 저장한다. (./session-cookie 참조)
// ============================================

import { createBrowserClient } from '@supabase/ssr'
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  applyUpdates,
  decodeSession,
  encodeSession,
  mapToEntries,
  type CookieToSet,
} from './session-cookie'

function readSessionFromDocument(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`)
  )
  return match ? match[1] : undefined
}

function writeSessionToDocument(value: string) {
  if (typeof document === 'undefined') return
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Path=${SESSION_COOKIE_OPTIONS.path}`,
    `Max-Age=${SESSION_COOKIE_OPTIONS.maxAge}`,
    `SameSite=${SESSION_COOKIE_OPTIONS.sameSite}`,
  ]
  if (SESSION_COOKIE_OPTIONS.secure) parts.push('Secure')
  document.cookie = parts.join('; ')
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return mapToEntries(decodeSession(readSessionFromDocument()))
        },
        setAll(cookiesToSet: CookieToSet[]) {
          const current = decodeSession(readSessionFromDocument())
          const next = applyUpdates(current, cookiesToSet)
          writeSessionToDocument(encodeSession(next))
        },
      },
    }
  )
}
