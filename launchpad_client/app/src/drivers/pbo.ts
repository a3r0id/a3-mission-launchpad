import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type BuildMissionPboArgs = {
  missionFolder: string;
  outputPboPath: string;
  progressCallback?: (message: string) => void;
};

const IGNORED_DIRECTORIES = new Set(['.git', '.github']);
const IGNORED_FILES = new Set(['.gitignore', '.gitattributes']);

type StagedFile = {
  sourcePath: string;
  pboName: string;
  size: number;
  timestamp: number;
};

function collectMissionFiles(sourceDir: string, rootDir: string, out: StagedFile[]): void {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      collectMissionFiles(sourcePath, rootDir, out);
      continue;
    }
    if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) {
        continue;
      }
      const rel = path.relative(rootDir, sourcePath).split(path.sep).join('\\');
      const st = fs.statSync(sourcePath);
      out.push({
        sourcePath,
        pboName: rel,
        size: st.size,
        timestamp: Math.floor(st.mtimeMs / 1000),
      });
    }
  }
}

function asciiz(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
}

function writePboHeader(files: StagedFile[]): Buffer {
  const parts: Buffer[] = [];

  // Primary header: '<sIIIII' with filename NUL and 5 uint32 values.
  parts.push(Buffer.from([0]));
  const main = Buffer.alloc(20);
  main.writeUInt32LE(0x56657273, 0); // "Vers" little-endian magic used by a3lib
  main.writeUInt32LE(0, 4);
  main.writeUInt32LE(0, 8);
  main.writeUInt32LE(0, 12);
  main.writeUInt32LE(0, 16);
  parts.push(main);

  // Header extension terminator (no extensions in current flow).
  parts.push(Buffer.from([0]));

  for (const file of [...files].sort((a, b) => a.pboName.localeCompare(b.pboName))) {
    parts.push(asciiz(file.pboName));
    const info = Buffer.alloc(20);
    info.writeUInt32LE(0, 0); // packing method: none
    info.writeUInt32LE(0, 4); // original size
    info.writeUInt32LE(0, 8); // reserved
    info.writeUInt32LE(file.timestamp >>> 0, 12);
    info.writeUInt32LE(file.size >>> 0, 16);
    parts.push(info);
  }

  // Terminator entry for file list: empty filename + 20 bytes.
  parts.push(Buffer.from([0]));
  parts.push(Buffer.alloc(20, 0));
  return Buffer.concat(parts);
}

export async function makeMissionPbo(args: BuildMissionPboArgs): Promise<string> {
  const missionFolder = path.resolve(args.missionFolder);
  const outputPboPath = path.resolve(args.outputPboPath);
  if (!fs.existsSync(missionFolder) || !fs.statSync(missionFolder).isDirectory()) {
    throw new Error(`Mission folder not found or not a directory: ${missionFolder}`);
  }

  const outputParent = path.dirname(outputPboPath);
  if (!outputParent) {
    throw new Error('Invalid PBO output path (missing directory).');
  }
  fs.mkdirSync(outputParent, { recursive: true });

  const progress = args.progressCallback ?? (() => {});
  const files: StagedFile[] = [];
  collectMissionFiles(missionFolder, missionFolder, files);
  const sortedFiles = [...files].sort((a, b) => a.pboName.localeCompare(b.pboName));

  progress(`scan:${missionFolder}`);
  for (const file of sortedFiles) {
    progress(`packed:${file.sourcePath}`);
  }
  progress('export:start');

  const tmpOutput = `${outputPboPath}.tmp`;
  const hash = crypto.createHash('sha1');
  const header = writePboHeader(sortedFiles);
  hash.update(header);
  fs.writeFileSync(tmpOutput, header);

  for (const file of sortedFiles) {
    progress(`writing:${file.pboName}`);
    const data = fs.readFileSync(file.sourcePath);
    hash.update(data);
    fs.appendFileSync(tmpOutput, data);
  }

  const digest = hash.digest();
  const trailer = Buffer.concat([Buffer.from([0]), digest]);
  fs.appendFileSync(tmpOutput, trailer);
  fs.renameSync(tmpOutput, outputPboPath);

  progress('export:done');
  return outputPboPath;
}
