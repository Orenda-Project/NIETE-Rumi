'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { anagramVerdict, rhymingPoemVerdict } = require('../english-check');
const { mcqPropertyVerdict } = require('../maths-check');
const { breakPeriod, keyAt, random, readKey, sameValueTwice, seedOf, turned } = require('./key-order');
const { fill, slotKey } = require('./scope-frames');

function spreadKeys(slots, bySlot) {
  const mcqs = [];
  for (const slot of slots) {
    if (slot.shape !== 'mcq') continue;
    for (const q of bySlot.get(slot.slot)) if (Array.isArray(q.options)) mcqs.push(q);
  }
  if (!mcqs.length) return 0;
  const next = random(seedOf(mcqs.map((q) => `${q.question || ''}\u0001${(q.options || []).join('\u0002')}`).join('\u0003')));
  // Every key counts towards its letter (a child sees the whole strip); only movable items turn.
  const counts = [0, 0, 0, 0];
  const movable = [];
  for (const q of mcqs) {
    const key = readKey(q);
    if (key) {
      movable.push({ q, key });
      counts[key.index] += 1;
    } else {
      const at = keyAt(q);
      if (at >= 0 && at < 4) counts[at] += 1;
    }
  }
  const cap = Math.ceil(mcqs.length / 4) + 1;
  // Which item on a crowded letter moves first is set by the seed, so the same paper turns the same items.
  const order = movable.map((m, i) => ({ m, r: next(), i })).sort((a, b) => a.r - b.r || a.i - b.i);
  let moved = 0;
  for (const { m } of order) {
    if (!counts.some((c) => c > cap)) break;
    const from = m.key.index;
    if (counts[from] <= cap) continue;
    const n = m.q.options.length;
    const reach = Array.from({ length: n }, (_, i) => i).filter((i) => i !== from);
    const least = Math.min(...reach.map((i) => counts[i]));
    if (least + 1 > cap) continue;
    const choices = reach.filter((i) => counts[i] === least);
    const to = choices[Math.floor(next() * choices.length)];
    counts[from] -= 1;
    counts[to] += 1;
    m.q.options = turned(m.q.options, (to - from + n) % n);
    m.q.answer = m.key.write(to);
    moved += 1;
  }
  moved += breakPeriod(mcqs, next); // bd-5jmnfj.4.50.7: every subject, not Social Studies alone
  return moved;
}

// A tag the model appends to an item ("(Based on the chapter/concept: …)", "(Remember)",
// «(سبق: …)»): FDE's paper has none, so it never prints.
const ITEM_TAG = /\s*\((?:based on (?:the )?(?:chapter|concept|passage|text|lesson|topic|unit)\b[^()]*|(?:remember|understand|apply|analy[sz]e|evaluate|create)(?:ing)?|سبق\s*:[^()]*)\)\s*$/i;
const TAGGED_FIELDS = ['question', 'main_question', 'text'];

// "… which place? (a) Lakhs (b) Ten thousands (c) Thousands (d) Millions": the options
// written into an MCQ stem as well as into `options`. The paper prints its own options
// row (keys may be turned), so a second, differently lettered list never prints.
const STEM_LABEL = /(^|\s)\(?([a-d])\)\s*/gi;
const STEM_MAX = 600;
const optionText = (t) => String(t == null ? '' : t).replace(/^\s*\(?[a-d]\)\s*/i, '').replace(/[\s.,;]+$/, '').trim().toLowerCase();

// Urdu: the same list lettered الف) ب) ج) د) («… استانی صاحبہ»۔ الف) اسکول ب) بازار ج) باغ د) ہسپتال»).
const STEM_LABEL_UR = /(^|\s)\(?(الف|ب|ج|د)\)\s*/gu;
const optionTextUr = (t) => String(t == null ? '' : t).replace(/^\s*\(?(?:الف|ب|ج|د)\)\s*/u, '').replace(/[\s.,;،۔]+$/u, '').trim();

function stripStemOptions(q, urdu = false) {
  if (!q || typeof q.question !== 'string' || q.question.length > STEM_MAX) return;
  if (!Array.isArray(q.options) || q.options.length !== 4) return;
  const text = q.question;
  const [labelRe, order, textOf] = urdu ? [STEM_LABEL_UR, 'الفبجد', optionTextUr] : [STEM_LABEL, 'abcd', optionText];
  const labels = [...text.matchAll(labelRe)];
  // The list must be the last four labels, a to d in order, and end the stem.
  if (labels.length < 4) return;
  const four = labels.slice(-4);
  if (four.map((m) => m[2].toLowerCase()).join('') !== order) return;
  const segments = four.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i < 3 ? four[i + 1].index + four[i + 1][1].length : text.length;
    return textOf(text.slice(from, to));
  });
  // Each segment is one of the options, each option once: then it is the options again.
  const options = q.options.map(textOf);
  if (new Set(segments).size !== 4 || !segments.every((seg) => seg && options.includes(seg))) return;
  q.question = text.slice(0, four[0].index + four[0][1].length).trim();
}

// Social Studies Section B prints the topic alone. FDE's Q4 line («'{q}' پر مشتمل ذہنی خاکہ بنائیں۔») wraps
// it, so a topic that carries its own instruction («اچھے شہری کی ذمہ داریاں: اس موضوع پر 4 سے 6 شاخوں والا
// ذہنی خاکہ بنائیں۔») printed the instruction twice; Q3's box, example and arrow line is the pattern's
// (`topic_line_ur`), so a reply that writes only a title still asks for what the scheme marks. The topic is
// the first «…» quote, else what comes before a colon, else the stem with its trailing instruction cut;
// a stem with no instruction is the topic as written, and one that cannot be read is left as it is.
const B_SLOTS = { 'social_studies.b.q3': 'social_studies.B.Q3', 'social_studies.b.q4': 'social_studies.B.Q4' };
const B_INSTRUCTS = /ذہنی\s*خاکہ|مائنڈ\s*میپ|شاخ|چارٹ|خاکہ|خانے|خانوں|تیر|بنائیں|شامل\s*کریں/;
const B_TAIL = /\s*(?:(?:کے|کی)\s*(?:موضوع|عنوان)\s*پر|کے\s*بارے\s*میں|کے\s*لیے|پر\s*مشتمل|پر\s*ایک|پر|کا|کی|کے)?\s*(?:ایک\s*)?(?:[\d۰-۹]+\s*سے\s*[\d۰-۹]+\s*شاخوں\s*(?:والا|پر\s*مشتمل)\s*)?(?:ذہنی\s*خاکہ|ذہنی\s*نقشہ|مائنڈ\s*میپ|فلو\s*چارٹ|بہاؤ\s*چارٹ|خاکہ)[\s\S]*$/;
// An instruction in brackets after the topic («جمہوریت کی اہمیت (مرکزی خیال کے گرد 4 سے 6 شاخیں بنا کر …)»).
const B_BRACKET = /\s*\(([^()]*)\)\s*[۔.]?\s*$/;
const topicBare = (t) => t.replace(/^['‘"“\s]+|['’"”\s]+$/g, '').replace(/[۔.]+$/, '').trim();
function sectionBTopic(text) {
  const raw = String(text || '').trim();
  const bracket = raw.match(B_BRACKET);
  const t = bracket && B_INSTRUCTS.test(bracket[1]) ? raw.slice(0, bracket.index).trim() : raw;
  const quoted = t.match(/«([^»]+)»/);
  if (quoted) return quoted[1].trim();
  if (!B_INSTRUCTS.test(t)) return t;
  // The topic, then its instruction: after a colon, a full stop or a new line.
  const head = topicBare(t.split(/[:：۔\n]/)[0]);
  if (head && head !== topicBare(t) && !B_INSTRUCTS.test(head)) return head;
  const cut = topicBare(t.replace(B_TAIL, ''));
  return cut && !B_INSTRUCTS.test(cut) ? cut : null;
}
function sectionBStem(q, P) {
  const id = B_SLOTS[slotKey(q.slot)];
  if (!id || typeof q.question !== 'string') return;
  const topic = sectionBTopic(q.question);
  if (!topic) return;
  const slot = P.sections.flatMap((sec) => sec.slots).find((x) => x.slot === id);
  q.question = id === 'social_studies.B.Q3' && slot && slot.topic_line_ur ? fill(slot.topic_line_ur, { q: topic }) : topic;
}

// Social Studies: the label the model gives a spare it writes for a slot («سوال نمبر 5 کا اضافی سوال: …»)
// never prints.
const SPARE_LABEL = /^\s*(?:سوال\s*(?:نمبر\s*)?[\d۰-۹]+\s*کا\s*)?اضافی\s*سوال\s*(?:[\d۰-۹]+\s*)?[:：۔-]\s*/;
function stripSpareLabel(q) {
  if (q && typeof q.question === 'string' && SPARE_LABEL.test(q.question)) q.question = q.question.replace(SPARE_LABEL, '');
}

function stripTags(holder) {
  if (!holder || typeof holder !== 'object') return;
  for (const field of TAGGED_FIELDS) {
    if (typeof holder[field] !== 'string') continue;
    let text = holder[field];
    for (let next = text.replace(ITEM_TAG, ''); next !== text; next = text.replace(ITEM_TAG, '')) text = next;
    holder[field] = text;
  }
  if (Array.isArray(holder.questions)) holder.questions.forEach(stripTags);
  if (Array.isArray(holder.parts)) holder.parts.forEach((part) => { if (part && Array.isArray(part.questions)) part.questions.forEach(stripTags); });
}

// An MCQ with two right answers is not placed: two options of one value (see
// sameValueTwice), a stem asking for a property ("divisible by 11", "prime",
// "rounded to the nearest 100") that no option or more than one option has, or an
// anagram of a quoted word that is not exactly one option, keyed. A rhyming-words
// item with no poem (empty, a cue-word title, or prose) is not placed either.

function printable(slot, q) {
  if (slot.type === 'Rhyming Words') return rhymingPoemVerdict(q).ok;
  return slot.shape !== 'mcq' || (!sameValueTwice(q) && mcqPropertyVerdict(q).ok !== false && anagramVerdict(q).ok !== false);
}

// ── One section never gives another away ─────────────────────────────────
//
// English: a Q1(a) MCQ whose stem or options carry one of Q4's words hands the child that
// word's meaning or a sentence to copy («What does the word 'invisible' mean?» above «Use any
// five of the following words…: invisible»). Social Studies: a Q5 or Q7 item that asks the
// fact a Q1 MCQ already tests: its one-line answer, or marking points worth at least half its
// marks, are given away by a Q1 MCQ (the MCQ's key is inside them, or they are printed in the
// MCQ's stem, AND the two ask about the same thing). Urdu: a Q1 MCQ keyed on the answer a Q4 item
// asks for («اگر – تو», «اسکول») hands the child that Q4 item. Before the re-ask a held item takes no
// place, so the slot is short and the section is asked again; after it, the clean items fill
// the slot first and a held item comes back only for a place nothing else can take. The other
// slot is never touched.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textsOf = (...values) => values.flat().filter((t) => typeof t === 'string');

function q4Words(q4s) {
  const words = q4s.flatMap((q) => (Array.isArray(q.words) ? q.words : []))
    .map((w) => (typeof w === 'string' ? w.replace(/^[\s"'“‘(]+|[\s"'”’).,;:!?]+$/g, '') : ''))
    .filter((w) => w.length >= 3) // a stray letter would match every option label
    .map((w) => new RegExp(`(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`, 'i'));
  if (!words.length) return null;
  return (q) => {
    const text = textsOf(q.question, Array.isArray(q.options) ? q.options : []).join('\n');
    return words.some((re) => re.test(text));
  };
}

// Urdu read for matching only: one form per letter, no diacritics, Western digits, a light cut
// of the endings number and gender change (صوبہ / صوبے / صوبوں), and no function words.
const UR_FORMS = [[/[يى]/g, 'ی'], [/ك/g, 'ک'], [/[ةه]/g, 'ہ'], [/ۀ/g, 'ہ'], [/[أإآ]/g, 'ا'], [/ؤ/g, 'و'], [/ئ/g, 'ی']];
const UR_MARKS = /[ً-ٰٟۖ-ۭٕٔ]/g;
const OPTION_HEAD = /^\s*\(?(?:[a-dA-D]|الف|ب|ج|د)\s*[).:۔-]\s*/;
const STOP = new Set(('میں کا کی کے کو نے سے پر اور یا ہے ہیں تھا تھی تھے کون کس کیا کب کہاں کیوں کیسے کتنا کتنی کتنے '
  + 'سا سی جو جس جن یہ وہ اس ان ایک بھی تو ہو ہوا ہوئی ہوئے کر کرتا کرتی کرتے کریں کیا گیا گئی گئے لیے والا والی والے '
  + 'اپنے اپنی اپنا ہوتا ہوتی ہوتے کہتے کہلاتا کہلاتی کہلاتے بتائیں لکھیں درج ذیل سب سے the a an of to in is are was were').split(/\s+/));

function tokensOf(text) {
  let t = String(text == null ? '' : text).normalize('NFC').replace(UR_MARKS, '').toLowerCase();
  for (const [re, to] of UR_FORMS) t = t.replace(re, to);
  t = t.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return t.split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (/^\d+ء$/.test(w) ? w.slice(0, -1) : w))
    .map((w) => (/^\p{Script=Arabic}{4,}$/u.test(w) ? w.replace(/(?:وں|یں|ے|ہ|ی|ا)$/, '') : w))
    .filter((w) => w.length >= 2 || /^\d$/.test(w));
}

const keyText = (q) => (typeof q.answer === 'string' ? q.answer.replace(OPTION_HEAD, '') : '');
// An answer of one line (ten words or fewer, function words aside) is judged whole.
const ONE_LINE = 10;
// Same thing asked: at least three of the MCQ's own words, and at least a third of them (a held item
// only costs a re-ask now: it comes back when nothing else can take its place).
const SAME_WORDS = 3;
const SAME_SHARE = 0.35;
// A long answer is a Q1 MCQ printed whole when it holds the MCQ's key and what the MCQ asks: a key
// of a phrase (four words or more) mostly in the answer («کچھ دیر بعد پوسٹ دوبارہ پڑھ کر ٹھنڈے دماغ
// سے جواب دینا»), or a short key in it beside most of the MCQ's own words («مقامی حکومت … پینے کے پانی
// کا بندوبست اور نکاسی آب»); and the MCQ's words are a good part of the answer (at least 0.3 of it).
// One point of a longer answer that Section A also prints is a partial, which FDE's own paper has
// (its Q5 «Define lines of latitude. How many are these?» beside Q1 «… are ___ in numbers → 180»), and
// stays. Read on the answer, not point by point (a point names a fact, «مقامی حکومت کی نشاندہی»,
// without saying it) and not on the stem (a stem that names a Q1 thing is a cue).
const PHRASE_KEY = 4;
const PHRASE_SHARE = 0.75;
const ASKED_SHARE = 0.6;
const ANSWER_SHARE = 0.3;
function answeredWhole(m, answered, answer) {
  const words = new Set([...m.key, ...m.stem]);
  if ([...answer].filter((w) => words.has(w)).length < ANSWER_SHARE * answer.size) return false;
  const inAnswer = [...m.key].filter((w) => answered.has(w)).length;
  if (m.key.size >= PHRASE_KEY && inAnswer / m.key.size >= PHRASE_SHARE) return true;
  if (inAnswer < m.key.size) return false;
  const asks = [...m.stem].filter((w) => !m.key.has(w));
  const both = asks.filter((w) => answered.has(w)).length;
  return both >= SAME_WORDS && both / asks.length >= ASKED_SHARE;
}

// Two readings of one fact the word-share tests miss, compared with a medial ی or ے dropped (a paper
// spells «سینٹ» and «سینیٹ»). The fold is kept to these two: across the other tests it made a one-line
// «اخبار اور رسائل» the options of a WhatsApp MCQ. `phrase` is what the MCQ's stem names: its first
// words, through «کا / کی / کے», up to the verb or the question word («سینیٹ کے ارکان کی تعداد»,
// «ایدھی فاؤنڈیشن»), two words or more.
const foldUr = (w) => (w.length > 3 && /^\p{Script=Arabic}+$/u.test(w) ? w[0] + w.slice(1, -1).replace(/[یے]/g, '') + w.slice(-1) : w);
const folded = (text) => new Set(tokensOf(text).map(foldUr));
const STEM_PHRASE = 2;
const PHRASE_ENDS = new Set('نے میں کو سے پر ہے ہیں تھا تھی تھے کون کس کیا کب کہاں کیوں کیسے کتنا کتنی کتنے درج'.split(' '));

// One question once per slot: the same stem, and for an MCQ the same options too, compared as
// written (letter forms, diacritics, digits and case aside; no word dropped, so «silent 'k'»
// and «silent 'b'» stay two). An MCQ with the same options and key whose stem differs only in
// its framing words («Which noun / Which word is a proper noun?») is the same question too;
// one that differs in a content word («___ apple» / «___ umbrella») is not. A re-asked section
// is written blind, so it often writes the first reply's questions again.
function plain(text) {
  let t = String(text == null ? '' : text).normalize('NFC').replace(UR_MARKS, '').toLowerCase();
  for (const [re, to] of UR_FORMS) t = t.replace(re, to);
  t = t.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return t.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
}

module.exports = {
  ONE_LINE, OPTION_HEAD, PHRASE_ENDS, SAME_SHARE, SAME_WORDS, STEM_PHRASE, STOP, UR_FORMS, UR_MARKS,
  answeredWhole, foldUr, folded, keyText, plain, printable, q4Words, sectionBStem, spreadKeys,
  stripSpareLabel, stripStemOptions, stripTags, textsOf, tokensOf,
};
