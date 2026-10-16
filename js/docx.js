// docx.js — Word (.docx) export without a library.
// PURPOSE: same layout as export_docx() in the Mac app: title "Transcript",
//          grey language line, then per speaker a bold blue label (+ optional
//          grey timestamp) and the paragraph text.
// INPUTS:  API response, speaker names, includeTimestamps.
// OUTPUTS: Uint8Array (.docx). TWEAK: colours/sizes in the run() calls below
//          (sizes are half-points: 22 = 11 pt).
import { makeZip } from "./zip.js";
import { buildParagraphs, formatTimestamp, fmt2 } from "./format.js";

// XML 1.0 forbids most control characters — drop them instead of producing
// a file Word refuses to open.
const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function run(text, { bold = false, size = null, color = null } = {}) {
  const props = [bold ? "<w:b/>" : "", color ? `<w:color w:val="${color}"/>` : "",
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
const para = (runs, after = null) =>
  `<w:p>${after !== null ? `<w:pPr><w:spacing w:after="${after}"/></w:pPr>` : ""}${runs}</w:p>`;

export function buildDocx(resp, names = {}, includeTimestamps = false) {
  const body = [];
  body.push(para(run("Transcript", { size: 52, color: "17365D" }), 300));
  const lang = resp.language_code || "unknown";
  const prob = resp.language_probability;
  let meta = run(`Detected language: ${lang}`, { size: 18, color: "808080" });
  if (typeof prob === "number") meta += run(`    confidence: ${fmt2(prob)}`, { size: 18, color: "808080" });
  body.push(para(meta));
  for (const p of buildParagraphs(resp, names)) {
    let head = run(p.label, { bold: true, size: 22, color: "1F6FEB" });
    if (includeTimestamps) head += run(`   [${formatTimestamp(p.start, ".")}]`, { size: 18, color: "888888" });
    body.push(para(head));
    body.push(para(run(p.text), 120)); // 120 twips = 6 pt, like the Mac export
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return makeZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: document },
  ]);
}
