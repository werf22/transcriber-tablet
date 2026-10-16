// export-view.js — "Export" tab: format, options, export current / all.
// PURPOSE: Mac _build_export_tab + _export_jobs. On the tablet a file goes to
//          the Downloads folder (or the Android share sheet); "all" = one ZIP.
// INPUTS:  app {config, saveConfig, queue, queueView}.
import { EXPORT_FORMATS } from "../constants.js";
import { exportJob, exportZip, downloadBlob, shareBlob } from "../export.js";
import { log } from "../log.js";
import { h, $, toast, setStatus, plural } from "./dom.js";

export class ExportView {
  constructor(app) {
    this.app = app;
    this.root = $("#tab-export");
    this.render();
  }

  render() {
    const e = this.app.config.export;
    const fmt = h("select", { id: "x-format" }, EXPORT_FORMATS.map((f) => h("option", { value: f, selected: f === e.format }, f)));
    const merge = h("input", { type: "checkbox", id: "x-merge", checked: e.merge_speaker_paragraphs });
    const ts = h("input", { type: "checkbox", id: "x-ts", checked: e.include_timestamps });
    const persist = () => {
      Object.assign(this.app.config.export, { format: fmt.value, merge_speaker_paragraphs: merge.checked, include_timestamps: ts.checked });
      this.app.saveConfig();
      this.app.previewView.show(this.app.queueView.current()); // timestamps toggle the preview too
    };
    for (const el of [fmt, merge, ts]) el.addEventListener("change", persist);

    this.root.replaceChildren(
      h("fieldset.section", {}, h("legend", {}, "Možnosti exportu"),
        h("label.field", {}, h("span", {}, "Formát"), fmt),
        h("label.check", {}, merge, "Spájať po sebe idúce vety rečníka do odseku (s menami)"),
        h("label.check", {}, ts, "Zahrnúť časové značky"),
        h("p.muted", {}, "Súbory sa uložia do priečinka Stiahnuté súbory (Downloads). „Zdieľať“ ich pošle priamo do Gmailu, na Disk, do WhatsAppu…")),
      h("div.actions", {},
        h("button.btn.btn-primary", { type: "button", onclick: () => this.exportCurrent(false) }, "Exportovať aktuálny"),
        h("button.btn", { type: "button", onclick: () => this.exportCurrent(true) }, "Zdieľať aktuálny"),
        h("button.btn", { type: "button", onclick: () => this.exportAll(false) }, "Exportovať všetky hotové (ZIP)"),
        h("button.btn", { type: "button", onclick: () => this.exportAll(true) }, "Zdieľať všetky (ZIP)")),
    );
  }

  opts() {
    const e = this.app.config.export;
    return { merge: e.merge_speaker_paragraphs, timestamps: e.include_timestamps };
  }

  async deliver(file, share) {
    if (share && (await shareBlob(file))) return "zdieľaný";
    if (share) toast("Toto zariadenie nevie zdieľať súbory — ukladám do Stiahnutých súborov.");
    downloadBlob(file);
    return "uložený do Stiahnutých súborov";
  }

  async exportCurrent(share) {
    const job = this.app.queueView.current();
    if (!job?.response) { toast("Vyber vo fronte hotový prepis (ťukni naň)."); return; }
    const fmt = this.app.config.export.format;
    try {
      setStatus(`Exportujem ${job.name}…`);
      const file = await exportJob(job, fmt, this.opts());
      const how = await this.deliver(file, share);
      log.info("Export ok", { format: fmt, bytes: file.blob.size });
      setStatus(`${file.filename} ${how}.`);
      toast(`${file.filename} ${how}.`);
    } catch (e) {
      log.error("Export failed", { format: fmt, error: e });
      setStatus("Export zlyhal.");
      toast(`Export zlyhal: ${e.message}`, { error: true });
    }
  }

  async exportAll(share) {
    const done = this.app.queue.jobs.filter((j) => j.response);
    if (!done.length) { toast("Zatiaľ nie sú žiadne hotové prepisy."); return; }
    const fmt = this.app.config.export.format;
    try {
      setStatus(`Exportujem: ${plural(done.length, "prepis", "prepisy", "prepisov")}…`);
      const zip = await exportZip(done, fmt, this.opts());
      if (zip.count) {
        const how = await this.deliver(zip, share);
        setStatus(`${zip.filename} (${plural(zip.count, "prepis", "prepisy", "prepisov")}) — ${how}.`);
      }
      if (zip.errors.length) {
        log.error("Export all: some failed", { errors: zip.errors });
        toast(`Niektoré exporty zlyhali:\n${zip.errors.join("\n")}`, { error: true });
      } else toast(`Exportované: ${plural(zip.count, "prepis", "prepisy", "prepisov")}.`);
    } catch (e) {
      log.error("Export all failed", { error: e });
      toast(`Export zlyhal: ${e.message}`, { error: true });
    }
  }
}
