import { app } from "electron";
import Launchpad from "../Launchpad";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export function bootstrapDataDirectory(ctx: Launchpad) {
    const dataDir = ctx.dataDir

    // Create the data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created data directory at ${dataDir}`);
    }

    // Create the logs directory if it doesn't exist
    const logsDir = path.join(dataDir, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
        console.log(`Created logs directory at ${logsDir}`);
    }

    // Create the settings file if it doesn't exist
    const settingsFile = path.join(dataDir, 'settings.json');
    if (!fs.existsSync(settingsFile)) {
        fs.writeFileSync(settingsFile, JSON.stringify(
            {
                "arma3_path": "",
                "arma3_workshop_path": "",
                "arma3_tools_path": "",
                "arma3_profile_path": "",
                "arma3_appdata_path": (
                    os.platform() === "win32" ? "%LOCALAPPDATA%\\Arma 3" : "%HOME%/.local/share/Arma 3"
                ),
                "default_author": "",
                "github_new_repo_visibility": "private",
                "remote_servers": [],
                "logs_remote_default_server_id": "",
                "logs_remote_default_folder": "/home/steam/arma3"
            }
        ));
        console.log(`Created settings file at ${settingsFile}`);
    }

    // Create the managed missions file if it doesn't exist
    const managedMissionsFile = path.join(dataDir, 'managed_missions.json');
    if (!fs.existsSync(managedMissionsFile)) {
        fs.writeFileSync(managedMissionsFile, JSON.stringify({}));
        console.log(`Created managed missions file at ${managedMissionsFile}`);
    }

    const managedModProjectsFile = path.join(dataDir, 'managed_mod_projects.json');
    if (!fs.existsSync(managedModProjectsFile)) {
        fs.writeFileSync(managedModProjectsFile, JSON.stringify({}));
        console.log(`Created managed mod projects file at ${managedModProjectsFile}`);
    }
}