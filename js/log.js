// log.js — structured diagnostic log (tablet equivalent of transcriber.log).
// PURPOSE: record every request, full server error bodies, retries and crashes
//          so a failure can be diagnosed later ("Nastavenia → Stiahnuť log").
// OUTPUTS: JSON lines {ts, level, msg, ctx} kept in localStorage (ring buffer).
// SECURITY: the API key is NEVER logged — maskKey() fingerprints it and
//           scrub() redacts anything that looks like a key. Transcript text is
//           never logged either (user content).
// TWEAK:   MAX_ENTRIES = how much history survives a restart.

const KEY = "transcriber.log";
const MAX_ENTRIES = 3000; // knob
let entries = [];
try { entries = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { entries = []; }

let flushTimer = null;
function flush() {
  flushTimer = null;
  try { localStorage.setItem(KEY, JSON.stringify(entries)); }
  catch { entries = entries.slice(-Math.floor(MAX_ENTRIES / 2)); } // quota: keep newest half
}

export function maskKey(key) {
  const k = (key || "").trim();
  if (!k) return "<none>";
  if (k.length <= 8) return `<len=${k.length}>`;
  return `${k.slice(0, 4)}…${k.slice(-2)} (len=${k.length})`;
}

const SECRET_FIELD = /api[_-]?key|xi-api-key|authorization|token/i;
function scrub(value, depth = 0) {
  if (typeof value === "string") return value.replace(/\bsk_[A-Za-z0-9]{8,}\b/g, "sk_<redacted>");
  if (!value || typeof value !== "object" || depth > 4) return value;
  if (value instanceof Error) return { name: value.name, message: scrub(value.message), stack: scrub(value.stack || "") };
  const out = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_FIELD.test(k) ? "<redacted>" : scrub(v, depth + 1);
  return out;
}

function write(level, msg, ctx) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(ctx ? { ctx: scrub(ctx) } : {}) };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[${level}] ${msg}`, entry.ctx ?? "");
  if (!flushTimer) flushTimer = setTimeout(flush, 500);
}

export const log = {
  debug: (m, c) => write("debug", m, c),
  info: (m, c) => write("info", m, c),
  warn: (m, c) => write("warn", m, c),
  error: (m, c) => write("error", m, c),
};

/** The whole log as JSON lines (for download). */
export const exportLog = () => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
export function clearLog() { entries = []; flush(); }

// Capture otherwise-silent crashes.
window.addEventListener("error", (e) => log.error("Uncaught error", { message: e.message, source: e.filename, line: e.lineno, error: e.error }));
window.addEventListener("unhandledrejection", (e) => log.error("Unhandled promise rejection", { reason: e.reason }));
window.addEventListener("pagehide", flush);
