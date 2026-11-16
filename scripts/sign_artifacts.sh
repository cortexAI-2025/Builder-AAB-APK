#!/usr/bin/env bash
# Trusted post-build signing helpers. Never source/run inside untrusted Gradle.
# Call explicitly with an owner-authorized key; no automatic production key.
_sign_die() { echo '[sign FAIL] Signing or verification failed' >&2; return 1; }
_sign_config() {
    [[ "${SIGNING_AUTHORIZED:-}" == true && -f "${KEYSTORE_PATH:-}" && -n "${KEYSTORE_ALIAS:-}" && -n "${KEYSTORE_PASS:-}" ]] || return 1
    export KEYSTORE_PASS KEY_PASS="${KEY_PASS:-$KEYSTORE_PASS}"
}
sign_apk() (
    set +x
    set -euo pipefail
    _sign_config || { _sign_die; exit 1; }
    local apk="$1" tool="${APKSIGNER_PATH:-apksigner}"
    [[ -f "$apk" && ! -L "$apk" ]] || exit 1
    # apksigner signs in-place; failures never authorize delivery.
    "$tool" sign --ks "$KEYSTORE_PATH" --ks-key-alias "$KEYSTORE_ALIAS" \
        --ks-pass env:KEYSTORE_PASS --key-pass env:KEY_PASS "$apk" >/dev/null 2>&1 || { _sign_die; exit 1; }
    "$tool" verify --verbose "$apk" >/dev/null 2>&1 || { _sign_die; exit 1; }
)
sign_aab() (
    set +x
    set -euo pipefail
    _sign_config || { _sign_die; exit 1; }
    local aab="$1" verifier
    verifier="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/verify_artifacts.py"
    [[ -f "$aab" && ! -L "$aab" ]] || exit 1
    jarsigner -keystore "$KEYSTORE_PATH" -storepass:env KEYSTORE_PASS -keypass:env KEY_PASS \
        "$aab" "$KEYSTORE_ALIAS" >/dev/null 2>&1 || { _sign_die; exit 1; }
    python3 "$verifier" "$aab" >/dev/null 2>&1 || { _sign_die; exit 1; }
)
