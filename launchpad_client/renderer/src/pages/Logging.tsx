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
import {
  escapeRegex,
  INITIAL_TAIL_BYTES,
  logLineSeverityTextClass,
  LogFileMetaGrid,
  LogFolderPathHint,
  LogPageAlerts,
  LogRptToolbar,
  LogSourceRow,
  LogViewer,
  POLL_MS,
  RemoteConnectDialog,
  RemoteLogToolbar,
  RemoteManualPathRow,
  trimLogBuffer,
  type LogFindMatch,
  type LogLineEntry,
  logsUi,
} from '../components/Logs'

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

  const refreshList = useCallback(
    async (source: RptLogListLocation = logFolderKind) => {
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
    },
    [selectedPath, logFolderKind, remoteSessionId, remoteFolder],
  )

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

  const lines: LogLineEntry[] = useMemo(() => {
    if (!tailText) return []
    const rows = tailText.split(/\r?\n/)
    return rows.map((line, idx) => ({
      idx,
      line,
      severityClass: logLineSeverityTextClass(line),
    }))
  }, [tailText])

  const findMatches: LogFindMatch[] = useMemo(() => {
    const q = findQuery.trim()
    if (!q) return []
    const rx = new RegExp(escapeRegex(q), 'gi')
    const out: LogFindMatch[] = []
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
    const map = new Map<number, LogFindMatch[]>()
    for (const m of findMatches) {
      const existing = map.get(m.lineIdx)
      if (existing) existing.push(m)
      else map.set(m.lineIdx, [m])
    }
    return map
  }, [findMatches])

  const matchIndexById = useMemo(() => {
    const r = new Map<string, number>()
    for (let i = 0; i < findMatches.length; i += 1) {
      r.set(findMatches[i].id, i)
    }
    return r
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
      /* ignore */
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
    <div className={logsUi.page}>
      <div className={logsUi.stack}>
        <header className={logsUi.pageHeader}>
          <h1 className={logsUi.pageTitle}>Logs</h1>
          <p className={logsUi.pageLead}>
            Choose where to read from, pick a file, and watch new lines as they appear.
          </p>
        </header>
        <div className={logsUi.mainColumn}>
          <div className={logsUi.controls}>
            <LogSourceRow value={logFolderKind} onChange={switchLogSource} />
            {logFolderKind === 'remote' ? (
              <RemoteLogToolbar
                remoteServers={remoteServers}
                remoteServerId={remoteServerId}
                onRemoteServerId={setRemoteServerId}
                remoteFolder={remoteFolder}
                onRemoteFolder={setRemoteFolder}
                remoteConnectBusy={remoteConnectBusy}
                remoteSessionId={remoteSessionId}
                loadingList={loadingList}
                onConnectOrDisconnect={() =>
                  void (remoteSessionId ? disconnectRemoteSession() : requestRemoteConnect())
                }
                onRefreshRemote={() => void refreshList('remote')}
              />
            ) : null}
            <LogRptToolbar
              files={files}
              selectedPath={selectedPath}
              onSelectedPath={setSelectedPath}
              loadingList={loadingList}
              onRefreshFiles={() => void refreshList()}
              paused={paused}
              onTogglePause={() => setPaused((p) => !p)}
              followTail={followTail}
              onFollowTailChange={setFollowTail}
            />
            {logFolderKind === 'remote' ? (
              <RemoteManualPathRow
                remoteManualPath={remoteManualPath}
                onRemoteManualPath={setRemoteManualPath}
                remoteSessionId={remoteSessionId}
                onTailManualPath={() => {
                  const p = remoteManualPath.trim()
                  if (!p) return
                  setSelectedPath(p)
                }}
              />
            ) : null}
            <LogFolderPathHint folder={folder} />
            {selected ? (
              <LogFileMetaGrid selected={selected} fileSize={fileSize} lastPollTs={lastPollTs} />
            ) : null}
            <LogPageAlerts
              loadingList={loadingList}
              remoteConnErr={remoteConnErr}
              listErr={listErr}
              tailErr={tailErr}
            />
          </div>
          <div className={logsUi.viewerColumn}>
            <LogViewer
              logPaneRef={logPaneRef}
              lines={lines}
              findQuery={findQuery}
              onFindQuery={setFindQuery}
              findMatches={findMatches}
              activeMatchIdx={activeMatchIdx}
              matchesByLine={matchesByLine}
              matchIndexById={matchIndexById}
              onSetActiveMatchIdx={setActiveMatchIdx}
              onStepMatch={stepMatch}
              paused={paused}
              selectedPath={selectedPath}
              onReload={() => {
                setTailText('')
                setCursor(0)
                void loadInitialTail()
              }}
            />
          </div>
        </div>
      </div>
      <RemoteConnectDialog
        open={remoteAuthDialogOpen}
        remoteConnectBusy={remoteConnectBusy}
        selectedRemoteServer={selectedRemoteServer}
        remotePasswordInput={remotePasswordInput}
        onRemotePasswordInput={setRemotePasswordInput}
        remotePassphraseInput={remotePassphraseInput}
        onRemotePassphraseInput={setRemotePassphraseInput}
        onClose={() => setRemoteAuthDialogOpen(false)}
        onSubmit={submitRemoteConnect}
      />
    </div>
  )
}
