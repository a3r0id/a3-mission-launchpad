from __future__ import annotations

from collections.abc import Callable, Iterable
import copy
import json
import logging
import os
import queue
import threading
import uuid
import shlex
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler
from typing import Any, ClassVar
from urllib.parse import parse_qs, urlparse

try:
    from .constants import Constants
    from .mission_gen import _launchpad_data_dir, generate as mission_generate
    from .utils import make_mission_pbo
except ImportError:
    from constants import Constants
    from mission_gen import _launchpad_data_dir, generate as mission_generate
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


_MANAGED_MISSIONS_FILE = "managed_missions.json"
_SETTINGS_FILE = "settings.json"
_SETTINGS_KEYS = frozenset({"arma3_path", "arma3_tools_path", "arma3_profile_path"})


def _managed_missions_path() -> str:
    return os.path.join(_launchpad_data_dir(), _MANAGED_MISSIONS_FILE)


def _settings_path() -> str:
    return os.path.join(_launchpad_data_dir(), _SETTINGS_FILE)


def _default_settings() -> dict[str, str]:
    return {k: "" for k in _SETTINGS_KEYS}


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
    return out


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
        else:
            return None, f"Invalid type for {key!r}: expected a string."
    return merged, None


def _build_mission_description_params(
    author: str,
    display_name: str,
    game_type_raw: Any,
) -> dict[str, Any]:
    """Build ``description.ext`` parameter dict from templates and user input."""
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


def _missions_folder_for_type(mission_type: str) -> str:
    v = (mission_type or "").strip().lower()
    if v in ("sp", "singleplayer", "0", "false"):
        return "missions"
    return "mpmissions"


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


def _mission_pbo_output_parent_allowed(pbo_full: str, project_resolved: str) -> str | None:
    """
    Return ``None`` if the parent directory of ``pbo_full`` may receive the PBO.

    Allowed: parent under :func:`_path_under_allowed_root`, or same parent directory as
    the mission folder (typical “PBO next to the mission folder” layout).
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


def _normalize_mission_pbo_output_path(project_resolved: str, output_path: str | None) -> tuple[str | None, str | None]:
    """``(absolute .pbo path, error)``."""
    base_name = os.path.basename(project_resolved.rstrip(os.sep)) + ".pbo"
    if output_path:
        raw = output_path.strip()
        out = os.path.abspath(os.path.normpath(raw))
        full = out if out.lower().endswith(".pbo") else os.path.join(out, base_name)
    else:
        full = os.path.join(os.path.dirname(project_resolved), base_name)
    err = _mission_pbo_output_parent_allowed(full, project_resolved)
    if err is not None:
        return None, err
    return full, None


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

    Handlers are ``(api, handler) -> JSON-serializable`` — the second argument is the
    :class:`http.server.BaseHTTPRequestHandler` instance (path, headers, ``rfile``, etc.).
    """

    _routes: ClassVar[dict[tuple[str, str], Callable[..., Any]]] = {}

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
        if method.upper() == "PATCH" and subpath.startswith("managed/scenarios/"):
            mission_id = subpath[len("managed/scenarios/") :].strip("/")
            if mission_id and "/" not in mission_id:
                return api.handle_managed_scenario_patch(mission_id, handler)
        return None

    def handle_managed_scenarios_request(self, handler: BaseHTTPRequestHandler):
        """Return all managed missions as a JSON array with ``id`` on each row."""
        managed = _read_managed_missions_raw()
        return [{"id": mid, **row} for mid, row in managed.items() if isinstance(row, dict)]

    def handle_managed_scenario_patch(self, mission_id: str, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}

        name_in = body.get("name")
        map_in = body.get("map_suffix")
        if name_in is None and map_in is None:
            return {"_http_status": 400, "error": "Provide at least one of: name, map_suffix."}

        all_missions = _read_managed_missions_raw()
        if mission_id not in all_missions or not isinstance(all_missions[mission_id], dict):
            return {"_http_status": 404, "error": "Mission not found."}

        row: dict[str, Any] = dict(all_missions[mission_id])
        old_name = str(row.get("name", "")).strip()
        old_map = str(row.get("map_suffix", "")).strip()
        new_name = old_name if name_in is None else str(name_in).strip()
        new_map = old_map if map_in is None else str(map_in).strip()

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
                folder = _missions_folder_for_type(str(row.get("mission_type", "mp")))
                old_link = os.path.join(prof, folder, old_full)
                new_link = os.path.join(prof, folder, new_full)
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
                if os.path.lexists(old_link) and os.path.islink(old_link):
                    try:
                        if os.path.samefile(old_link, pp):
                            os.remove(old_link)
                            if not os.path.lexists(new_link):
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
        if not author:
            return {"status": 1, "warnings": [], "messages": [], "error": "Author cannot be empty."}
        if any(c in author for c in ("/", "\\", "\x00")):
            return {"status": 1, "warnings": [], "messages": [], "error": "Author cannot contain path separators."}

        network = str(body.get("network_type", "Multiplayer"))
        mission_type = "sp" if network.strip() == "Singleplayer" else "mp"
        gen_env = bool(body.get("generate_scripting_environment"))
        game_type = body.get("game_type", "Unknown")

        mission_fullname = f"{name}.{map_suffix}"
        settings = _read_settings()
        profile_raw = (settings.get("arma3_profile_path") or "").strip()
        if not profile_raw:
            return {
                "status": 1,
                "warnings": [],
                "messages": [],
                "error": (
                    "Arma 3 profile folder is not configured. Set it under Settings "
                    "(saved as arma3_profile_path in launchpad_data/settings.json); "
                    "it is required so the mission can be linked under mpmissions or missions."
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
                    r"'…\Documents\Arma 3 - Other Profiles\<YourProfile>'."
                ),
            }

        data_dir = _launchpad_data_dir()
        projects_root = os.path.join(data_dir, "mission_projects")
        os.makedirs(projects_root, exist_ok=True)
        project_path = os.path.join(projects_root, str(uuid.uuid4()))

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

    def handle_ipc_run_command_post(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        body = _read_json_body(handler)
        if body is None or not isinstance(body, dict):
            return {"_http_status": 400, "error": "Expected a JSON object body."}
        cmd = body.get("command")
        if not isinstance(cmd, str) or not cmd.strip():
            return {"_http_status": 400, "error": "Missing or invalid command."}
        parts = shlex.split(cmd.strip(), posix=os.name != "nt")
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
        """Read or update ``launchpad_data/settings.json`` (Arma 3 install paths)."""
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
        pbo_full, out_err = _normalize_mission_pbo_output_path(project_resolved, output_field)
        if out_err is not None or pbo_full is None:
            return {"_http_status": 400, "error": out_err or "Invalid output path."}

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


A3LaunchpadAPI.route("/api/mission/build", methods=("GET", "POST"))(A3LaunchpadAPI.handle_mission_build_request)
A3LaunchpadAPI.route("/api/managed/scenarios", methods=("GET",))(A3LaunchpadAPI.handle_managed_scenarios_request)
A3LaunchpadAPI.route("/api/file-contents", methods=("GET",))(A3LaunchpadAPI.handle_ipc_file_contents_get)
A3LaunchpadAPI.route("/api/file-contents", methods=("PATCH",))(A3LaunchpadAPI.handle_ipc_file_contents_patch)
A3LaunchpadAPI.route("/api/run-command", methods=("POST",))(A3LaunchpadAPI.handle_ipc_run_command_post)
A3LaunchpadAPI.route("/api/settings", methods=("GET","PATCH"))(A3LaunchpadAPI.handle_ipc_settings_get_patch)
A3LaunchpadAPI.route("/api/build-mission-pbo", methods=("POST",))(A3LaunchpadAPI.handle_ipc_build_mission_pbo_post)
A3LaunchpadAPI.route("/api/reveal-path", methods=("POST",))(A3LaunchpadAPI.handle_ipc_reveal_path_post)
