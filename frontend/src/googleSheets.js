const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

function isValidGoogleClientId(value) {
  const clientId = String(value || '').trim()
  return clientId.length > 30 && clientId.endsWith('.apps.googleusercontent.com') && !clientId.includes('YOUR_CLIENT_ID')
}

function requireClientId() {
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  if (!isValidGoogleClientId(clientId)) {
    throw new Error('Google OAuth is not configured on this deployment. Set VITE_GOOGLE_CLIENT_ID to the real Web OAuth Client ID, then redeploy.')
  }
  return clientId
}

function randomState() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function startGoogleRedirect(spreadsheetId) {
  const clientId = requireClientId()
  const state = randomState()
  const redirectUri = `${window.location.origin}/`
  sessionStorage.setItem('rollflow_google_oauth_state', state)
  sessionStorage.setItem('rollflow_pending_spreadsheet_id', spreadsheetId)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SHEETS_SCOPE,
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  })
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

export function consumeGoogleRedirect() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = hash.get('access_token')
  const oauthError = hash.get('error')
  if (!token && !oauthError) return null

  const expectedState = sessionStorage.getItem('rollflow_google_oauth_state')
  const receivedState = hash.get('state')
  const spreadsheetId = sessionStorage.getItem('rollflow_pending_spreadsheet_id')
  sessionStorage.removeItem('rollflow_google_oauth_state')
  sessionStorage.removeItem('rollflow_pending_spreadsheet_id')
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)

  if (oauthError) throw new Error(hash.get('error_description') || oauthError)
  if (!expectedState || receivedState !== expectedState) throw new Error('Google authorization state could not be verified. Please reconnect the Sheet.')
  if (!spreadsheetId) throw new Error('The pending Google Sheet could not be found. Please reconnect it.')
  return { token, spreadsheetId }
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
