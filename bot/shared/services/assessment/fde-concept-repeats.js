'use strict';
/**
 * Repeats across the sections of a Grade 3-4 paper (bd-5jmnfj.33.4). fde-stem-repeats compares stems with
 * stems, MCQ keys of one or two words, and plurals; the v31 papers repeated more than that. G3 Urdu keyed
 * «مفت کھانا» in an MCQ and printed it in a short answer; G3 English keyed Halwa Puri in Q1 and again in
 * Q3; G4 Urdu printed «ریت کے ذرے» in a key and an answer; G4 Science asked the ship question twice;
 * G3 GK tested "listening" eight times and keyed its word-box words in the Q4 key points.
 *
 * Five checks, each flagging the LATER item (the re-ask pipeline reads reason 'giveaway'):
 *  same key   two items whose keys are the same words (not True/False, a number or a letter);
 *  key text   a key of one word (3+ Urdu letters, 4+ English), or 2-3 content words in a row, printed in another
 *             item's stem, choices, word box (`words`) or answer, in either order. A key's words that its own
 *             stem already prints give nothing new, and a section's own word box is not a repeat of its keys;
 *  subject    a word to be defined or used (a quoted word, or a stem of one or two words) that another stem prints;
 *  concept    a content word in the stems and keys of more than CAP items (a word in over a third of the items
 *             is the chapter's topic, not a repeat);
 *  same item  two stems sharing 70% of their content words once the section's template words are dropped.
 *
 * Content words: Urdu normalised (diacritics, ZWNJ, ے/ی, ہ/ۃ) and stripped of endings; English lower-cased with a
 * plural/-ing/-ed stem. Only Grade 3-4 slots; Islamiat, Social Studies, oral and picture items are held back.
 * Pure: exam JSON in, `{slot, reason:'giveaway', words, with, text, printed}` flags out, as stemRepeats returns.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const MID = /^g[34]\./;
const HOLD = /^g[34]\.(islamiat|social|maths)|\.(oral|picture|image)|(^|\.)(oral|picture)/;
// Written pieces whose answer is the model's own wording: only their stems count.
const FREE = /\.(letter|paragraph|essay|invitation|application|story|dialogue|sentences|syllables|present_continuous)$/;
const CAP = 5;
const LONG_KEY = 6; // content words: a longer key is a sentence, matched on its new words only
const NEAR = 0.7;
const MAX_WORDS = 10; // words named per flag, so the re-ask note stays short
const TOPIC = 0.35;
const TRIVIAL = new Set(['true', 'false', 'yes', 'no', 'سچ', 'جھوٹ', 'صحیح', 'غلط', 'درست', 'ہاں', 'نہیں']);
const STOP = new Set(('the a an of in on at to for and or is are was were it its by with from this that these those what '
  + 'which who whom whose when where why how does did do will would can could should has have had be been being all any '
  + 'each one two three four five your our their his her they them you we he she i me my us as but if so than then there '
  + 'here very more most some many much also up down out into over about after before during between because very '
  + 'write choose correct option word words sentence sentences following name give tell say explain describe fill blank '
  + 'use used find answer question '
  + 'کا کی کے کو میں سے پر نے اور یا ہے ہیں ہو ہوں تھا تھی تھے کہ کیا کون کس کیوں کب کہاں کیسے کیسا کیسی کتنے کتنی کتنا '
  + 'یہ وہ اس ان جو بھی تو نہ ایک دو لیے لئے کر کرنا کرتا کرتی کرتے کریں کرنے ہوتا ہوتی ہوتے ہوئے والا والی والے '
  + 'سب جاتا جاتی جاتے جا گیا گئی گئے اپنی اپنا اپنے ساتھ بعد پہلے ہمیں ہم آپ مجھے میرا میری کوئی کچھ ہر بہت '
  + 'چاہیے سکتا سکتی سکتے لکھیں بتائیں ذکر جملے جملہ لفظ معنی سوال جواب درج ذیل کریں چنیں ہوگا ہوگی ہو سکتا ہو سکتی '
  + 'ملتا ملتی ملتے مطلب کون سا کون سی کون سے کام').split(' '));
const URDU_END = ['یوں', 'یاں', 'نا', 'نی', 'تا', 'تی', 'یں', 'وں', 'نے', 'تے', 'ے', 'ی', 'ا', 'ں'];

const clean = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[\u200c\u200d]/g, '').replace(/\p{M}/gu, '');
const norm = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase()
  .replace(/[‌‍]/g, '').replace(/\p{M}/gu, '')
  .replace(/[يى]/g, 'ی').replace(/ے/g, 'ی').replace(/ك/g, 'ک').replace(/[ةۃ]/g, 'ہ').replace(/[أإ]/g, 'ا');
const isUrdu = (w) => /[؀-ۿ]/.test(w);
const longEnough = (w) => [...w].length >= (isUrdu(w) ? 3 : 4);
// "الف) گاجر" -> "گاجر"; "b) Halwa Puri" -> "Halwa Puri".
const choice = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

function stemOf(w) {
  if (isUrdu(w)) {
    const e = URDU_END.find((x) => w.endsWith(x) && [...w].length - [...x].length >= 2);
    return e ? w.slice(0, w.length - e.length) : w;
  }
  if (!/^[a-z]{4,}$/.test(w)) return w;
  const s = w.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, '');
  return s.length >= 3 ? s.replace(/e$/, '') : w;
}
// Content words in order: [{w: the word without diacritics, as shown, n: normalised, s: its stem}].
function content(text) {
  return (clean(text).match(/[\p{L}\p{N}]+/gu) || []).map((w) => ({ w, n: norm(w) }))
    .filter((x) => !STOP.has(x.w) && !STOP.has(x.n) && !/^\p{N}+$/u.test(x.w) && [...x.n].length >= (isUrdu(x.n) ? 2 : 3))
    .map((x) => ({ w: x.w, s: stemOf(x.n) }));
}
const grams = (ws, n) => ws.slice(0, Math.max(0, ws.length - n + 1)).map((_, k) => ws.slice(k, k + n));
const gramSet = (stems) => new Set([2, 3].flatMap((n) => grams(stems, n).map((g) => g.join(' '))));
const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

// One item as the checks read it. `keyed` is false for the written pieces whose answer is the model's own wording.
const NAME = /[^\s.!?؟۔«"'(]\s+(\p{Lu}\p{L}{2,})/gu;
// Capitalised words that do not open a sentence («Pinky», «Jojo»): story characters, not concepts or keys.
const namesIn = (text) => [...String(text == null ? '' : text).matchAll(NAME)].map((m) => stemOf(norm(m[1])));

function unit(q, i) {
  const mcq = Array.isArray(q.options) && q.options.length > 1;
  const subs = (Array.isArray(q.questions) ? q.questions : []).filter(Boolean).map((s) => s.question).join(' ');
  const keyed = !FREE.test(String(q.slot));
  const keyText = keyed ? (mcq ? choice(q.answer) : String(q.answer == null ? '' : q.answer)) : '';
  const stem = content(`${q.question || ''} ${subs}`);
  const key = content(keyText);
  const opts = (mcq ? q.options : []).map((o) => content(choice(o)));
  const box = Array.isArray(q.words) ? content(q.words.join(' ')) : [];
  return { q, i, mcq, stem, key, opts, box, slot: q.slot, raw: q.question,
    stemS: stem.map((x) => x.s), keyS: key.map((x) => x.s), ownSet: new Set(stem.map((x) => x.s)),
    names: namesIn(`${q.question || ''} ${keyText}`) };
}

// What one item prints for others to find: stem, choices, word box, answer, each as stems, grams and a word set.
function printed(u) {
  const seq = (ws) => { const s = ws.map((x) => x.s); return { s, set: new Set(s), g: gramSet(s) }; };
  return { stem: seq(u.stem), opts: u.opts.map(seq), box: seq(u.box), key: seq(u.key), mcq: u.mcq };
}

// The phrases a key offers: its whole word (one-word key), or 2-3 words in a row, minus what its own stem prints.
function phrases(u, names) {
  const out = [];
  if (u.key.length === 1) {
    if (longEnough(u.key[0].w) && !u.ownSet.has(u.keyS[0]) && !names.has(u.keyS[0])) out.push({ shown: u.key[0].w, find: u.keyS[0], n: 1 });
    return out;
  }
  [2, 3].forEach((n) => grams(u.key, n).forEach((g) => {
    const stems = g.map((x) => x.s);
    if (stems.every((s) => u.ownSet.has(s))) return;
    out.push({ shown: g.map((x) => x.w).join(' '), find: stems.join(' '), n });
  }));
  return out;
}

const trivialKey = (u) => !u.key.length || u.key.length > 8 || TRIVIAL.has(u.key.map((x) => x.w).join(' '))
  || u.key.length === 1 && [...u.key[0].w].length < 2;

function sameKeys(units, hit) {
  const ks = units.map((u) => (trivialKey(u) || /\.match$/.test(u.slot) ? null : u.key.map((x) => x.s).join(' ')));
  units.forEach((u, i) => units.forEach((o, j) => {
    if (j > i && ks[i] && ks[i] === ks[j]) hit(j, i, [u.key.map((x) => x.w).join(' ')]);
  }));
}

function keyText(units, ps, hit) {
  const names = new Set(units.flatMap((u) => u.names));
  units.forEach((u, i) => {
    const long = u.key.length > LONG_KEY;
    phrases(u, names).forEach((p) => units.forEach((o, j) => {
      if (j === i) return;
      const pr = ps[j];
      const find = (part) => (p.n === 1 ? part.set.has(p.find) : part.g.has(p.find));
      // Another MCQ's wrong choices may share a one-word key; a key sentence is matched on stems and choices only,
      // and a written answer is matched by a one-word key or by a choice's words (a sentence echoes sentences).
      const inChoices = p.n > 1 && pr.opts.some(find);
      const inAnswer = !pr.mcq && o.key.length && !long && (p.n === 1 || u.mcq) && find(pr.key);
      const inBox = o.slot !== u.slot && find(pr.box);
      if (find(pr.stem) || inChoices || inBox || inAnswer) hit(Math.max(i, j), Math.min(i, j), [p.shown]);
    }));
  });
}

// What a stem asks about: a quoted word, or the whole stem when it is one or two words.
function subjects(u) {
  const quoted = [...String(u.raw || '').matchAll(/[«“"']([^»”"']{2,40})[»”"']/g)].map((m) => content(m[1]));
  const own = quoted.length ? quoted : (u.stem.length <= 2 ? [u.stem] : []);
  return own.filter((ws) => ws.length && ws.every((x) => longEnough(x.w))).map((ws) => ({ shown: ws.map((x) => x.w).join(' '), find: ws.map((x) => x.s).join(' ') }));
}
function subjectWords(units, ps, hit) {
  const subs = units.map((u) => (/\.syllables$/.test(u.slot) ? [] : subjects(u)));
  units.forEach((u, i) => units.forEach((o, j) => {
    if (j <= i) return;
    const has = (p, k) => (p.find.includes(' ') ? ps[k].stem.g.has(p.find) : ps[k].stem.set.has(p.find));
    subs[i].filter((p) => has(p, j)).concat(subs[j].filter((p) => has(p, i))).forEach((p) => hit(j, i, [p.shown]));
  }));
}

// A content word in more stems and keys than CAP: the items past the cap repeat it.
function concepts(units, hit) {
  const where = new Map();
  const names = new Set(units.flatMap((u) => u.names));
  units.forEach((u, i) => new Set([...u.stemS, ...u.keyS]).forEach((s) => {
    if ([...s].length < (isUrdu(s) ? 2 : 4) || names.has(s)) return;
    where.set(s, [...(where.get(s) || []), i]);
  }));
  where.forEach((idx, s) => {
    if (idx.length <= CAP || idx.length > TOPIC * units.length) return;
    const shown = (k) => (units[k].stem.concat(units[k].key).find((x) => x.s === s) || { w: s }).w;
    idx.slice(CAP).forEach((k) => idx.slice(0, CAP).forEach((e) => hit(k, e, [shown(k)])));
  });
}

// Two stems of one content: 70% of the smaller one's words are the other's, section template words dropped.
function sameItems(units, hit) {
  const bySlot = new Map();
  units.forEach((u) => new Set(u.stemS).forEach((s) => bySlot.set(`${u.slot}|${s}`, (bySlot.get(`${u.slot}|${s}`) || 0) + 1)));
  const names = new Set(units.flatMap((u) => u.names));
  const rest = units.map((u) => [...new Set(u.stemS)].filter((s) => bySlot.get(`${u.slot}|${s}`) < 3 && !names.has(s)));
  units.forEach((u, i) => units.forEach((o, j) => {
    if (j <= i || rest[i].length < 4 || rest[j].length < 4) return;
    const shared = rest[i].filter((s) => rest[j].includes(s));
    const show = (s) => (units[i].stem.find((x) => x.s === s) || { w: s }).w;
    if (shared.length >= NEAR * Math.min(rest[i].length, rest[j].length)) hit(j, i, shared.map(show));
  }));
}

/** `{slot, reason:'giveaway', words, with, text, printed}` for each later item an earlier one repeats. */
function conceptRepeats(examJson) {
  if (!examJson) return [];
  const all = itemsInOrder(examJson);
  if (!all.some((q) => MID.test(String(q.slot || '')))) return [];
  const units = all.filter((q) => MID.test(String(q.slot || '')) && !HOLD.test(String(q.slot)) && !q.picture && !q.image)
    .map(unit);
  const ps = units.map(printed);
  const out = new Map();
  const hit = (j, i, ws) => {
    const r = out.get(units[j].slot) || { slot: units[j].slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    ws.forEach((w) => { if (!r.words.includes(w) && r.words.length < MAX_WORDS) r.words.push(w); });
    if (!r.with.includes(units[i].slot)) { r.with.push(units[i].slot); r.text.push(excerpt(units[i].q)); }
    out.set(r.slot, r);
  };
  sameKeys(units, hit);
  keyText(units, ps, hit);
  subjectWords(units, ps, hit);
  concepts(units, hit);
  sameItems(units, hit);
  return [...out.values()];
}

module.exports = { conceptRepeats };
