import { useCallback, useEffect, useState } from 'react'

export type ModProjectTableColumnId = 'name' | 'description' | 'folder'

const LS_FAV = 'launchpad.modProjectList.favorites'
const LS_WIDTHS = 'launchpad.modProjectList.columnWidths'

export const MOD_PROJECT_DEFAULT_COLUMN_ORDER: ModProjectTableColumnId[] = ['name', 'description', 'folder']

export const MOD_PROJECT_DEFAULT_COLUMN_WIDTHS: Record<ModProjectTableColumnId, number> = {
  name: 200,
  description: 280,
  folder: 140,
}

const MIN_COL = 64
const MAX_COL = 480

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeWidths(w: unknown): Record<ModProjectTableColumnId, number> {
  const out = { ...MOD_PROJECT_DEFAULT_COLUMN_WIDTHS }
  if (!w || typeof w !== 'object') return out
  for (const id of MOD_PROJECT_DEFAULT_COLUMN_ORDER) {
    const n = (w as Record<string, unknown>)[id]
    if (typeof n === 'number' && Number.isFinite(n)) {
      out[id] = Math.min(MAX_COL, Math.max(MIN_COL, Math.round(n)))
    }
  }
  return out
}

export function loadModProjectFavoriteIds(): Set<string> {
  const raw = parseJson<string[] | null>(localStorage.getItem(LS_FAV), null)
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((x) => typeof x === 'string' && x.trim()))
}

export function saveModProjectFavoriteIds(ids: Set<string>) {
  localStorage.setItem(LS_FAV, JSON.stringify([...ids]))
}

export function loadModProjectColumnWidths(): Record<ModProjectTableColumnId, number> {
  return normalizeWidths(parseJson(localStorage.getItem(LS_WIDTHS), MOD_PROJECT_DEFAULT_COLUMN_WIDTHS))
}

export function saveModProjectColumnWidths(widths: Record<ModProjectTableColumnId, number>) {
  localStorage.setItem(LS_WIDTHS, JSON.stringify(normalizeWidths(widths)))
}

export function useModProjectListPreferences() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(loadModProjectFavoriteIds)
  const [columnWidths, setColumnWidths] = useState<Record<ModProjectTableColumnId, number>>(loadModProjectColumnWidths)

  useEffect(() => {
    saveModProjectFavoriteIds(favoriteIds)
  }, [favoriteIds])

  useEffect(() => {
    saveModProjectColumnWidths(columnWidths)
  }, [columnWidths])

  const toggleFavorite = useCallback((projectId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  const setColumnWidth = useCallback((id: ModProjectTableColumnId, px: number) => {
    const w = Math.min(MAX_COL, Math.max(MIN_COL, Math.round(px)))
    setColumnWidths((prev) => ({ ...prev, [id]: w }))
  }, [])

  return {
    favoriteIds,
    toggleFavorite,
    columnWidths,
    setColumnWidth,
  }
}
