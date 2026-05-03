export async function parseModlistFromHtml(fileName: string, html: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const rows = doc.querySelectorAll('tr')
  const head = doc.querySelector('head')

  const modlist: {
    file: string
    preset: string
    type?: string
    mods: { name: string; type: string; link: string; id: number }[]
  } = { file: fileName, preset: '', type: undefined, mods: [] }

  if (head) {
    const type = head.querySelector('meta[name="arma:Type"]')?.getAttribute('content')
    const preset = head.querySelector('meta[name="arma:PresetName"]')?.getAttribute('content')
    if (type && preset) {
      modlist.type = type
      modlist.preset = preset
    }
  }

  const seenIds = new Set<number>()
  for (const row of rows) {
    const containerType = (row.getAttribute('data-type') ?? '').trim()
    const nameCell = row.querySelector('td[data-type="DisplayName"], td:nth-child(1)')
    const typeCell = row.querySelector('td[data-type="Type"], td:nth-child(2)')
    const linkCell = row.querySelector('td[data-type="Link"], td:nth-child(3)')

    const name = (nameCell?.textContent ?? '').trim()
    const type = (typeCell?.textContent ?? '').trim()
    const linkAnchor = linkCell?.querySelector('a[href]')
    const href = (linkAnchor?.getAttribute('href') ?? '').trim()
    const linkText = (linkCell?.textContent ?? '').trim()
    const link = href || linkText

    if (!link || (containerType && containerType !== 'ModContainer')) continue

    const idMatch = link.match(/[?&]id=(\d+)/i) ?? link.match(/\/filedetails\/\?id=(\d+)/i)
    const idRaw = idMatch?.[1] ?? ''
    if (!idRaw) continue
    const id = Number.parseInt(idRaw, 10)
    if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) continue

    seenIds.add(id)
    modlist.mods.push({ name, type, link, id })
  }
  return modlist
}
