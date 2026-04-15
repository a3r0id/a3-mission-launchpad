import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  fetchArmaProcessSnapshot,
  killArmaProcess,
  type ArmaProcessSnapshotRow,
} from '../api/launchpad'

const POLL_MS = 1600
const HISTORY_MAX = 56

type HistoryMap = Map<number, { cpu: number[]; memMb: number[] }>

function formatMemMb(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(0)} MB`
}

function formatRunningSince(createTime: number | null): string | null {
  if (createTime == null || !Number.isFinite(createTime)) return null
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - createTime))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function mergeHistory(prev: HistoryMap, rows: ArmaProcessSnapshotRow[]): HistoryMap {
  const next = new Map(prev)
  const seen = new Set<number>()
  for (const row of rows) {
    seen.add(row.pid)
    const cur = next.get(row.pid) ?? { cpu: [], memMb: [] }
    const cpu = [...cur.cpu, row.cpu_percent].slice(-HISTORY_MAX)
    const memMb = [...cur.memMb, row.memory_rss / (1024 * 1024)].slice(-HISTORY_MAX)
    next.set(row.pid, { cpu, memMb })
  }
  for (const pid of next.keys()) {
    if (!seen.has(pid)) next.delete(pid)
  }
  return next
}

function SparkBand({
  values,
  minY,
  maxY,
  className,
  gradientId,
}: {
  values: number[]
  minY: number
  maxY: number
  className: string
  gradientId: string
}) {
  const w = 100
  const h = 40
  const padX = 1
  const padY = 3
  const innerW = w - 2 * padX
  const innerH = h - 2 * padY
  const span = Math.max(maxY - minY, 1e-6)
  const vals = values.length ? (values.length === 1 ? [values[0], values[0]] : values) : [minY, minY]
  const pts = vals.map((v, i) => {
    const x = padX + (vals.length <= 1 ? innerW / 2 : (i / (vals.length - 1)) * innerW)
    const n = (Math.min(Math.max(v, minY), maxY) - minY) / span
    const y = padY + innerH - n * innerH
    return [x, y] as const
  })

  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]
  const areaD = `${lineD} L${last[0].toFixed(2)} ${(h - padY).toFixed(2)} L${first[0].toFixed(2)} ${(h - padY).toFixed(2)} Z`

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop className="proc-spark-grad-stop-a" offset="0%" />
          <stop className="proc-spark-grad-stop-b" offset="100%" />
        </linearGradient>
      </defs>
      <path d={areaD} className="proc-spark-area" fill={`url(#${gradientId})`} />
      <path d={lineD} className="proc-spark-line" fill="none" strokeWidth={1.35} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function ArmaProcessMonitor() {
  const uid = useId().replace(/:/g, '')
  const [rows, setRows] = useState<ArmaProcessSnapshotRow[]>([])
  const [sampledAt, setSampledAt] = useState<number | null>(null)
  const [pollErr, setPollErr] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [busyKillPid, setBusyKillPid] = useState<number | null>(null)
  const [killErrByPid, setKillErrByPid] = useState<Record<number, string>>({})
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )
  const historyRef = useRef<HistoryMap>(new Map())

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const tick = useCallback(async () => {
    if (paused || !visible) return
    try {
      const snap = await fetchArmaProcessSnapshot()
      historyRef.current = mergeHistory(historyRef.current, snap.processes)
      setRows(snap.processes)
      setSampledAt(snap.sampled_at_ms)
      setPollErr(null)
    } catch (e) {
      setPollErr(e instanceof Error ? e.message : 'Could not refresh')
    }
  }, [paused, visible])

  const onForceStopSession = useCallback(
    async (pid: number) => {
      if (
        !window.confirm(
          'Stop this session immediately? Unsaved progress in the game may be lost.',
        )
      ) {
        return
      }
      setBusyKillPid(pid)
      setKillErrByPid((prev) => {
        const next = { ...prev }
        delete next[pid]
        return next
      })
      try {
        await killArmaProcess(pid)
        await tick()
      } catch (e) {
        setKillErrByPid((prev) => ({
          ...prev,
          [pid]: e instanceof Error ? e.message : 'Could not stop this session.',
        }))
      } finally {
        setBusyKillPid(null)
      }
    },
    [tick],
  )

  useEffect(() => {
    void tick()
  }, [tick])

  useEffect(() => {
    if (paused || !visible) return
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => window.clearInterval(id)
  }, [tick, paused, visible])

  const live = !paused && visible && !pollErr

  const cards = useMemo(() => {
    const history = historyRef.current
    return rows.map((row, idx) => {
      const killErr = killErrByPid[row.pid]
      const killBusy = busyKillPid === row.pid
      const h = history.get(row.pid) ?? { cpu: [row.cpu_percent], memMb: [row.memory_rss / (1024 * 1024)] }
      const cpuMax = Math.max(12, ...h.cpu, row.cpu_percent * 1.08, 1)
      const memPeak = Math.max(64, ...h.memMb, row.memory_rss / (1024 * 1024), 1)
      const since = formatRunningSince(row.create_time)
      const gidCpu = `cpu-${uid}-${row.pid}-${idx}`
      const gidMem = `mem-${uid}-${row.pid}-${idx}`
      return (
        <article key={row.pid} className="proc-card" style={{ animationDelay: `${idx * 45}ms` }}>
          <div className="proc-card-glow" aria-hidden />
          <header className="proc-card-head">
            <div className="proc-card-title-block">
              <h3 className="proc-card-name">{row.name || 'Arma process'}</h3>
              <p className="proc-card-meta">
                {since ? (
                  <>
                    Up <span className="proc-card-em">{since}</span>
                    <span className="proc-card-dot" aria-hidden>
                      ·
                    </span>
                  </>
                ) : null}
                <span className="proc-card-em">{row.num_threads}</span> threads
              </p>
            </div>
            <div className="proc-card-badges">
              <span className="proc-chip proc-chip--cpu">{row.cpu_percent.toFixed(1)}% CPU</span>
              <span className="proc-chip proc-chip--mem">
                {formatMemMb(row.memory_rss / (1024 * 1024))}
              </span>
            </div>
          </header>

          <div className="proc-charts">
            <div className="proc-chart">
              <span className="proc-chart-label">Processor</span>
              <SparkBand
                values={h.cpu.length ? h.cpu : [row.cpu_percent]}
                minY={0}
                maxY={cpuMax}
                className="proc-spark proc-spark--cpu"
                gradientId={gidCpu}
              />
            </div>
            <div className="proc-chart">
              <span className="proc-chart-label">Memory</span>
              <SparkBand
                values={h.memMb.length ? h.memMb : [row.memory_rss / (1024 * 1024)]}
                minY={0}
                maxY={memPeak}
                className="proc-spark proc-spark--mem"
                gradientId={gidMem}
              />
            </div>
          </div>

          <footer className="proc-card-foot">
            <span className="proc-foot-stat">
              System share <strong>{row.memory_percent.toFixed(1)}%</strong>
            </span>
            {row.children.length > 0 ? (
              <span className="proc-foot-stat">
                Linked tasks <strong>{row.children.length}</strong>
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-xs proc-kill-btn"
              disabled={killBusy}
              onClick={() => void onForceStopSession(row.pid)}
            >
              {killBusy ? 'Stopping…' : 'Force stop'}
            </button>
          </footer>
          {killErr ? (
            <p className="proc-kill-err form-banner form-banner-error" role="alert">
              {killErr}
            </p>
          ) : null}

          {row.cmdline && row.cmdline.length > 0 ? (
            <details className="proc-details">
              <summary>How it was started</summary>
              <pre className="proc-cmd">{row.cmdline.join(' ')}</pre>
            </details>
          ) : null}
        </article>
      )
    })
  }, [rows, uid, busyKillPid, killErrByPid, onForceStopSession])

  return (
    <section className="card testing-card proc-monitor">
      <div className="proc-monitor-header">
        <div>
          <h2 className="card-title proc-monitor-title">Session radar</h2>
          {/* <p className="proc-monitor-lead">
            Live load and memory for every game process on this machine. Pause anytime—nothing leaves your PC.
          </p> */}
        </div>
        <div className="proc-monitor-controls">
          <span
            className={`proc-live-pill${live ? ' proc-live-pill--on' : ''}`}
            title={live ? 'Refreshing' : 'Idle'}
          >
            <span className="proc-live-dot" aria-hidden />
            {live ? 'Live' : paused ? 'Paused' : 'Idle'}
          </span>
          <button
            type="button"
            className="btn btn-ghost proc-pause-btn"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn-ghost proc-pause-btn" onClick={() => void tick()}>
            Refresh now
          </button>
        </div>
      </div>

      {pollErr ? (
        <p className="form-banner form-banner-error" role="alert">
          {pollErr}
        </p>
      ) : null}

      {sampledAt != null ? (
        <p className="proc-sampled">
          Last sample <time dateTime={new Date(sampledAt).toISOString()}>{new Date(sampledAt).toLocaleTimeString()}</time>
        </p>
      ) : null}

      {rows.length === 0 && !pollErr ? (
        <div className="proc-empty">
          <div className="proc-empty-icon" aria-hidden />
          <p className="proc-empty-title">No game process yet</p>
          <p className="proc-empty-hint">Launch from above and this board lights up automatically.</p>
        </div>
      ) : (
        <div className="proc-card-grid">{cards}</div>
      )}
    </section>
  )
}
