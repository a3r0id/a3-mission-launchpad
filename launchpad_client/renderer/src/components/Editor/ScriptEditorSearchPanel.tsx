import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { ProjectTreeNode } from '../../api/launchpad'

type FindMatch = editor.FindMatch
type SearchScope = 'file' | 'project'

export type ProjectSearchHit = {
  rel: string
  line: number
  preview: string
}

export type EditorShell = {
  editor: Parameters<OnMount>[0]
  monaco: Parameters<OnMount>[1]
}

const BINARY_EXT = new Set([
  'paa', 'p3d', 'pbo', 'ogg', 'wav', 'wss', 'bikey', 'bin', 'lip', 'fxy', 'ebo', 'bisign',
])

const MAX_FILE_CHARS = 1_500_000
const MAX_PROJECT_HITS = 200
const MAX_HITS_PER_FILE = 30

function fileExt(rel: string): string {
  const i = rel.lastIndexOf('.')
  return i >= 0 ? rel.slice(i + 1).toLowerCase() : ''
}

function shouldSearchFile(rel: string): boolean {
  const ext = fileExt(rel)
  return !ext || !BINARY_EXT.has(ext)
}

function collectFileRels(node: ProjectTreeNode): string[] {
  if (node.kind === 'file' && node.relPath) {
    return shouldSearchFile(node.relPath) ? [node.relPath] : []
  }
  const out: string[] = []
  for (const ch of node.children ?? []) {
    out.push(...collectFileRels(ch))
  }
  return out
}

function findLineHitsInFile(text: string, query: string, matchCase: boolean, useRegex: boolean): { line: number; preview: string }[] {
  if (!query.trim()) return []
  const lines = text.split(/\r?\n/)
  const hits: { line: number; preview: string }[] = []

  if (useRegex) {
    try {
      const flags = matchCase ? 'g' : 'gi'
      const re = new RegExp(query, flags)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        if (re.test(line)) {
          re.lastIndex = 0
          const preview = line.length > 160 ? `${line.slice(0, 157)}…` : line
          hits.push({ line: i + 1, preview })
          if (hits.length >= MAX_HITS_PER_FILE) break
        }
      }
    } catch {
      return []
    }
  } else {
    const q = matchCase ? query : query.toLowerCase()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const hay = matchCase ? line : line.toLowerCase()
      if (hay.includes(q)) {
        const preview = line.length > 160 ? `${line.slice(0, 157)}…` : line
        hits.push({ line: i + 1, preview })
        if (hits.length >= MAX_HITS_PER_FILE) break
      }
    }
  }
  return hits
}

function findMatchOffsets(documentText: string, query: string, matchCase: boolean, useRegex: boolean): { start: number; end: number }[] {
  if (!query.trim()) return []
  const out: { start: number; end: number }[] = []

  if (useRegex) {
    try {
      const flags = matchCase ? 'g' : 'gi'
      const re = new RegExp(query, flags)
      let m: RegExpExecArray | null
      while ((m = re.exec(documentText)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        out.push({ start: m.index, end: m.index + m[0].length })
        if (out.length > 5000) break
      }
    } catch {
      return []
    }
  } else {
    const h = matchCase ? documentText : documentText.toLowerCase()
    const n = matchCase ? query : query.toLowerCase()
    let searchFrom = 0
    while (searchFrom <= h.length - n.length) {
      const idx = h.indexOf(n, searchFrom)
      if (idx === -1) break
      out.push({ start: idx, end: idx + query.length })
      searchFrom = idx + 1
      if (out.length > 5000) break
    }
  }
  return out
}

function offsetsToFindMatches(shell: EditorShell, offsets: { start: number; end: number }[]): FindMatch[] {
  const { editor, monaco } = shell
  const model = editor.getModel()
  if (!model || offsets.length === 0) return []
  return offsets.map(({ start, end }) => {
    const s = model.getPositionAt(start)
    const e = model.getPositionAt(end)
    const range = monaco.Range.fromPositions(s, e)
    return { range } as FindMatch
  })
}

export type ScriptEditorSearchPanelProps = {
  open: boolean
  initialReplaceMode?: boolean
  onOpenChange: (open: boolean) => void
  getShell: () => EditorShell | null
  documentText: string
  editorReadyTick: number
  fileTree: ProjectTreeNode | null
  readProjectFile: (rel: string) => Promise<string>
  onOpenFile: (rel: string, focus?: { line?: number; column?: number }) => void | Promise<void>
  onDocumentChange: (newText: string) => void
  disabled?: boolean
  focusTick?: number
}

export function ScriptEditorSearchPanel({
  open,
  initialReplaceMode = false,
  onOpenChange,
  getShell,
  documentText,
  editorReadyTick,
  fileTree,
  readProjectFile,
  onOpenFile,
  onDocumentChange,
  disabled,
  focusTick = 0,
}: ScriptEditorSearchPanelProps) {
  const findInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const decIdsRef = useRef<string[]>([])
  const openedOnceRef = useRef(false)
  const prevOpenRef = useRef(false)
  const prevQueryRef = useRef('')
  const prevCaseRef = useRef(false)
  const prevRegexRef = useRef(false)
  const projectSearchGenRef = useRef(0)

  const [query, setQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showReplace, setShowReplace] = useState(initialReplaceMode)
  const [scope, setScope] = useState<SearchScope>('file')
  const [matches, setMatches] = useState<FindMatch[]>([])
  const [matchIndex, setMatchIndex] = useState(0)
  const [projectHits, setProjectHits] = useState<ProjectSearchHit[]>([])
  const [projectBusy, setProjectBusy] = useState(false)

  const queryRef = useRef(query)
  const matchCaseRef = useRef(matchCase)
  const useRegexRef = useRef(useRegex)
  queryRef.current = query
  matchCaseRef.current = matchCase
  useRegexRef.current = useRegex

  const panelId = useId()
  const findFieldId = useId()
  const replaceFieldId = useId()
  const statusId = useId()

  useEffect(() => {
    if (open && initialReplaceMode) {
      setShowReplace(true)
    }
  }, [open, initialReplaceMode])

  useEffect(() => {
    if (!open) {
      openedOnceRef.current = false
      return
    }
    if (!openedOnceRef.current) {
      openedOnceRef.current = true
      const shell = getShell()
      if (shell) {
        const sel = shell.editor.getSelection()
        const model = shell.editor.getModel()
        if (sel && model && !sel.isEmpty()) {
          const t = model.getValueInRange(sel)
          if (t && !t.includes('\n') && t.length < 400) {
            setQuery(t)
          }
        }
      }
    }
  }, [open, getShell])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [open, focusTick])

  useEffect(() => {
    if (scope === 'file') {
      setProjectHits([])
      setProjectBusy(false)
    }
  }, [scope])

  useEffect(() => {
    if (!open || scope !== 'project' || !query.trim()) {
      setProjectHits([])
      setProjectBusy(false)
      return
    }
    if (!fileTree) {
      setProjectHits([])
      setProjectBusy(false)
      return
    }

    const gen = ++projectSearchGenRef.current
    setProjectBusy(true)
    const t = window.setTimeout(() => {
      void (async () => {
        if (gen !== projectSearchGenRef.current) return
        const rels = collectFileRels(fileTree)
        const hits: ProjectSearchHit[] = []
        const q = queryRef.current
        const mc = matchCaseRef.current
        const rx = useRegexRef.current
        try {
          for (const rel of rels) {
            if (gen !== projectSearchGenRef.current || hits.length >= MAX_PROJECT_HITS) break
            try {
              const text = await readProjectFile(rel)
              if (text.length > MAX_FILE_CHARS) continue
              const lineHits = findLineHitsInFile(text, q, mc, rx)
              for (const h of lineHits) {
                hits.push({ rel, line: h.line, preview: h.preview })
                if (hits.length >= MAX_PROJECT_HITS) break
              }
            } catch { /* skip */ }
          }
          if (gen === projectSearchGenRef.current) {
            setProjectHits(hits)
          }
        } finally {
          if (gen === projectSearchGenRef.current) {
            setProjectBusy(false)
          }
        }
      })()
    }, 420)
    return () => {
      clearTimeout(t)
      projectSearchGenRef.current += 1
      setProjectBusy(false)
    }
  }, [open, scope, query, matchCase, useRegex, fileTree, readProjectFile])

  useEffect(() => {
    const shell = getShell()
    if (!open) {
      prevOpenRef.current = false
      if (shell) {
        decIdsRef.current = shell.editor.deltaDecorations(decIdsRef.current, [])
      }
      return
    }
    if (scope === 'project') {
      if (shell) {
        decIdsRef.current = shell.editor.deltaDecorations(decIdsRef.current, [])
      }
      setMatches([])
      setMatchIndex(0)
      return
    }
    if (!query.trim()) {
      setMatches([])
      setMatchIndex(0)
      if (shell) {
        decIdsRef.current = shell.editor.deltaDecorations(decIdsRef.current, [])
      }
      return
    }
    if (!shell || editorReadyTick < 1) {
      setMatches([])
      setMatchIndex(0)
      return
    }

    const model = shell.editor.getModel()
    if (!model) {
      setMatches([])
      setMatchIndex(0)
      return
    }

    const openJustNow = open && !prevOpenRef.current
    const queryChanged = openJustNow || prevQueryRef.current !== query || prevCaseRef.current !== matchCase || prevRegexRef.current !== useRegex

    const recompute = (indexMode: 'cursor' | 'clamp') => {
      const q = queryRef.current
      const mc = matchCaseRef.current
      const rx = useRegexRef.current
      if (!q.trim()) {
        setMatches([])
        setMatchIndex(0)
        return
      }
      const text = model.getValue()
      const offsets = findMatchOffsets(text, q, mc, rx)
      const next = offsetsToFindMatches(shell, offsets)
      setMatches(next)
      if (next.length === 0) {
        setMatchIndex(0)
        return
      }
      if (indexMode === 'cursor') {
        const pos = shell.editor.getPosition()
        let idx = 0
        if (pos) {
          for (let i = 0; i < next.length; i++) {
            const sp = next[i].range.getStartPosition()
            if (sp.lineNumber > pos.lineNumber || (sp.lineNumber === pos.lineNumber && sp.column >= pos.column)) {
              idx = i
              break
            }
          }
        }
        setMatchIndex(idx)
      } else {
        setMatchIndex((prev) => Math.min(prev, next.length - 1))
      }
    }

    recompute(queryChanged ? 'cursor' : 'clamp')

    prevOpenRef.current = open
    prevQueryRef.current = query
    prevCaseRef.current = matchCase
    prevRegexRef.current = useRegex

    const disposable = model.onDidChangeContent(() => {
      recompute('clamp')
    })
    return () => {
      disposable.dispose()
    }
  }, [open, scope, query, matchCase, useRegex, documentText, editorReadyTick, getShell])

  useEffect(() => {
    const shell = getShell()
    if (scope !== 'file' || !shell || !open || !query.trim() || matches.length === 0) {
      if (shell) {
        decIdsRef.current = shell.editor.deltaDecorations(decIdsRef.current, [])
      }
      return
    }
    const decs = matches.map((m, i) => ({
      range: m.range,
      options: {
        inlineClassName: i === matchIndex ? 'script-editor-search-hit-current' : 'script-editor-search-hit',
        isWholeLine: false,
      },
    }))
    decIdsRef.current = shell.editor.deltaDecorations(decIdsRef.current, decs)
    return () => {
      const s = getShell()
      if (s) {
        decIdsRef.current = s.editor.deltaDecorations(decIdsRef.current, [])
      }
    }
  }, [matches, matchIndex, open, query, getShell, scope])

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

  const goTo = useCallback(
    (delta: number) => {
      if (scope !== 'file') return
      const shell = getShell()
      if (!shell || matches.length === 0 || !query.trim()) return
      setMatchIndex((prev) => {
        const n = matches.length
        const i = (prev + delta + n) % n
        const r = matches[i].range
        shell.editor.setSelection(r)
        shell.editor.revealRangeInCenter(r)
        return i
      })
    },
    [getShell, matches, query, scope],
  )

  const replaceCurrent = useCallback(() => {
    if (scope !== 'file') return
    const shell = getShell()
    if (!shell || matches.length === 0 || matchIndex >= matches.length) return
    const model = shell.editor.getModel()
    if (!model) return

    const match = matches[matchIndex]
    const matchedText = model.getValueInRange(match.range)
    let replacement = replaceQuery

    if (useRegex) {
      try {
        const flags = matchCase ? '' : 'i'
        const re = new RegExp(query, flags)
        replacement = matchedText.replace(re, replaceQuery)
      } catch {
        replacement = replaceQuery
      }
    }

    model.pushEditOperations([], [{ range: match.range, text: replacement }], () => null)
    onDocumentChange(model.getValue())
  }, [getShell, matches, matchIndex, query, replaceQuery, matchCase, useRegex, onDocumentChange, scope])

  const replaceAll = useCallback(() => {
    if (scope !== 'file') return
    const shell = getShell()
    if (!shell || matches.length === 0) return
    const model = shell.editor.getModel()
    if (!model) return

    const edits = matches
      .slice()
      .reverse()
      .map((match) => {
        const matchedText = model.getValueInRange(match.range)
        let replacement = replaceQuery

        if (useRegex) {
          try {
            const flags = matchCase ? '' : 'i'
            const re = new RegExp(query, flags)
            replacement = matchedText.replace(re, replaceQuery)
          } catch {
            replacement = replaceQuery
          }
        }

        return { range: match.range, text: replacement }
      })

    model.pushEditOperations([], edits, () => null)
    onDocumentChange(model.getValue())
  }, [getShell, matches, query, replaceQuery, matchCase, useRegex, onDocumentChange, scope])

  if (!open) return null

  const count = matches.length
  const statusLabel =
    scope === 'project'
      ? projectBusy
        ? 'Searching…'
        : query.trim()
          ? projectHits.length === 0
            ? 'No results'
            : `${projectHits.length} results`
          : ''
      : count === 0
        ? query.trim()
          ? 'No results'
          : ''
        : `${matchIndex + 1} of ${count}`

  return (
    <div
      className="mb-2 flex shrink-0 flex-col gap-1.5 rounded-[var(--radius)] border border-border bg-surface p-2 sm:p-2.5"
      role="search"
      aria-labelledby={panelId}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          className={[
            'mt-0.5 flex h-[26px] w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-muted transition-[color,transform] duration-100',
            'hover:enabled:text-heading',
            'disabled:cursor-default disabled:opacity-40',
            showReplace && 'rotate-90',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setShowReplace((v) => !v)}
          aria-expanded={showReplace}
          aria-label={showReplace ? 'Hide replace' : 'Show replace'}
          disabled={scope === 'project'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M3 2 L7 5 L3 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <input
              ref={findInputRef}
              id={findFieldId}
              type="text"
              className="h-7 min-w-0 max-w-80 flex-1 rounded-[var(--radius-sm)] border border-border bg-app px-2 text-xs text-body focus:border-accent focus:outline-none focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
              value={query}
              disabled={disabled}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) goTo(-1)
                  else goTo(1)
                }
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder="Find"
              aria-describedby={statusLabel ? statusId : undefined}
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className={[
                  'flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius-sm)] border text-[11px] font-semibold font-mono text-muted transition-[background,color,border-color] duration-100',
                  matchCase
                    ? 'border-accent bg-accent text-white'
                    : 'border-transparent bg-transparent hover:bg-app hover:text-heading',
                  'disabled:cursor-default disabled:opacity-50',
                ].join(' ')}
                onClick={() => setMatchCase((v) => !v)}
                disabled={disabled}
                title="Match Case"
                aria-pressed={matchCase}
              >
                Aa
              </button>
              <button
                type="button"
                className={[
                  'flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius-sm)] border text-[11px] font-semibold font-mono text-muted transition-[background,color,border-color] duration-100',
                  useRegex
                    ? 'border-accent bg-accent text-white'
                    : 'border-transparent bg-transparent hover:bg-app hover:text-heading',
                  'disabled:cursor-default disabled:opacity-50',
                ].join(' ')}
                onClick={() => setUseRegex((v) => !v)}
                disabled={disabled}
                title="Use Regular Expression"
                aria-pressed={useRegex}
              >
                .*
              </button>
            </div>
            <span id={statusId} className="min-w-[60px] shrink-0 text-center text-[11px] text-muted" aria-live="polite">
              {statusLabel}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
                disabled={disabled || scope !== 'file' || count === 0}
                onClick={() => goTo(-1)}
                aria-label="Previous match"
                title="Previous (Shift+Enter)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M6 9 L6 3 M3 6 L6 3 L9 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
                disabled={disabled || scope !== 'file' || count === 0}
                onClick={() => goTo(1)}
                aria-label="Next match"
                title="Next (Enter)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M6 3 L6 9 M3 6 L6 9 L9 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="ml-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-muted transition-[background,color] duration-100 hover:bg-app hover:text-heading"
              onClick={() => {
                onOpenChange(false)
                getShell()?.editor.focus()
              }}
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {showReplace && scope === 'file' && (
            <div className="mt-1.5 flex items-center gap-1.5 pl-0">
              <input
                ref={replaceInputRef}
                id={replaceFieldId}
                type="text"
                className="h-7 min-w-0 max-w-80 flex-1 border border-border bg-app px-2 text-xs text-body focus:border-accent focus:outline-none focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_25%,transparent)] rounded-[var(--radius-sm)]"
                value={replaceQuery}
                disabled={disabled}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    replaceCurrent()
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="Replace"
              />
              <button
                type="button"
                className="h-[26px] shrink-0 rounded-[var(--radius-sm)] border-0 bg-app px-2.5 text-[11px] font-medium text-body transition-[background,color] duration-100 hover:enabled:bg-subtle hover:enabled:text-heading disabled:cursor-default disabled:opacity-50"
                disabled={disabled || count === 0}
                onClick={replaceCurrent}
                title="Replace (Enter)"
              >
                Replace
              </button>
              <button
                type="button"
                className="h-[26px] shrink-0 rounded-[var(--radius-sm)] border-0 bg-app px-2.5 text-[11px] font-medium text-body transition-[background,color] duration-100 hover:enabled:bg-subtle hover:enabled:text-heading disabled:cursor-default disabled:opacity-50"
                disabled={disabled || count === 0}
                onClick={replaceAll}
                title="Replace All"
              >
                All
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-3 border-t border-border pt-1.5">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] has-[:checked]:text-body text-muted">
          <input
            className="m-0"
            type="radio"
            name={panelId + '-scope'}
            checked={scope === 'file'}
            disabled={disabled}
            onChange={() => setScope('file')}
          />
          <span>File</span>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] has-[:checked]:text-body text-muted">
          <input
            className="m-0"
            type="radio"
            name={panelId + '-scope'}
            checked={scope === 'project'}
            disabled={disabled}
            onChange={() => setScope('project')}
          />
          <span>Project</span>
        </label>
      </div>

      {scope === 'project' && query.trim() && !projectBusy && projectHits.length > 0 && (
        <ul className="scrollbar-subtle m-0 mt-2 max-h-[min(200px,28vh)] list-none space-y-1 overflow-y-auto p-0">
          {projectHits.map((h, i) => (
            <li key={`${h.rel}-${h.line}-${i}`}>
              <button
                type="button"
                className="flex w-full flex-col items-stretch gap-0.5 border-0 bg-transparent px-2 py-1.5 text-left text-xs transition-[background] duration-100 [cursor:pointer] rounded-[var(--radius-sm)] hover:enabled:bg-app disabled:cursor-default"
                disabled={disabled}
                onClick={() => void onOpenFile(h.rel, { line: h.line })}
              >
                <span className="break-all font-mono text-[11px] font-semibold text-accent">
                  {h.rel}:{h.line}
                </span>
                <span className="line-clamp-1 break-words font-mono text-[11px] text-muted [overflow-wrap:break-word]">
                  {h.preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
