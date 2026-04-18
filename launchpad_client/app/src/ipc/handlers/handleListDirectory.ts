import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

export async function handleListDirectory(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string }
) {
    const resolved = path.resolve(args.path);
    if (!fs.existsSync(resolved)) {
        return { error: 'Directory not found' };
    }
    if (!fs.statSync(resolved).isDirectory()) {
        return { error: 'Path is not a directory' };
    }
    return { contents: fs.readdirSync(resolved) };
}
