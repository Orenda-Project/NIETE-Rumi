// pdfmeta.js — put the internal identifiers where they belong: in the PDF's metadata,
// not on the teacher's page.
//
// v8.1 (operator, 2026-08-30): `lesson_id`, `book_stem` and `schema_version` used to be
// printed in the support-page footer — "grade_11_chemistry · PK_G11_CHEM_CH4_MOLE_RATIO …
// lp_doc 2.0". Those are OUR refs, not hers. They still have to survive somewhere the
// pipeline can read them back, so they move into the PDF Info dictionary (Title / Subject /
// Keywords) and into <stem>.render.json.
//
// The write is a standard PDF **incremental update**: the original bytes are appended to,
// never rewritten, so nothing about the rendered pages can be disturbed by a metadata edit.
// If the file is not a classic-xref PDF (Chrome/Skia emits one; some producers emit an xref
// STREAM instead) the buffer is returned untouched — a missing Subject is a nuisance, a
// corrupted lesson plan is a lost lesson.

/** A PDF string literal: ASCII stays readable, anything else becomes a UTF-16BE hex string. */
function pdfString(s) {
  const str = String(s);
  if (/^[\x20-\x7E]*$/.test(str)) return "(" + str.replace(/([\\()])/g, "\\$1") + ")";
  let out = "FEFF";
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += (0xd800 + (v >> 10)).toString(16).toUpperCase().padStart(4, "0");
      out += (0xdc00 + (v & 0x3ff)).toString(16).toUpperCase().padStart(4, "0");
    } else {
      out += cp.toString(16).toUpperCase().padStart(4, "0");
    }
  }
  return "<" + out + ">";
}

/**
 * Append an Info dictionary to `buf` by incremental update.
 * @param {Buffer} buf   the PDF as produced by the renderer
 * @param {object} fields  { Title, Subject, Keywords, Author, Creator, ... } — falsy values skipped
 * @returns {Buffer} a new buffer, or the input when the file shape is not one we can extend
 */
function setInfo(buf, fields = {}) {
  const entries = Object.entries(fields).filter(([, v]) => v != null && String(v) !== "");
  if (!entries.length) return buf;

  const s = buf.toString("latin1");
  const at = s.lastIndexOf("trailer");
  if (at < 0) return buf;                       // xref-stream PDF — leave it alone
  const m = /trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)/.exec(s.slice(at));
  if (!m) return buf;

  const dict = m[1];
  const prevXref = Number(m[2]);
  const root = (/\/Root\s+(\d+\s+\d+\s+R)/.exec(dict) || [])[1];
  const size = Number((/\/Size\s+(\d+)/.exec(dict) || [])[1]);
  if (!root || !Number.isFinite(size) || !Number.isFinite(prevXref)) return buf;

  const objNum = size;                          // the next free object number
  let body = s.endsWith("\n") ? s : s + "\n";
  const objOffset = Buffer.byteLength(body, "latin1");
  body += `${objNum} 0 obj\n<< ${entries.map(([k, v]) => `/${k} ${pdfString(v)}`).join(" ")} >>\nendobj\n`;

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body +=
    `xref\n` +
    `0 1\n0000000000 65535 f \n` +
    `${objNum} 1\n${String(objOffset).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size ${objNum + 1} /Root ${root} /Info ${objNum} 0 R /Prev ${prevXref} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

module.exports = { setInfo, pdfString };
