# Vendored packaging tools

`closure-compiler-v20220502.jar` is the release-only JavaScript minifier used
by `tools/build_dmg.py`. It is not shipped in the DMG. The version is pinned so
package output cannot change when a system package or network service changes.

- Upstream: <https://github.com/google/closure-compiler/tree/v20220502>
- Maven artifact: `com.google.javascript:closure-compiler:v20220502`
- SHA-256: `85ad32fefa2a9d8a59ed598091f67faff230eca015fb610b39f582a458ce75de`
- License: Apache-2.0 (`closure-compiler-v20220502.LICENSE`)
- Invocation: `java -jar`, `WHITESPACE_ONLY`, independent file compilation,
  `ECMASCRIPT_NEXT` input/output, source content retained in private maps

The adapter verifies the full SHA-256 before every build and fails closed on a
mismatch. Updating the artifact, checksum, version, or compilation level is a
reviewed packaging change; never replace the jar in place.
