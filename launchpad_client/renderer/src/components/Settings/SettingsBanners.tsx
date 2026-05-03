import { settings } from './settingsClasses'

type Props = {
  loadError: string | null
  saveError: string | null
  saveOk: boolean
  dirty: boolean
}

export function SettingsBanners({ loadError, saveError, saveOk, dirty }: Props) {
  const hasAny = Boolean(loadError || saveError || (saveOk && !dirty))
  if (!hasAny) return null
  return (
    <div className="shrink-0 space-y-2">
      {loadError ? (
        <p className={settings.bannerError} role="alert">
          {loadError}
        </p>
      ) : null}
      {saveError ? (
        <p className={settings.bannerError} role="alert">
          {saveError}
        </p>
      ) : null}
      {saveOk && !dirty ? (
        <p className={settings.bannerOk} role="status">
          Settings saved.
        </p>
      ) : null}
    </div>
  )
}
