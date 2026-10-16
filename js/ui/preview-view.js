// preview-view.js — "Náhľad a rečníci": transcript of the current job and the
// speaker-name mapping (Mac: _refresh_preview + _render_speaker_mapping).
// INPUTS:  app {queue, config}.  OUTPUTS: PreviewView.show(job).
import { STATUS_LABEL } from "../constants.js";
import { buildParagraphs, extractSpeakers, formatTimestamp, fmt2 } from "../format.js";
import { h, $, humanDuration, setStatus, toast } from "./dom.js";

export class PreviewView {
  constructor(app) {
    this.app = app;
    this.root = $("#tab-preview");
    this.job = null;
    this.show(null);
  }

  show(job) {
    this.job = job;
    if (!job) {
      this.root.replaceChildren(h("p.muted", {}, "Vyber súbor vo fronte."));
      return;
    }
    const head = h("div.preview-head", {}, h("h3", {}, job.name));
    if (!job.response) {
      this.root.replaceChildren(head, h("p", {}, `Stav: ${STATUS_LABEL[job.status] || job.status}`),
        h("p.muted", {}, job.message || "Prepis sa zobrazí, keď bude hotový."));
      return;
    }
    const r = job.response;
    const meta = [`jazyk: ${r.language_code || "?"}`];
    if (typeof r.language_probability === "number") meta.push(`istota: ${fmt2(r.language_probability)}`);
    if (job.duration) meta.push(`dĺžka: ${humanDuration(job.duration)}`);
    head.append(h("p.muted", {}, meta.join("  ·  ")));

    const withTs = this.app.config.export.include_timestamps;
    const text = h("div.transcript", {}, buildParagraphs(r, job.speaker_names).map((p) => [
      h("span.spk", {}, p.label, withTs ? h("span.ts", {}, `[${formatTimestamp(p.start, ".")}]`) : null),
      document.createTextNode(p.text),
    ]));

    const speakers = extractSpeakers(r);
    const side = h("div", {}, h("h3", {}, "Mená rečníkov"));
    if (!speakers.length) side.append(h("p.muted", {}, "(Tento prepis neobsahuje rečníkov.)"));
    else {
      side.append(h("p.muted", {}, "Priraď každému ID meno. Zmena sa prejaví v náhľade aj v exporte."));
      for (const sid of speakers) {
        side.append(h("label.speaker-row", {}, h("code", {}, sid),
          h("input", { type: "text", dataset: { sid }, value: job.speaker_names?.[sid] || "", placeholder: "meno",
            onkeydown: (e) => { if (e.key === "Enter") this.apply(); } })));
      }
      side.append(h("button.btn.btn-primary", { type: "button", onclick: () => this.apply() }, "Použiť mená"));
    }
    this.root.replaceChildren(head, h("div.preview-grid", {}, text, side));
  }

  apply() {
    const job = this.job;
    if (!job) return;
    const names = {};
    for (const el of this.root.querySelectorAll("input[data-sid]")) names[el.dataset.sid] = el.value.trim();
    this.app.queue.updateNames(job, names);
    this.show(job);
    setStatus("Mená rečníkov použité.");
    toast("Mená rečníkov použité.");
  }
}
