#!/usr/bin/env python3
"""The founder ship checklist: a local page that signs off the wheel's gates.

One stdlib http.server app on 127.0.0.1 that serves a single page plus a tiny
JSON API. It touches no product server code and reaches nothing off this
machine. Every row it shows is read out of the product's own data files by
tools/ship_manifest.py — it invents no flag and writes no description.

    python3 tools/ship_checklist.py --port 8810
    open http://127.0.0.1:8810/

Flip the toggles, sign the rows, Save manifest (writes release/ship-manifest.json),
then Build wheel (runs tools/build_ship_wheel.py and streams its output back).

API
    GET  /                    the page
    GET  /api/state           {catalog, manifest, path, problems}
    POST /api/manifest        body: the manifest -> writes it, returns problems
    POST /api/build           streams the build's stdout/stderr as text/plain
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "tools"))

import ship_manifest  # noqa: E402  (local module, path set above)

PAGE = Path(__file__).with_name("ship_checklist.html")
SCRIPT = Path(__file__).with_name("ship_checklist.js")
MANIFEST_PATH = HERE / ship_manifest.DEFAULT_MANIFEST_PATH
MAX_BODY = 1 << 20

# Only a browser pointed at this machine may talk to the checklist. There is no
# auth here on purpose (INBOX: localhost only); this keeps a hostile page on
# another origin from rebinding DNS onto the port.
ALLOWED_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")

# The wheel build needs Python 3.10+ with a modern setuptools; the checklist
# itself runs anywhere. Prefer the running interpreter, then a named 3.1x.
BUILD_CANDIDATES = ("python3.13", "python3.12", "python3.11", "python3.10")

_build_lock = threading.Lock()


def build_interpreter() -> str:
    if sys.version_info >= (3, 10):
        return sys.executable
    for name in BUILD_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    return sys.executable


def set_manifest_path(path: Path) -> None:
    """Point the checklist at another manifest file (probes, side-by-side runs)."""
    global MANIFEST_PATH
    MANIFEST_PATH = path


def _shown_path() -> str:
    try:
        return str(MANIFEST_PATH.relative_to(HERE))
    except ValueError:
        return str(MANIFEST_PATH)


def current_document() -> tuple[dict, list[str]]:
    """The document on disk reconciled with the catalog, or a fresh default.

    The problems reported are the ACTIVE target's — that is the one the Build
    button would build. The other target keeps its own rows and sign-offs.
    """
    if MANIFEST_PATH.is_file():
        try:
            document = ship_manifest.load(MANIFEST_PATH)
        except ship_manifest.ShipManifestError as error:
            return ship_manifest.default_document(HERE), [str(error)]
    else:
        document = ship_manifest.default_document(HERE)
    return document, ship_manifest.validate(ship_manifest.resolve(document))


class Handler(BaseHTTPRequestHandler):
    server_version = "officefloor-ship-checklist"
    # HTTP/1.0 + Connection: close lets the build response stream out without
    # chunked framing; fetch() in the page reads it incrementally regardless.
    protocol_version = "HTTP/1.0"

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        sys.stderr.write("ship_checklist %s\n" % (fmt % args))

    # -- helpers ---------------------------------------------------------
    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return host in ALLOWED_HOSTS

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload, indent=2).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _file(self, path: Path, content_type: str) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self._json(404, {"error": f"missing {path.name}"})
            return
        self._send(200, body, content_type)

    def _body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._json(413, {"error": "bad or oversized body"})
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as error:
            self._json(400, {"error": f"body is not JSON: {error}"})
            return None

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:
        if not self._host_ok():
            self._json(403, {"error": "checklist serves 127.0.0.1 only"})
            return
        if self.path in ("/", "/index.html"):
            self._file(PAGE, "text/html; charset=utf-8")
        elif self.path == "/ship_checklist.js":
            self._file(SCRIPT, "text/javascript; charset=utf-8")
        elif self.path == "/api/state":
            document, problems = current_document()
            self._json(200, {
                "catalog": ship_manifest.catalog(HERE),
                "manifest": document,
                "path": _shown_path(),
                "exists": MANIFEST_PATH.is_file(),
                "problems": problems,
            })
        else:
            self._json(404, {"error": "no such route"})

    def do_POST(self) -> None:
        if not self._host_ok():
            self._json(403, {"error": "checklist serves 127.0.0.1 only"})
            return
        if self.path == "/api/manifest":
            self._save_manifest()
        elif self.path == "/api/build":
            self._build()
        else:
            self._json(404, {"error": "no such route"})

    def _save_manifest(self) -> None:
        payload = self._body()
        if payload is None:
            return
        payload.setdefault("schema", ship_manifest.SCHEMA)
        try:
            document = ship_manifest.merge(payload, HERE)
        except ship_manifest.ShipManifestError as error:
            self._json(400, {"error": str(error)})
            return
        try:
            ship_manifest.save(MANIFEST_PATH, document)
        except OSError as error:
            self._json(500, {"error": f"cannot write manifest: {error}"})
            return
        self._json(200, {
            "saved": _shown_path(),
            "manifest": document,
            "problems": ship_manifest.validate(ship_manifest.resolve(document)),
        })

    def _build(self) -> None:
        if not MANIFEST_PATH.is_file():
            self._json(409, {"error": "save the manifest before building"})
            return
        if not _build_lock.acquire(blocking=False):
            self._json(409, {"error": "a build is already running"})
            return
        try:
            document, problems = current_document()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            if problems:
                self._stream("refusing to build: "
                             f"{len(problems)} unmet requirement(s)\n")
                for problem in problems:
                    self._stream(f"  - {problem}\n")
                self._stream("\nBUILD REFUSED\n")
                return
            self._run_build(document)
        finally:
            _build_lock.release()

    def _stream(self, text: str) -> None:
        try:
            self.wfile.write(text.encode("utf-8"))
            self.wfile.flush()
        except OSError:
            pass

    def _run_build(self, document: dict) -> None:
        interpreter = build_interpreter()
        cmd = [interpreter, str(HERE / "tools" / "build_ship_wheel.py"),
               "--ship-manifest", str(MANIFEST_PATH),
               "--target", document["target"]]
        env = dict(os.environ)
        if document["target"] == "full-internal":
            env["OFFICEFLOOR_FULL_BUILD"] = "1"
        self._stream("$ " + " ".join(cmd) + "\n\n")
        try:
            process = subprocess.Popen(
                cmd, cwd=HERE, env=env, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
        except OSError as error:
            self._stream(f"\nBUILD FAILED: cannot start build: {error}\n")
            return
        assert process.stdout is not None
        for line in process.stdout:
            self._stream(line)
        code = process.wait()
        self._stream(f"\nBUILD {'OK' if code == 0 else 'FAILED'} (exit {code})\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8810)
    parser.add_argument("--host", default="127.0.0.1",
                        help="bind address; loopback only by design")
    parser.add_argument("--manifest", default=None,
                        help="ship manifest to read and write "
                             f"(default {ship_manifest.DEFAULT_MANIFEST_PATH})")
    args = parser.parse_args(argv)
    if args.manifest:
        set_manifest_path(Path(args.manifest).resolve())
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("ship_checklist: refusing to bind off loopback")

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ship checklist: http://{args.host}:{args.port}/")
    print(f"manifest: {_shown_path()}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nship checklist: stopped")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
