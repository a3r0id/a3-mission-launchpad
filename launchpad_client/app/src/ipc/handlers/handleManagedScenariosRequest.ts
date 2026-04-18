import fs from 'node:fs';
import Launchpad from '../../Launchpad';

type ManagedScenarioRow = {
    id: string;
    [key: string]: unknown;
};

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @returns The managed scenarios as an array of ManagedScenarioRow objects
 * Example Payload:
 * None
 */
export async function handleManagedScenariosRequest(
    ctx: Launchpad,
    _event: Electron.IpcMainInvokeEvent
): Promise<ManagedScenarioRow[]> {
    const managedPath = ctx.managedMissionsFile;
    try {
        const raw = JSON.parse(fs.readFileSync(managedPath, 'utf8')) as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') return [];
        const rows: ManagedScenarioRow[] = [];
        for (const [id, value] of Object.entries(raw)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const row = { ...(value as Record<string, unknown>) };
            delete row.ext_params;
            rows.push({ id, ...row });
        }
        return rows;
    } catch {
        return [];
    }
}
