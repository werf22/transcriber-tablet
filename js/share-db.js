// share-db.js — hand-off box for files shared INTO the app from other apps
// (Android share sheet → Transcriber). Used by both sw.js and share.js, so it
// must not import anything that touches `window`/`document`.
const DB = "transcriber-share";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("inbox", { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function stash(files) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction("inbox", "readwrite");
    for (const f of files) t.objectStore("inbox").add(f);
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}

/** Return and remove everything waiting in the inbox. */
export async function drain() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("inbox", "readwrite");
    const s = t.objectStore("inbox");
    const req = s.getAll();
    req.onsuccess = () => s.clear();
    t.oncomplete = () => resolve(req.result || []);
    t.onerror = () => reject(t.error);
  });
}
