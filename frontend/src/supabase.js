import { createClient } from '@supabase/supabase-js'

let client

function getClient() {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase environment variables are not configured.')
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
  return client
}

async function authenticatedClient() {
  const supabase = getClient()
  let { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) {
    const result = await supabase.auth.signInAnonymously()
    if (result.error) throw result.error
    session = result.data.session
  }
  if (!session?.user?.id) throw new Error('Supabase authentication could not be established.')
  return { supabase, ownerId: session.user.id }
}

export async function backupToSupabase({ classId, date, students, marks, syncId }) {
  const { supabase, ownerId } = await authenticatedClient()
  const records = students.filter(student => marks[student.id]).map(student => ({
    owner_id: ownerId,
    class_id: String(classId),
    roll_no: student.roll_no,
    student_name: student.name,
    attendance_date: date,
    status: marks[student.id],
    sync_id: syncId,
    source: 'rollflow-web',
    updated_at: new Date().toISOString()
  }))
  if (!records.length) throw new Error('No marked students to back up.')

  const { error } = await supabase.from('attendance_backups').upsert(records, {
    onConflict: 'owner_id,class_id,roll_no,attendance_date',
    ignoreDuplicates: false
  })
  if (error) throw new Error(error.message || 'Supabase backup failed')
  return { saved: records.length }
}
