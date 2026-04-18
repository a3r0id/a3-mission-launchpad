import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';
/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param args - The arguments object
 * @param args.path - The path to the file
 * @param args.contents - The contents of the file
 * @returns The result of the operation
 * Example Payload:
 * {
 *     path: "C:\\Users\\JohnDoe\\Documents\\Arma 3\\missions\\my_mission.sqm",
 *     contents: "This is the contents of the file"
 * }
 */
export async function handleFileSetContents(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string, contents: string }
) {
    const { path: pathRaw, contents: contentsRaw } = args;
    const contents = String(contentsRaw ?? '');
    const resolved = path.resolve(pathRaw);
    if (!fs.existsSync(resolved)) {
        return { error: 'File not found' };
    }
    fs.writeFileSync(resolved, contents, 'utf8');
    return { ok: true };
}