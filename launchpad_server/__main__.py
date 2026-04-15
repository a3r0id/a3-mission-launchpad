import json
import logging
import mimetypes
import os
import sys
import threading
from typing import Optional
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _LaunchpadHTTPServer(ThreadingHTTPServer):
    """Suppress tracebacks for normal client disconnects (e.g. devtools / app exit)."""

    def handle_error(self, request, client_address):
        _, exc, _ = sys.exc_info()
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            logger.debug("Client disconnected while handling request from %s", client_address)
            return
        super().handle_error(request, client_address)
from urllib.parse import unquote, urlparse

from api import A3LaunchpadAPI, NdjsonStream
from mission_gen import _launchpad_data_dir
from sock_server import FramedIpcService

def _configure_logging() -> None:
    """Log to ``launchpad_data/logs/launchpad.log`` and mirror to stderr."""
    logs_dir = os.path.join(_launchpad_data_dir(), "logs")
    os.makedirs(logs_dir, exist_ok=True)
    log_path = os.path.join(logs_dir, "launchpad.log")

    root = logging.getLogger()
    if root.handlers:
        return

    root.setLevel(logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)
    root.addHandler(file_handler)
    root.addHandler(stream_handler)

logger = logging.getLogger(__name__)


def _close_pyinstaller_splash() -> None:
    """Bootloader splash stays until closed; no-op when not frozen / no splash."""
    try:
        import pyi_splash

        pyi_splash.close()
    except ImportError:
        return
    except Exception:
        # pyi_splash may raise KeyError (missing _PYI_SPLASH_IPC) when frozen without splash.
        return


def _bundle_root() -> str:
    """PyInstaller bundle root (``_MEIPASS``) or the ``launchpad_server`` package directory in dev."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


config_path = os.path.join(_bundle_root(), "config.json")

### Security Warning ###
# This HTTP service is ONLY meant to maintain a LOCAL IPC between the web browser and the python backend.
# DO NOT expose this to the internet as it IS NOT secure FOR THAT PURPOSE.
#
# IPC-style endpoints (see api.py): ``/api/file-contents`` (GET/PATCH), ``/api/run-command`` (POST).

def _add_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    """Allow cross-origin /api calls (e.g. Vite dev server proxying to this host)."""
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")

def respond_with_json(handler: BaseHTTPRequestHandler, data, status: int = 200):
    handler.send_response(status)
    handler.send_header("Content-type", "application/json")
    _add_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def _static_file_for_request(dist_dir: str, raw_path: str) -> str | None:
    """Resolve a URL path to a file under dist_dir, or None if unsafe / missing."""
    root = os.path.realpath(dist_dir)
    rel = unquote(urlparse(raw_path).path).strip("/")
    if not rel:
        candidate = os.path.realpath(os.path.join(root, "index.html"))
    else:
        candidate = os.path.realpath(os.path.join(root, *rel.split("/")))
    if candidate != root and not candidate.startswith(root + os.sep):
        return None
    if os.path.isdir(candidate):
        inner = os.path.join(candidate, "index.html")
        return inner if os.path.isfile(inner) else None
    return candidate if os.path.isfile(candidate) else None


def _serve_dist_file(handler: BaseHTTPRequestHandler, fs_path: str) -> None:
    ctype = mimetypes.guess_type(fs_path)[0] or "application/octet-stream"
    try:
        with open(fs_path, "rb") as f:
            body = f.read()
    except OSError:
        handler.send_response(500)
        handler.end_headers()
        return
    handler.send_response(200)
    handler.send_header("Content-type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def make_request_handler(api: A3LaunchpadAPI, dist_dir: str):
    class RequestHandler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            if not self.path.split("?", 1)[0].startswith("/api/"):
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(204)
            _add_cors_headers(self)
            self.end_headers()

        def do_GET(self):
            if not self.path.split("?", 1)[0].startswith("/api/"):
                fs_path = _static_file_for_request(dist_dir, self.path)
                if fs_path is None:
                    self.send_response(404)
                    self.send_header("Content-type", "text/plain")
                    self.end_headers()
                    self.wfile.write(b"Not found")
                    return
                _serve_dist_file(self, fs_path)
                return
            payload = A3LaunchpadAPI.dispatch(api, "GET", self)
            if payload is None:
                respond_with_json(self, {"error": "Not found"}, status=404)
                return
            status = 200
            if isinstance(payload, dict) and "_http_status" in payload:
                status = int(payload["_http_status"])
                payload = {k: v for k, v in payload.items() if k != "_http_status"}
            respond_with_json(self, payload, status=status)

        def do_POST(self):
            if not self.path.split("?", 1)[0].startswith("/api/"):
                self.send_response(404)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"Not found")
                return
            payload = A3LaunchpadAPI.dispatch(api, "POST", self)
            if payload is None:
                respond_with_json(self, {"error": "Not found"}, status=404)
                return
            if isinstance(payload, NdjsonStream):
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                _add_cors_headers(self)
                self.end_headers()
                for row in payload.rows:
                    self.wfile.write(json.dumps(row, ensure_ascii=False).encode("utf-8") + b"\n")
                    try:
                        self.wfile.flush()
                    except OSError:
                        break
                return
            status = 200
            if isinstance(payload, dict) and "_http_status" in payload:
                status = int(payload["_http_status"])
                payload = {k: v for k, v in payload.items() if k != "_http_status"}
            respond_with_json(self, payload, status=status)

        def do_PATCH(self):
            if not self.path.split("?", 1)[0].startswith("/api/"):
                self.send_response(404)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"Not found")
                return
            payload = A3LaunchpadAPI.dispatch(api, "PATCH", self)
            if payload is None:
                respond_with_json(self, {"error": "Not found"}, status=404)
                return
            status = 200
            if isinstance(payload, dict) and "_http_status" in payload:
                status = int(payload["_http_status"])
                payload = {k: v for k, v in payload.items() if k != "_http_status"}
            respond_with_json(self, payload, status=status)

        def do_DELETE(self):
            if not self.path.split("?", 1)[0].startswith("/api/"):
                self.send_response(404)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"Not found")
                return
            payload = A3LaunchpadAPI.dispatch(api, "DELETE", self)
            if payload is None:
                respond_with_json(self, {"error": "Not found"}, status=404)
                return
            status = 200
            if isinstance(payload, dict) and "_http_status" in payload:
                status = int(payload["_http_status"])
                payload = {k: v for k, v in payload.items() if k != "_http_status"}
            respond_with_json(self, payload, status=status)

        def log_message(self, fmt, *args):
            logger.info("%s - %s", self.address_string(), fmt % args)

    return RequestHandler

class A3Launchpad:
    config = {}
    server = None
    api = None

    def __init__(self, api_class: type[A3LaunchpadAPI] = A3LaunchpadAPI):
        self.config = json.load(open(config_path, encoding="utf-8"))
        self.api = api_class()
        ipc_host = str(self.config.get("ipc_host", "127.0.0.1"))
        ipc_port = int(
            self.config.get(
                "ipc_port",
                int(self.config.get("port", 8111)) + 1,
            )
        )
        self._ipc = FramedIpcService(ipc_host, ipc_port)
        self._ipc.start_background()
        if getattr(sys, "frozen", False):
            exe = os.path.abspath(sys.executable)
            a3_root = os.path.dirname(os.path.dirname(exe))
            bundled = os.path.join(a3_root, "web_dist")
        else:
            bundled = None
        dev = os.path.normpath(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..",
                "launchpad_client",
                "renderer",
                "dist",
            )
        )
        self._dist_dir = bundled if bundled and os.path.isdir(bundled) else dev
        if not os.path.isdir(self._dist_dir):
            logger.warning(
                "Client dist directory missing at %s - run npm run build in launchpad_client/renderer "
                "and ensure A3LaunchPad/web_dist is populated when using the packaged server.",
                self._dist_dir,
            )
        handler_cls = make_request_handler(self.api, self._dist_dir)
        self.server = _LaunchpadHTTPServer((self.config["host"], self.config["port"]), handler_cls)
        # threading.Thread(target=self.open_browser).start()
        _close_pyinstaller_splash()
        self.start()

    def open_browser(self, url: Optional[str] = None):
        if os.environ.get("LAUNCHPAD_HEADLESS", "").strip().lower() in ("1", "true", "yes"):
            return
        if url is None:
            host = self.config["host"]
            if host in ("0.0.0.0", "::"):
                host = "127.0.0.1"
            url = f"http://{host}:{self.config['port']}/"
        webbrowser.open(url, new=1)

    def start(self):
        self.server.serve_forever()


if __name__ == "__main__":
    data_dir = _launchpad_data_dir()
    is_new_data = not os.path.isdir(data_dir)
    if is_new_data:
        os.makedirs(data_dir)
        os.makedirs(os.path.join(data_dir, "logs"), exist_ok=True)
        with open(os.path.join(data_dir, "managed_missions.json"), "w", encoding="utf-8") as f:
            json.dump({}, f)
        with open(os.path.join(data_dir, "settings.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "arma3_path": "",
                    "arma3_tools_path": "",
                    "arma3_profile_path": "",
                    "arma3_appdata_path": (
                        r"%LOCALAPPDATA%\Arma 3" if os.name == "nt" else ""
                    ),
                    "default_author": "",
                    "github_new_repo_visibility": "private",
                },
                f,
            )
    else:
        os.makedirs(os.path.join(data_dir, "logs"), exist_ok=True)

    _configure_logging()

    if is_new_data:
        logger.info("Created launchpad_data environment at %s", data_dir)
    else:
        logger.info("Found launchpad_data environment at %s", data_dir)

    A3Launchpad()
