import { useRef, useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch, faTimes } from '@fortawesome/free-solid-svg-icons'

type MissionSearchBarProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export function MissionSearchBar({ value, onChange, placeholder = 'Search missions...', disabled }: MissionSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onChange('')
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onChange])

  return (
    <div className="relative flex w-60 items-center">
      <FontAwesomeIcon
        icon={faSearch}
        className="pointer-events-none absolute left-2.5 text-xs text-muted"
      />
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded-md border border-border bg-subtle py-1.5 pl-8 pr-8 text-[13px] text-foreground transition-[border-color,background-color] duration-100 placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none"
        style={{ font: 'inherit' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {value && (
        <button
          type="button"
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[10px] text-muted transition-[background-color,color] duration-100 hover:bg-subtle hover:text-heading"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          aria-label="Clear search"
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>
      )}
    </div>
  )
}
