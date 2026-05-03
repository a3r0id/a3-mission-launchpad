import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTimes, faFloppyDisk, faCompress, faExpand } from '@fortawesome/free-solid-svg-icons'

export type OpenFileTab = {
  rel: string
  dirty: boolean
}

export type ScriptEditorTabsProps = {
  tabs: OpenFileTab[]
  activeRel: string | null
  onSelectTab: (rel: string) => void
  onCloseTab: (rel: string) => void
  onSaveTab: (rel: string) => void
  disabled?: boolean
  savingRel?: string | null
  contextTitle?: string
  fullscreen?: boolean
  onFullscreenToggle?: () => void
  onClose?: () => void
}

function fileBasename(relPosix: string): string {
  const parts = relPosix.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : relPosix
}

export function ScriptEditorTabs({
  tabs,
  activeRel,
  onSelectTab,
  onCloseTab,
  onSaveTab,
  disabled,
  savingRel,
  contextTitle,
  fullscreen,
  onFullscreenToggle,
  onClose,
}: ScriptEditorTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showScrollHint, setShowScrollHint] = useState<'left' | 'right' | 'both' | null>(null)

  const updateScrollHints = useCallback(() => {
    const el = containerRef.current
    if (!el) {
      setShowScrollHint(null)
      return
    }
    const canScrollLeft = el.scrollLeft > 2
    const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
    if (canScrollLeft && canScrollRight) setShowScrollHint('both')
    else if (canScrollLeft) setShowScrollHint('left')
    else if (canScrollRight) setShowScrollHint('right')
    else setShowScrollHint(null)
  }, [])

  useEffect(() => {
    updateScrollHints()
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollHints, { passive: true })
    window.addEventListener('resize', updateScrollHints)
    return () => {
      el.removeEventListener('scroll', updateScrollHints)
      window.removeEventListener('resize', updateScrollHints)
    }
  }, [updateScrollHints, tabs])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !activeRel) return
    const active = el.querySelector(`[data-rel="${CSS.escape(activeRel)}"]`) as HTMLElement | null
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeRel])

  const hasModalControls = Boolean(contextTitle || onFullscreenToggle || onClose)
  const hintL = showScrollHint === 'left' || showScrollHint === 'both'
  const hintR = showScrollHint === 'right' || showScrollHint === 'both'

  if (tabs.length === 0 && !hasModalControls) return null

  return (
    <div className="flex shrink-0 items-center border-b border-border bg-subtle">
      {hasModalControls && (
        <div className="flex shrink-0 items-center border-r border-border pl-3 pr-2">
          <span className="max-w-[200px] truncate text-xs font-semibold text-heading">
            {contextTitle}
          </span>
        </div>
      )}
      <div
        className={[
          'relative flex min-w-0 flex-1',
          hintL
            ? 'before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-[2] before:w-6 before:bg-gradient-to-r before:from-[var(--bg-subtle)] before:to-transparent'
            : '',
          hintR
            ? 'after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-[2] after:w-6 after:bg-gradient-to-l after:from-[var(--bg-subtle)] after:to-transparent'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div
          className="flex min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={containerRef}
        >
          {tabs.map((tab) => {
            const active = activeRel === tab.rel
            return (
              <div
                key={tab.rel}
                data-rel={tab.rel}
                className={[
                  'group flex shrink-0 items-center border-r border-border bg-subtle transition-colors duration-100',
                  active ? 'bg-surface' : 'hover:bg-app',
                  active ? 'hover:bg-surface' : '',
                ].join(' ')}
              >
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-2 py-2 pl-3 text-xs text-body disabled:cursor-default"
                  disabled={disabled}
                  onClick={() => onSelectTab(tab.rel)}
                  title={tab.rel}
                >
                  <span className="max-w-[140px] overflow-hidden text-ellipsis">{fileBasename(tab.rel)}</span>
                </button>
                {tab.dirty && (
                  <button
                    type="button"
                    className="flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-warning transition-[opacity,background,color] duration-100 hover:bg-warning/10 hover:text-warning disabled:cursor-default disabled:opacity-50"
                    disabled={disabled || savingRel === tab.rel}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSaveTab(tab.rel)
                    }}
                    aria-label={`Save ${fileBasename(tab.rel)}`}
                    title="Save (Ctrl+S)"
                  >
                    <FontAwesomeIcon icon={faFloppyDisk} className="text-[10px]" />
                  </button>
                )}
                <button
                  type="button"
                  className={[
                    'mr-1 flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted opacity-0 transition-[opacity,background] duration-100',
                    'group-hover:opacity-100',
                    'hover:bg-app hover:text-heading',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.rel)
                  }}
                  aria-label={`Close ${fileBasename(tab.rel)}`}
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {hasModalControls && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border px-1.5">
          {onFullscreenToggle && (
            <button
              type="button"
              className="flex size-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted transition-colors duration-100 hover:bg-app hover:text-heading"
              onClick={onFullscreenToggle}
              aria-pressed={fullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="flex size-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-sm text-muted transition-colors duration-100 hover:bg-app hover:text-heading"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
