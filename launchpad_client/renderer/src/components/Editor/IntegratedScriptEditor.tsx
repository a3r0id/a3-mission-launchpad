import { useCallback, useEffect, useRef, useState } from 'react'
import { MissionResourceBrowser, type ScriptEditorEnvironment } from '../MissionResourceBrowser'

export type { ScriptEditorEnvironment } from '../MissionResourceBrowser'

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
  contextTitle?: string
  fullscreen?: boolean
  onFullscreenToggle?: () => void
  onClose?: () => void
}

/**
 * Full-height folder workspace: indexed tree, Monaco editor, and per-file save.
 * Uses the same highlighting and language rules as the mission resource browser.
 * In ``mod`` mode, the browser runs project checks and lists results (see ``MissionResourceBrowser``),
 * including opening a reported file from a result and scrolling the editor to that line.
 */
export function IntegratedScriptEditor({ projectRoot, disabled, environment = 'mission', contextTitle, fullscreen, onFullscreenToggle, onClose }: IntegratedScriptEditorProps) {
  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
      <MissionResourceBrowser
        projectRoot={projectRoot}
        disabled={disabled}
        environment={environment}
        contextTitle={contextTitle}
        fullscreen={fullscreen}
        onFullscreenToggle={onFullscreenToggle}
        onClose={onClose}
      />
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
  const [fullscreen, setFullscreen] = useState(false)
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

  useEffect(() => {
    if (!open) setFullscreen(false)
  }, [open])

  const onResizePointerDown = useCallback((kind: 'e' | 's' | 'se') => {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const shell = e.currentTarget.closest('[data-script-editor-dialog]')
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
      className={`modal-root modal-root-stacked${fullscreen ? ' p-0' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="script-editor-modal-title"
    >
      <button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={() => onClose()} />
      <div
        data-script-editor-dialog
        className={`modal-dialog modal-dialog-wide mission-edit-dialog box-border flex min-h-0 min-w-0 flex-col overflow-hidden ${
          fullscreen
            ? 'script-editor-dialog--fullscreen fixed inset-0 z-[1] !m-0 !h-[100dvh] !w-[100vw] !min-w-0 !max-w-none !max-h-none rounded-none !pb-0'
            : 'relative max-w-[calc(100vw-48px)] max-h-[min(92vh,960px)] w-[min(1120px,100%)]'
        }`}
        style={
          fullscreen
            ? undefined
            : {
                width: frame.w,
                height: frame.h,
                maxWidth: 'calc(100vw - 48px)',
                maxHeight: 'calc(100vh - 48px)',
              }
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <IntegratedScriptEditor
            projectRoot={root}
            disabled={disabled}
            environment={environment}
            contextTitle={contextTitle.trim() || 'Project folder'}
            fullscreen={fullscreen}
            onFullscreenToggle={() => setFullscreen((v) => !v)}
            onClose={onClose}
          />
        </div>
        {!fullscreen && (
          <>
            <button
              type="button"
              className="absolute top-0 right-0 bottom-[18px] z-[4] w-2.5 cursor-ew-resize border-0 bg-transparent p-0 hover:bg-[rgba(9,105,218,0.06)] dark:hover:bg-[rgba(88,166,255,0.08)]"
              aria-label="Resize width"
              onPointerDown={onResizePointerDown('e')}
              style={{ touchAction: 'none' }}
            />
            <button
              type="button"
              className="absolute bottom-0 left-2.5 right-[18px] z-[4] h-2.5 cursor-ns-resize border-0 bg-transparent p-0 hover:bg-[rgba(9,105,218,0.06)] dark:hover:bg-[rgba(88,166,255,0.08)]"
              aria-label="Resize height"
              onPointerDown={onResizePointerDown('s')}
              style={{ touchAction: 'none' }}
            />
            <button
              type="button"
              className="absolute right-0 bottom-0 z-[4] h-[18px] w-[18px] cursor-nwse-resize rounded-br-[var(--radius-lg)] border-0 bg-transparent p-0 hover:bg-[rgba(9,105,218,0.06)] dark:hover:bg-[rgba(88,166,255,0.08)]"
              aria-label="Resize window"
              onPointerDown={onResizePointerDown('se')}
              style={{ touchAction: 'none' }}
            />
          </>
        )}
      </div>
    </div>
  )
}
