import { IpcMainInvokeEvent } from "electron";
import Launchpad from "../../Launchpad";

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param args - The arguments object
 * @param args.message - The message to log
 * @returns The result of the operation
 * Example Payload:
 * {
 *     level: "info" | "debug" | "error" | "warning"
 *     message: "Hello, World!"
 * }
 */
export async function handleLogMessage(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { level?: string; message: string }
) {
    const { level: levelRaw, message: messageRaw } = args;
    const level = String(levelRaw ?? 'info').toLowerCase();
    const allowedLevels = new Set(['debug', 'info', 'warning', 'warn', 'error']);
    const normalizedLevel = allowedLevels.has(level) ? level : 'info';

    const message = String(messageRaw ?? '').trim();
    if (!message) {
        return { result: 'success' };
    }

    if (normalizedLevel === 'error') {
        console.error(message);
    } else if (normalizedLevel === 'warn' || normalizedLevel === 'warning') {
        console.warn(message);
    } else if (normalizedLevel === 'debug') {
        console.debug(message);
    } else {
        console.log(message);
    }

    return { result: 'success' };
}