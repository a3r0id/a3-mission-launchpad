import { useCallback, useEffect, useRef, useState } from 'react'
import { MissionResourceBrowser, type ScriptEditorEnvironment } from './MissionResourceBrowser'

export type { ScriptEditorEnvironment } from './MissionResourceBrowser'

const SCRIPT_EDITOR_MIN_W = 520
const SCRIPT_EDITOR_MIN_H = 340

function clampScriptEditorFrame(w: number, h: number) {
  const maxW = Math.max(SCRIPT_EDITOR_MIN_W, window.innerWidth - 48)
  const maxH = Math.max(SCRIPT_EDITOR_MIN_H, window.innerHeight - 48)
  return {
    w: Math.max(SCRIPT_EDITOR_MIN_W, Math.min(w, maxW)),
    h: Math.max(SCRIPT_EDITOR_MIN_H, Math.min(h, maxH)),
  }
}

function defaultScriptEditorFrame() {
  return clampScriptEditorFrame(
    Math.min(1120, window.innerWidth - 48),
    Math.min(Math.round(window.innerHeight * 0.88), 920),
  )
}

export type IntegratedScriptEditorProps = {
  /** Absolute project folder path (mission or mod). */
  projectRoot: string
  disabled?: boolean
  environment?: ScriptEditorEnvironment
}

/**
 * Full-height folder workspace: indexed tree, Monaco editor, and per-file save.
 * Uses the same highlighting and language rules as the mission resource browser.
 * In ``mod`` mode, the browser runs project checks and lists results (see ``MissionResourceBrowser``).
 */
export function IntegratedScriptEditor({ projectRoot, disabled, environment = 'mission' }: IntegratedScriptEditorProps) {
  return (
    <div className="integrated-script-editor">
      <MissionResourceBrowser projectRoot={projectRoot} disabled={disabled} environment={environment} />
    </div>
  )
}

export type ScriptEditorModalProps = {
  open: boolean
  projectRoot: string
  /** Shown as the main title (e.g. mission or mod name). */
  contextTitle: string
  disabled?: boolean
  environment?: ScriptEditorEnvironment
  onClose: () => void
}

/**
 * Modal shell for {@link IntegratedScriptEditor}. Use from mission/mod lists or edit flows.
 */
export function ScriptEditorModal({
  open,
  projectRoot,
  contextTitle,
  disabled,
  environment = 'mission',
  onClose,
}: ScriptEditorModalProps) {
  const lastFrameRef = useRef<{ w: number; h: number } | null>(null)
  const [frame, setFrame] = useState(() => ({ w: 960, h: 720 }))
  const resizeSession = useRef<{
    kind: 'e' | 's' | 'se'
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)

  useEffect(() => {
    if (!open) return
    const base = lastFrameRef.current ?? defaultScriptEditorFrame()
    setFrame(clampScriptEditorFrame(base.w, base.h))
  }, [open])

  const onResizePointerDown = useCallback((kind: 'e' | 's' | 'se') => {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const shell = e.currentTarget.closest('.script-editor-modal-dialog')
      const rect = shell?.getBoundingClientRect()
      if (!rect) return
      resizeSession.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
      }
      const onMove = (ev: PointerEvent) => {
        const s = resizeSession.current
        if (!s) return
        let nw = s.startW
        let nh = s.startH
        if (kind === 'e' || kind === 'se') nw = s.startW + (ev.clientX - s.startX)
        if (kind === 's' || kind === 'se') nh = s.startH + (ev.clientY - s.startY)
        const next = clampScriptEditorFrame(nw, nh)
        lastFrameRef.current = next
        setFrame(next)
      }
      const onUp = () => {
        resizeSession.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }
  }, [])

  if (!open) return null
  const root = projectRoot.trim()
  if (!root) return null

  return (
    <div
      className="modal-root modal-root-stacked"
      role="dialog"
      aria-modal="true"
      aria-labelledby="script-editor-modal-title"
    >
      <button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={() => onClose()} />
      <div
        className="modal-dialog modal-dialog-wide mission-edit-dialog script-editor-modal-dialog"
        style={{
          width: frame.w,
          height: frame.h,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        <header className="mission-edit-header">
          <div className="mission-edit-header-main">
            <p className="mission-edit-eyebrow">Script editor</p>
            <h2 id="script-editor-modal-title" className="mission-edit-title">
              {contextTitle.trim() || 'Project folder'}
            </h2>
          </div>
          <button type="button" className="mission-edit-close" onClick={() => onClose()} aria-label="Close">
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="mission-edit-surface mission-edit-section-flush script-editor-modal-body">
          <IntegratedScriptEditor projectRoot={root} disabled={disabled} environment={environment} />
        </div>
        <button
          type="button"
          className="script-editor-resize script-editor-resize-e"
          aria-label="Resize width"
          onPointerDown={onResizePointerDown('e')}
          style={{ touchAction: 'none' }}
        />
        <button
          type="button"
          className="script-editor-resize script-editor-resize-s"
          aria-label="Resize height"
          onPointerDown={onResizePointerDown('s')}
          style={{ touchAction: 'none' }}
        />
        <button
          type="button"
          className="script-editor-resize script-editor-resize-se"
          aria-label="Resize window"
          onPointerDown={onResizePointerDown('se')}
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
