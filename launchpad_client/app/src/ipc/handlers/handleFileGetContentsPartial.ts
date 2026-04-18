// Handles both entire file and partial [startByte, endByte] range requests.
import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param args - The arguments object
 * @param args.path - The path to the file
 * @param args.start - The start byte
 * @param args.end - The end byte
 * @returns The contents of the file or an error if the file is not found
 * Example Payload:
 * {
 *     path: "C:\\Users\\JohnDoe\\Documents\\Arma 3\\missions\\binary_file.bin"
 *     start: 0
 *     end: 1024
 * }
 */
export async function handleFileGetContentsPartial(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { path: string, start?: number, end?: number }
) {
    const { path: pathRaw } = args;
    const start = Number.isFinite(args.start) ? Math.max(0, Math.floor(args.start)) : 0;
    const resolved = path.resolve(pathRaw);
    if (!fs.existsSync(resolved)) {
        return { error: 'File not found' };
    }
    const buffer = fs.readFileSync(resolved);
    const requestedEnd = Number.isFinite(args.end) ? Math.floor(args.end as number) : buffer.length;
    const sliceEnd = Math.min(Math.max(start, requestedEnd), buffer.length);
    const content = buffer.subarray(start, sliceEnd).toString('utf8');
    return { content, start, end: sliceEnd, file_size: buffer.length };
}