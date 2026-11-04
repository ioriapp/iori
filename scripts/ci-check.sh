#!/usr/bin/env bash
set -Eeuo pipefail
if grep -RFn --include="*.mjs" "[fake-model:" e2e verification | grep -v -e "^e2e/fake-model/marker.mjs:" -e "^verification/fake-model/server.mjs:"; then
  echo "偽モデルの印はfakeMarker helperを使ってください。" >&2
  exit 1
fi
pnpm install --frozen-lockfile --prefer-offline
if [[ "${1:-}" == "--docs-only" ]]; then
  node scripts/run-bounded-check.mjs pnpm format:check
  node scripts/run-bounded-check.mjs pnpm check:docs
  git diff --check HEAD
  exit 0
fi
node scripts/run-bounded-check.mjs pnpm check
node scripts/run-bounded-check.mjs pnpm lint
node scripts/run-bounded-check.mjs pnpm --filter @iori/host build:native
node scripts/run-bounded-check.mjs node scripts/terminal-daemon-compatibility.mjs
node scripts/run-bounded-check.mjs pnpm test
node scripts/run-bounded-check.mjs pnpm format:check
node scripts/run-bounded-check.mjs pnpm check:docs
node scripts/run-bounded-check.mjs pnpm --filter @iori/client build
node scripts/run-bounded-check.mjs cargo fmt --manifest-path Cargo.toml --all --check
node scripts/run-bounded-check.mjs cargo clippy --manifest-path Cargo.toml --workspace --all-targets --locked -- -D warnings
node scripts/run-bounded-check.mjs cargo test --manifest-path apps/client/src-tauri/Cargo.toml --lib host_setup::ssh:: --locked
node scripts/run-bounded-check.mjs cargo test --manifest-path apps/client/src-tauri/Cargo.toml --lib updates::release:: --locked
node scripts/run-bounded-check.mjs cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml --all --check
node scripts/run-bounded-check.mjs cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --workspace --locked -- -D warnings
git diff --check HEAD
