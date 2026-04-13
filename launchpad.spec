# -*- mode: python ; coding: utf-8 -*-
# Portable onedir build: output folder ``A3MissionLaunchpad`` under ``--distpath`` (see package.bat).
# Prerequisite: ``npm run build`` in ``launchpad_client`` so ``launchpad_client/dist`` exists.
# Splash: ``launchpad_client/src/assets/hero.png`` (PNG; avoid #ff00ff on Windows — reserved for transparency).
# EXE icon: ``icon.png`` at repo root is converted to ``build/_launchpad_exe.ico`` (Windows requires .ico; Pillow).
import os

_spec_dir = os.path.dirname(os.path.abspath(SPEC))
_launchpad = os.path.join(_spec_dir, "launchpad")
_entry = os.path.join(_launchpad, "__main__.py")
_config = os.path.join(_launchpad, "config.json")
_client_dist = os.path.join(_spec_dir, "launchpad_client", "dist")
_splash_img = os.path.join(_spec_dir, "launchpad_client", "src", "assets", "hero.png")


def _build_exe_icon_ico(spec_dir: str) -> str:
    """Build a multi-size .ico next to PyInstaller workpath for ``EXE(icon=...)``."""
    png = os.path.join(spec_dir, "icon.png")
    if not os.path.isfile(png):
        raise FileNotFoundError(f"Missing application icon source: {png}")
    try:
        from PIL import Image
    except ImportError as e:
        raise RuntimeError(
            "Pillow is required to convert icon.png to .ico for the Windows executable. "
            "Install with: pip install Pillow"
        ) from e
    build_dir = os.path.join(spec_dir, "build")
    os.makedirs(build_dir, exist_ok=True)
    ico_out = os.path.join(build_dir, "_launchpad_exe.ico")
    im = Image.open(png).convert("RGBA")
    sizes_px = (16, 24, 32, 48, 64, 128, 256)
    frames = [im.resize((s, s), Image.Resampling.LANCZOS) for s in sizes_px]
    frames[0].save(
        ico_out,
        format="ICO",
        sizes=[(s, s) for s in sizes_px],
        append_images=frames[1:],
    )
    return ico_out


_exe_icon = _build_exe_icon_ico(_spec_dir)

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
    icon=_exe_icon,
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
