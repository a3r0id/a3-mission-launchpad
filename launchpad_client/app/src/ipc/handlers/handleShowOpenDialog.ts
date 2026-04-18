import { BrowserWindow, dialog, IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

export async function handleShowOpenDialog(
  _ctx: Launchpad,
  event: IpcMainInvokeEvent,
  args: { mode: 'file' | 'folder'; defaultPath?: string },
) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const properties =
    args.mode === 'folder' ? (['openDirectory'] as const) : (['openFile'] as const);

  const result = await dialog.showOpenDialog(win ?? undefined, {
    defaultPath: args.defaultPath?.trim() || undefined,
    properties: [...properties],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true as const, path: null as string | null };
  }
  return { canceled: false as const, path: result.filePaths[0]! };
}
