// constants.js — single source of truth for the tablet (PWA) Transcriber.
// PURPOSE: API endpoints, language/model lists, default settings, retry policy.
// INPUTS:  none.  OUTPUTS: exported constants used by every other module.
// TWEAK:   values marked "knob" are safe to change; keep them in sync with the
//          Mac app (../transcriber.py) so both versions behave the same.

export const APP_NAME = "ElevenLabs Transcriber";
export const APP_VERSION = "1.0.0-tablet";

export const API_BASE = "https://api.elevenlabs.io/v1";
export const STT_ENDPOINT = `${API_BASE}/speech-to-text`;

// Formats the ElevenLabs STT API accepts natively (same list as the Mac app).
// The Mac app converts anything else with ffmpeg; the tablet has no ffmpeg,
// so other extensions are still sent and the API's own error is shown.
export const NATIVE_EXTS = new Set([
  ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".aiff", ".aif",
  ".webm", ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".mpeg", ".mpg",
  ".3gp", ".3gpp",
]);

// ISO 639-3 codes supported by Scribe. English names are the fallback when
// the browser cannot translate a code into Slovak (see languageName()).
export const LANGUAGES = [
  ["Afrikaans", "afr"], ["Amharic", "amh"], ["Arabic", "ara"], ["Armenian", "hye"],
  ["Assamese", "asm"], ["Asturian", "ast"], ["Azerbaijani", "aze"], ["Belarusian", "bel"],
  ["Bengali", "ben"], ["Bosnian", "bos"], ["Bulgarian", "bul"], ["Burmese", "mya"],
  ["Cantonese", "yue"], ["Catalan", "cat"], ["Cebuano", "ceb"], ["Chichewa", "nya"],
  ["Croatian", "hrv"], ["Czech", "ces"], ["Danish", "dan"], ["Dutch", "nld"],
  ["English", "eng"], ["Estonian", "est"], ["Filipino", "fil"], ["Finnish", "fin"],
  ["French", "fra"], ["Fulah", "ful"], ["Galician", "glg"], ["Ganda", "lug"],
  ["Georgian", "kat"], ["German", "deu"], ["Greek", "ell"], ["Gujarati", "guj"],
  ["Hausa", "hau"], ["Hebrew", "heb"], ["Hindi", "hin"], ["Hungarian", "hun"],
  ["Icelandic", "isl"], ["Igbo", "ibo"], ["Indonesian", "ind"], ["Irish", "gle"],
  ["Italian", "ita"], ["Japanese", "jpn"], ["Javanese", "jav"], ["Kabuverdianu", "kea"],
  ["Kannada", "kan"], ["Kazakh", "kaz"], ["Khmer", "khm"], ["Korean", "kor"],
  ["Kurdish", "kur"], ["Kyrgyz", "kir"], ["Lao", "lao"], ["Latvian", "lav"],
  ["Lingala", "lin"], ["Lithuanian", "lit"], ["Luo", "luo"], ["Luxembourgish", "ltz"],
  ["Macedonian", "mkd"], ["Malay", "msa"], ["Malayalam", "mal"], ["Maltese", "mlt"],
  ["Mandarin Chinese", "zho"], ["Maori", "mri"], ["Marathi", "mar"], ["Mongolian", "mon"],
  ["Nepali", "nep"], ["Northern Sotho", "nso"], ["Norwegian", "nor"], ["Occitan", "oci"],
  ["Odia", "ori"], ["Pashto", "pus"], ["Persian", "fas"], ["Polish", "pol"],
  ["Portuguese", "por"], ["Punjabi", "pan"], ["Romanian", "ron"], ["Russian", "rus"],
  ["Serbian", "srp"], ["Shona", "sna"], ["Sindhi", "snd"], ["Slovak", "slk"],
  ["Slovenian", "slv"], ["Somali", "som"], ["Spanish", "spa"], ["Swahili", "swa"],
  ["Swedish", "swe"], ["Tajik", "tgk"], ["Tamil", "tam"], ["Telugu", "tel"],
  ["Thai", "tha"], ["Turkish", "tur"], ["Ukrainian", "ukr"], ["Umbundu", "umb"],
  ["Urdu", "urd"], ["Uzbek", "uzb"], ["Vietnamese", "vie"], ["Welsh", "cym"],
  ["Wolof", "wol"], ["Xhosa", "xho"], ["Zulu", "zul"],
];

export const MODELS = [["Scribe v2 (odporúčaný)", "scribe_v2"], ["Scribe v1", "scribe_v1"]];
export const FILE_FORMATS = [["Automaticky (other)", "other"], ["Raw PCM 16-bit 16 kHz", "pcm_s16le_16"]];
export const TIMESTAMPS = [["žiadne", "none"], ["slová", "word"], ["znaky", "character"]];
export const REDACTION_MODES = ["enumerated_entity_type", "entity_type", "redacted"];
export const ENTITY_CATEGORIES = ["all", "pii", "phi", "pci", "other", "offensive_language"];
export const EXPORT_FORMATS = ["TXT", "Markdown", "PDF", "DOCX", "SRT", "VTT", "JSON (raw)"];

// Retry policy — never give up (same as Mac). Backoff 5 s → 5 min, then flat.
export const RETRY_BASE_DELAY_SEC = 5;   // knob
export const RETRY_MAX_DELAY_SEC = 300;  // knob

// HTTP statuses that retrying cannot fix — the job fails and shows why.
export const NON_RETRIABLE_STATUS = new Set([400, 401, 402, 403, 404, 405, 413, 415, 422]);

export const DEFAULT_SETTINGS = Object.freeze({
  model_id: "scribe_v2",
  language_code: null,
  num_speakers: null,
  diarize: true,
  diarization_threshold: null,
  tag_audio_events: true,
  timestamps_granularity: "word",
  temperature: null,
  seed: null,
  use_multi_channel: false,
  no_verbatim: false,
  detect_speaker_roles: false,
  enable_logging: true,
  file_format: "other",
  keyterms: [],
  entity_detection: [],
  entity_redaction: [],
  entity_redaction_mode: "enumerated_entity_type",
});

export const DEFAULT_CONFIG = Object.freeze({
  api_key: "",
  max_concurrent: 4,          // knob: parallel uploads (1–8 is sensible on a tablet)
  settings: DEFAULT_SETTINGS,
  export: { format: "TXT", merge_speaker_paragraphs: true, include_timestamps: false },
});

export const STATUS = Object.freeze({
  PENDING: "Pending", QUEUED: "Queued", PREPARING: "Preparing",
  UPLOADING: "Uploading", PROCESSING: "Processing", RETRYING: "Retrying",
  COMPLETE: "Complete", FAILED: "Failed", CANCELED: "Canceled",
});

// Slovak labels for statuses shown in the queue.
export const STATUS_LABEL = Object.freeze({
  Pending: "Čaká", Queued: "V poradí", Preparing: "Pripravuje sa",
  Uploading: "Nahráva sa", Processing: "Prepisuje sa", Retrying: "Opakuje sa",
  Complete: "Hotovo", Failed: "Chyba", Canceled: "Zrušené",
});

const skNames = (() => {
  try { return new Intl.DisplayNames(["sk"], { type: "language", fallback: "code" }); }
  catch { return null; }
})();

/** Slovak display name for an ISO 639-3 code, English fallback. */
export function languageName(code) {
  const en = (LANGUAGES.find(([, c]) => c === code) || [code])[0];
  if (!skNames) return en;
  try {
    const sk = skNames.of(code);
    // Some browsers return a bare code ("ff" for Fulah) instead of a name —
    // anything this short is not a real name, so use the English one.
    return sk && sk.length > 3 ? sk.charAt(0).toUpperCase() + sk.slice(1) : en;
  } catch { return en; }
}
