import { exec } from "child_process"
import Launchpad from "../../Launchpad"
import { IpcMainInvokeEvent } from "electron"

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param args - The arguments object
 * @param args.command - The command to execute
 * @param args.cwd - The working directory to execute the command in
 * @returns The result of the operation
 * Example Payload:
 * {
 *     command: "C:\\Windows\\System32\\cmd.exe /c echo Hello, World!"
 *     cwd: "C:\\Users\\JohnDoe\\Documents\\Arma 3\\missions\\my_mission"
 * }
 */
export async function handleShellExec(
    _ctx: Launchpad,
    _event: IpcMainInvokeEvent,
    args: { command: string, cwd: string }
) {
    const { command: commandRaw, cwd: cwdRaw } = args;
    const cwd = String(cwdRaw ?? '').trim();
    const command = String(commandRaw ?? '').trim();
    const result = await exec(command, { cwd: String(cwd ?? '') });
    return { stdout: result.stdout, stderr: result.stderr, returnCode: result.exitCode ?? 0 };
}