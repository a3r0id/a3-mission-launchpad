import copy
import datetime
import enum
import json
import logging
import os
import sys
import tempfile
import uuid
from typing import Any
try:
    from .constants import Constants
    from .utils import generate_random_seed
except ImportError:  # running as a loose module (not ``python -m launchpad``)
    from constants import Constants
    from utils import generate_random_seed

class MissionType(enum.Enum):
    SP = "sp"
    MP = "mp"


def _launchpad_data_dir() -> str:
    """Frozen: ``launchpad_data`` next to the executable. Dev: nested or repo-root ``launchpad_data``."""
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "launchpad_data")
    here = os.path.dirname(os.path.abspath(__file__))
    nested = os.path.join(here, "launchpad_data")
    if os.path.isdir(nested):
        return nested
    return os.path.join(os.path.dirname(here), "launchpad_data")


def _coerce_mission_type(value: Any) -> MissionType:
    if isinstance(value, MissionType):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("sp", "singleplayer", "0", "false"):
            return MissionType.SP
        if v in ("mp", "multiplayer", "1", "true"):
            return MissionType.MP
    return MissionType.MP


# https://community.bistudio.com/wiki/Event_Scripts
# onlyMP / onlySP: if True, file is created only for that network class (mission folder / tooling), per wiki wording.
def _event_script_definitions() -> list[dict[str, Any]]:
    return Constants.EVENT_SCRIPT_DEFINITIONS


def _include_event_script_for_mission(meta: dict[str, Any], mission_type: MissionType) -> bool:
    if meta.get("onlyMP") and mission_type != MissionType.MP:
        return False
    if meta.get("onlySP") and mission_type != MissionType.SP:
        return False
    return True


def _resolve_event_script_body(meta: dict[str, Any], data_dir: str) -> str | None:
    """
    Return file body, or None if the file should be omitted (``skip_without_data`` and no template on disk).
    Optional ``data_file`` is relative to the launchpad data directory.
    """
    rel = meta.get("data_file")
    if isinstance(rel, str) and rel.strip():
        path = os.path.join(data_dir, rel.replace("/", os.sep))
        if os.path.isfile(path):
            with open(path, encoding="utf-8", errors="replace") as fh:
                return fh.read()
    if meta.get("skip_without_data"):
        return None
    return meta.get("content", "")


def _sqf_event_params_prefix(meta: dict[str, Any], script_name: str) -> str:
    """
    First line for event ``.sqf`` scripts: ``params ["_a", "_b"];`` from ``meta["params"]``.
    Omitted when the list is empty, or for non-``.sqf`` files (``.sqs`` / ``.fsm`` differ).
    """
    if not script_name.lower().endswith(".sqf"):
        return ""
    raw = meta.get("params")
    if not isinstance(raw, list) or not raw:
        return ""
    elems: list[str] = []
    for p in raw:
        if isinstance(p, str):
            s = p.strip()
            if s:
                elems.append(json.dumps(s))
    if not elems:
        return ""
    return "params [" + ", ".join(elems) + "];\n"


# Forges a simple class with the given name and content.
def forge_simple_class(class_name: str, class_content: dict) -> str:
    return f"class {class_name} {{\n{'\n'.join([f'    {key} = {value}' for key, value in class_content.items()])}\n}}\n\n"

# Bootstraps a mission by creating a project folder and symlinking the scenario link file to it.
def bootstrap_mission(
    project_path: str,  # the path to the project folder; This can be ANYWHERE on your system. This is where the managed mission file will live.
    profile_path: str,  # the path to the profile folder; IE: %USERPROFILE%\Documents\Arma 3 - Other Profiles\<a3_profile_name>
    mission_fullname: str,  # the full name of the mission; IE: 'my_mission.vr'
    mission_type: MissionType,
) -> list[str]:
    """
    Create ``project_path`` and optionally add an Arma profile symlink to it.
    Returns a list of human-readable warnings (e.g. symlink skipped or failed).
    """
    warnings: list[str] = []
    os.makedirs(project_path, exist_ok=True)
    logging.info("Created project folder: %s", project_path)

    prof = (profile_path or "").strip()
    if not prof:
        msg = "No Arma profile path configured; skipped symlink under missions/mpmissions. Set arma3_profile_path in launchpad_data/settings.json."
        logging.warning(msg)
        warnings.append(msg)
        return warnings

    scenario_link_path = os.path.join(
        prof,
        "missions" if mission_type == MissionType.SP else "mpmissions",
        mission_fullname,
    )
    logging.info("Creating symlink at %s -> %s", scenario_link_path, project_path)
    try:
        os.symlink(
            project_path,
            scenario_link_path,
            target_is_directory=True,
        )
        logging.info("Symlink created: %s -> %s", scenario_link_path, project_path)
    except OSError as e:
        msg = f"Could not create Arma profile symlink ({e!r}). Mission files were still created under {project_path}."
        logging.warning(msg)
        warnings.append(msg)
    return warnings

# Generates a default mission.sqm file with the given author and new random seed.
def generate_mission_sqm(author: str, project_path: str) -> str:
    with open(os.path.join(project_path, "mission.sqm"), "w") as file:
        file.write(Constants.SQM_TEMPLATE.replace("$author", author).replace("$randomSeed", str(generate_random_seed())))
    return os.path.join(project_path, "mission.sqm")

# Generates a default description.ext file with the given author and new random seed.
def generate_description_ext(project_path: str, params = None) -> str:

    if params is None:
        params = dict(Constants.EXT_TEMPLATE)

    # start with the generated code template ($… placeholders, not str.format braces)
    generation_time = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")
    author_raw = params.get("author", "")
    author_text = author_raw if isinstance(author_raw, str) else str(author_raw)
    ext_string = (
        Constants.GENERATED_CODE_TEMPLATE.replace("$author", author_text)
        .replace("$fileName", "description.ext")
        .replace("$generationTime", generation_time)
    )

    # write the classes first
    ext_string += forge_simple_class("Header", params.get("header", {}))
    ext_string += forge_simple_class("DifficultyOverride", params.get("difficultyOverride", {}))

    # then the loose keys
    loose_keys = [key for key in params if key not in ["header", "difficultyOverride"]]
    for key in loose_keys:
        ext_string += f"{key} = {f"\"{params[key]}\"" if isinstance(params[key], str) else params[key]};\n"

    with open(os.path.join(project_path, "description.ext"), "w") as file:
        file.write(ext_string)

    return os.path.join(project_path, "description.ext")

# Generates a scripting environment for the mission.
def generate_scripting_environment(project_path: str, mission_type: Any = MissionType.MP):
    """
    Creates [Event Scripts](https://community.bistudio.com/wiki/Event_Scripts) in ``project_path``.
    Scripts are filtered with ``onlyMP`` / ``onlySP`` against ``mission_type`` (singleplayer vs multiplayer mission).
    Per-file bodies may be loaded from ``launchpad_data/<data_file>`` when that file exists.
    """
    mt = _coerce_mission_type(mission_type)
    data_dir = _launchpad_data_dir()
    os.makedirs(project_path, exist_ok=True)
    for meta in _event_script_definitions():
        if not _include_event_script_for_mission(meta, mt):
            continue
        body = _resolve_event_script_body(meta, data_dir)
        if body is None:
            continue
        script_name = meta["name"]
        prefix = _sqf_event_params_prefix(meta, script_name)
        out_path = os.path.join(project_path, script_name)
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(prefix + body)
        logging.info("Wrote event script %s", out_path)

_MANAGED_MISSIONS_FILENAME = "managed_missions.json"


def _managed_missions_store_path() -> str:
    return os.path.join(_launchpad_data_dir(), _MANAGED_MISSIONS_FILENAME)


def _write_managed_missions_atomic(path: str, obj: dict[str, Any]) -> None:
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


def add_managed_scenario(row: dict[str, Any]) -> str:
    """Append ``row`` to ``managed_missions.json`` under a new UUID. Returns the new id."""
    path = _managed_missions_store_path()
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            managed = json.load(fh)
        if not isinstance(managed, dict):
            managed = {}
    else:
        managed = {}
    new_id = str(uuid.uuid4())
    merged = copy.deepcopy(Constants.MANAGED_SCENARIOS_TEMPLATE)
    for key, value in row.items():
        merged[key] = value
    managed[new_id] = merged
    _write_managed_missions_atomic(path, managed)
    return new_id


def generate(config: dict) -> tuple[str, list[str]]:
    """
    Generate mission files from ``config`` and register the mission in ``managed_missions.json``.

    ``config`` keys: mission_name, map_suffix, mission_fullname, project_path, profile_path,
    mission_type, author, description_ext_params, generate_scripting_environment.

    Returns ``(managed_mission_id, warnings)``.
    """
    mission_fullname = config["mission_fullname"]
    project_path = config["project_path"]
    logging.info("Bootstrapping mission: %s", mission_fullname)
    warnings = bootstrap_mission(
        project_path,
        str(config.get("profile_path", "")),
        mission_fullname,
        _coerce_mission_type(config["mission_type"]),
    )

    sqm_path = os.path.join(project_path, "mission.sqm")
    logging.info("Generating mission.sqm file: %s", sqm_path)
    generate_mission_sqm(config["author"], project_path)

    desc_path = os.path.join(project_path, "description.ext")
    logging.info("Generating description.ext file: %s", desc_path)
    generate_description_ext(project_path, config["description_ext_params"])

    if config.get("generate_scripting_environment"):
        logging.info("Generating event scripts in %s", project_path)
        generate_scripting_environment(project_path, config["mission_type"])

    mt = config["mission_type"]
    mission_type_str = mt.value if isinstance(mt, MissionType) else str(mt)

    managed_row = {
        "name": config["mission_name"],
        "map_suffix": config["map_suffix"],
        "description": config.get("description") or f"Mission {mission_fullname}",
        "author": config["author"],
        "mission_type": mission_type_str,
        "generate_scripting_environment": bool(config.get("generate_scripting_environment")),
        "ext_params": copy.deepcopy(config["description_ext_params"]),
        "project_path": project_path,
        "profile_path": (config.get("profile_path") or "").strip() or None,
    }
    scenario_uuid = add_managed_scenario(managed_row)
    return scenario_uuid, warnings