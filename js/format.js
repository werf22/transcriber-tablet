// format.js — transcript formatting (pure functions, no DOM).
// PURPOSE: turn the ElevenLabs JSON response into paragraphs / TXT / Markdown /
//          SRT / VTT / JSON exactly like the Mac app (transcriber.py). The
//          parity test (tests/parity.test.mjs) compares outputs byte for byte.
// INPUTS:  API response object, speaker-name map {speaker_0: "Jana", ...}.
// OUTPUTS: strings / paragraph arrays.
// NOTE:    small helpers below mimic Python semantics on purpose (whitespace
//          set, round-half-even) — "simplifying" them breaks parity.

// Python's str.isspace() set — differs from JS \s (\x1c-\x1f, \x85 yes; ﻿ no).
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${WS}]+`, "g");
const WS_EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
const pyStrip = (s) => s.replace(WS_EDGES, "");
const pyCollapse = (s) => pyStrip(s).split(WS_RUN).filter(Boolean).join(" ");

/** Python round() = round half to even. */
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Python f"{x:.2f}" — toFixed except exact binary ties (0.125…) go to even. */
export function fmt2(x) {
  if (Number.isInteger(x * 8) && !Number.isInteger(x * 100)) {
    return (roundHalfEven(x * 100) / 100).toFixed(2);
  }
  return x.toFixed(2);
}

const pad = (n, w) => String(n).padStart(w, "0");

export function formatTimestamp(seconds, sep = ",") {
  const totalMs = roundHalfEven(Math.max(0, seconds) * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(totalMs % 1000, 3)}`;
}

/** Multi-channel "separate" responses carry `transcripts: [...]` instead of
 *  top-level words — merge them so preview/export are never empty. */
export function normalizeResponse(resp) {
  if (!resp || (resp.words && resp.words.length) || !Array.isArray(resp.transcripts)) return resp;
  const words = resp.transcripts.flatMap((t) => t.words || [])
    .sort((a, b) => (a.start || 0) - (b.start || 0));
  const text = resp.transcripts.map((t) => t.text || "").join("\n");
  return { ...resp.transcripts[0], ...resp, words, text };
}

/** Unique speaker IDs in order of first appearance. */
export function extractSpeakers(resp) {
  const seen = [];
  for (const w of normalizeResponse(resp)?.words || []) {
    const sid = w.speaker_id;
    if (sid && !seen.includes(sid)) seen.push(sid);
  }
  return seen;
}

export function speakerLabel(sid, names = {}) {
  if (!sid) return "Speaker";
  const custom = names[sid];
  if (custom && pyStrip(custom)) return pyStrip(custom);
  const tail = sid.split("_").pop();
  if (/^\s*[+-]?\d+\s*$/.test(tail)) return `Speaker ${parseInt(tail, 10) + 1}`;
  return sid;
}

/** Group words into per-speaker paragraphs (port of build_paragraphs). */
export function buildParagraphs(resp, names = {}) {
  resp = normalizeResponse(resp) || {};
  const paragraphs = [];
  const words = resp.words || [];
  if (!words.length) {
    const text = pyStrip(resp.text || "");
    if (text) paragraphs.push({ speaker_id: null, label: "Speaker", text, start: 0, end: 0, words: [] });
    return paragraphs;
  }
  let cur = null;
  for (const w of words) {
    const type = w.type ?? "word";
    const sid = w.speaker_id ?? null;
    let text = w.text ?? "";
    if (type === "audio_event") {
      let ev = pyStrip(text);
      if (ev && !(ev.startsWith("[") || ev.startsWith("("))) ev = `[${ev}]`;
      text = ` ${ev} `;
    }
    if (cur === null || (type !== "audio_event" && sid !== cur.speaker_id)) {
      if (cur !== null) { cur.text = pyStrip(cur.text); paragraphs.push(cur); }
      cur = { speaker_id: sid, label: speakerLabel(sid, names), text,
        start: w.start || 0, end: w.end || 0, words: [w] };
    } else {
      cur.text += text;
      if (w.end !== undefined && w.end !== null) cur.end = w.end;
      cur.words.push(w);
    }
  }
  if (cur !== null) { cur.text = pyStrip(cur.text); paragraphs.push(cur); }
  for (const p of paragraphs) p.text = pyCollapse(p.text);
  return paragraphs;
}

export function formatPlainText(resp, names, includeTimestamps = false, includeSpeakers = true) {
  const out = [];
  for (const p of buildParagraphs(resp, names)) {
    const head = [];
    if (includeSpeakers) head.push(`${p.label}:`);
    if (includeTimestamps) head.push(`[${formatTimestamp(p.start, ".")}]`);
    if (head.length) out.push(head.join(" "));
    out.push(p.text, "");
  }
  return pyStrip(out.join("\n")) + "\n";
}

export function formatMarkdown(resp, names, includeTimestamps = false) {
  const lang = resp.language_code || "unknown";
  const prob = resp.language_probability;
  const lines = ["# Transcript",
    `*Detected language:* \`${lang}\`` + (typeof prob === "number" ? `  *(confidence ${fmt2(prob)})*` : ""),
    ""];
  for (const p of buildParagraphs(resp, names)) {
    const ts = includeTimestamps ? ` — \`${formatTimestamp(p.start, ".")}\`` : "";
    lines.push(`**${p.label}**${ts}`, "", p.text, "");
  }
  return lines.join("\n").replace(new RegExp(`[${WS}]+$`), "") + "\n";
}

function cues(resp, names, sep) {
  return buildParagraphs(resp, names).map((p, i) => ({
    idx: i + 1, text: p.text, label: p.label,
    start: formatTimestamp(p.start, sep),
    end: formatTimestamp(Math.max(p.end, p.start + 0.5), sep),
  }));
}

export function formatSrt(resp, names) {
  const out = cues(resp, names, ",").flatMap((c) =>
    [String(c.idx), `${c.start} --> ${c.end}`, `${c.label}: ${c.text}`, ""]);
  return pyStrip(out.join("\n")) + "\n";
}

export function formatVtt(resp, names) {
  const out = ["WEBVTT", "", ...cues(resp, names, ".").flatMap((c) =>
    [String(c.idx), `${c.start} --> ${c.end}`, `<v ${c.label}>${c.text}`, ""])];
  return pyStrip(out.join("\n")) + "\n";
}

/** Raw API response enriched with the local speaker-name map. */
export function formatJson(resp, names) {
  const payload = { ...resp };
  if (names && Object.keys(names).length) payload._speaker_names = { ...names };
  return JSON.stringify(payload, null, 2);
}

/** Plain run-on transcript (used when "merge speaker paragraphs" is off). */
export const runOnText = (resp) => pyStrip(resp.text || "") + "\n";
