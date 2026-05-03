import { useEffect, useId, useRef, useState } from 'react'
import {
  fetchManagedScenarioMods,
  saveManagedScenarioMods,
  type ManagedScenario,
  type MissionLaunchMod,
} from '../../api/launchpad'
import Util from '../../utils'
import { fullMissionName, missionModRowKey } from './missionUtils'

type ModsProfileModalProps = {
  mission: ManagedScenario
  onClose: () => void
  onModsUpdated: (mods: MissionLaunchMod[]) => void
}

export function ModsProfileModal({ mission, onClose, onModsUpdated }: ModsProfileModalProps) {
  const fileInputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<MissionLaunchMod[]>(
    Array.isArray(mission.launch_mods) ? mission.launch_mods : []
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setBusy(true)
      try {
        const loaded = await fetchManagedScenarioMods(mission.id)
        if (!cancelled) setRows(loaded)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load mission mod profile.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [mission.id])

  function handleClose() {
    if (busy) return
    onClose()
  }

  async function handleHtmlFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const text = await file.text()
      const parsed = await Util.parseModlistFromHtml(file.name, text)
      if (!parsed.mods.length) {
        setInfo('No mods were recognized in that HTML file.')
        setBusy(false)
        return
      }
      const have = new Set(rows.map((m) => m.path.toLowerCase()))
      const additions: { path: string; enabled: boolean; label: string }[] = []
      for (const mod of parsed.mods) {
        const link = mod.link.trim()
        if (!link) continue
        const key = link.toLowerCase()
        if (!have.has(key)) {
          have.add(key)
          additions.push({ path: link, enabled: true, label: mod.name?.trim() ?? '' })
        }
      }
      const merged = [...rows.map((m) => ({ ...m })), ...additions]
      const saved = await saveManagedScenarioMods(mission.id, merged)
      setRows(saved)
      onModsUpdated(saved)
      setInfo(
        additions.length
          ? `Imported ${additions.length} new mod(s).`
          : 'All recognized mods were already saved for this mission.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import mod list.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(rowKey: string, enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      const merged = rows.map((m) => (missionModRowKey(m) === rowKey ? { ...m, enabled } : m))
      const saved = await saveManagedScenarioMods(mission.id, merged)
      setRows(saved)
      onModsUpdated(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update mission mod profile.')
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    if (rows.length === 0) return
    if (!window.confirm('Clear all saved mods for this mission?')) return
    setBusy(true)
    setError(null)
    try {
      const saved = await saveManagedScenarioMods(mission.id, [])
      setRows(saved)
      onModsUpdated(saved)
      setInfo('Saved mod profile cleared for this mission.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear mission mod profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="mods-modal-title">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close dialog"
        onClick={handleClose}
        disabled={busy}
      />
      <div className="modal-dialog modal-dialog-wide mission-edit-dialog">
        <header className="mission-edit-header">
          <div className="mission-edit-header-main">
            <p className="mission-edit-eyebrow">Mission launch profile</p>
            <h2 id="mods-modal-title" className="mission-edit-title">
              {fullMissionName(mission)}
            </h2>
          </div>
          <button
            type="button"
            className="mission-edit-close"
            onClick={handleClose}
            aria-label="Close"
            disabled={busy}
          >
            <span aria-hidden>×</span>
          </button>
        </header>

        <div className="mission-edit-surface">
          <div className="mission-edit-section">
            <p className="mission-edit-lead">
              Save a mod profile just for this mission. Launchpad applies these enabled mods whenever this mission
              is started from Launchpad.
            </p>
            <div className="testing-toolbar" style={{ marginBottom: 8 }}>
              <input
                ref={fileRef}
                id={fileInputId}
                type="file"
                accept=".html,.htm,text/html"
                hidden
                onChange={(e) => void handleHtmlFile(e)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Load HTML mod list…
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !rows.length}
                onClick={() => void handleClear()}
              >
                Clear all mods
              </button>
            </div>
            {info ? (
              <p className="form-banner form-banner-success" role="status">
                {info}
              </p>
            ) : null}
            {error ? (
              <p className="form-banner form-banner-error" role="alert">
                {error}
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="card-body text-muted">
                No mods saved for this mission.
              </p>
            ) : (
              <div className="testing-mod-table-wrap">
                <table className="testing-mod-table">
                  <thead>
                    <tr>
                      <th scope="col">On</th>
                      <th scope="col">Name</th>
                      <th scope="col">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={missionModRowKey(m)}>
                        <td>
                          <input
                            type="checkbox"
                            checked={m.enabled !== false}
                            disabled={busy}
                            onChange={(e) => void handleToggle(missionModRowKey(m), e.target.checked)}
                            aria-label={`Enable mod ${m.path}`}
                          />
                        </td>
                        <td>{m.label?.trim() ? m.label : '—'}</td>
                        <td>
                          <code className="testing-mod-path">{m.path}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
