// store.js — persistence on the tablet.
// PURPOSE: config (API key + settings) in localStorage; jobs (transcripts and
//          not-yet-finished audio files) in IndexedDB, so nothing is lost when
//          Android kills the app in the background.
// INPUTS/OUTPUTS: loadConfig/saveConfig, putJob/deleteJob/loadJobs.
// NOTE:    everything stays ON THE DEVICE — nothing here is sent anywhere.
import { DEFAULT_CONFIG } from "./constants.js";
import { log } from "./log.js";

const CONFIG_KEY = "transcriber.config";
const clone = (o) => JSON.parse(JSON.stringify(o));

function deepUpdate(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepUpdate(target[k], v);
    } else target[k] = v;
  }
  return target;
}

export function loadConfig() {
  const merged = clone(DEFAULT_CONFIG);
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) deepUpdate(merged, JSON.parse(raw));
  } catch (e) {
    log.error("Config unreadable — using defaults", { error: e });
  }
  return merged;
}

export function saveConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
  catch (e) { log.error("Config save failed", { error: e }); throw e; }
}

// --- IndexedDB -------------------------------------------------------------
const DB_NAME = "transcriber";
const DB_VERSION = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("jobs", { keyPath: "id" }); // metadata + transcript
        req.result.createObjectStore("files");                   // audio Blob, key = job id
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn, store = "jobs") {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Persist a job record (metadata + transcript, never the audio). */
export async function putJob(record) {
  try { await tx("readwrite", (s) => s.put(record)); }
  catch (e) {
    // Quota exceeded for a huge video: keep the job in memory only, say so loudly.
    log.error("Could not persist job", { id: record.id, name: record.name, error: e });
    throw e;
  }
}

export async function deleteJob(id) {
  await tx("readwrite", (s) => s.delete(id));
  await deleteFile(id);
}

/** Audio is written ONCE when added and deleted when the transcript is done —
 *  a 1 GB video is never re-copied on status changes. */
export const putFile = (id, blob) => tx("readwrite", (s) => s.put(blob, id), "files");
export const getFile = (id) => tx("readonly", (s) => s.get(id), "files");
export const deleteFile = (id) => tx("readwrite", (s) => s.delete(id), "files");

export async function loadJobs() {
  try {
    const all = await tx("readonly", (s) => s.getAll());
    return (all || []).sort((a, b) => (a.added_at || 0) - (b.added_at || 0));
  } catch (e) {
    log.error("Could not load saved jobs", { error: e });
    return [];
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      log.info("Persistent storage requested", { granted: await navigator.storage.persist() });
    }
  } catch (e) { log.warn("storage.persist failed", { error: e }); }
}
