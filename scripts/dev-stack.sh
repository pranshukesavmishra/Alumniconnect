#!/usr/bin/env bash
# Brings up everything the end-to-end tests need: Docker, local Supabase, and the Edge Functions server.
# Usage: scripts/dev-stack.sh        (idempotent: safe to run again)
set -uo pipefail
cd "$(dirname "$0")/.."
export SUPABASE_INTERNAL_IMAGE_REGISTRY=${SUPABASE_INTERNAL_IMAGE_REGISTRY:-docker.io}
CLI="npx --yes supabase@2.120.0"

if ! docker info >/dev/null 2>&1; then
  (dockerd > /tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

# realtime and the dashboard tools are not needed for tests (the app falls back to polling without realtime)
ok=0
for _ in $(seq 1 8); do   # after a restart the database container needs a little while to become ready
  if $CLI start -x vector,logflare,imgproxy,supavisor,studio,postgres-meta,realtime >/tmp/supabase-start.log 2>&1; then ok=1; break; fi
  grep -q "not ready\|already running" /tmp/supabase-start.log || break
  grep -q "already running" /tmp/supabase-start.log && { ok=1; break; }
  sleep 10
done
[ $ok = 1 ] || { echo "supabase start failed, see /tmp/supabase-start.log"; tail -5 /tmp/supabase-start.log; exit 1; }

# serve every function in supabase/functions (the runtime started by 'start' only knows functions present at start time)
KEY=$($CLI status -o env 2>/dev/null | grep '^ANON_KEY' | cut -d'"' -f2)
probe() { curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/import-avatar -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -d '{}'; }
if [ "$(probe)" != "401" ]; then
  (nohup $CLI functions serve > /tmp/functions-serve.log 2>&1 &)
  for _ in $(seq 1 60); do [ "$(probe)" = "401" ] && break; sleep 2; done
fi
echo "stack ready: db=54322 api=54321 mail=54324 functions=$( [ "$(probe)" = "401" ] && echo up || echo DOWN )"
