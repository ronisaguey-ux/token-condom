# token-condom

Compress and dedupe tool output **before** it enters an agent's context — the only place
compression actually pays.

## Why write-time, not proxy-time

DeepSeek V4.1 Flash bills a cache hit at $0.006/M and a cache **miss** at $0.30/M — a miss
costs 50× a hit. Rewriting history mid-session invalidates the provider's prefix cache and
turns a saving into a 50× loss. So everything here happens at the moment content is produced,
and the output is deterministic: the same input always yields the same bytes.

## What it compresses

| type | what happens | typical |
|---|---|---|
| logs | runs of lines that differ only in timestamps/ids collapse to `×N`; ERROR/FATAL/PANIC and their frames always survive | 40–70% |
| tests | passing lines elided with a count; failures, assertions, `file:line` kept | 50–80% |
| JSON | minified, large arrays key-sampled | 40–95% |
| HTML | scripts/styles/nav stripped, text kept | 60–85% |
| diffs | context lines elided, hunks and changed lines kept | 30–60% |
| **source, prose** | **never touched** — byte-identical output | 0% |

Anything compressed is stored as a blob and printed with a marker containing its ref, so
`token-condom expand <ref>` restores the original byte-exact. Blobs are kept forever.

## Read surgically

```bash
token-condom read src/app.py            # symbol outline for anything over 80 lines
token-condom read src/app.py --start 120 --end 180
token-condom read src/app.py --full     # only when the whole file is genuinely needed
```

The native read tool cannot be intercepted (opencode2 exposes no `tool.execute` hook), so
this ships as MCP tools — a schema an agent cannot "forget" the way it forgets a rule.

## Install

```bash
# MCP (all tc_* tools)
node bin/tc-mcp.js

# shell: every agent tool call runs through `bash -c`, which sources $BASH_ENV
export BASH_ENV=/home/roni/Roni_workspace/token-condom/shim/token-condom.sh
```

The shim wraps `git status/diff/log/show`, `ls`, `find`, `ps`, `df`, `du`, `journalctl`,
`pytest`, `npm test|run`, `cargo test|build|check`, `docker ps|logs`. It **bypasses** when the
command line contains a pipe, a redirect or a command substitution, and it never activates for
`bash script.sh` — only for `bash -c "<one command>"`. Kill switch: `TOKEN_CONDOM=0`.

## Ledger

```bash
token-condom stats          # per tool and per agent, calibrated token counts
token-condom doctor         # state dir, blob count, ledger totals
```

State lives in `~/.local/state/token-condom/` (`blobs/`, `ledger.jsonl`).
