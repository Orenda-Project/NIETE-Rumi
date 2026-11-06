'use strict';
/**
 * Builds `slo-map/chapters/<grade>_<code>.json` for G9-12 from the G6-12 LP matrix CSVs (bd-5jmnfj.38.30 item 4):
 * the codes each chapter's lessons teach, so the board prompt's CURRICULUM CODES can name the chapter's own codes.
 * Codes and a short description (at most 8 words) only; no book text. A cell the matrix leaves empty stays empty.
 *
 *   node bot/shared/services/assessment/slo-map/build-chapters.js "<…>/08_Grades 6-12 LP Build"
 *
 * A row whose codes span more than one unit (a revision roll-up) is skipped; " · "-joined descriptions pair with the
 * codes when the counts match. Code kinds kept: lo (G9-U2-LO3; ranges like G9-U2-LO1-15 are expanded), official (P-09-A-02, the FBISE form the
 * checks accept), book (book p16 outcome 1). Anything else ("not printed — see Comments", A-11-A-12) is dropped.
 */
const fs = require('fs');
const path = require('path');

const SOURCES = [ // design_pending: the matrix files as of 2026-11-06; urdu has no G9-12 code column filled
  ['stem/physics_6_12.csv', 'physics'], ['stem/chemistry_6_12.csv', 'chemistry'], ['stem/biology_6_12.csv', 'biology'],
  ['stem/mathematics_6_12.csv', 'maths'], ['stem/computer_science_6_12.csv', 'computer_science'],
  ['humanities/islamiat_6_12.csv', 'islamiat'], ['humanities/pak_studies_6_12.csv', 'pakistan_studies'],
  ['languages/work/english_6_12_resegmented.csv', 'english'], ['languages/work/urdu_6_12_rows.csv', 'urdu'],
];
const GRADES = [9, 10, 11, 12];
const WORDS = 8;

/** RFC-4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i += 1; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const digits = (s) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const OFFICIAL = /^(?:P|C|B|M|PS|U|E|CS|I)-(?:08|09|10|11|12)-[A-Z]{1,2}[0-9]?-[0-9]{2,3}$/;
const LO = /^G(\d+)-U(\d+)-LO(\d+)(?:-(\d+))?$/;
const BOOK = /^book p[1-9]\d* outcome [1-9]\d*$/;

/** One SLO cell to codes: split on "·" and ",", LO ranges expanded. */
function splitCodes(cell) {
  const out = [];
  String(cell || '').split(/\s*[·,]\s*/).map((c) => c.trim()).filter(Boolean).forEach((c) => {
    const m = LO.exec(c);
    if (m && m[4]) for (let k = Number(m[3]); k <= Number(m[4]); k += 1) out.push(`G${m[1]}-U${m[2]}-LO${k}`);
    else out.push(c);
  });
  return out;
}

const kindOf = (c) => (LO.test(c) ? 'lo' : OFFICIAL.test(c) ? 'official' : BOOK.test(c) ? 'book' : null);
const shortDesc = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, WORDS).join(' ');

/** Matrix CSV text to {grade: {chapter: [{code, kind, desc}]}} for the grades asked; first description wins. */
function chaptersOf(text, grades = GRADES) {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => /^Day#/.test(String(r[0] || '').trim()));
  if (h < 0) return {};
  const col = rows[h].indexOf('SLO Codes');
  const dcol = rows[h].indexOf('SLO Description');
  const out = {};
  let grade = null;
  let chapter = null;
  rows.slice(h + 1).forEach((r) => {
    const first = digits(String(r[0] || '').trim());
    const g = /^(?:GRADE|درجہ)\s*(\d+)/i.exec(first);
    if (g) { grade = Number(g[1]); chapter = null; return; }
    const ch = /^(?:Ch|باب)\s*(\d+)\s*:/i.exec(first);
    if (ch) { chapter = Number(ch[1]); return; }
    if (!grades.includes(grade) || chapter == null || col < 0) return;
    const list = ((out[grade] = out[grade] || {})[chapter] = out[grade][chapter] || []);
    const codes = splitCodes(r[col]);
    const units = new Set(codes.map((c) => LO.exec(c)).filter(Boolean).map((m) => m[2]));
    if (units.size > 1) return; // a revision row rolling up other chapters' outcomes: not this chapter's codes
    const descs = String(r[dcol] || '').split(/\s+·\s+/);
    codes.forEach((code, i) => {
      const kind = kindOf(code);
      const desc = shortDesc(descs.length === codes.length ? descs[i] : r[dcol]);
      if (kind && !list.some((x) => x.code === code)) list.push({ code, kind, desc });
    });
  });
  Object.values(out).forEach((byCh) => Object.keys(byCh).forEach((k) => { if (!byCh[k].length) delete byCh[k]; }));
  return out;
}

/** Writes one file per grade with any chapter codes; returns the written names. */
function build(root, outDir = path.join(__dirname, 'chapters')) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  SOURCES.forEach(([file, code]) => {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return;
    const byGrade = chaptersOf(fs.readFileSync(full, 'utf8'));
    Object.entries(byGrade).forEach(([grade, chapters]) => {
      if (!Object.keys(chapters).length) return;
      const name = `${grade}_${code}.json`;
      const doc = { grade: Number(grade), code, source: { file, kind: 'lp_matrix' }, chapters };
      fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(doc, null, 1)}\n`);
      written.push(name);
    });
  });
  return written;
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root) { process.stderr.write('usage: build-chapters.js <matrix root>\n'); process.exit(2); }
  process.stdout.write(`${build(root).join('\n')}\n`);
}

module.exports = { parseCsv, splitCodes, kindOf, shortDesc, chaptersOf, build };
