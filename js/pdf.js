// pdf.js — PDF export via pdfmake 0.3.11 (vendored in web/vendor/pdfmake).
// PURPOSE: same layout as export_pdf() in the Mac app (A4, 2 cm margins,
//          title, grey language line, blue speaker headings, 11 pt body).
// WHY pdfmake: its bundled Roboto font covers Slovak diacritics; the library
//          (~2 MB) is loaded lazily, only the first time a PDF is exported.
// OUTPUTS: Promise<Blob>. TWEAK: sizes/colours in `styles` below.
import { buildParagraphs, formatTimestamp, fmt2 } from "./format.js";

let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Nepodarilo sa načítať ${src}`));
    document.head.appendChild(s);
  });
}

export function loadPdfMake() {
  if (!loading) {
    const base = new URL("../vendor/pdfmake/", import.meta.url);
    loading = loadScript(new URL("pdfmake.min.js", base).href)
      .then(() => loadScript(new URL("vfs_fonts.js", base).href))
      .then(() => window.pdfMake)
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const CM = 28.3465; // points per centimetre

export async function buildPdf(resp, names = {}, includeTimestamps = false) {
  const pdfMake = await loadPdfMake();
  const lang = resp.language_code || "unknown";
  const prob = resp.language_probability;
  const content = [
    { text: "Transcript", style: "title" },
    { text: [{ text: "Detected language: " }, { text: lang, bold: true },
      ...(typeof prob === "number" ? [{ text: `    confidence: ${fmt2(prob)}` }] : [])], style: "meta" },
  ];
  for (const p of buildParagraphs(resp, names)) {
    content.push({ text: [{ text: p.label }, ...(includeTimestamps
      ? [{ text: `  [${formatTimestamp(p.start, ".")}]`, fontSize: 8, color: "#888888", bold: false }] : [])],
    style: "speaker" });
    content.push({ text: p.text, style: "body" });
  }
  const doc = {
    info: { title: "Transcript" },
    pageSize: "A4",
    pageMargins: [2 * CM, 2 * CM, 2 * CM, 2 * CM],
    content,
    defaultStyle: { font: "Roboto" },
    styles: {
      title: { fontSize: 18, bold: true, alignment: "center", margin: [0, 0, 0, 12] },
      meta: { fontSize: 9, color: "#808080", margin: [0, 0, 0, 14] },
      speaker: { fontSize: 12, bold: true, color: "#1f6feb", margin: [0, 10, 0, 4] },
      body: { fontSize: 11, lineHeight: 1.2, margin: [0, 0, 0, 8] },
    },
  };
  return pdfMake.createPdf(doc).getBlob();
}
