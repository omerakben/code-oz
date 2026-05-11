#!/bin/sh

fail() {
  echo "install.sh: $1" >&2
  exit 1
}

warn() {
  echo "install.sh: warning: $1" >&2
}

print_usage() {
  cat <<'EOF'
usage: install.sh [--version TAG] [--help]

  --version TAG   pin to release tag (e.g. v0.20.0-alpha.0). Default: latest.
                  Reserved for network-mode (curl|sh) fetches; ignored when
                  install.sh is run from an unpacked bundle.
  --help, -h      print this message and exit.

environment overrides:
  CODE_OZ_INSTALL_DIR   install destination (default: $HOME/.local/bin)
  CODE_OZ_SHA_TOOL      force SHA256 tool: sha256sum | shasum | openssl
                        (test-only; auto-detected when unset)
  OS_OVERRIDE           override host OS detection
  ARCH_OVERRIDE         override host arch detection
EOF
}

parse_target() {
  manifest_path="$1"
  want_os="$2"
  want_arch="$3"
  field="$4"
  awk -v want_os="$want_os" -v want_arch="$want_arch" -v field="$field" '
    BEGIN { in_t = 0; obj = "" }
    /^[[:space:]]*\{[[:space:]]*$/ { in_t = 1; obj = ""; next }
    in_t && /^[[:space:]]*\}[[:space:]]*[,]?[[:space:]]*$/ {
      gsub(/\\\"/, "QQ", obj)
      if (match(obj, "\"os\":[[:space:]]*\""want_os"\"") &&
          match(obj, "\"arch\":[[:space:]]*\""want_arch"\"")) {
        if (match(obj, "\""field"\":[[:space:]]*\"[^\"]*\"")) {
          s = substr(obj, RSTART, RLENGTH)
          sub(/^[^"]*"[^"]*":[[:space:]]*"/, "", s)
          sub(/"$/, "", s)
          gsub(/QQ/, "\"", s)
          print s
          exit
        }
        if (match(obj, "\""field"\":[[:space:]]*[0-9]+")) {
          s = substr(obj, RSTART, RLENGTH)
          sub(/^[^:]*:[[:space:]]*/, "", s)
          print s
          exit
        }
      }
      in_t = 0; obj = ""; next
    }
    in_t { obj = obj " " $0 }
  ' "$manifest_path"
}

# Tagged-release URL constants. Network-mode (curl|sh) fetch logic lands with
# the release workflow (W3a release.yml); kept here so flag parsing and asset
# naming stay coherent across install.sh + npm wrapper + Homebrew formula.
GH_OWNER="omerakben"
GH_REPO="code-oz"
RELEASE_VERSION="${CODE_OZ_RELEASE_VERSION:-latest}"

# Parse CLI flags.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ -n "${2:-}" ] || fail "--version requires a tag argument"
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --version=*)
      RELEASE_VERSION="${1#*=}"
      shift
      ;;
    --help | -h)
      print_usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

# Resolve SHA256 tool. The chain is sha256sum (Linux primary), shasum -a 256
# (macOS primary), openssl dgst -sha256 (cross-platform fallback). Fail closed
# when none is present rather than silently skipping integrity verification.
# CODE_OZ_SHA_TOOL is a test-only override; production leaves it unset.
sha_tool="${CODE_OZ_SHA_TOOL:-auto}"
if [ "$sha_tool" = "auto" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha_tool="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    sha_tool="shasum"
  elif command -v openssl >/dev/null 2>&1; then
    sha_tool="openssl"
  else
    sha_tool="none"
  fi
fi

case "$sha_tool" in
  sha256sum | shasum | openssl)
    ;;
  none)
    fail "no SHA256 tool found (sha256sum, shasum, or openssl). Refusing to install without integrity verification. Install one of these tools and retry."
    ;;
  *)
    fail "invalid CODE_OZ_SHA_TOOL override: $sha_tool (allowed: sha256sum, shasum, openssl)"
    ;;
esac

compute_sha256() {
  case "$sha_tool" in
    sha256sum) sha256sum "$1" | awk '{print $1}' ;;
    shasum) shasum -a 256 "$1" | awk '{print $1}' ;;
    openssl) openssl dgst -sha256 "$1" | awk '{print $NF}' ;;
  esac
}

script_dir="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$script_dir/manifest.json" ]; then
  bundle_root="$script_dir"
elif [ -f "$script_dir/../dist/handoff/manifest.json" ]; then
  bundle_root="$(cd "$script_dir/../dist/handoff" && pwd)"
else
  fail "cannot find manifest.json relative to $script_dir. Network-mode fetch (curl|sh) lands with the W3a release workflow; for now, run install.sh from an unpacked bundle."
fi

raw_os="${OS_OVERRIDE:-$(uname -s)}"
os="$(printf '%s' "$raw_os" | tr '[:upper:]' '[:lower:]')"
raw_arch="${ARCH_OVERRIDE:-$(uname -m)}"

case "$os" in
  darwin | linux)
    ;;
  *)
    fail "unsupported OS: $os. Supported: darwin, linux. Windows is deferred to v0.20.1."
    ;;
esac

case "$raw_arch" in
  arm64 | aarch64)
    arch="arm64"
    ;;
  x86_64 | x64)
    arch="x64"
    ;;
  *)
    fail "unsupported architecture: $raw_arch. Supported: arm64, aarch64, x86_64."
    ;;
esac

manifest_path="$bundle_root/manifest.json"
binary_relative_path="$(parse_target "$manifest_path" "$os" "$arch" "binaryRelativePath")"
sha256="$(parse_target "$manifest_path" "$os" "$arch" "sha256")"
size_bytes="$(parse_target "$manifest_path" "$os" "$arch" "sizeBytes")"
version="$(parse_target "$manifest_path" "$os" "$arch" "version")"

if [ -z "$binary_relative_path" ] || [ -z "$sha256" ] || [ -z "$size_bytes" ] || [ -z "$version" ]; then
  fail "no matching target row in manifest.json for $os-$arch"
fi

binary_src="$bundle_root/$binary_relative_path"
if [ ! -f "$binary_src" ]; then
  fail "binary file missing at $binary_src"
fi

actual_size="$(wc -c < "$binary_src" | awk '{print $1}')"
if [ "$actual_size" != "$size_bytes" ]; then
  fail "size mismatch for $binary_relative_path: manifest $size_bytes, actual $actual_size"
fi

actual_sha256="$(compute_sha256 "$binary_src")"
if [ -z "$actual_sha256" ]; then
  fail "sha256 computation produced empty output using $sha_tool"
fi
if [ "$actual_sha256" != "$sha256" ]; then
  fail "sha256 mismatch for $binary_relative_path: manifest $sha256, actual $actual_sha256"
fi

install_dir="${CODE_OZ_INSTALL_DIR:-$HOME/.local/bin}"
if ! mkdir -p "$install_dir"; then
  fail "cannot create install dir $install_dir"
fi

if ! cp "$binary_src" "$install_dir/code-oz"; then
  fail "cannot copy binary to $install_dir/code-oz"
fi

if ! chmod +x "$install_dir/code-oz"; then
  fail "cannot mark $install_dir/code-oz executable"
fi

if [ "$os" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$install_dir/code-oz" 2>/dev/null || true
fi

echo "code-oz installed at $install_dir/code-oz (version $version)"

PRINT_PATH_HINT=0
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) PRINT_PATH_HINT=1 ;;
esac

if [ "$PRINT_PATH_HINT" = "1" ]; then
  echo "PATH hint: $install_dir is not on PATH."
  echo "Add this line to the shell rc file you use (~/.zshrc or ~/.bashrc):"
  echo "export PATH=\"$install_dir:\$PATH\""
fi
