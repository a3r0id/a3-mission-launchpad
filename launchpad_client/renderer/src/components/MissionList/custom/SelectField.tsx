import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export type SelectOption = { value: string; label: string; disabled?: boolean }

const triggerClass =
  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-subtle py-2 pl-3 pr-3 text-left text-sm text-foreground transition-[border-color,box-shadow] hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-accent/25'

const panelBaseClass =
  'scrollbar-subtle absolute left-0 right-0 z-50 max-h-60 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-surface shadow-md ring-1 ring-black/5 dark:bg-app dark:ring-white/10'

const optionClass =
  'm-0 cursor-pointer list-none px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-subtle'

type Props = {
  id: string
  label: string
  hint?: ReactNode
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  name?: string
  placeholder?: string
  openDirection?: 'up' | 'down' | 'auto'
}

export function SelectField({
  id,
  label,
  hint,
  value,
  onChange,
  options,
  disabled = false,
  name,
  placeholder = 'Select…',
  openDirection = 'auto',
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [opensUp, setOpensUp] = useState(false)

  const selected = options.find((o) => o.value === value)
  const displayLabel = selected?.label ?? placeholder

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const checkOpenDirection = () => {
    if (openDirection === 'up') {
      setOpensUp(true)
      return
    }
    if (openDirection === 'down') {
      setOpensUp(false)
      return
    }
    if (!triggerRef.current) {
      setOpensUp(false)
      return
    }
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const dropdownHeight = Math.min(options.length * 40 + 8, 240)
    setOpensUp(spaceBelow < dropdownHeight && spaceAbove > spaceBelow)
  }

  const step = (from: number, dir: 1 | -1) => {
    const n = options.length
    if (n === 0) return 0
    let i = from
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n
      if (!options[i]?.disabled) return i
    }
    return from
  }

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const i = options.findIndex((o) => o.value === value)
        setActive(i >= 0 ? i : 0)
        checkOpenDirection()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => step(a, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => step(a, -1))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      for (let i = 0; i < options.length; i++) {
        if (!options[i].disabled) {
          setActive(i)
          break
        }
      }
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) {
          setActive(i)
          break
        }
      }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o && !o.disabled) pick(o.value)
    }
  }

  const activeId =
    open && !disabled && options[active] && !options[active].disabled
      ? `${id}-opt-${active}`
      : undefined

  useEffect(() => {
    if (!open) return
    const el = document.getElementById(`${id}-opt-${active}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  return (
    <div className="flex flex-col gap-1.5" ref={rootRef}>
      <label htmlFor={id} className="text-xs font-semibold text-heading">
        {label}
      </label>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={id}
          className={triggerClass}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          onKeyDown={onTriggerKey}
          onClick={() => {
            if (disabled) return
            if (open) {
              setOpen(false)
            } else {
              const i = options.findIndex((o) => o.value === value)
              setActive(i >= 0 ? i : 0)
              checkOpenDirection()
              setOpen(true)
            }
          }}
        >
          <span className="min-w-0 flex-1 truncate text-foreground">{displayLabel}</span>
          <span
            className="shrink-0 text-[10px] text-muted transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : undefined }}
            aria-hidden
          >
            ▼
          </span>
        </button>
        {open && !disabled ? (
          <ul
            id={listId}
            className={`${panelBaseClass} m-0 list-none p-0 ${opensUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
            role="listbox"
          >
            {options.map((o, idx) => {
              const isActive = active === idx
              const isSel = value === o.value
              const dis = o.disabled
              const isFirst = idx === 0
              const isLast = idx === options.length - 1
              const roundingClass = isFirst && isLast
                ? 'rounded-md'
                : isFirst
                  ? 'rounded-t-md'
                  : isLast
                    ? 'rounded-b-md'
                    : ''
              return (
                <li
                  key={o.value}
                  id={`${id}-opt-${idx}`}
                  role="option"
                  className={
                    dis
                      ? `${optionClass} ${roundingClass} cursor-not-allowed opacity-50`
                      : isActive
                        ? `${optionClass} ${roundingClass} bg-accent/10 font-medium text-heading`
                        : isSel
                          ? `${optionClass} ${roundingClass} font-medium text-heading`
                          : `${optionClass} ${roundingClass}`
                  }
                  aria-selected={isSel}
                  aria-disabled={dis ? true : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !dis && pick(o.value)}
                  onPointerEnter={() => !dis && setActive(idx)}
                >
                  {o.label}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      {hint ? <div className="text-xs leading-relaxed text-muted">{hint}</div> : null}
    </div>
  )
}
