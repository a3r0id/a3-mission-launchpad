import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

export async function handleFileOrDirectoryExists(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string }
) {
    const resolved = path.resolve(args.path);
    return { exists: fs.existsSync(resolved) };
}
