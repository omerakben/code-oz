#!/bin/sh

fail() {
  echo "install.sh: $1" >&2
  exit 1
}

warn() {
  echo "install.sh: warning: $1" >&2
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

script_dir="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$script_dir/manifest.json" ]; then
  bundle_root="$script_dir"
elif [ -f "$script_dir/../dist/handoff/manifest.json" ]; then
  bundle_root="$(cd "$script_dir/../dist/handoff" && pwd)"
else
  fail "cannot find manifest.json relative to $script_dir"
fi

raw_os="${OS_OVERRIDE:-$(uname -s)}"
os="$(printf '%s' "$raw_os" | tr '[:upper:]' '[:lower:]')"
raw_arch="${ARCH_OVERRIDE:-$(uname -m)}"

if [ "$os" != "darwin" ]; then
  fail "only Darwin is supported for W3-lite (macOS); detected $os. Linux/Windows targets land in formal W3.1."
fi

case "$raw_arch" in
  arm64 | aarch64)
    arch="arm64"
    ;;
  x86_64)
    arch="x64"
    ;;
  *)
    fail "unsupported architecture $raw_arch. Supported architectures are arm64, aarch64, and x86_64."
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

if command -v shasum >/dev/null 2>&1; then
  actual_sha256="$(shasum -a 256 "$binary_src" | awk '{print $1}')"
  if [ "$actual_sha256" != "$sha256" ]; then
    fail "sha256 mismatch for $binary_relative_path: manifest $sha256, actual $actual_sha256"
  fi
else
  warn "shasum not found; skipping sha256 verification"
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

if command -v xattr >/dev/null 2>&1; then
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
