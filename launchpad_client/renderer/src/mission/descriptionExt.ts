/**
 * Parse and serialize Arma 3 Description.ext-style mission config.
 * Supports the class blocks and top-level assignments produced by Launchpad's mission generator,
 * plus typical edits (strings, numbers, numeric arrays).
 */

export type DescriptionExtModel = {
  header: Record<string, unknown>
  difficultyOverride: Record<string, unknown>
  /** Top-level key/value entries after Header / DifficultyOverride (order preserved). */
  roots: Array<{ key: string; value: unknown }>
}

export type ParseDescriptionExtResult =
  | { ok: true; model: DescriptionExtModel }
  | { ok: false; error: string }

const WS = /\s/

function stripBlockComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }
    out += src[i]
    i += 1
  }
  return out
}

function skipWs(s: string, i: number): number {
  let j = i
  while (j < s.length && WS.test(s[j]!)) j += 1
  return j
}

function parseString(s: string, start: number, quote: '"' | "'"): { end: number; value: string } | null {
  if (s[start] !== quote) return null
  let j = start + 1
  let out = ''
  while (j < s.length) {
    const c = s[j]!
    if (c === '\\' && j + 1 < s.length) {
      out += s[j + 1]!
      j += 2
      continue
    }
    if (c === quote) return { end: j + 1, value: out }
    out += c
    j += 1
  }
  return null
}

function parseNumber(s: string, start: number): { end: number; value: number } | null {
  let j = start
  if (s[j] === '-') j += 1
  if (j >= s.length || !/\d/.test(s[j]!)) return null
  while (j < s.length && /\d/.test(s[j]!)) j += 1
  if (j < s.length && s[j] === '.') {
    j += 1
    while (j < s.length && /\d/.test(s[j]!)) j += 1
  }
  const raw = s.slice(start, j)
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return { end: j, value: n }
}

function parseArray(s: string, start: number): { end: number; value: unknown[] } | null {
  if (s[start] !== '{') return null
  let j = start + 1
  const items: unknown[] = []
  while (true) {
    j = skipWs(s, j)
    if (j >= s.length) return null
    if (s[j] === '}') return { end: j + 1, value: items }
    let el: unknown
    if (s[j] === '"' || s[j] === "'") {
      const q = s[j] as '"' | "'"
      const str = parseString(s, j, q)
      if (!str) return null
      el = str.value
      j = str.end
    } else {
      const num = parseNumber(s, j)
      if (num) {
        el = num.value
        j = num.end
      } else {
        const identMatch = /^[A-Za-z_][\w]*/.exec(s.slice(j))
        if (!identMatch) return null
        el = identMatch[0]
        j += identMatch[0].length
      }
    }
    items.push(el)
    j = skipWs(s, j)
    if (s[j] === ',') {
      j += 1
      continue
    }
    if (s[j] === '}') return { end: j + 1, value: items }
    return null
  }
}

function parseValue(s: string, start: number): { end: number; value: unknown } | null {
  const i = skipWs(s, start)
  if (i >= s.length) return null
  const c = s[i]!
  if (c === '"' || c === "'") {
    const str = parseString(s, i, c as '"' | "'")
    return str ? { end: str.end, value: str.value } : null
  }
  if (c === '{') {
    const arr = parseArray(s, i)
    return arr ? { end: arr.end, value: arr.value } : null
  }
  const num = parseNumber(s, i)
  if (num) return num
  const identMatch = /^[A-Za-z_][\w]*/.exec(s.slice(i))
  if (identMatch) return { end: i + identMatch[0].length, value: identMatch[0] }
  return null
}

function parseClassBody(s: string, bodyStart: number, bodyEnd: number): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  let i = bodyStart
  while (i < bodyEnd) {
    i = skipWs(s, i)
    if (i >= bodyEnd) break
    const keyMatch = /^[A-Za-z_][\w]*/.exec(s.slice(i))
    if (!keyMatch) return null
    const key = keyMatch[0]
    i += key.length
    i = skipWs(s, i)
    if (s[i] !== '=') return null
    i += 1
    const val = parseValue(s, i)
    if (!val) return null
    out[key] = val.value
    i = skipWs(s, val.end)
    if (i >= bodyEnd) break
    if (s[i] === ';') {
      i += 1
      continue
    }
    return null
  }
  return out
}

function matchClass(
  s: string,
  start: number,
  className: string,
): { bodyStart: number; bodyEnd: number; end: number } | null {
  let i = skipWs(s, start)
  if (!s.slice(i).toLowerCase().startsWith('class')) return null
  i += 5
  i = skipWs(s, i)
  const nameMatch = /^[A-Za-z_][\w]*/.exec(s.slice(i))
  if (!nameMatch || nameMatch[0].toLowerCase() !== className.toLowerCase()) return null
  i += nameMatch[0].length
  i = skipWs(s, i)
  if (s[i] !== '{') return null
  i += 1
  let depth = 1
  const bodyStart = i
  while (i < s.length && depth > 0) {
    const ch = s[i]!
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    i += 1
  }
  if (depth !== 0) return null
  const bodyEnd = i - 1
  return { bodyStart, bodyEnd, end: i }
}

/** Reads ``key = value;`` lines until the next ``class`` keyword or end of string. */
function parseOptionalLeadingRoots(
  s: string,
  start: number,
): { roots: Array<{ key: string; value: unknown }>; pos: number } | null {
  const roots: Array<{ key: string; value: unknown }> = []
  let i = start
  while (true) {
    i = skipWs(s, i)
    if (i >= s.length) return { roots, pos: i }
    const rest = s.slice(i)
    if (/^class(?![A-Za-z0-9_])/i.test(rest)) return { roots, pos: i }
    const keyMatch = /^[A-Za-z_][\w]*/.exec(rest)
    if (!keyMatch) return null
    const key = keyMatch[0]
    i += key.length
    i = skipWs(s, i)
    if (s[i] !== '=') return null
    i += 1
    const val = parseValue(s, i)
    if (!val) return null
    roots.push({ key, value: val.value })
    i = skipWs(s, val.end)
    if (i < s.length && s[i] === ';') i += 1
  }
}

function parseAssignmentsOutsideClasses(s: string): Array<{ key: string; value: unknown }> | null {
  const roots: Array<{ key: string; value: unknown }> = []
  let i = 0
  while (i < s.length) {
    i = skipWs(s, i)
    if (i >= s.length) break
    if (s.slice(i, i + 5).toLowerCase() === 'class' && WS.test(s[i + 5] ?? ' ')) {
      const nameMatch = /^class\s+[A-Za-z_][\w]*/i.exec(s.slice(i))
      if (!nameMatch) return null
      i += nameMatch[0].length
      i = skipWs(s, i)
      if (s[i] !== '{') return null
      let depth = 1
      i += 1
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth += 1
        else if (s[i] === '}') depth -= 1
        i += 1
      }
      continue
    }
    const keyMatch = /^[A-Za-z_][\w]*/.exec(s.slice(i))
    if (!keyMatch) {
      if (s[i] === ';') {
        i += 1
        continue
      }
      return null
    }
    const key = keyMatch[0]
    i += key.length
    i = skipWs(s, i)
    if (s[i] !== '=') return null
    i += 1
    const val = parseValue(s, i)
    if (!val) return null
    roots.push({ key, value: val.value })
    i = skipWs(s, val.end)
    if (i < s.length && s[i] === ';') i += 1
  }
  return roots
}

/**
 * Full parse of a Launchpad-style Description.ext into structured fields.
 */
export function parseDescriptionExt(source: string): ParseDescriptionExtResult {
  const stripped = stripBlockComments(source)
  const headerBlock = matchClass(stripped, 0, 'Header')
  let header: Record<string, unknown> = {}
  let difficultyOverride: Record<string, unknown> = {}
  let scan = 0
  if (headerBlock) {
    const inner = parseClassBody(stripped, headerBlock.bodyStart, headerBlock.bodyEnd)
    if (!inner) return { ok: false, error: 'Could not read the Header section.' }
    header = inner
    scan = headerBlock.end
  }
  const beforeDiff = parseOptionalLeadingRoots(stripped, scan)
  if (!beforeDiff) return { ok: false, error: 'Could not read mission options before the difficulty section.' }
  scan = beforeDiff.pos
  const rootsPrefix = beforeDiff.roots
  const diffBlock = matchClass(stripped, scan, 'DifficultyOverride')
  if (diffBlock) {
    const inner = parseClassBody(stripped, diffBlock.bodyStart, diffBlock.bodyEnd)
    if (!inner) return { ok: false, error: 'Could not read the Difficulty section.' }
    difficultyOverride = inner
    scan = diffBlock.end
  }
  const rest = stripped.slice(scan)
  const rootsSuffix = parseAssignmentsOutsideClasses(rest)
  if (!rootsSuffix) return { ok: false, error: 'Could not read remaining mission option lines.' }
  return { ok: true, model: { header, difficultyOverride, roots: [...rootsPrefix, ...rootsSuffix] } }
}

function formatExtValue(value: unknown): string {
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (Array.isArray(value)) return `{ ${value.map((v) => formatExtValue(v)).join(', ')} }`
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value === null || value === undefined) return '0'
  return String(value)
}

function serializeClass(name: string, props: Record<string, unknown>): string {
  const lines = Object.entries(props).map(([k, v]) => `    ${k} = ${formatExtValue(v)};`)
  return `class ${name} {\n${lines.join('\n')}\n}\n\n`
}

/**
 * Serialize a model to UTF-8 text matching the layout produced by new-mission generation.
 */
export function serializeDescriptionExt(
  model: DescriptionExtModel,
  options: { author: string; bannerNote?: string },
): string {
  const generationTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const note = options.bannerNote ?? 'This file was generated by A3 Launchpad.'
  let out = `/**\n    --${note}--\n    Author: ${options.author}\n    File: Description.ext\n    Time: ${generationTime}\n*/\n`
  out += serializeClass('Header', model.header)
  out += serializeClass('DifficultyOverride', model.difficultyOverride)
  for (const { key, value } of model.roots) {
    out += `${key} = ${formatExtValue(value)};\n`
  }
  return out
}

/** Best-effort game type for list badges when a full parse is not needed. */
export function extractGameTypeFromDescriptionExt(source: string): string {
  const stripped = stripBlockComments(source)
  const block = matchClass(stripped, 0, 'Header')
  if (!block) return ''
  const slice = stripped.slice(block.bodyStart, block.bodyEnd)
  const m = /gameType\s*=\s*"([^"]*)"/i.exec(slice) ?? /gameType\s*=\s*'([^']*)'/i.exec(slice)
  return m?.[1]?.trim() ?? ''
}

export function missionDescriptionExtPath(projectRoot: string): string {
  const root = projectRoot.trim().replace(/[/\\]+$/, '')
  const sep = /\\/.test(root) && !/\//.test(root) ? '\\' : '/'
  return `${root}${sep}Description.ext`
}
