'use strict';
/**
 * Early Urdu oral sheets (v29 should-fix, bd-5jmnfj.4.58).
 *   - G1 «My mother» item 3 asked two things at once («کیا پکاتی ہیں یا انھیں کیا پسند ہے؟»): a child answers one.
 *   - Poem model answers restated the stem («نظم میں سب کو میرے خدا نے بنایا»): the teacher's model is the answer.
 *   - Oral read-aloud «تارے» repeated the written answer «ستارے» (fde-oral-fresh-words matches only whole words).
 *   - G2 dialogue script opened with «ٹھیک ہے، …», a reply to nothing.
 * urduOralBad(id, items, script) is a detector (flags); urduOralFixes(examJson) is a fixer ({examJson, notes}) for what
 * code can mend. Pure.
 */

const { BANK } = require('./fde-oral-fresh-words');

const WORD = /[\p{L}\p{M}]+/gu;
const words = (s) => String(s == null ? '' : s).normalize('NFC').match(WORD) || [];
const QWORDS = new Set(['کیا', 'کون', 'کہاں', 'کب', 'کیوں', 'کس', 'کیسے', 'کتنے', 'کتنی', 'کتنا', 'کونسی', 'کونسا']);
const REPLY = /^\s*(?:ٹھیک\s+ہے|جی|جی\s+ہاں|ہاں|نہیں|شکریہ|بالکل|اچھا)(?:[\s،۔!]|$)/u;
const STEM_OPEN = /^\s*(?:اس\s+)?نظم\s+میں\s+/u;
// v37 G1 poem Q1: «جس کا نام نظم کے پہلے لفظ میں آتا ہے» pointed at the poem instead of naming چاند.
const POINTS_AT = /نظم\s+کے\s+\S+\s+(?:لفظ|مصرعے?|شعر|لائن)|(?:پہلے|دوسرے|تیسرے|آخری)\s+(?:لفظ|مصرعے?|شعر)/u;
const FILLER = new Set(['نظم', 'میں', 'کے', 'کی', 'کا', 'کو', 'سے', 'پر', 'ہے', 'ہیں', 'تھا', 'تھی', 'کر', 'اور', 'نے']);

const twoAsks = (ask) => words(ask).filter((w) => QWORDS.has(w)).length >= 2 || (String(ask).match(/[؟?]/g) || []).length >= 2;
/** An answer that carries three or more of the question's own content words says the stem back. */
const restates = (ask, answer) => {
  if (STEM_OPEN.test(answer)) return true;
  const stem = new Set(words(ask).filter((w) => w.length > 2 && !QWORDS.has(w) && !FILLER.has(w)));
  return words(answer).filter((w) => stem.has(w)).length >= 3;
};

/** An answer must carry a content word of the poem that the question does not already hold. */
const fromPoem = (ask, answer, script) => {
  const q = new Set(words(ask));
  const poem = new Set(words(script));
  return words(answer).some((w) => w.length > 1 && !q.has(w) && !FILLER.has(w) && poem.has(w));
};

function urduOralBad(id, items, script) {
  const flags = [];
  (Array.isArray(items) ? items : []).forEach((x) => {
    const ask = String((x && x.ask) || ''); const answer = String((x && x.answer) || '');
    if (id !== 'read_words' && twoAsks(ask)) flags.push({ id, reason: 'two-asks', text: ask });
    if (id === 'poem' && answer && restates(ask, answer)) flags.push({ id, reason: 'restates-stem', text: answer });
    if (id === 'poem' && POINTS_AT.test(answer)) flags.push({ id, reason: 'points-at-poem', text: answer });
    else if (id === 'poem' && answer && /[\u0600-\u06FF]/.test(script || '') && !fromPoem(ask, answer, script)) flags.push({ id, reason: 'answer-not-from-poem', text: answer });
  });
  const first = String(script || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (id === 'dialogue' && first && REPLY.test(first.replace(/^[^:：]{1,40}[:：]\s*/u, ''))) flags.push({ id, reason: 'opens-with-reply', text: first });
  return flags;
}

/** A word and a written word are the same word, or one is the other with one letter dropped from the front or back. */
function nearRepeat(a, b) {
  const x = words(a).join(''); const y = words(b).join('');
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return l.length - s.length === 1 && (l.endsWith(s) || l.startsWith(s));
}

const writtenWords = (ex) => {
  const out = new Set();
  const walk = (v) => { if (typeof v === 'string') words(v).forEach((w) => out.add(w)); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(ex && ex.unseen);
  return [...out];
};

function urduOralFixes(examJson) {
  const oral = examJson && examJson._layout && examJson._layout.oral;
  if (!oral || !Array.isArray(oral.content)) return { examJson, notes: [] };
  const out = JSON.parse(JSON.stringify(examJson));
  const notes = [];
  const written = writtenWords(out);
  const content = out._layout.oral.content;
  content.forEach((c) => {
    (c.items || []).forEach((x) => {
      if (c.id === 'poem' && x.answer && STEM_OPEN.test(x.answer)) { x.answer = x.answer.replace(STEM_OPEN, ''); notes.push(`oral poem: the answer no longer opens «نظم میں»`); }
      if (c.id === 'mother' && twoAsks(x.ask)) {
        const was = x.ask; const first = was.split(/\s+یا\s+|\s+اور\s+/u)[0].replace(/[؟?]+$/u, '');
        if (first !== was) { x.ask = `${first}؟`; notes.push(`oral ${c.id}: «${was}» asked two things, now «${x.ask}»`); }
      }
    });
    if (c.id !== 'read_words') return;
    const used = new Set(c.items.map((x) => x.ask));
    c.items.forEach((x) => {
      if (!written.some((w) => nearRepeat(x.ask, w))) return;
      const cand = BANK.find((b) => !used.has(b) && !written.some((w) => nearRepeat(b, w)));
      if (cand) { notes.push(`oral read_words: «${x.ask}» repeats a written word, now «${cand}»`); used.add(cand); x.ask = cand; }
    });
  });
  return { examJson: out, notes };
}

module.exports = { urduOralBad, urduOralFixes, nearRepeat };
