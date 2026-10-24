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

TC_BIN="${TOKEN_CONDOM_BIN:-/home/roni/Roni_workspace/token-condom/bin/token-condom.js}"
[ -f "$TC_BIN" ] || return 0 2>/dev/null || true

# The full command string bash was asked to run (this shell's own argv), so pipe detection
# sees the real command line rather than the function's own arguments.
_tc_cmdline() { tr '\0' ' ' < "/proc/$$/cmdline" 2>/dev/null; }

_tc_bypass() {
  local c
  c="$(_tc_cmdline)"
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

# _tc_run <kind> <tool> <args...>
_tc_run() {
  local kind="$1" tool="$2"; shift 2
  if _tc_bypass; then
    command "$tool" "$@"
    return $?
  fi
  command "$tool" "$@" | node "$TC_BIN" compress --kind "$kind" --tool "$tool" 2>/dev/null
  return ${PIPESTATUS[0]}
}

git() {
  case "$1" in
    status)  _tc_run gitstatus git "$@" ;;
    diff)    _tc_run diff      git "$@" ;;
    log)     _tc_run gitlog    git "$@" ;;
    show)    _tc_run diff      git "$@" ;;
    *)       command git "$@" ;;
  esac
}

ls()   { _tc_run text ls "$@"; }
find() { _tc_run text find "$@"; }
ps()   { _tc_run text ps "$@"; }
df()   { _tc_run text df "$@"; }
du()   { _tc_run text du "$@"; }
journalctl() { _tc_run log journalctl "$@"; }

pytest() { _tc_run tests pytest "$@"; }
npm() {
  case "$1" in
    test|run) _tc_run tests npm "$@" ;;
    *) command npm "$@" ;;
  esac
}
cargo() {
  case "$1" in
    test|build|check) _tc_run tests cargo "$@" ;;
    *) command cargo "$@" ;;
  esac
}
docker() {
  case "$1" in
    ps|logs) _tc_run log docker "$@" ;;
    *) command docker "$@" ;;
  esac
}
