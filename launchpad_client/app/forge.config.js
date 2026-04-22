const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

/** Packaged layout under repo ``A3LaunchPad/`` (static UI payload + companion mod). */
const a3LaunchPad = path.resolve(__dirname, '..', '..', 'A3LaunchPad');
const launchpadWebDist = path.join(a3LaunchPad, 'web_dist');
const stagedCompanionMod = path.join(a3LaunchPad, 'mod');
const extraResource = [];
if (fs.existsSync(launchpadWebDist)) extraResource.push(launchpadWebDist);
/** Mirrors runtime ``launchpad_data``: ``mod/addons/*.pbo`` plus extension binary beside ``mod/``. */
if (fs.existsSync(stagedCompanionMod)) extraResource.push(stagedCompanionMod);
for (const name of ['A3_LAUNCHPAD_EXT_x64.dll', 'A3_LAUNCHPAD_EXT_x64.so']) {
  const abs = path.join(a3LaunchPad, name);
  if (fs.existsSync(abs)) extraResource.push(abs);
}

/** Set by ``util.py`` to a fresh ``build/electron-forge-*`` path so Windows never has to delete a locked ``app/out`` tree. */
const outDir = process.env.LAUNCHPAD_ELECTRON_OUT
  ? path.resolve(process.env.LAUNCHPAD_ELECTRON_OUT)
  : 'out';

/** Base path without extension for ``@electron/packager`` (``.ico`` / ``.icns`` / ``.png`` per platform). */
const appIconBase = path.resolve(__dirname, '..', 'renderer', 'public', 'favicon');
const appIconIco = `${appIconBase}.ico`;

/** Drop unused Chromium translations (often tens of MB under ``locales/``). */
function prunePackagerLocales(buildPath, platform) {
  if (platform !== 'win32' && platform !== 'linux') {
    return;
  }
  const localesDir = path.join(buildPath, 'locales');
  if (!fs.existsSync(localesDir)) {
    return;
  }
  const keep = new Set(['en-US.pak']);
  for (const name of fs.readdirSync(localesDir)) {
    if (!keep.has(name)) {
      fs.unlinkSync(path.join(localesDir, name));
    }
  }
}

function hasExternalBinary(name) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const pathEntries = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const entry of pathEntries) {
    for (const ext of extensions) {
      const candidate = path.join(entry, `${name}${ext}`);
      if (fs.existsSync(candidate)) {
        return true;
      }
    }
  }
  return false;
}

const makers = [
  {
    name: '@electron-forge/maker-squirrel',
    config: {
      setupIcon: appIconIco,
    },
  },
  {
    name: '@electron-forge/maker-zip',
    platforms: ['darwin'],
  },
  {
    name: '@electron-forge/maker-deb',
    config: {},
  },
];

if (process.platform !== 'linux' || hasExternalBinary('rpmbuild')) {
  makers.push({
    name: '@electron-forge/maker-rpm',
    config: {},
  });
}

module.exports = {
  outDir,
  packagerConfig: {
    asar: true,
    icon: appIconBase,
    afterCopy: [
      (buildPath, _electronVersion, platform, _arch, callback) => {
        try {
          prunePackagerLocales(buildPath, platform);
          callback();
        } catch (err) {
          callback(err);
        }
      },
    ],
    ...(extraResource.length ? { extraResource } : {}),
  },
  rebuildConfig: {},
  makers,
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/index.ts',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.ts',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'a3r0id',
          name: 'launchpad',
        },
        prerelease: false,
        /** Must match ``releaseTag`` derived in ``index.ts`` (default ``v`` + semver from ``version.json``). */
        tagPrefix: 'v',
      },
    },
  ],
};
