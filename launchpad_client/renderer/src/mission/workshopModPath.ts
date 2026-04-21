/**
 * Paths for mods stored under Settings → workshop folder: `{workshop}/@{folder}`.
 * Used when importing presets and when showing launch hints.
 */

function expandEnvInPath(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, name: string) => {
    try {
      if (typeof process !== 'undefined' && process.env && name in process.env) {
        return process.env[name] ?? ''
      }
    } catch {
      /* ignore */
    }
    return ''
  })
}

/** True if this looks like a single Arma mod folder token, not a URL or filesystem path. */
export function isWorkshopModFolderToken(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  if (t.includes('/') || t.includes('\\')) return false
  if (t.includes('..')) return false
  if (/^https?:\/\//i.test(t)) return false
  if (/^steam:/i.test(t)) return false
  return /^@?[A-Za-z0-9_.-]+$/.test(t)
}

/** Pick `@Name` from a preset display name, or build a stable slug (fallback `@mod_{id}`). */
export function atModFolderNameFromPresetLabel(displayName: string, workshopItemId: number): string {
  const n = displayName.trim()
  const embedded = n.match(/@([A-Za-z0-9_.-]+)/)
  if (embedded) return `@${embedded[1]}`
  const slug = n
    .replace(/@[A-Za-z0-9_.-]+/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase()
  const base = slug || `mod_${workshopItemId}`
  return `@${base}`
}

/** Full path: `{workshopRoot}/@{name}` with separators matching the workshop path. */
export function joinWorkshopModPath(workshopRoot: string, atFolderName: string): string {
  const root = expandEnvInPath(workshopRoot.trim()).replace(/[/\\]+$/, '')
  if (!root) return ''
  let folder = atFolderName.trim()
  if (!folder.startsWith('@')) folder = `@${folder.replace(/^@+/, '')}`
  const sep = /\\/.test(root) && !/\//.test(root) ? '\\' : '/'
  return `${root}${sep}${folder}`
}

/** Path to save for an HTML preset row when a workshop folder is configured in Settings. */
export function pathForImportedHtmlMod(workshopRoot: string, displayName: string, workshopItemId: number): string {
  return joinWorkshopModPath(workshopRoot, atModFolderNameFromPresetLabel(displayName, workshopItemId))
}
