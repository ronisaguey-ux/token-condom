/**
 * Surgical reads: an outline of symbols, or an explicit line slice.
 * The native read tool cannot be intercepted (no tool.execute hook in opencode2),
 * so this ships as an MCP tool that agents call instead — a schema they cannot
 * "forget" the way they forget an AGENTS.md rule.
 */

import * as fs from "fs";
import * as path from "path";

/** [regex, kind, capture-group-that-holds-the-name] */
type Rule = readonly [RegExp, string, number];

const RULES: Record<string, readonly Rule[]> = {
  ".py": [
    [/^(\s*)class\s+(\w+)/, "class", 2],
    [/^(\s*)(?:async\s+)?def\s+(\w+)/, "def", 2],
  ],
  ".js": [
    [/^(\s*)(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, "class", 2],
    [/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "fn", 2],
    [/^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, "fn", 2],
    [/^(\s{2,})(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/, "method", 2],
  ],
  ".ts": [
    [/^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class", 2],
    [/^(\s*)(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "fn", 2],
    [/^(\s*)(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, "type", 2],
    [/^(\s{2,})(?:public|private|protected|static|async|readonly|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, "method", 2],
  ],
  ".go": [
    [/^(func)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "fn", 2],
    [/^(type)\s+([A-Za-z_]\w*)/, "type", 2],
  ],
  ".rs": [
    [/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(fn|struct|impl|enum|trait|mod|const|static)\s+([A-Za-z_]\w*)/, "kw", 3],
  ],
  ".java": [
    [/^(\s*)(?:public|private|protected|static|final|abstract|\s)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/, "kw", 3],
    [/^(\s{2,})(?:public|private|protected|static|final|abstract|synchronized|\s)*[\w<>\[\],\s]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/, "method", 2],
  ],
  ".kt": [[/^(\s*)(?:fun|class|object|interface)\s+([A-Za-z_]\w*)/, "kw", 2]],
  ".rb": [[/^(\s*)(def|class|module)\s+([A-Za-z_]\w*[?!]?)/, "kw", 3]],
  ".php": [
    [/^(\s*)(?:public|private|protected|static|\s)*function\s+([A-Za-z_]\w*)/, "fn", 2],
    [/^(\s*)(class|interface|trait)\s+([A-Za-z_]\w*)/, "class", 3],
  ],
  ".cs": [
    [/^(\s*)(?:public|private|protected|internal|static|sealed|abstract|partial|\s)*(class|interface|enum|struct)\s+([A-Za-z_]\w*)/, "kw", 3],
    [/^(\s{2,})(?:public|private|protected|internal|static|async|virtual|override|\s)*[\w<>\[\],\s]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?/, "method", 2],
  ],
  ".sh": [[/^(\s*)(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/, "fn", 2]],
  ".sql": [[/^(\s*)(?:create|alter)\s+(?:or\s+replace\s+)?(table|view|function|index|schema)\s+([\w."]+)/i, "kw", 3]],
  ".vue": [[/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/, "fn", 2]],
  ".svelte": [[/^(\s*)(?:export\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/, "fn", 2]],
};
RULES[".mjs"] = RULES[".js"];
RULES[".cjs"] = RULES[".js"];
RULES[".jsx"] = RULES[".js"];
RULES[".tsx"] = RULES[".ts"];
RULES[".bash"] = RULES[".sh"];
RULES[".zsh"] = RULES[".sh"];

const KIND_HINT: Record<string, string> = {
  def: "def", class: "class", function: "fn", func: "fn", fn: "fn", struct: "struct",
  impl: "impl", enum: "enum", trait: "trait", mod: "mod", interface: "iface",
  type: "type", const: "const", static: "const", module: "mod", table: "table",
  view: "view", index: "index", schema: "schema", method: "method",
};

export interface Symbol {
  line: number;
  depth: number;
  kind: string;
  name: string;
}

/**
 * Symbol list with 1-based line numbers. Regex-based on purpose: no parser dependency, and an
 * approximate outline that costs 200 tokens beats a perfect one that costs 40k.
 */
export function symbols(text: string, file?: string | null): Symbol[] {
  const ext = path.extname(file || "").toLowerCase();
  const rules = RULES[ext] || RULES[".js"];
  const out: Symbol[] = [];
  const lines = text.split("\n");
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.length > 400) continue;
    for (const [re, kind, gi] of rules) {
      const m = line.match(re);
      if (!m) continue;
      const name = m[gi - 1] || m[m.length - 1];
      if (!name || !/^[A-Za-z_$\w-]/.test(name)) continue;
      const indent = (line.match(/^\s*/) || [""])[0].length;
      const key = `${name}:${indent}`;
      if (seen.has(key)) break;
      seen.add(key);
      const k = kind === "kw" ? KIND_HINT[String(m[1]).toLowerCase()] || "sym" : kind;
      out.push({ line: i + 1, depth: Math.min(3, Math.floor(indent / 2)), kind: k, name });
      break;
    }
  }
  return out;
}

export interface FileInfo {
  abs: string;
  stat: fs.Stats;
  text: string;
  lines: string[];
  tokens: number;
}

export function fileInfo(file: string): FileInfo {
  const abs = path.resolve(file);
  const stat = fs.statSync(abs);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  return { abs, stat, text, lines, tokens: Math.ceil(Buffer.byteLength(text) / 3.6) };
}

export interface ReadOptions {
  start?: string | number | null;
  end?: string | number | null;
  full?: boolean;
  maxOutline?: number;
}

export interface ReadResult {
  mode: "full" | "slice" | "full-small" | "outline";
  lines: number;
  tokens: number;
  text: string;
}

/**
 * read(file, opts) → { text, mode, lines, tokens }
 * modes: outline (default for big files) | slice | full
 */
export function readFile(file: string, { start = null, end = null, full = false, maxOutline = 200 }: ReadOptions = {}): ReadResult {
  const { abs, text, lines, tokens } = fileInfo(file);
  const total = lines.length;

  if (full) {
    return {
      mode: "full",
      lines: total,
      tokens,
      text: `${abs} (${total} lines, ~${tokens} tok)\n${lines.map((l, i) => `${i + 1}: ${l}`).join("\n")}`,
    };
  }

  if (start || end) {
    const a = Math.max(1, parseInt(String(start || 1), 10));
    const b = Math.min(total, parseInt(String(end || a + 120), 10));
    const chunk = lines.slice(a - 1, b);
    return {
      mode: "slice",
      lines: chunk.length,
      tokens: Math.ceil(Buffer.byteLength(chunk.join("\n")) / 3.6),
      text: `${abs} L${a}-${b} of ${total} (~${tokens} tok total)\n${chunk.map((l, i) => `${a + i}: ${l}`).join("\n")}`,
    };
  }

  const syms = symbols(text, abs);
  if (total <= 80 || syms.length === 0) {
    // Small or unstructured: the whole thing is cheaper than an outline plus a slice.
    return {
      mode: "full-small",
      lines: total,
      tokens,
      text: `${abs} (${total} lines, ~${tokens} tok)\n${lines.map((l, i) => `${i + 1}: ${l}`).join("\n")}`,
    };
  }

  const shown = syms.slice(0, maxOutline);
  const body = shown.map((s) => `${"  ".repeat(s.depth)}L${s.line} ${s.kind} ${s.name}`).join("\n");
  const more = syms.length > shown.length ? `\n… ${syms.length - shown.length} more symbols …` : "";
  return {
    mode: "outline",
    lines: total,
    tokens,
    text:
      `${abs} — ${total} lines, ~${tokens} tok, ${syms.length} symbols\n` +
      `${body}${more}\n\n` +
      `read L<a>-<b> for a slice, or full:true for the whole file.`,
  };
}
