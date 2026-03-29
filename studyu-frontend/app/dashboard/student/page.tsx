import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from '@/components/dashboard/DashboardClient'

export const dynamic = 'force-dynamic'
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default async function StudentDashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) redirect('/login')
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: studentNotebooks } = await supabase
    .from('notebooks')
    .select('*, documents(count)')
    .eq('notebook_type', 'student')
    .order('created_at', { ascending: false })

  let enrolledNotebooks: any[] = []
  if (token) {
    try {
      const res = await fetch(`${API}/api/notebooks/enrolled`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.ok) {
        enrolledNotebooks = await res.json()
      }
    } catch {
      // fall through to Supabase direct query fallback
    }
  }

  // Fallback: direct Supabase query (RLS 정책에 따라 비어있을 수 있음)
  if (enrolledNotebooks.length === 0) {
    const { data: enrollmentRows } = await supabase
      .from('notebook_enrollments')
      .select('notebook_id')
      .eq('student_id', user.id)

    const enrolledIds = (enrollmentRows ?? []).map((row) => row.notebook_id).filter(Boolean)
    if (enrolledIds.length > 0) {
      const { data: enrolledData } = await supabase
        .from('notebooks')
        .select('*, documents(count)')
        .in('id', enrolledIds)
        .order('created_at', { ascending: false })
      enrolledNotebooks = enrolledData ?? []
    }
  }

  const userName = profile?.display_name || user.email?.split('@')[0] || '사용자'

  return (
    <DashboardClient
      role="student"
      instructorNotebooks={[]}
      studentNotebooks={studentNotebooks || []}
      enrolledNotebooks={enrolledNotebooks}
      userName={userName}
      avatarUrl={profile?.avatar_url}
    />
  )
}
