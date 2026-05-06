#!/usr/bin/env bash
# Run a SQL file (or inline SQL via stdin) against the linked Supabase
# project's database via the Management API.
#
# Requirements:
#   .env.local must define SUPABASE_PROJECT_REF and SUPABASE_PAT
#
# Usage:
#   ./scripts/sql.sh path/to/file.sql
#   echo "select 1" | ./scripts/sql.sh -

set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env.local ]] || { echo "missing .env.local" >&2; exit 1; }
# shellcheck disable=SC2046,SC1091
export $(grep -E '^(SUPABASE_PROJECT_REF|SUPABASE_PAT)=' .env.local | xargs -I{} echo {})

[[ -n "${SUPABASE_PROJECT_REF:-}" ]] || { echo "SUPABASE_PROJECT_REF not set in .env.local" >&2; exit 1; }
[[ -n "${SUPABASE_PAT:-}" ]] || { echo "SUPABASE_PAT not set in .env.local" >&2; exit 1; }

input=${1:-}
if [[ -z "$input" ]]; then
  echo "usage: $0 <file.sql>  (or '-' for stdin)" >&2
  exit 2
fi

if [[ "$input" == "-" ]]; then
  query=$(cat)
else
  [[ -f "$input" ]] || { echo "file not found: $input" >&2; exit 1; }
  query=$(cat "$input")
fi

# Build JSON payload safely using jq
payload=$(jq -nc --arg q "$query" '{query: $q}')

response=$(curl -sS -X POST \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  --data "$payload")

# pretty-print response if jq present, else raw
if command -v jq >/dev/null 2>&1; then
  echo "$response" | jq .
else
  echo "$response"
fi
