#!/usr/bin/env bash
# Compile and test every generated platform package with its own toolchain, the same from
# `just platforms` and from CI: Swift and Kotlin in their official images (pinned by digest, run as
# the calling user, removed on exit), Flutter from the official archive (pinned by SHA-256), Rust with
# the toolchain the crate pins. Each package is copied to a scratch directory first, so a toolchain
# never writes into the repository. Usage: check-platforms.sh [swift] [kotlin] [flutter] [rust]
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cache="${NDDEV_DS_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/opennetwork-design-system}"
mkdir -p "${cache}"

SWIFT_IMAGE='swift:6.4.1-noble@sha256:19cbe56bdaec1918f7cf5fdeba42b9bd55bdd8a6149c9990d0e0e3a89a127d63'
GRADLE_IMAGE='gradle:9.8.1-jdk21-noble@sha256:4e237c5918018409ae6bd4acf3e5145db22157fd5f2af6332a8f9fba88f8e92b'
FLUTTER_VERSION=3.47.7
FLUTTER_SHA256=af7455f540df951184c7953fbe3cf884766e7541dacf8571f9f582db03dd6230

scratch="$(mktemp -d "${TMPDIR:-/tmp}/opennetwork-platforms.XXXXXX")"
trap 'rm -rf "${scratch}"' EXIT

copy() { # package -> scratch copy
  rm -rf "${scratch:?}/$1"
  cp -r "${root}/packages/$1" "${scratch}/$1"
  printf '%s' "${scratch}/$1"
}

# Rootless container UID 0 maps to the calling host account; rootful uses its actual UID.
# The package is read-only and all build output stays in the container or owned cache.
run_image() { # image network package command...
  local image="$1" network="$2" package="$3"
  shift 3
  local user="$(id -u):$(id -g)"
  if docker info --format '{{json .SecurityOptions}}' | grep -q '"name=rootless"'; then
    user=0:0
  fi
  docker run --rm --network "${network}" --user "${user}" -e HOME=/tmp \
    -v "${root}/packages/${package}:/src:ro" "$@" "${image}" \
    bash -c 'mkdir -p /tmp/work && cp -r /src/. /tmp/work && cd /tmp/work && eval "$PLATFORM_CHECK"'
}

check_swift() {
  echo '== swift (Swift 6.4, Linux: values and tests; the SwiftUI bindings compile on Apple platforms)'
  run_image "${SWIFT_IMAGE}" none apple -e PLATFORM_CHECK='swift build -Xswiftc -warnings-as-errors && swift test'
}

check_kotlin() {
  echo '== kotlin (Kotlin 2.4.21, Compose Multiplatform Material 3 1.9.0, JDK 21)'
  mkdir -p "${cache}/gradle"
  run_image "${GRADLE_IMAGE}" bridge kotlin -e GRADLE_USER_HOME=/cache -v "${cache}/gradle:/cache" \
    -e PLATFORM_CHECK='gradle --no-daemon --warning-mode=fail -q build'
}

flutter_sdk() {
  # Reuse the exact prepared SDK when present; retain the pinned archive fallback.
  if [[ -n "${FLUTTER_ROOT:-}" && -x "${FLUTTER_ROOT}/bin/flutter" ]] &&
    "${FLUTTER_ROOT}/bin/flutter" --version --machine |
    grep -q '"frameworkVersion": "'"${FLUTTER_VERSION}"'"'; then
    printf '%s' "${FLUTTER_ROOT}"
    return
  fi
  local dir="${cache}/flutter-${FLUTTER_VERSION}"
  if [[ ! -x "${dir}/bin/flutter" ]]; then
    local archive tmp
    archive="$(mktemp "${cache}/flutter.XXXXXX")"
    tmp="$(mktemp -d "${cache}/flutter-extract.XXXXXX")"
    curl -fsSL --connect-timeout 15 --max-time 300 --retry 2 -o "${archive}" \
      "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
    echo "${FLUTTER_SHA256}  ${archive}" | sha256sum -c --quiet -
    tar -xJf "${archive}" -C "${tmp}"
    rm -f "${archive}"
    # Another job may have finished first; either copy is the same archive.
    mv -T "${tmp}/flutter" "${dir}" 2>/dev/null || rm -rf "${tmp}"
    rm -rf "${tmp}"
  fi
  printf '%s' "${dir}"
}

check_flutter() {
  echo "== flutter (Flutter ${FLUTTER_VERSION})"
  local sdk work
  sdk="$(flutter_sdk)"
  work="$(copy flutter)"
  export PUB_CACHE="${cache}/pub" FLUTTER_SUPPRESS_ANALYTICS=true CI=true
  # The SDK writes its own caches on first use; one job at a time.
  (
    flock 9
    cd "${work}"
    "${sdk}/bin/flutter" --version --suppress-analytics
    "${sdk}/bin/flutter" pub get --suppress-analytics
    "${sdk}/bin/flutter" analyze --fatal-infos --suppress-analytics
    "${sdk}/bin/flutter" test --suppress-analytics
  ) 9>"${cache}/flutter.lock"
}

check_rust() {
  echo '== rust (the toolchain of rust-toolchain.toml)'
  local work
  work="$(copy rust)"
  (
    cd "${work}"
    export CARGO_TARGET_DIR="${cache}/cargo-target"
    cargo --version
    cargo fmt --check
    cargo clippy --all-targets --all-features -- -D warnings
    cargo test
    cargo test --all-features
    RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --all-features
  )
}

targets=("$@")
[[ ${#targets[@]} -gt 0 ]] || targets=(swift kotlin flutter rust)
for target in "${targets[@]}"; do
  case "${target}" in
    swift | kotlin | flutter | rust) "check_${target}" ;;
    *)
      echo "unknown platform ${target} (swift, kotlin, flutter, rust)" >&2
      exit 2
      ;;
  esac
done
echo "platforms: ${targets[*]} pass"
