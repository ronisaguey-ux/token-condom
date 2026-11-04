"use strict";
/**
 * Token-Condom core: content routing, lossless-where-it-matters compression,
 * byte-exact blobs, and a ledger.
 *
 * Rules the owner set (2026-10-24), do not soften them:
 *  - Lossless outside logs: source code, identifiers and prose are never degraded.
 *    Only logs, repetitive tool output, JSON and HTML get reshaped.
 *  - Every compressed payload is recoverable byte-exact from its blob.
 *  - Same input must always produce the same output bytes, or the provider's
 *    prefix cache is invalidated and the "saving" becomes a 50x cache miss.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_EXT = exports.LEDGER = exports.BLOB_DIR = exports.STATE_DIR = void 0;
exports.tokens = tokens;
exports.putBlob = putBlob;
exports.getBlob = getBlob;
exports.detect = detect;
exports.bound = bound;
exports.compress = compress;
exports.stats = stats;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.STATE_DIR = process.env.TOKEN_CONDOM_STATE || path.join(os.homedir(), ".local", "state", "token-condom");
exports.BLOB_DIR = path.join(exports.STATE_DIR, "blobs");
exports.LEDGER = path.join(exports.STATE_DIR, "ledger.jsonl");
/** Calibrated-ish token estimate. DeepSeek tokenises markdown at ~3.6 bytes/token. */
function tokens(text) {
    return Math.ceil(Buffer.byteLength(text, "utf8") / 3.6);
}
function ensureDirs() {
    fs.mkdirSync(exports.BLOB_DIR, { recursive: true });
}
function sha(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
/** Persist the original so `expand` is always byte-exact. Never pruned (owner: forever). */
function putBlob(text, meta = {}) {
    ensureDirs();
    const id = sha(text);
    const file = path.join(exports.BLOB_DIR, id);
    if (!fs.existsSync(file))
        fs.writeFileSync(file, text, "utf8");
    if (meta.tool || meta.kind) {
        const record = {
            id,
            bytes: Buffer.byteLength(text),
            tool: meta.tool ?? null,
            kind: meta.kind ?? null,
            ts: new Date().toISOString(),
        };
        fs.appendFileSync(path.join(exports.STATE_DIR, "blobs.jsonl"), JSON.stringify(record) + "\n");
    }
    return id;
}
function getBlob(id) {
    const file = path.join(exports.BLOB_DIR, String(id).replace(/[^a-f0-9]/g, ""));
    if (!fs.existsSync(file))
        return null;
    return fs.readFileSync(file, "utf8");
}
function record({ tool, kind, before, after, agent }) {
    ensureDirs();
    const line = {
        ts: new Date().toISOString(),
        agent: agent || process.env.AGENT_NAME || "unknown",
        tool: tool || "unknown",
        kind,
        before_tokens: before,
        after_tokens: after,
        saved: before - after,
    };
    fs.appendFileSync(exports.LEDGER, JSON.stringify(line) + "\n");
}
/* ─────────────────────────── detection ─────────────────────────── */
exports.SOURCE_EXT = new Set([
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
    ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".scala", ".lua",
    ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte", ".dart", ".ex", ".exs", ".zig",
]);
function detect(text, hint) {
    if (hint && hint !== "auto")
        return hint;
    const head = text.slice(0, 4000);
    if (/^\s*[[{]/.test(head)) {
        try {
            JSON.parse(text);
            return "json";
        }
        catch {
            /* not json */
        }
    }
    if (/^\s*<\?xml|<!doctype html|<html[\s>]/i.test(head))
        return "html";
    if (/^(diff --git|index [0-9a-f]{7,}|@@ -\d+)/m.test(head))
        return "diff";
    if (/^(commit [0-9a-f]{7,}|Author:|Date:)/m.test(head))
        return "gitlog";
    if (/^\s*(On branch|Changes not staged|Changes to be committed|Untracked files)/m.test(head))
        return "gitstatus";
    const lines = text.split("\n");
    const fail = lines.filter((l) => /\b(FAIL|FAILED|ERROR|Traceback|AssertionError|panic:|✗|✖)\b/.test(l)).length;
    const pass = lines.filter((l) => /\b(PASS|PASSED|ok |✓|√)\b/.test(l)).length;
    if (fail + pass >= 3)
        return "tests";
    if (/^\s*(\d{4}-\d\d-\d\d[ T]\d\d:\d\d|\[\d\d:\d\d:\d\d\]|(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b)/m.test(head))
        return "log";
    if (lines.length > 40 && new Set(lines).size < lines.length * 0.55)
        return "log";
    return "text";
}
/* ─────────────────────────── formatters ─────────────────────────── */
const KEEP_PATTERNS = [
    /\b(FAIL|FAILED|FAILURE|ERROR|ERR!|FATAL|PANIC|panic:|EXCEPTION|Exception|Traceback|AssertionError|SEGV|denied|refused|timeout|timed out)\b/,
    /^\s*at\s+\S+:\d+/, // stack frames
    /[A-Za-z0-9_./-]+\.(py|js|ts|tsx|go|rs|java|rb|php|cs|c|cc|cpp|h):\d+/,
    /^\s*(error|warning|warn)\b/i,
    /^\s*(E|W)\s{2,}/, // rust/cargo diagnostics
];
function signature(line) {
    return line
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#uuid")
        .replace(/\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?/g, "#ts")
        .replace(/\b\d\d:\d\d:\d\d(?:[.,]\d+)?/g, "#time")
        .replace(/\b\d+\.\d+\.\d+\.\d+(?::\d+)?/g, "#ip")
        .replace(/\b[0-9a-f]{12,}\b/gi, "#hex")
        .replace(/\b\d+(?:\.\d+)?\b/g, "#n");
}
function compressLog(text) {
    const lines = text.split("\n");
    const kept = [];
    let collapsed = 0;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const sig = signature(line);
        // a run of lines that differ only in timestamps/ids is one event, not N events
        let run = 1;
        while (i + run < lines.length && signature(lines[i + run]) === sig && !KEEP_PATTERNS.some((re) => re.test(lines[i + run])))
            run++;
        if (run >= 4) {
            kept.push(`${line}   … ×${run} similar (all in blob) …`);
            collapsed += run - 1;
            i += run;
            continue;
        }
        kept.push(line);
        i += 1;
    }
    let out = kept.join("\n");
    // Still huge: keep the head and every important line, elide the routine tail.
    if (kept.length > 400) {
        const head = kept.slice(0, 150);
        const rest = kept.slice(150).filter((l) => KEEP_PATTERNS.some((re) => re.test(l)));
        const elided = kept.length - head.length - rest.length;
        collapsed += elided;
        out = [...head, `… ${elided} routine lines elided (blob has everything) …`, ...rest].join("\n");
    }
    return { text: out, collapsed };
}
function compressTests(text) {
    const lines = text.split("\n");
    const kept = [];
    let dropped = 0;
    for (const line of lines) {
        const isPassOnly = /\b(PASS|PASSED|ok |✓|√|\.{3,}\s*ok)\b/.test(line) && !/FAIL|ERROR/i.test(line);
        if (isPassOnly) {
            dropped++;
            continue;
        }
        kept.push(line);
    }
    let out = kept.join("\n");
    if (dropped)
        out += `\n… ${dropped} passing lines elided …`;
    return { text: out, collapsed: dropped };
}
function compressJson(text) {
    try {
        const min = JSON.stringify(JSON.parse(text));
        // large arrays of objects: keep first 3 + count, the rest stay in the blob
        if (min.length > 4000) {
            const parsed = JSON.parse(text);
            const shape = (v) => {
                if (Array.isArray(v) && v.length > 5)
                    return [...v.slice(0, 3), `…${v.length - 3} more items (see blob)`];
                if (v && typeof v === "object" && !Array.isArray(v)) {
                    const o = {};
                    for (const [k, val] of Object.entries(v))
                        o[k] = shape(val);
                    return o;
                }
                return v;
            };
            const reshaped = JSON.stringify(shape(parsed));
            if (reshaped.length < min.length)
                return { text: reshaped, collapsed: 0 };
        }
        return { text: min, collapsed: 0 };
    }
    catch {
        return { text, collapsed: 0 };
    }
}
function compressHtml(text) {
    const out = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return { text: out, collapsed: 0 };
}
/** Diff: keep hunk headers and changed lines, elide long unchanged context. */
function compressDiff(text) {
    const lines = text.split("\n");
    const kept = [];
    let dropped = 0;
    for (const line of lines) {
        if (/^[+-]|^(diff --git|index |--- |\+\+\+ |@@)/.test(line))
            kept.push(line);
        else
            dropped++;
    }
    let out = kept.join("\n");
    if (dropped)
        out += `\n… ${dropped} context lines elided …`;
    return { text: out, collapsed: dropped };
}
/**
 * Bounded passthrough for content we must not degrade (source, prose).
 * Only engages above a hard size, and always leaves a retrievable reference.
 */
function bound(text, maxLines = 400) {
    const lines = text.split("\n");
    if (lines.length <= maxLines)
        return { text, collapsed: 0 };
    const head = lines.slice(0, Math.floor(maxLines * 0.6));
    const tail = lines.slice(-Math.floor(maxLines * 0.2));
    const elided = lines.length - head.length - tail.length;
    return {
        text: [...head, `… ${elided} lines elided — expand <hash> for the full output …`, ...tail].join("\n"),
        collapsed: elided,
    };
}
const passthrough = (t) => ({ text: t, collapsed: 0 });
const COMPRESSORS = {
    json: compressJson,
    html: compressHtml,
    log: compressLog,
    tests: compressTests,
    diff: compressDiff,
    gitstatus: passthrough,
    gitlog: passthrough,
    text: passthrough,
    source: passthrough,
    prose: passthrough,
    empty: passthrough,
};
/**
 * Main entry. Returns { text, kind, ref, saved, beforeTokens, afterTokens }.
 * Pass a file path as hint to use extension-based routing (source is never touched).
 */
function compress(text, opts = {}) {
    const { hint = "auto", tool = "cli", pathHint = null, agent = null } = opts;
    if (typeof text !== "string" || text.length === 0) {
        return { text, kind: "empty", ref: null, saved: 0, beforeTokens: 0, afterTokens: 0 };
    }
    let kind = detect(text, hint);
    if (pathHint && exports.SOURCE_EXT.has(path.extname(pathHint).toLowerCase()))
        kind = "source";
    const before = tokens(text);
    let result = COMPRESSORS[kind](text);
    // Source and prose are only bounded, never reshaped (owner rule: lossless outside logs).
    if (kind === "source" || kind === "prose" || kind === "text") {
        result = bound(result.text);
    }
    if (result.text.length >= text.length) {
        result = kind === "source" || kind === "prose" ? bound(text) : { text, collapsed: 0 };
    }
    const after = tokens(result.text);
    let ref = null;
    // No blob, no marker, byte-identical output when the rewrite saved nothing: a marker on an
    // unchanged payload is pure overhead and would also make the output non-idempotent.
    if (after >= before && result.text !== text)
        result = { text, collapsed: 0 };
    if (result.text !== text && after < before) {
        ref = putBlob(text, { tool, kind });
        const collapsedNote = result.collapsed ? `, ${result.collapsed} lines collapsed` : "";
        const marker = `\n\n[token-condom: ${kind}, ${before}→${after} tok${collapsedNote} · full output: token-condom expand ${ref}]`;
        result.text += marker;
    }
    const finalAfter = tokens(result.text);
    if (ref)
        record({ tool, kind, before, after: finalAfter, agent });
    return { text: result.text, kind, ref, saved: before - finalAfter, beforeTokens: before, afterTokens: finalAfter };
}
function stats() {
    ensureDirs();
    if (!fs.existsSync(exports.LEDGER))
        return { calls: 0, before: 0, after: 0, saved: 0, byTool: {}, byAgent: {} };
    const byTool = {};
    const byAgent = {};
    let calls = 0, before = 0, after = 0;
    for (const line of fs.readFileSync(exports.LEDGER, "utf8").split("\n")) {
        if (!line.trim())
            continue;
        let r;
        try {
            r = JSON.parse(line);
        }
        catch {
            continue;
        }
        calls++;
        before += r.before_tokens || 0;
        after += r.after_tokens || 0;
        const t = (byTool[r.tool ?? "unknown"] ||= { calls: 0, before: 0, after: 0 });
        t.calls++;
        t.before += r.before_tokens || 0;
        t.after += r.after_tokens || 0;
        const a = (byAgent[r.agent ?? "unknown"] ||= { calls: 0, before: 0, after: 0 });
        a.calls++;
        a.before += r.before_tokens || 0;
        a.after += r.after_tokens || 0;
    }
    return { calls, before, after, saved: before - after, byTool, byAgent };
}
