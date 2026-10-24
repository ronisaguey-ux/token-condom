#!/usr/bin/env bash
# token-condom BASH_ENV shim.
#
# Sourced by every non-interactive bash an agent spawns (BASH_ENV=<this file>). It wraps the
# handful of commands whose output is mostly noise, so the compression happens BEFORE the
# model ever sees the bytes — that is the only place it pays: rewriting history instead
# invalidates the provider prefix cache, and a cache miss costs 50x a hit on DeepSeek V4.1.
#
# SAFETY FIRST: if the command line contains a pipe, a redirect or a command substitution,
# the wrapper passes the output through untouched. Compressing inside a pipeline would feed
# mangled text to the next stage and silently break the agent's command.
#
# Kill switch:   TOKEN_CONDOM=0   (per command: prefix the command itself)
# Owner rule:    source, identifiers and prose are never rewritten — only logs, tests, JSON,
#                HTML and repetitive tabular output.

[ "${TOKEN_CONDOM:-1}" = "0" ] && return 0 2>/dev/null || true
command -v node >/dev/null 2>&1 || return 0 2>/dev/null || true

export TC_BIN="${TOKEN_CONDOM_BIN:-/home/roni/Roni_workspace/token-condom/bin/token-condom.js}"
[ -f "$TC_BIN" ] || return 0 2>/dev/null || true

# Helper names carry no leading underscore on purpose: Claude Code's shell snapshot drops
# underscore-prefixed functions, which left the wrappers below calling a missing tc_run.
# tc_run also re-checks its own preconditions, because a snapshot restores the functions
# without re-running the guards above.

# The full command string bash was asked to run (this shell's own argv), so pipe detection
# sees the real command line rather than the function's own arguments.
tc_cmdline() { tr '\0' ' ' < "/proc/$$/cmdline" 2>/dev/null; }

tc_bypass() {
  local c
  c="$(tc_cmdline)"
  # Only agent tool invocations (`bash -c "<one command>"`). A script run as `bash foo.sh`
  # is NOT wrapped: those parse their own command output and a reshaped line would break them.
  case "$c" in
    *" -c "*) : ;;
    *) return 0 ;;
  esac
  # A pipeline or redirect means the output feeds something else, not the model.
  case "$c" in
    *"|"*|*">"*|*"<("*|*'$('*|*'`'*) return 0 ;;
  esac
  return 1
}

# tc_run <kind> <tool> <args...>
tc_run() {
  local kind="$1" tool="$2"; shift 2
  local bin="${TC_BIN:-${TOKEN_CONDOM_BIN:-/home/roni/Roni_workspace/token-condom/bin/token-condom.js}}"
  if [ "${TOKEN_CONDOM:-1}" = "0" ] || [ ! -f "$bin" ] || ! command -v node >/dev/null 2>&1 || tc_bypass; then
    command "$tool" "$@"
    return $?
  fi
  command "$tool" "$@" | node "$bin" compress --kind "$kind" --tool "$tool" 2>/dev/null
  return ${PIPESTATUS[0]}
}

git() {
  case "$1" in
    status)  tc_run gitstatus git "$@" ;;
    diff)    tc_run diff      git "$@" ;;
    log)     tc_run gitlog    git "$@" ;;
    show)    tc_run diff      git "$@" ;;
    *)       command git "$@" ;;
  esac
}

ls()   { tc_run text ls "$@"; }
find() { tc_run text find "$@"; }
ps()   { tc_run text ps "$@"; }
df()   { tc_run text df "$@"; }
du()   { tc_run text du "$@"; }
journalctl() { tc_run log journalctl "$@"; }

pytest() { tc_run tests pytest "$@"; }
npm() {
  case "$1" in
    test|run) tc_run tests npm "$@" ;;
    *) command npm "$@" ;;
  esac
}
cargo() {
  case "$1" in
    test|build|check) tc_run tests cargo "$@" ;;
    *) command cargo "$@" ;;
  esac
}
docker() {
  case "$1" in
    ps|logs) tc_run log docker "$@" ;;
    *) command docker "$@" ;;
  esac
}
