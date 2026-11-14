#!/usr/bin/env bash
# The container runner cannot bind-mount its checkout into the Docker daemon.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
# Buildx writes activity metadata; keep it within the checkout on restricted machines.
export BUILDX_CONFIG="${BUILDX_CONFIG:-$root/.local/docker-buildx}"
image_cache_args=()
check_args=""
while (( $# != 0 )); do
  case "$1" in
    --rebuild-image) image_cache_args+=(--no-cache) ;;
    # Markdown-only changes: format, document links and whitespace only.
    --docs-only) check_args=" --docs-only" ;;
    *)
      printf '使い方: bash scripts/ci.sh [--rebuild-image] [--docs-only]\n' >&2
      exit 2
      ;;
  esac
  shift
done
# Full runs on one machine share CPU with each other; overlapping them made
# Host API tests time out (#330). Run them one at a time; a lock that cannot be
# opened (a restricted sandbox) does not stop the check.
if [[ -z "$check_args" ]] && command -v flock >/dev/null &&
  exec {ci_lock}>>/tmp/iori-ci-full.lock 2>/dev/null; then
  if ! flock -n "$ci_lock"; then
    printf 'Waiting for another bash scripts/ci.sh on this machine\n' >&2
    flock "$ci_lock"
  fi
fi
started=$(date +%s)
node scripts/publish/check-forbidden.mjs --if-configured
# Concurrent worktrees own separate containers. The exit trap removes only ours.
evidence_root="${IORI_VERIFICATION_EVIDENCE_ROOT:-$root/.local/evidence}/ci"
mkdir -p "$evidence_root"
stage=$(mktemp -d "$root/.local/ci-XXXXXXXX")
out=$(mktemp -d "$evidence_root/run-XXXXXXXX")
if [[ -n "$check_args" ]]; then printf "docs-only\n" >"$out/mode.txt"; else printf "full\n" >"$out/mode.txt"; fi
cid=""
build_seconds=0
copy_seconds=0
run_seconds=0
cleanup() {
  local code=$?
  trap - EXIT
  if [[ -n "$cid" ]]; then
    docker logs "$cid" >"$out/container.log" 2>&1 || true
    mkdir -p "$root/.local/evidence/ui"
    docker cp "$cid:/work/.local/evidence/ui/." "$root/.local/evidence/ui/" 2>/dev/null || true
    docker rm -f "$cid" >/dev/null
  fi
  rm -rf "$stage"
  printf '{"exit":%s,"totalSeconds":%s,"imageSeconds":%s,"copySeconds":%s,"checkSeconds":%s}\n' \
    "$code" "$(( $(date +%s) - started ))" "$build_seconds" "$copy_seconds" "$run_seconds" >"$out/timing.json"
  cat "$out/timing.json"
  printf 'CI evidence: %s\n' "$out"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 143' TERM INT HUP
node_ver=$(sed -n 's/.*"node": ">=\([0-9][0-9]*\).*".*/\1/p' package.json)
pnpm_ver=$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json)
rust_ver=$(sed -n 's/^channel = "\([^"]*\)"/\1/p' rust-toolchain.toml)
playwright_ver=$(node --input-type=module -e 'import p from "./package.json" with {type:"json"}; console.log(p.devDependencies["@playwright/test"])')
# The image holds the browser of this Playwright version; other package.json edits keep it.
image_key=$({ cat scripts/ci.Dockerfile rust-toolchain.toml; printf '%s\n' "$playwright_ver"; } | sha256sum | cut -c1-16)
tag="iori-ci:node${node_ver}-pnpm${pnpm_ver}-${image_key}"
mkdir -p "$stage/context" "$stage/src"
cp scripts/ci.Dockerfile "$stage/context/Dockerfile"
timeout --kill-after=20s 900 docker build "${image_cache_args[@]}" --build-arg "NODE_VERSION=$node_ver" \
  --build-arg "PNPM_VERSION=$pnpm_ver" --build-arg "RUST_VERSION=$rust_ver" --build-arg "PLAYWRIGHT_VERSION=$playwright_ver" \
  -t "$tag" "$stage/context"
build_seconds=$(( $(date +%s) - started ))
copy_started=$(date +%s)
git rev-parse HEAD >"$out/source-sha.txt"
git status --short >"$out/source-dirty.txt"
# Copy tracked and untracked source, respecting .gitignore. No local cache or credentials.
git ls-files -z --cached --others --exclude-standard -- . | \
  while IFS= read -r -d '' path; do
    # Unstaged deletions remain in the index. Preserve dangling symlinks too.
    if [[ -e "$path" || -L "$path" ]]; then printf '%s\0' "$path"; fi
  done | tar --null -T - -cf - | tar -C "$stage/src" -xf -
# A linked worktree has only a .git pointer. Keep the repository data needed for
# git ls-files/diff without copying config, authentication or hooks.
mkdir -p "$stage/src/.git"
cp "$out/source-sha.txt" "$stage/src/.git/HEAD"
git_common=$(git rev-parse --path-format=absolute --git-common-dir)
cp -a "$git_common/objects" "$git_common/refs" "$stage/src/.git/"
if [[ -f "$git_common/packed-refs" ]]; then cp "$git_common/packed-refs" "$stage/src/.git/"; fi
index_file=$(git rev-parse --path-format=absolute --git-path index)
if [[ -f "$index_file" ]]; then cp "$index_file" "$stage/src/.git/index"; fi
# Cargo fingerprints source paths inside /work; isolate artifacts for each
# checkout so another worktree cannot supply a different local crate's build.
workspace_cache_key=$(printf '%s' "$root" | sha256sum | cut -d' ' -f1)
for volume in iori-ci-pnpm-store iori-ci-cargo-registry iori-ci-cargo-target; do
  docker volume create "$volume" >/dev/null
done
collect_active_cargo_target_keys() {
  local diagnostic_file=$1
  local container_ids container_id environment target_key
  local -a keys=()
  if ! container_ids=$(docker ps -q --filter label=org.iori.ci.workspace=bounded-check --filter status=running 2>"$diagnostic_file"); then
    return 1
  fi
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    if ! environment=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>>"$diagnostic_file"); then
      return 1
    fi
    while IFS= read -r variable; do
      if [[ "$variable" =~ ^CARGO_TARGET_DIR=/cargo-target/([a-f0-9]{64})$ ]]; then
        target_key=${BASH_REMATCH[1]}
        keys+=("$target_key")
      fi
    done <<< "$environment"
  done <<< "$container_ids"
  printf '%s\n' "${keys[@]}"
}
cleanup_cargo_targets() {
  local active_before active_after_output inventory cutoff now kind key value marker_path is_active result
  local active_after_key active_key spec mode target mtime bytes
  local -a active_keys=() active_after=() candidates=()
  if ! active_before=$(collect_active_cargo_target_keys "$stage/cargo-target-active-before.log"); then
    return 1
  fi
  while IFS= read -r active_key; do
    [[ -n "$active_key" ]] && active_keys+=("$active_key")
  done <<< "$active_before"
  if ! inventory=$(docker run --rm -v iori-ci-cargo-target:/cargo-target "$tag" bash -Eeuo pipefail -c '
    for target in /cargo-target/*; do
      [[ -d "$target" ]] || continue
      key=${target##*/}
      [[ "$key" =~ ^[a-f0-9]{64}$ ]] || continue
      marker="$target/.iori-worktree-path"
      if [[ -f "$marker" ]]; then
        path=$(cat "$marker")
        encoded=$(printf "%s" "$path" | base64 -w0)
        printf "marked\t%s\t%s\n" "$key" "$encoded"
      else
        printf "legacy\t%s\t%s\n" "$key" "$(stat -c "%Y" "$target")"
      fi
    done
  ' 2>"$stage/cargo-target-inventory.log"); then
    return 1
  fi
  if ! now=$(date +%s); then
    return 1
  fi
  cutoff=$((now - 172800))
  while IFS=$'\t' read -r kind key value; do
    [[ -n "$key" ]] || continue
    [[ "$key" =~ ^[a-f0-9]{64}$ ]] || return 1
    [[ "$key" == "$workspace_cache_key" ]] && continue
    is_active=0
    for active_key in "${active_keys[@]}"; do
      if [[ "$active_key" == "$key" ]]; then
        is_active=1
        break
      fi
    done
    if (( is_active )); then
      continue
    fi
    case "$kind" in
      marked)
        if ! marker_path=$(printf '%s' "$value" | base64 --decode 2>"$stage/cargo-target-path-decode.log"); then
          return 1
        fi
        [[ "$marker_path" == /* ]] || continue
        if [[ ! -e "$marker_path" ]]; then candidates+=("M$key"); fi
        ;;
      legacy)
        [[ "$value" =~ ^[0-9]+$ ]] || return 1
        if (( value <= cutoff )); then candidates+=("L$key"); fi
        ;;
      *) return 1 ;;
    esac
  done <<< "$inventory"
  if ! active_after_output=$(collect_active_cargo_target_keys "$stage/cargo-target-active-after.log"); then
    return 1
  fi
  while IFS= read -r active_after_key; do
    [[ -n "$active_after_key" ]] && active_after+=("$active_after_key")
  done <<< "$active_after_output"
  if ! result=$(docker run --rm -v iori-ci-cargo-target:/cargo-target "$tag" bash -Eeuo pipefail -c '
    current_key=$1
    worktree_path=$2
    cutoff=$3
    shift 3
    active_keys=()
    while (( $# != 0 )) && [[ "$1" != -- ]]; do
      active_keys+=("$1")
      shift
    done
    if (( $# != 0 )); then shift; fi
    candidates=("$@")
    is_active_key() {
      local candidate=$1 active
      for active in "${active_keys[@]}"; do
        [[ "$active" == "$candidate" ]] && return 0
      done
      return 1
    }
    mkdir -p "/cargo-target/$current_key"
    printf "%s\n" "$worktree_path" >"/cargo-target/$current_key/.iori-worktree-path"
    removed=0
    removed_bytes=0
    for spec in "${candidates[@]}"; do
      [[ "$spec" =~ ^[ML][a-f0-9]{64}$ ]] || exit 1
      mode=${spec:0:1}
      key=${spec:1}
      [[ "$key" == "$current_key" ]] && continue
      is_active_key "$key" && continue
      target="/cargo-target/$key"
      [[ -d "$target" ]] || continue
      marker="$target/.iori-worktree-path"
      if [[ "$mode" == L ]]; then
        [[ ! -e "$marker" ]] || continue
        mtime=$(stat -c "%Y" "$target")
        (( mtime <= cutoff )) || continue
      else
        [[ -f "$marker" ]] || continue
      fi
      bytes=$(du -sb -- "$target" | cut -f1)
      rm -rf -- "$target"
      removed=$((removed + 1))
      removed_bytes=$((removed_bytes + bytes))
    done
    printf "CI Cargo target cleanup: removed=%s size=%s bytes\n" "$removed" "$removed_bytes"
  ' bash "$workspace_cache_key" "$root" "$cutoff" "${active_after[@]}" -- "${candidates[@]}" 2>"$stage/cargo-target-remove.log"); then
    return 1
  fi
  [[ "$result" == CI\ Cargo\ target\ cleanup:* ]] || return 1
  printf '%s\n' "$result"
}
if ! cleanup_cargo_targets; then
  printf 'CI Cargo target cleanup: warning: cleanup failed\n'
fi
cid=$(docker create --label org.iori.ci.workspace=bounded-check --memory 8g --memory-swap 8g \
  -w /work -e CI=true -e npm_config_store_dir=/pnpm/store -e pnpm_config_store_dir=/pnpm/store \
  -e CARGO_TARGET_DIR="/cargo-target/$workspace_cache_key" -e CARGO_BUILD_JOBS=2 \
  -v iori-ci-pnpm-store:/pnpm/store \
  -v iori-ci-cargo-registry:/opt/cargo/registry \
  -v iori-ci-cargo-target:/cargo-target \
  "$tag" bash -Eeuo pipefail -c "git config --global --add safe.directory /work; timeout --kill-after=20s 900 bash scripts/ci-check.sh$check_args")
docker cp "$stage/src/." "$cid:/work/"
copy_seconds=$(( $(date +%s) - copy_started ))
run_started=$(date +%s)
docker start "$cid" >/dev/null
docker wait "$cid" >"$stage/exit-code" &
wait $!
run_seconds=$(( $(date +%s) - run_started ))
docker logs "$cid"
exit "$(cat "$stage/exit-code")"
