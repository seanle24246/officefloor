# Releases

The Office uses one releasable `main` branch. Releases are immutable Git tags;
there are no version branches. Work intended for a later release can merge to
`main` only when its feature flag defaults to off and the unflagged path stays
green.

## Release and feature manifests

- `feature_flags.json` is the registry. Every entry has a boolean `default` and
  a short description.
- `release_manifest.json` lists the flags enabled for each released version.
  Keys beginning with `_` are documentation, not releases.
- `server/feature_flags.py` validates and resolves both files. The served page
  and standalone bake put the result in CSP-safe metadata; `feature.flags.js`
  exposes it through the frozen `window.OfficeFeatureFlags` accessor.

Client code checks a flag explicitly and fails closed when the bootstrap is
missing:

```js
const enabled = globalThis.OfficeFeatureFlags?.enabled('my_feature') === true;
if (!enabled) return;
```

To land v-next work disabled, add a registry entry with `"default": false`,
guard its client or build entry point, and add it to `_example_next`. Add the
flag to a real release list only when that release is approved to expose it.
The release script refuses a version with no `release_manifest.json` entry.

## Cut a release

1. Start from a clean, green `main`. Add the target version to
   `release_manifest.json` with its reviewed enabled-flag list and commit it.
2. Run `./make_release.sh <version> [commit]`. The version is numeric
   `MAJOR.MINOR.PATCH`; the optional tag target is `HEAD` or a commit SHA.
3. The script picks a Python 3.10+ interpreter (override with `PYTHON=`),
   updates `VERSION` and `pyproject.toml`, checks that `release_manifest.json`
   has an entry for the version, runs the full `tests/` suite, builds one wheel
   without build isolation, then runs `qa/tools/wheel_content_probe.py` (only
   public product members, no private paths) and `qa/tools/wheel_meta_scan.py`
   (metadata matches the source, no credential-shaped bytes). Any failure
   restores both version files and removes the partial wheel. A clean run
   prints the wheel SHA-256 and the exact tag command.
4. Review the two version changes and artifact checksum, then commit the version
   bump. After that release commit is merged, the CEO may run the printed tag
   command against the intended commit and push the tag.

The script never creates or pushes a tag and never uploads or publishes the
wheel. A failed run restores both version files and removes its partial wheel.
It also refuses dirty trees, existing release tags, and an already-built wheel
for the requested version.

## Hotfixes

Prefer fixing and releasing from `main`, because it is kept releasable. Create a
short-lived hotfix branch from the affected release tag only when an urgent
patch must target that old release and current `main` cannot be shipped as that
patch. Merge or cherry-pick the fix back to `main`; do not keep a permanent
version branch.
