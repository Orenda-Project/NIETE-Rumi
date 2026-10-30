'use strict';
/**
 * G5 Urdu model-answer and frame checks (round 6 panel, bd-5jmnfj.4.58). Flags `{slot, reason:'answer', items}` for a re-ask:
 *  - Q10 letter/application model with a slash gender form («بیٹا/بیٹی», «آپ کا/کی»), a template sender
 *    «(الف، ب، ج)», or a date in a year before 2026;
 *  - a picture-description frame item with no scene (fde-picture-scene).
 * Pure.
 */

const { pictureSceneShortfall } = require('./fde-picture-scene');

const ARABIC = '[\\p{Script=Arabic}]+';
const SLASH = new RegExp(`${ARABIC}\\s*/\\s*${ARABIC}`, 'u');
const PLACEHOLDER = /\(\s*الف\s*[،,]\s*ب\s*[،,]\s*ج\s*\)/u;
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const YEAR = /(?<![\d۰-۹])((?:20|۲۰)[\d۰-۹]{2})(?![\d۰-۹])/gu;
const asNumber = (y) => Number(String(y).replace(/[۰-۹]/g, (d) => DIGITS.indexOf(d)));

function q10Why(answer, question) {
  const text = String(answer || '');
  const why = [];
  // A slash the question prints itself («ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب») is the board's addressee, not the model's.
  const slash = [...text.matchAll(new RegExp(SLASH.source, 'gu'))].map((m) => m[0])
    .find((m) => !String(question || '').replace(/\s+/g, '').includes(m.replace(/\s+/g, '')));
  if (slash) why.push(`a slash gender form «${slash}»: the model writes one fixed gender`);
  if (PLACEHOLDER.test(text)) why.push('the sender name is a placeholder: write one fixed name');
  const old = (text.match(YEAR) || []).find((y) => asNumber(y) < 2026);
  if (old) why.push(`the date carries the year ${old}: omit the date or use 2026`);
  return why;
}

function urduG5Shortfall(examJson) {
  const out = [];
  ['seen', 'unseen'].forEach((b) => Object.values((examJson && examJson[b]) || {}).forEach((types) => Object.values(types || {}).forEach((l) => {
    (Array.isArray(l) ? l : []).forEach((q) => {
      if (!q || q.slot !== 'urdu.C.Q10') return;
      const why = q10Why(q.answer, q.question);
      if (why.length) out.push({ slot: q.slot, reason: 'answer', items: [`${String(q.question).trim()} (${why.join('; ')})`] });
    });
  })));
  return out.concat(pictureSceneShortfall(examJson));
}

const squash = (t) => String(t || '').replace(/\s+/g, '');
// «آپ کا فرماں بردار / آپ کی فرماں بردار» → «آپ کا فرماں بردار»: the run before the slash stays, the run after it, up to
// the line end, goes. A slash the question prints (the board's «ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب») stays.
function mendText(text, question) {
  let out = String(text);
  const lines = out.split('\n').map((line) => {
    if (!SLASH.test(line)) return line;
    const hit = line.match(SLASH);
    if (squash(question).includes(squash(hit[0]))) return line;
    return line.slice(0, line.indexOf('/')).replace(/\s+$/, '');
  });
  out = lines.join('\n').replace(PLACEHOLDER, 'علی')
    .replace(YEAR, (y) => (asNumber(y) < 2026 ? (/[۰-۹]/.test(y) ? '۲۰۲۶' : '2026') : y));
  return out;
}

/** Q10 model answers mended in place: one gender, a real sender, the current year. Pure: a copy comes back. */
function mendUrduQ10(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const copy = JSON.parse(JSON.stringify(examJson));
  ['seen', 'unseen'].forEach((b) => Object.values(copy[b] || {}).forEach((types) => Object.values(types || {}).forEach((l) => {
    (Array.isArray(l) ? l : []).forEach((q) => {
      if (!q || q.slot !== 'urdu.C.Q10' || typeof q.answer !== 'string') return;
      const next = mendText(q.answer, q.question);
      if (next !== q.answer) { notes.push(`${q.slot}: ${q10Why(q.answer, q.question).join('; ')}`); q.answer = next; }
    });
  })));
  return { examJson: notes.length ? copy : examJson, notes };
}

module.exports = { urduG5Shortfall, mendUrduQ10 };
