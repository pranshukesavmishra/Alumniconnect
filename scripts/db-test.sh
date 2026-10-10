#!/usr/bin/env bash
# Runs the database migrations and tests against a throwaway Supabase Postgres container.
# Usage: scripts/db-test.sh            (needs Docker)
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=${DB_TEST_NAME:-jec-db-test}
PORT=${DB_TEST_PORT:-54329}
IMAGE=${DB_TEST_IMAGE:-supabase/postgres:17.6.1.011}
export PGPASSWORD=postgres

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "$PORT":5432 "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 90); do
  psql -h localhost -p "$PORT" -U postgres -Atc "select 1" >/dev/null 2>&1 && break
  sleep 1
done

psql_run() { psql -h localhost -p "$PORT" -v ON_ERROR_STOP=1 -q "$@"; }

psql_run -U supabase_admin -d postgres -f supabase/tests/00_test_prelude.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  # DB_TEST_CRLF=1 applies every migration with Windows line endings, as `supabase db push` sees them after a Windows git pull
  if [ "${DB_TEST_CRLF:-}" = 1 ]; then sed 's/$/\r/' "$f" | psql_run -U postgres -f -; else psql_run -U postgres -f "$f"; fi
done
psql_run -U postgres -f supabase/seed.sql
for f in supabase/tests/[1-9]*.sql; do
  echo "test: $f"
  psql_run -U postgres -At -f "$f"
done
