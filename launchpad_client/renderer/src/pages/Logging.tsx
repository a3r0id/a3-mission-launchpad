import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closeRemoteSshSession,
  fetchRemotePartialFileContents,
  fetchRemoteRptFiles,
  fetchSettings,
  fetchPartialFileContents,
  fetchRptFiles,
  openRemoteSshSession,
  type RemoteServerSettingsEntry,
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
  const [remoteServers, setRemoteServers] = useState<RemoteServerSettingsEntry[]>([])
  const [remoteServerId, setRemoteServerId] = useState('')
  const [remoteFolder, setRemoteFolder] = useState('/home/steam/arma3')
  const [remoteManualPath, setRemoteManualPath] = useState('')
  const [remoteSessionId, setRemoteSessionId] = useState('')
  const [remoteConnErr, setRemoteConnErr] = useState<string | null>(null)
  const [remoteAuthDialogOpen, setRemoteAuthDialogOpen] = useState(false)
  const [remotePasswordInput, setRemotePasswordInput] = useState('')
  const [remotePassphraseInput, setRemotePassphraseInput] = useState('')
  const [remoteConnectBusy, setRemoteConnectBusy] = useState(false)
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
  const selectedRemoteServer = useMemo(
    () => remoteServers.find((row) => row.id === remoteServerId) ?? null,
    [remoteServers, remoteServerId],
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await fetchSettings()
        if (cancelled) return
        setRemoteServers(settings.remote_servers ?? [])
        setRemoteServerId(settings.logs_remote_default_server_id ?? '')
        setRemoteFolder(settings.logs_remote_default_folder || '/home/steam/arma3')
      } catch {
        if (cancelled) return
        setRemoteServers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (!remoteSessionId) return
      void closeRemoteSshSession(remoteSessionId).catch(() => undefined)
    }
  }, [remoteSessionId])

  useEffect(() => {
    if (!remoteSessionId) return
    void disconnectRemoteSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteServerId])

  const refreshList = useCallback(async (source: RptLogListLocation = logFolderKind) => {
    const reqId = listReqIdRef.current + 1
    listReqIdRef.current = reqId
    setLoadingList(true)
    setListErr(null)
    try {
      if (source === 'remote' && !remoteSessionId) {
        throw new Error('Connect to a remote server first.')
      }
      const res =
        source === 'remote'
          ? await fetchRemoteRptFiles(remoteSessionId, remoteFolder)
          : await fetchRptFiles(source)
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
  }, [selectedPath, logFolderKind, remoteSessionId, remoteFolder])

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
      const res =
        logFolderKind === 'remote'
          ? await fetchRemotePartialFileContents(remoteSessionId, selectedPath, start, 'init')
          : await fetchPartialFileContents(selectedPath, start)
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
  }, [selectedPath, files, scrollToBottom, logFolderKind, remoteSessionId])

  useEffect(() => {
    void loadInitialTail()
  }, [loadInitialTail])

  const pollTail = useCallback(async () => {
    if (paused || !selectedPath) return
    try {
      const res =
        logFolderKind === 'remote'
          ? await fetchRemotePartialFileContents(remoteSessionId, selectedPath, cursor, 'next')
          : await fetchPartialFileContents(selectedPath, cursor)
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
  }, [paused, selectedPath, cursor, followTail, atBottom, scrollToBottom, logFolderKind, remoteSessionId])

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

  async function disconnectRemoteSession() {
    if (!remoteSessionId) return
    try {
      await closeRemoteSshSession(remoteSessionId)
    } catch {
      /* ignore close errors */
    }
    setRemoteSessionId('')
    setRemoteConnErr(null)
    setFiles([])
    setSelectedPath('')
    setFolder('')
    setTailText('')
    setCursor(0)
    setFileSize(0)
  }

  function requestRemoteConnect() {
    if (!selectedRemoteServer) {
      setRemoteConnErr('Select a remote server first.')
      return
    }
    setRemoteConnErr(null)
    setRemotePasswordInput('')
    setRemotePassphraseInput('')
    setRemoteAuthDialogOpen(true)
  }

  async function submitRemoteConnect() {
    if (!selectedRemoteServer) {
      setRemoteConnErr('Select a remote server first.')
      setRemoteAuthDialogOpen(false)
      return
    }
    setRemoteConnectBusy(true)
    setRemoteConnErr(null)
    try {
      const opened = await openRemoteSshSession({
        host: selectedRemoteServer.host,
        port: selectedRemoteServer.port,
        username: selectedRemoteServer.username,
        auth: selectedRemoteServer.auth,
        keyPath: selectedRemoteServer.keyPath,
        password: selectedRemoteServer.auth === 'password' ? remotePasswordInput : undefined,
        passphrase: selectedRemoteServer.auth === 'key' ? remotePassphraseInput : undefined,
      })
      setRemoteSessionId(opened.session_id)
      setRemoteAuthDialogOpen(false)
      setRemotePasswordInput('')
      setRemotePassphraseInput('')
      if (logFolderKind === 'remote') {
        await refreshList('remote')
      }
    } catch (e) {
      setRemoteConnErr(e instanceof Error ? e.message : 'Could not connect to the remote server.')
    } finally {
      setRemoteConnectBusy(false)
    }
  }

  return (
    <div className="page-stack logging-page">
      {/* <header className="page-header">
        <h1 className="page-title">Logs</h1>
        <p className="page-lead">
          Open an RPT from your game profile or from Arma 3 Tools and follow it live while things run.
        </p>
      </header> */}

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
            <button
              type="button"
              className={`logging-source-btn${logFolderKind === 'remote' ? ' is-active' : ''}`}
              onClick={() => switchLogSource('remote')}
              aria-pressed={logFolderKind === 'remote'}
            >
              Remote
            </button>
          </div>
        </div>
        {logFolderKind === 'remote' ? (
          <div className="logging-toolbar">
            <label className="field logging-file-select">
              <span className="field-label">Remote server</span>
              <select
                className="field-input"
                value={remoteServerId}
                onChange={(e) => setRemoteServerId(e.target.value)}
                disabled={remoteConnectBusy}
              >
                <option value="">Select a server</option>
                {remoteServers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.username}@{row.host}:{row.port})
                  </option>
                ))}
              </select>
            </label>
            <label className="field logging-file-select">
              <span className="field-label">Remote folder</span>
              <input
                type="text"
                className="field-input"
                value={remoteFolder}
                onChange={(e) => setRemoteFolder(e.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="logging-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void (remoteSessionId ? disconnectRemoteSession() : requestRemoteConnect())}
                disabled={remoteConnectBusy}
              >
                {remoteSessionId ? 'Disconnect' : 'Connect'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void refreshList('remote')}
                disabled={!remoteSessionId || loadingList}
              >
                Refresh remote files
              </button>
            </div>
          </div>
        ) : null}
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

        {logFolderKind === 'remote' ? (
          <div className="logging-toolbar">
            <label className="field logging-file-select">
              <span className="field-label">Manual remote file path</span>
              <input
                className="field-input"
                type="text"
                value={remoteManualPath}
                onChange={(e) => setRemoteManualPath(e.target.value)}
                placeholder="/home/steam/arma3/server_console.rpt"
                spellCheck={false}
              />
            </label>
            <div className="logging-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!remoteSessionId || !remoteManualPath.trim()}
                onClick={() => {
                  const p = remoteManualPath.trim()
                  if (!p) return
                  setSelectedPath(p)
                }}
              >
                Tail manual path
              </button>
            </div>
          </div>
        ) : null}

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
        {remoteConnErr ? <p className="form-banner form-banner-error" role="alert">{remoteConnErr}</p> : null}
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
      {remoteAuthDialogOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="remote-connect-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => !remoteConnectBusy && setRemoteAuthDialogOpen(false)}
          />
          <div className="modal-dialog">
            <h2 id="remote-connect-title" className="card-title">
              Connect remote server
            </h2>
            <p className="card-body" style={{ margin: 0 }}>
              {selectedRemoteServer
                ? `${selectedRemoteServer.username}@${selectedRemoteServer.host}:${selectedRemoteServer.port}`
                : 'Selected server'}
            </p>
            {selectedRemoteServer?.auth === 'password' ? (
              <label className="field" style={{ marginTop: 12 }}>
                <span className="field-label">Password</span>
                <input
                  type="password"
                  className="field-input"
                  value={remotePasswordInput}
                  onChange={(e) => setRemotePasswordInput(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            ) : (
              <label className="field" style={{ marginTop: 12 }}>
                <span className="field-label">Key passphrase (optional)</span>
                <input
                  type="password"
                  className="field-input"
                  value={remotePassphraseInput}
                  onChange={(e) => setRemotePassphraseInput(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => void submitRemoteConnect()} disabled={remoteConnectBusy}>
                {remoteConnectBusy ? 'Connecting…' : 'Connect'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRemoteAuthDialogOpen(false)}
                disabled={remoteConnectBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
