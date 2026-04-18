import fs from 'node:fs';
import path from 'node:path';
import Launchpad from '../../Launchpad';

type ProjectTreeNode = {
    name: string;
    kind: 'dir' | 'file';
    relPath: string;
    size?: number | null;
    truncated?: boolean;
    children?: ProjectTreeNode[];
};

type MissionProjectTreeResponse = {
    tree: ProjectTreeNode;
    rootName: string;
    truncated?: boolean;
    error?: string;
};

function managedMissionProjectPaths(dataDir: string): string[] {
    const managedPath = path.join(dataDir, 'managed_missions.json');
    try {
        const raw = JSON.parse(fs.readFileSync(managedPath, 'utf8')) as Record<string, unknown>;
        const out: string[] = [];
        for (const v of Object.values(raw)) {
            if (!v || typeof v !== 'object') continue;
            const pp = (v as { project_path?: unknown }).project_path;
            if (typeof pp === 'string' && pp.trim()) out.push(path.resolve(pp.trim()));
        }
        return out;
    } catch {
        return [];
    }
}

function managedModProjectPaths(dataDir: string): string[] {
    const managedPath = path.join(dataDir, 'managed_mod_projects.json');
    try {
        const raw = JSON.parse(fs.readFileSync(managedPath, 'utf8')) as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') return [];
        const out: string[] = [];
        for (const v of Object.values(raw)) {
            if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
            const pp = (v as { project_path?: unknown }).project_path;
            if (typeof pp === 'string' && pp.trim()) out.push(path.resolve(pp.trim()));
        }
        return out;
    } catch {
        return [];
    }
}

function pathIsAllowed(target: string, allowedRoots: string[]): boolean {
    const resolved = path.resolve(target);
    for (const root of allowedRoots) {
        const rr = path.resolve(root);
        if (resolved === rr) return true;
        if (resolved.startsWith(`${rr}${path.sep}`)) return true;
    }
    return false;
}

/**
 * @param _ctx - The Launchpad instance
 * @param _event - The IpcMainInvokeEvent instance
 * @param projectPathRaw - The project path
 * @returns The mission project tree response
 * Example Payload:
 * {
 *     projectPath: "C:\\Users\\JohnDoe\\Documents\\Arma 3\\missions\\my_mission"
 * }
 */
export async function handleMissionProjectTreeRequest(
    ctx: Launchpad,
    _event: Electron.IpcMainInvokeEvent,
    projectPathRaw: unknown
): Promise<MissionProjectTreeResponse> {
    const raw = typeof projectPathRaw === 'string' ? projectPathRaw.trim() : '';
    if (!raw) return { tree: { name: '', kind: 'dir', relPath: '', children: [] }, rootName: '', error: 'Missing project path.' };

    const dataDir = path.resolve(ctx.dataDir);
    const allowedRoots = [dataDir, ...managedMissionProjectPaths(dataDir), ...managedModProjectPaths(dataDir)];
    const resolved = path.resolve(raw);
    if (!pathIsAllowed(resolved, allowedRoots) || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return {
            tree: { name: path.basename(resolved), kind: 'dir', relPath: '', children: [] },
            rootName: path.basename(resolved) || resolved,
            error: 'Project folder not found or not allowed.',
        };
    }

    const maxNodes = 6000;
    let count = 0;
    let truncated = false;

    const walk = (absPath: string, relPosix: string): ProjectTreeNode => {
        const name = path.basename(absPath);
        const st = fs.statSync(absPath);
        if (st.isFile()) {
            if (count >= maxNodes) {
                truncated = true;
                return { name, kind: 'file', relPath: relPosix, size: null, truncated: true };
            }
            count += 1;
            return { name, kind: 'file', relPath: relPosix, size: st.size };
        }
        if (count >= maxNodes) {
            truncated = true;
            return { name, kind: 'dir', relPath: relPosix, children: [], truncated: true };
        }
        count += 1;
        let entries: string[] = [];
        try {
            entries = fs.readdirSync(absPath).sort((a, b) => a.localeCompare(b));
        } catch {
            return { name, kind: 'dir', relPath: relPosix, children: [] };
        }
        const children: ProjectTreeNode[] = [];
        for (const entry of entries) {
            if (count >= maxNodes) {
                truncated = true;
                break;
            }
            const childAbs = path.join(absPath, entry);
            const childRel = relPosix ? `${relPosix}/${entry}` : entry;
            children.push(walk(childAbs, childRel.replaceAll('\\', '/')));
        }
        return { name, kind: 'dir', relPath: relPosix, children };
    };

    const rootAbs = path.resolve(resolved);
    const tree = walk(rootAbs, '');
    return {
        tree,
        rootName: path.basename(rootAbs) || rootAbs,
        ...(truncated ? { truncated: true } : {}),
    };
}
