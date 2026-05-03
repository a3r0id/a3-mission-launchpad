export type SettingsTabId = 'updates' | 'remote' | 'paths'

export const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'updates', label: 'Updates' },
  { id: 'remote', label: 'Remote servers - Not Tested' },
  { id: 'paths', label: 'Arma 3' },
]
