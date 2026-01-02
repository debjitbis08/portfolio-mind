#!/bin/bash
# Wrapper script to run Supabase CLI with access token from .env
# Usage: ./scripts/sb.sh <supabase-command> [args...]

set -e

# Load .env file
if [ -f .env ]; then
  export $(grep -E '^SUPABASE_ACCESS_TOKEN=' .env | xargs)
fi

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "Error: SUPABASE_ACCESS_TOKEN not found in .env"
  exit 1
fi

# Run supabase with all passed arguments
exec npx supabase "$@"
