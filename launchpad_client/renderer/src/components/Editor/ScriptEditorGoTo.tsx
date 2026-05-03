import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'

export type EditorShell = {
  editor: Parameters<OnMount>[0]
  monaco: Parameters<OnMount>[1]
}

export type SymbolEntry = {
  name: string
  kind: 'function' | 'variable' | 'class'
  line: number
  column: number
}

export type ScriptEditorGoToProps = {
  open: boolean
  mode: 'line' | 'symbol'
  onOpenChange: (open: boolean) => void
  getShell: () => EditorShell | null
  documentText: string
  disabled?: boolean
}

function extractSymbols(text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fnMatch = /^\s*(\w+)\s*=\s*\{/.exec(line)
    if (fnMatch) {
      symbols.push({
        name: fnMatch[1],
        kind: 'function',
        line: i + 1,
        column: (line.indexOf(fnMatch[1]) || 0) + 1,
      })
    }

    const fnCallMatch = /^\s*(\w+)\s*=\s*compile\s/.exec(line)
    if (fnCallMatch) {
      symbols.push({
        name: fnCallMatch[1],
        kind: 'function',
        line: i + 1,
        column: (line.indexOf(fnCallMatch[1]) || 0) + 1,
      })
    }

    const privateMatch = /private\s*\[\s*"([^"]+)"/.exec(line)
    if (privateMatch) {
      symbols.push({
        name: privateMatch[1],
        kind: 'variable',
        line: i + 1,
        column: (line.indexOf(privateMatch[1]) || 0) + 1,
      })
    }

    const paramsMatch = /params\s*\[\s*(.+?)\s*\]/i.exec(line)
    if (paramsMatch) {
      const inner = paramsMatch[1]
      const varMatches = inner.matchAll(/"(_\w+)"/g)
      for (const m of varMatches) {
        symbols.push({
          name: m[1],
          kind: 'variable',
          line: i + 1,
          column: (line.indexOf(m[1]) || 0) + 1,
        })
      }
    }

    const classMatch = /^\s*class\s+(\w+)/i.exec(line)
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        kind: 'class',
        line: i + 1,
        column: (line.indexOf(classMatch[1]) || 0) + 1,
      })
    }
  }

  return symbols
}

export function ScriptEditorGoTo({
  open,
  mode,
  onOpenChange,
  getShell,
  documentText,
  disabled,
}: ScriptEditorGoToProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const labelId = useId()
  const inputId = useId()

  const symbols = useMemo(() => {
    if (mode !== 'symbol') return []
    return extractSymbols(documentText)
  }, [documentText, mode])

  const filteredSymbols = useMemo(() => {
    if (mode !== 'symbol') return []
    if (!query.trim()) return symbols
    const q = query.toLowerCase()
    return symbols.filter((s) => s.name.toLowerCase().includes(q))
  }, [symbols, query, mode])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open, mode])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onOpenChange(false)
        getShell()?.editor.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onOpenChange, getShell])

  const goToLine = useCallback(
    (lineNum: number) => {
      const shell = getShell()
      if (!shell) return
      const model = shell.editor.getModel()
      if (!model) return
      const maxLine = model.getLineCount()
      const line = Math.max(1, Math.min(lineNum, maxLine))
      shell.editor.setPosition({ lineNumber: line, column: 1 })
      shell.editor.revealLineInCenter(line)
      shell.editor.focus()
      onOpenChange(false)
    },
    [getShell, onOpenChange],
  )

  const goToSymbol = useCallback(
    (sym: SymbolEntry) => {
      const shell = getShell()
      if (!shell) return
      shell.editor.setPosition({ lineNumber: sym.line, column: sym.column })
      shell.editor.revealLineInCenter(sym.line)
      shell.editor.focus()
      onOpenChange(false)
    },
    [getShell, onOpenChange],
  )

  const handleSubmit = useCallback(() => {
    if (mode === 'line') {
      const num = parseInt(query, 10)
      if (Number.isFinite(num) && num > 0) {
        goToLine(num)
      }
    } else {
      const sym = filteredSymbols[selectedIndex]
      if (sym) {
        goToSymbol(sym)
      }
    }
  }, [mode, query, filteredSymbols, selectedIndex, goToLine, goToSymbol])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode === 'symbol') {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, filteredSymbols.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [mode, filteredSymbols.length, handleSubmit],
  )

  useEffect(() => {
    if (mode !== 'symbol' || !listRef.current) return
    const active = listRef.current.querySelector('[aria-selected="true"]') as HTMLElement | null
    if (active) {
      active.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, mode])

  if (!open) return null

  const shell = getShell()
  const lineCount = shell?.editor.getModel()?.getLineCount() ?? 0

  const kindBadge = (kind: SymbolEntry['kind'], selected: boolean) => {
    const base =
      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors [font-variation-settings:normal]'
    if (selected) {
      return `${base} bg-white/20 text-white`
    }
    if (kind === 'function') {
      return `${base} [background:color-mix(in_srgb,var(--accent)_20%,transparent)] text-accent`
    }
    if (kind === 'variable') {
      return `${base} [background:color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning`
    }
    return `${base} [background:color-mix(in_srgb,var(--success)_20%,transparent)] text-success`
  }

  return (
    <div className="mb-2.5 flex shrink-0 flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-2.5 sm:py-0">
        <label id={labelId} className="shrink-0 text-[11px] font-semibold text-muted" htmlFor={inputId}>
          {mode === 'line' ? `Go to line (1-${lineCount})` : 'Go to symbol'}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type={mode === 'line' ? 'number' : 'text'}
          className="field-input min-w-0 max-w-[220px] flex-1 [flex-basis:140px] px-2.5 py-2"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          placeholder={mode === 'line' ? 'Line number...' : 'Symbol name...'}
          min={mode === 'line' ? 1 : undefined}
          max={mode === 'line' ? lineCount : undefined}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || (mode === 'line' && !query.trim())}
          onClick={handleSubmit}
        >
          Go
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-8 w-8 p-0 text-xl leading-none"
          onClick={() => {
            onOpenChange(false)
            getShell()?.editor.focus()
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {mode === 'symbol' && filteredSymbols.length > 0 && (
        <ul className="scrollbar-subtle m-0 max-h-[min(200px,28vh)] list-none space-y-1 overflow-y-auto p-0" ref={listRef}>
          {filteredSymbols.map((sym, i) => {
            const selected = i === selectedIndex
            return (
              <li key={`${sym.name}-${sym.line}`}>
                <button
                  type="button"
                  className={[
                    'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1.5 px-2.5 text-left text-xs text-body transition-colors duration-100',
                    'rounded-[var(--radius-sm)]',
                    selected
                      ? 'bg-accent text-white'
                      : 'hover:bg-app',
                  ].join(' ')}
                  disabled={disabled}
                  aria-selected={selected}
                  onClick={() => goToSymbol(sym)}
                >
                  <span className={kindBadge(sym.kind, selected)}>
                    {sym.kind === 'function' ? 'fn' : sym.kind === 'variable' ? 'var' : 'cls'}
                  </span>
                  <span
                    className={[
                      'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono',
                      !selected && 'text-body',
                    ].join(' ')}
                  >
                    {sym.name}
                  </span>
                  <span
                    className={[
                      'shrink-0 font-mono text-[11px] text-muted',
                      selected && 'text-white/70',
                    ].join(' ')}
                  >
                    :{sym.line}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {mode === 'symbol' && query.trim() && filteredSymbols.length === 0 && (
        <p className="m-0 mt-2 py-2 px-2.5 text-xs text-muted">No symbols found</p>
      )}
    </div>
  )
}
