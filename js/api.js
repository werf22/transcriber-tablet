// api.js — ElevenLabs client for the browser.
// PURPOSE: verify the key and transcribe one file, retrying FOREVER after any
//          failure except client errors retrying cannot fix (bad key, no
//          credits, file too large…) — same policy as the Mac app.
// INPUTS:  apiKey, File/Blob, settings, AbortSignal, status/progress callbacks.
// OUTPUTS: the parsed JSON transcript; throws ApiError / CanceledError.
// WHY XHR: fetch() cannot report upload progress; XMLHttpRequest can.
import { API_BASE, STT_ENDPOINT, NON_RETRIABLE_STATUS, RETRY_BASE_DELAY_SEC,
  RETRY_MAX_DELAY_SEC, STATUS } from "./constants.js";
import { buildFormFields } from "./formdata.js";
import { log, maskKey } from "./log.js";

export class ApiError extends Error {
  constructor(status, message, body = "") { super(message); this.name = "ApiError"; this.status = status; this.body = body; }
}
export class CanceledError extends Error {
  constructor() { super("Zrušené"); this.name = "CanceledError"; }
}

export const retryDelay = (attempt) =>
  Math.min(RETRY_MAX_DELAY_SEC, RETRY_BASE_DELAY_SEC * 2 ** Math.max(0, attempt - 1));

/** Sleep `sec`, waking early when canceled. Resolves true if canceled. */
function sleep(sec, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true);
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(false); }, sec * 1000);
    const onAbort = () => { clearTimeout(t); resolve(true); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Human message from an ElevenLabs error body ({detail:{message}} or text). */
function errorMessage(status, text) {
  try {
    const d = JSON.parse(text).detail;
    const msg = typeof d === "string" ? d : d?.message || JSON.stringify(d);
    if (msg) return `API ${status}: ${msg}`;
  } catch { /* not JSON */ }
  return `API ${status}: ${(text || "").slice(0, 500) || "bez odpovede"}`;
}

export async function verifyKey(apiKey) {
  const key = (apiKey || "").trim();
  if (!key) return { ok: false, message: "API kľúč nie je nastavený." };
  log.info("Verify key → GET /user/subscription", { key: maskKey(key) });
  let r;
  try {
    r = await fetch(`${API_BASE}/user/subscription`, { headers: { "xi-api-key": key, Accept: "application/json" } });
  } catch (e) {
    log.error("Verify key network error", { error: e });
    return { ok: false, message: `Chyba siete: ${e.message}` };
  }
  const text = await r.text();
  if (r.ok) {
    let tier = "aktívny";
    try { const d = JSON.parse(text); tier = d.tier || d.status || tier;
      log.info("Verify key OK", { tier, char_limit: d.character_limit, char_used: d.character_count }); } catch { /* ignore */ }
    return { ok: true, message: `Kľúč je platný (${tier}).` };
  }
  log.error("Verify key failed", { status: r.status, body: text.slice(0, 1000) });
  return { ok: false, message: r.status === 401 ? "Kľúč bol odmietnutý (401)." : errorMessage(r.status, text) };
}

/** One upload attempt. Resolves with JSON; rejects ApiError/CanceledError/TypeError(network). */
function transcribeOnce(apiKey, file, fileName, settings, signal, onStatus, onProgress, attempt) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of buildFormFields(settings)) form.append(k, v);
    form.append("file", file, fileName);
    const url = settings.enable_logging === false ? `${STT_ENDPOINT}?enable_logging=false` : STT_ENDPOINT;
    const note = attempt > 1 ? `pokus ${attempt}` : "";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = 0; // no timeout at all — long uploads/processing are fine
    xhr.setRequestHeader("xi-api-key", apiKey);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.upload.onload = () => onStatus(STATUS.PROCESSING, note);
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const t0 = performance.now();
    const done = () => signal.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      done();
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      if (xhr.status === 200) {
        log.info("STT response 200", { seconds: sec, bytes: xhr.responseText.length });
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new ApiError(200, `Neplatná JSON odpoveď: ${e.message}`)); }
        return;
      }
      const body = (xhr.responseText || "").slice(0, 5000);
      log.error("STT error response", { status: xhr.status, seconds: sec,
        request_id: xhr.getResponseHeader("request-id") || xhr.getResponseHeader("x-request-id"), body });
      reject(new ApiError(xhr.status, errorMessage(xhr.status, body), body));
    };
    xhr.onerror = () => { done(); reject(new TypeError("Chyba siete (spojenie prerušené)")); };
    xhr.onabort = () => { done(); reject(new CanceledError()); };

    onStatus(STATUS.UPLOADING, note);
    log.info("STT request", { attempt, file: fileName, size: file.size, type: file.type,
      key: maskKey(apiKey), form: buildFormFields(settings) });
    xhr.send(form);
  });
}

/** Wait until the browser reports being online again (or canceled). */
function waitOnline(signal) {
  if (navigator.onLine) return Promise.resolve(false);
  return new Promise((resolve) => {
    const on = () => { cleanup(); resolve(false); };
    const ab = () => { cleanup(); resolve(true); };
    const cleanup = () => { window.removeEventListener("online", on); signal.removeEventListener("abort", ab); };
    window.addEventListener("online", on);
    signal.addEventListener("abort", ab, { once: true });
  });
}

export async function transcribe(apiKey, file, fileName, settings, { signal, onStatus, onProgress }) {
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new CanceledError();
    try {
      return await transcribeOnce(apiKey.trim(), file, fileName, settings, signal, onStatus, onProgress, attempt);
    } catch (e) {
      if (e instanceof CanceledError || signal.aborted) throw new CanceledError();
      if (e instanceof ApiError && NON_RETRIABLE_STATUS.has(e.status)) throw e;
      if (e?.name === "NotReadableError" || e?.name === "NotFoundError") throw e; // file gone — retry can't help
      const delay = retryDelay(attempt);
      const offline = !navigator.onLine;
      log.warn(`attempt #${attempt} failed`, { kind: e instanceof ApiError ? "server" : "network", error: e, offline });
      onStatus(STATUS.RETRYING, `${e.message.slice(0, 90)} — ďalší pokus #${attempt + 1} o ${delay} s` +
        (offline ? " · čakám na internet" : ""));
      if (await sleep(delay, signal)) throw new CanceledError();
      if (await waitOnline(signal)) throw new CanceledError();
    }
  }
}
