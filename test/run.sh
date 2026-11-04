#!/usr/bin/env bash
# token-condom smoke tests. Fails loudly; one line per check.
set -u
cd "$(dirname "$0")/.." || exit 1
BIN=bin/token-condom.js
STATE=$(mktemp -d); export TOKEN_CONDOM_STATE="$STATE"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

python3 - "$STATE/log.txt" <<'PY'
import sys
with open(sys.argv[1], "w") as f:
    for i in range(200):
        f.write("2026-10-24 12:00:00 INFO heartbeat %d\n" % i)
    f.write("2026-10-24 12:00:01 ERROR db refused: ECONNREFUSED 10.0.0.5:5432\n")
    for i in range(100):
        f.write("2026-10-24 12:00:02 DEBUG cache miss key=user:%d\n" % i)
PY

node "$BIN" compress --file "$STATE/log.txt" > "$STATE/log.out" 2>/dev/null
before=$(wc -c < "$STATE/log.txt"); after=$(wc -c < "$STATE/log.out")
if [ "$after" -lt $((before * 6 / 10)) ]; then ok "log compresses >40% ($before -> $after bytes)"; else bad "log compression only $before -> $after"; fi
if grep -q ECONNREFUSED "$STATE/log.out"; then ok "ERROR line survives"; else bad "ERROR line lost"; fi

REF=$(grep -o 'expand [a-f0-9]*' "$STATE/log.out" | awk '{print $2}' | head -1)
node "$BIN" expand "$REF" > "$STATE/log.restored"
if cmp -s "$STATE/log.txt" "$STATE/log.restored"; then ok "expand is byte-exact"; else bad "expand mismatch"; fi

printf '{"a":1,"b":[1,2,3]}\n' > "$STATE/x.json"
node "$BIN" compress --file "$STATE/x.json" > "$STATE/x.out"
if [ "$(head -1 "$STATE/x.out")" = '{"a":1,"b":[1,2,3]}' ]; then ok "json minified"; else bad "json not minified: $(head -1 "$STATE/x.out")"; fi

printf 'def a():\n    return 1\n' > "$STATE/s.py"
node "$BIN" compress --file "$STATE/s.py" > "$STATE/s.out"
if cmp -s "$STATE/s.py" "$STATE/s.out"; then ok "source untouched"; else bad "source was modified"; fi

node "$BIN" read src/read.ts > "$STATE/r.out"
if grep -q "symbols" "$STATE/r.out"; then ok "read returns an outline"; else bad "read returned no outline"; fi

printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
              '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node bin/tc-mcp.js 2>/dev/null > "$STATE/mcp.out"
n=$(grep -o 'tc_[a-z]*' "$STATE/mcp.out" | sort -u | wc -l)
if [ "$n" -ge 5 ]; then ok "mcp lists $n tools"; else bad "mcp listed $n tools"; fi

printf 'echo 42\n' > "$STATE/probe.sh"
out=$(BASH_ENV="$PWD/shim/token-condom.sh" bash "$STATE/probe.sh")
if [ "$out" = "42" ]; then ok "shim bypasses plain scripts"; else bad "shim altered a script's output: $out"; fi

out=$(BASH_ENV="$PWD/shim/token-condom.sh" bash -c 'ls /nonexistent-path 2>/dev/null; echo rc=$?')
if [ "$out" = "rc=2" ]; then ok "shim preserves exit codes"; else bad "exit code changed: $out"; fi

printf '── %d passed, %d failed\n' "$pass" "$fail"
rm -rf "$STATE"
[ "$fail" -eq 0 ]
