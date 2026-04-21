import { spawn } from 'node:child_process';
import path from 'node:path';

export type ArmaLaunchOptions = {
  detached?: boolean;
  windowsHide?: boolean;
  stdio?: 'ignore' | 'inherit' | 'pipe';
  shell?: boolean;
};

export type BuildArmaLaunchArgvInput = {
  exePath: string;
  profileName?: string;
  missionArgPath?: string;
  modPaths?: string[];
  extraArgs?: string[];
  includeNosplash?: boolean;
};

export const DEFAULT_ARMA_LAUNCH_OPTIONS: Required<ArmaLaunchOptions> = {
  detached: process.platform === 'win32',
  windowsHide: false,
  stdio: 'ignore',
  shell: false,
};

export function buildArmaLaunchArgv(input: BuildArmaLaunchArgvInput): string[] {
  const argv: string[] = [input.exePath];
  if (input.includeNosplash !== false) argv.push('-nosplash');
  if (input.profileName && input.profileName.trim()) {
    argv.push(`-name=${input.profileName.trim()}`);
  }
  if (input.missionArgPath && input.missionArgPath.trim()) {
    argv.push(input.missionArgPath.trim());
  }
  const mods = Array.isArray(input.modPaths) ? input.modPaths.filter((x) => typeof x === 'string' && x.trim()) : [];
  if (mods.length > 0) {
    const modSep = process.platform === 'win32' ? ';' : ':';
    argv.push(`-mod=${mods.join(modSep)}`);
  }
  if (Array.isArray(input.extraArgs) && input.extraArgs.length > 0) {
    argv.push(...input.extraArgs);
  }
  return argv;
}

export function launchArma3(exePath: string, argv: string[], options?: ArmaLaunchOptions): number {
  const merged = { ...DEFAULT_ARMA_LAUNCH_OPTIONS, ...(options ?? {}) };
  const child = spawn(exePath, argv.slice(1), {
    cwd: path.dirname(exePath),
    detached: merged.detached,
    windowsHide: merged.windowsHide,
    stdio: merged.stdio,
    shell: merged.shell,
  });
  child.unref();
  return child.pid ?? -1;
}
