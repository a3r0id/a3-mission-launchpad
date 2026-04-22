#!/usr/bin/env python3
"""
Unified utility entrypoint for Launchpad release workflows.

Usage:
  python util.py --build
  python util.py --build --pbo
  python util.py --publish
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


REPO = Path(__file__).resolve().parent
A3 = REPO / "A3LaunchPad"
CLIENT_DIST = REPO / "launchpad_client" / "renderer" / "dist"
EXT_ROOT = REPO / "launchpad_mod" / "extension"
A3HOOK_ROOT = REPO / "a3hook"
ADDON_PBO_NAME = "a3_launchpad_ext_main.pbo"
HEMTT_BUILD_ADDONS = REPO / "launchpad_mod" / ".hemttout" / "build" / "addons"
APP_DIR = REPO / "launchpad_client" / "app"
APP_PACKAGE_JSON = APP_DIR / "package.json"
APP_MAIN_TS = APP_DIR / "src" / "index.ts"
FORGE_CONFIG = APP_DIR / "forge.config.js"
VERSION_JSON = REPO / "version.json"
ROOT_CONFIG_JSON = REPO / "config.json"
DOTENV_PATH = REPO / ".env"


def _die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def _run(argv: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    merged_env = {**os.environ, **(env or {})}
    if sys.platform == "win32":
        proc = subprocess.run(
            subprocess.list2cmdline(argv),
            cwd=str(cwd),
            shell=True,
            check=False,
            env=merged_env,
        )
    else:
        proc = subprocess.run(argv, cwd=str(cwd), check=False, env=merged_env)
    if proc.returncode != 0:
        _die(
            f"Command failed with exit code {proc.returncode}.\n"
            f"  cwd: {cwd}\n"
            f"  cmd: {' '.join(argv)}"
        )


def _run_npm(args: list[str], cwd: Path, *, extra_env: dict[str, str] | None = None) -> None:
    _run(["npm", *args], cwd=cwd, env=extra_env)


def _load_dotenv(path: Path) -> None:
    """Populate ``os.environ`` from a ``.env`` file (no extra deps). Existing env wins."""
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key in os.environ:
            continue
        os.environ[key] = value


def _read_json_optional(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _die(f"Invalid JSON in {path}: {exc}")
    if not isinstance(payload, dict):
        _die(f"Expected a JSON object in {path}")
    return payload


def _resolve_temp_directory(raw: str | None) -> Path | None:
    if raw is None:
        return None
    candidate = str(raw).strip()
    if not candidate:
        return None
    # Support both shell-style vars ($TMPDIR) and Windows-style placeholders (%temp%).
    candidate = os.path.expanduser(os.path.expandvars(candidate))
    temp_dir = tempfile.gettempdir()
    for token in ("%TEMP%", "%temp%", "%TMP%", "%tmp%"):
        candidate = candidate.replace(token, temp_dir)
    return Path(candidate).resolve()


def _resolve_temp_cleanup_mode(raw: str | None) -> str:
    if raw is None:
        return "auto"
    mode = str(raw).strip().lower()
    if not mode:
        return "auto"
    if mode not in {"auto", "always"}:
        _die(
            "Invalid config.json value for `temp_directory_cleanup`.\n"
            "Expected one of: auto, always"
        )
    return mode


def _publish_copy_ignore(_src: str, names: list[str]) -> set[str]:
    ignored = {
        ".git",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        "node_modules",
        "build",
        "out",
        "A3LaunchPad",
        "launchpad_data",
    }
    return {name for name in names if name in ignored}


def _run_publish_in_temp_workspace(temp_root: Path, cleanup_mode: str) -> None:
    dist_root = temp_root / "dist"
    workspace = dist_root / f"launchpad-publish-{uuid.uuid4().hex[:12]}"
    dist_existed_before = dist_root.exists()
    dist_root.mkdir(parents=True, exist_ok=True)
    print(f"Creating temporary publish workspace: {workspace}")
    shutil.copytree(REPO, workspace, ignore=_publish_copy_ignore)
    env = {
        **os.environ,
        "LAUNCHPAD_TEMP_PUBLISH_ACTIVE": "1",
    }
    try:
        proc = subprocess.run(
            [sys.executable, "util.py", "--publish"],
            cwd=str(workspace),
            check=False,
            env=env,
        )
        if proc.returncode != 0:
            _die(
                "Publish failed in temporary workspace.\n"
                "See the error output above for the root cause."
            )
    finally:
        _rmtree_retry(workspace, fatal=False)
        should_remove_dist = cleanup_mode == "always" or (cleanup_mode == "auto" and not dist_existed_before)
        if should_remove_dist:
            if cleanup_mode == "always":
                _rmtree_retry(dist_root, fatal=False)
                return
            try:
                dist_root.rmdir()
            except OSError:
                # Keep folder if another process wrote to it.
                pass


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


def _cmake_configure_and_build(*, source_dir: Path, build_dir: Path) -> None:
    """Same pattern as the Arma extension: ``cmake -B build -S source`` from repo root."""
    configure = ["cmake", "-B", str(build_dir), "-S", str(source_dir)]
    if sys.platform != "win32":
        configure += ["-DCMAKE_BUILD_TYPE=Release"]
    subprocess.run(configure, cwd=str(REPO), check=True)
    build_cmd = ["cmake", "--build", str(build_dir), "--parallel"]
    if sys.platform == "win32":
        build_cmd += ["--config", "Release"]
    subprocess.run(build_cmd, cwd=str(REPO), check=True)


def _find_extension_binary() -> Path | None:
    names = ("A3_LAUNCHPAD_EXT_x64.dll",) if os.name == "nt" else ("A3_LAUNCHPAD_EXT_x64.so",)
    search_roots = (
        EXT_ROOT / "build" / "Release",
        EXT_ROOT / "build" / "RelWithDebInfo",
        EXT_ROOT / "build" / "Debug",
        EXT_ROOT / "build",
        EXT_ROOT / "ci-build",
        REPO / "launchpad_mod" / "bin" / "mod",
        A3,
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


def _find_a3hook_binary() -> Path | None:
    names = ("a3hook.exe",) if os.name == "nt" else ("a3hook",)
    hook_build = A3HOOK_ROOT / "build"
    search_roots = (
        hook_build / "Release",
        hook_build / "RelWithDebInfo",
        hook_build / "Debug",
        hook_build,
        A3,
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
            n = p.name.lower()
            if "a3_launchpad_ext" in n and "diagnostics" not in n:
                candidates.append(p)
    releases = REPO / "launchpad_mod" / "releases"
    if releases.is_dir():
        for p in releases.rglob("*.pbo"):
            rel = str(p).replace("\\", "/").lower()
            n = p.name.lower()
            if "/addons/" in rel and "a3_launchpad_ext" in n and "diagnostics" not in n:
                candidates.append(p)
    if not candidates:
        return None
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates[0]


def stage_mod_deliverables() -> None:
    """Stage ``A3LaunchPad/mod/addons/*.pbo`` and native binaries on ``A3LaunchPad/`` (sibling of ``mod/``)."""
    a3_root = A3
    mod_root = A3 / "mod"
    addons_dir = mod_root / "addons"
    addons_dir.mkdir(parents=True, exist_ok=True)

    ext = _find_extension_binary()
    if ext is not None:
        dest_name = "A3_LAUNCHPAD_EXT_x64.dll" if os.name == "nt" else "A3_LAUNCHPAD_EXT_x64.so"
        a3_root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ext, a3_root / dest_name)
        print(f"Staged extension: {ext.name} -> {a3_root / dest_name}")
    else:
        print(
            "Warning: native extension binary not found. Build the CMake target first.",
            file=sys.stderr,
        )

    hook = _find_a3hook_binary()
    if hook is not None:
        hook_dest = "a3hook.exe" if os.name == "nt" else "a3hook"
        a3_root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(hook, a3_root / hook_dest)
        print(f"Staged a3hook: {hook.name} -> {a3_root / hook_dest}")
    else:
        print(
            "Warning: a3hook executable not found. Build the CMake target in a3hook first.",
            file=sys.stderr,
        )

    pbo_src = _find_addon_pbo()
    dest_pbo = addons_dir / ADDON_PBO_NAME
    loose_dir = addons_dir / "a3_launchpad_ext_main"
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


def _package_core() -> None:
    preflight_package()
    A3.mkdir(parents=True, exist_ok=True)
    stage_web_dist()
    stage_mod_deliverables()


def run_build(*, rebuild_pbo: bool = False) -> None:
    renderer = REPO / "launchpad_client" / "renderer"
    mod_root = REPO / "launchpad_mod"
    ext_dir = mod_root / "extension"
    ext_build = ext_dir / "build"
    hook_build = A3HOOK_ROOT / "build"

    # Temp publish workspaces omit node_modules; install before tsc/vite.
    if not (renderer / "node_modules").is_dir():
        print("Installing renderer dependencies (npm ci)...")
        _run_npm(["ci"], renderer)

    _run_npm(["run", "build"], renderer)

    _cmake_configure_and_build(source_dir=ext_dir, build_dir=ext_build)
    _cmake_configure_and_build(source_dir=A3HOOK_ROOT, build_dir=hook_build)

    require_hemtt_env = os.environ.get("LAUNCHPAD_REQUIRE_HEMTT", "0") == "1"
    hemtt = shutil.which("hemtt")
    if hemtt:
        if rebuild_pbo:
            print("Rebuilding addon PBO (hemtt build)...")
        _run(["hemtt", "build"], cwd=mod_root)
    elif rebuild_pbo or require_hemtt_env:
        reasons: list[str] = []
        if rebuild_pbo:
            reasons.append("--pbo was passed")
        if require_hemtt_env:
            reasons.append("LAUNCHPAD_REQUIRE_HEMTT=1 is set")
        _die(
            "HEMTT was not found on PATH, but an addon PBO build is required ("
            + "; ".join(reasons)
            + ").\n"
            "Install HEMTT so `hemtt` is on PATH, or run `hemtt build` in launchpad_mod."
        )
    else:
        print(
            "Warning: HEMTT is not installed; skipping 'hemtt build'.",
            file=sys.stderr,
        )

    _package_core()
    stage_electron_app()
    print(
        f"Build complete: web UI in {A3 / 'web_dist'}, "
        f"companion mod under {A3 / 'mod'}, native binaries on {A3}, Electron under {A3 / 'app'}"
    )


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        _die(f"Missing required JSON file: {path}")
    except json.JSONDecodeError as exc:
        _die(f"Invalid JSON in {path}: {exc}")


def _sync_publish_versions() -> str:
    root_version = str(_read_json(VERSION_JSON).get("version", "")).strip()
    app_payload = _read_json(APP_PACKAGE_JSON)
    app_version = str(app_payload.get("version", "")).strip()
    if not root_version:
        _die(f"`version` is missing in {VERSION_JSON}")
    if not app_version:
        _die(f"`version` is missing in {APP_PACKAGE_JSON}")
    if root_version != app_version:
        app_payload["version"] = root_version
        APP_PACKAGE_JSON.write_text(json.dumps(app_payload, indent=2) + "\n", encoding="utf-8")
        print(
            "Version mismatch detected; synchronized app package version:\n"
            f"  version.json: {root_version}\n"
            f"  launchpad_client/app/package.json: {root_version}"
        )
    return f"v{root_version}"


def _validate_staged_layout() -> None:
    required_paths = (A3 / "web_dist", A3 / "app")
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
    main_ts = APP_MAIN_TS.read_text(encoding="utf-8")
    forge_js = FORGE_CONFIG.read_text(encoding="utf-8")
    required_snippets = (
        ("index.ts", "updateElectronApp("),
        ("index.ts", "UpdateSourceType.ElectronPublicUpdateService"),
        ("index.ts", "repo: 'a3r0id/launchpad'"),
        ("forge.config.js", "name: '@electron-forge/publisher-github'"),
        ("forge.config.js", "owner: 'a3r0id'"),
        ("forge.config.js", "name: 'launchpad'"),
        ("forge.config.js", "tagPrefix: 'v'"),
    )
    for file_name, snippet in required_snippets:
        source = main_ts if file_name == "index.ts" else forge_js
        if snippet not in source:
            _die(f"Missing expected snippet in {file_name}: {snippet}")


def _resolve_github_token() -> str:
    _load_dotenv(DOTENV_PATH)
    token = (
        os.environ.get("GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or os.environ.get("ELECTRON_FORGE_GITHUB_TOKEN")
    )
    if not token:
        _die(
            "No GitHub token found. Add GITHUB_TOKEN to .env at the repo root, or set one of: "
            "GITHUB_TOKEN, GH_TOKEN, ELECTRON_FORGE_GITHUB_TOKEN in the environment."
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
    _load_dotenv(DOTENV_PATH)
    expected_tag = _sync_publish_versions()

    if os.environ.get("LAUNCHPAD_TEMP_PUBLISH_ACTIVE") != "1":
        root_cfg = _read_json_optional(ROOT_CONFIG_JSON)
        temp_root = _resolve_temp_directory(root_cfg.get("temp_directory"))
        cleanup_mode = _resolve_temp_cleanup_mode(root_cfg.get("temp_directory_cleanup"))
        if temp_root is not None:
            _run_publish_in_temp_workspace(temp_root, cleanup_mode)
            return

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
    parser.add_argument(
        "--pbo",
        action="store_true",
        help="With --build: require HEMTT and run hemtt build so the addon PBO is rebuilt.",
    )
    parser.add_argument("--publish", action="store_true", help="Build and publish release artifacts.")
    args = parser.parse_args()

    if args.build == args.publish:
        parser.error("Specify exactly one action: --build or --publish")
    if args.pbo and not args.build:
        parser.error("--pbo is only valid with --build")
    if args.build:
        run_build(rebuild_pbo=args.pbo)
        return
    run_publish()


if __name__ == "__main__":
    main()
