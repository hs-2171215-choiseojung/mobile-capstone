'use client'

// ============================================
// components/auth/LogoutButton.tsx
// ============================================
// 로그아웃 버튼 (클라이언트 컴포넌트)
// Supabase signOut 호출 → 로그인 페이지로 이동
// ============================================

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh() // 서버 컴포넌트도 새로고침
  }

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1.5 text-xs font-medium text-surface-500 
                 hover:text-surface-700 hover:bg-surface-100 
                 rounded-lg transition-colors"
    >
      로그아웃
    </button>
  )
}
