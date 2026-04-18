import Launchpad from "../../Launchpad";
import { IpcMainInvokeEvent } from "electron";
import fs from 'node:fs';
import path from 'node:path';

function pathArgFromInvokePayload(payload: unknown): string {
    if (typeof payload === 'string') {
        const s = payload.trim();
        return s;
    }
    if (payload && typeof payload === 'object' && 'path' in payload) {
        const p = (payload as { path: unknown }).path;
        if (typeof p === 'string' && p.trim()) return p.trim();
    }
    return '';
}

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param payload - Absolute file path string, or ``{ path: string }`` (renderer uses a bare string).
 * @returns UTF-8 file text as ``content``, or an error
 */
export async function handleFileGetContents(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    payload: unknown
) {
    const pathRaw = pathArgFromInvokePayload(payload);
    if (!pathRaw) {
        return { error: 'Missing path.' };
    }
    const resolved = path.resolve(pathRaw);
    if (!fs.existsSync(resolved)) {
        return { error: 'File not found' };
    }
    const content = fs.readFileSync(resolved, 'utf8');
    return { content };
}