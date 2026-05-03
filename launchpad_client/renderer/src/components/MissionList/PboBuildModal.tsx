import { useState } from 'react'
import type { ManagedScenario } from '../../api/launchpad'
import Util, { PboOutputExistsError } from '../../utils'
import { FileFolderInput } from '../FileFolderInput'
import { fullMissionName, defaultPboOutputFolder } from './missionUtils'

type PboBuildModalProps = {
  mission: ManagedScenario
  onClose: () => void
}

export function PboBuildModal({ mission, onClose }: PboBuildModalProps) {
  const [outDir, setOutDir] = useState(() => defaultPboOutputFolder(mission.project_path))
  const [logLines, setLogLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [overwritePath, setOverwritePath] = useState<string | null>(null)

  function handleClose() {
    if (busy) return
    setOverwritePath(null)
    onClose()
  }

  async function runBuild(overwrite = false) {
    const proj = mission.project_path?.trim()
    if (!proj) return
    setBusy(true)
    setError(null)
    setLogLines([])
    setResultPath(null)
    setOverwritePath(null)
    try {
      await Util.buildMissionPBOStream(
        proj,
        outDir.trim() || undefined,
        (ev) => {
          if (ev.type === 'log') {
            setLogLines((prev) => [...prev, ev.message])
          } else if (ev.type === 'error') {
            setError(ev.message)
          } else if (ev.type === 'done') {
            setResultPath(ev.pboPath)
          }
        },
        {
          missionName: mission.name ?? '',
          mapSuffix: mission.map_suffix ?? '',
        },
        overwrite ? { overwrite: true } : undefined,
      )
    } catch (e) {
      if (e instanceof PboOutputExistsError) {
        setOverwritePath((e.pboPath ?? '').trim() || '—')
        return
      }
      setError(e instanceof Error ? e.message : 'Build failed')
    } finally {
      setBusy(false)
    }
  }

  const missionName = fullMissionName(mission)

  return (
    <>
      <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="pbo-modal-title">
        <button
          type="button"
          className="modal-backdrop"
          aria-label="Close dialog"
          onClick={handleClose}
          disabled={busy}
        />
        <div className="modal-dialog modal-dialog-wide mission-edit-dialog pbo-build-dialog">
          <header className="mission-edit-header">
            <div className="mission-edit-header-main">
              <p className="mission-edit-eyebrow">Build mission PBO</p>
              <h2 id="pbo-modal-title" className="mission-edit-title">
                {missionName}
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
            <div className="mission-edit-section pbo-build-section">
              <p className="mission-edit-lead pbo-build-lead">
                Output file is always <strong>{missionName}.pbo</strong>. By default the folder below is{' '}
                <code className="mission-edit-code">mission_projects/output</code> (next to your mission folders).
                Clear it to write beside the mission folder, or set another parent directory. You can paste a full
                path ending in <code className="mission-edit-code">.pbo</code> - only the parent folder is used;
                the filename stays as above.
              </p>

              <label className="field">
                <span className="field-label">Output folder (optional)</span>
                <FileFolderInput
                  type="folder"
                  commit="always"
                  name="pbo_output"
                  autoComplete="off"
                  inputClassName="field-input"
                  value={outDir}
                  onChange={(v) => setOutDir(v)}
                  disabled={busy}
                  placeholder="mission_projects/output (default)"
                />
                <span className="field-hint">
                  Full path to a directory. Empty uses the PBO next to the mission folder (not the shared output
                  folder).
                </span>
              </label>

              {error ? (
                <p className="form-banner form-banner-error" role="alert">
                  {error}
                </p>
              ) : null}
              {resultPath ? (
                <p className="form-banner form-banner-success" role="status">
                  Wrote <strong>{resultPath}</strong>
                </p>
              ) : null}

              <pre className="pbo-build-log" aria-live="polite">
                {logLines.join('\n')}
              </pre>
            </div>
          </div>

          <footer className="mission-edit-footer">
            <div className="mission-edit-footer-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !mission.project_path}
                onClick={() => void runBuild(false)}
              >
                {busy ? 'Building…' : 'Build'}
              </button>
              {resultPath ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    void Util.revealPathInExplorer(resultPath, mission.project_path ?? '').catch((e) =>
                      setError(e instanceof Error ? e.message : 'Could not open Explorer'),
                    )
                  }
                >
                  Open in Explorer
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={handleClose}>
                Close
              </button>
            </div>
          </footer>
        </div>
      </div>

      {overwritePath !== null ? (
        <div
          className="modal-root modal-root-stacked"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pbo-overwrite-title"
        >
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Dismiss replace prompt"
            onClick={() => setOverwritePath(null)}
          />
          <div className="modal-dialog modal-dialog-confirm">
            <h2 id="pbo-overwrite-title" className="card-title">
              Replace existing PBO?
            </h2>
            <p className="card-body pbo-overwrite-lead">
              A file already exists at the build output path. Replace it with a new build?
            </p>
            <p className="card-body pbo-overwrite-path">
              <code className="shell-inline-code">{overwritePath}</code>
            </p>
            <div className="modal-actions pbo-overwrite-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOverwritePath(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setOverwritePath(null)
                  void runBuild(true)
                }}
              >
                Replace file
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
