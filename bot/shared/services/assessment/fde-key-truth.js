'use strict';
/**
 * Answer keys that are wrong or garbled on a Grade 3-4 paper (bd-5jmnfj.33.4, the v32 review):
 *  - a proper term the key, a point or an accept names while the question never does and the paper never
 *    prints it (G4 Urdu Q2 v keyed «خطِ استوا» for bodies that, without the sun's pull, travel straight on):
 *    the point naming it and the accepts naming it go, its marks move to a point that stays, and the
 *    item is flagged so the answer is written again. «خطِ استوا» / equator is suspect on its own;
 *  - an accept that is the very error the item lists: the singular of a plural item, or a form the
 *    common error quotes (G4 Urdu Q4 i accepted «چاند» beside «واحد ہی دوبارہ لکھنا»);
 *  - a plural item keyed with its own stem word, or with a bracketed «(جمع: ...)» explanation: flagged;
 *  - a common error that criticises writing no sentence, on a stem that never asked for one (Q4 ii): dropped;
 *  - every marking point only repeating the question: flagged.
 * Urdu and Science `.short` items carry the key-only term rule; Islamiat, Social Studies, oral and picture
 * items and every slot outside Grades 3-4 are left alone. Pure: exam JSON in; `keyTruth` gives
 * `{examJson, notes}`, `keyTruthFlags` gives re-ask flags `{slot, reason:'key_truth', kind, item, words, text}`.
 */

const MID = /^g[34]\./;
const HELD = /islamiat|social|oral/i;
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ​-‏ـ]/g;
const WORD = /[\p{L}\p{N}]+/gu;
const SUSPECT = /خط استوا|equator/;
const STOP = new Set(('کے کی کا کو میں سے نے پر اور یا کہ جو ہے ہیں تھا تھی تھے ہو ہوتا ہوتی ہوتے ہوئے یہ وہ اس ان ایک بھی ہی کیا کیوں '
  + 'کس کب کیسا کیسی کیسے کون کہاں نہ نہیں تو کر کرنا کرنے کرتا کرتی کرتے والا والی والے وجہ بات ذکر لیے لئے ساتھ اپنے اپنی اپنا '
  + 'بہت زیادہ the a an of in on at to for and or is are was were it its by with from this that these those what which who '
  + 'when where why how does did do will would can could should has have has had be been not no all any states says gives '
  + 'names writes links correct correctly').split(' '));
const SUFFIXES = ['یوں', 'یاں', 'وں', 'یں', 'ے', 'ا', 'ہ', 'ی', 'ں'];
const BRACKETED = /\(\s*(?:جمع|واحد|مؤنث|مذکر|متضاد|ہم معنی|الٹ)\s*[:：]/;
const FORM_ERROR = /بغیر\s+جملے|جملے\s+کے\s+بغیر|مکمل\s+جملے\s+میں\s+نہ|without a (?:full |complete )?sentence|not in a (?:full|complete) sentence/i;
const ASKS_SENTENCE = /جملے|جملہ|sentence/i;
const RESTATE = /^(.+?)\s*(?:کا|کی|کے)\s*ذکر(?:\s*کرنا)?\s*$/;
const QUOTED = /«([^»]+)»|“([^”]+)”|‘([^’]+)’|'([^']+)'/g;
const IZAFAT = /(\p{L}+)ِ\s+(\p{L}+)/gu;

const text = (s) => String(s == null ? '' : s);
const norm = (s) => text(s).normalize('NFC').replace(MARKS, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۃ/g, 'ہ').toLowerCase();
const words = (s) => norm(s).match(WORD) || [];
function stemOf(w) {
  if (/^[a-z]{5,}$/.test(w)) return w.replace(/(ies|es|s|ed|ing)$/, (m) => (m === 'ies' ? 'y' : ''));
  const hit = SUFFIXES.find((x) => w.endsWith(x) && [...w].length - [...x].length >= 2);
  return hit ? w.slice(0, w.length - hit.length) : w;
}
const content = (s) => words(s).filter((w) => [...w].length >= 2 && !STOP.has(w)).map(stemOf);
const eligible = (q) => q && typeof q.slot === 'string' && MID.test(q.slot) && !HELD.test(q.slot) && !q.picture;
const stemText = (q) => [q.question, q.main_question, ...(Array.isArray(q.options) ? q.options : []), q.passage,
  ...(Array.isArray(q.column_a) ? q.column_a : []), ...(Array.isArray(q.column_b) ? q.column_b : [])].map(text).join(' ');
const points = (q) => (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []);
const accepts = (q) => (q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : []);
const excerpt = (q) => text(q.question).replace(/\s+/g, ' ').trim().slice(0, 70);

const allItems = (examJson) => Object.values((examJson && examJson.unseen) || {})
  .flatMap((byType) => Object.values(byType || {})).flat().filter(Boolean);

/** True when a point reads «X کا ذکر» and at least two thirds of X's content words are in the stem. */
function restates(q, pointText) {
  const m = RESTATE.exec(text(pointText).trim());
  if (!m) return false;
  const x = content(m[1]);
  const stem = new Set(content(stemText(q)));
  return x.length > 0 && x.filter((w) => stem.has(w)).length >= (2 / 3) * x.length;
}

// The proper terms a key-only check looks at: an Urdu «Xِ Y» compound (kasra), or an English capitalised word
// that does not open a sentence.
function termsOf(q) {
  const raw = [q.answer, ...points(q).map((p) => p && p.text), ...accepts(q)].map(text);
  const out = new Set();
  raw.forEach((t) => {
    for (const m of t.matchAll(IZAFAT)) out.add(norm(`${m[1]} ${m[2]}`));
    t.split(/[.!?؟۔]\s*|\n/).forEach((sentence) => (sentence.match(/\p{L}+/gu) || []).slice(1).forEach((w) => {
      if (/^\p{Lu}/u.test(w) && w.length >= 4 && !STOP.has(w.toLowerCase())) out.add(w.toLowerCase());
    }));
    if (SUSPECT.test(norm(t))) out.add('خط استوا');
  });
  return [...out];
}

// The terms of one item that its stem does not name and the rest of the paper never prints.
function keyOnly(q, others) {
  if (!eligible(q) || !/\.(?:urdu|science)\.[^.]*\.short$/.test(q.slot) && !termsOf(q).some((t) => SUSPECT.test(t))) return [];
  const own = new Set(content(stemText(q)));
  const own2 = ` ${words(stemText(q)).join(' ')} `;
  return termsOf(q).filter((t) => {
    const suspect = SUSPECT.test(t);
    if (!suspect && !/\.(?:urdu|science)\.[^.]*\.short$/.test(q.slot)) return false;
    const named = t.split(' ').every((w) => own.has(stemOf(w))) || own2.includes(` ${t} `);
    return !named && (suspect || !others.includes(` ${t} `) && !others.includes(` ${t.replace(/ /g, '')} `));
  });
}
const paperText = (list, q) => ` ${list.filter((o) => o !== q).map((o) => words(stemText(o)).join(' ')).join(' ')} `;

const quotedForms = (error) => [...text(error).matchAll(QUOTED)].map((m) => norm(m[1] || m[2] || m[3] || m[4]).trim()).filter(Boolean);
const pluralOf = (q) => (/جمع|plural/i.test(text(q.question)) ? (/«([^»]+)»/.exec(text(q.question)) || [])[1] : null);
const keyHead = (q) => text(q.answer).split('(')[0].trim();

// Accepts that are the error the item lists, with the reason each goes.
function badAccepts(q) {
  const singular = pluralOf(q) ? norm(pluralOf(q)).trim() : null;
  const quoted = quotedForms(q.scheme && q.scheme.common_error);
  const key = norm(q.answer).trim();
  return accepts(q).map((a) => ({ a, n: norm(a).trim() })).filter(({ n }) => n && n !== key
    && ((singular && n === singular) || quoted.includes(n))).map(({ a }) => a);
}

function moveMarks(pts, dropped) {
  const kept = pts.filter((p) => !dropped.includes(p));
  const moved = dropped.reduce((n, p) => n + (Number(p.marks) || 0), 0);
  const at = kept.findIndex((p) => p && p.kind !== 'L');
  const to = at >= 0 ? at : 0;
  return kept.map((p, i) => (i === to ? { ...p, marks: (Number(p.marks) || 0) + moved } : p));
}

function fixItem(q, list, notes) {
  if (!eligible(q) || !q.scheme) return q;
  let s = q.scheme;
  const terms = keyOnly(q, paperText(list, q));
  terms.forEach((t) => {
    const naming = points(q).filter((p) => p && words(p.text).join(' ').includes(t));
    const hasLeft = naming.length > 0 && naming.length < points(q).length;
    const acc = accepts(q).filter((a) => !words(a).join(' ').includes(t));
    if (!hasLeft && acc.length === accepts(q).length) return;
    s = { ...s, points: hasLeft ? moveMarks(s.points, s.points.filter((p) => naming.includes(p))) : s.points, accept: acc };
    notes.push({ slot: q.slot, reason: 'key_only_term', term: t, points: hasLeft ? naming.length : 0 });
  });
  const bad = badAccepts({ ...q, scheme: s });
  bad.forEach((a) => notes.push({ slot: q.slot, reason: 'accept_is_error', accept: a }));
  if (bad.length) s = { ...s, accept: s.accept.filter((a) => !bad.includes(a)) };
  if (FORM_ERROR.test(text(s.common_error)) && !ASKS_SENTENCE.test(`${text(q.question)} ${text(q.main_question)}`)) {
    notes.push({ slot: q.slot, reason: 'form_error_dropped', was: s.common_error });
    s = { ...s, common_error: '' };
  }
  return s === q.scheme ? q : { ...q, scheme: s };
}

/** `{examJson, notes}`: the paper with the pure fixes above applied; an item nothing touches is the same object. */
function keyTruth(examJson) {
  const notes = [];
  if (!examJson || !examJson.unseen) return { examJson, notes };
  const list = allItems(examJson);
  const unseen = Object.fromEntries(Object.entries(examJson.unseen).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, l]) => [type, Array.isArray(l) ? l.map((q) => fixItem(q, list, notes)) : l]))]));
  return { examJson: { ...examJson, unseen }, notes };
}

/** Re-ask flags `{slot, reason:'key_truth', kind, item, words, with, text}` for keys the fixes cannot make true. */
function keyTruthFlags(examJson) {
  const list = allItems(examJson);
  const out = [];
  const seen = new Map();
  list.forEach((q) => {
    if (!eligible(q)) return;
    const n = (seen.get(q.slot) || 0) + 1;
    seen.set(q.slot, n);
    const flag = (kind, ws = []) => out.push({ slot: q.slot, reason: 'key_truth', kind, item: n, words: ws, with: [], text: [excerpt(q)] });
    const terms = keyOnly(q, paperText(list, q));
    if (terms.length) flag('key_only_term', terms);
    if (pluralOf(q) && norm(keyHead(q)).trim() === norm(pluralOf(q)).trim()) flag('plural_same', [pluralOf(q)]);
    if (BRACKETED.test(text(q.answer))) flag('garbled_key');
    const pts = points(q).filter((p) => p && /^[KA]$/.test(p.kind));
    if (pts.length > 1 && pts.every((p) => restates(q, p.text))) flag('points_restate_stem');
  });
  return out;
}

const SAY = {
  key_only_term: (f) => `names ${f.words.map((w) => `«${w}»`).join(', ')}, which neither the question nor the chapter's text gives. Write the answer again using only what the question or the chapter's text states`,
  plural_same: (f) => `asks for the plural of «${f.words[0]}», which has no different plural form. Ask for another word whose plural differs from its singular`,
  garbled_key: () => 'has an answer with a bracketed explanation. Write the answer as the one word or sentence a child would write',
  points_restate_stem: () => 'has marking points that only repeat the question. Write an answer with two ideas the question does not already say',
};

/** The re-ask note naming each item whose key is untrue; null when none. */
function keyTruthNote(shortfall) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'key_truth' && SAY[f.kind]);
  if (!flags.length) return null;
  return flags.map((f) => `Item «${(f.text && f.text[0]) || f.slot}» ${SAY[f.kind](f)}.`).join('\n');
}

module.exports = { keyTruth, keyTruthFlags, keyTruthNote, restates, tools: { norm, words, stemOf, content, stemText, eligible, points, text } };
