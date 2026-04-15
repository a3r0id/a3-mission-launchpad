import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchPartialFileContents,
  fetchRptFiles,
  type RptFileEntry,
  type RptLogListLocation,
} from '../api/launchpad'

const POLL_MS = 1250
const INITIAL_TAIL_BYTES = 220_000
const MAX_BUFFER_CHARS = 1_200_000

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDate(ts: number): string {
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function severityClass(line: string): string {
  const u = line.toUpperCase()
  if (u.includes(' ERROR ') || u.startsWith('ERROR') || u.includes(' EXCEPTION')) return 'is-error'
  if (u.includes(' WARNING ') || u.startsWith('WARNING')) return 'is-warn'
  if (u.includes(' SCRIPT ') || u.includes('ASSERT')) return 'is-script'
  if (u.includes(' SERVER ') || u.includes(' CLIENT ')) return 'is-net'
  return ''
}

function trimLogBuffer(text: string): string {
  if (text.length <= MAX_BUFFER_CHARS) return text
  const sliced = text.slice(text.length - MAX_BUFFER_CHARS)
  const firstNewline = sliced.indexOf('\n')
  return firstNewline >= 0 ? sliced.slice(firstNewline + 1) : sliced
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function LoggingPage() {
  const [logFolderKind, setLogFolderKind] = useState<RptLogListLocation>('profile')
  const [files, setFiles] = useState<RptFileEntry[]>([])
  const [folder, setFolder] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [listErr, setListErr] = useState<string | null>(null)
  const [tailErr, setTailErr] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [tailText, setTailText] = useState('')
  const [cursor, setCursor] = useState(0)
  const [fileSize, setFileSize] = useState(0)
  const [lastPollTs, setLastPollTs] = useState<number | null>(null)
  const [followTail, setFollowTail] = useState(true)
  const [findQuery, setFindQuery] = useState('')
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)
  const logPaneRef = useRef<HTMLDivElement | null>(null)
  const listReqIdRef = useRef(0)

  const selected = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  )

  const atBottom = useCallback(() => {
    const el = logPaneRef.current
    if (!el) return true
    return el.scrollHeight - (el.scrollTop + el.clientHeight) < 32
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = logPaneRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const refreshList = useCallback(async (source: RptLogListLocation = logFolderKind) => {
    const reqId = listReqIdRef.current + 1
    listReqIdRef.current = reqId
    setLoadingList(true)
    setListErr(null)
    try {
      const res = await fetchRptFiles(source)
      if (listReqIdRef.current !== reqId) return
      setFiles(res.rpt_files)
      setFolder(res.folder)
      if (!selectedPath && res.rpt_files.length > 0) {
        setSelectedPath(res.rpt_files[0].path)
      } else if (selectedPath && !res.rpt_files.some((f) => f.path === selectedPath)) {
        setSelectedPath(res.rpt_files[0]?.path ?? '')
      }
    } catch (e) {
      if (listReqIdRef.current !== reqId) return
      setListErr(e instanceof Error ? e.message : 'Could not list log files')
      setFiles([])
    } finally {
      if (listReqIdRef.current === reqId) setLoadingList(false)
    }
  }, [selectedPath, logFolderKind])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const loadInitialTail = useCallback(async () => {
    if (!selectedPath) {
      setTailText('')
      setCursor(0)
      setFileSize(0)
      return
    }
    setTailErr(null)
    try {
      const file = files.find((f) => f.path === selectedPath)
      const start = file ? Math.max(0, file.size - INITIAL_TAIL_BYTES) : 0
      const res = await fetchPartialFileContents(selectedPath, start)
      setTailText(trimLogBuffer(res.content))
      setCursor(res.end)
      setFileSize(res.file_size)
      setLastPollTs(Date.now())
      requestAnimationFrame(() => scrollToBottom())
    } catch (e) {
      setTailErr(e instanceof Error ? e.message : 'Could not read selected log')
      setTailText('')
      setCursor(0)
      setFileSize(0)
    }
  }, [selectedPath, files, scrollToBottom])

  useEffect(() => {
    void loadInitialTail()
  }, [loadInitialTail])

  const pollTail = useCallback(async () => {
    if (paused || !selectedPath) return
    try {
      const res = await fetchPartialFileContents(selectedPath, cursor)
      setFileSize(res.file_size)
      setLastPollTs(Date.now())
      if (res.file_size < cursor) {
        setTailText(trimLogBuffer(res.content))
        setCursor(res.end)
        if (followTail) requestAnimationFrame(() => scrollToBottom())
        return
      }
      if (!res.content) {
        setCursor(res.end)
        return
      }
      const shouldFollow = followTail && atBottom()
      setTailText((prev) => trimLogBuffer(prev + res.content))
      setCursor(res.end)
      if (shouldFollow) requestAnimationFrame(() => scrollToBottom())
      setTailErr(null)
    } catch (e) {
      setTailErr(e instanceof Error ? e.message : 'Log tail polling failed')
    }
  }, [paused, selectedPath, cursor, followTail, atBottom, scrollToBottom])

  useEffect(() => {
    if (paused || !selectedPath) return
    const id = window.setInterval(() => void pollTail(), POLL_MS)
    return () => window.clearInterval(id)
  }, [paused, selectedPath, pollTail])

  const lines = useMemo(() => {
    if (!tailText) return []
    const rows = tailText.split(/\r?\n/)
    return rows.map((line, idx) => ({ idx, line, cls: severityClass(line) }))
  }, [tailText])

  const findMatches = useMemo(() => {
    const q = findQuery.trim()
    if (!q) return [] as { id: string; lineIdx: number; start: number; end: number }[]
    const rx = new RegExp(escapeRegex(q), 'gi')
    const out: { id: string; lineIdx: number; start: number; end: number }[] = []
    for (const row of lines) {
      rx.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rx.exec(row.line)) !== null) {
        const start = m.index
        const end = start + m[0].length
        out.push({ id: `${row.idx}:${start}`, lineIdx: row.idx, start, end })
        if (m[0].length === 0) rx.lastIndex += 1
      }
    }
    return out
  }, [lines, findQuery])

  const matchesByLine = useMemo(() => {
    const map = new Map<number, { id: string; lineIdx: number; start: number; end: number }[]>()
    for (const m of findMatches) {
      const existing = map.get(m.lineIdx)
      if (existing) existing.push(m)
      else map.set(m.lineIdx, [m])
    }
    return map
  }, [findMatches])

  const matchIndexById = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < findMatches.length; i += 1) {
      map.set(findMatches[i].id, i)
    }
    return map
  }, [findMatches])

  useEffect(() => {
    if (!findMatches.length) {
      setActiveMatchIdx(0)
      return
    }
    setActiveMatchIdx((prev) => {
      if (prev < 0) return 0
      if (prev >= findMatches.length) return findMatches.length - 1
      return prev
    })
  }, [findMatches])

  useEffect(() => {
    if (!findMatches.length) return
    const active = findMatches[activeMatchIdx]
    if (!active) return
    const el = logPaneRef.current?.querySelector(`[data-find-id="${active.id}"]`)
    if (!el) return
    ;(el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [activeMatchIdx, findMatches])

  function stepMatch(dir: 1 | -1) {
    if (!findMatches.length) return
    setActiveMatchIdx((prev) => {
      const n = findMatches.length
      return (prev + dir + n) % n
    })
  }

  function switchLogSource(source: RptLogListLocation) {
    if (source === logFolderKind) return
    setLogFolderKind(source)
    setSelectedPath('')
    setFiles([])
    setFolder('')
    setTailText('')
    setCursor(0)
    setFileSize(0)
    setTailErr(null)
  }

  return (
    <div className="page-stack logging-page">
      <header className="page-header">
        <h1 className="page-title">Logs</h1>
        <p className="page-lead">
          Open an RPT from your game profile or from Arma 3 Tools and follow it live while things run.
        </p>
      </header>

      <section className="card form-card">
        <div className="logging-source-row">
          <span className="field-label" id="logging-source-label">
            Logs from
          </span>
          <div
            className="logging-source-switch"
            role="group"
            aria-labelledby="logging-source-label"
          >
            <button
              type="button"
              className={`logging-source-btn${logFolderKind === 'profile' ? ' is-active' : ''}`}
              onClick={() => switchLogSource('profile')}
              aria-pressed={logFolderKind === 'profile'}
            >
              Profile
            </button>
            <button
              type="button"
              className={`logging-source-btn${logFolderKind === 'tools' ? ' is-active' : ''}`}
              onClick={() => switchLogSource('tools')}
              aria-pressed={logFolderKind === 'tools'}
            >
              Tools
            </button>
          </div>
        </div>
        <div className="logging-toolbar">
          <label className="field logging-file-select">
            <span className="field-label">RPT file</span>
            <select
              className="field-input"
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              disabled={loadingList || !files.length}
            >
              {!files.length ? <option value="">No RPT files</option> : null}
              {files.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="logging-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void refreshList()} disabled={loadingList}>
              Refresh files
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPaused((p) => !p)} disabled={!selectedPath}>
              {paused ? 'Resume live' : 'Pause live'}
            </button>
            <label className="logging-follow">
              <input
                type="checkbox"
                checked={followTail}
                onChange={(e) => setFollowTail(e.target.checked)}
              />
              <span>Auto-follow</span>
            </label>
          </div>
        </div>

        {folder ? (
          <p className="field-hint">
            Source folder: <span className="shell-inline-code">{folder}</span>
          </p>
        ) : null}

        {selected ? (
          <div className="logging-meta-grid">
            <div><strong>Name:</strong> {selected.name}</div>
            <div><strong>Size:</strong> {fmtBytes(fileSize || selected.size)}</div>
            <div><strong>Modified:</strong> {fmtDate(selected.modified_ts)}</div>
            <div><strong>Last poll:</strong> {lastPollTs ? new Date(lastPollTs).toLocaleTimeString() : '—'}</div>
          </div>
        ) : null}

        {loadingList ? <p className="card-body">Loading files…</p> : null}
        {listErr ? <p className="form-banner form-banner-error" role="alert">{listErr}</p> : null}
        {tailErr ? <p className="form-banner form-banner-error" role="alert">{tailErr}</p> : null}

        <div className="log-view-shell">
          <div className="log-view-head">
            <span className={`log-live-dot${!paused && selectedPath ? ' is-live' : ''}`} />
            <span>{!selectedPath ? 'Select a file' : paused ? 'Live paused' : 'Live tailing'}</span>
            <span className="log-view-spacer" />
            <div className="log-find">
              <input
                type="text"
                className="field-input log-find-input"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    stepMatch(e.shiftKey ? -1 : 1)
                  }
                }}
                placeholder="Find in log"
                spellCheck={false}
                aria-label="Find text in log"
              />
              <span className="log-find-count">
                {findMatches.length ? `${activeMatchIdx + 1}/${findMatches.length}` : '0/0'}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => stepMatch(-1)}
                disabled={!findMatches.length}
                aria-label="Previous match"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => stepMatch(1)}
                disabled={!findMatches.length}
                aria-label="Next match"
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setTailText('')
                setCursor(0)
                void loadInitialTail()
              }}
              disabled={!selectedPath}
            >
              Reload
            </button>
          </div>
          <div className="log-view-pane" ref={logPaneRef}>
            {lines.length === 0 ? (
              <p className="log-empty">No log lines yet.</p>
            ) : (
              <pre className="log-pre">
                {lines.map((entry) => {
                  const q = findQuery.trim()
                  if (!q) {
                    return (
                      <div key={entry.idx} className={`log-line ${entry.cls}`}>
                        {entry.line || ' '}
                      </div>
                    )
                  }
                  const lineMatches = matchesByLine.get(entry.idx) ?? []
                  if (!lineMatches.length) {
                    return (
                      <div key={entry.idx} className={`log-line ${entry.cls}`}>
                        {entry.line || ' '}
                      </div>
                    )
                  }
                  let cursorPos = 0
                  return (
                    <div key={entry.idx} className={`log-line ${entry.cls}`}>
                      {lineMatches.map((m) => {
                        const start = m.start
                        const end = m.end
                        const isActive = findMatches[activeMatchIdx]?.id === m.id
                        const before = entry.line.slice(cursorPos, start)
                        const hit = entry.line.slice(start, end)
                        cursorPos = end
                        return (
                          <span key={m.id}>
                            {before}
                            <button
                              type="button"
                              className={`log-find-hit${isActive ? ' is-active' : ''}`}
                              data-find-id={m.id}
                              onClick={() => {
                                const i = matchIndexById.get(m.id) ?? -1
                                if (i >= 0) setActiveMatchIdx(i)
                              }}
                            >
                              {hit}
                            </button>
                          </span>
                        )
                      })}
                      {entry.line.slice(cursorPos) || (entry.line.length === 0 ? ' ' : '')}
                    </div>
                  )
                })}
              </pre>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
