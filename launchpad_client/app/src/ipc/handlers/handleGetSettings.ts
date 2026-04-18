import { IpcMainInvokeEvent } from "electron";
import Launchpad from "../../Launchpad";
import fs from "node:fs";

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @returns The settings
 * Example Payload:
 * None
 */
export async function handleGetSettings(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent
) {
    const settings = JSON.parse(fs.readFileSync(_ctx.settingsFile, 'utf8'));
    return { settings };
}