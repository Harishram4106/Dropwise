#!/usr/bin/env bash
# The live calls for the demo video, one scene at a time. Press Enter to run each scene.
# Needs the stack up (docker compose up) with Bifrost holding your Anthropic key. This script never sees the key.
# Cost: about $0.03 at the very most (Opus is called once; the repeat is a cache hit). Every call writes a receipt.
set -euo pipefail
GW="${GATEWAY_URL:-http://localhost:8088}"
KEY="${DEMO_KEY:-team-search}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
pause() { printf '\n[Enter to run] '; read -r _; }

call() { # call <model> <prompt> [extra curl args...]
  local model="$1" prompt="$2"; shift 2
  local body; body=$(python3 -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"max_tokens":1024,"messages":[{"role":"user","content":sys.argv[2]}]}))' "$model" "$prompt")
  curl -s -D /tmp/dropwise-demo.h -o /tmp/dropwise-demo.b "$GW/v1/chat/completions" \
    -H 'content-type: application/json' -H "x-dropwise-key: $KEY" "$@" -d "$body"
  grep -i '^x-dropwise-\(routed-to\|cache\|water-ml\|budget\)' /tmp/dropwise-demo.h | tr -d '\r'
  python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/dropwise-demo.b'))
    t = (d['choices'][0]['message'].get('content') or '').strip().replace('\n', ' ')
    print('answer:', t[:220] + ('…' if len(t) > 220 else ''))
except Exception as e:
    print('(no answer text:', e, ')')
PY
}

say "1. An easy prompt, asked of the large model: Dropwise sends it to the small one"
pause; call anthropic/claude-opus-5-5 "Give me three tips for a good night's sleep."

say "2. The same prompt again: answered from cache, no model call, no new water"
pause; call anthropic/claude-opus-5-5 "Give me three tips for a good night's sleep."

say "3. A time-sensitive prompt: the cache is skipped on purpose"
pause; call anthropic/claude-opus-5-5 "What's the weather like in Chennai right now?"

say "4. A hard prompt: stays on the large model (this is the one Opus call)"
pause; call anthropic/claude-opus-5-5 "Is 2^31 - 1 prime? Prove it in a few lines."

say "5. Time shifting: not answered now, scheduled for a lower-demand hour"
pause
call anthropic/claude-opus-5-5 "Summarize why caching reduces energy use, in two sentences." -H 'x-dropwise-defer: 6h' || true
cat /tmp/dropwise-demo.b | python3 -m json.tool | head -14
JOB=$(python3 -c "import json;print(json.load(open('/tmp/dropwise-demo.b')).get('job_id',''))")
if [ -n "$JOB" ]; then
  say "5b. Run it now (what happens at its scheduled hour)"
  pause; curl -s -X POST "$GW/jobs/$JOB/run" | python3 -m json.tool | head -12
fi

say "Done. Open the dashboard: Overview, Requests, Budgets, Time shifting."
