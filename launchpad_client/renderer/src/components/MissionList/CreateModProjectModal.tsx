import { useEffect, useState, type FormEvent } from 'react'
import {
  AlertBanner,
  BusyBar,
  InputField,
} from './custom'

type CreateModProjectModalProps = {
  onClose: () => void
  onCreated: (res: { name: string; description: string }) => void
}

export function CreateModProjectModal({ onClose, onCreated }: CreateModProjectModalProps) {
  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, busy])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Enter a project name.')
      return
    }
    if (trimmedName.includes('/') || trimmedName.includes('\\')) {
      setError('Project name cannot contain slashes.')
      return
    }
    setBusy(true)
    onCreated({ name: trimmedName, description: description.trim() })
  }

  function handleReset() {
    setName('')
    setDescription('')
    setError(null)
  }

  const canSubmit = !busy && name.trim().length > 0

  return (
    <section
      className={`create-mission-panel absolute inset-0 z-10 flex flex-col overflow-hidden bg-surface ${mounted ? 'create-mission-panel--open' : ''}`}
      aria-label="New mod project"
      aria-labelledby="new-mod-project-title"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-subtle px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors hover:bg-app hover:text-heading disabled:opacity-50"
          aria-label="Back to mod projects"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 12L6 8l4-4" />
          </svg>
          <span className="hidden sm:inline">Mod Projects</span>
        </button>
        <div className="h-4 w-px bg-border" />
        <h2 id="new-mod-project-title" className="m-0 text-sm font-semibold text-heading">
          New Mod Project
        </h2>
      </header>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface px-4 py-4 sm:px-5 sm:py-5">
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={handleSubmit}
          id="mod-project-form"
          noValidate
        >
          <InputField
            id="mod_name"
            name="mod_name"
            label="Project name"
            autoComplete="off"
            placeholder="my_addon"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            hint="Use a short name with no slashes. This becomes the folder name."
            disabled={busy}
          />

          <InputField
            id="mod_description"
            name="mod_description"
            label="Description"
            autoComplete="off"
            placeholder="Optional description"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            hint="A brief description of what this mod does."
            disabled={busy}
          />

          {error && (
            <AlertBanner variant="error" title="Cannot create project">
              <p className="m-0">{error}</p>
            </AlertBanner>
          )}

          {busy && <BusyBar />}
        </form>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <button type="submit" form="mod-project-form" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={handleReset}
          >
            Reset
          </button>
        </div>
      </footer>
    </section>
  )
}
