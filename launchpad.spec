# -*- mode: python ; coding: utf-8 -*-
# Portable onedir build: output folder ``A3MissionLaunchpad`` under ``--distpath`` (see package.bat).
# Prerequisite: ``npm run build`` in ``launchpad_client`` so ``launchpad_client/dist`` exists.
# Splash: replace ``packaging/splash.png`` (PNG; avoid #ff00ff on Windows — reserved for transparency).
import os

_spec_dir = os.path.dirname(os.path.abspath(SPEC))
_launchpad = os.path.join(_spec_dir, "launchpad")
_entry = os.path.join(_launchpad, "__main__.py")
_config = os.path.join(_launchpad, "config.json")
_client_dist = os.path.join(_spec_dir, "launchpad_client", "dist")
_splash_img = os.path.join(_spec_dir, "packaging", "splash.png")

a = Analysis(
    [_entry],
    pathex=[_launchpad],
    binaries=[],
    datas=[
        (_config, "."),
        (_client_dist, "web_dist"),
    ],
    hiddenimports=["thirdparty.a3lib"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

splash = Splash(
    _splash_img,
    binaries=a.binaries,
    datas=a.datas,
    text_pos=None,
)

exe = EXE(
    pyz,
    splash,
    a.scripts,
    [],
    exclude_binaries=True,
    name="A3MissionLaunchpad",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    splash.binaries,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="A3MissionLaunchpad",
)
