// export.js — turn a finished job into a file and hand it to the user.
// PURPOSE: dispatcher for all 7 formats (same rules as _export_one() in the
//          Mac app), single download, "export all" as one ZIP, Android share.
// INPUTS:  job {name, response, speaker_names}, format, {merge, timestamps}.
// OUTPUTS: {filename, blob}; downloadBlob() saves to the tablet's Downloads.
import * as F from "./format.js";
import { buildDocx } from "./docx.js";
import { buildPdf } from "./pdf.js";
import { makeZip } from "./zip.js";

const EXT = { TXT: "txt", Markdown: "md", PDF: "pdf", DOCX: "docx", SRT: "srt", VTT: "vtt", "JSON (raw)": "json" };
const MIME = { txt: "text/plain", md: "text/markdown", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  srt: "application/x-subrip", vtt: "text/vtt", json: "application/json", zip: "application/zip" };

/** "nahravka.final.m4a" → "nahravka.final" (Python Path.stem). */
export const stem = (name) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(0, i) : name; };
const textBlob = (s, ext) => new Blob([s], { type: `${MIME[ext]};charset=utf-8` });

export async function exportJob(job, format, { merge = true, timestamps = false } = {}) {
  const r = job.response;
  if (!r) throw new Error("Prepis ešte nie je hotový.");
  const names = merge ? job.speaker_names || {} : {};
  const ext = EXT[format];
  if (!ext) throw new Error(`Neznámy formát: ${format}`);
  const filename = `${stem(job.name)}.${ext}`;
  let blob;
  switch (format) {
    case "TXT": blob = textBlob(merge ? F.formatPlainText(r, names, timestamps, true) : F.runOnText(r), ext); break;
    case "Markdown": blob = textBlob(merge ? F.formatMarkdown(r, names, timestamps) : F.runOnText(r), ext); break;
    case "PDF": blob = await buildPdf(r, names, timestamps); break;
    case "DOCX": blob = new Blob([buildDocx(r, names, timestamps)], { type: MIME.docx }); break;
    case "SRT": blob = textBlob(F.formatSrt(r, names), ext); break;
    case "VTT": blob = textBlob(F.formatVtt(r, names), ext); break;
    // JSON always carries the name map, like the Mac app.
    default: blob = textBlob(F.formatJson(r, job.speaker_names || {}), ext);
  }
  return { filename, blob };
}

/** Several jobs → one ZIP (duplicate names get " (2)", " (3)"…). */
export async function exportZip(jobs, format, opts) {
  const used = new Map();
  const entries = [];
  const errors = [];
  for (const job of jobs) {
    try {
      const { filename, blob } = await exportJob(job, format, opts);
      const n = (used.get(filename) || 0) + 1;
      used.set(filename, n);
      const name = n === 1 ? filename : `${stem(filename)} (${n}).${filename.split(".").pop()}`;
      entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    } catch (e) { errors.push(`${job.name}: ${e.message}`); }
  }
  const d = new Date(), p = (n) => String(n).padStart(2, "0"); // LOCAL time, not UTC
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}`;
  return { filename: `prepisy-${stamp}.zip`, blob: new Blob([makeZip(entries)], { type: MIME.zip }), count: entries.length, errors };
}

export function downloadBlob({ filename, blob }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Android share sheet (Gmail, Drive, WhatsApp…). Returns false if unsupported. */
export async function shareBlob({ filename, blob }) {
  const file = new File([blob], filename, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file], title: filename }); }
  catch (e) {
    if (e.name === "AbortError") return true; // user closed the share sheet
    // NotAllowedError: building a big PDF/ZIP took longer than the browser's
    // "recent tap" window — fall back to a normal download instead of failing.
    if (e.name === "NotAllowedError") return false;
    throw e;
  }
  return true;
}
