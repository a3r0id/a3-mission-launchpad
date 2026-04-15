import { loader } from '@monaco-editor/react'
import { shikiToMonaco } from '@shikijs/monaco'
import { createBundledHighlighter } from '@shikijs/core'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import type { Monaco } from '@monaco-editor/react'
import * as monacoEditor from 'monaco-editor'

import extGrammar from '../../../launchpad_server/thirdparty/syntax/ext.min.json'
import sqfGrammar from '../../../launchpad_server/thirdparty/syntax/sqf.min.json'

const MISSION_EDITOR_THEME = 'dark-plus' as const

// In Electron production builds, Monaco's default loader path can resolve to an invalid
// local file path when it falls back to CDN URLs. Provide the bundled Monaco instance
// directly so workers/assets are loaded from the app bundle instead.
loader.config({ monaco: monacoEditor })

/** Fine-grained bundle: avoid ``import from 'shiki'`` (pulls every language into ``web_dist``). */
const createHighlighter = createBundledHighlighter({
  themes: {
    [MISSION_EDITOR_THEME]: () => import('@shikijs/themes/dark-plus'),
  },
  langs: {
    cpp: () => import('@shikijs/langs/cpp'),
    /** No ``@shikijs/langs/plaintext`` export; Shiki treats plain text as an empty grammar. */
    plaintext: async () =>
      ({
        id: 'plaintext',
        name: 'Plain Text',
        scopeName: 'text.plain',
        patterns: [],
      }) as never,
    ext: async () => ({ ...extGrammar, id: 'ext' }) as never,
    sqf: async () => ({ ...sqfGrammar, id: 'sqf' }) as never,
  },
  engine: () => createOnigurumaEngine(import('shiki/wasm')),
})

let setupPromise: Promise<void> | null = null

export const missionMonacoTheme = MISSION_EDITOR_THEME

export function missionResourceLanguage(relPath: string): string {
  const lower = relPath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = lower.slice(dot)
  if (ext === '.sqf') return 'sqf'
  if (ext === '.ext') return 'ext'
  if (ext === '.cpp' || ext === '.hpp' || ext === '.h' || ext === '.cc' || ext === '.cxx' || ext === '.c') return 'cpp'
  return 'plaintext'
}

export function ensureMissionMonacoShiki(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      const monaco = (await loader.init()) as Monaco
      const highlighter = await createHighlighter({
        themes: [MISSION_EDITOR_THEME],
        langs: ['cpp', 'plaintext', 'ext', 'sqf'],
      })

      monaco.languages.register({ id: 'ext' })
      monaco.languages.register({ id: 'arma-ext' })
      monaco.languages.register({ id: 'sqf' })

      shikiToMonaco(highlighter, monaco)
    })()
  }
  return setupPromise
}
