import { useEffect, useRef, useState } from 'react'
import { MissionBuildPage } from '../../pages/MissionBuildPage'

type CreateMissionModalProps = {
  onClose: () => void
  onOpenSettings?: () => void
  onCreated: (res: { mission_path?: string; mission_id?: string }) => void
}

export function CreateMissionModal({ onClose, onOpenSettings, onCreated }: CreateMissionModalProps) {
  const [mounted, setMounted] = useState(false)
  const footerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <section
      className={`create-mission-panel absolute inset-0 z-10 flex flex-col overflow-hidden bg-surface ${mounted ? 'create-mission-panel--open' : ''}`}
      aria-label="New mission"
      aria-labelledby="new-mission-title"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-subtle px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors hover:bg-app hover:text-heading"
          aria-label="Back to missions"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 12L6 8l4-4" />
          </svg>
          <span className="hidden sm:inline">Missions</span>
        </button>
        <div className="h-4 w-px bg-border" />
        <h2 id="new-mission-title" className="m-0 text-sm font-semibold text-heading">
          New Mission
        </h2>
      </header>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface px-4 py-4 sm:px-5 sm:py-5">
        <MissionBuildPage
          embedded
          onGoSettings={onOpenSettings}
          onBuilt={(res) => {
            onClose()
            onCreated(res)
          }}
          footerPortal={footerRef}
        />
      </div>

      <footer ref={footerRef} className="shrink-0 border-t border-border bg-surface px-4 py-3 empty:hidden sm:px-5" />
    </section>
  )
}
