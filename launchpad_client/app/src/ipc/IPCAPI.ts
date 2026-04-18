import { ipcMain } from 'electron';
import Launchpad from "../Launchpad";
import { handleMissionBuildRequest } from './handlers/handleMissionBuildRequest';
import { handleMissionProjectTreeRequest } from './handlers/handleMissionProjectTreeRequest';
import { handleManagedScenariosRequest } from './handlers/handleManagedScenariosRequest';
import { handleManagedModProjectsRequest } from './handlers/handleManagedModProjectsRequest';
import {
    handleManagedModProjectCreate,
    handleManagedModProjectDelete,
    handleManagedModProjectUpdatePatch,
} from './handlers/handleManagedModProjectOps';
import { handleFileGetContents } from './handlers/handleFileGetContents';
import { handleFileGetContentsPartial } from './handlers/handleFileGetContentsPartial';
import { handleFileSetContents } from './handlers/handleFileSetContents';
import { handleFileAppendContents } from './handlers/handleFileAppendContents';
import { handleFileDelete } from './handlers/handleFileDelete';
import { handleFileCreate } from './handlers/handleFileCreate';
import { handleFileRename } from './handlers/handleFileRename';
import { handleFileOrDirectoryExists } from './handlers/handleFileOrDirectoryExists';
import { handleShowOpenDialog } from './handlers/handleShowOpenDialog';
import { handleListDirectory } from './handlers/handleListDirectory';
import { handleShellExec } from './handlers/handleShellExec';
import { handleLogMessage } from './handlers/handleLogMessage';
import { handleGetSettings } from './handlers/handleGetSettings';
import { handleSetSettings } from './handlers/handleSetSettings';
import { handleBuildPBO } from './handlers/handleBuildPBO';
import { handleBuildHEMTTProject } from './handlers/handleBuildHEMTTProject';
import { handleInitHEMTTProject } from './handlers/handleInitHEMTTProject';
import { handleLintHEMTTProject } from './handlers/handleLintHEMTTProject';
import { handleRevealPath } from './handlers/handleRevealPath';
import {
    handleTestingModlistGet,
    handleTestingModlistPatch,
    handleTestingModlistPost,
} from './handlers/handleTestingModlist';
import { handleTestingLaunch } from './handlers/handleTestingLaunch';
import { handleTestingAutotestResultGet } from './handlers/handleTestingAutotestResultGet';
import { handleListRptFiles } from './handlers/handleListRptFiles';
import {
    handleSshRptList,
    handleSshRptTailInit,
    handleSshRptTailNext,
    handleSshSessionClose,
    handleSshSessionOpen,
} from './handlers/handleSshRemoteLogs';
import { handleProcessManagerGet, handleProcessManagerKillPost } from './handlers/handleProcessManager';
import {
    handleManagedScenarioDelete,
    handleManagedScenarioLaunchPost,
    handleManagedScenarioModsGet,
    handleManagedScenarioModsPost,
    handleManagedScenarioUpdatePatch,
    handleMissionGitCommit,
    handleMissionGitInit,
    handleMissionGitLog,
    handleMissionGitPublish,
    handleMissionGitStatus,
} from './handlers/handleManagedScenarioOps';
import {
    handleDebugCommandSend,
    handleDebugServerStart,
    handleDebugServerStatus,
    handleDebugServerStop,
} from './handlers/handleDebugSocket';
import { handleDecodePAA } from './handlers/handleDecodePAA';
import { handleGetP3dPreviewMesh } from './handlers/handleGetP3dPreviewMesh';

export type PredefinedIPC = 
| 'mission-build' 
| 'mission-project-tree' 
| 'managed-scenarios'
| 'managed-mod-projects'
| 'managed-mod-project-create'
| 'managed-mod-project-update-patch'
| 'managed-mod-project-delete'
| 'build-mission-pbo'
| 'build-mod-project-hemtt'
| 'init-mod-project-hemtt'
| 'lint-mod-project-hemtt'
| 'get-settings'
| 'set-settings'
| 'log-message'
| 'shell-exec'
| 'file-get-contents'
| 'file-get-contents-partial'
| 'file-set-contents'
| 'file-append-contents'
| 'file-delete'
| 'file-create'
| 'file-rename'
| 'file-or-directory-exists'
| 'show-open-dialog'
| 'list-directory'
| 'reveal-path'
| 'testing-modlist-get'
| 'testing-modlist-post'
| 'testing-modlist-patch'
| 'testing-launch'
| 'testing-autotest-result-get'
| 'list-rpt-files'
| 'ssh-session-open'
| 'ssh-session-close'
| 'ssh-rpt-list'
| 'ssh-rpt-tail-init'
| 'ssh-rpt-tail-next'
| 'process-manager-get'
| 'process-manager-kill-post'
| 'managed-scenario-mods-get'
| 'managed-scenario-mods-post'
| 'managed-scenario-launch-post'
| 'managed-scenario-update-patch'
| 'managed-scenario-delete'
| 'mission-git-status'
| 'mission-git-log'
| 'mission-git-init'
| 'mission-git-commit'
| 'mission-git-publish'
| 'debug-server-start'
| 'debug-server-stop'
| 'debug-server-status'
| 'debug-command-send'
| 'decode-paa'
| 'get-p3d-preview-mesh'

export class IPCAPI {
    private ctx: Launchpad;
    constructor(ctx: Launchpad) {
        this.ctx = ctx;
        this.registerPredefinedIPC();
    }
    private registerPredefinedIPC() {
        // Add predefined IPC handlers here (from /ipc/handlers)
        // TODO: Fix all the back-compat aliases!!!

        // Mission operations
        this.registerIPC('mission-build', (event, args) =>
            handleMissionBuildRequest(this.ctx, event, args)
        );
        this.registerIPC('mission-project-tree', (event, projectPath) =>
            handleMissionProjectTreeRequest(this.ctx, event, projectPath)
        );
        this.registerIPC('managed-scenarios', (event) =>
            handleManagedScenariosRequest(this.ctx, event)
        );
        this.registerIPC('managed-mod-projects', (event) =>
            handleManagedModProjectsRequest(this.ctx, event)
        );
        this.registerIPC('managed-mod-project-create', (event, args) =>
            handleManagedModProjectCreate(this.ctx, event, args)
        );
        this.registerIPC('managed-mod-project-update-patch', (event, args) =>
            handleManagedModProjectUpdatePatch(this.ctx, event, args)
        );
        this.registerIPC('managed-mod-project-delete', (event, args) =>
            handleManagedModProjectDelete(this.ctx, event, args)
        );

        // File operations
        this.registerIPC('file-get-contents', (event, args) =>
            handleFileGetContents(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('get-file-contents', (event, args) =>
            handleFileGetContents(this.ctx, event, args)
        );
        this.registerIPC('file-get-contents-partial', (event, args) =>
            handleFileGetContentsPartial(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('get-file-contents-partial', (event, args) =>
            handleFileGetContentsPartial(this.ctx, event, args)
        );
        this.registerIPC('file-set-contents', (event, args) =>
            handleFileSetContents(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('set-file-contents', (event, args) =>
            handleFileSetContents(this.ctx, event, args)
        );
        this.registerIPC('file-append-contents', (event, args) =>
            handleFileAppendContents(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('append-file-contents', (event, args) =>
            handleFileAppendContents(this.ctx, event, args)
        );
        this.registerIPC('file-delete', (event, args) =>
            handleFileDelete(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('delete-file', (event, args) =>
            handleFileDelete(this.ctx, event, args)
        );
        this.registerIPC('file-create', (event, args) =>
            handleFileCreate(this.ctx, event, args)
        );
        // Back-compat alias
        this.registerIPC('create-file', (event, args) =>
            handleFileCreate(this.ctx, event, args)
        );
        this.registerIPC('file-rename', (event, args) =>
            handleFileRename(this.ctx, event, args)
        );
        this.registerIPC('rename-file', (event, args) =>
            handleFileRename(this.ctx, event, args)
        );
        this.registerIPC('file-or-directory-exists', (event, args) =>
            handleFileOrDirectoryExists(this.ctx, event, args)
        );
        this.registerIPC('show-open-dialog', (event, args) =>
            handleShowOpenDialog(this.ctx, event, args)
        );
        this.registerIPC('list-directory', (event, args) =>
            handleListDirectory(this.ctx, event, args)
        );

        // Shell operations
        this.registerIPC('shell-exec', (event, args) =>
            handleShellExec(this.ctx, event, args)
        );

        // Log operations
        this.registerIPC('log-message', (event, args) =>
            handleLogMessage(this.ctx, event, args)
        );

        // Settings operations
        this.registerIPC('get-settings', (event) =>
            handleGetSettings(this.ctx, event)
        );
        this.registerIPC('set-settings', (event, args) =>
            handleSetSettings(this.ctx, event, args)
        );

        // PBO operations
        this.registerIPC('build-mission-pbo', (event, args) =>
            handleBuildPBO(this.ctx, event, args)
        );
        this.registerIPC('build-mod-project-hemtt', (event, args) =>
            handleBuildHEMTTProject(this.ctx, event, args)
        );
        this.registerIPC('init-mod-project-hemtt', (event, args) =>
            handleInitHEMTTProject(this.ctx, event, args)
        );
        this.registerIPC('lint-mod-project-hemtt', (event, args) =>
            handleLintHEMTTProject(this.ctx, event, args)
        );

        // File manager operations
        this.registerIPC('reveal-path', (event, args) =>
            handleRevealPath(this.ctx, event, args)
        );

        // Testing modlist operations
        this.registerIPC('testing-modlist-get', (event) =>
            handleTestingModlistGet(this.ctx, event)
        );
        this.registerIPC('testing-modlist-post', (event, args) =>
            handleTestingModlistPost(this.ctx, event, args)
        );
        this.registerIPC('testing-modlist-patch', (event, args) =>
            handleTestingModlistPatch(this.ctx, event, args)
        );

        // Testing launch operation
        this.registerIPC('testing-launch', (event, args) =>
            handleTestingLaunch(this.ctx, event, args)
        );
        this.registerIPC('testing-autotest-result-get', (event, args) =>
            handleTestingAutotestResultGet(this.ctx, event, args)
        );

        // Testing logs operations
        this.registerIPC('list-rpt-files', (event, args) =>
            handleListRptFiles(this.ctx, event, args)
        );
        this.registerIPC('ssh-session-open', (event, args) =>
            handleSshSessionOpen(this.ctx, event, args)
        );
        this.registerIPC('ssh-session-close', (event, args) =>
            handleSshSessionClose(this.ctx, event, args)
        );
        this.registerIPC('ssh-rpt-list', (event, args) =>
            handleSshRptList(this.ctx, event, args)
        );
        this.registerIPC('ssh-rpt-tail-init', (event, args) =>
            handleSshRptTailInit(this.ctx, event, args)
        );
        this.registerIPC('ssh-rpt-tail-next', (event, args) =>
            handleSshRptTailNext(this.ctx, event, args)
        );

        // Process manager operations
        this.registerIPC('process-manager-get', (event) =>
            handleProcessManagerGet(this.ctx, event)
        );
        this.registerIPC('process-manager-kill-post', (event, args) =>
            handleProcessManagerKillPost(this.ctx, event, args)
        );
        this.registerIPC('managed-scenario-mods-get', (event, args) =>
            handleManagedScenarioModsGet(this.ctx, event, args)
        );
        this.registerIPC('managed-scenario-mods-post', (event, args) =>
            handleManagedScenarioModsPost(this.ctx, event, args)
        );
        this.registerIPC('managed-scenario-launch-post', (event, args) =>
            handleManagedScenarioLaunchPost(this.ctx, event, args)
        );
        this.registerIPC('managed-scenario-update-patch', (event, args) =>
            handleManagedScenarioUpdatePatch(this.ctx, event, args)
        );
        this.registerIPC('managed-scenario-delete', (event, args) =>
            handleManagedScenarioDelete(this.ctx, event, args)
        );
        this.registerIPC('mission-git-status', (event, args) =>
            handleMissionGitStatus(this.ctx, event, args)
        );
        this.registerIPC('mission-git-log', (event, args) =>
            handleMissionGitLog(this.ctx, event, args)
        );
        this.registerIPC('mission-git-init', (event, args) =>
            handleMissionGitInit(this.ctx, event, args)
        );
        this.registerIPC('mission-git-commit', (event, args) =>
            handleMissionGitCommit(this.ctx, event, args)
        );
        this.registerIPC('mission-git-publish', (event, args) =>
            handleMissionGitPublish(this.ctx, event, args)
        );
        this.registerIPC('debug-server-start', (event, args) =>
            handleDebugServerStart(this.ctx, event, args)
        );
        this.registerIPC('debug-server-stop', (event) =>
            handleDebugServerStop(this.ctx, event)
        );
        this.registerIPC('debug-server-status', (event) =>
            handleDebugServerStatus(this.ctx, event)
        );
        this.registerIPC('debug-command-send', (event, args) =>
            handleDebugCommandSend(this.ctx, event, args)
        );
        this.registerIPC('decode-paa', (event, args) => handleDecodePAA(this.ctx, event, args));
        this.registerIPC('get-p3d-preview-mesh', (event, args) =>
            handleGetP3dPreviewMesh(this.ctx, event, args),
        );
    }
    public registerIPC(
        key: string,
        handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any | Promise<any>
    ) {
        ipcMain.handle(key, handler);
    }
}