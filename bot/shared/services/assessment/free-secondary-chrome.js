'use strict';
/**
 * bd-5jmnfj.38.31 — the chrome of a G6-12 free paper (section headings, student box, instructions,
 * marks word) in the paper's language (A2c: the a4 G8 Urdu paper printed English headings). The strings
 * are data: free-secondary-chrome.data.json, and the type titles of question-types-6-12.data.json.
 * Only a paper the G6-12 free service marked `_paperLang: 'ur'` changes; every other paper gets its
 * English strings back exactly as the renderer printed them. Pure, no I/O.
 */

const DATA = require('./free-secondary-chrome.data.json');
const TYPES = require('./question-types-6-12.data.json').types;
const FreePrint = require('./free-secondary-print');

const isUrdu = (examJson) => Boolean(examJson && examJson._paperLang === 'ur');
const LABEL_KEYS = ['studentName', 'rollNo', 'date', 'totalMarks', 'obtainedMarks', 'instructions'];

// Headers, instructions and headings are set left-to-right for an English label; an Urdu one reads right-to-left.
const URDU_CSS = `
  table.marks-header, table.marks-header td, .instructions, h3.type { direction: rtl; text-align: right; }
  h3.type { text-transform: none; letter-spacing: 0; }`;

function labelsFor(examJson) {
  const lang = isUrdu(examJson) ? 'ur' : 'en';
  const out = {};
  LABEL_KEYS.forEach((k) => { out[k] = DATA.labels[k][lang] || DATA.labels[k].en; });
  return out;
}

function headingFor(examJson, type) {
  if (!isUrdu(examJson)) return type;
  const name = String(type || '').trim().toLowerCase();
  const id = DATA.bucket_types[name] || (TYPES.find((t) => String(t.title_en).toLowerCase() === name) || {}).id;
  const t = TYPES.find((x) => x.id === id);
  return (t && t.title_ur) || type;
}

/** The instruction lines: English as before; Urdu prints only the lines that have Urdu wording. */
function instructionsFor(examJson, base) {
  if (!isUrdu(examJson)) return FreePrint.instructionsFor(examJson, base);
  const minutes = Number(examJson._timeMinutes);
  return DATA.instructions
    .filter((l) => l.ur && (!l.time || minutes > 0))
    .map((l) => l.ur.replace('{t}', String(minutes)));
}

function marksWord(examJson) {
  return isUrdu(examJson) ? DATA.labels.marks.ur : undefined;
}

function css(examJson) {
  return isUrdu(examJson) ? URDU_CSS : '';
}

/** The English strings with no Urdu wording yet, for the report and the review queue. */
function designPending() {
  return [...Object.values(DATA.labels), ...DATA.instructions].filter((e) => !e.ur).map((e) => e.en);
}

module.exports = { labelsFor, headingFor, instructionsFor, marksWord, css, designPending };
