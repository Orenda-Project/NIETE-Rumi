'use strict';
/**
 * The Challenge passage check — the machine half of the content spec that every passage file must clear before a
 * person reads it for sign-off. Pure: reads only the word lists and the v3 bank shipped beside it, no network, no DB.
 *
 *   tokenise(text, lang)              the scored words in reading order, punctuation stripped (the v3 convention);
 *                                     Urdu loses its diacritics (U+064B–U+0652, U+0670) first
 *   sentences(text)                   the sentences, each with its end mark
 *   letters(word, lang)               letters as a child reads them: Urdu counts base letters, and ھ / ہ right after a
 *                                     letter is part of that letter (a digraph such as «بھ» is ONE letter)
 *   readability(text, lang, list, {names})  share of word TYPES (case-folded, names left out) found in the list
 *   measure(p)                        every number the passage file records, computed from its text and questions
 *   checkPassage(p) -> {ok, problems[], warnings[], metrics}
 *
 * The band numbers (tokens, sentences, words a sentence, longest word, readability floor and list):
 *   band 1: 30–40 tokens, 4–6 sentences, no sentence over 7 words, words ≤ 5 ur / 7 en letters, ≥ 0.90 on the
 *           grade-2 list AND ≥ 0.95 on the grade-3 list (below grade, not off-list); every sentence ends in a full stop
 *   band 2: 55–65 tokens, 6–9 sentences, no sentence over 9 words, words ≤ 7 / 10, ≥ 0.85 on the grade-3 list
 *   band 3: 55–65 tokens, 6–9 sentences, no sentence over 10 words, words ≤ 8 / 11, ≥ 0.90 on the grade-5 list
 * The band number caps the MEAN words a sentence (a problem when over). A single sentence over the cap is only a
 * warning, unless it is more than three words over (then a problem: a clause chain, not a long sentence).
 *
 * Every passage: no numerals (Western or Urdu digits), no test words and no "don't know" anywhere a child sees it
 * (the same two patterns as web-quiz-challenge.js), no word from the familiar-word or made-up-word tasks of the v3
 * bank, no first person, no abbreviation. Questions: 3–6; every tap question has one right and two different wrong
 * options (the first accept and the first two rejects, the way the tap flow builds them). A read passage needs ≥ 3
 * literal tap questions answerable from lines 1–2, ≥ 2 of them from line 1 alone.
 *
 * A Set A pointer file ({v3_ref, questions_extra}) points at the v3 story; its numbers come from that text, and its
 * extra questions are held to the tap rules. Its line-1 count is reported as a warning: the v3 text is frozen.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '../../data/child-test');
const VOCAB = path.join(DATA, 'vocab');
const V3 = path.join(DATA, 'item-bank.v3.json');

// Copied from web-quiz-challenge.js (the page's rules for what a child may see).
const NOT_AN_ANSWER = /معلوم نہیں|نہیں معلوم|پتا نہیں|پتہ نہیں|\bdon'?t know\b|\bnot sure\b/i;
const NO_TEST_WORDS = /\b(test|tests|testing|egra|egma|assessment|exam)\b|ٹیسٹ|امتحان|جائزہ|اسیسمنٹ/i;

const NUMERAL = /[0-9٠-٩۰-۹]/;
const DIACRITICS = /[ً-ْٰ]/g;
const PUNCT = /^[\s.,;:!?'"“”‘’()«»\-–—۔،؟؛]+|[\s.,;:!?'"“”‘’()«»\-–—۔،؟؛]+$/g;
const SENTENCE = /[^.!?۔؟]+[.!?۔؟]+["'”’»]?/g;
const DO_CHASHMI = 'ھ';
const GOL_HE = 'ہ';

const BANDS = {
  1: { tokens: [30, 40], sentences: [4, 6], sentLen: 7, wordLen: { ur: 5, en: 7 }, floor: 0.90, list: 'fed-cum-g2-2026', above: 'fed-cum-g3-2026', aboveFloor: 0.95 },
  2: { tokens: [55, 65], sentences: [6, 9], sentLen: 9, wordLen: { ur: 7, en: 10 }, floor: 0.85, list: 'fed-cum-g3-2026', above: 'fed-cum-g5-2026', aboveFloor: null },
  3: { tokens: [55, 65], sentences: [6, 9], sentLen: 10, wordLen: { ur: 8, en: 11 }, floor: 0.90, list: 'fed-cum-g5-2026', above: null, aboveFloor: null },
};
const LISTS = ['fed-cum-g2-2026', 'fed-cum-g3-2026', 'fed-cum-g5-2026'];
// One sentence may run past the band's mean cap by this much before it is a problem (else a warning).
const SENT_SLACK = 3;
// A recorded mean is rounded to one place; rounding differs between languages (58/8 = 7.25 → 7.2 or 7.3).
const MEAN_TOLERANCE = 0.06;
const FIRST_PERSON = {
  en: new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves']),
  ur: new Set(['ہم', 'ہمارا', 'ہماری', 'ہمارے', 'میرا', 'میری', 'میرے', 'مجھے', 'مجھ', 'ہمیں']),
};
const ABBREV = /\b(mr|mrs|ms|dr|st|sr|jr|etc|vs)\.(?=\s|$)/i;
const LICENCES = new Set(['textbook', 'cc_by', 'cc_by_sa', 'generated']);
const ID = /^(en|ur)\.(read|listen)\.([123])\.([A-Za-z0-9]+)$/;

// Urdu text loses its diacritics before anything is counted; other scripts pass through.
const STRIP = { ur: (s) => s.replace(DIACRITICS, '') };
const strip = (s, lang) => (STRIP[lang] || ((x) => x))(String(s || ''));
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
const fold = (w, lang) => (lang === 'en' ? w.toLowerCase() : w);

function tokenise(text, lang) {
  return strip(text, lang).split(/\s+/).map((w) => w.replace(PUNCT, '')).filter(Boolean);
}

function sentences(text) {
  const s = String(text || '').trim();
  const out = (s.match(SENTENCE) || []).map((x) => x.trim()).filter(Boolean);
  const rest = s.replace(SENTENCE, '').trim();
  if (rest) out.push(rest);
  return out;
}

function letters(word, lang) {
  const w = String(word || '').replace(DIACRITICS, '');
  if (lang !== 'ur') return (w.match(/\p{L}/gu) || []).length;
  let n = 0;
  let prevLetter = false;
  for (const ch of w) {
    const isLetter = /\p{L}/u.test(ch);
    if (isLetter && prevLetter && (ch === DO_CHASHMI || ch === GOL_HE)) continue; // part of the letter before it
    if (isLetter) n += 1;
    prevLetter = isLetter;
  }
  return n;
}

const listCache = new Map();
function loadList(name, lang) {
  const key = `${name}.${lang}`;
  if (!listCache.has(key)) {
    const file = path.join(VOCAB, `${key}.tsv`);
    const words = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.split('\t')[0].trim()).filter(Boolean);
    listCache.set(key, new Set(words.map((w) => fold(w, lang))));
  }
  return listCache.get(key);
}

function types(text, lang, names) {
  const skip = new Set((names || []).map((n) => fold(String(n).replace(DIACRITICS, ''), lang)));
  return [...new Set(tokenise(text, lang).map((w) => fold(w, lang)))].filter((w) => !skip.has(w));
}

function readability(text, lang, listName, { names } = {}) {
  const t = types(text, lang, names);
  if (!t.length) return 0;
  const list = loadList(listName, lang);
  return round(t.filter((w) => list.has(w)).length / t.length, 3);
}

function outOfList(text, lang, listName, names) {
  const list = loadList(listName, lang);
  return types(text, lang, names).filter((w) => !list.has(w));
}

let v3Cache = null;
function v3() {
  if (!v3Cache) v3Cache = JSON.parse(fs.readFileSync(V3, 'utf8'));
  return v3Cache;
}

/** The familiar-word and made-up-word items (and their practice items) of the v3 bank, per language. */
function taskWords(lang) {
  const r = (((v3().sets || {}).A || {}).reading || {})[lang] || {};
  const out = new Set();
  for (const task of [r.words, r.nonwords]) {
    for (const it of (task && task.items) || []) out.add(fold(String(it), lang));
    for (const it of (task && task.practice) || []) out.add(fold(String(it.item), lang));
  }
  return out;
}

function v3Block(ref) {
  const r = (((v3().sets || {}).A || {}).reading || {})[ref && ref.lang] || {};
  return (ref && r[ref.kind]) || null;
}

function textHash(text, lang) {
  const norm = strip(String(text || '').normalize('NFC'), lang).toLowerCase()
    .replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

const isTapLiteral = (q) => !!q && q.tap_ok === true && q.type === 'literal';
const lineOf = (q) => (Number.isInteger(q && q.needs_line) ? q.needs_line : null);

function reach(questions) {
  const qs = questions || [];
  return {
    q_reach_1: qs.filter((q) => isTapLiteral(q) && lineOf(q) !== null && lineOf(q) <= 1).length,
    q_reach_2: qs.filter((q) => isTapLiteral(q) && lineOf(q) !== null && lineOf(q) <= 2).length,
    q_n: qs.length,
  };
}

/** The text, names and questions a file stands for (a pointer file resolves to the v3 story). */
function resolve(p) {
  if (p && p.v3_ref) {
    const block = v3Block(p.v3_ref) || {};
    const v3q = (block.questions || []).map((q) => ({ ...q, tap_ok: true }));
    return { text: (block.story || {}).text || '', questions: [...v3q, ...(p.questions_extra || [])], pointer: true };
  }
  return { text: p.text || '', questions: p.questions || [], pointer: false };
}

function measure(p) {
  const lang = p.lang;
  const { text, questions } = resolve(p);
  const toks = tokenise(text, lang);
  const sents = sentences(text);
  const lines = [];
  let at = 0;
  for (const s of sents) {
    const n = tokenise(s, lang).length;
    lines.push([at, at + n - 1]);
    at += n;
  }
  const spec = BANDS[p.band] || BANDS[2];
  const names = p.names || [];
  const r = {};
  for (const l of LISTS) r[l] = readability(text, lang, l, { names });
  return {
    tokens: toks.length,
    sentences: sents.length,
    mean_sent_len: sents.length ? round(toks.length / sents.length, 1) : 0,
    max_word_len: toks.reduce((m, w) => Math.max(m, letters(w, lang)), 0),
    readability: r[spec.list],
    readability_band_above: spec.above ? r[spec.above] : null,
    readability_g2: r['fed-cum-g2-2026'],
    readability_g3: r['fed-cum-g3-2026'],
    readability_g5: r['fed-cum-g5-2026'],
    lines,
    tokens_list: toks,
    text_hash: textHash(text, lang),
    ...reach(questions),
  };
}

const norm = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const clash = (a, b) => { const x = norm(a); const y = norm(b); return !x || !y || x.includes(y) || y.includes(x); };

/** The child-visible strings of a question: prompt and every option that can be shown or read aloud. */
function childStrings(q) {
  return [q.prompt, q.right, ...(Array.isArray(q.wrong) ? q.wrong : []), ...(q.accept || []), ...(q.reject || [])]
    .filter((x) => typeof x === 'string');
}

function checkQuestion(q, nLines, lang, problems) {
  const id = (q && q.id) || '?';
  if (!q || !q.id || typeof q.prompt !== 'string' || !q.prompt.trim()) problems.push(`question: ${id} needs an id and a prompt`);
  if (!['literal', 'inferential'].includes(q.type)) problems.push(`question: ${id} type must be literal or inferential`);
  const k = lineOf(q);
  if (k === null || k < 1 || k > nLines) problems.push(`needs_line: ${id} needs_line ${q.needs_line} is not a line of the text (1–${nLines})`);
  if (!Array.isArray(q.accept) || !q.accept.length) problems.push(`question: ${id} has no accepted answer`);
  for (const s of childStrings(q)) {
    if (NUMERAL.test(s)) problems.push(`numeral: ${id} "${s}"`);
    if (NO_TEST_WORDS.test(s)) problems.push(`test_word: ${id} "${s}"`);
    if (NOT_AN_ANSWER.test(s)) problems.push(`not_an_answer: ${id} "${s}"`);
  }
  if (lang === 'en' && childStrings(q).some((s) => /[؀-ۿ]/.test(s))) problems.push(`question: ${id} mixes scripts`);
  if (q.tap_ok !== true) return;
  const right = typeof q.right === 'string' ? q.right.trim() : '';
  const wrong = Array.isArray(q.wrong) ? q.wrong.map((w) => (typeof w === 'string' ? w.trim() : '')) : [];
  if (!right || wrong.length !== 2 || wrong.some((w) => !w)) {
    problems.push(`tap: ${id} needs one right and exactly two wrong options, all non-empty`);
    return;
  }
  const opts = [right, ...wrong];
  for (let i = 0; i < opts.length; i += 1) {
    for (let j = i + 1; j < opts.length; j += 1) {
      if (clash(opts[i], opts[j])) problems.push(`tap: ${id} options "${opts[i]}" and "${opts[j]}" are not distinct`);
    }
  }
  if (!Array.isArray(q.accept) || q.accept[0] !== q.right) problems.push(`tap: ${id} the first accepted answer must be the right option`);
  if (!Array.isArray(q.reject) || q.reject[0] !== q.wrong[0] || q.reject[1] !== q.wrong[1]) {
    problems.push(`tap: ${id} the first two rejected answers must be the two wrong options`);
  }
  for (const a of q.accept || []) for (const w of wrong) if (norm(a) === norm(w)) problems.push(`tap: ${id} "${w}" is both accepted and wrong`);
}

function checkPointer(p, problems, warnings) {
  const block = v3Block(p.v3_ref);
  if (!block || !block.story || !block.story.text) problems.push(`pointer: ${p.passage_id} v3_ref does not resolve to a v3 story`);
  if (p.pool !== 'check' || p.is_reference !== true || p.band !== 2) problems.push(`pointer: ${p.passage_id} must be the band-2 check reference`);
  if (p.bank_version !== 'child-test-items-v3') problems.push(`pointer: ${p.passage_id} bank_version must be child-test-items-v3`);
  const v3ids = new Set(((block && block.questions) || []).map((q) => String(q.id).split('.').pop()));
  const m = measure(p);
  for (const q of p.questions_extra || []) {
    if (v3ids.has(q.id)) problems.push(`question: ${q.id} already exists in the v3 story`);
    checkQuestion(q, m.lines.length, p.lang, problems);
    if (!isTapLiteral(q) || !(lineOf(q) <= 2)) problems.push(`reach: ${q.id} an extra question must be a literal tap question on lines 1–2`);
  }
  if (p.kind === 'read' && m.q_reach_2 < 3) problems.push(`reach: ${m.q_reach_2} questions on lines 1–2 (needs ≥ 3)`);
  if (p.kind === 'read' && m.q_reach_1 < 2) warnings.push(`reach: ${m.q_reach_1} question on line 1 (the rule asks ≥ 2; the v3 text is frozen)`);
  return m;
}

function checkPassage(p) {
  const problems = [];
  const warnings = [];
  if (!p || typeof p !== 'object') return { ok: false, problems: ['file: not an object'], warnings, metrics: {} };
  const idm = ID.exec(p.passage_id || '');
  if (!idm) problems.push(`id: "${p.passage_id}" is not <lang>.<kind>.<band>.<slug>`);
  else if (idm[1] !== p.lang || idm[2] !== p.kind || Number(idm[3]) !== p.band) problems.push(`id: ${p.passage_id} disagrees with lang/kind/band`);
  if (!['en', 'ur'].includes(p.lang)) problems.push(`field: lang ${p.lang}`);
  if (!['read', 'listen'].includes(p.kind)) problems.push(`field: kind ${p.kind}`);
  if (!['check', 'practice'].includes(p.pool)) problems.push(`field: pool ${p.pool}`);
  if (![1, 2, 3].includes(p.band)) problems.push(`field: band ${p.band}`);
  if (p.v3_ref) {
    const m = checkPointer(p, problems, warnings);
    return { ok: problems.length === 0, problems, warnings, metrics: m };
  }

  const spec = BANDS[p.band] || BANDS[2];
  const lang = p.lang;
  const m = measure(p);
  if (p.status_at_authoring !== 'draft') problems.push('field: status_at_authoring must be draft');
  if (typeof p.is_reference !== 'boolean') problems.push('field: is_reference must be true or false');
  if (p.pool === 'practice' && p.is_reference) problems.push('field: a practice passage is never a reference');
  if (p.is_reference && p.twin_of) problems.push('field: a reference is never a twin');
  if (p.params && p.params.reserve === true && (p.pool !== 'practice' || p.band !== 1)) problems.push('field: the reserve story is band-1 practice');
  if (!LICENCES.has(p.licence)) problems.push(`field: licence ${p.licence}`);
  if (!p.source_ref) problems.push('field: source_ref is empty');
  if (p.bank_version !== 'child-test-items-v4') problems.push('field: bank_version must be child-test-items-v4');
  if (p.readability_list !== spec.list) problems.push(`field: readability_list must be ${spec.list} for band ${p.band}`);
  if (!Array.isArray(p.names)) problems.push('field: names must list the characters (left out of readability)');
  if (!p.title_en && !p.title_ur) problems.push('field: no title');

  // the band numbers
  if (m.tokens < spec.tokens[0] || m.tokens > spec.tokens[1]) problems.push(`tokens: ${m.tokens} (band ${p.band}: ${spec.tokens.join('–')})`);
  if (m.sentences < spec.sentences[0] || m.sentences > spec.sentences[1]) problems.push(`sentences: ${m.sentences} (band ${p.band}: ${spec.sentences.join('–')})`);
  sentences(p.text).forEach((s, i) => {
    const n = tokenise(s, lang).length;
    if (n > spec.sentLen + SENT_SLACK) problems.push(`sentence_len: sentence ${i + 1} has ${n} words (band ${p.band}: mean ≤ ${spec.sentLen}, no sentence over ${spec.sentLen + SENT_SLACK})`);
    else if (n > spec.sentLen) warnings.push(`sentence_len: sentence ${i + 1} has ${n} words (band ${p.band} mean cap ${spec.sentLen})`);
    if (p.band === 1 && !/[.۔]["'”’»]?$/.test(s)) problems.push(`full_stop: sentence ${i + 1} does not end in a full stop`);
  });
  if (m.mean_sent_len > spec.sentLen) problems.push(`sentence_len: mean ${m.mean_sent_len} (band ${p.band}: ≤ ${spec.sentLen})`);
  const wl = spec.wordLen[lang] || spec.wordLen.en;
  for (const w of new Set(m.tokens_list)) if (letters(w, lang) > wl) problems.push(`word_len: "${w}" has ${letters(w, lang)} letters (band ${p.band}: ≤ ${wl})`);
  if (m.readability < spec.floor) {
    problems.push(`readability: ${m.readability} on ${spec.list} (floor ${spec.floor}); outside: ${outOfList(p.text, lang, spec.list, p.names).join(', ')}`);
  }
  if (spec.aboveFloor !== null && m.readability_band_above < spec.aboveFloor) {
    problems.push(`readability: ${m.readability_band_above} on ${spec.above} (band ${p.band} must clear ${spec.aboveFloor}); outside: ${outOfList(p.text, lang, spec.above, p.names).join(', ')}`);
  }

  // what a child sees
  const seen = [['text', p.text], ['title_en', p.title_en], ['title_ur', p.title_ur]].filter(([, s]) => typeof s === 'string');
  for (const [k, s] of seen) {
    if (NUMERAL.test(s)) problems.push(`numeral: ${k}`);
    if (NO_TEST_WORDS.test(s)) problems.push(`test_word: ${k}`);
    if (NOT_AN_ANSWER.test(s)) problems.push(`not_an_answer: ${k}`);
    if (ABBREV.test(s)) problems.push(`abbreviation: ${k}`);
  }
  for (const w of String(p.text).split(/\s+/).map((x) => x.replace(PUNCT, ''))) {
    if (lang === 'en' && /^[A-Z]{2,}$/.test(w)) problems.push(`abbreviation: "${w}"`);
  }
  const banned = taskWords(lang);
  const fp = FIRST_PERSON[lang] || new Set();
  for (const w of new Set(m.tokens_list.map((x) => fold(x, lang)))) {
    if (banned.has(w)) problems.push(`task_word: "${w}" is an item of the word or made-up-word task`);
    if (fp.has(w)) problems.push(`first_person: "${w}"`);
  }

  // the lines and the questions
  const qs = p.questions || [];
  if (qs.length < 3 || qs.length > 6) problems.push(`question: ${qs.length} questions (3–6)`);
  if (new Set(qs.map((q) => q && q.id)).size !== qs.length) problems.push('question: ids repeat');
  for (const q of qs) checkQuestion(q, m.lines.length, lang, problems);
  if (p.kind === 'read' && (m.q_reach_2 < 3 || m.q_reach_1 < 2)) {
    problems.push(`reach: ${m.q_reach_1} literal tap questions on line 1 and ${m.q_reach_2} on lines 1–2 (needs ≥ 2 and ≥ 3)`);
  }
  if (p.kind === 'listen' && qs.filter((q) => q.tap_ok === true).length < 3) problems.push('reach: a listening passage needs ≥ 3 tap questions');

  // what the file records must be what the text gives
  for (const k of ['tokens', 'sentences', 'mean_sent_len', 'max_word_len', 'readability', 'readability_band_above',
    'lines', 'tokens_list', 'text_hash', 'q_reach_1', 'q_reach_2', 'q_n']) {
    const same = k === 'mean_sent_len'
      ? typeof p[k] === 'number' && Math.abs(p[k] - m[k]) <= MEAN_TOLERANCE
      : JSON.stringify(p[k]) === JSON.stringify(m[k]);
    if (!same) problems.push(`recorded: ${k} is ${JSON.stringify(p[k])}, computed ${JSON.stringify(m[k])}`);
  }
  return { ok: problems.length === 0, problems, warnings, metrics: m };
}

module.exports = {
  tokenise, sentences, letters, readability, measure, checkPassage, textHash, taskWords, outOfList, loadList,
  BANDS, NO_TEST_WORDS, NOT_AN_ANSWER,
};
