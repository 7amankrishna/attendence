const API_BASE = import.meta.env.VITE_INFINITYFREE_API_URL || import.meta.env.VITE_API_URL || './api'

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}/${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`)
  }
  return data
}

export const api = {
  students: (classId = 1) => request(`students.php?class_id=${classId}`),
  attendance: (classId = 1, date) => request(`attendance.php?class_id=${classId}&date=${date}`),
  history: (classId = 1, days = 5) => request(`summary.php?class_id=${classId}&days=${days}`),
  saveAttendance: (classId, date, records) => request('attendance.php', {
    method: 'POST',
    body: JSON.stringify({ class_id: classId, date, records })
  })
}
