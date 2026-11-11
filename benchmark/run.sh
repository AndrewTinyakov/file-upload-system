#!/usr/bin/env bash
set -euo pipefail
cli="$(dirname "$0")/src/cli.mjs"
case "${1:-}" in
  stop|help|--help|-h) exec node "$cli" "$@";;
esac
args=(run --scenario "${1:-smoke}")
if (( $# >= 2 )); then args+=(--name "$2"); fi
if (( $# > 2 )); then echo 'Use npm run bench -- --help for usage.' >&2; exit 2; fi
exec node "$cli" "${args[@]}"
