#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: ./make_release.sh <version> [commit]" >&2
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 2
fi

release_version=$1
tag_commit=${2:-HEAD}
if [[ ! $release_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release version must be numeric MAJOR.MINOR.PATCH (without a leading v)" >&2
  exit 2
fi
if [[ ! $tag_commit =~ ^(HEAD|[0-9a-fA-F]{7,40})$ ]]; then
  echo "commit must be HEAD or a 7-40 character hexadecimal commit id" >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$script_dir"

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "refusing release from a dirty worktree" >&2
  exit 1
fi
git rev-parse --verify --quiet "${tag_commit}^{commit}" >/dev/null || {
  echo "commit does not resolve: $tag_commit" >&2
  exit 2
}
if git show-ref --verify --quiet "refs/tags/v${release_version}"; then
  echo "refusing existing tag: v${release_version}" >&2
  exit 1
fi

python3 - "$release_version" <<'PY'
import sys
from server.feature_flags import resolve_feature_flags

try:
    resolve_feature_flags(sys.argv[1])
except (OSError, ValueError) as exc:
    raise SystemExit(f"release manifest preflight failed: {exc}")
PY

mkdir -p dist
if compgen -G "dist/officefloor-${release_version}-*.whl" >/dev/null; then
  echo "refusing already-built version: ${release_version}" >&2
  exit 1
fi

echo "Release plan"
echo "  version: ${release_version}"
echo "  tag target: ${tag_commit}"
echo "  update: VERSION + pyproject.toml"
echo "  gates: manifest probe + release readiness 5/5"
echo "  artifact: wheel + sha256 under dist/"
echo "  publish/tag: print command only; create nothing"

backup_dir=$(mktemp -d "${TMPDIR:-/tmp}/office-release.XXXXXX")
cp VERSION "$backup_dir/VERSION"
cp pyproject.toml "$backup_dir/pyproject.toml"
release_complete=0
cleanup() {
  status=$?
  if [[ $status -ne 0 && $release_complete -eq 0 ]]; then
    cp "$backup_dir/VERSION" VERSION
    cp "$backup_dir/pyproject.toml" pyproject.toml
    find dist -maxdepth 1 -type f -name "officefloor-${release_version}-*.whl" -delete
    echo "release failed; restored VERSION and pyproject.toml" >&2
  fi
  rm -f "$backup_dir/VERSION" "$backup_dir/pyproject.toml"
  rmdir "$backup_dir"
}
trap cleanup EXIT

python3 - "$release_version" <<'PY'
from pathlib import Path
import re
import sys

version = sys.argv[1]
version_path = Path("VERSION")
project_path = Path("pyproject.toml")
project = project_path.read_text(encoding="utf-8")
pattern = re.compile(r'(?m)^version = "[^"]+"$')
if len(pattern.findall(project)) != 1:
    raise SystemExit("pyproject.toml must contain exactly one version assignment")

version_tmp = version_path.with_suffix(".release-tmp")
project_tmp = project_path.with_suffix(".release-tmp")
version_tmp.write_text(version + "\n", encoding="utf-8")
project_tmp.write_text(pattern.sub(f'version = "{version}"', project), encoding="utf-8")
version_tmp.replace(version_path)
project_tmp.replace(project_path)
PY

python3 qa/tools/release_manifest_probe.py
readiness_log=$(mktemp "${TMPDIR:-/tmp}/office-readiness.XXXXXX")
if ! python3 qa/tools/release_readiness_probe.py | tee "$readiness_log"; then
  rm -f "$readiness_log"
  echo "release readiness failed" >&2
  exit 1
fi
if ! grep -Fxq "PASS release readiness: 5/5 hard items green" "$readiness_log"; then
  rm -f "$readiness_log"
  echo "release readiness did not report exactly 5/5" >&2
  exit 1
fi
rm -f "$readiness_log"

python3 -m pip wheel . -w dist --no-deps --no-build-isolation
mapfile -t release_wheels < <(
  find dist -maxdepth 1 -type f -name "officefloor-${release_version}-*.whl" -print
)
if [[ ${#release_wheels[@]} -ne 1 ]]; then
  echo "expected exactly one wheel for ${release_version}, found ${#release_wheels[@]}" >&2
  exit 1
fi
wheel=${release_wheels[0]}
if ! python3 qa/tools/wheel_secret_probe.py "$wheel"; then
  echo "wheel secret scan failed" >&2
  exit 1
fi
wheel_sha=$(python3 - "$wheel" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

print(sha256(Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)

release_complete=1
echo "wheel: ${wheel}"
echo "sha256: ${wheel_sha}"
echo "CEO tag command (not run):"
echo "git tag v${release_version} ${tag_commit}"
echo "No tag, push, upload, or publish command was run."
