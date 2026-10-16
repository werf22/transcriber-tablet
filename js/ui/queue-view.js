// queue-view.js — the "Fronta" list: one card per file with status + progress.
// PURPOSE: render jobs, track the checkbox selection and the "current" job
//          (the one shown in Náhľad). Tapping a card opens its preview.
// INPUTS:  queue (Queue), onOpen(job).  OUTPUTS: QueueView with .selected().
import { STATUS, STATUS_LABEL } from "../constants.js";
import { h, $, humanSize, humanDuration, plural } from "./dom.js";

function statusText(job) {
  const label = STATUS_LABEL[job.status] || job.status;
  if (job.status === STATUS.UPLOADING) {
    const pct = Math.round((job.progress || 0) * 100);
    return `${label} ${pct} %${job.message ? ` · ${job.message}` : ""}`;
  }
  if (job.status === STATUS.PROCESSING) return `${label}…${job.message ? ` · ${job.message}` : ""}`;
  return job.message ? `${label} · ${job.message}` : label;
}

export class QueueView {
  constructor(queue, onOpen) {
    this.queue = queue;
    this.onOpen = onOpen;
    this.list = $("#queue");
    this.checked = new Set();
    this.currentId = null;
    this.rows = new Map();
    $("#select-all").addEventListener("change", (e) => {
      this.checked = e.target.checked ? new Set(queue.jobs.map((j) => j.id)) : new Set();
      this.renderAll();
    });
  }

  selected() { return this.queue.jobs.filter((j) => this.checked.has(j.id)); }
  current() { return this.queue.jobs.find((j) => j.id === this.currentId) || null; }

  open(job) { this.currentId = job?.id ?? null; this.renderAll(); this.onOpen(job); }

  row(job) {
    const cb = h("input", { type: "checkbox", checked: this.checked.has(job.id), "aria-label": `Označiť ${job.name}`,
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => { e.target.checked ? this.checked.add(job.id) : this.checked.delete(job.id); this.syncSelectAll(); } });
    const li = h("li.job", { dataset: { id: job.id }, onclick: () => this.open(job) },
      h("label.check", { onclick: (e) => e.stopPropagation() }, cb),
      h("div.job-name", {}, job.name),
      h("div.job-meta", {},
        h("span", {}, job.duration ? humanDuration(job.duration) : "—"),
        h("span", {}, humanSize(job.size || 0))),
      h(`div.job-status.${job.status}`, {}, statusText(job)),
      h("div.bar", {}, h("span")));
    return li;
  }

  update(job) {
    const li = this.rows.get(job.id);
    if (!li) return this.renderAll();
    li.classList.toggle("current", job.id === this.currentId);
    li.querySelector(".job-meta span").textContent = job.duration ? humanDuration(job.duration) : "—";
    const st = li.querySelector(".job-status");
    st.className = `job-status ${job.status}`;
    st.textContent = statusText(job);
    const pct = job.status === STATUS.COMPLETE ? 100
      : job.status === STATUS.UPLOADING || job.status === STATUS.PROCESSING ? Math.round((job.progress || 0) * 100) : 0;
    const bar = li.querySelector(".bar");
    bar.hidden = pct === 0;
    bar.firstChild.style.width = `${pct}%`;
  }

  renderAll() {
    const ids = new Set(this.queue.jobs.map((j) => j.id));
    for (const id of [...this.checked]) if (!ids.has(id)) this.checked.delete(id);
    if (this.currentId && !ids.has(this.currentId)) { this.currentId = null; this.onOpen(null); }
    this.rows.clear();
    this.list.replaceChildren(...this.queue.jobs.map((j) => { const li = this.row(j); this.rows.set(j.id, li); return li; }));
    for (const j of this.queue.jobs) this.update(j);
    $("#empty").hidden = this.queue.jobs.length > 0;
    this.list.hidden = this.queue.jobs.length === 0; // empty hint sits at the top, not under an empty list
    this.syncSelectAll();
  }

  syncSelectAll() {
    const all = $("#select-all");
    all.checked = this.queue.jobs.length > 0 && this.checked.size === this.queue.jobs.length;
    all.indeterminate = this.checked.size > 0 && !all.checked;
  }
}

/** "3/5 hotovo · 1 prebieha · 1 chyba" (Mac: _refresh_overall). */
export function overallText(jobs) {
  if (!jobs.length) return "";
  const done = jobs.filter((j) => j.status === STATUS.COMPLETE).length;
  const failed = jobs.filter((j) => j.status === STATUS.FAILED).length;
  const running = jobs.filter((j) => [STATUS.PREPARING, STATUS.UPLOADING, STATUS.PROCESSING, STATUS.RETRYING].includes(j.status)).length;
  return [`${done}/${jobs.length} hotovo`, running && `${running} prebieha`, failed && plural(failed, "chyba", "chyby", "chýb")].filter(Boolean).join(" · ");
}
