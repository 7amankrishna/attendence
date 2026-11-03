import { api } from './api'
import { updateAttendanceSheet } from './googleSheets'
import { backupToSupabase } from './supabase'

function createSyncId() {
  return globalThis.crypto?.randomUUID?.() || `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function attempt(id, label, action) {
  try {
    const data = await action()
    return { id, label, status: 'success', message: `${data.saved ?? data.updated ?? 0} records saved` }
  } catch (error) {
    return { id, label, status: 'failed', message: error.message }
  }
}

export async function saveThreeCopies({ classId = 1, date, students, marks, sheetConnection }) {
  const syncId = createSyncId()
  const markedStudents = students.filter(student => marks[student.id])
  const mysqlRecords = markedStudents.map(student => ({
    student_id: Number.isInteger(Number(student.id)) ? Number(student.id) : null,
    roll_no: student.roll_no,
    name: student.name,
    status: marks[student.id],
    sync_id: syncId
  }))
  const results = []

  // Intentional sequence: primary cloud backup, hosting database, human-readable Sheet.
  results.push(await attempt('supabase', 'Supabase', () =>
    backupToSupabase({ classId, date, students: markedStudents, marks, syncId })
  ))

  results.push(await attempt('mysql', 'InfinityFree MySQL', async () => {
    const response = await api.saveAttendance(classId, date, mysqlRecords)
    return { saved: response.saved ?? mysqlRecords.length }
  }))

  if (sheetConnection?.token && sheetConnection?.spreadsheetId) {
    results.push(await attempt('sheets', 'Google Sheets', () => updateAttendanceSheet({
      spreadsheetId: sheetConnection.spreadsheetId,
      token: sheetConnection.token,
      date,
      students: markedStudents,
      marks,
      syncId
    })))
  } else {
    results.push({ id: 'sheets', label: 'Google Sheets', status: 'skipped', message: 'Connect a Sheet to enable this backup' })
  }

  const report = { syncId, date, createdAt: new Date().toISOString(), results }
  localStorage.setItem('rollflow_last_sync', JSON.stringify(report))
  if (results.some(result => result.status !== 'success')) {
    const pending = JSON.parse(localStorage.getItem('rollflow_pending_syncs') || '[]')
    localStorage.setItem('rollflow_pending_syncs', JSON.stringify([...pending.slice(-19), report]))
  }
  return report
}
