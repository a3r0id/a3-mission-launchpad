import os
import random
from collections.abc import Callable

try:
    from .thirdparty.a3lib import pbo
except ImportError:
    from thirdparty.a3lib import pbo


def generate_random_seed():
    return random.randint(1000000, 9999999)


def make_mission_pbo(
    mission_folder: str,
    *,
    output_pbo_path: str,
    progress_callback: Callable[[str], None] | None = None,
) -> str:
    """
    Pack a mission directory into a PBO at ``output_pbo_path``.

    The first argument to :func:`a3lib.pbo` is the output file path; source files
    are passed via ``files=[mission_folder]`` so the tree is included.
    """
    src = os.path.realpath(os.path.normpath(mission_folder))
    out = os.path.abspath(os.path.normpath(output_pbo_path))
    parent = os.path.dirname(out)
    if not parent:
        raise OSError("Invalid PBO output path (missing directory).")
    os.makedirs(parent, exist_ok=True)
    pbo(
        out,
        files=[src],
        create_pbo=True,
        update_timestamps=True,
        recursion=True,
        pboprefixfile=False,
        include="*",
        exclude="",
        progress_callback=progress_callback,
    )
    return out
