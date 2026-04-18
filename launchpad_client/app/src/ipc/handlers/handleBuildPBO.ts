import fs from 'node:fs';
import path from 'node:path';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';
import { makeMissionPbo } from '../../drivers/pbo';

type BuildPboPayload = {
  project_path?: unknown;
  projectPath?: unknown;
  output_path?: unknown;
  outputPath?: unknown;
  mission_name?: unknown;
  map_suffix?: unknown;
  overwrite?: unknown;
};

type BuildPboResponse = {
  ok: boolean;
  pboPath?: string;
  log?: string[];
  error?: string;
  code?: 'pbo_exists';
};

function readStringField(body: BuildPboPayload, snake: keyof BuildPboPayload, camel: keyof BuildPboPayload): string {
  const raw = body[snake] ?? body[camel];
  return typeof raw === 'string' ? raw.trim() : '';
}

function missionPboFilename(projectResolved: string, body: BuildPboPayload): string {
  const missionName = readStringField(body, 'mission_name', 'mission_name');
  const mapSuffix = readStringField(body, 'map_suffix', 'map_suffix');
  if (missionName && mapSuffix) {
    return `${missionName}.${mapSuffix}.pbo`;
  }
  return `${path.basename(projectResolved)}.pbo`;
}

function normalizeOutputPath(projectResolved: string, outputPathRaw: string, pboFilename: string): string {
  if (!outputPathRaw) {
    return path.join(path.dirname(projectResolved), pboFilename);
  }
  const out = path.resolve(outputPathRaw);
  if (out.toLowerCase().endsWith('.pbo')) {
    return path.join(path.dirname(out), pboFilename);
  }
  return path.join(out, pboFilename);
}

/**
 * IPC payload mirrors the existing backend shape:
 * {
 *   project_path: string,
 *   output_path?: string,
 *   mission_name?: string,
 *   map_suffix?: string,
 *   overwrite?: boolean
 * }
 */
export async function handleBuildPBO(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<BuildPboResponse> {
  const body = (args ?? {}) as BuildPboPayload;
  const projectRaw = readStringField(body, 'project_path', 'projectPath');
  if (!projectRaw) {
    return { ok: false, error: 'Missing or invalid project path.' };
  }

  const projectResolved = path.resolve(projectRaw);
  if (!fs.existsSync(projectResolved) || !fs.statSync(projectResolved).isDirectory()) {
    return { ok: false, error: 'Mission path not found or not a directory.' };
  }

  const pboFilename = missionPboFilename(projectResolved, body);
  const outputPathRaw = readStringField(body, 'output_path', 'outputPath');
  const pboFullPath = normalizeOutputPath(projectResolved, outputPathRaw, pboFilename);

  const overwrite = body.overwrite === true;
  if (fs.existsSync(pboFullPath) && fs.statSync(pboFullPath).isFile()) {
    if (!overwrite) {
      return {
        ok: false,
        code: 'pbo_exists',
        error: 'A PBO file already exists at the output path.',
        pboPath: pboFullPath,
      };
    }
    try {
      fs.unlinkSync(pboFullPath);
    } catch (err) {
      return {
        ok: false,
        error: `Could not remove existing PBO: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const logLines: string[] = [];
  try {
    const builtPath = await makeMissionPbo({
      missionFolder: projectResolved,
      outputPboPath: pboFullPath,
      progressCallback: (line) => logLines.push(line),
    });
    return { ok: true, pboPath: builtPath, log: logLines };
  } catch (err) {
    return { ok: false, error: `Could not build mission PBO: ${err instanceof Error ? err.message : String(err)}` };
  }
}
