import { useCallback, useEffect, useState } from 'react'
import { fetchSettings, type LaunchpadSettings, type RemoteServerSettingsEntry, updateSettings } from '../api/launchpad'
import { getElectronIpc } from '../electronIpc'
import {
  EMPTY_SETTINGS_BASELINE,
  newRemoteServerId,
  RemoteServerDialog,
  sameSettings,
  settingsClasses,
  SettingsArmaPathsSection,
  SettingsBanners,
  SettingsRemoteServersSection,
  SettingsTabNav,
  SettingsUpdatesSection,
  trimField,
  type CheckUpdatesResult,
  type SettingsTabId,
} from '../components/Settings'

export function SettingsPage() {
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('paths')
  const [saved, setSaved] = useState<LaunchpadSettings | null>(null)
  const [arma3Path, setArma3Path] = useState('')
  const [arma3WorkshopPath, setArma3WorkshopPath] = useState('')
  const [toolsPath, setToolsPath] = useState('')
  const [profilePath, setProfilePath] = useState('')
  const [appdataPath, setAppdataPath] = useState('')
  const [defaultAuthor, setDefaultAuthor] = useState('')
  const [githubVisibility, setGithubVisibility] = useState<'public' | 'private'>('private')
  const [remoteServers, setRemoteServers] = useState<RemoteServerSettingsEntry[]>([])
  const [remoteDefaultServerId, setRemoteDefaultServerId] = useState('')
  const [remoteDefaultFolder, setRemoteDefaultFolder] = useState('/home/steam/arma3')
  const [hemttPath, setHemttPath] = useState('')
  const [serverDialogOpen, setServerDialogOpen] = useState(false)
  const [serverDialogMode, setServerDialogMode] = useState<'new' | 'edit'>('new')
  const [serverDialogId, setServerDialogId] = useState('')
  const [serverNameInput, setServerNameInput] = useState('')
  const [serverHostInput, setServerHostInput] = useState('')
  const [serverPortInput, setServerPortInput] = useState('22')
  const [serverUserInput, setServerUserInput] = useState('')
  const [serverAuthInput, setServerAuthInput] = useState<'password' | 'key'>('password')
  const [serverKeyPathInput, setServerKeyPathInput] = useState('')
  const [serverDialogErr, setServerDialogErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [installBusy, setInstallBusy] = useState(false)
  const [updateResult, setUpdateResult] = useState<CheckUpdatesResult | null>(null)
  const [detectBusy, setDetectBusy] = useState(false)
  const [detectMsg, setDetectMsg] = useState<string | null>(null)
  const [hemttInstallBusy, setHemttInstallBusy] = useState(false)
  const [hemttInstallMsg, setHemttInstallMsg] = useState<string | null>(null)

  const draft: LaunchpadSettings = {
    arma3_path: trimField(arma3Path),
    arma3_workshop_path: trimField(arma3WorkshopPath),
    arma3_tools_path: trimField(toolsPath),
    arma3_profile_path: trimField(profilePath),
    arma3_appdata_path: trimField(appdataPath),
    default_author: trimField(defaultAuthor),
    github_new_repo_visibility: githubVisibility,
    remote_servers: remoteServers,
    logs_remote_default_server_id: trimField(remoteDefaultServerId),
    logs_remote_default_folder: trimField(remoteDefaultFolder) || '/home/steam/arma3',
    hemtt_path: trimField(hemttPath),
  }

  const dirty = !sameSettings(draft, saved ?? EMPTY_SETTINGS_BASELINE)

  const hydrateFromSettings = useCallback((s: LaunchpadSettings) => {
    setSaved(s)
    setArma3Path(s.arma3_path ?? '')
    setArma3WorkshopPath(s.arma3_workshop_path ?? '')
    setToolsPath(s.arma3_tools_path ?? '')
    setProfilePath(s.arma3_profile_path ?? '')
    setAppdataPath(s.arma3_appdata_path ?? '')
    setDefaultAuthor(s.default_author ?? '')
    setGithubVisibility(s.github_new_repo_visibility === 'public' ? 'public' : 'private')
    setRemoteServers(Array.isArray(s.remote_servers) ? s.remote_servers : [])
    setRemoteDefaultServerId(s.logs_remote_default_server_id ?? '')
    setRemoteDefaultFolder(s.logs_remote_default_folder ?? '/home/steam/arma3')
    setHemttPath(s.hemtt_path ?? '')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaveOk(false)
    try {
      const s = await fetchSettings()
      hydrateFromSettings(s)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load settings')
      setSaved(null)
    } finally {
      setLoading(false)
    }
  }, [hydrateFromSettings])

  useEffect(() => {
    void load()
  }, [load])

  async function onSave() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const res = await updateSettings({
        arma3_path: trimField(arma3Path),
        arma3_workshop_path: trimField(arma3WorkshopPath),
        arma3_tools_path: trimField(toolsPath),
        arma3_profile_path: trimField(profilePath),
        arma3_appdata_path: trimField(appdataPath),
        default_author: trimField(defaultAuthor),
        github_new_repo_visibility: githubVisibility,
        remote_servers: remoteServers,
        logs_remote_default_server_id: trimField(remoteDefaultServerId),
        logs_remote_default_folder: trimField(remoteDefaultFolder) || '/home/steam/arma3',
        hemtt_path: trimField(hemttPath),
      })
      if ('error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      if (!res.ok) {
        setSaveError('Save failed')
        return
      }
      const { ok, ...nextSettings } = res
      void ok
      hydrateFromSettings(nextSettings)
      setSaveOk(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function onCheckForUpdates() {
    setUpdateBusy(true)
    setUpdateResult(null)
    try {
      const ipc = getElectronIpc()
      if (!ipc) {
        setUpdateResult({ ok: false, message: 'Updates can be checked from the desktop app.' })
        return
      }
      const raw = (await ipc.invoke('checkForUpdates')) as CheckUpdatesResult
      setUpdateResult(raw)
    } catch {
      setUpdateResult({ ok: false, message: 'Something went wrong while checking.' })
    } finally {
      setUpdateBusy(false)
    }
  }

  async function onOpenDownloads() {
    const ipc = getElectronIpc()
    if (!ipc || !updateResult || updateResult.ok !== true) return
    await ipc.invoke('openExternalUrl', updateResult.releasesUrl)
  }

  async function openHemttUrl(url: string) {
    const ipc = getElectronIpc()
    if (ipc) {
      await ipc.invoke('openExternalUrl', url)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function onInstallHemttWinget() {
    const ipc = getElectronIpc()
    if (!ipc) {
      setHemttInstallMsg('Use the desktop app to run the installer from here.')
      return
    }
    setHemttInstallBusy(true)
    setHemttInstallMsg(null)
    try {
      const raw = (await ipc.invoke('install-hemtt-winget')) as {
        ok?: boolean
        error?: string
        unsupported?: boolean
      }
      if (raw.unsupported) {
        setHemttInstallMsg('Use the installation steps link for your system.')
        return
      }
      if (raw.ok) {
        setHemttInstallMsg(
          'HEMTT is ready or already installed. Restart this app if mod builds still cannot find it.',
        )
        return
      }
      setHemttInstallMsg(raw.error ?? 'Install did not complete.')
    } catch {
      setHemttInstallMsg('Something went wrong.')
    } finally {
      setHemttInstallBusy(false)
    }
  }

  async function onDetectArmaPaths() {
    setDetectMsg(null)
    const ipc = getElectronIpc()
    if (!ipc) {
      setDetectMsg('Use the desktop app to find folders automatically.')
      return
    }
    setDetectBusy(true)
    try {
      const raw = (await ipc.invoke('detect-arma-paths')) as {
        ok?: boolean
        paths?: {
          arma3_path?: string
          arma3_tools_path?: string
          arma3_profile_path?: string
          arma3_appdata_path?: string
        }
      }
      if (!raw.ok || !raw.paths) {
        setDetectMsg('Something went wrong. Try again or pick folders above.')
        return
      }
      const p = raw.paths
      const detectedArma3 = trimField(p.arma3_path)
      const detectedTools = trimField(p.arma3_tools_path)
      const detectedProfile = trimField(p.arma3_profile_path)
      const detectedAppdata = trimField(p.arma3_appdata_path)
      let applied = 0
      if (detectedArma3) applied += 1
      if (detectedTools) applied += 1
      if (detectedProfile) applied += 1
      if (detectedAppdata) applied += 1
      setSaveOk(false)
      if (applied === 0) {
        setDetectMsg('No install found. Pick folders above.')
        return
      }
      setSaveError(null)
      const saveRes = await updateSettings({
        arma3_path: detectedArma3 || trimField(arma3Path),
        arma3_workshop_path: trimField(arma3WorkshopPath),
        arma3_tools_path: detectedTools || trimField(toolsPath),
        arma3_profile_path: detectedProfile || trimField(profilePath),
        arma3_appdata_path: detectedAppdata || trimField(appdataPath),
        default_author: trimField(defaultAuthor),
        github_new_repo_visibility: githubVisibility,
        remote_servers: remoteServers,
        logs_remote_default_server_id: trimField(remoteDefaultServerId),
        logs_remote_default_folder: trimField(remoteDefaultFolder) || '/home/steam/arma3',
        hemtt_path: trimField(hemttPath),
      })
      if ('error' in saveRes && saveRes.error) {
        setDetectMsg(saveRes.error)
        return
      }
      if (!saveRes.ok) {
        setDetectMsg('Could not save. Try Save at the bottom of the page.')
        return
      }
      const { ok, ...nextSettings } = saveRes
      void ok
      hydrateFromSettings(nextSettings)
      setSaveOk(true)
      setDetectMsg('Filled in paths we could find and saved them.')
    } catch {
      setDetectMsg('Something went wrong. Try again or pick folders above.')
    } finally {
      setDetectBusy(false)
    }
  }

  async function onInstallUpdate() {
    const ipc = getElectronIpc()
    if (!ipc || !updateResult || updateResult.ok !== true || !updateResult.updateAvailable) return
    setInstallBusy(true)
    try {
      const raw = (await ipc.invoke('installUpdate', { releaseTag: updateResult.releaseTag })) as
        | { ok: true }
        | { ok: false; message?: string }
      if (!raw.ok && 'message' in raw && raw.message) {
        setUpdateResult({ ok: false, message: raw.message as string })
      }
    } catch {
      setUpdateResult({
        ok: false,
        message: 'Could not install the update from here. Try the downloads page instead.',
      })
    } finally {
      setInstallBusy(false)
    }
  }

  function onDiscard() {
    if (!saved) return
    setArma3Path(saved.arma3_path ?? '')
    setArma3WorkshopPath(saved.arma3_workshop_path ?? '')
    setToolsPath(saved.arma3_tools_path ?? '')
    setProfilePath(saved.arma3_profile_path ?? '')
    setAppdataPath(saved.arma3_appdata_path ?? '')
    setDefaultAuthor(saved.default_author ?? '')
    setGithubVisibility(saved.github_new_repo_visibility === 'public' ? 'public' : 'private')
    setRemoteServers(Array.isArray(saved.remote_servers) ? saved.remote_servers : [])
    setRemoteDefaultServerId(saved.logs_remote_default_server_id ?? '')
    setRemoteDefaultFolder(saved.logs_remote_default_folder ?? '/home/steam/arma3')
    setHemttPath(saved.hemtt_path ?? '')
    setSaveError(null)
    setSaveOk(false)
  }

  function openNewRemoteServerDialog() {
    setServerDialogMode('new')
    setServerDialogId('')
    setServerNameInput('')
    setServerHostInput('')
    setServerPortInput('22')
    setServerUserInput('')
    setServerAuthInput('password')
    setServerKeyPathInput('')
    setServerDialogErr(null)
    setServerDialogOpen(true)
  }

  function openEditRemoteServerDialog(row: RemoteServerSettingsEntry) {
    setServerDialogMode('edit')
    setServerDialogId(row.id)
    setServerNameInput(row.name)
    setServerHostInput(row.host)
    setServerPortInput(String(row.port || 22))
    setServerUserInput(row.username)
    setServerAuthInput(row.auth)
    setServerKeyPathInput(row.keyPath ?? '')
    setServerDialogErr(null)
    setServerDialogOpen(true)
  }

  function closeRemoteServerDialog() {
    setServerDialogOpen(false)
    setServerDialogErr(null)
  }

  function submitRemoteServerDialog() {
    const name = trimField(serverNameInput)
    const host = trimField(serverHostInput)
    const username = trimField(serverUserInput)
    const portRaw = Number.parseInt(trimField(serverPortInput), 10)
    const port = Number.isInteger(portRaw) && portRaw > 0 ? portRaw : 22
    if (!name) {
      setServerDialogErr('Server name is required.')
      return
    }
    if (!host) {
      setServerDialogErr('Host is required.')
      return
    }
    if (!username) {
      setServerDialogErr('Username is required.')
      return
    }
    if (serverAuthInput === 'key' && !trimField(serverKeyPathInput)) {
      setServerDialogErr('Key file path is required for key authentication.')
      return
    }
    const nextRow: RemoteServerSettingsEntry = {
      id: serverDialogMode === 'edit' && serverDialogId ? serverDialogId : newRemoteServerId(),
      name,
      host,
      port,
      username,
      auth: serverAuthInput,
      keyPath: serverAuthInput === 'key' ? trimField(serverKeyPathInput) : undefined,
    }
    setRemoteServers((prev) => {
      const exists = prev.some((x) => x.id === nextRow.id)
      if (exists) {
        return prev.map((x) => (x.id === nextRow.id ? nextRow : x))
      }
      return [...prev, nextRow]
    })
    setSaveOk(false)
    setServerDialogOpen(false)
  }

  function removeRemoteServer(id: string) {
    setRemoteServers((prev) => prev.filter((row) => row.id !== id))
    setRemoteDefaultServerId((cur) => (cur === id ? '' : cur))
    setSaveOk(false)
  }

  const isWindows =
    typeof navigator !== 'undefined' &&
    (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent))
  const hemttDesktop = getElectronIpc() !== null

  return (
    <div className={settingsClasses.page}>
      <div className={settingsClasses.stack}>
        <header className={settingsClasses.pageHeader}>
          <h1 className={settingsClasses.pageTitle}>Settings</h1>
          <p className={settingsClasses.pageLead}>Paths and preferences are saved on this device. Change them any time.</p>
        </header>

        <SettingsTabNav active={settingsTab} onChange={setSettingsTab} />

        <SettingsBanners
          loadError={loadError}
          saveError={saveError}
          saveOk={saveOk}
          dirty={dirty}
        />

        <div
          id="settings-active-panel"
          className={settingsClasses.tabPanel}
          role="tabpanel"
          aria-labelledby={`settings-tab-${settingsTab}`}
        >
          {settingsTab === 'updates' && (
            <SettingsUpdatesSection
              updateResult={updateResult}
              updateBusy={updateBusy}
              installBusy={installBusy}
              onCheckForUpdates={() => void onCheckForUpdates()}
              onInstallUpdate={() => void onInstallUpdate()}
              onOpenDownloads={() => void onOpenDownloads()}
            />
          )}
          {settingsTab === 'remote' && (
            <SettingsRemoteServersSection
              loading={loading}
              remoteServers={remoteServers}
              remoteDefaultServerId={remoteDefaultServerId}
              remoteDefaultFolder={remoteDefaultFolder}
              onDefaultServer={(v) => {
                setRemoteDefaultServerId(v)
                setSaveOk(false)
              }}
              onDefaultFolder={(v) => {
                setRemoteDefaultFolder(v)
                setSaveOk(false)
              }}
              onAdd={openNewRemoteServerDialog}
              onEdit={openEditRemoteServerDialog}
              onRemove={removeRemoteServer}
            />
          )}
          {settingsTab === 'paths' && (
            <SettingsArmaPathsSection
              loading={loading}
              saving={saving}
              dirty={dirty}
              hasSaved={saved !== null}
              isWindows={isWindows}
              hemttDesktop={hemttDesktop}
              arma3Path={arma3Path}
              toolsPath={toolsPath}
              profilePath={profilePath}
              appdataPath={appdataPath}
              defaultAuthor={defaultAuthor}
              githubVisibility={githubVisibility}
              hemttPath={hemttPath}
              detectBusy={detectBusy}
              detectMsg={detectMsg}
              hemttInstallBusy={hemttInstallBusy}
              hemttInstallMsg={hemttInstallMsg}
              onArma3Path={(v) => {
                setArma3Path(v)
                setSaveOk(false)
              }}
              onToolsPath={(v) => {
                setToolsPath(v)
                setSaveOk(false)
              }}
              onProfilePath={(v) => {
                setProfilePath(v)
                setSaveOk(false)
              }}
              onAppdataPath={(v) => {
                setAppdataPath(v)
                setSaveOk(false)
              }}
              onDefaultAuthor={(v) => {
                setDefaultAuthor(v)
                setSaveOk(false)
              }}
              onGithubVisibility={(v) => {
                setGithubVisibility(v)
                setSaveOk(false)
              }}
              onHemttPath={(v) => {
                setHemttPath(v)
                setSaveOk(false)
              }}
              onDetectArmaPaths={() => void onDetectArmaPaths()}
              onSave={() => void onSave()}
              onDiscard={onDiscard}
              onReload={() => void load()}
              onInstallHemttWinget={() => void onInstallHemttWinget()}
              onOpenHemttUrl={openHemttUrl}
            />
          )}
        </div>
      </div>

      <RemoteServerDialog
        open={serverDialogOpen}
        mode={serverDialogMode}
        name={serverNameInput}
        host={serverHostInput}
        port={serverPortInput}
        username={serverUserInput}
        auth={serverAuthInput}
        keyPath={serverKeyPathInput}
        error={serverDialogErr}
        onClose={closeRemoteServerDialog}
        onSubmit={submitRemoteServerDialog}
        onName={setServerNameInput}
        onHost={setServerHostInput}
        onPort={setServerPortInput}
        onUser={setServerUserInput}
        onAuth={setServerAuthInput}
        onKeyPath={setServerKeyPathInput}
      />
    </div>
  )
}
