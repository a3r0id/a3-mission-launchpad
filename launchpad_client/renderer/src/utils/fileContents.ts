import { apiUrl } from '../api/launchpad'
import { getElectronIpc } from '../electronIpc'
import { jsonHeaders } from './jsonHeaders'

export async function getFileContents(path: string) {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('file-get-contents', path)) as { content?: string; error?: string } | null
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from desktop API.')
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      throw new Error(data.error)
    }
    if (typeof data.content !== 'string') {
      throw new Error('Invalid file response')
    }
    return data.content
  }

  const q = new URLSearchParams({ path })
  const response = await fetch(apiUrl(`/api/file-contents?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    throw new Error(`Failed to get file contents: ${errText || response.statusText}`)
  }
  const data = (await response.json()) as { content?: string; error?: string }
  if (typeof data.content !== 'string') {
    throw new Error(data.error ?? 'Invalid file response')
  }
  return data.content
}

export async function setFileContents(path: string, contents: string) {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('file-set-contents', {
      path,
      contents,
    })) as { ok?: boolean; error?: string } | null
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from desktop API.')
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      throw new Error(data.error)
    }
    if (data.ok !== true) {
      throw new Error('Could not save file')
    }
    return
  }

  const response = await fetch(apiUrl('/api/file-contents'), {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ path, contents }),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    throw new Error(`Failed to set file contents: ${errText || response.statusText}`)
  }
}

export async function createFile(path: string, contents = '') {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('file-create', {
      path,
      contents,
    })) as { ok?: boolean; error?: string } | null
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from desktop API.')
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      throw new Error(data.error)
    }
    if (data.ok !== true) {
      throw new Error('Could not create file')
    }
    return
  }
  throw new Error('Creating files requires the desktop app.')
}

export async function renameFile(fromPath: string, toPath: string) {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('file-rename', {
      fromPath,
      toPath,
    })) as { ok?: boolean; error?: string } | null
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from desktop API.')
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      throw new Error(data.error)
    }
    if (data.ok !== true) {
      throw new Error('Could not rename file')
    }
    return
  }
  throw new Error('Renaming files requires the desktop app.')
}

export async function deleteFile(path: string) {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('file-delete', { path })) as { ok?: boolean; error?: string } | null
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from desktop API.')
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      throw new Error(data.error)
    }
    if (data.ok !== true) {
      throw new Error('Could not delete file')
    }
    return
  }
  throw new Error('Deleting files requires the desktop app.')
}
