import type { CheckUpdatesResult } from './settingsUtils'
import { settings } from './settingsClasses'
import { SettingsCard } from './SettingsCard'

type Props = {
  updateResult: CheckUpdatesResult | null
  updateBusy: boolean
  installBusy: boolean
  onCheckForUpdates: () => void
  onInstallUpdate: () => void
  onOpenDownloads: () => void
}

export function SettingsUpdatesSection({
  updateResult,
  updateBusy,
  installBusy,
  onCheckForUpdates,
  onInstallUpdate,
  onOpenDownloads,
}: Props) {
  return (
    <SettingsCard
      sectionId="updates-heading"
      title="Updates"
      lead="See if a newer version is available. If you installed with the Windows setup, you can install from here when an update is ready."
    >
      <div className={settings.formActions}>
        <button
          type="button"
          className={
            updateResult?.ok === true && updateResult.updateAvailable && updateResult.canAutoInstall
              ? 'btn btn-ghost'
              : 'btn btn-primary'
          }
          onClick={onCheckForUpdates}
          disabled={updateBusy || installBusy}
        >
          {updateBusy ? 'Checking…' : 'Check for updates'}
        </button>
        {updateResult?.ok === true && updateResult.updateAvailable && updateResult.canAutoInstall ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onInstallUpdate}
            disabled={installBusy}
          >
            {installBusy ? 'Installing…' : 'Install update'}
          </button>
        ) : null}
        {updateResult?.ok === true && updateResult.updateAvailable ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onOpenDownloads}
            disabled={installBusy}
          >
            Open downloads
          </button>
        ) : null}
      </div>
      {updateResult?.ok === true && !updateResult.updateAvailable ? (
        <p className={settings.cardBody} role="status">
          You are on the latest version ({updateResult.current}).
        </p>
      ) : null}
      {updateResult?.ok === true && updateResult.updateAvailable ? (
        <p className={settings.cardBody} role="status">
          A newer version is available ({updateResult.latest}). Your version is {updateResult.current}.
          {!updateResult.canAutoInstall ? (
            <>
              {' '}
              Use the downloads page for the installer, or install with the Windows setup to enable in-app updates.
            </>
          ) : null}
        </p>
      ) : null}
      {updateResult?.ok === false && updateResult.message ? (
        <p className={settings.bannerError} role="alert">
          {updateResult.message}
        </p>
      ) : null}
    </SettingsCard>
  )
}
