// formdata.js — settings → multipart form fields for POST /v1/speech-to-text.
// PURPOSE: exact port of _build_form_data() in transcriber.py.
// INPUTS:  settings object (see DEFAULT_SETTINGS).  OUTPUTS: [[key, value], ...].
// WHY:     array params (keyterms, entity_*) MUST be repeated fields, not a JSON
//          string — the API answers 400 invalid_parameter otherwise.

const isBlank = (v) => v === null || v === undefined || v === "";

/** Python str(float): 0.5 → "0.5", 1 → "1.0". */
const pyFloat = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

/** Python int("3") / int(3.0); null when it would raise. */
function pyInt(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).trim();
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** Python float("0.3"); null when it would raise. */
function pyParseFloat(v) {
  if (typeof v === "number") return v;
  const s = String(v).trim();
  return s !== "" && !Number.isNaN(Number(s)) ? Number(s) : null;
}

export function buildFormFields(settings) {
  const data = [];
  const add = (key, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === "boolean") { data.push([key, value ? "true" : "false"]); return; }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isBlank(v)) continue;
        data.push([key, typeof v === "boolean" ? (v ? "true" : "false") : String(v)]);
      }
      return;
    }
    data.push([key, String(value)]);
  };

  add("model_id", settings.model_id || "scribe_v2");
  add("language_code", settings.language_code);
  add("tag_audio_events", settings.tag_audio_events);

  const ns = settings.num_speakers;
  if (!isBlank(ns) && ns !== 0) {
    const n = pyInt(ns);
    if (n !== null) add("num_speakers", String(n));
  }

  add("timestamps_granularity", settings.timestamps_granularity);
  add("diarize", settings.diarize);

  const th = settings.diarization_threshold;
  if (!isBlank(th) && th !== 0) {
    const f = pyParseFloat(th);
    if (f !== null) add("diarization_threshold", pyFloat(f));
  }

  const temp = settings.temperature;
  if (!isBlank(temp)) {
    const f = pyParseFloat(temp);
    if (f !== null) add("temperature", pyFloat(f));
  }

  const seed = settings.seed;
  if (!isBlank(seed)) {
    const n = pyInt(seed);
    if (n !== null) add("seed", String(n));
  }

  add("use_multi_channel", settings.use_multi_channel);
  if (settings.model_id === "scribe_v2") add("no_verbatim", settings.no_verbatim);
  add("detect_speaker_roles", settings.detect_speaker_roles);

  const ff = settings.file_format;
  if (ff && ff !== "other") add("file_format", ff);

  const keyterms = (settings.keyterms || []).filter(Boolean);
  if (keyterms.length) add("keyterms", keyterms.slice(0, 1000));

  const ents = (settings.entity_detection || []).filter(Boolean);
  if (ents.length) add("entity_detection", ents);

  const redact = (settings.entity_redaction || []).filter(Boolean);
  if (redact.length) {
    add("entity_redaction", redact);
    add("entity_redaction_mode", settings.entity_redaction_mode);
  }
  return data;
}

/** Split keyterms on newline OR comma, strip whitespace + trailing dots, dedupe. */
export function parseKeyterms(raw) {
  const out = [];
  for (const line of (raw || "").split(/\r\n|\r|\n/)) {
    for (const term of line.split(",")) {
      const t = term.trim().replace(/^\.+|\.+$/g, "").trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}
