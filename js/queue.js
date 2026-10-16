// queue.js — job queue with a parallel-upload limit (Mac: ThreadPoolExecutor).
// PURPOSE: add files, start/cancel/remove jobs, run at most N at once, persist
//          every state change so a restart of the app resumes unfinished work.
// INPUTS:  getConfig() → {api_key, max_concurrent, settings}; onChange(job|null).
// OUTPUTS: Queue instance; UI subscribes via onChange and reads queue.jobs.
import { STATUS } from "./constants.js";
import { transcribe, CanceledError } from "./api.js";
import { extractSpeakers } from "./format.js";
import { putJob, deleteJob, loadJobs, putFile, getFile, deleteFile } from "./store.js";
import { log } from "./log.js";

const ACTIVE = new Set([STATUS.QUEUED, STATUS.PREPARING, STATUS.UPLOADING, STATUS.PROCESSING, STATUS.RETRYING]);
const STARTABLE = new Set([STATUS.PENDING, STATUS.FAILED, STATUS.CANCELED]);
export const isActive = (j) => ACTIVE.has(j.status);
export const isStartable = (j) => STARTABLE.has(j.status) && !!j.file;
const META_SKIP = new Set(["file", "progress"]); // never persisted with the job record

/** Read the media duration in the browser (Mac: ffprobe). null if unknown. */
function probeDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const finish = (v) => { URL.revokeObjectURL(url); el.removeAttribute("src"); resolve(v); };
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), 15000);
    el.src = url;
  });
}

export class Queue {
  constructor(getConfig, onChange) {
    this.getConfig = getConfig;
    this.onChange = onChange;
    this.jobs = [];            // display order
    this.controllers = new Map(); // job id → AbortController
    this.waiting = [];         // ids queued for a free slot
  }

  /** Restore saved jobs; jobs that were running when the app died restart. */
  async restore() {
    const saved = await loadJobs();
    const resume = [];
    for (const rec of saved) {
      const job = { ...rec, progress: 0, file: null };
      if (job.status !== STATUS.COMPLETE) {
        try { job.file = (await getFile(job.id)) || null; }
        catch (e) { log.error("Could not read saved audio", { id: job.id, error: e }); }
        if (!job.file) job.message = "Zvukový súbor sa nezachoval — pridaj ho znova.";
      }
      if (ACTIVE.has(job.status)) {
        job.status = STATUS.PENDING;
        job.message = "Obnovené po reštarte aplikácie";
        if (job.file) resume.push(job);
      }
      this.jobs.push(job);
    }
    log.info("Queue restored", { jobs: saved.length, resumed: resume.length });
    this.onChange(null);
    if (resume.length) this.start(resume);
  }

  save(job) {
    const rec = Object.fromEntries(Object.entries(job).filter(([k]) => !META_SKIP.has(k)));
    putJob(rec).catch(() => {});
  }

  saveFile(job) {
    putFile(job.id, job.file).catch((e) => {
      log.error("Could not persist audio", { id: job.id, size: job.size, error: e });
      job.message = "Pozor: súbor sa nezmestil do úložiska tabletu — ak sa appka zavrie, treba ho pridať znova.";
      this.onChange(job);
    });
  }

  set(job, status, message = job.message) {
    job.status = status;
    job.message = message;
    this.onChange(job);
  }

  async addFiles(files) {
    for (const file of files) {
      const job = { id: crypto.randomUUID().replace(/-/g, ""), name: file.name, size: file.size,
        type: file.type, file, duration: null, status: STATUS.PENDING, message: "", progress: 0,
        response: null, speaker_names: {}, added_at: Date.now() };
      this.jobs.push(job);
      this.onChange(job);
      this.save(job);
      this.saveFile(job);
      probeDuration(file).then((d) => { if (d !== null) { job.duration = d; this.onChange(job); this.save(job); } });
    }
    log.info("Files added", { count: files.length });
  }

  start(jobs) {
    for (const job of jobs.filter(isStartable)) {
      job.response = null;
      this.set(job, STATUS.QUEUED, "");
      this.save(job); // so a restart knows this job was meant to run
      this.waiting.push(job.id);
    }
    this.pump();
  }

  pump() {
    const limit = Math.max(1, Number(this.getConfig().max_concurrent) || 4);
    while (this.controllers.size < limit && this.waiting.length) {
      const id = this.waiting.shift(); // shift ONCE — not inside find(), which would drain the queue
      const job = this.jobs.find((j) => j.id === id);
      if (job && job.status === STATUS.QUEUED) this.run(job);
    }
  }

  async run(job) {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    const cfg = this.getConfig();
    const settings = JSON.parse(JSON.stringify(cfg.settings));
    job.started_at = Date.now();
    this.set(job, STATUS.PREPARING, "");
    log.info("Job start", { id: job.id, file: job.name, size: job.size });
    try {
      const response = await transcribe(cfg.api_key, job.file, job.name, settings, {
        signal: ctrl.signal,
        onStatus: (s, m = "") => { job.progress = s === STATUS.UPLOADING ? 0 : job.progress; this.set(job, s, m); },
        onProgress: (done, total) => { job.progress = done / Math.max(total, 1); this.onChange(job); },
      });
      job.response = response;
      job.speaker_names = Object.fromEntries(extractSpeakers(response).map((s) => [s, ""]));
      job.finished_at = Date.now();
      job.file = null; // transcript is safe — free the audio copy on the tablet
      deleteFile(job.id).catch((e) => log.warn("Could not free audio", { id: job.id, error: e }));
      this.set(job, STATUS.COMPLETE, "");
      log.info("Job complete", { id: job.id, seconds: ((job.finished_at - job.started_at) / 1000).toFixed(1) });
    } catch (e) {
      job.finished_at = Date.now();
      if (e instanceof CanceledError) { this.set(job, STATUS.CANCELED, ""); log.info("Job canceled", { id: job.id }); }
      else { this.set(job, STATUS.FAILED, e.message || String(e)); log.error("Job FAILED", { id: job.id, file: job.name, error: e }); }
    } finally {
      this.controllers.delete(job.id);
      if (this.jobs.includes(job)) this.save(job);
      this.pump();
    }
  }

  cancel(jobs) {
    for (const job of jobs.filter(isActive)) {
      this.waiting = this.waiting.filter((id) => id !== job.id);
      const c = this.controllers.get(job.id);
      if (c) { this.set(job, job.status, "Ruší sa…"); c.abort(); }
      else this.set(job, STATUS.CANCELED, "");
    }
  }

  remove(jobs) {
    this.cancel(jobs);
    const ids = new Set(jobs.map((j) => j.id));
    this.jobs = this.jobs.filter((j) => !ids.has(j.id));
    for (const id of ids) deleteJob(id).catch((e) => log.error("Delete job failed", { id, error: e }));
    this.onChange(null);
  }

  updateNames(job, names) { job.speaker_names = names; this.save(job); this.onChange(job); }

  get running() { return this.jobs.filter(isActive).length; }
}
