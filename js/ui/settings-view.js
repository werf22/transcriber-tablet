// settings-view.js — "Nastavenia" tab: every Scribe parameter of the Mac app.
// PURPOSE: render the form from config.settings, collect it back (Mac:
//          _collect_settings), save on every change, reset to API defaults.
// INPUTS:  app {config, saveConfig()}.  OUTPUTS: SettingsView.collect().
import { MODELS, LANGUAGES, TIMESTAMPS, FILE_FORMATS, REDACTION_MODES, ENTITY_CATEGORIES,
  DEFAULT_SETTINGS, APP_VERSION, languageName } from "../constants.js";
import { parseKeyterms } from "../formdata.js";
import { exportLog, clearLog, log } from "../log.js";
import { downloadBlob } from "../export.js";
import { h, $, toast, confirmDialog, setStatus } from "./dom.js";

const parseIntOrNull = (s) => (/^\s*[+-]?\d+\s*$/.test(s || "") ? parseInt(s, 10) : null);
const parseFloatOrNull = (s) => { const t = (s || "").trim().replace(",", "."); return t && !Number.isNaN(Number(t)) ? Number(t) : null; };
const str = (v) => (v === null || v === undefined ? "" : String(v));

export class SettingsView {
  constructor(app) {
    this.app = app;
    this.root = $("#tab-settings");
    // Save on every change — on a tablet there is no "quit" to save on.
    // (Bound once here, not in render(), so a reset never doubles them.)
    this.root.addEventListener("change", () => this.save());
    this.root.addEventListener("input", (e) => { if (e.target.id === "s-keyterms") this.save(); });
    this.render();
  }

  field(label, control, hint) {
    return h("label.field", {}, h("span", {}, label), control, hint ? h("span.hint", {}, hint) : null);
  }
  select(id, options, value) {
    return h("select", { id }, options.map(([text, v]) => h("option", { value: v ?? "", selected: (v ?? "") === (value ?? "") }, text)));
  }
  check(id, label, value) {
    return h("label.check", {}, h("input", { type: "checkbox", id, checked: !!value }), label);
  }
  input(id, value, attrs = {}) { return h("input", { type: "text", id, value: str(value), ...attrs }); }

  render() {
    const s = this.app.config.settings;
    const langs = [["Automaticky rozpoznať", ""], ...LANGUAGES.map(([, c]) => [languageName(c), c])
      .sort((a, b) => a[0].localeCompare(b[0], "sk"))];
    const entityChecks = (prefix, chosen) => h("div.chips", {},
      ENTITY_CATEGORIES.map((c) => this.check(`${prefix}-${c}`, c, (chosen || []).includes(c))));

    this.root.replaceChildren(
      h("fieldset.section", {}, h("legend", {}, "Model a jazyk"),
        this.field("Model", this.select("s-model", MODELS, s.model_id)),
        this.field("Jazyk", this.select("s-lang", langs, s.language_code))),
      h("fieldset.section", {}, h("legend", {}, "Rečníci"),
        this.check("s-diarize", "Rozlišovať rečníkov", s.diarize),
        this.field("Počet rečníkov", this.input("s-num", s.num_speakers, { inputMode: "numeric", placeholder: "auto" }), "1 až 32; prázdne = automaticky"),
        this.field("Prah rozlíšenia (0,0 – 1,0)", this.input("s-thr", s.diarization_threshold, { inputMode: "decimal", placeholder: "predvolené" }), "Nižší = viac rečníkov; prázdne = predvolené API"),
        this.check("s-roles", "Rozpoznať roly (agent / zákazník) — +10 % cena", s.detect_speaker_roles)),
      h("fieldset.section", {}, h("legend", {}, "Výstup prepisu"),
        this.check("s-events", "Označovať zvuky (smiech, potlesk…)", s.tag_audio_events),
        this.field("Časové značky", this.select("s-ts", TIMESTAMPS, s.timestamps_granularity)),
        this.check("s-noverb", "Bez vyplňovacích slov (len Scribe v2)", s.no_verbatim)),
      h("fieldset.section", {}, h("legend", {}, "Pokročilé"),
        this.field("Teplota (0,0 – 2,0)", this.input("s-temp", s.temperature, { inputMode: "decimal", placeholder: "predvolené" })),
        this.field("Seed (opakovateľný výstup)", this.input("s-seed", s.seed, { inputMode: "numeric" })),
        this.check("s-multi", "Viackanálový režim (max 5 kanálov, limit 1 h)", s.use_multi_channel),
        this.field("Formát vstupu", this.select("s-ff", FILE_FORMATS, s.file_format)),
        this.check("s-logging", "Logovanie na strane ElevenLabs (VYP = zero-retention)", s.enable_logging)),
      h("fieldset.section", {}, h("legend", {}, "Kľúčové výrazy (Scribe v2, max 1000; +20 % cena)"),
        h("p.muted", {}, "Jeden výraz na riadok ALEBO oddelené čiarkou. Mená, názvy produktov, zriedkavé slová."),
        h("textarea", { id: "s-keyterms", value: (s.keyterms || []).join("\n"), spellcheck: false })),
      h("fieldset.section", {}, h("legend", {}, "Detekcia a začiernenie entít (+30 % cena)"),
        h("p", {}, "Detegovať:"), entityChecks("s-det", s.entity_detection),
        h("p", {}, "Začierniť:"), entityChecks("s-red", s.entity_redaction),
        this.field("Štýl začiernenia", this.select("s-redmode", REDACTION_MODES.map((m) => [m, m]), s.entity_redaction_mode))),
      h("div.actions", {},
        h("button.btn", { type: "button", onclick: () => this.reset() }, "Obnoviť predvolené hodnoty API")),
      h("fieldset.section", {}, h("legend", {}, "Diagnostika"),
        h("p.muted", {}, `Verzia ${APP_VERSION}. Log obsahuje požiadavky a chyby (bez API kľúča a bez textu prepisov).`),
        h("div.actions", {},
          h("button.btn", { type: "button", onclick: () => downloadBlob({ filename: `transcriber-log-${Date.now()}.jsonl`, blob: new Blob([exportLog()], { type: "application/x-ndjson" }) }) }, "Stiahnuť log"),
          h("button.btn", { type: "button", onclick: () => { clearLog(); toast("Log vymazaný."); } }, "Vymazať log"),
          h("button.btn.btn-danger", { type: "button", onclick: () => this.app.forgetKey() }, "Zabudnúť API kľúč"))),
    );
  }

  collect() {
    const v = (id) => $(`#${id}`, this.root).value;
    const c = (id) => $(`#${id}`, this.root).checked;
    return {
      model_id: v("s-model") || "scribe_v2",
      language_code: v("s-lang") || null,
      num_speakers: parseIntOrNull(v("s-num")),
      diarize: c("s-diarize"),
      diarization_threshold: parseFloatOrNull(v("s-thr")),
      tag_audio_events: c("s-events"),
      timestamps_granularity: v("s-ts") || "word",
      temperature: parseFloatOrNull(v("s-temp")),
      seed: parseIntOrNull(v("s-seed")),
      use_multi_channel: c("s-multi"),
      no_verbatim: c("s-noverb"),
      detect_speaker_roles: c("s-roles"),
      enable_logging: c("s-logging"),
      file_format: v("s-ff") || "other",
      keyterms: parseKeyterms(v("s-keyterms")),
      entity_detection: ENTITY_CATEGORIES.filter((x) => c(`s-det-${x}`)),
      entity_redaction: ENTITY_CATEGORIES.filter((x) => c(`s-red-${x}`)),
      entity_redaction_mode: v("s-redmode"),
    };
  }

  save() {
    this.app.config.settings = this.collect();
    this.app.saveConfig();
  }

  async reset() {
    if (!(await confirmDialog("Obnoviť všetky parametre prepisu na predvolené hodnoty API?"))) return;
    this.app.config.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.app.saveConfig();
    this.render();
    log.info("Settings reset to API defaults");
    setStatus("Nastavenia obnovené na predvolené hodnoty API.");
  }
}
