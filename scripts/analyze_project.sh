#!/usr/bin/env bash
# =============================================================================
# analyze_project.sh — Android project structure validator
# Sourced by build.sh — do not execute directly
# =============================================================================

_ap_log()  { echo -e "${CYAN:-}[analyze]${RESET:-} $*"; }
_ap_warn() { echo -e "${YELLOW:-}[analyze WARN]${RESET:-} $*"; }
_ap_die()  { echo -e "${RED:-}[analyze FAIL]${RESET:-} $*" >&2; exit 1; }

# =============================================================================
# analyze_project <project_dir>
#   Sets PROJECT_DIR (confirmed), PROJECT_TYPE, PROJECT_NAME
# =============================================================================
analyze_project() {
    local dir="${1:?project dir required}"
    _ap_log "Analysing: $dir"

    # ── 1. Detect project type ────────────────────────────────────────────────
    _detect_project_type "$dir"

    # ── 2. Check build-readiness ─────────────────────────────────────────────
    _check_build_readiness "$dir"

    # ── 3. Extract metadata ───────────────────────────────────────────────────
    _extract_metadata "$dir"

    # ── 4. Validate Gradle wrapper ────────────────────────────────────────────
    _validate_gradle_wrapper "$dir"

    # ── 5. Resolve compileSdk / targetSdk ────────────────────────────────────
    _resolve_sdk_versions "$dir"

    _ap_log "Analysis complete. Project: $PROJECT_NAME | Type: $PROJECT_TYPE"
}

# ─── Detect Android Native / Kotlin / Java ───────────────────────────────────
_detect_project_type() {
    local dir="$1"
    PROJECT_TYPE="UNKNOWN"

    if [[ -f "$dir/build.gradle" || -f "$dir/build.gradle.kts" ]]; then
        PROJECT_TYPE="ANDROID_NATIVE"
    else
        # Check subdirectories (monorepo / nested project layout)
        if find "$dir" -maxdepth 3 \
                \( -name "build.gradle" -o -name "build.gradle.kts" \) \
                -print -quit 2>/dev/null | grep -q .; then
            PROJECT_TYPE="ANDROID_NATIVE"
        fi
    fi

    if [[ "$PROJECT_TYPE" == "UNKNOWN" ]]; then
        _ap_die "$(python3 - <<'EOF'
import json
print(json.dumps({
  "status": "FAILED",
  "apk": [], "aab": [],
  "logs_summary": "Project is not build-ready",
  "errors": ["No build.gradle or build.gradle.kts found — not an Android/Gradle project"]
}, indent=2))
EOF
)"
    fi

    # Kotlin vs Java
    if find "$dir" -name "*.kt" -print -quit 2>/dev/null | grep -q .; then
        PROJECT_TYPE="${PROJECT_TYPE}_KOTLIN"
    elif find "$dir" -name "*.java" -print -quit 2>/dev/null | grep -q .; then
        PROJECT_TYPE="${PROJECT_TYPE}_JAVA"
    fi

    _ap_log "Project type: $PROJECT_TYPE"
}

# ─── Check build-readiness ────────────────────────────────────────────────────
_check_build_readiness() {
    local dir="$1"
    local missing=()

    # settings.gradle / settings.gradle.kts
    if [[ ! -f "$dir/settings.gradle" && ! -f "$dir/settings.gradle.kts" ]]; then
        missing+=("settings.gradle")
    fi

    # gradlew
    if [[ ! -f "$dir/gradlew" ]]; then
        missing+=("gradlew")
    fi

    # app module
    if [[ ! -d "$dir/app" ]]; then
        _ap_warn "No 'app' module at root — scanning for module directories..."
        local app_mod
        app_mod=$(find "$dir" -maxdepth 3 -name "build.gradle" \
                  | xargs -I{} dirname {} \
                  | grep -v "^$dir$" | head -1 || true)
        if [[ -z "$app_mod" ]]; then
            missing+=("app module")
        else
            _ap_warn "Using module: $app_mod"
        fi
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        local msg="Project is not build-ready. Missing: ${missing[*]}"
        _ap_die "$(python3 - <<EOF
import json
print(json.dumps({
  "status": "FAILED",
  "apk": [], "aab": [],
  "logs_summary": "$msg",
  "errors": $(printf '%s\n' "${missing[@]}" | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin]))")
}, indent=2))
EOF
)"
    fi

    _ap_log "Build-readiness check passed."
}

# ─── Extract project metadata ─────────────────────────────────────────────────
_extract_metadata() {
    local dir="$1"
    PROJECT_DIR="$dir"
    PROJECT_NAME="$(basename "$dir")"

    # applicationId / versionName: module build file (Groovy or Kotlin DSL) first, then the
    # SimpleTools app-factory file (simpletools.properties), where the identity lives for
    # projects built from the shared template (the module file only holds the code namespace).
    local app_gradle app_id="" version_name=""
    app_gradle=$(_find_app_gradle "$dir")

    if [[ -n "$app_gradle" && -f "$app_gradle" ]]; then
        app_id=$(grep -oP 'applicationId\s*=?\s*["'"'"']\K[^"'"'"']+' "$app_gradle" | head -1 || true)
        version_name=$(grep -oP 'versionName\s*=?\s*["'"'"']\K[^"'"'"']+' "$app_gradle" | head -1 || true)
    fi
    local props="$dir/simpletools.properties"
    if [[ -f "$props" ]]; then
        [[ -z "$app_id" ]] && app_id=$(grep -oP '^app\.applicationId\s*=\s*\K\S+' "$props" | head -1 || true)
        [[ -z "$version_name" ]] && version_name=$(grep -oP '^app\.versionName\s*=\s*\K\S+' "$props" | head -1 || true)
    fi
    [[ -n "$app_id" ]] && _ap_log "applicationId: $app_id"
    [[ -n "$version_name" ]] && _ap_log "versionName: $version_name"
}

# ─── Validate Gradle wrapper integrity ───────────────────────────────────────
_validate_gradle_wrapper() {
    local dir="$1"

    # Ensure wrapper properties exist
    local props="$dir/gradle/wrapper/gradle-wrapper.properties"
    if [[ ! -f "$props" ]]; then
        _ap_warn "gradle-wrapper.properties not found — Gradle version unknown."
        return
    fi

    local gradle_version
    gradle_version=$(grep -oP "gradle-\K[\d.]+" "$props" | head -1 || echo "unknown")
    _ap_log "Gradle wrapper version: $gradle_version"

    # Ensure the JAR is present
    if [[ ! -f "$dir/gradle/wrapper/gradle-wrapper.jar" ]]; then
        _ap_warn "gradle-wrapper.jar missing — attempting to restore from Gradle cache."
        local cached_jar
        cached_jar=$(find "$HOME/.gradle/wrapper/dists" -name "gradle-wrapper.jar" \
                     -print -quit 2>/dev/null || true)
        if [[ -n "$cached_jar" ]]; then
            cp "$cached_jar" "$dir/gradle/wrapper/gradle-wrapper.jar"
            _ap_log "Restored gradle-wrapper.jar from cache."
        else
            _ap_warn "Could not restore gradle-wrapper.jar — build may fail."
        fi
    fi
}

# ─── Resolve SDK versions from build.gradle ──────────────────────────────────
_resolve_sdk_versions() {
    local dir="$1"
    local app_gradle
    app_gradle=$(_find_app_gradle "$dir")
    [[ -z "$app_gradle" || ! -f "$app_gradle" ]] && return

    # Groovy ("compileSdk 36") and Kotlin DSL ("compileSdk = 36") are both accepted.
    # Values missing from the module file (version catalog, convention plugin) fall back
    # to gradle/libs.versions.toml, then to the historical defaults.
    local toml="$dir/gradle/libs.versions.toml"
    COMPILE_SDK=$(_sdk_value "$app_gradle" "$toml" compileSdk 34)
    MIN_SDK=$(_sdk_value "$app_gradle" "$toml" minSdk 21)
    TARGET_SDK=$(_sdk_value "$app_gradle" "$toml" targetSdk 34)

    export COMPILE_SDK MIN_SDK TARGET_SDK
    _ap_log "compileSdk=$COMPILE_SDK  minSdk=$MIN_SDK  targetSdk=$TARGET_SDK"

    # Inject required platform into SDK_PACKAGES for setup_env.sh to install
    if [[ "${SDK_PACKAGES[*]:-}" != *"platforms;android-${COMPILE_SDK}"* ]]; then
        SDK_PACKAGES+=("platforms;android-${COMPILE_SDK}")
    fi
}

# ─── Locate the application module's Gradle file (Groovy or Kotlin DSL) ───────
_find_app_gradle() {
    local dir="$1" f
    for f in "$dir/app/build.gradle" "$dir/app/build.gradle.kts"; do
        [[ -f "$f" ]] && { echo "$f"; return; }
    done
    find "$dir" -maxdepth 4 \( -name "build.gradle" -o -name "build.gradle.kts" \) -print0 2>/dev/null \
        | xargs -0 grep -l "com.android.application\|applicationId" 2>/dev/null | head -1 || true
}

# ─── Strip full-line and trailing comments (Groovy/Kotlin "//", block "/* */" on one line, TOML "#") ─
_strip_comments() {
    sed -E -e 's@/\*[^*]*\*+([^/*][^*]*\*+)*/@@g' \
           -e 's@^[[:space:]]*//.*$@@' \
           -e 's@[[:space:]]//.*$@@' \
           -e 's@^[[:space:]]*#.*$@@' "$1" 2>/dev/null || true
}

# ─── Read an SDK level: literal in module file, else version catalog, else default ─
#   Accepts: compileSdk 36 | compileSdk = 36 | compileSdkVersion(36) | compileSdk { version = release(36) { ... } }
_sdk_value() {
    local gradle="$1" toml="$2" key="$3" default="$4" v="" body=""
    body=$(_strip_comments "$gradle")
    v=$(printf '%s\n' "$body" | grep -oP "${key}(Version)?\s*=?\s*(\(\s*)?\K\d+" | head -1 || true)
    if [[ -z "$v" && "$key" == "compileSdk" ]]; then
        v=$(printf '%s\n' "$body" | grep -oP "version\s*=\s*release\(\s*\K\d+" | head -1 || true)
    fi
    if [[ -z "$v" && -f "$toml" ]]; then
        v=$(_strip_comments "$toml" | grep -oP "^${key}\s*=\s*\"\K\d+" | head -1 || true)
    fi
    echo "${v:-$default}"
}
