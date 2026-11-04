/**
 * token-condom — compress and dedupe tool output before it enters an agent's context.
 *
 *   token-condom compress [--kind K] [--file F] [--tool NAME]   stdin/file -> stdout
 *   token-condom expand <ref>                                   byte-exact original
 *   token-condom read <file> [--start N --end M --full]          surgical reads
 *   token-condom stats [--json]
 *   token-condom doctor
 *
 * Rules (owner, 2026-10-24): lossless outside logs; blobs kept forever; identical input must
 * produce identical output or the provider prefix cache is lost.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "./core";
import { readFile } from "./read";

const VERSION = "0.1.0";

interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parse(args: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function die(msg: string): never {
  process.stderr.write(`token-condom: ${msg}\n`);
  process.exit(2);
}

function cmdCompress(argv: string[]): void {
  const args = parse(argv);
  let text: string;
  if (typeof args.file === "string") text = fs.readFileSync(args.file, "utf8");
  else text = fs.readFileSync(0, "utf8");

  const r = core.compress(text, {
    hint: String(args.kind || "auto"),
    tool: String(args.tool || (typeof args.file === "string" ? path.basename(args.file) : "stdin")),
    pathHint: typeof args.file === "string" ? args.file : null,
    agent: typeof args.agent === "string" ? args.agent : undefined,
  });
  process.stdout.write(r.text);
  if (args.summary) {
    process.stderr.write(
      `${r.kind}: ${r.beforeTokens} -> ${r.afterTokens} tok (${r.saved >= 0 ? "-" : "+"}${Math.abs(r.saved)})${r.ref ? ` ref=${r.ref}` : ""}\n`
    );
  }
}

function cmdExpand(argv: string[]): void {
  const args = parse(argv);
  const ref = args._[0];
  if (!ref) die("usage: token-condom expand <ref>");
  const text = core.getBlob(ref);
  if (text === null) die(`no blob for ref ${ref} (looked in ${core.BLOB_DIR})`);
  process.stdout.write(text);
}

function cmdRead(argv: string[]): void {
  const args = parse(argv);
  const file = args._[0];
  if (!file) die("usage: token-condom read <file> [--start N] [--end M] [--full]");
  const r = readFile(file, {
    start: typeof args.start === "string" ? args.start : null,
    end: typeof args.end === "string" ? args.end : null,
    full: Boolean(args.full),
  });
  process.stdout.write(r.text + "\n");
}

function cmdStats(argv: string[]): void {
  const args = parse(argv);
  const s = core.stats();
  if (args.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return;
  }
  const pct = s.before ? ((s.saved / s.before) * 100).toFixed(1) : "0.0";
  process.stdout.write(
    `token-condom: ${s.calls} compressions, ${s.before.toLocaleString()} -> ${s.after.toLocaleString()} tokens (${pct}% saved)\n`
  );
  const rows = Object.entries(s.byTool).sort((a, b) => b[1].before - a[1].before).slice(0, 12);
  for (const [tool, v] of rows) {
    const p = v.before ? ((1 - v.after / v.before) * 100).toFixed(0) : "0";
    process.stdout.write(`  ${tool.padEnd(22)} ${String(v.calls).padStart(4)}×  ${v.before.toLocaleString()} -> ${v.after.toLocaleString()}  (${p}%)\n`);
  }
  const agents = Object.entries(s.byAgent).sort((a, b) => b[1].before - a[1].before).slice(0, 12);
  if (agents.length) {
    process.stdout.write("  by agent:\n");
    for (const [a, v] of agents)
      process.stdout.write(`    ${a.padEnd(18)} ${v.before.toLocaleString()} -> ${v.after.toLocaleString()}\n`);
  }
}

function cmdDoctor(): void {
  core.putBlob(""); // creates dirs
  const blobs = fs.existsSync(core.BLOB_DIR) ? fs.readdirSync(core.BLOB_DIR) : [];
  let bytes = 0;
  for (const f of blobs) {
    try {
      bytes += fs.statSync(path.join(core.BLOB_DIR, f)).size;
    } catch {
      /* gone */
    }
  }
  const s = core.stats();
  process.stdout.write(
    `token-condom ${VERSION}\n` +
      `state:   ${core.STATE_DIR}\n` +
      `blobs:   ${blobs.length} (${(bytes / 1e6).toFixed(1)} MB, kept forever)\n` +
      `ledger:  ${s.calls} calls, ${s.saved.toLocaleString()} tokens saved\n` +
      `tokenize: bytes/3.6 (DeepSeek markdown)\n`
  );
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "compress":
  case "c":
    cmdCompress(rest);
    break;
  case "expand":
  case "x":
    cmdExpand(rest);
    break;
  case "read":
    cmdRead(rest);
    break;
  case "stats":
    cmdStats(rest);
    break;
  case "doctor":
    cmdDoctor();
    break;
  case "--version":
  case "-v":
    process.stdout.write(VERSION + "\n");
    break;
  default:
    process.stdout.write(
      `usage: token-condom <compress|expand|read|stats|doctor>\n` +
        `  compress  [--kind auto|log|tests|json|html|diff|source] [--file F] [--tool N] [--summary]\n` +
        `  expand    <ref>\n` +
        `  read      <file> [--start N] [--end M] [--full]\n` +
        `  stats     [--json]\n` +
        `  doctor\n`
    );
    process.exit(cmd ? 2 : 0);
}
