import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

export async function handleFileAppendContents(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string, contents: string }
) {
    const { path: pathRaw, contents: contentsRaw } = args;
    const resolved = path.resolve(pathRaw);
    if (!fs.existsSync(resolved)) {
        return { error: 'File not found' };
    }
    fs.appendFileSync(resolved, String(contentsRaw ?? ''), 'utf8');
    return { ok: true };
}
