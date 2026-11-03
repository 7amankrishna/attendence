const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

function requireClientId() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('Google Client ID is not configured. Add VITE_GOOGLE_CLIENT_ID to your .env file.')
  return clientId
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      if (window.google?.accounts?.oauth2) return resolve()
      if (++attempts > 50) return reject(new Error('Google sign-in could not load. Check your internet connection.'))
      setTimeout(check, 100)
    }
    check()
  })
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(`${API_BASE}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = data?.error?.message || `Google Sheets request failed (${response.status})`
    const error = new Error(response.status === 403
      ? 'You can view this Sheet, but your Google account does not have permission to update it.'
      : reason)
    error.status = response.status
    throw error
  }
  return data
}

export function extractSpreadsheetId(input) {
  const value = input.trim()
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value
  throw new Error('Paste a valid Google Sheets link or spreadsheet ID.')
}

export async function requestGoogleAccess() {
  await waitForGoogleIdentity()
  const clientId = requireClientId()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SHEETS_SCOPE,
      callback: response => {
        if (response.error) reject(new Error(response.error_description || response.error))
        else resolve(response.access_token)
      },
      error_callback: error => reject(new Error(error.message || 'Google sign-in was cancelled.'))
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export async function getSpreadsheetInfo(spreadsheetId, token) {
  const data = await apiRequest(`${spreadsheetId}?fields=properties.title,sheets.properties`, token)
  return {
    id: spreadsheetId,
    title: data.properties?.title || 'Google Sheet',
    sheets: (data.sheets || []).map(s => ({
      id: s.properties.sheetId,
      title: s.properties.title
    }))
  }
}

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function findColumn(headers, aliases) {
  return headers.findIndex(header => aliases.includes(normalized(header)))
}

function quoteSheetName(name) {
  return `'${name.replace(/'/g, "''")}'`
}

export async function importStudentsFromSheet(spreadsheetId, token) {
  const info = await getSpreadsheetInfo(spreadsheetId, token)
  const studentsSheet = info.sheets.find(s => normalized(s.title) === 'students') || info.sheets[0]
  if (!studentsSheet) throw new Error('The spreadsheet has no sheets to import.')

  const range = encodeURIComponent(`${quoteSheetName(studentsSheet.title)}!A:Z`)
  const data = await apiRequest(`${spreadsheetId}/values/${range}?majorDimension=ROWS`, token)
  const rows = data.values || []
  if (rows.length < 2) throw new Error('Add a header row and at least one student to the Sheet.')

  const headers = rows[0]
  const rollIndex = findColumn(headers, ['roll no', 'roll number', 'roll', 'student id', 'id'])
  const nameIndex = findColumn(headers, ['student name', 'name', 'full name'])
  const emailIndex = findColumn(headers, ['email', 'email address'])
  if (rollIndex < 0 || nameIndex < 0) {
    throw new Error('The student sheet needs “Roll No” and “Student Name” columns.')
  }

  const students = rows.slice(1).map((row, index) => ({
    id: `gs-${index + 1}`,
    roll_no: String(row[rollIndex] || '').trim(),
    name: String(row[nameIndex] || '').trim(),
    email: emailIndex >= 0 ? String(row[emailIndex] || '').trim() : ''
  })).filter(student => student.roll_no && student.name)

  if (!students.length) throw new Error('No valid students were found in the Sheet.')
  return { info, students, sourceSheet: studentsSheet.title }
}

async function ensureAttendanceSheet(spreadsheetId, token, info) {
  const existing = info.sheets.find(s => normalized(s.title) === 'attendance')
  if (existing) return existing.title
  await apiRequest(`${spreadsheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Attendance' } } }] })
  })
  return 'Attendance'
}

export async function updateAttendanceSheet({ spreadsheetId, token, date, students, marks, syncId = '' }) {
  const info = await getSpreadsheetInfo(spreadsheetId, token)
  const sheetName = await ensureAttendanceSheet(spreadsheetId, token, info)
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A:F`)
  const current = await apiRequest(`${spreadsheetId}/values/${range}?majorDimension=ROWS`, token)
  const header = ['Date', 'Roll No', 'Student Name', 'Status', 'Updated At', 'Sync ID']
  const existingRows = (current.values || []).slice(1)
  const byKey = new Map(existingRows.map(row => [`${row[0]}::${row[1]}`, row]))
  const updatedAt = new Date().toISOString()

  students.forEach(student => {
    const status = marks[student.id]
    if (!status) return
    byKey.set(`${date}::${student.roll_no}`, [date, student.roll_no, student.name, status, updatedAt, syncId])
  })

  const values = [header, ...Array.from(byKey.values()).sort((a, b) => `${b[0]}${a[1]}`.localeCompare(`${a[0]}${b[1]}`))]
  await apiRequest(`${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT',
    body: JSON.stringify({ range: `${sheetName}!A:F`, majorDimension: 'ROWS', values })
  })
  return { spreadsheetTitle: info.title, updated: students.filter(s => marks[s.id]).length }
}
