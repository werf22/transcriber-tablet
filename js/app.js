// app.js — bootstrap: wires config, queue, views, toolbar, API key, PWA bits.
// PURPOSE: the tablet equivalent of TranscriberApp.__init__ in transcriber.py.
// ALSO:    keeps the screen awake while uploads run (Android would otherwise
//          suspend the app), receives files shared from other apps, and
//          registers the service worker (offline + installable).
import { APP_VERSION, STATUS } from "./constants.js";
import { loadConfig, saveConfig, requestPersistence } from "./store.js";
import { verifyKey } from "./api.js";
import { Queue, isActive, isStartable } from "./queue.js";
import { log } from "./log.js";
import { $, toast, setStatus, confirmDialog, plural } from "./ui/dom.js";
import { QueueView, overallText } from "./ui/queue-view.js";
import { SettingsView } from "./ui/settings-view.js";
import { PreviewView } from "./ui/preview-view.js";
import { ExportView } from "./ui/export-view.js";
import { takeSharedFiles } from "./share.js";
import { WakeLock } from "./wakelock.js";

const app = {
  config: loadConfig(),
  saveConfig() {
    try { saveConfig(this.config); }
    catch (e) { toast(`Nastavenia sa nepodarilo uložiť: ${e.message}`, { error: true }); }
  },
  async forgetKey() {
    if (!(await confirmDialog("Naozaj vymazať API kľúč z tohto tabletu?"))) return;
    this.config.api_key = "";
    this.saveConfig();
    setApiStatus(null, "neoverené");
    toast("API kľúč vymazaný.");
  },
};

function setApiStatus(ok, msg) {
  const chip = $("#api-status");
  chip.textContent = `API: ${ok === true ? "✓ " : ok === false ? "✗ " : ""}${msg}`;
  chip.className = `chip ${ok === true ? "ok" : ok === false ? "err" : ""}`;
}

async function checkKey() {
  setApiStatus(null, "overujem…");
  const r = await verifyKey(app.config.api_key);
  setApiStatus(r.ok, r.message);
  return r.ok;
}

function openKeyDialog() {
  const d = $("#key-dialog"), input = $("#key-input");
  input.value = app.config.api_key || "";
  input.type = "password";
  $("#key-show").checked = false;
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", async () => {
    if (d.returnValue !== "save") return;
    app.config.api_key = input.value.trim();
    app.saveConfig();
    await checkKey();
  }, { once: true });
}

const wake = new WakeLock();
function onChange(job) {
  if (job) app.queueView.update(job); else app.queueView.renderAll();
  $("#overall").textContent = overallText(app.queue.jobs);
  if (job && job.id === app.queueView.currentId) app.previewView.show(job);
  if (job?.status === STATUS.COMPLETE) setStatus(`Hotovo: ${job.name}`);
  if (job?.status === STATUS.FAILED) toast(`${job.name}: ${job.message}`, { error: true });
  if (job?.status === STATUS.RETRYING) setStatus(`${job.name}: ${job.message}`);
  wake.set(app.queue.running > 0);
}

function startJobs(jobs) {
  if (!app.config.api_key.trim()) { toast("Najprv nastav ElevenLabs API kľúč."); openKeyDialog(); return; }
  const todo = jobs.filter(isStartable);
  if (!todo.length) { setStatus("Žiadne súbory na spustenie."); return; }
  app.queue.start(todo);
}

function bindToolbar() {
  $("#file-input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) { await app.queue.addFiles(files); setStatus(`Pridané: ${plural(files.length, "súbor", "súbory", "súborov")}.`); }
  });
  $("#btn-start-all").onclick = () => startJobs(app.queue.jobs);
  $("#btn-stop-all").onclick = () => app.queue.cancel(app.queue.jobs);
  $("#btn-start-sel").onclick = () => startJobs(app.queueView.selected());
  $("#btn-cancel-sel").onclick = () => app.queue.cancel(app.queueView.selected());
  $("#btn-remove-sel").onclick = async () => {
    const sel = app.queueView.selected();
    if (!sel.length) return;
    if (sel.some(isActive) && !(await confirmDialog(`Práve sa spracúva: ${plural(sel.filter(isActive).length, "súbor", "súbory", "súborov")}. Zrušiť a odstrániť?`))) return;
    app.queue.remove(sel);
  };
  $("#btn-clear-done").onclick = () => app.queue.remove(app.queue.jobs.filter((j) => j.status === STATUS.COMPLETE));
  const conc = (d) => {
    app.config.max_concurrent = Math.min(8, Math.max(1, app.config.max_concurrent + d)); // knob: 1–8
    $("#conc-value").textContent = app.config.max_concurrent;
    app.saveConfig();
    app.queue.pump();
  };
  $("#conc-minus").onclick = () => conc(-1);
  $("#conc-plus").onclick = () => conc(+1);
  $("#conc-value").textContent = app.config.max_concurrent;
  $("#btn-key").onclick = openKeyDialog;
  $("#key-show").onchange = (e) => { $("#key-input").type = e.target.checked ? "text" : "password"; };

  for (const tab of document.querySelectorAll(".tab")) {
    tab.onclick = () => showTab(tab.dataset.tab);
  }
  // Drag & drop works too (tablet with mouse / desktop browser).
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) app.queue.addFiles(files);
  });
}

function showTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const b of document.querySelectorAll(".tab-body")) b.hidden = b.id !== `tab-${name}`;
}

async function main() {
  log.info("=== Transcriber (tablet) starting ===", { version: APP_VERSION, ua: navigator.userAgent });
  $("#version").textContent = `v${APP_VERSION}`;
  app.queue = new Queue(() => app.config, onChange);
  app.queueView = new QueueView(app.queue, (job) => {
    app.previewView.show(job);
    if (!job) return;
    showTab("preview");
    // Portrait: the preview sits BELOW the queue — bring it on screen.
    if (matchMedia("(max-width: 900px)").matches) $(".detail-pane").scrollIntoView({ behavior: "smooth" });
  });
  app.settingsView = new SettingsView(app);
  app.previewView = new PreviewView(app);
  app.exportView = new ExportView(app);
  bindToolbar();
  app.queueView.renderAll();
  await app.queue.restore();

  const shared = await takeSharedFiles();
  if (shared.length) { await app.queue.addFiles(shared); toast(`Prijaté zo zdieľania: ${plural(shared.length, "súbor", "súbory", "súborov")}.`); }

  requestPersistence();
  if (app.config.api_key) checkKey(); else { setApiStatus(null, "chýba kľúč"); openKeyDialog(); }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { type: "module" }).catch((e) => log.error("Service worker registration failed", { error: e }));
  }
}

main().catch((e) => {
  log.error("Startup failed", { error: e });
  toast(`Aplikácia sa nespustila správne: ${e.message}`, { error: true });
});
