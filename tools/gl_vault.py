#!/usr/bin/env python3
"""Deterministic stdlib bundler leaf for the standalone WebGL module vault."""

from __future__ import annotations

import base64
import json
import posixpath
import re
from pathlib import Path, PurePosixPath

ENTRY_MODULE = "office.webgl.mount.js"
ENTRY_MODULES = (ENTRY_MODULE, "office.am.looks3d.js")
VAULT_PREFIX = "office-gl:/"
VAULT_ID = "office-gl-vault"
PLATE_ASSETS = (
    "assets/manhattan-skyline-cc0.png",
    "assets/manhattan-oak-floor-cc0.png",
    "assets/tokyo-office.png",
)
ASSET_MIME = {".css": "text/css", ".png": "image/png"}

RELATIVE_JS_LITERAL_RE = re.compile(
    r"(?P<quote>['\"])(?P<specifier>\.{1,2}/[^'\"\r\n]+\.js)(?P=quote)"
)
IMPORT_META_URL_LITERAL_RE = re.compile(
    r"new\s+URL\(\s*(?P<quote>['\"])(?P<specifier>\.{1,2}/[^'\"\r\n]+)"
    r"(?P=quote)\s*,\s*import\.meta\.url\s*\)\.href"
)
IMPORT_META_URL_IDENT_RE = re.compile(
    r"new\s+URL\(\s*(?P<identifier>[A-Za-z_$][\w$]*)\s*,\s*"
    r"import\.meta\.url\s*\)\.href"
)
IMPORT_META_RE = re.compile(r"\bimport\.meta\b")
SCRIPT_END_RE = re.compile(r"</script", re.IGNORECASE)


def _static_root(static: Path) -> Path:
    root = Path(static)
    if not root.is_dir():
        raise ValueError(f"static directory does not exist: {root}")
    return root


def _source(root: Path, name: str) -> str:
    path = root / name
    if not path.is_file():
        raise ValueError(f"vault dependency is missing: {name}")
    return path.read_text(encoding="utf-8")


def _relative_target(importer: str, specifier: str) -> str:
    if "\\" in specifier or not specifier.startswith(("./", "../")):
        raise ValueError(f"{importer}: unsafe relative specifier {specifier!r}")
    parent = str(PurePosixPath(importer).parent)
    target = posixpath.normpath(posixpath.join(parent, specifier))
    if target in {"", ".", ".."} or target.startswith("../") or target.startswith("/"):
        raise ValueError(f"{importer}: specifier escapes static/: {specifier!r}")
    return target


def _module_names(static: Path) -> list[str]:
    return sorted({*ENTRY_MODULES, *(name for name in inventory(static) if name.endswith(".js"))})


def inventory(static: Path) -> list[str]:
    """Return sorted JS/CSS dependency targets reachable from the floor and Looks entries.

    The floor entry itself is excluded. Relative JS literals include imports,
    exports, dynamic-import constants, and registry path keys; this deliberate
    breadth keeps runtime lookups aligned with rewritten import specifiers.
    """
    root = _static_root(static)
    queue = list(ENTRY_MODULES)
    visited: set[str] = set()
    dependencies: set[str] = set()
    while queue:
        importer = queue.pop(0)
        if importer in visited:
            continue
        source = _source(root, importer)
        visited.add(importer)
        for match in RELATIVE_JS_LITERAL_RE.finditer(source):
            target = _relative_target(importer, match.group("specifier"))
            if not target.endswith(".js"):
                raise ValueError(f"{importer}: module dependency is not JavaScript: {target}")
            _source(root, target)
            dependencies.add(target)
            if target not in visited:
                queue.append(target)
        for match in IMPORT_META_URL_LITERAL_RE.finditer(source):
            target = _relative_target(importer, match.group("specifier"))
            if not target.endswith(".css"):
                raise ValueError(f"{importer}: unexpected import.meta asset: {target}")
            _source(root, target)
            dependencies.add(target)
    dependencies.discard(ENTRY_MODULE)
    return sorted(dependencies)


def _assert_rewritten(source: str, name: str) -> None:
    if SCRIPT_END_RE.search(source):
        raise ValueError(f"{name}: source contains an HTML script end tag")
    if IMPORT_META_RE.search(source):
        raise ValueError(f"{name}: residual import.meta after rewrite")
    residual = RELATIVE_JS_LITERAL_RE.search(source)
    if residual:
        raise ValueError(
            f"{name}: residual relative module literal {residual.group('specifier')!r}"
        )


def rewrite(source: str, name: str) -> tuple[str, list[str]]:
    """Rewrite one module to vault specifiers and return its resolved keys."""
    if not isinstance(source, str) or not isinstance(name, str) or not name:
        raise ValueError("rewrite requires non-empty source and module name")
    if SCRIPT_END_RE.search(source):
        raise ValueError(f"{name}: source contains an HTML script end tag")

    def asset_literal(match: re.Match[str]) -> str:
        target = _relative_target(name, match.group("specifier"))
        if not target.endswith(".css"):
            raise ValueError(f"{name}: unexpected import.meta asset: {target}")
        return f"OFFICE_GL_VAULT.asset({json.dumps(target)})"

    rewritten = IMPORT_META_URL_LITERAL_RE.sub(asset_literal, source)

    def asset_identifier(match: re.Match[str]) -> str:
        identifier = match.group("identifier")
        if name != "office.webgl.plate.js" or identifier != "asset":
            raise ValueError(f"{name}: unsupported dynamic import.meta asset {identifier!r}")
        return "OFFICE_GL_VAULT.asset(asset)"

    rewritten = IMPORT_META_URL_IDENT_RE.sub(asset_identifier, rewritten)
    specifiers: set[str] = set()

    def module_literal(match: re.Match[str]) -> str:
        target = _relative_target(name, match.group("specifier"))
        key = VAULT_PREFIX + target
        specifiers.add(key)
        quote = match.group("quote")
        return f"{quote}{key}{quote}"

    rewritten = RELATIVE_JS_LITERAL_RE.sub(module_literal, rewritten)
    _assert_rewritten(rewritten, name)
    return rewritten, sorted(specifiers)


def assets(static: Path) -> dict[str, str]:
    """Return sorted data URIs for reachable CSS and the three plate PNGs."""
    root = _static_root(static)
    names = {name for name in inventory(root) if name.endswith(".css")}
    names.update(PLATE_ASSETS)
    encoded: dict[str, str] = {}
    for name in sorted(names):
        path = root / name
        if not path.is_file():
            raise ValueError(f"vault asset is missing: {name}")
        mime = ASSET_MIME.get(path.suffix.lower())
        if mime is None:
            raise ValueError(f"unsupported vault asset type: {name}")
        body = base64.b64encode(path.read_bytes()).decode("ascii")
        encoded[name] = f"data:{mime};base64,{body}"
    return encoded


def _asset_runtime(asset_map: dict[str, str], marker: str) -> str:
    payload = json.dumps(asset_map, sort_keys=True, separators=(",", ":")).replace("<", "\\u003c")
    return f"""/* {marker} */
(function installOfficeGLAssets(root) {{
  'use strict';
  const assets = Object.freeze({payload});
  root.OFFICE_GL_VAULT = Object.freeze({{
    asset(name) {{
      const raw = String(name || '');
      if (/^(?:blob|data):/.test(raw)) return raw;
      const key = raw.startsWith('./') ? raw.slice(2) : raw;
      const value = assets[key];
      if (typeof value !== 'string') throw new Error(`office-gl vault asset is missing: ${{key}}`);
      return value;
    }},
  }});
}}(globalThis));
"""


def _blob_bootstrap(asset_map: dict[str, str]) -> str:
    runtime = _asset_runtime(asset_map, "OFFICE_GL_VAULT_BOOTSTRAP")
    injection = f"""(function installOfficeGLImportMap() {{
  'use strict';
  const payload = document.getElementById({json.dumps(VAULT_ID)});
  if (!payload) throw new Error('office-gl vault payload is missing');
  const modules = JSON.parse(payload.textContent);
  const imports = Object.create(null);
  for (const key of Object.keys(modules).sort()) {{
    imports[key] = URL.createObjectURL(new Blob([modules[key]], {{ type: 'text/javascript' }}));
  }}
  const importMap = document.createElement('script');
  importMap.type = 'importmap';
  importMap.textContent = JSON.stringify({{ imports }});
  const anchor = document.currentScript;
  if (!anchor || typeof anchor.after !== 'function') {{
    throw new Error('office-gl vault bootstrap has no script anchor');
  }}
  anchor.after(importMap);
}}());
"""
    return runtime + injection


def vault(static: Path, encoding: str = "blob") -> dict[str, object]:
    """Return deterministic vault JSON, import-map data, and bootstrap JS."""
    root = _static_root(static)
    if encoding not in {"blob", "data"}:
        raise ValueError(f"unsupported GL vault encoding: {encoding!r}")
    modules: dict[str, str] = {}
    resolved: set[str] = set()
    for name in _module_names(root):
        rewritten, specifiers = rewrite(_source(root, name), name)
        _assert_rewritten(rewritten, name)
        modules[VAULT_PREFIX + name] = rewritten
        resolved.update(specifiers)
    missing = sorted(resolved - set(modules))
    if missing:
        raise ValueError("vault has unresolved module specifiers: " + ", ".join(missing))
    modules = dict(sorted(modules.items()))
    module_json = json.dumps(
        modules, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
    )
    if SCRIPT_END_RE.search(module_json):
        raise ValueError("vault JSON contains an HTML script end tag")

    asset_map = assets(root)
    if encoding == "data":
        imports = {
            key: "data:text/javascript;base64,"
            + base64.b64encode(source.encode("utf-8")).decode("ascii")
            for key, source in modules.items()
        }
        bootstrap_js = _asset_runtime(asset_map, "OFFICE_GL_VAULT_ASSETS")
    else:
        imports = {}
        bootstrap_js = _blob_bootstrap(asset_map)
    importmap_json = json.dumps(
        {"imports": imports}, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
    )
    return {
        "encoding": encoding,
        "modules": modules,
        "assets": asset_map,
        "json": module_json,
        "importmap": imports,
        "importmap_json": importmap_json,
        "bootstrap_js": bootstrap_js,
    }
