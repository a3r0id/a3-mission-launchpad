import { createFile, deleteFile, getFileContents, renameFile, setFileContents } from './fileContents'
import { buildMissionPBO, buildMissionPBOStream } from './pbo'
import { parseModlistFromHtml } from './parseModlistHtml'
import { revealPathInExplorer } from './revealPath'
import { runCommand } from './runCommand'
import { buildModProjectHemtt, initModProjectHemtt, lintModProjectHemtt } from './hemtt'

const Util = {
  runCommand,
  getFileContents,
  setFileContents,
  createFile,
  renameFile,
  deleteFile,
  buildMissionPBO,
  buildMissionPBOStream,
  initModProjectHemtt,
  buildModProjectHemtt,
  lintModProjectHemtt,
  revealPathInExplorer,
  parseModlistFromHtml,
}

export default Util

export type {
  BuildModProjectHemttResult,
  HemttDiagnostic,
  InitModProjectHemttResult,
  LintModProjectHemttResult,
} from './hemtt'
export type { BuildPboResult, BuildPboStreamEvent } from './pbo'
export { PboOutputExistsError } from './pbo'

