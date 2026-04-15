#!/usr/bin/env python3
"""
Unified utility entrypoint for Launchpad release workflows.

Usage:
  python util.py --build
  python util.py --publish
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path


REPO = Path(__file__).resolve().parent
SPEC = REPO / "launchpad.spec"
A3 = REPO / "A3LaunchPad"
CLIENT_DIST = REPO / "launchpad_client" / "renderer" / "dist"
EXT_ROOT = REPO / "launchpad_mod" / "extension"
ADDON_PBO_NAME = "a3_launchpad_ext_core.pbo"
HEMTT_BUILD_ADDONS = REPO / "launchpad_mod" / ".hemttout" / "build" / "addons"
APP_DIR = REPO / "launchpad_client" / "app"
APP_PACKAGE_JSON = APP_DIR / "package.json"
APP_MAIN_JS = APP_DIR / "src" / "main.js"
FORGE_CONFIG = APP_DIR / "forge.config.js"
VERSION_JSON = REPO / "version.json"


def _die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def _run(argv: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    merged_env = {**os.environ, **(env or {})}
    if sys.platform == "win32":
        subprocess.run(
            subprocess.list2cmdline(argv),
            cwd=str(cwd),
            shell=True,
            check=True,
            env=merged_env,
        )
    else:
        subprocess.run(argv, cwd=str(cwd), check=True, env=merged_env)


def _run_npm(args: list[str], cwd: Path, *, extra_env: dict[str, str] | None = None) -> None:
    _run(["npm", *args], cwd=cwd, env=extra_env)


def _rmtree_retry(
    path: Path,
    *,
    attempts: int = 8,
    delay_sec: float = 0.75,
    fatal: bool = True,
) -> bool:
    if not path.exists():
        return True
    last_err: OSError | None = None
    for i in range(attempts):
        try:
            shutil.rmtree(path)
            return True
        except OSError as e:
            last_err = e
            if i + 1 == attempts:
                break
            time.sleep(delay_sec)
    assert last_err is not None
    msg = (
        f"Could not remove {path} ({last_err}).\n"
        "Close any running Launchpad/Electron windows and Explorer previews, then retry."
    )
    if fatal:
        _die(msg)
    print(f"Warning: {msg}", file=sys.stderr)
    return False


def preflight_package() -> None:
    if not CLIENT_DIST.is_dir() or not any(CLIENT_DIST.iterdir()):
        _die(
            f"Missing web client build at {CLIENT_DIST}.\n"
            "  cd launchpad_client/renderer && npm ci && npm run build"
        )
    if not SPEC.is_file():
        _die(f"Missing PyInstaller spec: {SPEC}")


def stage_web_dist() -> None:
    dst = A3 / "web_dist"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(CLIENT_DIST, dst)
    print(f"Staged web UI: {CLIENT_DIST} -> {dst}")


def stage_electron_app() -> None:
    if not (APP_DIR / "node_modules").is_dir():
        print("Installing Electron app dependencies (npm ci)...")
        _run_npm(["ci"], APP_DIR)
    electron_out = REPO / "build" / f"electron-forge-{uuid.uuid4().hex[:12]}"
    electron_out.mkdir(parents=True, exist_ok=True)
    out_abs = str(electron_out.resolve())
    print(f"Electron Forge output directory: {out_abs}")
    _run_npm(["run", "package"], APP_DIR, extra_env={"LAUNCHPAD_ELECTRON_OUT": out_abs})
    if not electron_out.is_dir() or not any(electron_out.iterdir()):
        print(f"Warning: Electron package produced no output under {electron_out}", file=sys.stderr)
        return
    dest = A3 / "app"
    if _rmtree_retry(dest, fatal=False):
        shutil.copytree(electron_out, dest)
        print(f"Staged Electron app: {electron_out} -> {dest}")
    else:
        fallback = A3 / f"app-{uuid.uuid4().hex[:8]}"
        _rmtree_retry(fallback, fatal=False)
        shutil.copytree(electron_out, fallback)
        print(f"Staged Electron app to fallback location: {fallback}", file=sys.stderr)
    try:
        shutil.rmtree(electron_out)
    except OSError:
        print(f"Note: could not remove temporary {electron_out}.", file=sys.stderr)


def _find_extension_binary() -> Path | None:
    names = ("A3_LAUNCHPAD_EXT_x64.dll",) if os.name == "nt" else ("A3_LAUNCHPAD_EXT_x64.so",)
    search_roots = (
        EXT_ROOT / "build" / "Release",
        EXT_ROOT / "build" / "RelWithDebInfo",
        EXT_ROOT / "build" / "Debug",
        EXT_ROOT / "build",
        EXT_ROOT / "ci-build",
        REPO / "launchpad_mod" / "bin" / "mod",
        A3 / "mod",
    )
    for root in search_roots:
        if not root.is_dir():
            continue
        for name in names:
            p = root / name
            if p.is_file():
                return p
    return None


def _find_addon_pbo() -> Path | None:
    candidates: list[Path] = []
    if HEMTT_BUILD_ADDONS.is_dir():
        for p in HEMTT_BUILD_ADDONS.glob("*.pbo"):
            if "a3_launchpad_ext_core" in p.name.lower():
                candidates.append(p)
    releases = REPO / "launchpad_mod" / "releases"
    if releases.is_dir():
        for p in releases.rglob("*.pbo"):
            rel = str(p).replace("\\", "/").lower()
            if "/addons/" in rel and "a3_launchpad_ext_core" in p.name.lower():
                candidates.append(p)
    if not candidates:
        return None
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates[0]


def stage_mod_deliverables() -> None:
    mod_root = A3 / "mod"
    addons_dir = mod_root / "addons"
    addons_dir.mkdir(parents=True, exist_ok=True)

    ext = _find_extension_binary()
    if ext is not None:
        dest_name = "A3_LAUNCHPAD_EXT_x64.dll" if os.name == "nt" else "A3_LAUNCHPAD_EXT_x64.so"
        shutil.copy2(ext, mod_root / dest_name)
        print(f"Staged extension: {ext.name} -> {mod_root / dest_name}")
    else:
        print(
            "Warning: native extension binary not found. Build the CMake target first.",
            file=sys.stderr,
        )

    pbo_src = _find_addon_pbo()
    dest_pbo = addons_dir / ADDON_PBO_NAME
    loose_dir = addons_dir / "a3_launchpad_ext_core"
    if loose_dir.is_dir():
        shutil.rmtree(loose_dir)
    if pbo_src is None:
        print(
            "Warning: addon PBO not found. Run `hemtt build` in launchpad_mod.",
            file=sys.stderr,
        )
        return
    if dest_pbo.exists():
        dest_pbo.unlink()
    shutil.copy2(pbo_src, dest_pbo)
    print(f"Staged addon PBO: {pbo_src.name} -> {dest_pbo}")


def _package_core() -> Path:
    preflight_package()
    A3.mkdir(parents=True, exist_ok=True)
    stage_web_dist()
    bin_out = A3 / "bin"
    bin_out.mkdir(parents=True, exist_ok=True)
    work = REPO / "build" / "pyinstaller"
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            str(SPEC),
            "--noconfirm",
            "--clean",
            "--distpath",
            str(bin_out),
            "--workpath",
            str(work),
        ],
        cwd=str(REPO),
        check=True,
    )
    stage_mod_deliverables()
    return bin_out


def run_build() -> None:
    renderer = REPO / "launchpad_client" / "renderer"
    mod_root = REPO / "launchpad_mod"
    ext_dir = mod_root / "extension"
    ext_build = ext_dir / "build"

    _run_npm(["run", "build"], renderer)

    configure = ["cmake", "-B", str(ext_build), "-S", str(ext_dir)]
    if sys.platform != "win32":
        configure += ["-DCMAKE_BUILD_TYPE=Release"]
    subprocess.run(configure, cwd=str(REPO), check=True)

    build_cmd = ["cmake", "--build", str(ext_build), "--parallel"]
    if sys.platform == "win32":
        build_cmd += ["--config", "Release"]
    subprocess.run(build_cmd, cwd=str(REPO), check=True)

    require_hemtt = os.environ.get("LAUNCHPAD_REQUIRE_HEMTT", "0") == "1"
    if shutil.which("hemtt"):
        _run(["hemtt", "build"], cwd=mod_root)
    elif require_hemtt:
        _die("HEMTT was not found on PATH, but LAUNCHPAD_REQUIRE_HEMTT=1 is set.")
    else:
        print(
            "Warning: HEMTT is not installed; skipping 'hemtt build'.",
            file=sys.stderr,
        )

    bin_out = _package_core()
    stage_electron_app()
    print(
        f"Build complete: server in {bin_out}, web UI in {A3 / 'web_dist'}, "
        f"mod under {A3 / 'mod'}, Electron under {A3 / 'app'}"
    )


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        _die(f"Missing required JSON file: {path}")
    except json.JSONDecodeError as exc:
        _die(f"Invalid JSON in {path}: {exc}")


def _validate_version_alignment() -> str:
    root_version = str(_read_json(VERSION_JSON).get("version", "")).strip()
    app_version = str(_read_json(APP_PACKAGE_JSON).get("version", "")).strip()
    if not root_version:
        _die(f"`version` is missing in {VERSION_JSON}")
    if not app_version:
        _die(f"`version` is missing in {APP_PACKAGE_JSON}")
    if root_version != app_version:
        _die(
            "Version mismatch detected:\n"
            f"  version.json: {root_version}\n"
            f"  launchpad_client/app/package.json: {app_version}"
        )
    return f"v{app_version}"


def _validate_staged_layout() -> None:
    required_paths = (A3 / "bin", A3 / "web_dist")
    missing = [str(p) for p in required_paths if not p.exists()]
    if missing:
        _die(
            "Staged deliverables are incomplete under A3LaunchPad.\n"
            + "\n".join(f"  - {m}" for m in missing)
        )


def _ensure_node_modules() -> None:
    if not (APP_DIR / "node_modules").is_dir():
        print("Installing app dependencies (npm ci)...")
        _run_npm(["ci"], APP_DIR)


def _validate_update_config() -> None:
    main_js = APP_MAIN_JS.read_text(encoding="utf-8")
    forge_js = FORGE_CONFIG.read_text(encoding="utf-8")
    required_snippets = (
        ("main.js", "updateElectronApp("),
        ("main.js", "UpdateSourceType.ElectronPublicUpdateService"),
        ("main.js", "repo: 'a3r0id/a3-mission-launchpad'"),
        ("forge.config.js", "name: '@electron-forge/publisher-github'"),
        ("forge.config.js", "owner: 'a3r0id'"),
        ("forge.config.js", "name: 'a3-mission-launchpad'"),
        ("forge.config.js", "tagPrefix: 'v'"),
    )
    for file_name, snippet in required_snippets:
        source = main_js if file_name == "main.js" else forge_js
        if snippet not in source:
            _die(f"Missing expected snippet in {file_name}: {snippet}")


def _resolve_github_token() -> str:
    token = (
        os.environ.get("GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or os.environ.get("ELECTRON_FORGE_GITHUB_TOKEN")
    )
    if not token:
        _die(
            "No GitHub token found. Set one of: GITHUB_TOKEN, GH_TOKEN, ELECTRON_FORGE_GITHUB_TOKEN"
        )
    return token


def _publish(github_token: str) -> None:
    out_dir = REPO / "build" / f"electron-forge-publish-{uuid.uuid4().hex[:12]}"
    out_dir.mkdir(parents=True, exist_ok=True)
    env = {
        "LAUNCHPAD_ELECTRON_OUT": str(out_dir.resolve()),
        "GITHUB_TOKEN": github_token,
        "GH_TOKEN": github_token,
        "ELECTRON_FORGE_GITHUB_TOKEN": github_token,
    }
    print(f"Publishing Electron release via Forge from {APP_DIR}")
    print(f"LAUNCHPAD_ELECTRON_OUT={env['LAUNCHPAD_ELECTRON_OUT']}")
    _run(["npm", "run", "publish"], cwd=APP_DIR, env=env)


def run_publish() -> None:
    expected_tag = _validate_version_alignment()
    print(f"Release tag expected for updater compatibility: {expected_tag}")
    run_build()
    _validate_staged_layout()
    _ensure_node_modules()
    _validate_update_config()
    token = _resolve_github_token()
    _publish(token)
    print(f"Publish complete for tag {expected_tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Launchpad build/publish utility.")
    parser.add_argument("--build", action="store_true", help="Run the full build pipeline.")
    parser.add_argument("--publish", action="store_true", help="Build and publish release artifacts.")
    args = parser.parse_args()

    if args.build == args.publish:
        parser.error("Specify exactly one action: --build or --publish")
    if args.build:
        run_build()
        return
    run_publish()


if __name__ == "__main__":
    main()
