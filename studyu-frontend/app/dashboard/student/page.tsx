import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from '@/components/dashboard/DashboardClient'

export const dynamic = 'force-dynamic'

export default async function StudentDashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) redirect('/login')

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

  const { data: enrollmentRows } = await supabase
    .from('notebook_enrollments')
    .select('notebook_id, notebooks(*)')
    .eq('student_id', user.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrolledNotebooks: any[] = ((enrollmentRows ?? []) as any[])
    .map((row: any) => row.notebooks)
    .filter((nb: any) => nb != null)

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
