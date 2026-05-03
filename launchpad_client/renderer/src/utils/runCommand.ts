import { apiUrl } from '../api/launchpad'
import { jsonHeaders } from './jsonHeaders'

export async function runCommand(command: string) {
  const response = await fetch(apiUrl('/api/run-command'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ command }),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    throw new Error(`Failed to run command: ${errText || response.statusText}`)
  }
  const data = (await response.json()) as {
    stdout?: string
    stderr?: string
    returncode?: number
  }
  const out = [data.stdout, data.stderr].filter(Boolean).join('\n')
  return out || ''
}
