import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { saveThreeCopies } from './syncManager'
import {
  consumeGoogleRedirect,
  extractSpreadsheetReference,
  importStudentsFromSheet,
  startGoogleRedirect,
  updateAttendanceSheet
} from './googleSheets'

const STATUS = {
  present: { label: 'Present', key: 'P', icon: '✓' },
  absent: { label: 'Absent', key: 'A', icon: '×' }
}

const HISTORY_STATUS = {
  ...STATUS,
  late: { label: 'Late', icon: '◷' },
  excused: { label: 'Excused', icon: '–' }
}

const demoStudents = [
  'Aarav Sharma','Aditi Singh','Aditya Raj','Ananya Verma','Ankit Kumar',
  'Arjun Mehta','Aryan Asthana','Avni Gupta','Deepak Yadav','Diya Roy',
  'Harsh Raj','Ishita Jain','Kabir Khan','Kavya Mishra','Meera Joshi',
  'Nikhil Das','Priya Kumari','Raghav Sinha','Riya Patel','Rohan Kumar',
  'Sakshi Jha','Samarth Rao','Sneha Nair','Tanvi Kapoor','Vihaan Gupta'
].map((name, i) => ({ id: i + 1, roll_no: `24CS${String(i + 1).padStart(3,'0')}`, name }))

const demoHistory = demoStudents.map((student, i) => ({
  student_id: student.id,
  statuses: ['present', i % 7 === 0 ? 'absent' : 'present', i % 6 === 0 ? 'late' : 'present', 'present', i % 9 === 0 ? 'absent' : 'present']
}))

function initials(name) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('')
}

function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10)
}

function StatusDot({ status }) {
  const info = HISTORY_STATUS[status]
  return <span className={`day-dot ${status || 'empty'}`} title={info?.label || 'No record'}>{info?.icon || '·'}</span>
}

function App() {
  const [students, setStudents] = useState([])
  const [marks, setMarks] = useState({})
  const [history, setHistory] = useState([])
  const [dates, setDates] = useState([])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState(1)
  const [cols, setCols] = useState(5)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [date, setDate] = useState(todayISO())
  const [undo, setUndo] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [demoMode, setDemoMode] = useState(false)
  const [panel, setPanel] = useState('mark')
  const [sheetModal, setSheetModal] = useState(false)
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem('rollflow_sheet_url') || '')
  const [sheetConnection, setSheetConnection] = useState(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [successDialog, setSuccessDialog] = useState(null)
  const [autoBackup, setAutoBackup] = useState(true)
  const [syncState, setSyncState] = useState('idle')
  const [batchBusy, setBatchBusy] = useState(false)
  const [sectionFilter, setSectionFilter] = useState('all')
  const [classInfo, setClassInfo] = useState({ title: 'B.Tech CSE — H(G1)', sections: [] })
  const backupQueue = useRef(Promise.resolve())
  const batchMarks = useRef({})

  const pageSize = rows * cols

  useEffect(() => {
    if (sheetConnection) return
    async function load() {
      try {
        const [studentData, attendanceData, historyData] = await Promise.all([
          api.students(1), api.attendance(1, date), api.history(1, 5)
        ])
        setStudents(studentData.students || [])
        setMarks(Object.fromEntries((attendanceData.records || []).map(r => [r.student_id, r.status])))
        setHistory(historyData.students || [])
        setDates(historyData.dates || [])
      } catch {
        setDemoMode(true)
        setStudents(demoStudents)
        setHistory(demoHistory)
        setDates(['Oct 28','Oct 29','Oct 30','Nov 01','Nov 03'])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [date, sheetConnection])

  const filtered = useMemo(() => students.filter(s => {
    const matchesSearch = `${s.name} ${s.roll_no} ${s.system_id || ''} ${s.university_roll_no || ''} ${s.email || ''} ${s.section || ''}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = s.removed ? filter === 'all' : filter === 'all' || (filter === 'unmarked' ? !marks[s.id] : marks[s.id] === filter)
    const matchesSection = sectionFilter === 'all' || s.section === sectionFilter
    return matchesSearch && matchesFilter && matchesSection
  }), [students, query, filter, sectionFilter, marks])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize)
  const activeStudents = students.filter(student => !student.removed)
  const activeIds = new Set(activeStudents.map(student => String(student.id)))
  const markedCount = Object.entries(marks).filter(([id]) => activeIds.has(String(id))).length
  const absentCount = Object.entries(marks).filter(([id, status]) => activeIds.has(String(id)) && status === 'absent').length
  const presentCount = Object.entries(marks).filter(([id, status]) => activeIds.has(String(id)) && status === 'present').length
  const completion = activeStudents.length ? Math.round(markedCount / activeStudents.length * 100) : 0

  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1))
  }, [totalPages, page])

  function markStudent(student, status) {
    if (student.removed) return
    const previous = marks[student.id]
    setUndo(old => [...old.slice(-9), { id: student.id, previous }])
    setMarks(old => ({ ...old, [student.id]: status }))
    setMessage(`${student.name} marked ${STATUS[status].label}`)
    setTimeout(() => setMessage(''), 1400)
    const indexOnPage = visible.findIndex(s => s.id === student.id)
    if (indexOnPage === visible.length - 1 && page < totalPages - 1) {
      setTimeout(() => setPage(p => p + 1), 220)
    }
    if (autoBackup) {
      const oneMark = { [student.id]: status }
      setSyncState('syncing')
      backupQueue.current = backupQueue.current.then(async () => {
        const report = await saveThreeCopies({
          classId: 1,
          date,
          students: [student],
          marks: oneMark,
          sheetConnection
        })
        const complete = report.results.every(result => result.status === 'success')
        setSyncState(complete ? 'complete' : 'warning')
        setMessage(complete ? `${student.name}: 3 backups saved` : `${student.name}: backup needs attention`)
        setTimeout(() => setMessage(''), 1800)
      }).catch(error => {
        setSyncState('warning')
        setMessage(error.message)
      })
    }
  }

  function undoLast() {
    const last = undo.at(-1)
    if (!last) return
    setMarks(old => {
      const next = { ...old }
      if (last.previous) next[last.id] = last.previous
      else delete next[last.id]
      return next
    })
    setUndo(old => old.slice(0, -1))
  }

  async function connectSheet() {
    setSheetBusy(true)
    setSheetError('')
    try {
      const { spreadsheetId, preferredSheetId } = extractSpreadsheetReference(sheetUrl)
      localStorage.setItem('rollflow_sheet_url', sheetUrl)
      startGoogleRedirect(spreadsheetId, preferredSheetId)
    } catch (error) {
      setSheetError(error.message)
      setSheetBusy(false)
    }
  }

  function applyImportedBatch(imported, connection) {
    const batchKey = `${date}:${imported.sourceSheetId}`
    setSheetConnection({
      ...connection,
      title: imported.info.title,
      sourceSheet: imported.sourceSheet,
      sourceSheetId: imported.sourceSheetId,
      availableSheets: imported.availableSheets,
      detectedColumns: imported.detectedColumns,
      sections: imported.sections
    })
    setStudents(imported.students)
    setHistory(imported.students.map(student => ({ student_id: student.id, statuses: student.recent_statuses })))
    setDates(imported.recentLabels)
    setClassInfo({ title: imported.sourceSheet, sections: imported.sections })
    setSectionFilter('all')
    setMarks(batchMarks.current[batchKey] || {})
    setUndo([])
    setQuery('')
    setFilter('all')
    setPage(0)
    setDemoMode(true)
  }

  async function switchBatch(sheetId) {
    if (!sheetConnection || Number(sheetId) === Number(sheetConnection.sourceSheetId) || batchBusy) return
    batchMarks.current[`${date}:${sheetConnection.sourceSheetId}`] = marks
    setBatchBusy(true)
    setMessage('Loading batch…')
    try {
      const imported = await importStudentsFromSheet(sheetConnection.spreadsheetId, sheetConnection.token, sheetId)
      applyImportedBatch(imported, {
        spreadsheetId: sheetConnection.spreadsheetId,
        token: sheetConnection.token
      })
      setMessage(`${imported.sourceSheet}: ${imported.students.length} students loaded`)
      setTimeout(() => setMessage(''), 1800)
    } catch (error) {
      setMessage(error.message)
      setTimeout(() => setMessage(''), 3500)
    } finally {
      setBatchBusy(false)
    }
  }

  useEffect(() => {
    let authorization
    try {
      authorization = consumeGoogleRedirect()
    } catch (error) {
      setSheetModal(true)
      setSheetError(error.message)
      return
    }
    if (!authorization) return

    setSheetBusy(true)
    importStudentsFromSheet(authorization.spreadsheetId, authorization.token, authorization.preferredSheetId).then(imported => {
      applyImportedBatch(imported, {
        spreadsheetId: authorization.spreadsheetId,
        token: authorization.token
      })
      setSuccessDialog({
        title: 'Students imported successfully',
        detail: `${imported.students.length} students imported from “${imported.sourceSheet}”. You can switch batches without reconnecting.`
      })
    }).catch(error => {
      setSheetModal(true)
      setSheetError(error.message)
    }).finally(() => {
      setSheetBusy(false)
    })
  }, [])

  async function syncGoogleSheet() {
    if (!sheetConnection) {
      setSheetModal(true)
      return false
    }
    const result = await updateAttendanceSheet({
      spreadsheetId: sheetConnection.spreadsheetId,
      token: sheetConnection.token,
      date,
      students,
      marks
    })
    setSuccessDialog({
      title: 'Attendance updated successfully',
      detail: `${result.updated} records were updated in “${result.spreadsheetTitle}”.`
    })
    return true
  }

  async function save() {
    if (markedCount < activeStudents.length && !confirm(`${activeStudents.length - markedCount} students are still unmarked. Save anyway?`)) return
    setSaving(true)
    try {
      setSyncState('syncing')
      const report = await saveThreeCopies({ classId: 1, date, students, marks, sheetConnection })
      const complete = report.results.every(result => result.status === 'success')
      setSyncState(complete ? 'complete' : 'warning')
      setSuccessDialog({
        title: complete ? 'Three backups created successfully' : 'Attendance saved with backup warnings',
        detail: complete
          ? 'Supabase, InfinityFree MySQL and Google Sheets now contain the same attendance records.'
          : 'Some destinations could not be updated. The successful copies are safe; check the details below.',
        results: report.results,
        syncId: report.syncId
      })
    } catch (e) {
      setSyncState('warning')
      setMessage(e.message)
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT','SELECT'].includes(document.activeElement?.tagName)) return
      const unmarked = visible.find(s => !s.removed && !marks[s.id]) || visible.find(s => !s.removed)
      if (!unmarked) return
      const map = { p:'present', a:'absent' }
      if (map[e.key.toLowerCase()]) markStudent(unmarked, map[e.key.toLowerCase()])
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="loading"><div className="loader-ring"/><p>Preparing your class…</p></div>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>RollFlow</span></div>
        <nav>
          <button className={panel === 'mark' ? 'active' : ''} onClick={() => setPanel('mark')}><span>●</span> Take attendance</button>
          <button className={panel === 'progress' ? 'active' : ''} onClick={() => setPanel('progress')}><span>▦</span> 5-day progress</button>
          <button onClick={() => setFilter('absent')}><span>!</span> Follow-up queue <b>{absentCount}</b></button>
        </nav>
        <div className="class-card">
          <span className="eyebrow">ACTIVE CLASS</span>
          <strong>{classInfo.title}</strong>
          <small>{classInfo.sections.length ? `Sections ${classInfo.sections.join(', ')}` : 'Google Sheets class data'}</small>
          <div className="class-meta"><span>{activeStudents.length} active · {students.length - activeStudents.length} removed</span><span>09:00 AM</span></div>
        </div>
        <div className="teacher"><span className="avatar small">AK</span><div><strong>Aman Krishna</strong><small>Teacher view</small></div><button>•••</button></div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">TUESDAY · MORNING SESSION</span><h1>{panel === 'mark' ? 'Attendance, without the crowd.' : 'Five days. One clear picture.'}</h1></div>
          <div className="top-actions">
            {demoMode && <span className="demo-badge">Demo data</span>}
            <label className="auto-backup" title="Write Supabase, MySQL and Google Sheets after every mark">
              <input type="checkbox" checked={autoBackup} onChange={e => setAutoBackup(e.target.checked)} />
              <span>Auto 3-copy backup</span>
            </label>
            <span className={`sync-indicator ${syncState}`}><i />{syncState === 'syncing' ? 'Syncing' : syncState === 'complete' ? '3 copies safe' : syncState === 'warning' ? 'Check backup' : 'Ready'}</span>
            <button className={`sheets-btn ${sheetConnection ? 'connected' : ''}`} onClick={() => setSheetModal(true)}>
              <span className="sheets-icon">▦</span>{sheetConnection ? sheetConnection.title : 'Connect Google Sheet'}
            </button>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button className="save-btn" onClick={save} disabled={saving}>{saving ? 'Saving 3 copies…' : 'Save all backups'}</button>
          </div>
        </header>

        {message && <div className="toast">{message}</div>}

        {sheetConnection?.availableSheets?.length > 1 && <section className="batch-switcher" aria-label="Google Sheet batches">
          <div className="batch-switcher-title"><span className="eyebrow">ACTIVE BATCH</span><strong>{sheetConnection.sourceSheet}</strong></div>
          <div className="batch-tabs" role="tablist" aria-label="Choose a batch">
            {sheetConnection.availableSheets.map(sheet => <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={Number(sheet.id) === Number(sheetConnection.sourceSheetId)}
              className={Number(sheet.id) === Number(sheetConnection.sourceSheetId) ? 'active' : ''}
              disabled={batchBusy}
              onClick={() => switchBatch(sheet.id)}
            >{sheet.title}</button>)}
          </div>
          {batchBusy && <span className="batch-loading">Loading…</span>}
        </section>}

        {panel === 'mark' ? <>
          <section className="summary-strip">
            <div><span className="number">{completion}%</span><span>session complete</span></div>
            <div className="progress-track"><i style={{width: `${completion}%`}} /></div>
            <div className="summary-numbers"><span><b>{presentCount}</b> present</span><span><b>{absentCount}</b> absent</span><span><b>{activeStudents.length - markedCount}</b> left</span></div>
          </section>

          <section className="control-row">
            <div className="search-wrap"><span>⌕</span><input value={query} onChange={e => {setQuery(e.target.value);setPage(0)}} placeholder="Search name or roll number" /></div>
            <div className="filter-tabs">
              {['all','unmarked','present','absent'].map(x => <button key={x} className={filter === x ? 'active' : ''} onClick={() => {setFilter(x);setPage(0)}}>{x}</button>)}
            </div>
            {classInfo.sections.length > 0 && <select className="section-select" value={sectionFilter} onChange={e => {setSectionFilter(e.target.value);setPage(0)}}>
              <option value="all">All sections</option>
              {classInfo.sections.map(section => <option value={section} key={section}>Section {section}</option>)}
            </select>}
            <button className="undo" disabled={!undo.length} onClick={undoLast}>↶ Undo</button>
          </section>

          <section className="focus-panel">
            <div className="focus-head">
              <div><span className="eyebrow">FOCUS BATCH</span><h2>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} <small>of {filtered.length}</small></h2></div>
              <div className="layout-picker">
                <label>Rows<select value={rows} onChange={e => {setRows(+e.target.value);setPage(0)}}>{[1,2,3].map(n => <option key={n}>{n}</option>)}</select></label>
                <span>×</span>
                <label>Columns<select value={cols} onChange={e => {setCols(+e.target.value);setPage(0)}}>{[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}</select></label>
                <span className="count-pill">{pageSize} at once</span>
              </div>
            </div>

            <div className="student-grid" style={{gridTemplateColumns:`repeat(${cols}, minmax(0, 1fr))`}}>
              {visible.map((student, index) => <article className={`student-card ${student.removed ? 'removed' : marks[student.id] || ''}`} key={student.id}>
                <div className="student-top"><span className="position">{page * pageSize + index + 1}</span><span className="avatar">{initials(student.name)}</span><span className="roll">{student.system_id || student.roll_no}</span></div>
                <h3>{student.name}</h3>
                {(student.section || student.attendance) && <div className="student-summary">
                  <span>{student.section ? `Section ${student.section}` : 'Imported student'}</span>
                  {student.attendance && <strong>{student.attendance.percentage}% <small>{student.attendance.present}/{student.attendance.total}</small></strong>}
                </div>}
                <div className="mini-history"><span>Last 5</span>{(history.find(h => String(h.student_id) === String(student.id))?.statuses || []).map((s,i) => <StatusDot key={i} status={s} />)}</div>
                {student.removed ? <div className="removed-student-note"><span>×</span><div><b>Removed from batch</b><small>Kept here for attendance history</small></div></div> : <div className="mark-actions">
                  {Object.entries(STATUS).map(([key, info]) => <button key={key} className={marks[student.id] === key ? 'selected' : ''} onClick={() => markStudent(student,key)} title={`${info.label} (${info.key})`}><span>{info.icon}</span><small>{info.label}</small></button>)}
                </div>}
              </article>)}
              {!visible.length && <div className="empty-state"><b>No students found</b><span>Try a different search or filter.</span></div>}
            </div>

            <div className="pager">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Previous group</button>
              <div>{Array.from({length: totalPages}, (_,i) => <button key={i} className={i===page?'active':''} onClick={() => setPage(i)}>{i+1}</button>)}</div>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next group →</button>
            </div>
          </section>

          <footer className="keyboard-tip"><span>Keyboard</span><kbd>P</kbd> Present <kbd>A</kbd> Absent <kbd>Ctrl Z</kbd> Undo</footer>
        </> : <ProgressView students={students} history={history} dates={dates} />}
      </main>

      {sheetModal && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setSheetModal(false)}>
        <section className="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <button className="modal-close" onClick={() => setSheetModal(false)} aria-label="Close">×</button>
          <div className="google-mark">▦</div>
          <span className="eyebrow">GOOGLE SHEETS</span>
          <h2 id="sheet-title">Connect your existing class list</h2>
          <p>Paste a Google Sheet link. You’ll sign in with Google, and RollFlow will only update attendance when your account has edit permission.</p>

          {sheetConnection ? <div className="connected-sheet">
            <span className="connection-dot" />
            <div><b>{sheetConnection.sourceSheet}</b><small>{students.length} students · {sheetConnection.sections?.length || 0} sections · {sheetConnection.detectedColumns?.attendanceSessions || 0} attendance sessions detected</small></div>
          </div> : <>
            <label className="sheet-field">Google Sheet link
              <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
            </label>
            <div className="sheet-format">
              <b>Expected student columns</b>
              <span><code>Roll No</code><code>Student Name</code><code>Email</code> <i>optional</i></span>
            </div>
          </>}

          {sheetError && <div className="sheet-error">{sheetError}</div>}
          <div className="modal-actions">
            <button className="secondary-btn" onClick={() => setSheetModal(false)}>Cancel</button>
            {sheetConnection ? <>
              <button className="secondary-btn danger-text" onClick={() => {setSheetConnection(null);setSheetError('')}}>Disconnect</button>
              <button className="google-btn" disabled={sheetBusy || !markedCount} onClick={async () => {
                setSheetBusy(true); setSheetError('')
                try { await syncGoogleSheet(); setSheetModal(false) }
                catch (error) { setSheetError(error.message) }
                finally { setSheetBusy(false) }
              }}>{sheetBusy ? 'Updating…' : 'Update attendance'}</button>
            </> : <button className="google-btn" disabled={sheetBusy || !sheetUrl.trim()} onClick={connectSheet}>{sheetBusy ? 'Redirecting to Google…' : 'Continue with Google'}</button>}
          </div>
          <small className="privacy-note">RollFlow never receives your Google password. Access is handled by Google OAuth and can be revoked from your Google Account.</small>
        </section>
      </div>}

      {successDialog && <div className="modal-backdrop success-layer">
        <section className="success-dialog" role="alertdialog" aria-modal="true">
          <div className={`success-check ${successDialog.results?.some(r => r.status !== 'success') ? 'warning' : ''}`}>{successDialog.results?.some(r => r.status !== 'success') ? '!' : '✓'}</div>
          <h2>{successDialog.title}</h2>
          <p>{successDialog.detail}</p>
          {successDialog.results && <div className="backup-results">
            {successDialog.results.map(result => <div className={result.status} key={result.id}>
              <span>{result.status === 'success' ? '✓' : result.status === 'skipped' ? '–' : '!'}</span>
              <b>{result.label}</b>
              <small>{result.message}</small>
            </div>)}
          </div>}
          {successDialog.syncId && <code className="sync-id">Sync ID: {successDialog.syncId}</code>}
          <button className="save-btn" onClick={() => {setSuccessDialog(null);setSheetModal(false)}}>Done</button>
        </section>
      </div>}
    </div>
  )
}

function ProgressView({ students, history, dates }) {
  const rows = students.map(s => {
    const statuses = history.find(h => String(h.student_id) === String(s.id))?.statuses || []
    const attended = statuses.filter(x => x === 'present' || x === 'late').length
    return { ...s, statuses, rate: s.attendance?.percentage ?? (statuses.length ? Math.round(attended / statuses.length * 100) : 0) }
  }).sort((a,b) => a.rate - b.rate)
  const activeRows = rows.filter(row => !row.removed)

  return <section className="progress-panel">
    <div className="insight-row">
      <article className="insight hero"><span className="eyebrow">NEEDS ATTENTION</span><b>{activeRows.filter(r => r.rate < 75).length}</b><p>active students below 75% in the last five sessions</p></article>
      <article className="insight"><span>↗</span><div><b>{Math.round(activeRows.reduce((a,b)=>a+b.rate,0)/Math.max(activeRows.length,1))}%</b><p>class average</p></div></article>
      <article className="insight"><span>★</span><div><b>{activeRows.filter(r=>r.rate===100).length}</b><p>perfect streaks</p></div></article>
    </div>
    <div className="table-card">
      <div className="table-head"><div><span className="eyebrow">STUDENT PULSE</span><h2>Five-day attendance</h2></div><div className="legend"><span><i className="present"/>Present</span><span><i className="late"/>Late</span><span><i className="absent"/>Absent</span></div></div>
      <div className="progress-table">
        <div className="tr header"><span>Student</span>{dates.map(d=><span key={d}>{d}</span>)}<span>Rate</span></div>
        {rows.map(s => <div className={`tr ${s.removed ? 'removed-row' : ''}`} key={s.id}>
          <span className="student-cell"><i className="avatar tiny">{initials(s.name)}</i><span><b>{s.name}</b><small>{s.removed ? 'Removed from batch' : s.roll_no}</small></span></span>
          {[0,1,2,3,4].map(i => <span key={i}><StatusDot status={s.statuses[i]} /></span>)}
          <span><b className={s.rate < 75 ? 'risk' : ''}>{s.rate}%</b></span>
        </div>)}
      </div>
    </div>
  </section>
}

export default App
