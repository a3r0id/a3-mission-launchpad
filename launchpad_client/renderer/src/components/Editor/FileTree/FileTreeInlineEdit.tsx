import { useCallback, useEffect, useRef, useState } from 'react'

export type InlineEditState = {
  rel: string
  kind: 'file' | 'dir'
  mode: 'rename' | 'new-file' | 'new-folder'
  initialValue: string
} | null

export type UseInlineEditProps = {
  onConfirm: (rel: string, newName: string, mode: 'rename' | 'new-file' | 'new-folder') => void | Promise<void>
  onCancel: () => void
}

export type UseInlineEditResult = {
  editState: InlineEditState
  startRename: (rel: string, kind: 'file' | 'dir', currentName: string) => void
  startNewFile: (parentRel: string) => void
  startNewFolder: (parentRel: string) => void
  cancelEdit: () => void
  isEditing: (rel: string) => boolean
}

export function useInlineEdit({ onConfirm: _onConfirm, onCancel }: UseInlineEditProps): UseInlineEditResult {
  const [editState, setEditState] = useState<InlineEditState>(null)

  const startRename = useCallback((rel: string, kind: 'file' | 'dir', currentName: string) => {
    setEditState({ rel, kind, mode: 'rename', initialValue: currentName })
  }, [])

  const startNewFile = useCallback((parentRel: string) => {
    const newRel = parentRel ? `${parentRel}/__new__` : '__new__'
    setEditState({ rel: newRel, kind: 'file', mode: 'new-file', initialValue: '' })
  }, [])

  const startNewFolder = useCallback((parentRel: string) => {
    const newRel = parentRel ? `${parentRel}/__new__` : '__new__'
    setEditState({ rel: newRel, kind: 'dir', mode: 'new-folder', initialValue: '' })
  }, [])

  const cancelEdit = useCallback(() => {
    setEditState(null)
    onCancel()
  }, [onCancel])

  const isEditing = useCallback((rel: string) => {
    return editState?.rel === rel
  }, [editState])

  return {
    editState,
    startRename,
    startNewFile,
    startNewFolder,
    cancelEdit,
    isEditing,
  }
}

export type InlineEditInputProps = {
  initialValue: string
  mode: 'rename' | 'new-file' | 'new-folder'
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function InlineEditInput({ initialValue, mode, onConfirm, onCancel }: InlineEditInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()
    
    if (mode === 'rename' && initialValue) {
      const dotIndex = initialValue.lastIndexOf('.')
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex)
      } else {
        input.select()
      }
    } else {
      input.select()
    }
  }, [initialValue, mode])

  const validate = useCallback((val: string): string | null => {
    const trimmed = val.trim()
    if (!trimmed) return 'Name cannot be empty'
    if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot contain slashes'
    if (trimmed === '.' || trimmed === '..') return 'Invalid name'
    if (trimmed.includes('\0')) return 'Invalid characters'
    if (trimmed.length > 255) return 'Name too long'
    return null
  }, [])

  const handleConfirm = useCallback(() => {
    const trimmed = value.trim()
    const validationError = validate(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }
    onConfirm(trimmed)
  }, [value, validate, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [handleConfirm, onCancel])

  const handleBlur = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed && !validate(trimmed)) {
      handleConfirm()
    } else {
      onCancel()
    }
  }, [value, validate, handleConfirm, onCancel])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <input
        ref={inputRef}
        type="text"
        className={[
          "w-full rounded-sm border border-accent bg-surface px-1.5 py-0.5 font-inherit text-xs text-foreground [box-shadow:0_0_0_2px_rgba(9,105,218,0.2)]",
          "focus:border-accent focus:outline-none focus:[box-shadow:0_0_0_2px_rgba(9,105,218,0.3)]",
          "dark:[box-shadow:0_0_0_2px_rgba(88,166,255,0.2)] dark:focus:[box-shadow:0_0_0_2px_rgba(88,166,255,0.3)]",
          error
            ? "border-error [box-shadow:0_0_0_2px_color-mix(in_srgb,var(--error)_20%,transparent)]"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={mode === 'new-folder' ? 'folder name' : 'filename'}
        spellCheck={false}
        autoComplete="off"
      />
      {error && <div className="mt-0.5 px-0.5 text-[10px] text-error">{error}</div>}
    </div>
  )
}
