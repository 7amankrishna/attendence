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

export function startGoogleRedirect(spreadsheetId, preferredSheetId = null) {
  const clientId = requireClientId()
  const state = randomState()
  const redirectUri = `${window.location.origin}/`
  sessionStorage.setItem('rollflow_google_oauth_state', state)
  sessionStorage.setItem('rollflow_pending_spreadsheet_id', spreadsheetId)
  if (preferredSheetId !== null) sessionStorage.setItem('rollflow_pending_sheet_gid', String(preferredSheetId))

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
  const preferredSheetId = sessionStorage.getItem('rollflow_pending_sheet_gid')
  sessionStorage.removeItem('rollflow_google_oauth_state')
  sessionStorage.removeItem('rollflow_pending_spreadsheet_id')
  sessionStorage.removeItem('rollflow_pending_sheet_gid')
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)

  if (oauthError) throw new Error(hash.get('error_description') || oauthError)
  if (!expectedState || receivedState !== expectedState) throw new Error('Google authorization state could not be verified. Please reconnect the Sheet.')
  if (!spreadsheetId) throw new Error('The pending Google Sheet could not be found. Please reconnect it.')
  return { token, spreadsheetId, preferredSheetId: preferredSheetId !== null ? Number(preferredSheetId) : null }
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

export function extractSpreadsheetReference(input) {
  const value = input.trim()
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  const spreadsheetId = match?.[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(value) ? value : null)
  if (spreadsheetId) {
    const gidMatch = value.match(/(?:[?#&]|^)gid=(\d+)/)
    return { spreadsheetId, preferredSheetId: gidMatch ? Number(gidMatch[1]) : null }
  }
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
  return String(value || '').trim().toLowerCase().replace(/[_./-]+/g, ' ').replace(/[^a-z0-9%@ ]/g, '').replace(/\s+/g, ' ')
}

const COLUMN_ALIASES = {
  name: ['name', 'student name', 'full name', 'candidate name'],
  systemId: ['system id', 'systme id', 'systemid', 'student id', 'university id', 'enrollment no', 'enrolment no', 'registration no', 'registration number'],
  rollNo: ['roll no', 'roll number', 'roll', 'rollno'],
  email: ['mail id', 'email id', 'email', 'email address', 'e mail', 'mail'],
  section: ['section', 'sec', 'class section'],
  percentage: ['percentage', 'pecrentage', 'percent', 'attendance percentage', 'attendance %'],
  batch: ['batch', 'class', 'programme', 'program'],
  serial: ['sr no', 'sl no', 'serial no', 's no']
}

function findColumn(headers, aliases) {
  return headers.findIndex(header => {
    const value = normalized(header)
    return aliases.some(alias => value === alias || value.startsWith(`${alias} `))
  })
}

function quoteSheetName(name) {
  return `'${name.replace(/'/g, "''")}'`
}

function findHeaderRow(rows) {
  let best = { index: 0, score: -1 }
  rows.slice(0, 12).forEach((row, index) => {
    const values = row.map(normalized)
    const aliasScore = Object.values(COLUMN_ALIASES).flat().filter(alias => values.some(value => value === alias || value.startsWith(`${alias} `))).length
    const dateScore = row.filter(value => parseDateLabel(value)).length
    const score = aliasScore * 3 + dateScore
    if (score > best.score) best = { index, score }
  })
  return best.index
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function columnScore(rows, index, predicate) {
  if (index < 0) return 0
  return rows.reduce((score, row) => score + (predicate(row[index]) ? 1 : 0), 0)
}

function bestColumn(rows, width, predicate, excluded = new Set()) {
  let best = { index: -1, score: 0 }
  for (let index = 0; index < width; index++) {
    if (excluded.has(index)) continue
    const score = columnScore(rows, index, predicate)
    if (score > best.score) best = { index, score }
  }
  return best.index
}

function parseDateLabel(value) {
  const text = String(value || '').trim()
  let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (match) return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3].length === 2 ? `20${match[3]}` : match[3]}`
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`
  return null
}

function attendanceStatus(value) {
  const text = normalized(value)
  if (['present', 'p', '1', 'yes'].includes(text)) return 'present'
  if (['absent', 'a', '0', 'no'].includes(text)) return 'absent'
  if (['late', 'l'].includes(text)) return 'late'
  if (['excused', 'e', 'leave'].includes(text)) return 'excused'
  return null
}

function inferSchema(rows, headerRowIndex) {
  const headers = rows[headerRowIndex] || []
  const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.some(value => String(value || '').trim())).slice(0, 250)
  const width = Math.max(headers.length, ...dataRows.map(row => row.length), 0)
  const columns = {
    name: findColumn(headers, COLUMN_ALIASES.name),
    systemId: findColumn(headers, COLUMN_ALIASES.systemId),
    rollNo: findColumn(headers, COLUMN_ALIASES.rollNo),
    email: findColumn(headers, COLUMN_ALIASES.email),
    section: findColumn(headers, COLUMN_ALIASES.section),
    percentage: findColumn(headers, COLUMN_ALIASES.percentage),
    batch: findColumn(headers, COLUMN_ALIASES.batch)
  }
  const used = new Set(Object.values(columns).filter(index => index >= 0))

  if (columns.email < 0) {
    columns.email = bestColumn(dataRows, width, value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()), used)
    if (columns.email >= 0) used.add(columns.email)
  }

  const idCandidates = []
  for (let index = 0; index < width; index++) {
    if (columnScore(dataRows, index, value => digits(value).length === 10) >= Math.max(2, dataRows.length * 0.25)) idCandidates.push(index)
  }
  if (columns.systemId < 0) columns.systemId = idCandidates.find(index => !used.has(index)) ?? -1
  if (columns.systemId >= 0) used.add(columns.systemId)
  if (columns.rollNo < 0) columns.rollNo = idCandidates.find(index => !used.has(index)) ?? -1
  if (columns.rollNo >= 0) used.add(columns.rollNo)

  if (columns.name < 0) {
    columns.name = bestColumn(dataRows, width, value => {
      const text = String(value || '').trim()
      return text.length >= 2 && text.length <= 80 && /[a-zA-Z]/.test(text) && !text.includes('@') && !attendanceStatus(text) && !parseDateLabel(text)
    }, used)
  }

  const profileColumns = new Set(Object.values(columns).filter(index => index >= 0))
  const attendanceColumns = []
  let currentDate = null
  for (let index = 0; index < width; index++) {
    const parsedDate = parseDateLabel(headers[index])
    if (parsedDate) currentDate = parsedDate
    if (profileColumns.has(index)) continue
    const statusCount = columnScore(dataRows, index, value => Boolean(attendanceStatus(value)))
    if (parsedDate || statusCount >= Math.max(2, dataRows.length * 0.15)) {
      attendanceColumns.push({ index, label: parsedDate || currentDate || `Session ${attendanceColumns.length + 1}` })
    }
  }
  return { headers, columns, attendanceColumns }
}

export async function importStudentsFromSheet(spreadsheetId, token, preferredSheetId = null) {
  const info = await getSpreadsheetInfo(spreadsheetId, token)
  const availableSheets = info.sheets.filter(sheet => normalized(sheet.title) !== 'attendance')
  const studentsSheet = availableSheets.find(s => Number(s.id) === Number(preferredSheetId)) || availableSheets.find(s => normalized(s.title) === 'students') || availableSheets[0]
  if (!studentsSheet) throw new Error('The spreadsheet has no sheets to import.')

  const range = encodeURIComponent(`${quoteSheetName(studentsSheet.title)}!A:ZZ`)
  const data = await apiRequest(`${spreadsheetId}/values/${range}?majorDimension=ROWS`, token)
  const rows = data.values || []
  if (rows.length < 2) throw new Error('Add a header row and at least one student to the Sheet.')

  const headerRowIndex = findHeaderRow(rows)
  const schema = inferSchema(rows, headerRowIndex)
  const { columns, attendanceColumns } = schema
  if (columns.name < 0 || (columns.systemId < 0 && columns.rollNo < 0)) {
    throw new Error('Could not detect the student name and a 10-digit System ID/Roll No column.')
  }

  const recentColumns = attendanceColumns.slice(-5)
  const students = rows.slice(headerRowIndex + 1).map((row, index) => {
    const systemId = columns.systemId >= 0 ? digits(row[columns.systemId]) : ''
    const rollNo = columns.rollNo >= 0 ? digits(row[columns.rollNo]) : ''
    const primaryId = rollNo || systemId
    const statuses = attendanceColumns.map(column => attendanceStatus(row[column.index])).filter(Boolean)
    const present = statuses.filter(status => status === 'present' || status === 'late').length
    const absent = statuses.filter(status => status === 'absent').length
    const excused = statuses.filter(status => status === 'excused').length
    const total = statuses.length
    return {
      id: `gs-${headerRowIndex + index + 2}`,
      source_row: headerRowIndex + index + 2,
      roll_no: primaryId,
      system_id: systemId,
      university_roll_no: rollNo,
      name: String(row[columns.name] || '').trim(),
      email: columns.email >= 0 ? String(row[columns.email] || '').trim() : '',
      section: columns.section >= 0 ? String(row[columns.section] || '').trim() : '',
      batch: columns.batch >= 0 ? String(row[columns.batch] || '').trim() : studentsSheet.title,
      sheet_percentage: columns.percentage >= 0 ? String(row[columns.percentage] || '').trim() : '',
      attendance: { present, absent, excused, total, percentage: total ? Math.round(present / total * 10000) / 100 : 0 },
      recent_statuses: recentColumns.map(column => attendanceStatus(row[column.index]))
    }
  }).filter(student => student.name && student.roll_no.length === 10)

  if (!students.length) throw new Error('No valid students were found in the Sheet.')
  const sections = [...new Set(students.map(student => student.section).filter(Boolean))].sort()
  return {
    info,
    students,
    availableSheets,
    sourceSheet: studentsSheet.title,
    sourceSheetId: studentsSheet.id,
    sections,
    recentLabels: recentColumns.map(column => column.label),
    detectedColumns: {
      name: schema.headers[columns.name] || `Column ${columns.name + 1}`,
      systemId: columns.systemId >= 0 ? schema.headers[columns.systemId] || `Column ${columns.systemId + 1}` : null,
      rollNo: columns.rollNo >= 0 ? schema.headers[columns.rollNo] || `Column ${columns.rollNo + 1}` : null,
      email: columns.email >= 0 ? schema.headers[columns.email] || `Column ${columns.email + 1}` : null,
      section: columns.section >= 0 ? schema.headers[columns.section] || `Column ${columns.section + 1}` : null,
      attendanceSessions: attendanceColumns.length
    }
  }
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
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A:I`)
  const current = await apiRequest(`${spreadsheetId}/values/${range}?majorDimension=ROWS`, token)
  const header = ['Date', 'System ID', 'Roll No', 'Student Name', 'Email', 'Section', 'Status', 'Updated At', 'Sync ID']
  const existingValues = current.values || []
  const isExpandedFormat = (existingValues[0] || []).some(value => normalized(value) === 'system id')
  const existingRows = existingValues.slice(1).map(row => isExpandedFormat ? row : [row[0], row[1], row[1], row[2], '', '', row[3], row[4], row[5]])
  const byKey = new Map(existingRows.map(row => [`${row[0]}::${row[1] || row[2]}`, row]))
  const updatedAt = new Date().toISOString()

  students.forEach(student => {
    const status = marks[student.id]
    if (!status) return
    const systemId = student.system_id || student.roll_no
    const rollNo = student.university_roll_no || student.roll_no
    byKey.set(`${date}::${systemId || rollNo}`, [date, systemId, rollNo, student.name, student.email || '', student.section || '', status, updatedAt, syncId])
  })

  const values = [header, ...Array.from(byKey.values()).sort((a, b) => `${b[0]}${a[1] || a[2]}`.localeCompare(`${a[0]}${b[1] || b[2]}`))]
  await apiRequest(`${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT',
    body: JSON.stringify({ range: `${sheetName}!A:I`, majorDimension: 'ROWS', values })
  })
  return { spreadsheetTitle: info.title, updated: students.filter(s => marks[s.id]).length }
}
