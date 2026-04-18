import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

export async function handleFileDelete(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string }
) {
    const resolved = path.resolve(args.path);
    if (!fs.existsSync(resolved)) {
        return { error: 'File not found' };
    }
    if (!fs.statSync(resolved).isFile()) {
        return { error: 'Path is not a file' };
    }
    fs.unlinkSync(resolved);
    return { ok: true };
}
