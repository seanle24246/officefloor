"""Local-only personal-token storage and OFFICE.session bootstrap.

This module never performs remote verification and imports no hosted, OAuth,
or network client. It exposes only credential presence to the loopback floor;
the authoritative account id remains the hosted whoami service's concern.
"""

from __future__ import annotations

import getpass
import ipaddress
import os
import re
import secrets
import stat
import sys
import warnings
from pathlib import Path
from typing import Any


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z", re.ASCII)
TOKEN_BYTES_PATTERN = re.compile(rb"[A-Za-z0-9_-]{43}\Z", re.ASCII)
LOCAL_SESSION_ROUTE_PREFIX = "/.office-session/"
LOCAL_SESSION_ROUTE_PATTERN = re.compile(
    r"/\.office-session/[A-Za-z0-9_-]{32}\.js\Z",
    re.ASCII,
)
LOCAL_SESSION_SCRIPT = b"""(() => {
  'use strict';
  const office = globalThis.OFFICE;
  if (!office || !office._reg) throw new Error('OFFICE boot missing before local session');
  office.session = { user: { localCredential: true }, ageAttested: false };
})();
"""
BOOT_SCRIPT_TAG = b'<script src="office.boot.js"></script>'
_BASE_HANDLER_KEY = "_officefloor_local_credential_base_handler"


class LocalCredentialError(RuntimeError):
    """Local credential storage or bootstrap cannot be made fail-closed."""


def default_token_path() -> Path:
    configured = os.environ.get("XDG_CONFIG_HOME")
    root = Path(configured) if configured and Path(configured).is_absolute() \
        else Path.home() / ".config"
    return root / "officefloor" / "token"


def _secure_directory_flags() -> int:
    required = ("O_CLOEXEC", "O_DIRECTORY", "O_NOFOLLOW")
    if any(not hasattr(os, name) for name in required) or not hasattr(os, "getuid"):
        raise LocalCredentialError("secure POSIX credential storage is unavailable")
    return os.O_RDONLY | os.O_CLOEXEC | os.O_DIRECTORY | os.O_NOFOLLOW


def _open_token_directory(directory: Path, *, create: bool) -> int:
    if not directory.is_absolute() or not directory.name or ".." in directory.parts:
        raise LocalCredentialError("token directory must be an absolute child path")
    flags = _secure_directory_flags()
    descriptor = os.open(directory.anchor, flags)
    try:
        for part in directory.parts[1:]:
            if part in ("", ".", ".."):
                raise LocalCredentialError("token directory path is invalid")
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child

        metadata = os.fstat(descriptor)
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid():
            raise LocalCredentialError("token directory must be owned by this user")
        if create:
            os.fchmod(descriptor, 0o700)
        elif stat.S_IMODE(metadata.st_mode) != 0o700:
            raise LocalCredentialError("token directory mode must be 0700")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _token_target(path: str | os.PathLike[str] | None) -> Path:
    target = Path(path) if path is not None else default_token_path()
    if not target.is_absolute() or target.name in ("", ".", ".."):
        raise LocalCredentialError("token path must be absolute")
    return target


def write_token_file(
    token: str,
    path: str | os.PathLike[str] | None = None,
) -> Path:
    """Atomically write an exact token beneath an owned mode-0700 directory."""
    if not isinstance(token, str) or TOKEN_PATTERN.fullmatch(token) is None:
        raise LocalCredentialError("personal token has invalid format")
    target = _token_target(path)
    directory_fd = _open_token_directory(target.parent, create=True)
    data = bytearray(token.encode("ascii") + b"\n")
    temporary_name = ""
    descriptor = -1
    try:
        for _attempt in range(8):
            temporary_name = ".token-" + secrets.token_hex(12)
            try:
                descriptor = os.open(
                    temporary_name,
                    os.O_WRONLY
                    | os.O_CREAT
                    | os.O_EXCL
                    | os.O_CLOEXEC
                    | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=directory_fd,
                )
                break
            except FileExistsError:
                continue
        if descriptor < 0:
            raise LocalCredentialError("could not create token file")

        view = memoryview(data)
        try:
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short credential write")
                view = view[written:]
        finally:
            view.release()
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(
            temporary_name,
            target.name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        temporary_name = ""
        os.fsync(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_name:
            try:
                os.unlink(temporary_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        for index in range(len(data)):
            data[index] = 0
        os.close(directory_fd)
    return target


def credential_is_configured(
    path: str | os.PathLike[str] | None = None,
) -> bool:
    """Return only credential presence; never return, hash, or log raw bytes."""
    try:
        target = _token_target(path)
        directory_fd = _open_token_directory(target.parent, create=False)
    except (LocalCredentialError, OSError):
        return False

    descriptor = -1
    data = bytearray()
    try:
        descriptor = os.open(
            target.name,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            dir_fd=directory_fd,
        )
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_nlink != 1
            or metadata.st_size not in (43, 44)
        ):
            return False
        while len(data) <= 44:
            chunk = os.read(descriptor, 45 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        if os.read(descriptor, 1):
            return False
        if data.endswith(b"\n"):
            data.pop()
        return TOKEN_BYTES_PATTERN.fullmatch(data) is not None
    except OSError:
        return False
    finally:
        for index in range(len(data)):
            data[index] = 0
        if descriptor >= 0:
            os.close(descriptor)
        os.close(directory_fd)


def _session_script_tag(script_path: str) -> bytes:
    if LOCAL_SESSION_ROUTE_PATTERN.fullmatch(script_path) is None:
        raise LocalCredentialError("local session script path is invalid")
    return (
        f'<script src="{script_path}" data-office-side-effect></script>'.encode(
            "ascii"
        )
    )


def inject_session_script(index: bytes, script_path: str) -> bytes:
    """Mount the CSP-safe external bootstrap immediately after OFFICE boot."""
    if not isinstance(index, bytes) or index.count(BOOT_SCRIPT_TAG) != 1:
        raise LocalCredentialError("served index must contain one office.boot.js tag")
    return index.replace(
        BOOT_SCRIPT_TAG,
        BOOT_SCRIPT_TAG + b"\n" + _session_script_tag(script_path),
        1,
    )


def _is_literal_loopback(host: object) -> bool:
    if not isinstance(host, str) or not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def configure_server(
    runtime: dict[str, Any],
    index: bytes,
    *,
    host: str,
    token_path: str | os.PathLike[str] | None = None,
) -> bytes:
    """Conditionally install a loopback-only script route and index tag."""
    base_handler = runtime.get(_BASE_HANDLER_KEY, runtime["Handler"])
    runtime["Handler"] = base_handler
    resolved_token_path = _token_target(token_path)
    if not credential_is_configured(resolved_token_path):
        return index
    if not _is_literal_loopback(host):
        raise LocalCredentialError(
            "local credential session requires a literal loopback --host"
        )
    runtime.setdefault(_BASE_HANDLER_KEY, base_handler)
    script_path = (
        LOCAL_SESSION_ROUTE_PREFIX + secrets.token_urlsafe(24) + ".js"
    )

    class LocalCredentialSessionHandler(base_handler):
        _officefloor_local_credential_session = True
        _officefloor_local_credential_script_path = script_path

        def do_GET(self) -> None:
            if self.path == script_path:
                if self._reject_bad_host():
                    return
                headers = {"Cross-Origin-Resource-Policy": "same-origin"}
                if self.headers.get("Sec-Fetch-Site", "").casefold() == "cross-site":
                    return self._send(
                        403,
                        b"",
                        "text/plain; charset=utf-8",
                        "no-store",
                        headers,
                    )
                if not credential_is_configured(resolved_token_path):
                    return self._send(
                        404,
                        b"",
                        "text/plain; charset=utf-8",
                        "no-store",
                        headers,
                    )
                return self._send(
                    200,
                    LOCAL_SESSION_SCRIPT,
                    "text/javascript; charset=utf-8",
                    "no-store",
                    headers,
                )
            return super().do_GET()

    runtime["Handler"] = LocalCredentialSessionHandler
    return inject_session_script(index, script_path)


def main(argv: list[str] | None = None) -> int:
    """Paste once, then launch the same read-only public floor defaults."""
    import office_cli

    arguments = list(sys.argv[1:] if argv is None else argv)
    paste_count = arguments.count("--paste-token")
    if paste_count > 1:
        print("local credential: --paste-token may appear once", file=sys.stderr)
        return 2
    paste = paste_count == 1
    if paste:
        arguments.remove("--paste-token")
    try:
        parsed = office_cli.parse_args(arguments)
    except (TypeError, ValueError) as error:
        print(f"local credential: {error}", file=sys.stderr)
        return 2
    if parsed.get("help"):
        print(office_cli.usage_text())
        print("\nlocal credential:\n  --paste-token     prompt, store at 0600, then launch")
        return 0

    if paste:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                raw_token = getpass.getpass("Paste personal sync token: ")
            saved = write_token_file(raw_token)
        except (
            EOFError,
            KeyboardInterrupt,
            getpass.GetPassWarning,
            LocalCredentialError,
            OSError,
        ):
            raw_token = ""
            print("local credential: token was not stored", file=sys.stderr)
            return 2
        except BaseException:
            raw_token = ""
            raise
        else:
            raw_token = ""
        print(f"Saved personal token to {saved} (0600)")

    config = office_cli.friends_defaults(parsed)
    if credential_is_configured() and not _is_literal_loopback(config["host"]):
        print(
            "local credential: configured sessions require a literal loopback host",
            file=sys.stderr,
        )
        return 2

    import serve

    command = office_cli.serve_command(
        config,
        str(Path(serve.__file__).resolve()),
        python=sys.executable,
    )
    prior_argv = sys.argv
    try:
        sys.argv = command[1:]
        return serve.main()
    finally:
        sys.argv = prior_argv


if __name__ == "__main__":
    raise SystemExit(main())
