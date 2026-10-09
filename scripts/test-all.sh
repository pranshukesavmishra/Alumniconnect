#!/usr/bin/env bash
# Every check, in order: types, lint, unit, production build, database suites, browser end-to-end suites.
# Needs the local stack (scripts/dev-stack.sh). Prints one PASS/FAIL line per layer; exits non-zero on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."
export PW_CHROMIUM=${PW_CHROMIUM:-/opt/pw-browsers/chromium}
fail=0
step() { # name, command...
  local name=$1; shift
  if out=$("$@" 2>&1); then echo "PASS  $name"; else echo "FAIL  $name"; echo "$out" | tail -25; fail=1; fi
}
serve() { # port, command... : start a server in the background unless the port already answers
  local port=$1; shift
  curl -s -o /dev/null "http://localhost:$port/" && return
  (nohup "$@" > "/tmp/serve-$port.log" 2>&1 &)
  for _ in $(seq 1 90); do curl -s -o /dev/null "http://localhost:$port/" && return; sleep 1; done
}

step "typecheck" npx tsc -b
step "lint" npx oxlint src
step "unit tests" npx vitest run
step "production build" npm run build
step "database suites" scripts/db-test.sh
DENO=${DENO:-$(command -v deno || echo /tmp/denobin/node_modules/.bin/deno)}
if [ -x "$DENO" ]; then
  step "edge functions: unit" "$DENO" test --allow-env --no-check supabase/functions/_shared/webpush.test.ts supabase/functions/import-avatar/index.test.ts
  step "edge functions: push through the real stack" "$DENO" test --allow-all --no-check supabase/functions/push-send/integration.test.ts
else
  echo "SKIP  edge function tests (install Deno: npm i -g deno)"
fi

serve 5190 npx vite preview --port 5190 --strictPort
for p in 5181 5182 5183 5185; do serve $p npx vite --port $p --strictPort; done
step "e2e: main flows" npx playwright test e2e/meet.spec.ts e2e/reunion-registration.spec.ts e2e/community.spec.ts e2e/chat.spec.ts e2e/chat-rich.spec.ts e2e/chat-moderation.spec.ts e2e/profile-photo.spec.ts e2e/admin-community.spec.ts e2e/admin-command-centre.spec.ts e2e/admin-members.spec.ts e2e/admin-event-ops.spec.ts e2e/admin-roles.spec.ts e2e/admin-reliability.spec.ts e2e/admin-layout.spec.ts e2e/offline-ticket.spec.ts e2e/push.spec.ts e2e/jobs.spec.ts e2e/help.spec.ts e2e/analytics.spec.ts e2e/programme.spec.ts e2e/mentorship.spec.ts e2e/businesses.spec.ts e2e/location.spec.ts e2e/trips-meetups.spec.ts
for c in meet admin community linkedin; do step "e2e: verify $c" npx playwright test --config "e2e/verify/playwright.$c.config.ts"; done

exit $fail
