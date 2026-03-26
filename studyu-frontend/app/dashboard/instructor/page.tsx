import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from '@/components/dashboard/DashboardClient'

export const dynamic = 'force-dynamic'

export default async function InstructorDashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: instructorNotebooks } = await supabase
    .from('notebooks')
    .select('*, documents(count), notebook_enrollments(count)')
    .eq('notebook_type', 'instructor')
    .order('created_at', { ascending: false })

  const userName = profile?.display_name || user.email?.split('@')[0] || '사용자'

  return (
    <DashboardClient
      role="instructor"
      instructorNotebooks={instructorNotebooks || []}
      studentNotebooks={[]}
      userName={userName}
      avatarUrl={profile?.avatar_url}
    />
  )
}
