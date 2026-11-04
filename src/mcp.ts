/**
 * token-condom MCP server (stdio, JSON-RPC 2.0, zero dependencies).
 *
 * Why an MCP server and not an AGENTS.md rule (owner, 2026-10-24): "agents will ignore
 * AGENTS.md rules when they are in a loop; they cannot ignore the tool schema". The native
 * read tool cannot be intercepted — opencode2 exposes no tool.execute hook — so `tc_read`
 * is the only way an agent gets a surgical read.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "./core";
import { readFile } from "./read";

interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

interface RpcRequest {
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

const TOOLS: ToolDef[] = [
  {
    name: "tc_read",
    description:
      "Read a file surgically: returns a symbol outline (default for files over 80 lines) or an explicit line slice. Use start/end for a slice, full:true only when the whole file is genuinely needed. Prefer this over a whole-file read — the outline is ~10x cheaper and enough to navigate.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute or relative path" },
        start: { type: "number", description: "First line (1-based)" },
        end: { type: "number", description: "Last line (inclusive)" },
        full: { type: "boolean", description: "Return the entire file (use only when required)" },
      },
      required: ["file"],
    },
  },
  {
    name: "tc_compress",
    description:
      "Compress tool output, logs, JSON, HTML or test results before you work with them. Lossless outside logs: source code, identifiers and prose are never degraded. Returns compressed text plus a ref; tc_expand restores the original byte-exact.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The content to compress" },
        kind: { type: "string", description: "auto (default) | log | tests | json | html | diff | source" },
      },
      required: ["text"],
    },
  },
  {
    name: "tc_expand",
    description: "Restore a compressed payload byte-exact from its ref (the hash printed in the [token-condom: ...] marker).",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "tc_stats",
    description: "Token savings ledger: compressions, tokens before/after, per tool and per agent.",
    inputSchema: { type: "object", properties: { json: { type: "boolean" } } },
  },
  {
    name: "tc_map",
    description: "List a directory as a compact tree (names, sizes, file counts) instead of reading every file.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, depth: { type: "number" } },
      required: ["dir"],
    },
  },
];

function mapDir(dir: string, depth = 2): string {
  const root = path.resolve(dir);
  const lines: string[] = [];
  let files = 0;
  let bytes = 0;
  const walk = (d: string, prefix: string, level: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      lines.push(`${prefix}! ${(e as NodeJS.ErrnoException).code}`);
      return;
    }
    entries = entries
      .filter((e) => !/^(node_modules|\.git|__pycache__|\.venv|venv)$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`);
        if (level < depth) walk(full, prefix + "  ", level + 1);
      } else {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          /* race */
        }
        files++;
        bytes += size;
        lines.push(`${prefix}${e.name}  ${size > 1024 ? (size / 1024).toFixed(1) + "K" : size + "B"}`);
      }
    }
  };
  walk(root, "", 1);
  return `${root} — ${files} files, ${(bytes / 1024).toFixed(1)}K total\n${lines.slice(0, 400).join("\n")}`;
}

function call(name: string | undefined, args: Record<string, unknown>): string {
  switch (name) {
    case "tc_read": {
      const r = readFile(String(args.file), {
        start: args.start as number | undefined,
        end: args.end as number | undefined,
        full: Boolean(args.full),
      });
      return `${r.text}`;
    }
    case "tc_compress": {
      const r = core.compress(String(args.text || ""), {
        hint: String(args.kind || "auto"),
        tool: "mcp:tc_compress",
      });
      return r.text;
    }
    case "tc_expand": {
      const t = core.getBlob(String(args.ref || ""));
      if (t === null) throw new Error(`no blob for ref ${args.ref}`);
      return t;
    }
    case "tc_stats":
      return JSON.stringify(core.stats(), null, args.json ? 2 : 0);
    case "tc_map":
      return mapDir(String(args.dir || "."), Number(args.depth || 2));
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

/* ── minimal JSON-RPC over stdio ─────────────────────────────────────────── */

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg: RpcRequest;
    try {
      msg = JSON.parse(line) as RpcRequest;
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg: RpcRequest): void {
  const { id, method, params } = msg;
  const reply = (result: unknown): void => send({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): void => send({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize")
    return reply({
      protocolVersion: params?.protocolVersion || "2026-07-28",
      capabilities: { tools: {} },
      serverInfo: { name: "token-condom", version: "0.1.0" },
    });
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    try {
      const text = call(name, params?.arguments || {});
      return reply({ content: [{ type: "text", text }] });
    } catch (e) {
      return reply({ content: [{ type: "text", text: `token-condom error: ${(e as Error).message}` }], isError: true });
    }
  }
  if (id !== undefined) fail(-32601, `method not found: ${method}`);
}

process.stderr.write(`token-condom MCP ready (${TOOLS.length} tools)\n`);
