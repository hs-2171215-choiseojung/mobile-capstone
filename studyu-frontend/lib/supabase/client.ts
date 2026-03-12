// ============================================
// lib/supabase/client.ts
// ============================================
// 브라우저(클라이언트 컴포넌트)에서 사용하는 Supabase 클라이언트
// 'use client' 컴포넌트에서 import해서 사용
// ============================================

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
