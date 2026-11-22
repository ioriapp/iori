#!/usr/bin/env bash
set -Eeuo pipefail
exec node scripts/ci-run-steps.mjs "$@"
