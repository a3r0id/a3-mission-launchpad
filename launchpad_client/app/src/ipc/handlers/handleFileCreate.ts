import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

export async function handleFileCreate(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string, contents?: string }
) {
    const resolved = path.resolve(args.path);
    if (fs.existsSync(resolved)) {
        return { error: 'File already exists' };
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, String(args.contents ?? ''), 'utf8');
    return { ok: true };
}
