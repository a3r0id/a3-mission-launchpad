import { IpcMainInvokeEvent } from "electron";
import Launchpad from "../../Launchpad";
import fs from "node:fs";

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param args - The arguments object
 * @param args.settings - The settings to set
 * @returns the keys/values that were set
 * Example Payload:
 * None
 */
export async function handleSetSettings(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { settings: Record<string, unknown> }
) {
    const { settings } = args;
    // merge the new settings into the existing settings, taking precedence over the existing settings
    const existingSettings = JSON.parse(fs.readFileSync(_ctx.settingsFile, 'utf8'));
    const mergedSettings = { ...existingSettings, ...settings } as Record<string, unknown>;
    fs.writeFileSync(_ctx.settingsFile, JSON.stringify(mergedSettings, null, 2));
    return { keys: Object.keys(mergedSettings) };
}