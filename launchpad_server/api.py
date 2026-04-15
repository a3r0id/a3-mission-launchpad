from __future__ import annotations

from collections.abc import Callable, Iterable
import copy
from datetime import datetime, timezone
import json
import logging
import os
import queue
import threading
import shlex
import shutil
import subprocess
import tempfile
import uuid
import psutil
import time
import re
from http.server import BaseHTTPRequestHandler
from typing import Any, ClassVar
from urllib.parse import parse_qs, unquote, urlparse

try:
    from .constants import Constants
    from .github_integration import (
        gh_publish_mission_repo,
        git_commit_all,
        git_init_mission_repo,
        git_recent_log,
        git_repo_status,
        suggest_github_repo_slug,
    )
    from .mission_gen import (
        _launchpad_data_dir,
        generate as mission_generate,
        iter_profile_mission_symlink_candidates,
        profile_mission_symlink_path,
    )
    from .utils import make_mission_pbo
except ImportError:
    from constants import Constants
    from github_integration import (
        gh_publish_mission_repo,
        git_commit_all,
        git_init_mission_repo,
        git_recent_log,
        git_repo_status,
        suggest_github_repo_slug,
    )
    from mission_gen import (
        _launchpad_data_dir,
        generate as mission_generate,
        iter_profile_mission_symlink_candidates,
        profile_mission_symlink_path,
    )
    from utils import make_mission_pbo

logger = logging.getLogger(__name__)


class NdjsonStream:
    """Handler return type: ``__main__`` writes ``application/x-ndjson`` from ``rows``."""

    __slots__ = ("rows",)

    def __init__(self, rows: Iterable[dict[str, Any]]):
        self.rows = rows


def _normalize_route_path(path: str) -> str:
    """Return route key like ``mission/build`` (no leading slash, no query string)."""
    p = path.split("?", 1)[0].strip().strip("/")
    if p.startswith("api/"):
        p = p[4:].lstrip("/")
    return p


def _api_subpath_from_handler_path(handler_path: str) -> str | None:
    path = handler_path.split("?", 1)[0]
    if not path.startswith("/api/"):
        return None
    sub = path[len("/api/") :].lstrip("/")
    return sub or None


def _parse_managed_scenario_git_subpath(subpath: str) -> tuple[str, str] | None:
    """
    Parse ``managed/scenarios/<id>/git/<action>`` into ``(mission_id, action)``.
    ``action`` is one of: ``status``, ``log``, ``commit``, ``init``, ``publish``.
    """
    prefix = "managed/scenarios/"
    if not subpath.startswith(prefix) or "/git/" not in subpath:
        return None
    tail = subpath[len(prefix) :]
    mid, _, rest = tail.partition("/git/")
    mission_id = unquote(mid.strip("/"))
    action = rest.strip("/").split("/", 1)[0].strip()
    if not mission_id or action not in ("status", "log", "commit", "init", "publish"):
        return None
    return mission_id, action


def _parse_managed_scenario_action_subpath(subpath: str) -> tuple[str, str] | None:
    """Parse ``managed/scenarios/<id>/<action>`` for non-git actions."""
    prefix = "managed/scenarios/"
    if not subpath.startswith(prefix):
        return None
    tail = subpath[len(prefix) :]
    mission_id, _, rest = tail.partition("/")
    mission_id = unquote(mission_id.strip())
    action = rest.strip("/").split("/", 1)[0].strip()
    if not mission_id or not action:
        return None
    if action not in ("mods", "launch"):
        return None
    return mission_id, action


def _managed_mission_github_repo_or_error(mission_id: str) -> tuple[str | None, dict[str, Any] | None]:
    """If valid, ``(repo_path, None)``; otherwise ``(None, error_payload)``."""
    all_missions = _read_managed_missions_raw()
    row = all_missions.get(mission_id)
    if not isinstance(row, dict):
        return None, {"_http_status": 404, "error": "Mission not found."}
    if not row.get("github_integration"):
        return None, {
            "_http_status": 403,
            "error": "GitHub integration is not enabled for this mission. Turn it on in Edit → GitHub.",
        }
    pp = row.get("project_path")
    if not isinstance(pp, str) or not pp.strip():
        return None, {"_http_status": 400, "error": "Mission has no project_path."}
    resolved = _path_under_allowed_root(pp.strip())
    if not resolved or not os.path.isdir(resolved):
        return None, {"_http_status": 404, "error": "Project folder not found or not allowed."}
    return resolved, None


_MANAGED_MISSIONS_FILE = "managed_missions.json"
_TESTING_MODLIST_FILE = "testing_modlist.json"
_SETTINGS_FILE = "settings.json"
_AUTOTEST_SCAN_MAX_FILES = 8
_AUTOTEST_SCAN_MAX_BYTES_PER_FILE = 1_000_000
_AUTOTEST_CARRY_MAX = 8192
_AUTOTEST_BLOCK_RE = re.compile(
    r"<AutoTest\s+result=\"(?P<result>[^\"]+)\"\s*>(?P<body>.*?)</AutoTest>",
    re.IGNORECASE | re.DOTALL,
)
_SETTINGS_KEYS = frozenset(
    {
        "arma3_path",
        "arma3_tools_path",
        "arma3_profile_path",
        "arma3_appdata_path",
        "default_author",
        "github_new_repo_visibility",
    }
)


def _managed_missions_path() -> str:
    return os.path.join(_launchpad_data_dir(), _MANAGED_MISSIONS_FILE)


def _testing_modlist_path() -> str:
    return os.path.join(_launchpad_data_dir(), _TESTING_MODLIST_FILE)


def _read_testing_modlist_store() -> dict[str, Any]:
    path = _testing_modlist_path()
    if not os.path.isfile(path):
        return {"mods": []}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"mods": []}
    if not isinstance(raw, dict):
        return {"mods": []}
    mods = raw.get("mods")
    if not isinstance(mods, list):
        return {"mods": []}
    return {"mods": mods}


def _managed_row_or_error(mission_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    all_missions = _read_managed_missions_raw()
    row = all_missions.get(mission_id)
    if not isinstance(row, dict):
        return None, {"_http_status": 404, "error": "Mission not found."}
    return row, None


def _validate_testing_mod_path(path: str) -> str | None:
    """Return normalized path or None if invalid (used in ``-mod=`` segments; no ``;``)."""
    s = os.path.expandvars((path or "").strip())
    if not s or len(s) > 512:
        return None
    if any(c in s for c in ("\x00", "\n", "\r", ";")):
        return None
    if s.startswith("-"):
        return None
    try:
        return os.path.normpath(s)
    except OSError:
        return None


_ARMA3_WORKSHOP_APP_ID = "107410"


def _steam_workshop_content_dir(game_root: str) -> str | None:
    """
    Return ``.../steamapps/workshop/content/107410`` for a typical Steam layout where
    ``game_root`` is ``.../steamapps/common/Arma 3``.
    """
    root = (game_root or "").strip()
    if not root:
        return None
    try:
        common = os.path.dirname(os.path.normpath(os.path.expandvars(root)))
        steamapps = os.path.dirname(common)
        content = os.path.join(steamapps, "workshop", "content", _ARMA3_WORKSHOP_APP_ID)
        if os.path.isdir(content):
            return os.path.realpath(content)
    except OSError:
        return None
    return None


def _workshop_item_id_from_mod_entry(path_or_url: str) -> str | None:
    """Parse a Steam Workshop published file id from a preset URL or return None."""
    s = (path_or_url or "").strip()
    if not s:
        return None
    low = s.lower()
    if low.startswith(("http://", "https://")):
        try:
            u = urlparse(s)
            ids = parse_qs(u.query).get("id") or []
            if ids:
                cand = str(ids[0]).strip()
                if cand.isdigit():
                    return cand
        except (TypeError, ValueError):
            pass
        m = re.search(r"[?&]id=(\d+)", s, re.I)
        if m:
            return m.group(1)
        return None
    return None


def _resolve_mod_path_for_launch(raw: str, game_root: str) -> str | None:
    """
    Turn a saved mod entry into a single ``-mod=`` segment: local paths as validated
    filesystem paths; Arma launcher HTML presets (Steam workshop URLs) into
    ``workshop/content/107410/<id>`` when that folder exists.
    """
    wid = _workshop_item_id_from_mod_entry(raw)
    if wid:
        content = _steam_workshop_content_dir(game_root)
        if not content:
            return None
        try:
            cand = os.path.realpath(os.path.join(content, wid))
        except OSError:
            return None
        if os.path.isdir(cand):
            return cand
        return None
    p = _validate_testing_mod_path(raw)
    if not p:
        return None
    if "://" in p.lower():
        return None
    return p


def _normalize_testing_mod_row(obj: Any, assign_id: bool) -> dict[str, Any] | None:
    if not isinstance(obj, dict):
        return None
    raw_path = obj.get("path")
    if not isinstance(raw_path, str):
        return None
    norm = _validate_testing_mod_path(raw_path)
    if norm is None:
        return None
    mid = obj.get("id")
    if isinstance(mid, str) and mid.strip():
        mod_id = mid.strip()
    elif assign_id:
        mod_id = str(uuid.uuid4())
    else:
        return None
    en = obj.get("enabled")
    enabled = en is not False
    label = obj.get("label")
    label_out = label.strip() if isinstance(label, str) else ""
    return {"id": mod_id, "path": norm, "enabled": enabled, "label": label_out}


def _write_testing_modlist_store(mods: list[dict[str, Any]]) -> None:
    path = _testing_modlist_path()
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    _write_json_atomic(path, {"mods": mods})


def _managed_scenario_mods_from_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    raw = row.get("launch_mods")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        norm = _normalize_testing_mod_row(item, assign_id=True)
        if norm is not None:
            out.append(norm)
    return out


def _arma3_executable_path(game_root: str) -> tuple[str | None, str | None]:
    """
    Return ``(path_to_exe, error)`` for ``game_root`` (Arma 3 install directory).
    Windows: ``arma3_x64.exe``; Linux: common ``arma3_x64`` / ``arma3`` names; macOS: bundle binary.
    """
    root = (game_root or "").strip()
    if not root:
        return None, "arma3_path is empty."
    try:
        root = os.path.realpath(os.path.expandvars(os.path.normpath(root)))
    except OSError as e:
        return None, f"Invalid arma3_path: {e}"
    if not os.path.isdir(root):
        return None, "arma3_path is not an existing directory."
    if os.name == "nt":
        exe = os.path.join(root, "arma3_x64.exe")
        if os.path.isfile(exe):
            return exe, None
        return None, f"arma3_x64.exe not found under {root!r}."
    mac = os.path.join(root, "Arma3.app", "Contents", "MacOS", "Arma3")
    if os.path.isfile(mac) and os.access(mac, os.X_OK):
        return mac, None
    for name in ("arma3_x64", "Arma3_x64", "arma3"):
        cand = os.path.join(root, name)
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand, None
    return None, f"No Arma 3 executable found under {root!r}."


def _arma_profile_name_from_path(profile_path: str) -> str | None:
    p = os.path.expandvars((profile_path or "").strip()).rstrip("/\\")
    if not p:
        return None
    return os.path.basename(p) or None


def _testing_extra_args_from_body(body: dict[str, Any]) -> tuple[list[str], str | None]:
    """Parse ``extra_args`` as JSON array of strings or one shell-style string."""
    raw = body.get("extra_args")
    if raw is None:
        return [], None
    if isinstance(raw, list):
        out: list[str] = []
        for x in raw:
            if not isinstance(x, str):
                return [], "extra_args list entries must be strings."
            t = x.strip()
            if not t:
                continue
            if "\x00" in t:
                return [], "extra_args contains invalid characters."
            out.append(t)
        return out, None
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return [], None
        if "\x00" in s:
            return [], "extra_args contains invalid characters."
        try:
            parts = shlex.split(s, posix=True)
        except ValueError as e:
            return [], f"Could not parse extra_args: {e}"
        return parts, None
    return [], "extra_args must be a string or JSON array of strings."


def _merge_autotest_file_payload(
    managed_id: str,
    mission_folder: str,
    client_spec: dict[str, Any],
) -> dict[str, Any]:
    """
    Build the JSON object written for ``-autotest=<path>``.
    ``client_spec`` is optional UI fields; server always adds mission context.
    """
    out: dict[str, Any] = {
        "launchpad_autotest": 1,
        "managed_scenario_id": managed_id,
        "mission_folder_name": mission_folder,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    label = client_spec.get("label")
    if label is not None:
        if not isinstance(label, str):
            raise ValueError("autotest_spec.label must be a string.")
        label = label.strip()
        if label:
            if len(label) > 240 or "\n" in label or "\r" in label:
                raise ValueError("autotest_spec.label is too long or has invalid characters.")
            out["label"] = label
    it = client_spec.get("iterations")
    if it is not None:
        if not isinstance(it, int) or isinstance(it, bool):
            raise ValueError("autotest_spec.iterations must be an integer.")
        if it < 1 or it > 10_000:
            raise ValueError("autotest_spec.iterations must be between 1 and 10000.")
        out["iterations"] = it
    md = client_spec.get("max_duration_sec")
    if md is not None:
        if not isinstance(md, int) or isinstance(md, bool):
            raise ValueError("autotest_spec.max_duration_sec must be an integer.")
        if md < 1 or md > 864_000:
            raise ValueError("autotest_spec.max_duration_sec must be between 1 and 864000.")
        out["max_duration_sec"] = md
    tags = client_spec.get("tags")
    if tags is not None:
        if not isinstance(tags, list):
            raise ValueError("autotest_spec.tags must be an array of strings.")
        clean: list[str] = []
        for t in tags[:32]:
            if not isinstance(t, str):
                raise ValueError("autotest_spec.tags entries must be strings.")
            s = t.strip()
            if s and len(s) <= 64 and "\n" not in s and "\r" not in s:
                clean.append(s)
        if clean:
            out["tags"] = clean
    return out


def _write_autotest_config_file(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    """Write ``payload`` as UTF-8 JSON under ``launchpad_data/testing_autotest_temp``. Returns absolute path."""
    base = os.path.join(_launchpad_data_dir(), "testing_autotest_temp")
    try:
        os.makedirs(base, exist_ok=True)
    except OSError as e:
        return None, f"Could not create autotest temp directory: {e}"
    path = os.path.join(base, f"autotest_{uuid.uuid4().hex}.json")
    try:
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
    except OSError as e:
        return None, f"Could not write autotest config file: {e}"
    return os.path.abspath(path), None


def _arma_process_name_match(proc_name: str) -> bool:
    n = (proc_name or "").lower()
    if "arma3" in n:
        return True
    if n in ("arma3server_x64.exe", "arma3server.exe"):
        return True
    return False


def snapshot_arma_processes() -> dict[str, Any]:
    """
    Collect metrics for running Arma-related processes (client / server).
    Uses one shared interval for CPU% so enumeration stays fast.
    """
    candidates: list[psutil.Process] = []
    for proc in psutil.process_iter():
        try:
            name = proc.name()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if _arma_process_name_match(name or ""):
            candidates.append(proc)

    for proc in candidates:
        try:
            proc.cpu_percent(interval=None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    if candidates:
        time.sleep(0.12)

    processes_data: list[dict[str, Any]] = []
    for proc in candidates:
        try:
            name = proc.name()
            info = proc.as_dict(
                attrs=["pid", "exe", "cmdline", "username", "create_time", "memory_info"]
            )
            cpu_percent = float(proc.cpu_percent(interval=None) or 0.0)
            mem = info.get("memory_info")
            rss = int(mem.rss) if mem is not None else 0
            vms = int(mem.vms) if mem is not None else 0
            try:
                mem_pct = float(proc.memory_percent())
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                mem_pct = 0.0

            num_handles: int | None = None
            if os.name == "nt":
                try:
                    num_handles = int(proc.num_handles())
                except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                    num_handles = None

            cmdline = info.get("cmdline")
            safe_cmd: list[str] | None = None
            if isinstance(cmdline, (list, tuple)):
                safe_cmd = []
                for part in cmdline[:120]:
                    if isinstance(part, str):
                        safe_cmd.append(part)
                    elif part is None:
                        safe_cmd.append("")
                    else:
                        safe_cmd.append(str(part))

            child_pids: list[int] = []
            try:
                for ch in proc.children(recursive=False):
                    try:
                        child_pids.append(int(ch.pid))
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

            row: dict[str, Any] = {
                "pid": int(proc.pid),
                "name": name or "",
                "exe": info.get("exe"),
                "cmdline": safe_cmd,
                "username": info.get("username"),
                "create_time": info.get("create_time"),
                "cpu_percent": round(cpu_percent, 2),
                "memory_rss": rss,
                "memory_vms": vms,
                "memory_percent": round(mem_pct, 3),
                "num_threads": int(proc.num_threads()),
                "num_handles": num_handles,
                "io_read_bytes": None,
                "io_write_bytes": None,
                "children": child_pids,
            }
            try:
                io = proc.io_counters()
                row["io_read_bytes"] = int(io.read_bytes)
                row["io_write_bytes"] = int(io.write_bytes)
            except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                pass

            processes_data.append(row)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    processes_data.sort(key=lambda r: int(r.get("pid", 0)))
    return {
        "ok": True,
        "processes": processes_data,
        "sampled_at_ms": int(time.time() * 1000),
    }


def force_kill_matching_arma_process(pid: Any) -> dict[str, Any]:
    """
    Immediately terminate a process by PID only if its executable name matches the session radar filter.
    """
    try:
        pid_i = int(pid)
    except (TypeError, ValueError):
        return {"_http_status": 400, "error": "Invalid process id."}
    if pid_i <= 0:
        return {"_http_status": 400, "error": "Invalid process id."}
    try:
        proc = psutil.Process(pid_i)
    except psutil.NoSuchProcess:
        return {"_http_status": 404, "error": "That session is already closed."}
    except psutil.AccessDenied:
        return {"_http_status": 403, "error": "Not allowed to stop this session."}
    try:
        name = proc.name()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return {"_http_status": 404, "error": "That session is already closed."}
    if not _arma_process_name_match(name or ""):
        return {
            "_http_status": 400,
            "error": "Only sessions listed here can be stopped this way.",
        }
    try:
        proc.kill()
    except psutil.NoSuchProcess:
        return {"ok": True, "stopped": True, "gone": True}
    except psutil.AccessDenied:
        return {"_http_status": 403, "error": "Not allowed to stop this session."}
    return {"ok": True, "stopped": True}


def _settings_path() -> str:
    return os.path.join(_launchpad_data_dir(), _SETTINGS_FILE)


def _default_settings() -> dict[str, str]:
    out = {k: "" for k in _SETTINGS_KEYS}
    out["github_new_repo_visibility"] = "private"
    if os.name == "nt":
        out["arma3_appdata_path"] = r"%LOCALAPPDATA%\Arma 3"
    return out


def _read_settings() -> dict[str, str]:
    """Load ``settings.json`` from the launchpad data directory with defaults for missing keys."""
    out = _default_settings()
    path = _settings_path()
    if not os.path.isfile(path):
        return out
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return out
    if not isinstance(raw, dict):
        return out
    for key in _SETTINGS_KEYS:
        val = raw.get(key)
        if isinstance(val, str):
            out[key] = val.strip()
    gv = (out.get("github_new_repo_visibility") or "").strip().lower()
    if gv not in ("public", "private"):
        gv = "private"
    out["github_new_repo_visibility"] = gv
    return out


def _arma3_appdata_path_from_settings() -> tuple[str | None, str | None]:
    """Resolve Arma 3 appdata folder from settings."""
    settings = _read_settings()
    raw = (settings.get("arma3_appdata_path") or "").strip()
    if not raw:
        return None, "Arma 3 appdata path is not set in Settings."
    path = os.path.realpath(os.path.normpath(os.path.expandvars(raw)))
    if not os.path.isdir(path):
        return None, f"Arma 3 appdata folder not found: {path}"
    return path, None


def _arma3_tools_logs_path_from_settings() -> tuple[str | None, str | None]:
    """Resolve ``{Arma 3 Tools}/Logs`` from settings."""
    settings = _read_settings()
    raw = (settings.get("arma3_tools_path") or "").strip()
    if not raw:
        return None, "Arma 3 Tools folder is not set in Settings."
    root = os.path.realpath(os.path.normpath(os.path.expandvars(raw)))
    if not os.path.isdir(root):
        return None, f"Arma 3 Tools folder not found: {root}"
    logs = os.path.join(root, "Logs")
    try:
        logs = os.path.realpath(logs)
    except OSError as e:
        return None, f"Could not resolve Arma 3 Tools Logs path: {e}"
    if not os.path.isdir(logs):
        return None, f"Arma 3 Tools Logs folder not found: {logs}"
    return logs, None


def _rpt_tail_path_allowed(target: str) -> bool:
    """True if ``target`` is under the configured profile log folder or Arma 3 Tools ``Logs`` folder."""
    appdata, _ = _arma3_appdata_path_from_settings()
    if appdata:
        try:
            if os.path.commonpath([appdata, target]) == appdata:
                return True
        except ValueError:
            pass
    tools_logs, _ = _arma3_tools_logs_path_from_settings()
    if tools_logs:
        try:
            if os.path.commonpath([tools_logs, target]) == tools_logs:
                return True
        except ValueError:
            pass
    return False


def _apply_settings_patch(current: dict[str, str], body: dict[str, Any]) -> tuple[dict[str, str] | None, str | None]:
    """
    Merge allowed keys from ``body`` into ``current``.
    Returns ``(new_settings, None)`` or ``(None, error_message)``.
    """
    merged = dict(current)
    for key, val in body.items():
        if key not in _SETTINGS_KEYS:
            continue
        if val is None:
            merged[key] = ""
        elif isinstance(val, str):
            merged[key] = val.strip()
            if key == "github_new_repo_visibility":
                lv = merged[key].lower()
                if lv not in ("public", "private", ""):
                    return None, "github_new_repo_visibility must be 'public' or 'private'."
                if not lv:
                    merged[key] = "private"
        else:
            return None, f"Invalid type for {key!r}: expected a string."
    gv = (merged.get("github_new_repo_visibility") or "").strip().lower()
    if gv not in ("public", "private"):
        merged["github_new_repo_visibility"] = "private"
    else:
        merged["github_new_repo_visibility"] = gv
    return merged, None


def _parse_autotest_block_fields(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        k = key.strip()
        v = value.strip()
        if k:
            out[k] = v
    return out


def _build_mission_description_params(
    author: str,
    display_name: str,
    game_type_raw: Any,
) -> dict[str, Any]:
    """Build ``Description.ext`` parameter dict from templates and user input."""
    params = copy.deepcopy(Constants.EXT_TEMPLATE)
    params["author"] = author
    params["onLoadName"] = display_name
    params["briefingName"] = display_name
    params["loadScreen"] = display_name
    gt = str(game_type_raw or "Unknown").strip()
    if isinstance(params.get("header"), dict) and gt and gt != "Unknown":
        params["header"] = {**params["header"], "gameType": gt}
    return params


def _read_managed_missions_raw() -> dict[str, Any]:
    path = _managed_missions_path()
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def _mission_projects_root() -> str:
    return os.path.realpath(os.path.join(_launchpad_data_dir(), "mission_projects"))


def _is_strict_child_of_mission_projects(abs_project_dir: str) -> bool:
    """True if ``abs_project_dir`` is a mission folder inside ``launchpad_data/mission_projects``."""
    try:
        root = os.path.realpath(_mission_projects_root())
        d = os.path.realpath(abs_project_dir)
    except OSError:
        return False
    if not os.path.isdir(d):
        return False
    if d == root:
        return False
    try:
        return os.path.commonpath([d, root]) == root
    except ValueError:
        return False


def _validate_mission_token(part: str, label: str) -> str | None:
    s = part.strip()
    if not s:
        return f"{label} cannot be empty."
    if any(c in s for c in ("/", "\\", "\x00")):
        return f"{label} cannot contain path separators."
    if s in (".", ".."):
        return f"{label} is not a valid folder name."
    return None


def _write_json_atomic(path: str, obj: Any) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".managed_missions_", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=4)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _ipc_allowed_roots() -> list[str]:
    """Absolute real paths under which local IPC may read/write files or open folders."""
    roots: list[str] = []
    try:
        roots.append(os.path.realpath(_launchpad_data_dir()))
    except OSError:
        pass
    for row in _read_managed_missions_raw().values():
        if not isinstance(row, dict):
            continue
        pp = row.get("project_path")
        if isinstance(pp, str) and pp.strip():
            try:
                roots.append(os.path.realpath(os.path.normpath(pp.strip())))
            except OSError:
                continue
    dedup: list[str] = []
    for r in roots:
        if r and r not in dedup:
            dedup.append(r)
    return dedup


def _is_descendant(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:
        return False


def _path_under_allowed_root(path: str) -> str | None:
    """Return ``realpath(path)`` if it lies under an allowed root; else ``None``."""
    if not path or "\x00" in path:
        return None
    try:
        real = os.path.realpath(os.path.normpath(path))
    except OSError:
        return None
    for root in _ipc_allowed_roots():
        try:
            rr = os.path.realpath(root)
        except OSError:
            continue
        if real == rr or _is_descendant(real, rr):
            return real
    return None


def _ipc_write_target_path(path: str) -> str | None:
    """Absolute normalized file path we may create, if its parent directory is under an allowed root."""
    if not path or "\x00" in path:
        return None
    full = os.path.abspath(os.path.normpath(path))
    parent = os.path.dirname(full)
    if not parent:
        return None
    parent_resolved = _path_under_allowed_root(parent)
    if parent_resolved is None:
        return None
    return full


def _json_str_field(body: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = body.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _project_path_resolves_same(project_resolved: str, project_path_raw: str) -> bool:
    """True when ``project_path_raw`` resolves to the same directory as ``project_resolved``."""
    cand = _path_under_allowed_root(project_path_raw.strip())
    if cand is None:
        return False
    try:
        a = os.path.normcase(os.path.realpath(project_resolved))
        b = os.path.normcase(os.path.realpath(cand))
    except OSError:
        a = os.path.normcase(os.path.normpath(project_resolved))
        b = os.path.normcase(os.path.normpath(cand))
    return a == b


def _mission_pbo_base_filename(project_resolved: str, body: dict[str, Any]) -> tuple[str | None, str | None]:
    """
    PBO filename is always ``{mission_name}.{map_suffix}.pbo`` when name/suffix are known
    (from the request body or a matching managed-mission row); otherwise the mission folder name.
    """
    name = _json_str_field(body, "mission_name", "missionName")
    map_suf = _json_str_field(body, "map_suffix", "mapSuffix")

    def pack(n: str, m: str) -> tuple[str | None, str | None]:
        err = _validate_mission_token(n, "Mission name")
        if err:
            return None, err
        err = _validate_mission_token(m, "Map suffix")
        if err:
            return None, err
        return f"{n}.{m}.pbo", None

    if name and map_suf:
        return pack(name, map_suf)
    if name is not None or map_suf is not None:
        return None, "Provide both mission_name and map_suffix for the PBO file name."

    for _mid, row in _read_managed_missions_raw().items():
        if not isinstance(row, dict):
            continue
        pp = row.get("project_path")
        if not isinstance(pp, str) or not pp.strip():
            continue
        if not _project_path_resolves_same(project_resolved, pp):
            continue
        n = str(row.get("name", "")).strip()
        m = str(row.get("map_suffix", "")).strip()
        if n and m:
            return pack(n, m)
        break

    return os.path.basename(project_resolved.rstrip(os.sep)) + ".pbo", None


def _mission_pbo_output_parent_allowed(pbo_full: str, project_resolved: str) -> str | None:
    """
    Return ``None`` if the parent directory of ``pbo_full`` may receive the PBO.

    Allowed: parent under :func:`_path_under_allowed_root`, or same parent directory as
    the mission folder (typical "PBO next to the mission folder" layout).
    """
    try:
        parent = os.path.realpath(os.path.dirname(os.path.abspath(os.path.normpath(pbo_full))))
        proj_parent = os.path.realpath(os.path.dirname(project_resolved))
    except OSError as e:
        return f"Invalid output path: {e}"
    if _path_under_allowed_root(parent) is not None:
        return None
    if parent == proj_parent:
        return None
    return (
        "Output folder is not allowed. Choose the mission folder, launchpad data, "
        "the folder that contains the mission, or another path under an allowed root."
    )


def _normalize_mission_pbo_output_path(
    project_resolved: str, output_path: str | None, pbo_filename: str
) -> tuple[str | None, str | None]:
    """``(absolute .pbo path, error)``. ``pbo_filename`` must be a plain ``*.pbo`` name (no directories)."""
    if "\\" in pbo_filename or "/" in pbo_filename:
        return None, "Invalid PBO file name."
    if not pbo_filename.lower().endswith(".pbo"):
        return None, "Invalid PBO file name."
    if os.path.basename(pbo_filename) != pbo_filename:
        return None, "Invalid PBO file name."
    base_name = pbo_filename
    if output_path:
        raw = output_path.strip()
        out = os.path.abspath(os.path.normpath(raw))
        if out.lower().endswith(".pbo"):
            full = os.path.join(os.path.dirname(out), base_name)
        else:
            full = os.path.join(out, base_name)
    else:
        full = os.path.join(os.path.dirname(project_resolved), base_name)
    err = _mission_pbo_output_parent_allowed(full, project_resolved)
    if err is not None:
        return None, err
    return full, None


def _pbo_output_overwrite_gate(pbo_full: str, body: dict[str, Any]) -> dict[str, Any] | None:
    """
    If the target ``.pbo`` already exists and the client did not pass ``overwrite: true``,
    return a 409 response dict. When overwrite is requested, remove the existing file or
    return an error if removal fails (Windows cannot rename the temp PBO onto an existing path).
    """
    overwrite = body.get("overwrite") is True
    try:
        exists = os.path.isfile(pbo_full)
    except OSError as e:
        return {"_http_status": 500, "error": f"Could not access output path: {e}"}
    if not exists:
        return None
    if not overwrite:
        return {
            "_http_status": 409,
            "error": "A PBO file already exists at the output path.",
            "code": "pbo_exists",
            "pboPath": pbo_full,
        }
    try:
        os.unlink(pbo_full)
    except OSError as e:
        return {"_http_status": 500, "error": f"Could not remove existing PBO: {e}"}
    return None


def _path_allowed_for_reveal(target_path: str, project_resolved: str | None) -> bool:
    """Whether ``target_path`` may be opened in the system file manager."""
    try:
        real = os.path.realpath(os.path.normpath(target_path))
    except OSError:
        return False
    if _path_under_allowed_root(real) is not None:
        return True
    if project_resolved:
        try:
            pr = os.path.realpath(os.path.normpath(project_resolved))
            if os.path.realpath(os.path.dirname(real)) == os.path.realpath(os.path.dirname(pr)):
                return True
        except OSError:
            pass
    return False


def _reveal_path_in_file_manager(path: str) -> None:
    path = os.path.normpath(path)
    if os.name == "nt":
        quoted = path.replace('"', '\\"')
        subprocess.run(f'explorer /select,"{quoted}"', shell=True, check=False)
    else:
        folder = os.path.dirname(path) or "."
        subprocess.run(["xdg-open", folder], check=False)


def _query_param(handler: BaseHTTPRequestHandler, name: str) -> str | None:
    qs = urlparse(handler.path).query
    vals = parse_qs(qs, keep_blank_values=True).get(name, [])
    return vals[0] if vals else None


def _read_json_body(handler: BaseHTTPRequestHandler, max_bytes: int = 1_048_576) -> Any:
    length_hdr = handler.headers.get("Content-Length")
    if not length_hdr:
        return None
    try:
        n = int(length_hdr)
    except ValueError:
        return None
    if n < 0 or n > max_bytes:
        return None
    raw = handler.rfile.read(n)
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


class A3LaunchpadAPI:
    """
    HTTP JSON handlers are registered with :meth:`route` and invoked by the server via :meth:`dispatch`.

    Handlers are ``(api, handler) -> JSON-serializable`` - the second argument is the
    :class:`http.server.BaseHTTPRequestHandler` instance (path, headers, ``rfile``, etc.).
    """

    _routes: ClassVar[dict[tuple[str, str], Callable[..., Any]]] = {}

    def __init__(self) -> None:
        self._autotest_watch_lock = threading.Lock()
        self._autotest_watch: dict[str, Any] | None = None

    @classmethod
    def route(cls, path: str, methods: Iterable[str] = ("GET",)) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """
        Register a handler for a URL under ``/api/``.

        ``path`` may be ``"/api/mission/build"``, ``"api/mission/build"``, or ``"mission/build"``.

        For methods defined on this class, apply the decorator *after* the class is created
        (``@A3LaunchpadAPI.route`` cannot run inside the class body because the name is not
        defined yet). Example: ``A3LaunchpadAPI.route(...)(A3LaunchpadAPI.my_method)``.
        """

        normalized = _normalize_route_path(path)
        method_set = tuple(m.upper() for m in methods)

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            for method in method_set:
                cls._routes[(method, normalized)] = fn
            return fn

        return decorator

    @classmethod
    def dispatch(
        cls,
        api: A3LaunchpadAPI,
        method: str,
        handler: BaseHTTPRequestHandler,
    ) -> Any | None:
        subpath = _api_subpath_from_handler_path(handler.path)
        if subpath is None:
            return None
        key = (method.upper(), subpath)
        for klass in reversed(type(api).__mro__):
            routes = klass.__dict__.get("_routes")
            if not routes:
                continue
            fn = routes.get(key)
            if fn is not None:
                return fn(api, handler)
        git_parts = _parse_managed_scenario_git_subpath(subpath)
        if git_parts is not None:
            mission_id, git_action = git_parts
            if git_action == "commit":
                if method.upper() == "POST":
                    return api.handle_managed_scenario_git_commit(mission_id, handler)
                return {"_http_status": 405, "error": "Use POST for git/commit."}
            if git_action == "init":
                if method.upper() == "POST":
                    return api.handle_managed_scenario_git_init(mission_id, handler)
                return {"_http_status": 405, "error": "Use POST for git/init."}
            if git_action == "publish":
                if method.upper() == "POST":
                    return api.handle_managed_scenario_git_publish(mission_id, handler)
                return {"_http_status": 405, "error": "Use POST for git/publish."}
            if method.upper() == "GET":
                if git_action == "status":
                    return api.handle_managed_scenario_git_status(mission_id, handler)
                if git_action == "log":
                    return api.handle_managed_scenario_git_log(mission_id, handler)
            return {"_http_status": 405, "error": "Method not allowed."}
        ms_parts = _parse_managed_scenario_action_subpath(subpath)
        if ms_parts is not None:
            mission_id, action = ms_parts
            if action == "mods":
                if method.upper() == "GET":
                    return api.handle_managed_scenario_mods_get(mission_id, handler)
                if method.upper() == "POST":
                    return api.handle_managed_scenario_mods_post(mission_id, handler)
                return {"_http_status": 405, "error": "Method not allowed."}
            if action == "launch":
                if method.upper() == "POST":
                    return api.handle_managed_scenario_launch_post(mission_id, handler)
                return {"_http_status": 405, "error": "Use POST for launch."}
        if method.upper() == "PATCH" and subpath.startswith("managed/scenarios/"):
            mission_id = subpath[len("managed/scenarios/") :].strip("/")
            if mission_id and "/" not in mission_id:
                return api.handle_managed_scenario_patch(mission_id, handler)
        if method.upper() == "DELETE" and subpath.startswith("managed/scenarios/"):
            mission_id = subpath[len("managed/scenarios/") :].strip("/")
            if mission_id and "/" not in mission_id:
                return api.handle_managed_scenario_delete(mission_id, handler)
        return None

    def _create_autotest_watch(self, mission_id: str, mission_folder: str, pid: int) -> str:
        watch_id = uuid.uuid4().hex
        started_ts = time.time()
        appdata, appdata_err = _arma3_appdata_path_from_settings()
        initial_offsets: dict[str, int] = {}
        if appdata and not appdata_err:
            try:
                for name in os.listdir(appdata):
                    if not name.lower().endswith(".rpt"):
                        continue
                    full = os.path.join(appdata, name)
                    if not os.path.isfile(full):
                        continue
                    initial_offsets[full] = int(os.path.getsize(full))
            except OSError:
                initial_offsets = {}
        state = {
            "watch_id": watch_id,
            "started_ts": started_ts,
            "mission_id": mission_id,
            "mission_folder": mission_folder,
            "pid": int(pid),
            "appdata": appdata,
            "offsets": initial_offsets,
            "carry": {},
            "result": None,
            "poll_count": 0,
        }
        with self._autotest_watch_lock:
            self._autotest_watch = state
        return watch_id

    def _poll_autotest_watch(self, watch: dict[str, Any]) -> dict[str, Any]:
        appdata = watch.get("appdata")
        if not isinstance(appdata, str) or not appdata.strip() or not os.path.isdir(appdata):
            return {"ok": False, "error": "Arma 3 appdata path is not configured or no longer exists."}

        files: list[dict[str, Any]] = []
        try:
            for name in os.listdir(appdata):
                if not name.lower().endswith(".rpt"):
                    continue
                full = os.path.join(appdata, name)
                if not os.path.isfile(full):
                    continue
                files.append({"path": full, "modified_ts": os.path.getmtime(full), "size": os.path.getsize(full)})
        except OSError as e:
            return {"ok": False, "error": f"Could not inspect RPT files: {e}"}
        files.sort(key=lambda row: float(row.get("modified_ts", 0.0)), reverse=True)

        offsets = watch.setdefault("offsets", {})
        carry_map = watch.setdefault("carry", {})

        for row in files[:_AUTOTEST_SCAN_MAX_FILES]:
            path = str(row.get("path", ""))
            file_size = int(row.get("size", 0))
            prev_offset = int(offsets.get(path, 0))
            if path not in offsets:
                prev_offset = max(0, file_size - _AUTOTEST_SCAN_MAX_BYTES_PER_FILE)
            read_start = max(0, min(prev_offset, file_size))
            if file_size - read_start > _AUTOTEST_SCAN_MAX_BYTES_PER_FILE:
                read_start = file_size - _AUTOTEST_SCAN_MAX_BYTES_PER_FILE
            if file_size <= read_start:
                offsets[path] = file_size
                continue
            try:
                with open(path, "rb") as fh:
                    fh.seek(read_start)
                    raw = fh.read(file_size - read_start)
            except OSError:
                offsets[path] = file_size
                continue

            text = raw.decode("utf-8", errors="replace")
            prev_carry = str(carry_map.get(path, ""))
            chunk = prev_carry + text
            matches = list(_AUTOTEST_BLOCK_RE.finditer(chunk))
            if matches:
                m = matches[-1]
                body = m.group("body") or ""
                fields = _parse_autotest_block_fields(body)
                result = {
                    "result": (m.group("result") or "").strip(),
                    "fields": fields,
                    "end_mode": fields.get("EndMode") or fields.get("endmode") or "",
                    "mission": fields.get("Mission") or fields.get("mission") or "",
                    "detected_ts": time.time(),
                    "rpt_path": path,
                    "raw_block": m.group(0),
                }
                watch["result"] = result
                offsets[path] = file_size
                carry_map[path] = chunk[-_AUTOTEST_CARRY_MAX:]
                return {"ok": True, "found": True, "result": result}

            offsets[path] = file_size
            carry_map[path] = chunk[-_AUTOTEST_CARRY_MAX:]

        watch["poll_count"] = int(watch.get("poll_count", 0)) + 1
        return {"ok": True, "found": False}

    def handle_managed_scenarios_request(self, handler: BaseHTTPRequestHandler):
        """Return all managed missions as a JSON array with ``id`` on each row."""
        managed = _read_managed_missions_raw()
        return [{"id": mid, **row} for mid, row in managed.items() if isinstance(row, dict)]

    def handle_managed_scenario_patch(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}

        has_name = "name" in body
        has_map = "map_suffix" in body
        has_ext = "ext_params" in body
        has_github_integration = "github_integration" in body
        if not (has_name or has_map or has_ext or has_github_integration):
            return {
                "_http_status": 400,
                "error": "Provide at least one of: name, map_suffix, ext_params, github_integration.",
            }

        all_missions = _read_managed_missions_raw()
        if mission_id not in all_missions or not isinstance(all_missions[mission_id], dict):
            return {"_http_status": 404, "error": "Mission not found."}

        row: dict[str, Any] = dict(all_missions[mission_id])
        old_name = str(row.get("name", "")).strip()
        old_map = str(row.get("map_suffix", "")).strip()
        if has_name:
            if not isinstance(body.get("name"), str):
                return {"_http_status": 400, "error": "Field name must be a string."}
            new_name = str(body["name"]).strip()
        else:
            new_name = old_name
        if has_map:
            if not isinstance(body.get("map_suffix"), str):
                return {"_http_status": 400, "error": "Field map_suffix must be a string."}
            new_map = str(body["map_suffix"]).strip()
        else:
            new_map = old_map

        err = _validate_mission_token(new_name, "Mission name")
        if err:
            return {"_http_status": 400, "error": err}
        err = _validate_mission_token(new_map, "Map suffix")
        if err:
            return {"_http_status": 400, "error": err}

        old_full = f"{old_name}.{old_map}"
        new_full = f"{new_name}.{new_map}"
        symlink_note: str | None = None

        project_path = row.get("project_path")
        profile_path = row.get("profile_path")
        if old_full != new_full and isinstance(project_path, str) and isinstance(profile_path, str):
            pp = project_path.strip()
            prof = profile_path.strip()
            if pp and prof:
                mt = row.get("mission_type", "mp")
                new_link = profile_mission_symlink_path(prof, mt, new_full)
                old_link: str | None = None
                for cand in iter_profile_mission_symlink_candidates(prof, mt, old_full):
                    if os.path.lexists(cand) and os.path.islink(cand):
                        try:
                            if os.path.samefile(cand, pp):
                                old_link = cand
                                break
                        except OSError:
                            continue
                if os.path.lexists(new_link):
                    try:
                        if not (os.path.islink(new_link) and os.path.samefile(new_link, pp)):
                            return {
                                "_http_status": 409,
                                "error": f"A mission or file already exists at {new_link!r}.",
                            }
                    except OSError:
                        return {
                            "_http_status": 409,
                            "error": f"A mission or file already exists at {new_link!r}.",
                        }
                if old_link is not None:
                    try:
                        if os.path.samefile(old_link, pp):
                            os.remove(old_link)
                            if not os.path.lexists(new_link):
                                try:
                                    os.makedirs(os.path.dirname(new_link), exist_ok=True)
                                except OSError as e:
                                    return {
                                        "_http_status": 500,
                                        "error": f"Could not create symlink parent folder: {e}",
                                    }
                                os.symlink(pp, new_link, target_is_directory=True)
                            symlink_note = "Symlink updated to the new mission folder name."
                        else:
                            symlink_note = (
                                "Symlink at the old path does not point to this mission's project_path; "
                                "left unchanged. JSON was still updated."
                            )
                    except OSError as e:
                        return {"_http_status": 500, "error": f"Could not rename symlink: {e}"}
                elif old_full != new_full:
                    symlink_note = (
                        "Symlink was not updated (missing or unrecognized link at the old path). "
                        "JSON was still updated."
                    )
            elif old_full != new_full:
                symlink_note = (
                    "Symlink step skipped: add non-empty project_path and profile_path to this mission "
                    "to enable symlink rename."
                )
        elif old_full != new_full:
            symlink_note = (
                "Symlink step skipped: add project_path and profile_path to this mission "
                "to enable symlink rename."
            )

        if has_ext:
            row["ext_params"] = body["ext_params"]

        if has_github_integration:
            gi = body.get("github_integration")
            if gi is not True and gi is not False:
                return {"_http_status": 400, "error": "Field github_integration must be a boolean."}
            row["github_integration"] = bool(gi)

        row["name"] = new_name
        row["map_suffix"] = new_map
        all_missions[mission_id] = row
        try:
            _write_json_atomic(_managed_missions_path(), all_missions)
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not save managed missions: {e}"}

        out: dict[str, Any] = {"ok": True, "mission": {"id": mission_id, **row}}
        if symlink_note is not None:
            out["symlink_message"] = symlink_note
        return out

    def handle_managed_scenario_git_status(self, mission_id: str, _handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        repo, err = _managed_mission_github_repo_or_error(mission_id)
        if err is not None:
            return err
        assert repo is not None
        data = git_repo_status(repo)
        row = _read_managed_missions_raw().get(mission_id)
        s = _read_settings()
        vis = (s.get("github_new_repo_visibility") or "private").strip().lower()
        if vis not in ("public", "private"):
            vis = "private"
        if isinstance(data, dict):
            if isinstance(row, dict):
                data["suggestedRepoName"] = suggest_github_repo_slug(
                    str(row.get("name", "")),
                    str(row.get("map_suffix", "")),
                )
            data["defaultPublishVisibility"] = vis
        return data

    def handle_managed_scenario_git_log(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        repo, err = _managed_mission_github_repo_or_error(mission_id)
        if err is not None:
            return err
        assert repo is not None
        raw_lim = _query_param(handler, "limit")
        try:
            limit = int(raw_lim) if raw_lim else 25
        except ValueError:
            limit = 25
        return git_recent_log(repo, limit)

    def handle_managed_scenario_git_commit(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        msg = body.get("message") or body.get("commit_message")
        if not isinstance(msg, str):
            return {"_http_status": 400, "error": "Field message (string) is required."}
        repo, err = _managed_mission_github_repo_or_error(mission_id)
        if err is not None:
            return err
        assert repo is not None
        return git_commit_all(repo, msg)

    def handle_managed_scenario_git_init(self, mission_id: str, _handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        repo, err = _managed_mission_github_repo_or_error(mission_id)
        if err is not None:
            return err
        assert repo is not None
        return git_init_mission_repo(repo)

    def handle_managed_scenario_git_publish(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        repo_name = body.get("repo_name") if "repo_name" in body else body.get("repoName")
        if not isinstance(repo_name, str) or not repo_name.strip():
            return {"_http_status": 400, "error": "Field repo_name (non-empty string) is required."}
        visibility = body.get("visibility")
        if visibility is not None and not isinstance(visibility, str):
            return {"_http_status": 400, "error": "Field visibility must be a string (public or private)."}
        description = body.get("description")
        if description is not None and not isinstance(description, str):
            return {"_http_status": 400, "error": "Field description must be a string."}

        repo, err = _managed_mission_github_repo_or_error(mission_id)
        if err is not None:
            return err
        assert repo is not None

        row = _read_managed_missions_raw().get(mission_id)
        desc_str = (description if isinstance(description, str) else "").strip()
        if not desc_str and isinstance(row, dict):
            desc_str = str(row.get("description") or "").strip()

        vis_raw = (visibility if isinstance(visibility, str) else "").strip().lower()
        if vis_raw not in ("public", "private", ""):
            return {"_http_status": 400, "error": "visibility must be public or private."}
        if not vis_raw:
            s = _read_settings()
            vis_raw = (s.get("github_new_repo_visibility") or "private").strip().lower()
            if vis_raw not in ("public", "private"):
                vis_raw = "private"

        result = gh_publish_mission_repo(repo, repo_name.strip(), vis_raw, desc_str)
        if not result.get("ok"):
            return {"_http_status": 400, "error": str(result.get("error") or "Publish failed.")}
        return result

    def handle_managed_scenario_mods_get(self, mission_id: str, _handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        row, err = _managed_row_or_error(mission_id)
        if err is not None:
            return err
        assert row is not None
        return {"ok": True, "mods": _managed_scenario_mods_from_row(row)}

    def handle_managed_scenario_mods_post(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        raw_mods = body.get("mods")
        if not isinstance(raw_mods, list):
            return {"_http_status": 400, "error": "Field mods (array) is required."}

        cleaned: list[dict[str, Any]] = []
        for item in raw_mods:
            row = _normalize_testing_mod_row(item, assign_id=True)
            if row is None:
                return {"_http_status": 400, "error": "Each mod needs a valid path string."}
            cleaned.append(row)

        all_missions = _read_managed_missions_raw()
        current = all_missions.get(mission_id)
        if not isinstance(current, dict):
            return {"_http_status": 404, "error": "Mission not found."}
        updated = dict(current)
        updated["launch_mods"] = cleaned
        all_missions[mission_id] = updated
        try:
            _write_json_atomic(_managed_missions_path(), all_missions)
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not save mission mod list: {e}"}
        return {"ok": True, "mods": cleaned}

    def handle_managed_scenario_launch_post(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        row, err = _managed_row_or_error(mission_id)
        if err is not None:
            return err
        assert row is not None

        settings = _read_settings()
        game_root = (settings.get("arma3_path") or "").strip()
        exe, exe_err = _arma3_executable_path(game_root)
        if exe is None or exe_err:
            return {"_http_status": 400, "error": exe_err or "Could not resolve Arma 3 executable."}

        body = _read_json_body(handler)
        if body is None:
            body = {}
        if not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}

        mods = _managed_scenario_mods_from_row(row)
        if not mods:
            store_fb = _read_testing_modlist_store()
            raw_fb = store_fb.get("mods")
            if isinstance(raw_fb, list):
                mods = [x for x in raw_fb if isinstance(x, dict)]
        mod_paths: list[str] = []
        for m in mods:
            if not isinstance(m, dict) or m.get("enabled") is False:
                continue
            p = _resolve_mod_path_for_launch(str(m.get("path", "")), game_root)
            if p:
                mod_paths.append(p)
        mod_arg: str | None = None
        if mod_paths:
            sep = ";" if os.name == "nt" else ":"
            mod_arg = sep.join(mod_paths)

        extra_parts, xerr = _testing_extra_args_from_body(body)
        if xerr:
            return {"_http_status": 400, "error": xerr}

        argv: list[str] = [exe, "-nosplash"]
        prof_path = row.get("profile_path")
        if isinstance(prof_path, str) and prof_path.strip():
            pname = _arma_profile_name_from_path(prof_path)
            if pname:
                argv.append(f"-name={pname}")
        if mod_arg:
            argv.append(f"-mod={mod_arg}")
        argv.extend(extra_parts)

        cwd = os.path.dirname(exe) if os.path.isfile(exe) else game_root
        logger.info("Managed mission launch (%s): %s", mission_id, argv)
        try:
            if os.name == "nt":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                proc = subprocess.Popen(
                    argv,
                    cwd=cwd,
                    shell=False,
                    close_fds=False,
                    creationflags=flags,
                )
            else:
                proc = subprocess.Popen(argv, cwd=cwd, shell=False, close_fds=True)
        except OSError as e:
            logger.exception("Managed mission launch failed to spawn process")
            return {"_http_status": 500, "error": f"Could not start Arma 3: {e}"}

        mission_folder = f"{str(row.get('name', '')).strip()}.{str(row.get('map_suffix', '')).strip()}"
        return {
            "ok": True,
            "pid": proc.pid,
            "argv": argv,
            "missionFolderName": mission_folder,
            "modsApplied": len(mod_paths),
            "message": (
                "Started Arma 3 with this mission's saved mod profile."
                if mod_paths
                else "Started Arma 3 (no saved mods enabled for this mission)."
            ),
        }

    def handle_mission_project_tree_get(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """JSON tree of files under a mission project (names, relative paths, sizes; no file bodies)."""
        raw = _query_param(handler, "path")
        if not raw:
            return {"_http_status": 400, "error": "Missing query parameter: path"}
        resolved = _path_under_allowed_root(raw.strip())
        if resolved is None or not os.path.isdir(resolved):
            return {"_http_status": 404, "error": "Project folder not found or not allowed."}

        max_nodes = 6000
        count = [0]
        truncated = [False]

        def walk(abs_p: str, rel_posix: str) -> dict[str, Any]:
            name = os.path.basename(abs_p)
            if os.path.isfile(abs_p):
                if count[0] >= max_nodes:
                    truncated[0] = True
                    return {"name": name, "kind": "file", "relPath": rel_posix, "size": None, "truncated": True}
                count[0] += 1
                try:
                    sz = os.path.getsize(abs_p)
                except OSError:
                    sz = None
                return {"name": name, "kind": "file", "relPath": rel_posix, "size": sz}
            if count[0] >= max_nodes:
                truncated[0] = True
                return {"name": name, "kind": "dir", "relPath": rel_posix, "children": [], "truncated": True}
            count[0] += 1
            children: list[dict[str, Any]] = []
            try:
                entries = sorted(os.listdir(abs_p), key=str.lower)
            except OSError:
                return {"name": name, "kind": "dir", "relPath": rel_posix, "children": []}
            for entry in entries:
                if count[0] >= max_nodes:
                    truncated[0] = True
                    break
                child_abs = os.path.join(abs_p, entry)
                child_rel = f"{rel_posix}/{entry}" if rel_posix else entry
                child_rel = child_rel.replace("\\", "/")
                children.append(walk(child_abs, child_rel))
            return {"name": name, "kind": "dir", "relPath": rel_posix, "children": children}

        root_abs = os.path.realpath(resolved)
        root_name = os.path.basename(root_abs) or root_abs
        tree = walk(root_abs, "")
        out: dict[str, Any] = {"tree": tree, "rootName": root_name}
        if truncated[0]:
            out["truncated"] = True
        return out

    def handle_managed_scenario_delete(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """Remove a mission from ``managed_missions.json``, optional disk delete, symlink cleanup."""
        body_raw = _read_json_body(handler)
        body: dict[str, Any] = body_raw if isinstance(body_raw, dict) else {}
        delete_project_files = bool(body.get("delete_project_files") or body.get("deleteProjectFiles"))

        all_missions = _read_managed_missions_raw()
        if mission_id not in all_missions or not isinstance(all_missions[mission_id], dict):
            return {"_http_status": 404, "error": "Mission not found."}

        row: dict[str, Any] = dict(all_missions[mission_id])
        name = str(row.get("name", "")).strip()
        map_suffix = str(row.get("map_suffix", "")).strip()
        full = f"{name}.{map_suffix}"
        symlink_note: str | None = None
        disk_note: str | None = None

        project_path = row.get("project_path")
        profile_path = row.get("profile_path")
        if isinstance(project_path, str) and isinstance(profile_path, str):
            pp = project_path.strip()
            prof = profile_path.strip()
            if pp and prof and name and map_suffix:
                mt = row.get("mission_type", "mp")
                link: str | None = None
                for cand in iter_profile_mission_symlink_candidates(prof, mt, full):
                    if os.path.lexists(cand) and os.path.islink(cand):
                        link = cand
                        break
                if link is not None:
                    try:
                        if os.path.samefile(link, pp):
                            os.remove(link)
                            symlink_note = "Removed profile symlink."
                        else:
                            symlink_note = (
                                "Symlink at profile path does not point to this mission; left unchanged."
                            )
                    except OSError as e:
                        return {"_http_status": 500, "error": f"Could not remove symlink: {e}"}
                else:
                    blocking: str | None = None
                    for cand in iter_profile_mission_symlink_candidates(prof, mt, full):
                        if os.path.lexists(cand):
                            blocking = cand
                            break
                    if blocking is not None:
                        symlink_note = "Profile path exists but is not a symlink; left unchanged."
                    else:
                        symlink_note = "No symlink at profile path to remove."

        if delete_project_files:
            if not isinstance(project_path, str) or not project_path.strip():
                return {"_http_status": 400, "error": "No project folder on record; cannot delete from disk."}
            pp_res = _path_under_allowed_root(project_path.strip())
            if pp_res is None or not os.path.isdir(pp_res):
                return {"_http_status": 400, "error": "Project folder not found or path not allowed."}
            if not _is_strict_child_of_mission_projects(pp_res):
                return {
                    "_http_status": 403,
                    "error": (
                        "Removing the project from disk is only allowed for folders under "
                        "launchpad_data/mission_projects."
                    ),
                }
            try:
                shutil.rmtree(pp_res)
            except OSError as e:
                return {"_http_status": 500, "error": f"Could not delete project folder: {e}"}
            disk_note = "Deleted project folder from disk."

        del all_missions[mission_id]
        try:
            _write_json_atomic(_managed_missions_path(), all_missions)
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not save managed missions: {e}"}

        out: dict[str, Any] = {"ok": True}
        if symlink_note is not None:
            out["symlink_message"] = symlink_note
        if disk_note is not None:
            out["disk_message"] = disk_note
        return out

    def handle_mission_build_request(self, handler: BaseHTTPRequestHandler):
        """
        Build a new mission on disk, optionally symlink into the Arma profile, and register it in
        ``managed_missions.json``.

        POST JSON: mission_name, map_suffix, author; optional network_type (Singleplayer|Multiplayer),
        generate_scripting_environment (bool), game_type (string).
        """
        if handler.command.upper() == "GET":
            return {
                "status": 0,
                "warnings": [],
                "messages": ["Mission build API ready."],
            }

        body = _read_json_body(handler)
        if body is None:
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": "Expected a JSON object body with Content-Length.",
            }
        if not isinstance(body, dict):
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": "Expected a JSON object body.",
            }

        name = str(body.get("mission_name", "")).strip()
        map_suffix = str(body.get("map_suffix", "")).strip()
        author = str(body.get("author", "")).strip()

        err = _validate_mission_token(name, "Mission name")
        if err:
            return {"status": 1, "warnings": [], "messages": [], "error": err}
        err = _validate_mission_token(map_suffix, "Map suffix")
        if err:
            return {"status": 1, "warnings": [], "messages": [], "error": err}

        settings = _read_settings()
        if not author:
            author = (settings.get("default_author") or "").strip()
        if not author:
            return {"status": 1, "warnings": [], "messages": [], "error": "Author cannot be empty."}
        if any(c in author for c in ("/", "\\", "\x00")):
            return {"status": 1, "warnings": [], "messages": [], "error": "Author cannot contain path separators."}

        network = str(body.get("network_type", "Multiplayer"))
        mission_type = "sp" if network.strip() == "Singleplayer" else "mp"
        gen_env = bool(body.get("generate_scripting_environment"))
        game_type = body.get("game_type", "Unknown")

        mission_fullname = f"{name}.{map_suffix}"
        profile_raw = (settings.get("arma3_profile_path") or "").strip()
        if not profile_raw:
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": (
                    "Arma 3 profile folder is not configured. Set it under Settings "
                    "(saved as arma3_profile_path in launchpad_data/settings.json); "
                    "it is required so the mission can be linked under "
                    "mpmissions|missions/A3Launchpad_missions."
                ),
            }
        try:
            profile_path = os.path.realpath(os.path.normpath(profile_raw))
        except OSError:
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": "Arma profile path could not be resolved; check the path in Settings.",
            }
        if not os.path.isdir(profile_path):
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": (
                    "Arma profile path must be an existing folder, typically "
                    r"'...\Documents\Arma 3 - Other Profiles\<YourProfile>'."
                ),
            }

        data_dir = _launchpad_data_dir()
        projects_root = os.path.join(data_dir, "mission_projects")
        os.makedirs(projects_root, exist_ok=True)
        project_path = os.path.join(projects_root, mission_fullname)
        if os.path.lexists(project_path):
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": (
                    f"A mission project folder already exists at {project_path!r}. "
                    "Use a different mission name or map suffix, or remove that folder first."
                ),
            }

        desc_params = _build_mission_description_params(author, mission_fullname, game_type)
        config: dict[str, Any] = {
            "mission_name": name,
            "map_suffix": map_suffix,
            "mission_fullname": mission_fullname,
            "project_path": project_path,
            "profile_path": profile_path,
            "mission_type": mission_type,
            "author": author,
            "description_ext_params": desc_params,
            "generate_scripting_environment": gen_env,
            "description": body.get("description") if isinstance(body.get("description"), str) else None,
        }

        try:
            mission_id, gen_warnings = mission_generate(config)
        except OSError as e:
            logger.exception("Mission build failed (OS error)")
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": str(e),
            }
        except Exception as e:
            logger.exception("Mission build failed")
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": str(e),
            }

        messages = [
            f"Mission registered as managed id {mission_id}.",
            f"Arma folder name: {mission_fullname}",
        ]
        return {
            "status": 0,
            "warnings": list(gen_warnings),
            "messages": messages,
            "mission_path": project_path,
            "mission_id": mission_id,
        }

    def handle_ipc_file_contents_get(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        raw = _query_param(handler, "path")
        if not raw:
            return {"_http_status": 400, "error": "Missing query parameter: path"}
        resolved = _path_under_allowed_root(raw)
        if resolved is None or not os.path.isfile(resolved):
            return {"_http_status": 404, "error": "File not found or not allowed."}
        try:
            with open(resolved, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not read file: {e}"}
        return {"content": text}

    def handle_ipc_file_contents_patch(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        raw = body.get("path")
        contents = body.get("contents")
        if not isinstance(raw, str) or not raw.strip():
            return {"_http_status": 400, "error": "Missing or invalid path."}
        if not isinstance(contents, str):
            return {"_http_status": 400, "error": "Missing or invalid contents."}
        target = _ipc_write_target_path(raw.strip())
        if target is None:
            return {"_http_status": 403, "error": "Path not allowed for write."}
        parent = os.path.dirname(target)
        fd, tmp = tempfile.mkstemp(prefix=".ipc_write_", suffix=".tmp", dir=parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                fh.write(contents)
            os.replace(tmp, target)
        except OSError as e:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return {"_http_status": 500, "error": f"Could not write file: {e}"}
        return {"ok": True}

    # Same as handle_ipc_file_contents_get, but for partial file contents.
    # GET query: ``path`` (required), ``start`` (int), ``end`` (int).
    def handle_ipc_partial_file_contents_get(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        raw = _query_param(handler, "path")
        if not raw:
            return {"_http_status": 400, "error": "Missing query parameter: path"}

        target = os.path.realpath(os.path.normpath(os.path.expandvars(raw)))
        if not _rpt_tail_path_allowed(target):
            return {
                "_http_status": 403,
                "error": "Path is outside allowed log folders (profile or Arma 3 Tools Logs).",
            }
        if not os.path.isfile(target):
            return {"_http_status": 404, "error": "File not found."}
        if not target.lower().endswith(".rpt"):
            return {"_http_status": 400, "error": "Only .rpt files are supported."}

        start_raw = _query_param(handler, "start")
        end_raw = _query_param(handler, "end")
        try:
            start = int(start_raw) if isinstance(start_raw, str) and start_raw.strip() else 0
            end = int(end_raw) if isinstance(end_raw, str) and end_raw.strip() else -1
        except ValueError:
            return {"_http_status": 400, "error": "start/end must be integers."}

        if start < 0:
            return {"_http_status": 400, "error": "start must be >= 0."}
        if end != -1 and end < start:
            return {"_http_status": 400, "error": "end must be >= start."}

        try:
            file_size = os.path.getsize(target)
            read_start = min(start, file_size)
            read_end = file_size if end == -1 else min(end, file_size)
            with open(target, "rb") as fh:
                fh.seek(read_start)
                data = fh.read(max(0, read_end - read_start))
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not read file: {e}"}

        return {
            "ok": True,
            "path": target,
            "content": data.decode("utf-8", errors="replace"),
            "start": read_start,
            "end": read_start + len(data),
            "file_size": file_size,
        }

    def handle_ipc_run_command_post(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        cmd = body.get("command")
        if not isinstance(cmd, str) or not cmd.strip():
            return {"_http_status": 400, "error": "Missing or invalid command."}
        # POSIX mode so a client-built ``code "D:\\path\\with spaces"`` (JSON.stringify) parses
        # to ``['code', r'D:\path\with spaces']``. Windows non-POSIX shlex leaves ``"`` on the path
        # and breaks :func:`_path_under_allowed_root`.
        parts = shlex.split(cmd.strip(), posix=True)
        if len(parts) != 2:
            return {
                "_http_status": 403,
                "error": "Only a single launcher plus one path is allowed (e.g. code <folder>).",
            }
        exe, target = parts[0], parts[1]
        if exe.lower() not in ("code", "code.cmd"):
            return {"_http_status": 403, "error": "Command not allowed."}
        resolved = _path_under_allowed_root(target)
        if resolved is None or not os.path.isdir(resolved):
            return {"_http_status": 403, "error": "Path not found, not a directory, or not allowed."}
        code_exe = shutil.which("code") or shutil.which("code.cmd")
        if not code_exe:
            return {"_http_status": 500, "error": "Visual Studio Code CLI (code) not found in PATH."}
        try:
            proc = subprocess.run(
                [code_exe, resolved],
                capture_output=True,
                text=True,
                timeout=120,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            return {"_http_status": 504, "error": "Command timed out.", "stdout": "", "stderr": ""}
        except OSError as e:
            return {"_http_status": 500, "error": str(e), "stdout": "", "stderr": ""}
        return {
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "returncode": proc.returncode,
        }

    def handle_ipc_settings_get_patch(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """Read or update ``launchpad_data/settings.json`` (paths and default mission author)."""
        method = handler.command.upper()
        if method == "GET":
            return _read_settings()
        if method != "PATCH":
            return {"_http_status": 405, "error": "Method not allowed."}

        body = _read_json_body(handler)
        if body is None:
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        if not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}

        current = _read_settings()
        merged, err = _apply_settings_patch(current, body)
        if err is not None:
            return {"_http_status": 400, "error": err}

        data_dir = _launchpad_data_dir()
        try:
            os.makedirs(data_dir, exist_ok=True)
            _write_json_atomic(_settings_path(), merged)
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not save settings: {e}"}

        return {"ok": True, **merged}

    def handle_ipc_build_mission_pbo_post(
        self, handler: BaseHTTPRequestHandler
    ) -> dict[str, Any] | NdjsonStream:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        project_raw = _json_str_field(body, "project_path", "projectPath")
        if not project_raw:
            return {"_http_status": 400, "error": "Missing or invalid project path."}
        project_resolved = _path_under_allowed_root(project_raw)
        if project_resolved is None or not os.path.isdir(project_resolved):
            return {
                "_http_status": 400,
                "error": "Mission path not found, not a directory, or not allowed.",
            }

        output_field = _json_str_field(body, "output_path", "outputPath")
        pbo_fn, fn_err = _mission_pbo_base_filename(project_resolved, body)
        if fn_err is not None or pbo_fn is None:
            return {"_http_status": 400, "error": fn_err or "Could not determine PBO file name."}
        pbo_full, out_err = _normalize_mission_pbo_output_path(project_resolved, output_field, pbo_fn)
        if out_err is not None or pbo_full is None:
            return {"_http_status": 400, "error": out_err or "Invalid output path."}

        gate = _pbo_output_overwrite_gate(pbo_full, body)
        if gate is not None:
            return gate

        want_stream = bool(body.get("stream"))

        if want_stream:
            pbo_path = pbo_full

            def rows() -> Iterable[dict[str, Any]]:
                q: queue.Queue[object] = queue.Queue()
                SENT = object()
                err_box: list[Exception | None] = [None]

                def prog(msg: str) -> None:
                    q.put(("log", msg))

                def worker() -> None:
                    try:
                        make_mission_pbo(
                            project_resolved,
                            output_pbo_path=pbo_path,
                            progress_callback=prog,
                        )
                    except Exception as e:
                        err_box[0] = e
                    finally:
                        q.put(SENT)

                threading.Thread(target=worker, daemon=True).start()
                while True:
                    item = q.get()
                    if item is SENT:
                        break
                    if isinstance(item, tuple) and len(item) == 2 and item[0] == "log":
                        yield {"type": "log", "message": item[1]}
                if err_box[0] is not None:
                    yield {"type": "error", "message": str(err_box[0])}
                    return
                yield {"type": "done", "pboPath": pbo_path}

            return NdjsonStream(rows())

        log_lines: list[str] = []
        try:
            make_mission_pbo(
                project_resolved,
                output_pbo_path=pbo_full,
                progress_callback=log_lines.append,
            )
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not build mission PBO: {e}"}
        except Exception as e:
            logger.exception("PBO build failed")
            return {"_http_status": 500, "error": f"Could not build mission PBO: {e}"}
        return {"ok": True, "pboPath": pbo_full, "log": log_lines}

    def handle_ipc_reveal_path_post(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        target = _json_str_field(body, "path", "targetPath")
        if not target:
            return {"_http_status": 400, "error": "Missing or invalid path."}
        project_hint = _json_str_field(body, "project_path", "projectPath")
        project_resolved = _path_under_allowed_root(project_hint) if project_hint else None
        if not _path_allowed_for_reveal(target, project_resolved):
            return {"_http_status": 403, "error": "Path not allowed."}
        try:
            rp = os.path.realpath(os.path.normpath(target))
        except OSError as e:
            return {"_http_status": 400, "error": str(e)}
        if not os.path.isfile(rp):
            return {"_http_status": 400, "error": "Path is not an existing file."}
        try:
            _reveal_path_in_file_manager(rp)
        except OSError as e:
            return {"_http_status": 500, "error": str(e)}
        return {"ok": True}

    def handle_testing_modlist_request(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """``GET`` / ``POST`` / ``PATCH`` — cached mod list under ``launchpad_data/testing_modlist.json``."""
        method = handler.command.upper()
        if method == "GET":
            store = _read_testing_modlist_store()
            return {"ok": True, "mods": store["mods"]}

        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}

        if method == "POST":
            raw_mods = body.get("mods")
            if not isinstance(raw_mods, list):
                return {"_http_status": 400, "error": "Field mods (array) is required."}
            out: list[dict[str, Any]] = []
            for item in raw_mods:
                row = _normalize_testing_mod_row(item, assign_id=True)
                if row is None:
                    return {"_http_status": 400, "error": "Each mod needs a valid path string."}
                out.append(row)
            _write_testing_modlist_store(out)
            return {"ok": True, "mods": out}

        if method == "PATCH":
            updates = body.get("updates")
            if not isinstance(updates, list) or not updates:
                return {"_http_status": 400, "error": "Field updates (non-empty array) is required."}
            store = _read_testing_modlist_store()
            by_id: dict[str, dict[str, Any]] = {}
            for m in store["mods"]:
                if isinstance(m, dict) and isinstance(m.get("id"), str):
                    by_id[m["id"]] = dict(m)
            for u in updates:
                if not isinstance(u, dict):
                    return {"_http_status": 400, "error": "Each update must be an object."}
                uid = u.get("id")
                if not isinstance(uid, str) or not uid.strip():
                    return {"_http_status": 400, "error": "Each update needs id (string)."}
                uid = uid.strip()
                if uid not in by_id:
                    return {"_http_status": 404, "error": f"Unknown mod id: {uid!r}."}
                if "enabled" in u:
                    by_id[uid]["enabled"] = u["enabled"] is True
            merged = list(by_id.values())
            _write_testing_modlist_store(merged)
            return {"ok": True, "mods": merged}

        return {"_http_status": 405, "error": "Method not allowed."}

    def handle_testing_launch_post(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """
        Start Arma 3 with ``-nosplash``, optional ``-mod=``, profile ``-name=``, extra args, and optional ``-autotest``.

        POST JSON: ``managed_scenario_id`` (required), ``extra_args`` (string or string array), ``autotest`` (bool).

        When ``autotest`` is true, prefer ``autotest_spec`` (object): the server merges mission context and writes
        ``launchpad_data/testing_autotest_temp/autotest_<uuid>.json``, then passes ``-autotest=<absolute path>``.
        Optional ``autotest_spec`` fields: ``label`` (string), ``iterations`` (int), ``max_duration_sec`` (int),
        ``tags`` (string array). An empty object ``{}`` still produces a file with server-filled metadata.

        Legacy: ``autotest_config`` (string) still appends ``-autotest=<value>`` when ``autotest_spec`` is omitted.
        If ``autotest`` is true and neither ``autotest_spec`` nor ``autotest_config`` is set, appends bare ``-autotest``.
        """
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        mid = body.get("managed_scenario_id") or body.get("mission_id")
        if not isinstance(mid, str) or not mid.strip():
            return {"_http_status": 400, "error": "Field managed_scenario_id (string) is required."}
        mid = mid.strip()

        all_missions = _read_managed_missions_raw()
        row = all_missions.get(mid)
        if not isinstance(row, dict):
            return {"_http_status": 404, "error": "Mission not found."}
        name = str(row.get("name", "")).strip()
        map_suf = str(row.get("map_suffix", "")).strip()
        if not name or not map_suf:
            return {"_http_status": 400, "error": "Mission is missing name or map_suffix."}
        mission_folder = f"{name}.{map_suf}"

        settings = _read_settings()
        game_root = (settings.get("arma3_path") or "").strip()
        exe, exe_err = _arma3_executable_path(game_root)
        if exe is None or exe_err:
            return {"_http_status": 400, "error": exe_err or "Could not resolve Arma 3 executable."}

        mission_mods = _managed_scenario_mods_from_row(row)
        store = {"mods": mission_mods}
        if not mission_mods:
            # Backward compatibility for older sessions that still rely on global testing_modlist.json.
            store = _read_testing_modlist_store()
        mod_paths: list[str] = []
        for m in store["mods"]:
            if not isinstance(m, dict) or m.get("enabled") is False:
                continue
            p = _resolve_mod_path_for_launch(str(m.get("path", "")), game_root)
            if p:
                mod_paths.append(p)
        mod_arg: str | None = None
        if mod_paths:
            sep = ";" if os.name == "nt" else ":"
            mod_arg = sep.join(mod_paths)

        extra_parts, xerr = _testing_extra_args_from_body(body)
        if xerr:
            return {"_http_status": 400, "error": xerr}

        argv: list[str] = [exe, "-nosplash"]
        prof_path = row.get("profile_path")
        if isinstance(prof_path, str) and prof_path.strip():
            pname = _arma_profile_name_from_path(prof_path)
            if pname:
                argv.append(f"-name={pname}")
        if mod_arg:
            argv.append(f"-mod={mod_arg}")
        argv.extend(extra_parts)

        autotest = body.get("autotest") is True
        autotest_file_path: str | None = None
        ac_raw = body.get("autotest_config")
        ac = ac_raw.strip() if isinstance(ac_raw, str) else ""
        spec_in = body.get("autotest_spec")
        if autotest:
            if spec_in is not None:
                if not isinstance(spec_in, dict):
                    return {"_http_status": 400, "error": "autotest_spec must be a JSON object."}
                try:
                    merged_spec = _merge_autotest_file_payload(mid, mission_folder, spec_in)
                except ValueError as e:
                    return {"_http_status": 400, "error": str(e)}
                path, werr = _write_autotest_config_file(merged_spec)
                if werr or not path:
                    return {"_http_status": 500, "error": werr or "Could not write autotest file."}
                autotest_file_path = path
                argv.append(f"-autotest={path}")
            elif ac:
                if any(c in ac for c in ("\x00", "\n", "\r")):
                    return {"_http_status": 400, "error": "Invalid autotest_config."}
                argv.append(f"-autotest={ac}")
            else:
                argv.append("-autotest")

        cwd = os.path.dirname(exe) if os.path.isfile(exe) else game_root
        logger.info("Testing launch: %s", argv)
        try:
            if os.name == "nt":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                proc = subprocess.Popen(
                    argv,
                    cwd=cwd,
                    shell=False,
                    close_fds=False,
                    creationflags=flags,
                )
            else:
                proc = subprocess.Popen(argv, cwd=cwd, shell=False, close_fds=True)
        except OSError as e:
            logger.exception("Testing launch failed to spawn process")
            return {"_http_status": 500, "error": f"Could not start Arma 3: {e}"}

        autotest_watch_id: str | None = None
        if autotest:
            autotest_watch_id = self._create_autotest_watch(mid, mission_folder, proc.pid)

        return {
            "ok": True,
            "pid": proc.pid,
            "argv": argv,
            "missionFolderName": mission_folder,
            **({"autotestWatchId": autotest_watch_id} if autotest_watch_id else {}),
            **(
                {"autotestFilePath": autotest_file_path}
                if autotest and autotest_file_path
                else {}
            ),
            "message": (
                "Started Arma 3. If the mission does not auto-load, open it from Scenarios "
                f"(folder name {mission_folder!r}) — it should appear when symlinked into your profile."
            ),
        }

    def handle_testing_autotest_result_get(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        watch_id = (_query_param(handler, "watch_id") or "").strip()
        with self._autotest_watch_lock:
            watch = self._autotest_watch
            if not isinstance(watch, dict):
                return {"ok": True, "active": False, "complete": False, "reason": "no_watch"}
            current_watch_id = str(watch.get("watch_id", ""))
            if watch_id and watch_id != current_watch_id:
                return {"ok": True, "active": False, "complete": False, "reason": "stale_watch"}
            existing = watch.get("result")
            if isinstance(existing, dict):
                return {
                    "ok": True,
                    "active": False,
                    "complete": True,
                    "watch_id": current_watch_id,
                    "started_ts": watch.get("started_ts"),
                    "result_data": existing,
                }
            polled = self._poll_autotest_watch(watch)
            if not polled.get("ok"):
                return {"_http_status": 500, "error": str(polled.get("error") or "Autotest scan failed.")}
            if polled.get("found"):
                return {
                    "ok": True,
                    "active": False,
                    "complete": True,
                    "watch_id": current_watch_id,
                    "started_ts": watch.get("started_ts"),
                    "result_data": watch.get("result"),
                }
            return {
                "ok": True,
                "active": True,
                "complete": False,
                "watch_id": current_watch_id,
                "started_ts": watch.get("started_ts"),
                "poll_count": watch.get("poll_count", 0),
            }

    def handle_process_manager_get(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """JSON snapshot of Arma-related processes for the testing dashboard."""
        return snapshot_arma_processes()

    def handle_process_manager_kill_post(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        return force_kill_matching_arma_process(body.get("pid"))

    def handle_list_rpt_files(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """
        List ``.rpt`` files from the profile folder (default) or from ``{Arma 3 Tools}/Logs``.

        Query: ``location=profile`` (default) or ``location=tools``.
        """
        loc_raw = (_query_param(handler, "location") or "profile").strip().lower()
        use_tools = loc_raw == "tools"
        if use_tools:
            folder, folder_err = _arma3_tools_logs_path_from_settings()
        else:
            folder, folder_err = _arma3_appdata_path_from_settings()
        if folder is None:
            return {"_http_status": 400, "error": folder_err or "Log folder is not available."}

        rpt_files: list[dict[str, Any]] = []
        try:
            for name in os.listdir(folder):
                if not name.lower().endswith(".rpt"):
                    continue
                full = os.path.join(folder, name)
                if not os.path.isfile(full):
                    continue
                rpt_files.append(
                    {
                        "name": name,
                        "path": full,
                        "size": os.path.getsize(full),
                        "modified_ts": os.path.getmtime(full),
                    }
                )
        except OSError as e:
            return {"_http_status": 500, "error": f"Could not list RPT files: {e}"}

        rpt_files.sort(key=lambda x: float(x.get("modified_ts", 0.0)), reverse=True)
        return {"ok": True, "folder": folder, "rpt_files": rpt_files, "location": "tools" if use_tools else "profile"}

A3LaunchpadAPI.route("/api/mission/build", methods=("GET", "POST"))(A3LaunchpadAPI.handle_mission_build_request)
A3LaunchpadAPI.route("/api/mission/project-tree", methods=("GET",))(A3LaunchpadAPI.handle_mission_project_tree_get)
A3LaunchpadAPI.route("/api/managed/scenarios", methods=("GET",))(A3LaunchpadAPI.handle_managed_scenarios_request)
A3LaunchpadAPI.route("/api/file-contents", methods=("GET",))(A3LaunchpadAPI.handle_ipc_file_contents_get)
A3LaunchpadAPI.route("/api/file-contents", methods=("PATCH",))(A3LaunchpadAPI.handle_ipc_file_contents_patch)
A3LaunchpadAPI.route("/api/partial-file-contents", methods=("GET",))(A3LaunchpadAPI.handle_ipc_partial_file_contents_get)
A3LaunchpadAPI.route("/api/run-command", methods=("POST",))(A3LaunchpadAPI.handle_ipc_run_command_post)
A3LaunchpadAPI.route("/api/settings", methods=("GET","PATCH"))(A3LaunchpadAPI.handle_ipc_settings_get_patch)
A3LaunchpadAPI.route("/api/build-mission-pbo", methods=("POST",))(A3LaunchpadAPI.handle_ipc_build_mission_pbo_post)
A3LaunchpadAPI.route("/api/reveal-path", methods=("POST",))(A3LaunchpadAPI.handle_ipc_reveal_path_post)
A3LaunchpadAPI.route("/api/testing/modlist", methods=("GET", "POST", "PATCH"))(
    A3LaunchpadAPI.handle_testing_modlist_request
)
A3LaunchpadAPI.route("/api/testing/launch", methods=("POST",))(A3LaunchpadAPI.handle_testing_launch_post)
A3LaunchpadAPI.route("/api/testing/autotest-result", methods=("GET",))(A3LaunchpadAPI.handle_testing_autotest_result_get)
A3LaunchpadAPI.route("/api/process-manager", methods=("GET",))(A3LaunchpadAPI.handle_process_manager_get)
A3LaunchpadAPI.route("/api/process-manager/kill", methods=("POST",))(
    A3LaunchpadAPI.handle_process_manager_kill_post
)
A3LaunchpadAPI.route("/api/list-rpt-files", methods=("GET",))(A3LaunchpadAPI.handle_list_rpt_files)