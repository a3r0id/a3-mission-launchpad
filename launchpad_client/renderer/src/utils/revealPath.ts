import { apiUrl } from '../api/launchpad'
import { getElectronIpc } from '../electronIpc'
import { jsonHeaders } from './jsonHeaders'

export async function revealPathInExplorer(path: string, projectPath?: string) {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('reveal-path', {
      path,
      project_path: projectPath ?? '',
    })) as { ok?: boolean; error?: string }
    if (!data?.ok) {
      throw new Error(data?.error ?? 'Could not reveal path.')
    }
    return
  }

  const response = await fetch(apiUrl('/api/reveal-path'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      path,
      project_path: projectPath ?? '',
    }),
  })
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? response.statusText)
  }
}
