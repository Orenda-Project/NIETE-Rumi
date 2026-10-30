'use strict';
/**
 * Puts a model's board-pattern output into the pattern's shape.
 *
 * The model is told which slot each item belongs to and how many to write, and
 * mostly does it. This pass handles the rest without ever editing a question's
 * words: a slot tag written loosely, a renamed type ("MCQ"), an untagged item,
 * extra items (dropped and counted, never printed), and the model's own marks
 * (replaced by the pattern's). A slot that came back short is REPORTED, not
 * padded — the caller fails the paper, because a board rehearsal with a
 * missing question is not one.
 *
 * The result carries `_layout`: a copy of the subject's pattern as it stood at
 * generation time, so a later change to the pattern never changes a stored
 * paper, plus the scope, the teacher-supply lines and room for the page counts
 * and notes later stages write.
 *
 * Pure, no I/O.
 */

// A type key reduced to letters and digits, singular: "MCQs", "MCQ" and
// "Multiple choice questions" all meet at "mcq".
const TYPE_ALIAS = {
  multiplechoice: 'mcq', multiplechoicequestion: 'mcq',
  shortquestion: 'shortquestion', shortanswer: 'shortquestion',
};

function typeKey(name) {
  const k = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
  return TYPE_ALIAS[k] || k;
}

function slotKey(tag) {
  return String(tag || '').toLowerCase().replace(/\s+/g, '');
}

const UNIT_WORD = {
  maths: ['Units', 'ابواب'], science: ['Chapters', 'ابواب'], english: ['Units', 'یونٹ'], // ur: needs fluent-Urdu review
  urdu: ['Lessons', 'اسباق'], social_studies: ['Chapters', 'ابواب'], // ur: needs fluent-Urdu review
};
// One chapter in scope: "Unit 3", never "Units 3".
const UNIT_WORD_ONE = {
  maths: ['Unit', 'باب'], science: ['Chapter', 'باب'], english: ['Unit', 'یونٹ'], // ur: needs fluent-Urdu review
  urdu: ['Lesson', 'سبق'], social_studies: ['Chapter', 'باب'], // ur: needs fluent-Urdu review
};

/** The word the paper names its scope with ("Lessons" / «اسباق»), for a screen that must say the same. */
function unitWord(subjectKey, count) {
  const table = Number(count) === 1 ? UNIT_WORD_ONE : UNIT_WORD;
  const [en, ur] = table[subjectKey] || table.maths;
  return { en, ur };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Every item the model wrote, whichever branch and type it landed under.
function walk(examJson) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson && examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const [category, types] of Object.entries(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (q && typeof q === 'object' && !Array.isArray(q)) out.push({ category, type, q });
        });
      }
    }
  }
  return out;
}

/** "3, 4" → "3–4"; "3, 5, 6" → "3, 5–6". */
function runs(numbers) {
  const sorted = [...new Set(numbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

// Every page a page list names ("1-12, 14–40"), or null if it does not parse.
function pageSet(list) {
  const pages = new Set();
  for (const part of String(list).split(',')) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 1000) return null;
    for (let p = a; p <= b; p += 1) pages.add(p);
  }
  return pages;
}

// The units a page list covers when it is exactly whole units of the pattern, else null.
function unitsOfPages(P, list) {
  const unitRanges = (P.scope && P.scope.unit_ranges) || [];
  const want = pageSet(list);
  if (!unitRanges.length || !want || !want.size) return null;
  const units = [];
  const covered = new Set();
  for (const u of unitRanges) {
    const own = pageSet(u.ranges);
    if (!own || !own.size) continue;
    const inside = [...own].filter((p) => want.has(p)).length;
    if (inside === 0) continue;
    if (inside !== own.size) return null;
    units.push(Number(u.chapter));
    own.forEach((p) => covered.add(p));
  }
  if (!units.length || covered.size !== want.size) return null;
  return units.sort((a, b) => a - b);
}

function scopeBlock(P, scope) {
  const kind = scope && (scope.kind === 'chapters' || scope.kind === 'pages') ? scope.kind : 'fde';
  const chapters = kind === 'chapters' && Array.isArray(scope.chapters) ? scope.chapters.map(Number) : null;
  const pages = kind === 'pages' && scope.pages ? String(scope.pages) : null;
  let coversEn = null;
  let coversUr = null;
  if (chapters && chapters.length) {
    const one = new Set(chapters).size === 1;
    const [en, ur] = (one ? UNIT_WORD_ONE : UNIT_WORD)[P.key] || (one ? UNIT_WORD_ONE : UNIT_WORD).maths;
    coversEn = P.header.covers_partial_en.replace('{units}', `${en} ${runs(chapters)}`);
    coversUr = P.header.covers_partial_ur.replace('{units}', `${ur} ${runs(chapters)}`);
    if (one) {
      // The template's own "these units/chapters/lessons" / «انہی ابواب/اسباق» read as one too.
      coversEn = coversEn.replace(/\bthese (units|chapters|lessons)\b/, `this ${en.toLowerCase()}`);
      coversUr = coversUr.replace(/انہی (ابواب|اسباق)/, `اسی ${ur}`); // needs fluent-Urdu review
    }
  } else if (pages) {
    // A page list that is exactly whole units of the pattern names the units, not the pages.
    const units = unitsOfPages(P, pages);
    if (units) {
      const [en, ur] = (units.length === 1 ? UNIT_WORD_ONE : UNIT_WORD)[P.key] || (units.length === 1 ? UNIT_WORD_ONE : UNIT_WORD).maths;
      coversEn = P.header.covers_partial_en.replace('{units}', `${en} ${runs(units)}`);
      coversUr = P.header.covers_partial_ur.replace('{units}', `${ur} ${runs(units)}`);
    } else {
      coversEn = P.header.covers_partial_en.replace('{units}', `pp ${pages}`);
      coversUr = P.header.covers_partial_ur.replace('{units}', `ص ${pages}`);
    }
    // A page list is not units: the template's "these units/chapters/lessons" reads "these pages".
    coversEn = coversEn.replace(/\bthese (units|chapters|lessons)\b/, 'these pages');
    coversUr = coversUr.replace(/انہی (ابواب|اسباق)/, 'انہی صفحات'); // needs fluent-Urdu review
  }
  return {
    kind, chapters, pages,
    label_en: P.scope.label_en, label_ur: P.scope.label_ur,
    line_en: P.scope.line_en, line_ur: P.scope.line_ur,
    covers_en: coversEn, covers_ur: coversUr,
  };
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));
}

function shortLabel(label) {
  return String(label || '').replace(/^Q\.\s?/, 'Q').replace(/^(Q\d+)\.\s*\(/, '$1 (').replace(/[.:]\s*$/, '').trim();
}

// One line per thing the teacher must bring: a frame to fill, the Naat page.
function pageOf(value) {
  const m = /^\s*(?:(?:book\s+)?(?:page|p\.?|pg\.?|ص|صفحہ)\s*)?(\d{1,3})\s*$/i.exec(value === null || value === undefined ? '' : String(value));
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : null;
}

function suppliesFor(P, bySlot) {
  const out = [];
  const S = P.supplies;
  for (const sec of P.sections) {
    for (const slot of sec.slots) {
      const placed = bySlot.get(slot.slot) || [];
      if (slot.alternatives) {
        const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
        if (fixed) {
          const values = { slot: slot.label_ur, b: fixed.book_page };
          out.push({
            slot: slot.slot, kind: 'naat', book_page: fixed.book_page,
            line_en: fill(S.naat_en, { ...values, slot: shortLabel(slot.label_en) }),
            line_ur: fill(S.naat_ur, values),
          });
        }
      }
      if (!slot.frame || !placed.length) continue;
      const q = placed[0];
      // The page the item names ("168", 168, "Page 7", "p. 7"); one that does not read as a
      // page prints none, never the pattern's own example page.
      const book = pageOf(q.book_page);
      const name = String(q.question || '').trim();
      const frameEn = fill(slot.frame.supply_en, { q: name });
      const frameUr = fill(slot.frame.supply_ur, { q: name });
      const words = Array.isArray(q.words) ? q.words.map(String).filter(Boolean) : [];
      const tail = (template) => (words.length && slot.frame.word_bank ? fill(template, { words: words.join('، ') }) : '');
      const withPage = (template, values) => (book ? fill(template, values) : fill(template, values).replace(/ \((book p\.|کتاب ص) \{?b\}?\)| \((book p\.|کتاب ص) [^)]*\)/, ''));
      out.push({
        slot: slot.slot, kind: slot.frame.kind, book_page: book || null, scene: name || null, words,
        line_en: withPage(S.frame_en, { slot: shortLabel(slot.label_en), frame: frameEn, b: book }) + tail(S.words_en).replace(/، /g, ', '),
        line_ur: withPage(S.frame_ur, { slot: slot.label_ur, frame: frameUr, b: book }) + tail(S.words_ur),
      });
    }
  }
  return out;
}

// A frame carries the page its own item names, or none (bd-5jmnfj.4.51.10).
function withFramePages(sections, bySlot) {
  for (const sec of sections) {
    for (const slot of sec.slots) {
      const q = slot.frame && (bySlot.get(slot.slot) || [])[0];
      if (q) slot.frame.book_page = pageOf(q.book_page);
    }
  }
  return sections;
}

// ── Urdu Q6: the four lesson-7 lines ──────────────────────────────────────

const VERSES_NEEDED = 4;

// The lines of a piece of text, and how they were joined (to put a remainder back the same way).
function verseLines(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) return { lines: [], joiner: '\n' };
  const byLine = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (byLine.length > 1) return { lines: byLine, joiner: '\n' };
  // One line of text: verses run on, each ending in «۔», «؟» or «،».
  return { lines: s.split(/(?<=[۔؟،])\s+/).map((l) => l.trim()).filter(Boolean), joiner: ' ' };
}

/**
 * A seen-verses item prints `passage` and nothing else. A reply that put the
 * lines in `question` has them moved; one with no four lines anywhere cannot
 * be printed (the child would be asked to explain verses the paper does not
 * show) and is not placed, so the slot reports short. Returns false for that.
 */
function settleVerses(slot, q) {
  if (!Array.isArray(slot.alternatives) || !slot.alternatives.some((a) => a && a.kind === 'seen_verses')) return true;
  if (verseLines(q.passage).lines.length >= VERSES_NEEDED) return true;
  const { lines, joiner } = verseLines(q.question);
  if (lines.length < VERSES_NEEDED) return false;
  // The verses are the last four lines; anything above them is the instruction.
  const lead = lines.slice(0, lines.length - VERSES_NEEDED).join(joiner);
  q.passage = lines.slice(-VERSES_NEEDED).join('\n');
  q.question = lead || (typeof q.main_question === 'string' && q.main_question.trim() ? q.main_question : '');
  return true;
}

// ── MCQ keys spread over the letters ──────────────────────────────────────
//
// A model keys about half its MCQs on (b) and almost none on (d); a child who
// always ticks (b) passes the section. Each item's options are turned round
// (their order otherwise kept) so the keys spread evenly across the letters.
// The key keeps its text and its shape; only the letter changes.

const URDU_LETTERS = ['الف', 'ب', 'ج', 'د'];
const LATIN_KEY = /^(\s*\(?)([a-dA-D])(\)?(?:[.):\s]|$))/;
const URDU_KEY = /^(\s*\(?)(الف|ب|ج|د)(\s*[.):۔]|\)?\s*$)/;
// Options in an order of their own: turning them round would misplace them.
const POSITIONAL = [
  /^\s*(both|neither)\b/i,
  /^\s*(they|the two)( numbers)? are (equal|the same)\b/i,
  /\b(none|all) of (these|those|them|the above)\b/i,
  /\b(can ?not|can't) be (determined|found|said)\b/i,
  /ان میں سے کوئی نہیں/, /^\s*تمام/, /^\s*دونوں/,
];
// A pair read in its own order: an option set made of exactly these two words, either way round.
const POSITIONAL_PAIRS = [['true', 'false'], ['yes', 'no'], ['درست', 'غلط'], ['ہاں', 'نہیں']];

function positionalPair(texts) {
  if (texts.length !== 2) return false;
  const words = texts.map((t) => t.trim().toLowerCase().replace(/[.!۔]$/, '')).sort();
  return POSITIONAL_PAIRS.some((pair) => [...pair].sort().every((w, i) => w === words[i]));
}
const UNIT_WORDS = /\b(?:rs|rupees?|paisa|cm2?|mm|km|kg|g|ml|l|m2?|sq|units?|hours?|hrs?|minutes?|mins?|seconds?|days?|weeks?|years?|litres?|liters?|metres?|meters?)\b\.?/gi;

// The same reading as the renderer's bareOption: a model's own "a) " / «الف)» removed.
function bare(text) {
  return String(text ?? '')
    .replace(/^\s*\(?[a-dA-D]\)?[.):]\s+/, '')
    .replace(/^\s*\(?(الف|ب|ج|د)\)?\s*[.):۔]\s*/, '')
    .trim();
}

// One name for a unit written several ways ("Rs." and "rupees", "min" and "minutes").
const UNIT_SAME = {
  rs: 'rs', rupee: 'rs', rupees: 'rs',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  sec: 's', secs: 's', second: 's', seconds: 's',
  day: 'day', days: 'day', week: 'week', weeks: 'week', year: 'year', years: 'year',
  litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  metre: 'm', metres: 'm', meter: 'm', meters: 'm',
};

// An option that is only a number ("Rs. 30", "84 cm2", "1 1/2", "75%", "90 degrees", «۹۰ درجے»):
// its value and the unit around it; value NaN when it is not.
function measureOf(text) {
  const raw = bare(text).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const scale = /%/.test(raw) ? 100 : 1;
  const unit = raw.replace(/[\d.,/%\s]+/g, ' ').trim().toLowerCase().split(' ').map((w) => UNIT_SAME[w] || w).join(' ');
  // A unit is whatever follows the number, in any script.
  const s = raw.replace(UNIT_WORDS, '').replace(/[%°²³]/g, '').replace(/,/g, '').replace(/^(.*\d)\D*$/u, '$1').trim();
  let value = NaN;
  let m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) value = Number(m[1]) / scale;
  else if ((m = /^(\d+)\/(\d+)$/.exec(s)) && Number(m[2])) value = Number(m[1]) / Number(m[2]) / scale;
  else if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s)) && Number(m[3])) value = (Number(m[1]) + Number(m[2]) / Number(m[3])) / scale;
  return { value, unit };
}

function numberOf(text) {
  return measureOf(text).value;
}

/**
 * Two options of the same value in the same unit (2/5 and 6/15, 0.5 and 50%)
 * make two right answers. Such an item cannot be printed and is not placed,
 * so its slot reports short. Options that are not numbers are never compared.
 */
function sameValueTwice(q) {
  if (!Array.isArray(q.options)) return false;
  const seen = q.options.map(measureOf).filter((v) => Number.isFinite(v.value));
  return seen.some((a, i) => seen.slice(i + 1).some((b) => a.unit === b.unit && Math.abs(a.value - b.value) < 1e-9));
}

// Words with a natural order of their own: roman numerals, ordinals, weekdays, months.
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const URDU_ORDINALS = ['پہلا', 'دوسرا', 'تیسرا', 'چوتھا', 'پانچواں', 'چھٹا', 'ساتواں', 'آٹھواں', 'نواں', 'دسواں'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function romanOf(t) {
  if (!/^(?:x{0,3})(?:ix|iv|v?i{0,3})$/i.test(t) || !t) return NaN;
  const d = [...t.toLowerCase()].map((c) => ROMAN[c]);
  return d.reduce((sum, v, i) => sum + (v < (d[i + 1] || 0) ? -v : v), 0);
}

const SCALES = [
  (t) => romanOf(t),
  (t) => { const m = /^(\d+)(?:st|nd|rd|th)$/i.exec(t); return m ? Number(m[1]) : NaN; },
  (t) => { const i = ORDINAL_WORDS.indexOf(t.toLowerCase().replace(/[.!]$/, '')); return i < 0 ? NaN : i; },
  (t) => { const i = URDU_ORDINALS.indexOf(t.replace(/[۔.]$/, '')); return i < 0 ? NaN : i; },
  (t) => { const i = WEEKDAYS.indexOf(t.toLowerCase().replace(/[.!]$/, '')); return i < 0 ? NaN : i; },
  (t) => { const i = MONTHS.indexOf(t.toLowerCase().replace(/[.!]$/, '')); return i < 0 ? NaN : i; },
  numberOf,
];

// Numbers, or words with an order of their own, printed in order (either way).
function inNumberOrder(texts) {
  return SCALES.some((scale) => monotonic(texts.map((t) => scale(t.trim()))));
}

function monotonic(v) {
  if (v.some(Number.isNaN)) return false;
  const up = v.every((x, i) => i === 0 || x > v[i - 1]);
  const down = v.every((x, i) => i === 0 || x < v[i - 1]);
  return up || down;
}

const { keyPattern, letterOption } = require('./fde-key-pattern');

// Where the key points and how to write it again at another letter; null when unsure.
function readKey(q) {
  const opts = q.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > 4) return null;
  if (!opts.every((o) => typeof o === 'string' && bare(o))) return null;
  const texts = opts.map(bare);
  if (new Set(texts).size !== texts.length) return null;
  if (texts.some((t) => POSITIONAL.some((re) => re.test(t))) || positionalPair(texts)) return null;
  if (inNumberOrder(texts)) return null;
  const answer = typeof q.answer === 'string' ? q.answer : '';
  const rest = bare(answer);
  const latin = LATIN_KEY.exec(answer);
  const urdu = latin ? null : URDU_KEY.exec(answer);
  const byText = texts.indexOf(rest);
  if (latin || urdu) {
    const m = latin || urdu;
    const index = latin ? m[2].toLowerCase().charCodeAt(0) - 97 : URDU_LETTERS.indexOf(m[2]);
    if (index >= texts.length) return null;
    // "b) text" must name the option at (b); a key whose text and letter disagree is left alone.
    if (rest && rest !== answer.trim() && rest !== texts[index]) return null;
    // "A cat" is a text key that starts like a letter, not the letter (a).
    if (rest === answer.trim() && !/^\s*\(?\S{1,3}\)?\s*$/.test(answer)) return null;
    // bd-5jmnfj.4.50.7: a bare letter on options that are letters themselves would read as their text.
    if (rest === answer.trim() && letterOption(texts)) return null;
    // A bare-text key that only looks like a letter ("a cat") is left alone too.
    if (byText >= 0 && byText !== index) return null;
    const write = (to) => {
      const letter = latin
        ? (m[2] === m[2].toUpperCase() ? 'ABCD' : 'abcd')[to]
        : URDU_LETTERS[to];
      return `${m[1]}${letter}${answer.slice(m[1].length + m[2].length)}`;
    };
    return { index, write };
  }
  if (byText < 0) return null;
  return { index: byText, write: () => answer };
}

// The letter a key sits on, for an item that is not turned (it still counts).
function keyAt(q) {
  const answer = typeof q.answer === 'string' ? q.answer : '';
  const latin = LATIN_KEY.exec(answer);
  if (latin) return latin[2].toLowerCase().charCodeAt(0) - 97;
  const urdu = URDU_KEY.exec(answer);
  if (urdu) return URDU_LETTERS.indexOf(urdu[2]);
  return Array.isArray(q.options) ? q.options.map(bare).indexOf(bare(answer)) : -1;
}

// Labels a model wrote on its options stay with the position: (a) is still first.
function turned(options, by) {
  const n = options.length;
  const prefix = options.map((o) => { const b = bare(o); return o.slice(0, o.lastIndexOf(b)); });
  return options.map((_, i) => `${prefix[i]}${bare(options[(i - by + n) % n])}`);
}

// FNV-1a over the paper's own words, then mulberry32: same paper, same letters.
function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spread the keys of every MCQ slot's items with as few turns as possible:
 * a letter may hold ceil(n/4) + 1 keys (6 of 20); only items keyed on a letter
 * above that are turned, each to the emptiest letter it can reach, until no
 * letter is above it. A balanced paper is left as it is. Returns how many
 * items were turned.
 *
 * Every subject: keys that form a pattern (الف ب ج د five times over, «a b c d a b c d», every
 * fourth key (d); see fde-key-pattern.js) are dealt again. A balanced strip passes the count test,
 * but a child who sees the pattern answers Section A without reading it. The movable items' letters
 * are shuffled among themselves (each letter keeps its count) until the strip has no pattern; an
 * item never takes a letter beyond its own options.
 */
const DEALS = 200;
function breakPeriod(mcqs, next) {
  const strip = mcqs.map((q) => { const key = readKey(q); return { q, key, at: key ? key.index : keyAt(q) }; });
  if (!keyPattern(strip.map((e) => e.at))) return 0;
  const movable = strip.filter((e) => e.key);
  for (let deal = 0; deal < DEALS; deal += 1) {
    const letters = movable.map((e) => e.at);
    for (let i = letters.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    if (movable.some((e, i) => letters[i] >= e.q.options.length)) continue;
    const dealt = new Map(movable.map((e, i) => [e, letters[i]]));
    if (keyPattern(strip.map((e) => (dealt.has(e) ? dealt.get(e) : e.at)))) continue;
    let moved = 0;
    for (const [e, to] of dealt) {
      if (to === e.at) continue;
      const n = e.q.options.length;
      e.q.options = turned(e.q.options, (to - e.at + n) % n);
      e.q.answer = e.key.write(to);
      moved += 1;
    }
    return moved;
  }
  return 0;
}

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
const { mcqPropertyVerdict } = require('./maths-check');
const { anagramVerdict, rhymingPoemVerdict } = require('./english-check');

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
function stemPhrase(stem) {
  const words = [];
  for (const w of plain(stem).split(' ')) {
    if (PHRASE_ENDS.has(w)) break;
    words.push(w);
  }
  return folded(words.join(' '));
}
const within = (a, b) => [...a].every((w) => b.has(w));
const share = (a, b) => [...a].filter((w) => b.has(w)).length;
// (1) Same thing asked, same key: the item asks about what the MCQ's stem names, and its one-line
//     answer is the MCQ's key («پاکستان میں سینٹ کے ارکان کی تعداد کتنی ہے؟ → 104» beside «سینیٹ کے ارکان کی
//     تعداد کتنی ہے؟ → 104»). The key is the item's answer, not a word of its question.
// (2) Both facts of the answer printed in Section A: the answer is what the MCQ's stem names, beside
//     half the MCQ's key, and neither is in the item's own question («عبدالستار ایدھی نے کون سی فلاحی تنظیم
//     قائم کی؟ → ایدھی فاؤنڈیشن …, accepting پناہ گاہیں» beside «ایدھی فاؤنڈیشن نے … کیا قائم کیا؟ → یتیموں اور
//     لاوارثوں کے لیے پناہ گاہیں»).
// Both are one-line answers (a Q7, a short Q5): in a longer answer the two facts are one point among
// others, a partial FDE's own paper has (its Q5 «Define lines of latitude. How many are these?»).
function stemTwin(m, item) {
  if (!item.oneLine || m.phrase.size < STEM_PHRASE || !m.keyF.size) return false;
  const ownKey = [...m.keyF].filter((w) => !item.asked.has(w));
  if (ownKey.length * 2 < m.keyF.size) return false;
  if (within(m.phrase, item.asked)) return within(m.keyF, item.answered);
  return within(m.phrase, item.answer) && share(m.keyF, item.answered) * 2 >= m.keyF.size;
}

// A Q7 keyed on a Q1 key: its answer, or an answer its scheme accepts, is a Q1 MCQ's key read as
// words (option letter aside): Q7 «… اجلاس کہاں منعقد ہوا؟ → لاہور کے منٹو پارک», accepting «لاہور»,
// beside Q1 «قرارداد پاکستان کس شہر کے منٹو پارک میں منظور ہوئی؟ → د) لاہور». A one-fact Q7 has one
// answer, so a child who read the MCQ has it.
const asWords = (text) => tokensOf(text).join(' ');
function keyedOnQ1(q1s) {
  const keys = new Set(q1s.map((m) => asWords(keyText(m))).filter(Boolean));
  return (q) => [q.answer, ...textsOf(q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [])]
    .some((t) => typeof t === 'string' && keys.has(asWords(t.replace(OPTION_HEAD, ''))));
}

// A Q5 two Q1 MCQs answer together: at least PAIR_COVER of its model answer's words are in the
// stems and keys of two Q1 items (Q5 «جمہوریت اور شہنشاہیت میں کیا فرق ہے؟» beside Q1 «جمہوری حکومت
// میں حکمرانوں کو کون منتخب کرتا ہے؟ → عوام اپنے ووٹوں سے» and «… بادشاہ یا ملکہ پورا نظام سنبھالتے
// ہیں … → شہنشاہیت»). Below 0.65 the pairs are partials FDE's own paper has (one half of a
// comparison, a rule the Q5 still asks the child to use).
const PAIR_COVER = 0.65;
function pairAnswered(q1s) {
  const texts = q1s.map((m) => new Set([...tokensOf(m.question), ...tokensOf(keyText(m))]));
  return (q) => {
    const answer = [...new Set(tokensOf(q.answer))];
    if (!answer.length) return false;
    for (let a = 0; a < texts.length; a += 1) {
      for (let b = a + 1; b < texts.length; b += 1) {
        if (answer.filter((w) => texts[a].has(w) || texts[b].has(w)).length >= PAIR_COVER * answer.length) return true;
      }
    }
    return false;
  };
}

function sameFact(q1s) {
  const q7Keyed = keyedOnQ1(q1s);
  const q5Pair = pairAnswered(q1s);
  const mcqs = q1s.map((m) => ({
    key: new Set(tokensOf(keyText(m))),
    stem: new Set(tokensOf(m.question)),
    options: new Set(tokensOf(textsOf(Array.isArray(m.options) ? m.options : []).map((o) => o.replace(OPTION_HEAD, '')).join(' '))),
    phrase: stemPhrase(m.question),
    keyF: folded(keyText(m)),
  })).filter((m) => m.key.size && m.stem.size);
  if (!mcqs.length) return null;
  return (q, slotId) => {
    if (slotId === 'social_studies.D.Q7' && q7Keyed(q)) return true;
    if (slotId === 'social_studies.C.Q5' && q5Pair(q)) return true;
    const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
    const points = Array.isArray(scheme.points) ? scheme.points.filter((p) => p && typeof p.text === 'string') : [];
    const accept = textsOf(Array.isArray(scheme.accept) ? scheme.accept : []);
    const said = new Set(tokensOf(textsOf(q.question, q.answer, points.map((p) => p.text), accept).join(' ')));
    // What the MCQ asks (its stem, the shared key taken out) is what the item says too.
    const asksSame = (asks) => {
      const both = asks.filter((w) => said.has(w)).length;
      return both >= SAME_WORDS && both / asks.length >= SAME_SHARE;
    };
    // A key an MCQ gives away: it holds the MCQ's key, or it is printed in the MCQ's stem (a name
    // both carry is not by itself the same question), and the two ask the same thing.
    const given = (text) => {
      const k = new Set(tokensOf(text));
      if (!k.size) return false;
      return mcqs.some((m) => {
        const stem = [...m.stem].filter((w) => !m.key.has(w));
        if ([...m.key].every((w) => k.has(w)) && asksSame(stem)) return true;
        return [...k].every((w) => m.stem.has(w)) && asksSame(stem.filter((w) => !k.has(w)));
      });
    };
    const answerF = folded(q.answer);
    const item = {
      asked: folded(q.question), answer: answerF, answered: new Set([...answerF, ...folded(accept.join(' '))]),
      oneLine: tokensOf(q.answer).length <= ONE_LINE,
    };
    if (mcqs.some((m) => stemTwin(m, item))) return true;
    // A one-line answer (or an item with no marking points) is given whole, with its accepted answers.
    if (!points.length || tokensOf(q.answer).length <= ONE_LINE) {
      if (textsOf(q.answer, accept).some(given)) return true;
      // A one-line answer that is only an MCQ's options («مقننہ، انتظامیہ اور عدلیہ»).
      const ans = new Set(tokensOf(q.answer));
      if (ans.size >= 2 && mcqs.some((m) => [...ans].every((w) => m.options.has(w)))) return true;
    }
    const answer = new Set(tokensOf(q.answer));
    const answered = new Set([...answer, ...tokensOf(accept.join(' '))]);
    if (answer.size && mcqs.some((m) => answeredWhole(m, answered, answer))) return true;
    // Otherwise the points the MCQs give must carry at least half the item's marks: one point of
    // three cued is a hint, not the answer.
    const marks = points.map((p) => (Number(p.marks) > 0 ? Number(p.marks) : 1));
    const total = marks.reduce((a, b) => a + b, 0);
    const got = points.reduce((sum, p, i) => sum + (given(p.text) ? marks[i] : 0), 0);
    return total > 0 && got * 2 >= total;
  };
}

// Urdu: the Q4 items' keys, read as written (option letter, dashes and commas aside), and the
// MCQs keyed on one of them. A Q4 key is its answer and every answer its scheme accepts («موسمِ
// برسات», accepting «برسات»). Q4 asks for words, so a key with no letter (a bare number) is no Q4 answer.
const acceptOf = (q) => (q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [])
  .filter((a) => typeof a === 'string').map((a) => a.replace(OPTION_HEAD, ''));
function sameKey(q4s) {
  const keys = new Set(q4s.flatMap((q) => [keyText(q), ...acceptOf(q)]).map(plain).filter((k) => /\p{L}/u.test(k)));
  if (!keys.size) return null;
  return (q) => keys.has(plain(keyText(q)));
}

// Urdu: the sentence an item is about, as words: its quoted text («…», ’’…‘‘, “…”), else what
// follows its colon, on the stem's first line (a Q4 stem can carry its options below). Each comes
// twice when it has blanks: with them taken out, and with the key's words put in them (one word or
// pair per blank, «اگر - تو»). Fewer than four words is a word or a phrase, not a sentence.
const QUOTED = /«([^»]+)»|[’‘]{2}([^’‘]+)[’‘]{2}|“([^”]+)”|"([^"]+)"/gu;
const BLANK = /_{2,}|\.{3,}|…/g;
const SENTENCE_WORDS = 4;
function sentencesOf(q, filled) {
  const line = typeof q.question === 'string' ? q.question.trim().split('\n')[0] : '';
  const quoted = [...line.matchAll(QUOTED)].map((m) => m.slice(1).find(Boolean));
  const colon = line.split(/[:：]/);
  const said = quoted.length ? quoted : (colon.length > 1 ? [colon.slice(1).join(' ')] : []);
  const key = filled ? keyText(q) : '';
  const fills = plain(key) ? key.split(/\s*[-–—,،]\s*/).map((w) => w.trim()).filter(Boolean) : null;
  const out = [];
  for (const s of said) {
    out.push(plain(s.replace(BLANK, ' ')).split(' '));
    const blanks = s.match(BLANK) || [];
    if (fills && blanks.length && blanks.length === fills.length) {
      let i = 0;
      out.push(plain(s.replace(BLANK, () => ` ${fills[i++]} `)).split(' '));
    }
  }
  return out.filter((w) => w.length >= SENTENCE_WORDS);
}
// How many of `a`'s words `b` carries in a's order (the longest common subsequence).
function inOrder(a, b) {
  let row = new Array(b.length + 1).fill(0);
  for (const w of a) {
    const next = [0];
    for (let j = 1; j <= b.length; j += 1) next[j] = w === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    row = next;
  }
  return row[b.length];
}
// Urdu writes a compound split or joined («کام یاب» / «کامیاب», «کم زور» / «کمزور»): two words side
// by side that make one word of the other text are read as that word.
function joinSplits(words, other) {
  const one = new Set(other);
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (i + 1 < words.length && one.has(words[i] + words[i + 1])) { out.push(words[i] + words[i + 1]); i += 1; } else out.push(words[i]);
  }
  return out;
}
// A sentence is printed in a stem when the stem carries at least four in five of its words, in order.
const SENTENCE_SHARE = 0.8;
const printedIn = (sentence, stem) => {
  const said = joinSplits(sentence, stem);
  return inOrder(said, joinSplits(stem, said)) >= Math.ceil(said.length * SENTENCE_SHARE);
};

// Urdu: the word list a Q4 item asks about, quoted («کتاب، قلم، کاپی، بستہ») or after its colon up
// to the sentence's end («گروہی الفاظ …: بادل، بجلی، بارش، گھٹائیں۔»), as each entry's words. A
// list is three or more entries of one to three words each; anything else (a sentence, two words
// to break up) is none.
const LIST_ENTRIES = 3;
const ENTRY_WORDS = 3;
function listOf(q) {
  const line = typeof q.question === 'string' ? q.question.trim().split('\n')[0] : '';
  const colon = line.split(/[:：]/);
  const said = [...line.matchAll(QUOTED)].map((m) => m.slice(1).find(Boolean))
    .concat(colon.length > 1 ? [colon.slice(1).join(' ').split(/[۔؟?!]/)[0]] : []);
  for (const text of said) {
    const entries = text.split(/[،,]/).map(tokensOf);
    if (entries.length >= LIST_ENTRIES && entries.every((e) => e.length && e.length <= ENTRY_WORDS)) return entries;
  }
  return [];
}

// Urdu: a Q1 MCQ is a Q4 twin when it is keyed on a Q4 answer (sameKey), when it prints a Q4
// sentence (Q4's sentence is in the MCQ's stem, or the MCQ's quoted sentence, blanks empty or
// filled with its key, is in Q4's stem), or
// when its stem carries three of a Q4 list's entries, in any order.
function q4Twin(q4s) {
  const byKey = sameKey(q4s);
  const q4 = q4s.map((q) => ({ said: sentencesOf(q, true), stem: plain(String(q.question || '').split('\n')[0].replace(BLANK, ' ')).split(' ') }));
  const sentences = q4.some((s) => s.said.length);
  const lists = q4s.map(listOf).filter((l) => l.length);
  if (!byKey && !sentences && !lists.length) return null;
  return (q) => {
    if (byKey && byKey(q)) return true;
    const words = new Set(tokensOf(q.question));
    if (lists.some((l) => l.filter((e) => e.every((w) => words.has(w))).length >= LIST_ENTRIES)) return true;
    const stem = plain(q.question).split(' ');
    // The MCQ's own sentence, its blanks empty and filled with its key («___ تم محنت کرو گے ___ …» → اگر، تو).
    const own = sentencesOf(q, false).concat(sentencesOf(q, true));
    return q4.some((s) => s.said.some((t) => printedIn(t, stem)) || own.some((t) => printedIn(t, s.stem) || s.said.some((f) => printedIn(t, f))));
  };
}

// Social Studies, one fact once per slot by its key: two written items whose keys say the same
// thing (one key's words all inside the other's) and whose stems ask about the same thing (every
// word of the shorter-keyed stem, its key aside, in the other stem) are one question: «کے ٹو کی
// اونچائی کتنی ہے؟ → 8,611 میٹر» inside «کے ٹو کی اونچائی کتنی ہے اور … → 8,611 میٹر؛ …». Two facts
// about one place («اونچائی» / «پہاڑی سلسلہ») stay two.
function sameKeyFact(a, b) {
  // Two MCQs with one stem and one key are one question whatever distractor a rewrite changed
  // («قوانین بنانے کا اختیار حکومت کے کس حصے کے پاس ہے؟ → مقننہ», beside «فوج» or «سپریم کورٹ»).
  if (Array.isArray(a.options) && Array.isArray(b.options)) {
    const stem = plain(a.question);
    return Boolean(stem) && stem === plain(b.question) && Boolean(plain(keyText(a))) && plain(keyText(a)) === plain(keyText(b));
  }
  if (Array.isArray(a.options) || Array.isArray(b.options)) return false;
  const ka = new Set(tokensOf(keyText(a)));
  const kb = new Set(tokensOf(keyText(b)));
  if (!ka.size || !kb.size) return false;
  const [small, big, qs, qb] = ka.size <= kb.size ? [ka, kb, a, b] : [kb, ka, b, a];
  if (![...small].every((w) => big.has(w))) return false;
  const asks = tokensOf(qs.question).filter((w) => !small.has(w));
  const other = new Set(tokensOf(qb.question));
  return asks.length > 0 && asks.every((w) => other.has(w));
}

// Social Studies, which government does a job (the book's table, p.29). A key that gives one row's
// job to another government is a wrong key, not a repeat: it is held before the re-ask and never
// comes back. Read sentence by sentence: a sentence that names one government («… حکومت») gives it
// the jobs it lists, and one that opens with «وہ» or «یہ» carries the sentence before's government
// («اس کے برعکس» does not). A sentence that names two governments (one of them by its short name,
// «وفاق», «صوبہ») compares them, and one that says «نہیں» denies a job: neither is judged. A short
// key that names one government is read with its stem. The jobs are the table's own cell words, as
// phrases («ملکی دفاع», not «شہری دفاع»; «امن و امان کا قیام», not a wish for peace).
const TIER_NAMES = { وفاقی: 'federal', صوبائی: 'provincial', مقامی: 'local' };
const TIER_JOBS = {
  federal: ['ملکی دفاع', 'مسلح افواج', 'ملکی معیشت', 'خارجہ پالیسی'],
  provincial: ['تجاوزات', 'امن و امان کا قیام', 'صوبائی محصولات', 'داخلی پالیسی'],
  local: ['مویشی منڈی', 'عوامی میلے', 'نکاسی', 'پینے کے پانی', 'پینے کا پانی', 'بیواؤں', 'یتیموں', 'معذوروں'],
};
const flatUr = (text) => {
  let t = String(text == null ? '' : text).normalize('NFC').replace(UR_MARKS, '');
  for (const [re, to] of UR_FORMS) t = t.replace(re, to);
  return t.replace(/[\s​-‏]+/g, '');
};
const TIER_JOB_FLAT = Object.fromEntries(Object.entries(TIER_JOBS).map(([tier, jobs]) => [tier, jobs.map(flatUr)]));
const TIER_RE = new RegExp(`(${Object.keys(TIER_NAMES).map(flatUr).join('|')})حکومت`, 'g');
const CARRIES = /^\s*(?:وہ|یہ|یہی|وہی)\s/;
// A government named by its short name: «وفاق», «صوبہ / صوبے / صوبوں» (never «صوبائی»).
const TIER_SHORT = new Map([['وفاق', 'federal'], ['صوبہ', 'provincial'], ['صوبے', 'provincial'], ['صوبوں', 'provincial']].map(([w, t]) => [plain(w), t]));
const shortTiers = (sentence) => new Set(plain(sentence).split(' ').map((w) => TIER_SHORT.get(w)).filter(Boolean));
const tiersIn = (flat) => new Set([...flat.matchAll(TIER_RE)].map((m) => TIER_NAMES[Object.keys(TIER_NAMES).find((n) => flatUr(n) === m[1])]));
const jobsOf = (flat, tier) => TIER_JOB_FLAT[tier].some((j) => flat.includes(j));
const otherJob = (flat, tier) => Object.keys(TIER_JOB_FLAT).some((t) => t !== tier && jobsOf(flat, t));
function tierSlipIn(text) {
  let carry = null;
  for (const sentence of String(text || '').split(/[۔.!?؟\n]+/)) {
    const flat = flatUr(sentence);
    if (!flat) continue;
    const named = tiersIn(flat);
    const all = new Set([...named, ...shortTiers(sentence)]);
    if (all.size > 1 || /نہیں/.test(sentence)) { carry = null; continue; }
    const tier = named.size === 1 ? [...named][0] : (!all.size && CARRIES.test(` ${sentence.trim()} `) ? carry : null);
    carry = tier;
    if (tier && otherJob(flat, tier)) return true;
  }
  return false;
}
function tierSlip(q) {
  const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
  const points = Array.isArray(scheme.points) ? scheme.points.map((p) => p && p.text) : [];
  const accept = Array.isArray(scheme.accept) ? scheme.accept : [];
  if (textsOf(q.answer, points, accept).some(tierSlipIn)) return true;
  // «سڑکوں سے تجاوزات ہٹانا کس حکومت کا کام ہے؟ → مقامی حکومت»
  const key = flatUr(keyText(q));
  const keyed = tiersIn(key);
  if (keyed.size !== 1 || tokensOf(keyText(q)).length > ONE_LINE) return false;
  const tier = [...keyed][0];
  const stem = flatUr(q.question);
  return tiersIn(stem).size === 0 && !jobsOf(stem, tier) && otherJob(stem, tier);
}

// Social Studies Q6: a situation whose questions ask only book facts. FDE's Q6 brings a book idea
// to a case the book does not answer; who heads or chairs a body, what it is called, how many, when
// and what was done are Remember wherever they sit, and belong in Q7. Each asking clause of the stem
// is read: one that asks the child to decide, advise or act on the case (apply) or to give a reason,
// effect or comparison (explain) keeps the item; «which government does this job» is the case put to
// a book idea, and keeps it too. Held: two or more book-fact clauses, none to apply, and more facts
// than reasons («ریاستی مذہب کیوں اسلام ہے» beside «قومی زبان کیا ہے» keeps an item).
const Q6_SLOT = 'social_studies.D.Q6';
const ASK_WORDS = new Set(['کون', 'کونسا', 'کونسی', 'کیا', 'کیوں', 'کیسے', 'کتنے', 'کتنی', 'کتنا', 'کب', 'کہاں', 'کس', 'کن']);
const FACT_WORDS = new Set(['کون', 'کونسا', 'کونسی', 'کتنے', 'کتنی', 'کتنا', 'کب', 'کہاں', 'کس', 'کن']);
const ASKS = /بتائیں|بتاؤ|لکھیں|وضاحت|سمجھائیں|بیان کریں|جواب دیں|پوچھت|جاننا چاہت/;
const APPLIES = /چاہیے|چاہئے|چاہییں|مشورہ|مشورے|مشوروں|رائے دیں|بتائیں کہ وہ کیا کرے|تجویز|اقدام|طریق|مراحل|اپنائیں|کرائیں|کریں گے|سکتے ہیں|سکتی ہے|سکتا ہے|ہوتے تو|فیصلہ کریں|منتخب کرے|لاگو|درست ہے|صحیح ہے|مناسب|استعمال|انتظامات|اپنا حل/;
const EXPLAINS = /کیوں|وجہ|اثر|فائدہ|فائدے|نقصان|اہمیت|ضروری|فرق|موازنہ|جیسے|مشابہ|ملتا|ملتی|مختلف|خوبی|کیسے(?!\s*(چنا|چنے|چنی|منتخب))/;
const WHICH_TIER = /(کون|کس)\s+(کس\s+)?(سی\s+|سا\s+)?(کام\s+)?(سطح\s+(کی\s+)?)?(مقامی\s+|صوبائی\s+|وفاقی\s+)?حکومت/;
const DONE = /^(تھا|تھی|تھے|کیا|کی|کیے|اٹھایا|دیا|گیا|گئی|گئے|ہوا|ہوئی)$/;
const askTokens = (text) => text.replace(/[؟?!۔،,:؛«»"'()]/g, ' ').split(/\s+/).filter(Boolean);
function factClause(clause) {
  const t = askTokens(clause);
  if (t.some((w) => FACT_WORDS.has(w))) return true;
  if (/کیسے\s+(چنا|چنے|چنی|منتخب)/.test(clause)) return true;
  const k = t.lastIndexOf('کیا');
  if (k < 0) return false;
  const after = t.slice(k + 1);
  if (after[0] && /^کہلات/.test(after[0])) return true;
  if (after.length && after.length <= 2 && after.every((w) => /^(ہے|ہیں|ہوگا|ہوگی)$/.test(w))) return true;
  return after.length > 0 && DONE.test(t[t.length - 1]);
}
function asksRecall(q) {
  const sentences = String((q && q.question) || '').split(/(?<=[۔؟?!])|\n/).map((x) => x.trim()).filter(Boolean);
  let facts = 0;
  let reasons = 0;
  for (const sentence of sentences.filter((x) => /[؟?]$/.test(x) || ASKS.test(x))) {
    for (const clause of sentence.split(/[،,]|\sاور\s|\sکہ\s/).map((x) => x.trim()).filter(Boolean)) {
      if (!askTokens(clause).some((w) => ASK_WORDS.has(w)) && !ASKS.test(clause)) continue;
      if (APPLIES.test(clause)) return false;
      if (EXPLAINS.test(clause)) reasons += 1;
      else if (!WHICH_TIER.test(clause) && factClause(clause)) facts += 1;
    }
  }
  return facts >= 2 && facts > reasons;
}

// Social Studies Q6: a story that only relays a child's question («بلال نے پوچھا کہ زلزلہ کیا ہوتا ہے …
// آپ بلال کو مفصل جواب دیں»; «حمزہ جاننا چاہتا ہے کہ صحرا میں کھیتی باڑی کیوں نہیں ہوتی …»): its answer is
// the book's text in order, a Q5 in a story. The relayed question is read apart from the rest of the
// stem, so what it asks («… کیا کرنا چاہیے») is not a decision the child makes. Held when no sentence
// outside it asks the child to decide or advise. «بغیر پوچھے» relays nothing. A relay may end in a colon
// («علی نے استاد سے پوچھا: زلزلہ کیا ہوتا ہے …؟»), and what the child is asked may follow it in the same
// sentence, after a comma, spoken to the child («…، آپ اسے دو مشورے دیں کہ وہ کیا کرے»).
const RELAYS = /(?:پوچھا|پوچھتا|پوچھتی|پوچھتے|پوچھنا|جاننا\s*چاہت[اےی]|معلوم\s*کرنا\s*چاہت[اےی])(?:\s*(?:ہے|ہیں|تھا|تھی|تھے))?\s*(?:کہ(?:\s|$)|[:：])/;
function asksFrame(q) {
  const sentences = String((q && q.question) || '').split(/(?<=[۔؟?!])|\n/).map((x) => x.trim()).filter(Boolean);
  if (!sentences.some((x) => RELAYS.test(x))) return false;
  const outside = sentences.flatMap((x) => (RELAYS.test(x) ? x.split(/[،,]/).slice(1).filter((c) => /^\s*آپ\s/.test(c)) : [x]));
  return !outside.some((x) => APPLIES.test(x));
}

// Social Studies Q6: a story that only asks the child to tell someone what a place or a system is like
// («زارا کو بتائیں کہ وہاں موسم کیسا ہو گا …», «دونوں نظاموں کا موازنہ کرتے ہوئے بتائیں کہ … کون سی سہولتیں …»):
// its answer is the book's description in order, a Q5 in a story. Held when nothing in it asks the child to
// decide or advise (what someone should do, whom to turn to: «کیا کرنا چاہیے», «مشورے», «کس سے بات کرے»).
const TELLS = /کو\s+بتائیں\s+کہ[^۔؟?!]*(?:کیسا|کیسی|کیسے|کیا|کون\s*سی|کون\s*سے|کون\s*سا)|موازنہ\s+کرتے\s+ہوئے\s+بتائیں\s+کہ/;
// An instruction to the child («وضاحت کریں», «بیان کریں») decides nothing, so a subjunctive right after one is no
// decision; «کیسے … کر سکتا ہے» asks the child how someone can help, which is advice.
const DECIDES = /مشورہ|مشورے|مشوروں|رائے دیں|فیصلہ|تجویز|اقدام|کیا کرے|کیا کریں|کیا کرنا|(?:کرنا|کرنی|کرنے)\s*چاہی|کیسے[^۔؟?!]{0,40}سکت[اےی]|(?<!(?:وضاحت|بیان|تحریر|واضح)\s*)(?:رکھے|کرے|کریں|اپنائے|کہے)(?![\p{L}])(?!\s*(?:سکت|گا|گی|گے))/u;
function tellsWhat(q) {
  const stem = String((q && q.question) || '');
  return TELLS.test(stem) && !DECIDES.test(stem);
}

// Social Studies: a Q6 whose answer only names who does a job («تجاوزات ہٹانے کے لیے صوبائی حکومت کا
// درست نام», «سب سے بڑی عدالت سپریم کورٹ کا ذکر») is recall in a story, even with the book's line for
// a reason: an Apply item's answer explains with two ideas or more. Read on the marking points: an
// item that asks which government, court or body («کون سی حکومت», «کس ادارے», «کیا کہتے ہیں»), or
// marks one by name («… کے لیے صوبائی حکومت کا درست نام»), is held when fewer than two of its points
// explain without naming a government, court or body, and without being only how it is marked.
// A point that says which government does a job («… صوبائی حکومت کا کام ہے», «… مدد مقامی حکومت
// کرتی ہے») names it as surely as «… کا نام» does, and a province («صوبہ», «صوبے») is a body too.
const BODY = /(?:وفاقی|صوبائی|مقامی|ضلعی)\s*(?:حکومت|اسمبلی)|عدالت|کورٹ|اسمبلی|سینی?ٹ|مقننہ|انتظامیہ|عدلیہ|پارلیمان|پارلیمنٹ|الیکشن کمیشن|کابینہ|(?:^|\s)صوب(?:ہ|ے)(?:\s|$|۔)/;
const WHICH_BODY = /(?:کون|کس)[^؟?۔،]{0,16}(?:حکومت|ادارے|ادارہ|عدالت|حصے|سطح|اعضا|ایوان)|کون\s*(?:کرے|کرتا|کرتی|دیکھے|دیکھتا|دیکھتی|طے)/;
const CALLED = /کیا\s*(?:کہتے|کہلات)|کو\s*کیا\s*کہا\s*جاتا/;
const NAMING = /(?:^|\s)(?:نام|نشان\s*دہی|نشاندہی|پہچان|پہچاننا|شناخت)(?:\s|$|۔)/;
const DOES_JOB = /حکومت(?:وں)?\s*(?:کا\s*کام|کی\s*ذمہ\s*داری)|حکومت(?:یں)?\s*(?:کرتی|کرتا|دیکھتی|دیکھتا)/;
const names = (t) => NAMING.test(t) || DOES_JOB.test(t);
const EXPLAINING_POINTS = 2;
function namesBody(q) {
  const points = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => String(typeof p === 'string' ? p : (p && p.text) || ''));
  const stem = String((q && q.question) || '');
  if (!points.some((t) => names(t) && BODY.test(t)) && !WHICH_BODY.test(stem) && !CALLED.test(stem)) return false;
  return points.filter((t) => !BODY.test(t) && !names(t) && statesFact(t)).length < EXPLAINING_POINTS;
}

// Social Studies Q6: an answer that is a list the book gives (a party's jobs, a quarrel settled by the book's
// steps in its own words), set in a story, is recall: the child copies the book. Held when at least three of its
// marking points each restate a sentence of the pages (seven tenths of its words, marking words aside), all within
// three sentences side by side, or within one sentence that lists them. A point that uses a book idea in the
// story's own words is not a restatement: an Apply item's points carry the book's ideas too, so the test asks
// for the book's wording, in the book's order.
const LIST_POINTS = 3;
const LIST_SPAN = 2;
const LIST_SHARE = 0.7;
function bookList(q, sentences) {
  if (!sentences) return false;
  const at = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => [...new Set(tokensOf(String(typeof p === 'string' ? p : (p && p.text) || '')))].filter((w) => !PLACEHOLDER_WORDS.has(w) && !backGeneric.has(w)))
    .filter((words) => words.length >= PASSAGE_WORDS)
    .map((words) => sentences.flatMap((s, i) => (words.filter((w) => s.has(w)).length >= LIST_SHARE * words.length ? [i] : [])))
    .filter((list) => list.length);
  if (at.length < LIST_POINTS) return false;
  return [...new Set(at.flat())].some((from) => at.filter((list) => list.some((i) => i >= from && i <= from + LIST_SPAN)).length >= LIST_POINTS);
}

// Urdu: a Q1 MCQ keyed on a word of a Q6 verse line it asks about: its key's words are all in the
// line and its stem carries at least two of the line's other words («ندی کا پانی صاف ہو گا تو ہم کس
// چیز سے بچیں گے؟ → بیماری» beside «پانی جو صاف ہوگا بیماری سے بچوگے»), or it quotes a line. A
// key the verse merely shares («اور», «رات») with a stem about something else is no twin.
const VERSE_ASKS = 2;
function verseTwin(q6s) {
  const lines = q6s.flatMap((q) => verseLines(q.passage).lines);
  if (!lines.length) return null;
  const read = lines.map((l) => ({ tokens: new Set(tokensOf(l)), words: plain(l).split(' ') }));
  return (q) => {
    const key = tokensOf(keyText(q));
    const stem = [...new Set(tokensOf(q.question))].filter((w) => !key.includes(w));
    if (key.length && read.some((l) => key.every((w) => l.tokens.has(w)) && stem.filter((w) => l.tokens.has(w)).length >= VERSE_ASKS)) return true;
    return sentencesOf(q, false).some((t) => read.some((l) => printedIn(t, l.words)));
  };
}

// Urdu: a Q1 MCQ about a word Q3 (meanings) or Q5 (sentences) lists: its stem names the word and
// asks its meaning, or it is keyed on the meaning Q3's own answer gives it («اقتصادی» → «معاشی
// حالت سے» beside Q3's «اقتصادی: معاشی، …»). A Q1 item asking a listed word's opposite or its kind
// of noun, keyed on something else, stays. Read the other way, an item that gives the meaning in its
// stem and is keyed on a listed idiom («بہت زیادہ غصے میں آ جانا» → آگ بگولا ہونا, beside Q5's «آگ
// بگولا ہونا»; → شرم سے پانی پانی ہونا beside «پانی پانی ہونا») is the same twin: a key of two words
// or more that holds, or sits inside, a listed word of two words or more. A one-word key («پانی»)
// inside a listed idiom stays.
const MEANING_ASK = /مطلب|معنی|معانی|مراد|مفہوم/;
// An idiom read without the form of its verb: a trailing «جانا/ہونا/کرنا/دینا» is dropped and a
// «…انا» verb left last is cut to its root («مچانا» → «مچ»), so «دھوم مچ جانا» and «دھوم مچانا» are one
// idiom («دھوم مچ»), and «شور مچ جانا» another. A plain «…نا» verb is not cut: «دل لگنا» is not «دل
// لگانا». Two words at least, and a verb form actually set aside: a phrase with no verb («دھوم دھام»)
// is matched as written.
const LIGHT_VERBS = new Set(['جانا', 'ہونا', 'کرنا', 'دینا']);
function idiomOf(text) {
  const w = plain(text).split(' ').filter(Boolean);
  let cut = false;
  while (w.length > 2 && LIGHT_VERBS.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length < 2) return '';
  const root = w[w.length - 1].replace(/انا$/, '');
  if (root.length >= 2 && root !== w[w.length - 1]) { w[w.length - 1] = root; cut = true; }
  return cut ? w.join(' ') : '';
}
// Every idiom a stem prints, read as above: each run of two to six of its words.
function idiomsIn(text) {
  const w = plain(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < w.length; i += 1) {
    for (let n = 2; n <= 6 && i + n <= w.length; n += 1) { const id = idiomOf(w.slice(i, i + n).join(' ')); if (id) out.add(id); }
  }
  return out;
}
// A Q3/Q5 entry and a Q1 stem read without the form of their verb, for the meaning hold only: a
// trailing «ہے / ہیں / تھا / رہا / رہی / رہے / گیا / ہونا / جانا / کرنا …» is dropped and «نا» is cut
// off a last word of four letters or more («دم گھٹ رہا ہے» and «دم گھٹنا» are «دم گھٹ»; «دل لگ رہا ہے» is
// «دل لگ» and «دل لگانا» «دل لگا»). An entry with no verb form to set aside is matched as written.
const FOLD_TAIL = new Set('ہے ہیں تھا تھی تھے ہو رہا رہی رہے گا گی گے گیا گئی گئے جاتا جاتی جاتے ہونا جانا کرنا دینا'.split(' '));
function stemFold(text) {
  const w = plain(text).split(' ').filter(Boolean);
  let cut = false;
  while (w.length > 2 && FOLD_TAIL.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length >= 2 && FOLD_TAIL.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length < 2) return '';
  const last = w[w.length - 1];
  if (/نا$/.test(last) && [...last].length >= 4) { w[w.length - 1] = last.slice(0, -2); cut = true; }
  return cut ? w.join(' ') : '';
}
function foldsIn(text) {
  const w = plain(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < w.length; i += 1) {
    for (let n = 2; n <= 6 && i + n <= w.length; n += 1) {
      const run = w.slice(i, i + n).join(' ');
      out.add(stemFold(run) || run);
    }
  }
  return out;
}
// An item that asks an entry's use, not its meaning: «… کسے کہتے ہیں؟», «… کے لیے کون سا جملہ درست
// ہے؟», «… کس موقعے پر …», «… کس کے لیے بولا جاتا ہے؟».
const USE_ASK = /کسے کہتے|کون سا جملہ (?:درست|صحیح)|کس موقع|کس کے لیے بولا|بولا جاتا/;
const PHRASE_WORDS = 3;
function meaningTwin(lists) {
  const words = [...new Set(lists.flatMap((q) => (Array.isArray(q.words) ? q.words : [])).map(plain).filter(Boolean))];
  if (!words.length) return null;
  const phrases = words.filter((w) => w.split(' ').length >= 2);
  const keyedOn = (q) => {
    const k = plain(keyText(q));
    return k.split(' ').length >= 2 && phrases.some((w) => ` ${k} `.includes(` ${w} `) || ` ${w} `.includes(` ${k} `)
      || (Boolean(idiomOf(k)) && idiomOf(k) === idiomOf(w)));
  };
  const meanings = new Map();
  for (const q of lists.filter((x) => x.slot === 'urdu.C.Q3' && typeof x.answer === 'string')) {
    for (const line of q.answer.split('\n')) {
      const [w, ...rest] = line.split(/[:：]/);
      if (rest.length && plain(w)) meanings.set(plain(w), new Set(tokensOf(rest.join(' '))));
    }
  }
  return (q) => {
    if (keyedOn(q)) return true;
    const stem = ` ${plain(q.question)} `;
    const printed = idiomsIn(q.question);
    // A phrase of three words or more is named when the stem prints every one of its words, a word
    // put in between or not («قطرہ قطرہ ہی سمندر بنتا ہے» names «قطرہ قطرہ سمندر بنتا ہے»).
    const said = new Set(stem.trim().split(' '));
    const folds = foldsIn(q.question);
    const named = words.filter((w) => stem.includes(` ${w} `) || (Boolean(idiomOf(w)) && printed.has(idiomOf(w)))
      || (Boolean(stemFold(w)) && folds.has(stemFold(w)))
      || (w.split(' ').length >= PHRASE_WORDS && w.split(' ').every((t) => said.has(t))));
    if (!named.length) return false;
    if (MEANING_ASK.test(String(q.question)) || USE_ASK.test(plain(q.question))) return true;
    const key = tokensOf(keyText(q));
    return named.some((w) => meanings.has(w) && key.some((t) => meanings.get(w).has(t)));
  };
}

// Urdu Section C: one word in one place. A Q5 whose words take a word or idiom Q3 asks the meaning of
// (the same entry, or the same idiom in another verb form: «دھوم مچ جانا» / «دھوم مچانا») narrows the
// paper by that word. An idiom built on a Q3 word («شانہ بشانہ» beside «شانہ بشانہ کام کرنا») is
// another entry. `q3`: Q3's words.
function wordTwice(q5, q3) {
  const entry = (w) => { const t = plain(w); return [t, idiomOf(t)].filter(Boolean); };
  const asked = new Set(q3.flatMap(entry));
  return (Array.isArray(q5.words) ? q5.words : []).some((w) => typeof w === 'string' && entry(w).some((e) => asked.has(e)));
}

// Urdu Section C against Q1: Q4's twins, Q6's verse, Q3/Q5's words, each read from its own slot.
function urduTwin(placed) {
  const of = (...ids) => placed.filter((q) => ids.includes(q.slot));
  const rules = [q4Twin(of('urdu.C.Q4')), verseTwin(of('urdu.C.Q6')), meaningTwin(of('urdu.C.Q3', 'urdu.C.Q5')),
    nameListed(of('urdu.C.Q3', 'urdu.C.Q4', 'urdu.C.Q5'))].filter(Boolean);
  return rules.length ? (q) => rules.some((r) => r(q)) : null;
}

// Social Studies: a Q6 item answered with a Q5 item's points is that item again under another name
// (a purse found on the road in Q5, a wallet in Q6: return it to its owner, honesty, others' rights).
// A Q5 point is in the Q6 item when at least half of its words are in one Q6 point; the Q6 item
// restates the Q5 item when at least half of the Q5 points are in it. Points are compared, not
// stems, since the two name different things. The Q6 item is held, never the Q5 one.
// A point that only says how it is marked («پہلی وجہ درست بتانا», «مربوط وضاحت», «موسم کی درست
// وضاحت»: fewer than two words left once the marking words are set aside) states no fact. It is never
// found in another item, so two items that share only such points share nothing, and it still counts
// among its item's points. An item whose points all state no fact is read by its answer, a sentence to
// a point. Points that state a fact are read whole, as before.
const POINT_IN = 0.5;
const POINTS_IN = 0.5;
const PLACEHOLDER_WORDS = new Set(tokensOf('پہلی پہلا دوسری دوسرا تیسری تیسرا ایک دو ہر درست وجہ وجوہات فائدہ فوائد اثر اثرات '
  + 'وضاحت مربوط واضح مکمل مناسب نکتہ نکات خصوصیت بیان کرنا اقدام فعل مثال نقصان بتانا بتایا لکھنا لکھی لکھا ذکر جملوں جملہ صحیح'));
const FACT_WORDS_MIN = 2;
// A point states a fact when it has two words that are not marking words, or when every word in it
// is one (a name, like «مقننہ»).
const statesFact = (text) => {
  const words = tokensOf(text);
  const facts = words.filter((w) => !PLACEHOLDER_WORDS.has(w)).length;
  return facts >= FACT_WORDS_MIN || (facts > 0 && facts === words.length);
};
// Each point's words, or null for a point that states no fact.
function pointSets(q) {
  const points = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && tokensOf(t).length);
  const sets = points.map((t) => (statesFact(t) ? new Set(tokensOf(t)) : null));
  if (sets.some(Boolean) || !points.length || typeof q.answer !== 'string') return sets;
  return q.answer.split(/[۔؟?!\n]+/).filter(statesFact).map((t) => new Set(tokensOf(t)));
}
function samePoints(q5s) {
  const sets = q5s.map(pointSets).filter((s) => s.some(Boolean));
  if (!sets.length) return null;
  return (q) => {
    const mine = pointSets(q).filter(Boolean);
    if (!mine.length) return false;
    return sets.some((five) => five.filter((a) => a && mine.some((b) => [...a].filter((w) => b.has(w)).length >= POINT_IN * a.size)).length
      >= POINTS_IN * five.length);
  };
}
// A one-fact Q7 whose answer is one point of a longer Q5 or Q6 item (Q7 «برقی توانائی» beside a Q5
// point «الیکٹرانک میڈیا … (برقی توانائی کا استعمال)», Q7 «سلام کرنا» beside a Q6 point «سلام کرنے کا
// ذکر») is answered by that item: a child who writes the long answer has written the Q7's. Read on the
// same words as `samePoints`, the other way round: every word of the Q7's answer is in one point, or
// in the answer, of the other item, and the other item is about what the Q7 asks of. That is what the
// Q7's stem names (`stemPhrase`, «بلوچستان کے شاہی جرگے», its answer and «پاکستان» aside): at least
// half of it is in the other item's question or in the text that holds the answer. A date or a name
// the other item gives for another thing («26 جون 1947ء» for Sindh's assembly; «لیاقت علی خان» inside
// «بیگم رعنا لیاقت علی خان») is not the same fact. A stem that names nothing is read on any word of it.
const QUIET_WORDS = new Set(tokensOf('درست جواب نام لکھا لکھنا پہلا پہلی دوسرا دوسری مثال ذکر بیان چاہیے چاہییں پاکستان'));
function keyInPoints(others) {
  const items = others.filter(Boolean).map((q) => ({
    texts: [...(q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []).map((p) => (typeof p === 'string' ? p : p && p.text)), q.answer]
      .filter((t) => typeof t === 'string' && t.trim()).map((t) => ({ words: new Set(tokensOf(t)), folded: folded(t) })).filter((t) => t.words.size),
    question: folded(q.question),
  })).filter((o) => o.texts.length);
  if (!items.length) return null;
  const quiet = new Set([...QUIET_WORDS].map(foldUr));
  return (q) => {
    if (!q || tokensOf(q.answer).length > ONE_LINE) return false;
    const key = new Set(tokensOf(q.answer).filter((w) => !QUIET_WORDS.has(w)));
    if (!key.size) return false;
    const keyF = new Set([...key].map(foldUr));
    const names = [...stemPhrase(q.question)].filter((w) => !keyF.has(w) && !quiet.has(w));
    const asked = [...folded(q.question)].filter((w) => !keyF.has(w) && !quiet.has(w));
    return items.some((o) => o.texts.some((t) => {
      if (!within(key, t.words)) return false;
      const about = new Set([...o.question, ...t.folded]);
      return names.length ? share(new Set(names), about) * 2 >= names.length : asked.some((w) => about.has(w));
    }));
  };
}
// Social Studies Q7: an answer whose words are all in its own question («انٹرنیٹ کی مدد سے طلبہ کون سے مواد تک
// رسائی حاصل کر سکتے ہیں جو تحقیق میں کام آتا ہے؟ → تحقیقی مواد») is printed for the child to copy. A bracket
// in the answer (an English gloss) is set aside; an answer that adds a word of its own stays.
const Q7_SLOT = 'social_studies.D.Q7';
// Science Q1(b) prints its `question` as the frame title «Diagram: …»: it must be the diagram's
// name («Layers of the Earth»), never an instruction («Label any five parts…») (v24 review).
const DIAGRAM_SLOT = 'science.A.Q1b';
const notDiagramName = (q) => /^\s*(label|draw|name)\b/i.test(String((q && q.question) || ''));
function keyInOwnStem(q) {
  const key = tokensOf(keyText(q).replace(/\([^()]*\)/g, ' '));
  const stem = tokensOf(q.question);
  return key.length > 0 && key.every((w) => holdsWord(stem, w));
}
// The point-set rows, laid in this order: a Q6 against the Q5s, a Q6 against the Q6s placed before
// it (one online disagreement told twice with the same four points), then a Q7 against the Q5s and
// the Q6s now placed. The held slot's item is held, never the other one.
const SAME_POINTS = [
  { held: 'social_studies.D.Q6', against: ['social_studies.C.Q5'], rule: samePoints, name: 'points' },
  { held: 'social_studies.D.Q6', against: ['social_studies.D.Q6'], rule: samePoints, name: 'points_in_slot' },
  { held: 'social_studies.D.Q7', against: ['social_studies.C.Q5', 'social_studies.D.Q6'], rule: keyInPoints, name: 'key_in_points' },
];

const CROSS_HOLD = {
  english: { held: ['english.A.Q1a'], against: 'english.C.Q4', rule: q4Words },
  urdu: { held: ['urdu.A.Q1'], against: ['urdu.C.Q4', 'urdu.C.Q6', 'urdu.C.Q3', 'urdu.C.Q5'], rule: urduTwin },
  social_studies: { held: ['social_studies.C.Q5', 'social_studies.D.Q7'], against: 'social_studies.A.Q1', rule: sameFact },
};

// Social Studies, Section A read against the C and D stems placed: a Q1 item a later stem gives away
// is held, and Section A is asked again (A's re-ask is a top-up; C and D are never moved for A).
// (1) Its key, a name, a year or a number, is printed in a C/D stem on the same topic: the stems share a
//     word besides the key («قراردادِ پاکستان 23 مارچ 1940ء کو …» beside «قراردادِ پاکستان کس سال منظور
//     ہوئی؟ → 1940ء»). A concept term (a tier, a body, democracy, a citizen's duty) is the chapter's own
//     word and every stem may name it; the words every stem shares («حکومت», «پاکستان») are no topic.
// (2) It asks what a Q5 asks: the same question word; the same civics terms, every one of either stem's
//     in the other (legislature against executive is not executive against judiciary); a shared word
//     besides them; and at least three of the shorter stem's words, three fifths of them («جمہوریت کو
//     بہترین طرزِ حکومت کیوں سمجھا جاتا ہے؟» beside «جمہوریت کو بہترین نظام حکومت کیوں کہا جاتا ہے؟ دو
//     وجوہات لکھیں۔»). Words are read without the question's frame («کیا مراد ہے», «وضاحت کریں», «آپ»).
const SST_A_Q1 = 'social_studies.A.Q1';
const BACK_RULES = new Set(['key_in_stem', 'key_named_in_stem', 'asked_in_c']);
// Two words of a Q1 stem's question beside its key: a stem that states the fact.
const STATES_WORDS = 2;
const BACK_CONCEPT = /حکومت|جمہوری|شہنشاہ|آمری|مقننہ|انتظامیہ|عدلیہ|عدالت|کورٹ|اسمبلی|سینی?ٹ|ایوان|شہری|ذمہ دار|قانون|آئین/;
const BACK_ASKS = new Set(['کیوں', 'کیا', 'کون', 'کب', 'کہاں', 'کتنے', 'کتنی', 'کتنا', 'کیسے', 'کس']);
const asksOf = (text) => new Set(String(text || '').split(/[\s؟?،,۔:]+/).filter((w) => BACK_ASKS.has(w)));
const SAME_ASK_WORDS = 3;
const SAME_ASK_SHARE = 0.6;
// Civics terms as tokensOf leaves them (an ending cut: انتظامیہ → انتظامی, شہری → شہر).
const BACK_TERM = /^(?:حکوم|جمہور|شہنشاہ|آمر|مقنن|انتظامی|عدلی|عدالت|کورٹ|اسمبل|سینی?ٹ|ایوان|شہر|ذمہ|دار|قانون|آئین)/;
// One word in two forms: equal, or one the other's start (داری / داریاں), three letters or more.
const nearWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
const holdsWord = (list, w) => list.some((x) => nearWord(x, w));
let backGeneric = new Set(tokensOf('حکومت ملک کام پاکستان ادارہ ادارے لوگ لوگوں کسی کوئی نام کرنا معاملات علاقہ علاقے شخص شخصیت سال'));
let backFrame = null;
// A key that is a date («23 مارچ 1940ء», «1940ء») belongs to one event, so a stem that prints it gives it away
// whatever words the stems share. A concept term is given away when a stem prints it as the gloss of what the
// Q1 stem asks about, or the other way round: «ایوانِ زیریں (قومی اسمبلی)» beside «ایوانِ زیریں کا دوسرا نام
// کیا ہے؟ → قومی اسمبلی»; «شہنشاہیت (بادشاہت)» beside «بادشاہ یا ملکہ کے ملک چلانے کا نظام → شہنشاہیت».
const DATE_KEY = /^\s*(?:[\d۰-۹]{1,2}\s+\p{L}+\s+)?[\d۰-۹]{4}\s*ء?\s*(?:میں|کو)?\s*[۔.]?\s*$/u;
const GLOSS = /([^()\n]+?)\s*\(([^()\n]+)\)/g;
function glossed(key, stemWords, text) {
  const k = plain(key);
  if (!k) return false;
  const inStem = (words) => words.length > 0 && words.every((w) => holdsWord(stemWords, w));
  return [...String(text).matchAll(GLOSS)].some((m) => {
    const before = plain(m[1]);
    const inside = plain(m[2]);
    if (inside === k) return inStem(tokensOf(before.split(' ').slice(-2).join(' ')).filter((w) => w.length >= 3));
    return ` ${before} `.endsWith(` ${k} `) && inStem(tokensOf(m[2]));
  });
}
// (3) Its key is a name (a person, a place, an organisation) that sits in one of its options and no other, and a
//     C/D stem names that option («… → عبدالستار ایدھی» beside «ایدھی فاؤنڈیشن نے …»; «… → چودھری رحمت علی» beside
//     «چودھری رحمت علی نے 28 جنوری 1933ء کو …»). No shared topic is needed: a child who reads that stem knows which
//     option to pick. This is a precaution beyond the gate, which counts only a stem that states the Q1 fact; a
//     name printed alone is reported there, and holding it here costs one Section A re-ask. A term the chapter
//     teaches is never read here (TERM_KEY). A stem names an option when it prints all of its words, or all the
//     words no other option has (two or more: «علی گڑھ» for «تحریک علی گڑھ» beside «تحریک خلافت»), or at least
//     half of those words of four letters or more, the parts many names share («محمد», «علی», «خان») aside
//     («ایدھی» for «عبدالستار ایدھی»; «گڑھ» is not «مہر گڑھ»), or the one such word of four letters or more
//     («کراچی» for «کراچی پورٹ» beside «پورٹ قاسم»). A key that sits in two options («لیاقت علی خان» inside «بیگم
//     رعنا لیاقت علی خان») names no one, and neither does a stem that prints it only inside a wife's name («بیگم
//     رعنا لیاقت علی خان» carries «لیاقت علی خان»). A key that is no name is not read here: a phrase of three words
//     or more with a function word («ٹیلی وژن میں آواز کے ساتھ تصویر …», «کم ہوتا ہے»; «کے ٹو» is a name), an act
//     («بات کرنا»), a number word, a word marking points use for any fact («نقصان», «فائدہ»), or a key with a digit
//     (that is (1)). A tier («مقامی حکومت») is the three-tier chapter's own word: the which-government items are
//     read by their book line (`sameLine`) and the tier slip, not here.
const NAME_PARTS = new Set(tokensOf('محمد علی خان احمد سید شاہ بیگم حضرت سر قائد اعظم'));
const NAME_LETTERS = 4;
// A stem that names three of the item's options or more lists them («مقننہ، انتظامیہ اور عدلیہ») and picks none.
const LISTS_OPTIONS = 3;
const WIFE = 'بیگم';
const NUMBER_WORDS = new Set('ایک دو تین چار پانچ چھ چھے سات آٹھ نو دس'.split(' '));
const notAName = (key) => {
  const words = plain(key).split(' ').filter(Boolean);
  return words.some((w) => NUMBER_WORDS.has(w)) || (words.length >= 3 && words.some((w) => STOP.has(w)))
    || (words.length >= 2 && /نا$/.test(words[words.length - 1]));
};
// Where the words `t` stand in a row in `line` (a stem's tokens in order), none inside a wife's name.
const printsRun = (t, line) => line.some((_, i) => t.every((w, j) => line[i + j] === w) && !line.slice(Math.max(0, i - 2), i).includes(WIFE));
// `seen`: the Q1 stem's own words. Part of a name the Q1 stem prints itself («ایدھی» in «عبدالستار ایدھی نے کون
// سی تنظیم قائم کی؟ → ایدھی فاؤنڈیشن») tells the child nothing new when a C/D stem prints it too.
function namesOption(t, others, words, line, seen) {
  if (t.length && t.every((w) => words.has(w))) return printsRun(t, line);
  const own = t.filter((w) => !others.has(w) && !backGeneric.has(w));
  const fresh = (w) => words.has(w) && !seen.has(w);
  if (own.length >= 2 && own.every((w) => words.has(w)) && own.some(fresh)) return true;
  const strong = own.filter((w) => !NAME_PARTS.has(w));
  const long = strong.filter((w) => w.length >= NAME_LETTERS);
  if (strong.length >= 2) { const printed = long.filter(fresh).length; return printed > 0 && printed * 2 >= strong.length; }
  return strong.length === 1 && long.length === 1 && fresh(long[0]);
}
// `own`: the stems are the item's own (its stem names its own key), so none of its words is set aside as seen.
// A term the chapter teaches (a body, a tier, democracy, a citizen; the media) is the chapter's own word, which its
// stems name as they ask about it: a name hold on it would empty Section A, and FDE's own paper prints that shape
// (its Q1 «ثقافت» beside a Q6 on culture). It is held only when a stem states its fact (`givenBack`, (1)).
const TERM_KEY = new RegExp(`${BACK_CONCEPT.source}|میڈیا|ابلاغ`);
function keyNamedIn(m, stems, own = false) {
  if (!Array.isArray(m.options) || m.options.length < 3 || /\d/.test(keyText(m)) || notAName(keyText(m)) || TERM_KEY.test(keyText(m))) return false;
  const key = tokensOf(keyText(m));
  if (!key.length || key.every((w) => backGeneric.has(w) || PLACEHOLDER_WORDS.has(w)) || tiersIn(flatUr(keyText(m))).size) return false;
  const opts = m.options.map((o) => tokensOf(String(o).replace(OPTION_HEAD, '')));
  const at = m.options.findIndex((o) => plain(String(o).replace(OPTION_HEAD, '')) === plain(keyText(m)));
  if (at < 0 || opts.filter((t) => key.every((w) => t.includes(w))).length !== 1) return false;
  const others = (i) => new Set(opts.filter((_, j) => j !== i).flat());
  const seen = own ? new Set() : new Set(tokensOf(m.question));
  return stems.some((x) => namesOption(opts[at], others(at), x.words, x.tokens, seen)
    && opts.filter((t, i) => namesOption(t, others(i), x.words, x.tokens, seen)).length < LISTS_OPTIONS);
}
// Social Studies Q1 against itself: a stem that names its own key («ایدھی فاؤنڈیشن کس شخصیت نے قائم کی؟ →
// عبدالستار ایدھی»), or the key of another Q1 item on the paper, prints that answer for the child to pick (read as
// a C/D stem is, above). The item whose key is named is the one held: a key many stems name («سوشل میڈیا») costs
// one item, not every stem that names it.
const stemOf = (q) => ({ words: new Set(tokensOf(q.question)), tokens: tokensOf(q.question) });
const namesOwnKey = (q) => keyNamedIn(q, [stemOf(q)], true);
const stemNamesKey = (stemQ, keyQ) => keyNamedIn(keyQ, [stemOf(stemQ)]);
function givenBack(placed) {
  const stems = placed.filter((q) => typeof q.question === 'string' && q.question.trim())
    .map((q) => ({ slot: q.slot, text: q.question, line: ` ${tokensOf(q.question).join(' ')} `, tokens: tokensOf(q.question), words: new Set(tokensOf(q.question)), asks: asksOf(q.question) }));
  backFrame = backFrame || new Set(tokensOf('مراد وضاحت بیان کریں کیجیے جاتا جاتی جاتے سمجھا کہا دو تین کوئی وجہ وجوہات بات طور آپ چاہیے کرنا مختصر جواب'));
  const contentOf = (text) => [...new Set(tokensOf(text).filter((w) => !backFrame.has(w)))];
  if (!stems.length) return null;
  const q5s = stems.filter((x) => x.slot === 'social_studies.C.Q5');
  return (m) => {
    const key = tokensOf(keyText(m));
    if (key.length && !BACK_CONCEPT.test(keyText(m)) && (key.some((w) => /\d/.test(w)) || key.join('').length >= 3)) {
      const printedKey = ` ${key.join(' ')} `;
      const dated = DATE_KEY.test(keyText(m));
      const topic = tokensOf(m.question).filter((w) => !key.includes(w) && w.length >= 3 && !backGeneric.has(w));
      if (stems.some((x) => x.line.includes(printedKey) && (dated || topic.some((w) => x.words.has(w))))) return 'key_in_stem';
    }
    if (key.length && TERM_KEY.test(keyText(m))) {
      const stemWords = tokensOf(m.question).filter((w) => !key.includes(w));
      if (stems.some((x) => glossed(keyText(m), stemWords, x.text))) return 'key_in_stem';
      // A term a stem prints beside two words of the Q1 stem's own question states the fact the Q1 asks
      // («قانون بنانے کا اختیار کس ادارے کے پاس ہے؟ → مقننہ» beside «مقننہ قانون بناتی ہے، اس کے دو ایوانوں …»).
      const printedKey = ` ${key.join(' ')} `;
      const topic = [...new Set(tokensOf(m.question))].filter((w) => !key.includes(w) && w.length >= 3 && !backGeneric.has(w));
      if (stems.some((x) => x.line.includes(printedKey) && topic.filter((w) => x.words.has(w)).length >= STATES_WORDS)) return 'key_in_stem';
    }
    if (keyNamedIn(m, stems)) return 'key_named_in_stem';
    const own = contentOf(m.question);
    const asks = asksOf(m.question);
    const same = q5s.some((x) => {
      if (![...asks].some((w) => x.asks.has(w))) return false;
      const other = contentOf(x.text);
      const terms = (list) => list.filter((w) => BACK_TERM.test(w));
      if (!terms(own).every((w) => holdsWord(other, w)) || !terms(other).every((w) => holdsWord(own, w))) return false;
      const shared = own.filter((w) => holdsWord(other, w));
      return shared.some((w) => !BACK_TERM.test(w))
        && shared.length >= SAME_ASK_WORDS && shared.length >= SAME_ASK_SHARE * Math.min(own.length, other.length);
    });
    return same ? 'asked_in_c' : null;
  };
}

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
const FRAME_WORDS = new Set(('which what choose pick select find correct right following given below one option answer '
  + 'word words noun verb adjective adverb pronoun preposition is are the a an of from').split(' '));
// A written item (no options) is also the same question when only its endings, its case markers
// or the number and gender of its copula differ («پاکستان کے پہلے وزیر اعظم کون تھے؟» / «پاکستان
// کا پہلا وزیر اعظم کون تھا؟»); the tense stays («ہے» ≠ «تھا») and so do the question words, so
// «کب» and «کہاں» are two questions.
const CASE_MARKERS = new Set(['کا', 'کی', 'کے']);
const COPULA = { تھا: 'تھا', تھی: 'تھا', تھے: 'تھا', ہے: 'ہے', ہیں: 'ہے' };
const writtenKey = (text) => plain(text).split(' ')
  .filter((w) => w && !CASE_MARKERS.has(w))
  .map((w) => COPULA[w] || (/^\p{Script=Arabic}{4,}$/u.test(w) ? w.replace(/(?:وں|یں|ے|ہ|ی|ا)$/, '') : w))
  .join(' ');
// Urdu: the same stem keyed the same is one question, whatever distractor a rewrite changed (a
// top-up told to write nothing it kept rewrote one with a single option swapped). So is a kept
// fact asked again under a new stem: the same key (one key's words all in the other's, the shorter
// more than half the longer: «مینا بازار» / «مینا بازاروں» / «مینا بازار لگانے», never «کاش» beside
// «کاش میں پرندہ ہوتا») and stems that, keys aside, share two words or one's words all in the other's
// («… کس شعبے کی ڈگری حاصل کی؟» / «… کس پیشے کی ڈگری حاصل کی تھی؟» → دندان سازی). One shared word
// («شہر»: where she was born / the biggest city, both «کراچی») is two questions.
const TWIN_WORDS = 2;
function sameStemKey(a, b) {
  const s = plain(a.question);
  if (Boolean(s) && s === plain(b.question) && Boolean(plain(keyText(a))) && plain(keyText(a)) === plain(keyText(b))) return true;
  const [ka, kb] = [new Set(tokensOf(keyText(a))), new Set(tokensOf(keyText(b)))];
  if (!ka.size || !kb.size) return false;
  const [small, big] = ka.size <= kb.size ? [ka, kb] : [kb, ka];
  if (small.size * 2 <= big.size || ![...small].every((w) => big.has(w))) return false;
  const sa = new Set(tokensOf(a.question).filter((w) => !ka.has(w)));
  const sb = new Set(tokensOf(b.question).filter((w) => !kb.has(w)));
  if (!sa.size || !sb.size) return false;
  const shared = [...sa].filter((w) => sb.has(w)).length;
  return shared >= TWIN_WORDS || shared === sa.size || shared === sb.size;
}
// Social Studies: two MCQs keyed the same that name the same job are one question asked twice
// («پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام کون سی حکومت دیکھتی ہے؟» beside «… بارش کے بعد
// سڑکوں پر پانی جمع … نکاسی کا انتظام … کون سی حکومت کرے گی؟», both → مقامی حکومت). Urdu's same-key
// read, with the words every which-government stem shares («حکومت», «کام», «انتظام») set aside, so
// two jobs of one government («مویشی منڈی», «نکاسی آب») stay two questions. Only a key that names a
// government or body: two facts about one person («APWA کس نے قائم کی؟», «پہلی خاتون صوبائی گورنر کون
// تھیں؟», both → بیگم رعنا لیاقت علی خان) are two questions.
const TASK_FRAME = new Set(tokensOf('حکومت حکومتیں کام انتظام ذمہ داری سطح ادارہ ادارے دیکھتی دیکھے کرے گی کرتی کرنا'));
function sameTask(a, b) {
  if (!Array.isArray(a.options) || !Array.isArray(b.options) || !/حکومت/.test(keyText(a)) && !BODY.test(keyText(a))) return false;
  const bare = (q) => ({ ...q, question: tokensOf(q.question).filter((w) => !TASK_FRAME.has(w)).join(' ') });
  return sameStemKey(bare(a), bare(b));
}
// Social Studies: two MCQs keyed on the same government whose jobs come from one line of the book's
// table (p.29) are one fact asked twice, once directly and once as a case («پینے کے پانی کا بندوبست کون
// سی حکومت دیکھتی ہے؟» beside «… گلیوں کا گندا پانی نکالنے کا مسئلہ … کس حکومت سے رابطہ …؟», both →
// مقامی حکومت, from «پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام دیکھتی ہے»). Jobs from two lines
// («مویشی منڈیاں» and «نکاسی آب») stay two questions. A stem that names jobs from two lines is no line's.
const BOOK_LINES = [
  ['ملکی دفاع', 'مسلح افواج'],
  ['ملکی معیشت'],
  ['خارجہ پالیسی', 'بیرونی ممالک'],
  ['نظم و نسق', 'نظم ونسق', 'قانون سازی', 'تجاوزات', 'امن و امان'],
  ['صوبائی محصولات'],
  ['داخلی پالیسی'],
  ['مویشی منڈی', 'عوامی میلے', 'میلے'],
  ['پینے کے پانی', 'پینے کا پانی', 'نکاسی', 'گندا پانی', 'گندے پانی', 'پانی نکال'],
  ['بیواؤں', 'یتیموں', 'معذوروں', 'قدرتی آفات'],
].map((line) => line.map(flatUr));
function bookLineOf(stem) {
  const flat = flatUr(stem);
  const lines = BOOK_LINES.map((line, i) => (line.some((w) => flat.includes(w)) ? i : -1)).filter((i) => i >= 0);
  return lines.length === 1 ? lines[0] : null;
}
function sameLine(a, b) {
  if (!Array.isArray(a.options) || !Array.isArray(b.options) || !tiersIn(flatUr(keyText(a))).size) return false;
  if (plain(keyText(a)) !== plain(keyText(b))) return false;
  const line = bookLineOf(a.question);
  return line !== null && line === bookLineOf(b.question);
}
// Social Studies: the book's page text (`opts.book`, the pages the section prompts were given) read as its
// sentences, in order, each as its words. A page's lines are joined first: the page store breaks a sentence
// across lines, so a line is no sentence; a sentence ends at «۔», «؟», «!» or «?», and at a page's end.
let bookCache = null;
function bookSentences(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (bookCache && bookCache.text === text) return bookCache.sentences;
  const sentences = text.split(/^=== Page [^\n]*===\s*$/m)
    .flatMap((page) => page.replace(/\s*\n\s*/g, ' ').split(/[۔؟?!]+/))
    .map((t) => new Set(tokensOf(t))).filter((w) => w.size >= 2);
  bookCache = { text, sentences };
  return sentences;
}
// The sentences that hold `words` (at least two of them, and at least half), by index: a fact the book states
// twice (its lesson, then its exercise) sits in both.
const PASSAGE_WORDS = 2;
function sentencesHolding(words, sentences) {
  if (!sentences || words.length < PASSAGE_WORDS) return [];
  return sentences.flatMap((s, i) => { const n = words.filter((w) => s.has(w)).length; return n >= PASSAGE_WORDS && n * 2 >= words.length ? [i] : []; });
}
// Social Studies: two MCQs with the same key whose facts sit in one book sentence or two sentences side by side
// are one fact asked twice («پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟» beside «1973ء میں سندھ کی گورنر کون
// بنیں؟», both → بیگم رعنا لیاقت علی خان, from «1973ء میں وہ صوبہ سندھ کی گورنر بن گئیں۔ وہ پاکستان کی پہلی خاتون
// صوبائی گورنر تھیں۔»). Each stem is placed by its own words, its key and the words every stem shares aside.
// Facts from sentences further apart stay two questions (APWA, founded four sentences before). A tier is read
// by its table line instead (`sameLine`): the table's lines stand side by side, and each is its own job.
function samePassage(a, b, sentences) {
  if (!sentences || !Array.isArray(a.options) || !Array.isArray(b.options)) return false;
  const key = plain(keyText(a));
  if (!key || key !== plain(keyText(b)) || tiersIn(flatUr(keyText(a))).size) return false;
  const at = (q) => { const k = new Set(tokensOf(keyText(q))); return sentencesHolding([...new Set(tokensOf(q.question))].filter((w) => !k.has(w) && !backGeneric.has(w)), sentences); };
  const [x, y] = [at(a), at(b)];
  return x.some((i) => y.some((j) => Math.abs(i - j) <= 1));
}
// Urdu: a Q1 stem that prints another Q1 item's key gives that item away («سدرہ نے اپنی تھیڑ کمپنی
// کس مقصد کے لیے بنائی؟» beside «… کیا بنایا؟ → تھیڑ کمپنی»): a key of two words or more, all in the
// stem. A one-word key a stem merely names («… کس چیز کی علامت ہیں؟ → امن» beside ««امن» کا متضاد …»)
// stays, unless each item's stem prints the other's key («ہیروشیما کس ملک کا شہر ہے؟ → جاپان» beside
// «جاپان کا کون سا شہر …؟ → ہیروشیما»). An item that names the kind of a quoted example («'میری دعا
// ہے کہ …' یہ کس قسم کا جملہ ہے؟ → تمنائی جملہ») is not given away by a stem that names the kind
// («کون سا لفظ تمنائی جملے میں استعمال ہوتا ہے؟»): its question is the example.
const GIVEN_WORDS = 2;
const QUOTES_EXAMPLE = /«[^»]+»|[’‘]{2}[^’‘]+[’‘]{2}|“[^”]+”|"[^"]+"|'[^']+'/u;
function stemGivesKey(a, b) {
  const key = (q) => new Set(tokensOf(keyText(q)));
  const prints = (stemOf, keyOf) => {
    const k = key(keyOf);
    const stem = new Set(tokensOf(stemOf.question));
    return k.size > 0 && [...k].every((w) => stem.has(w));
  };
  // A one-word key is given away too when the stem that prints it is on the same topic: the two
  // stems share a content word besides the key («… کانفرنس کس شہر میں ہوئی؟ → ٹوکیو» beside «…
  // ٹوکیو کی کانفرنس میں آنے کا بلاوا …»).
  const topic = (q, by) => {
    const k = key(q);
    const other = new Set(tokensOf(by.question).filter((w) => w.length >= 3 && !k.has(w)));
    return tokensOf(q.question).some((w) => w.length >= 3 && !k.has(w) && other.has(w));
  };
  // A quoted word list is no example: a stem that lists another item's key among its words
  // («کمبل، آتش دان، مونگ پھلی، ریوڑیاں» … → سردی beside «… کون سا لفظ شامل نہیں ہو سکتا؟ → آتش
  // دان») prints that key, whatever the item asking it quotes.
  const listed = (q, by) => {
    const k = plain(keyText(q));
    return Boolean(k) && (String(by.question || '').match(QUOTE_SPAN) || [])
      .some((quote) => { const words = quote.split(/[،,]/).map(plain).filter(Boolean); return words.length >= 2 && words.includes(k); });
  };
  // A stem that names a one-word key gives it away only when it names no other option of that item
  // («ببلو نے اسلم اور کیک کے بارے میں …» names two of «کھیر / حلوہ / کیک / اسلم»: no cue).
  const namesOnlyKey = (q, by) => {
    const stem = new Set(tokensOf(by.question));
    return Array.isArray(q.options) && q.options.filter((o) => {
      const words = tokensOf(String(o).replace(OPTION_HEAD, ''));
      return words.length > 0 && words.every((w) => stem.has(w));
    }).length === 1;
  };
  const given = (q, by) => listed(q, by) || (!QUOTES_EXAMPLE.test(String(q.question || ''))
    && (key(q).size >= GIVEN_WORDS || (key(q).size === 1 && topic(q, by) && namesOnlyKey(q, by))));
  // Another item's OPTION that prints a key of two words or more, in order, inside something it says
  // about it, states that key as a fact, even as a wrong option («سدرہ نے … کیا بنایا؟ → تھیڑ کمپنی»
  // beside «ب) سدرہ کی تھیڑ کمپنی بند کرنے کی»). An option that is only the key, or a one-word key
  // («کراچی», «امینہ» among four names), tells nothing. Nor does a sample sentence that uses a grammar
  // item's key when that item quotes its own example («'___ ہم سب کو کامیابی ملے۔' → اللہ کرے» beside
  // the option «ج) اللہ کرے امتحان آسان ہو۔»): its question is the example.
  const optionStates = (q, by) => {
    const k = plain(keyText(q));
    if (key(q).size < GIVEN_WORDS || !Array.isArray(by.options) || QUOTES_EXAMPLE.test(String(q.question || ''))) return false;
    return by.options.some((o) => { const t = plain(String(o).replace(OPTION_HEAD, '')); return t !== k && ` ${t} `.includes(` ${k} `); });
  };
  const [ab, ba] = [prints(a, b), prints(b, a)];
  return (ab && ba) || (ab && given(b, a)) || (ba && given(a, b)) || optionStates(a, b) || optionStates(b, a);
}
// Urdu Q4: an item with four options (in `options`, or on the stem's lines below it) keyed on one
// option and accepting another («ج) بارش», accepting «د) فلکیات») has two answers. It is held and
// never comes back: the key a teacher marks from would be a guess. An accepted answer that is no
// option («جب، تو» beside «اگر، تو») is another way of writing the key, and stays.
const OPTION_LETTER = /^\s*\(?([a-dA-D]|الف|ب|ج|د)\s*[).:۔-]/;
function keyAcceptSplit(q) {
  const options = Array.isArray(q.options) && q.options.length
    ? q.options.map(String)
    : String(q.question || '').split('\n').slice(1).filter((l) => OPTION_HEAD.test(l));
  if (options.length !== 4) return false;
  const letterOf = (t) => { const m = String(t).match(OPTION_LETTER); return m ? m[1].toLowerCase() : null; };
  const texts = options.map((o) => plain(String(o).replace(OPTION_HEAD, '')));
  const which = (t) => {
    const letter = letterOf(t);
    const byLetter = letter ? options.findIndex((o) => letterOf(o) === letter) : -1;
    return byLetter >= 0 ? byLetter : texts.indexOf(plain(String(t).replace(OPTION_HEAD, '')));
  };
  const keyAt = typeof q.answer === 'string' ? which(q.answer) : -1;
  if (keyAt < 0) return false;
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  return accept.some((a) => { const at = which(a); return at >= 0 && at !== keyAt; });
}
// Urdu Q4 ارکان: a key that splits a word one way («تواضع: تو + اضع») beside an accepted answer that
// splits it another («تَ وا ضُع») gives the teacher two answers, one of them wrong. Each word the key
// splits is compared with every accepted answer that spells the same word, by where the cuts fall.
// A key cuts its parts with «+», or, in an item that asks for ارکان, with a dash («کہا – نی» beside
// «کَ – ہا – نی»; «ب - گو - لا» beside «بگ - و - لا»).
const SYLLABLE_CUT = /[+\-–—ـ]/;
const SYLLABLE_ASK = /ارکان/;
const syllableCuts = (parts) => { let at = 0; return parts.slice(0, -1).map((p) => { at += p.length; return at; }).join(','); };
// One word to an entry: a line, or a part of one cut at «؛» or «،». A word's parts are cut at «+»
// (or a dash), or, with neither, at its spaces; a part's own letters are read without marks.
const syllableEntries = (text) => text.split(/[\n؛;،,]/).map((t) => t.split(/[:：]/).pop()).filter((t) => t.trim());
const syllableParts = (text) => (SYLLABLE_CUT.test(text) ? text.split(SYLLABLE_CUT) : text.split(/\s+/))
  .map((part) => plain(part).replace(/ /g, '')).filter(Boolean);
function syllableSplit(q) {
  if (typeof q.answer !== 'string') return false;
  const cut = (line) => line.includes('+') || (SYLLABLE_ASK.test(String(q.question || '')) && SYLLABLE_CUT.test(line));
  if (!cut(q.answer)) return false;
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  const [cuts, entries, partsOf] = [syllableCuts, syllableEntries, syllableParts];
  const accepted = accept.flatMap(entries).map(partsOf).filter((parts) => parts.length > 1);
  return entries(q.answer).some((line) => {
    if (!cut(line)) return false;
    const parts = partsOf(line);
    if (parts.length < 2) return false;
    return accepted.some((a) => a.join('') === parts.join('') && cuts(a) !== cuts(parts));
  });
}
// Urdu Q4 ارکان: a key that splits a word the book itself splits (`P.syllables`: «دامن» دا – من, «غلاظت»
// غ – لا – ظت) another way gives the teacher a wrong answer to mark from, whatever its accepted answer
// says. A word the book never splits is not read.
function bookSplit(q, P) {
  const book = (P && Array.isArray(P.syllables) ? P.syllables : []).map((b) => ({ word: plain(b.word).replace(/ /g, ''), cuts: syllableCuts(b.parts.map((x) => plain(x))) }));
  if (!book.length || typeof q.answer !== 'string' || !SYLLABLE_ASK.test(String(q.question || ''))) return false;
  return syllableEntries(q.answer).some((line) => {
    const parts = syllableParts(line);
    const own = parts.length > 1 && book.find((b) => b.word === parts.join(''));
    return Boolean(own) && own.cuts !== syllableCuts(parts);
  });
}
// Urdu Q4: the group word names what the listed words belong to («تھرمامیٹر، نبض، دوا، ڈاکٹر» →
// اسپتال). A stem whose list prints the key as the only one of its options in the list («… جس سے یہ
// سب الفاظ متعلق ہیں: سورج، کرنیں، دھوپ، روشنی» with options سورج، برف، سایہ، رات → سورج) is
// answered by matching, and is held. A stem whose list is its own four options (choose the group
// word among them: «بھیڑ، بکری، گائے، ریوڑ» → ریوڑ) is not: there every option is listed by design.
// The list is the stem's first line after its last colon, up to its first «۔» or «؟», cut at «،».
// Urdu Q4: four kinds, one item each, in FDE's order. An item's kind is read from its heading or stem;
// a second item of a kind never takes another kind's place.
const { Q4_KINDS, q4TaskKnown } = require('./fde-task-line'); // bd-5jmnfj.4.58.2
const { finallyNotLast } = require('./fde-order-check'); // bd-5jmnfj.4.58.2
const q4Kind = (q) => Q4_KINDS.findIndex(([re]) => re.test(`${q.main_question || ''} ${q.question || ''}`));
const sameQ4Kind = (a, b) => q4Kind(a) >= 0 && q4Kind(a) === q4Kind(b);
const GROUP_ASK = /گروہی/;
function groupWordListed(q) {
  const stem = String(q.question || '').split('\n')[0];
  if (!GROUP_ASK.test(stem) || !/[:：]/.test(stem)) return false;
  const key = plain(keyText(q));
  if (!key) return false;
  const listed = stem.slice(stem.search(/[:：][^:：]*$/) + 1).split(/[۔؟?]/)[0].split(/[،,]/).map(plain).filter(Boolean);
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter(Boolean);
  const inList = options.filter((o) => listed.includes(o));
  return listed.length > 1 && inList.length === 1 && inList[0] === key;
}
// Urdu: the page text's numeral dates are not reliable (a year loses a digit, «۱۹۱۳ء» reads
// «۱۹۳ ء»), so an item keyed on a year, a date or a day of the month is held: its key, or any entry
// of its scheme's accept list, carries digits with «ء», «سن» and a year, a four-digit year alone, or
// a month beside a number. The written pieces (picture, essay or dialogue, story, letter) are
// models, not keys: a letter is dated by its form, so they are not read.
const DATE_KEY_SLOTS = new Set(['urdu.A.Q1', 'urdu.B.Q2', 'urdu.C.Q3', 'urdu.C.Q4', 'urdu.C.Q5', 'urdu.C.Q6']);
// Month names are matched as `plain` writes them (one letter form, no hamza seat).
const DATE_MONTHS = `(?:${['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
  'محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'ربیع الآخر', 'جمادی الاول', 'جمادی الاولیٰ', 'جمادی الثانی', 'جمادی الآخر', 'رجب',
  'شعبان', 'رمضان', 'شوال', 'ذوالقعدہ', 'ذی قعدہ', 'ذوالحجہ', 'ذی الحجہ', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'].map(plain).join('|')})`;
const DATE_TEXT = [
  /(?:^| )\d{3,4} ?ء(?: |$)/,
  /(?:^| )سنہ? \d{3,4}(?: |$)/,
  /^[12]\d{3}$/,
  new RegExp(`(?:^| )\\d{1,2} ${DATE_MONTHS}(?: |$)`),
  new RegExp(`(?:^| )${DATE_MONTHS} \\d{1,4}(?: |$)`),
  /(?:^| )\d{1,2} تاریخ(?: |$)/,
];
function keyedOnDate(q) {
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  return [keyText(q), ...accept.map((a) => a.replace(OPTION_HEAD, ''))]
    .map(plain).some((t) => t && DATE_TEXT.some((re) => re.test(t)));
}
// Urdu Q1: an MCQ whose stem prints its own key gives itself away («لفظ «سانپ» کی درست املا کون سی
// ہے؟» → سانپ; «سَحَر» … درست اعراب والا لفظ → سَحَر), the key being one of its options: a quote that is the key as written, marks and
// all, or the key's words in order outside the stem's quotes. A quote that holds the key among other
// words («"اگر بارش ہوئی تو …" میں حرفِ شرط …؟» → اگر) is the example the item asks about, and stays;
// so does a stem that prints another option beside the key («عمارت» اور «اِمارت» میں سے …): the
// child still chooses. A stem that asks two questions («… پیش آیا؟ سدرہ کی بہن کا نام کیا تھا؟»)
// is two items in one place; a «؟» inside a quoted example does not count.
const QUOTE_SPAN = /«[^»]+»|[’‘]{2}[^’‘]+[’‘]{2}|“[^”]+”|"[^"]+"|[’‘][^’‘]+[’‘]|'[^']+'/gu;
// As written, marks kept (they are what an اعراب item tests), with only the Arabic letter forms of
// ی / ک / ہ read as Urdu («ہندي» is «ہندی»).
const SAME_LETTER = [[/[يى]/g, 'ی'], [/ك/g, 'ک'], [/ه/g, 'ہ']];
const asWritten = (t) => SAME_LETTER.reduce((x, [re, to]) => x.replace(re, to), String(t).normalize('NFC')).replace(OPTION_HEAD, '').replace(/^[\s«»’‘“”"'(]+|[\s«»’‘“”"').,،۔؟?!]+$/gu, '');
// A spelling item prints its key wherever its stem holds it, inside a longer quote too («جس چیز سے
// … یعنی گرم مصالحہ» کا درست املا → مصالحہ): the word it tests, as written, among the stem's words.
// Beside another option too («عمارت» اور «اِمارت» میں سے درست املا …): the right spelling is printed,
// and the other-option exemption below is for items that ask something else (a meaning). A key of
// function words only («میں») is the stem's own frame, and stays.
const SPELLING_ASK = /املا|ہجے/;
const wordsAsWritten = (t) => asWritten(t).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
function spellingPrints(stem, key) {
  const [s, k] = [wordsAsWritten(stem), wordsAsWritten(key)];
  return k.length > 0 && s.some((_, i) => k.every((w, j) => s[i + j] === w));
}
function printsOwnKey(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const key = asWritten(keyText(q));
  const options = q.options.map(asWritten);
  if (!plain(key) || !options.includes(key)) return false;
  const stem = String(q.question || '');
  if (SPELLING_ASK.test(stem) && tokensOf(key).length > 0 && spellingPrints(stem, key)) return true;
  const quotes = (stem.match(QUOTE_SPAN) || []).map(asWritten);
  const outside = stem.split(QUOTE_SPAN).map((part) => ` ${plain(part)} `);
  // Outside the quotes only a key with a content word counts: a function word («میں») is in most
  // stems' own frame («درج ذیل میں سے …»).
  const printed = (o) => quotes.includes(o) || (tokensOf(o).length > 0 && outside.some((part) => part.includes(` ${plain(o)} `)));
  const others = options.filter((o) => o !== key && plain(o));
  return printed(key) && !others.some(printed);
}
// The grammar labels a key carries before its term (اسم، حرف…، فعل، جملہ): a stem's own frame says
// them («… لفظ کو کیا کہتے ہیں؟»), so they are never the key's letters.
const TERM_CLASS = new Set(['اسم', 'حرف', 'فعل', 'لفظ', 'جملہ', 'الفاظ']);
const termClass = (w) => TERM_CLASS.has(w) || w.startsWith('حرف');
function asksTwo(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  return (String(q.question || '').replace(QUOTE_SPAN, ' ').match(/[؟?]/g) || []).length >= 2;
}
// Urdu Q1: an MCQ whose key's letters are printed in its own stem, and no other option's are, is
// answered by matching letters, whatever the shape: a homograph sense given as the key's own
// infinitive («… «جنگل» اور دوسرا «بننا»» → بن; «… «شاخ» اور … «ڈالنا»» → ڈالی), a quoted word the
// key is cut from («ان پڑھ» … → ان), a grammar term's own word («… «گاڑی» کی صفت بیان کرنے والے
// لفظ …» → اسم صفت). The key is one content word once its grammar label (اسم، حرف…، فعل، لفظ) is
// set aside, and has a letter; a key of more words is a meaning or a fact (a meaning that repeats
// the asked word is the book's own gloss). A true/false pair (درست / غلط) is the item's frame. A stem word carries the key when it is the key, or begins with the key's
// stem (its last ی / ا / ے / ہ off) and runs at most three letters on; a word of two letters is
// read that way only inside a quote («ان» begins half of all words). A spelling item quotes a gloss
// and is read by its own rule (a homograph item says «ایک ہی املا» and is no spelling item); a stem that prints another option too («سبز پتا» → پتا beside
// سبز) leaves the child a choice, and stays.
const INFLECTION = 3;
// The key as its option prints it: a reply keyed by letter alone («الف») names the option at that letter.
const keyOption = (q) => {
  const at = Array.isArray(q.options) ? keyAt(q) : -1;
  return at >= 0 && at < q.options.length ? String(q.options[at]).replace(OPTION_HEAD, '') : keyText(q);
};
const HOMOGRAPH = /متشابہ|ایک ہی املا|املا ایک/;
// A homograph pair is keyed as the word twice («ان اور ان»): one word.
const PAIR_WORDS = new Set(['اور', 'و']);
const keyWord = (text) => {
  const words = plain(text).split(' ').filter(Boolean);
  const content = [...new Set(words.filter((w) => !termClass(w) && !PAIR_WORDS.has(w)))];
  return content.length === 1 && [...content[0]].length >= 2 && /\p{L}/u.test(content[0]) ? content[0] : null;
};
// A sentence the item quotes as its example («"اگر بارش ہوئی تو …" میں حرفِ شرط …؟» → اگر) is what
// the item asks a part of, and is not read; a homograph item's quoted word is (its pair is cut from
// it: «ان پڑھ» → «ان اور ان»).
function carries(stem, word, homograph) {
  const root = [...word].length >= 3 ? word.replace(/[یاےہ]$/, '') : word;
  const quotes = (stem.match(QUOTE_SPAN) || []).map((x) => plain(x).split(' ').filter(Boolean));
  const quoted = new Set(quotes.filter((q) => q.length === 1 || homograph).flat());
  // A function word («میں», «ان») is in most stems' own frame: only a quote prints it.
  const outside = STOP.has(word) ? [] : plain(stem.replace(QUOTE_SPAN, ' ')).split(' ');
  const read = outside.concat([...quoted]).filter(Boolean);
  return read.some((w) => w === word || ((quoted.has(w) || [...root].length >= 3)
    && [...root].length >= 2 && w.startsWith(root) && [...w].length - [...root].length <= INFLECTION));
}
function lettersOfKey(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const stem = String(q.question || '');
  const homograph = HOMOGRAPH.test(plain(stem));
  if ((SPELLING_ASK.test(stem) && !homograph) || positionalPair(q.options.map(bare))) return false;
  const key = plain(keyOption(q));
  const word = keyWord(key);
  if (!word || !carries(stem, word, homograph)) return false;
  // Another option is another written form («سَحَر» beside «سِحر»): one that differs only by its
  // marks is printed wherever the key is.
  const written = asWritten(keyOption(q));
  const others = q.options.filter((o) => asWritten(o) !== written).map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter(Boolean);
  return !others.some((o) => o.split(' ').filter((w) => !termClass(w) && !PAIR_WORDS.has(w) && [...w].length >= 2).some((w) => carries(stem, w, homograph)));
}
// Urdu Q1: a stem, or a correct option, that names a person or thing of the same story as another
// item (« … باغ میں کیا کیا؟ → فاختائیں فضا میں اڑائیں»), where that name is the other item's key and
// none of its other options («سدرہ کی فاختہ آزاد کرنے کے بعد …» beside
// «سدرہ کی سالگرہ کی صبح … تکیے کے پاس کیا رکھا تھا؟ → کاغذ کی دو فاختائیں»), points the child to
// that key. The key is a short name or thing (four words at most; a longer key is a reason or an
// event, read by the reader). The name is an option's last word of three letters or more, singular
// or plural (فاختہ / فاختائیں), never a verb (… پھیلانا) or a word the item's own stem prints (the
// lesson's hero, «فاطمہ جناح», is in half the stems); the story is a word of three letters or more
// both stems share besides it, never the frame of a question («لفظ», «مطلب», «جملہ»). A stem that
// names two of the item's options («جنگل میں شیر کے شکار کا بچا ہوا حصہ …» beside «… کیا بننے کو
// کہا؟» among لومڑی / شیر) leaves the child a choice, and stays.
const NOUN_ENDINGS = /(?:اییں|ایں|یاں|وں|یں|ے|ہ|ی|ا)$/;
const nounFold = (w) => { const cut = w.replace(NOUN_ENDINGS, ''); return [...cut].length >= 3 ? cut : w; };
const NAME_KEY_WORDS = 4;
const NOT_NAMES = new Set(('لفظ الفاظ لفظوں جملہ جملے جملوں مطلب معنی مفہوم مراد کہانی سبق نظم شعر درست صحیح غلط قسم '
  + 'استعمال متضاد مترادف محاورہ محاورے حکایت کرنا کرنے کرنی ہونا ہونے جانا جانے آنا آنے دینا دینے لینا لینے لگنا بہت')
  .split(' ').flatMap((w) => [plain(w), nounFold(plain(w))]));
const verbal = (w) => /(?:نا|نے)$/.test(w) && [...w].length >= 4;
const namesOf = (text) => plain(text).split(' ').filter((w) => [...w].length >= 3 && !STOP.has(w) && !NOT_NAMES.has(w) && !verbal(w));
const headOf = (text) => { const words = namesOf(text); return words.length ? nounFold(words[words.length - 1]) : null; };
function namesKeyOf(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const key = plain(keyOption(q));
  if (!key || key.split(' ').length > NAME_KEY_WORDS) return false;
  const own = new Set(namesOf(q.question).map(nounFold));
  // What the other item prints as true: its stem, and its correct option when that option says
  // something (two words or more, not this item's own key: a bare «کراچی» among four cities tells
  // nothing). A wrong option is never read.
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  const said = `${by.question || ''} ${told.split(' ').length >= 2 && told !== key ? told : ''}`;
  const named = new Set(namesOf(said).map(nounFold).filter((w) => !own.has(w)));
  const heads = q.options.map((o) => headOf(String(o).replace(OPTION_HEAD, '')));
  const hit = heads.map((h, i) => (h && named.has(h) ? i : -1)).filter((i) => i >= 0);
  if (hit.length !== 1 || plain(String(q.options[hit[0]]).replace(OPTION_HEAD, '')) !== key) return false;
  const story = new Set(namesOf(by.question).map(nounFold).filter((w) => w !== heads[hit[0]]));
  return namesOf(q.question).some((w) => story.has(nounFold(w)));
}
const storyCue = (a, b) => namesKeyOf(a, b) || namesKeyOf(b, a);
// Urdu Q1: an item that asks a name or a place (a person, a city, a country: «سدرہ کی بہن کا نام کیا
// تھا؟», «… جاپان کے کس شہر پر …؟»), keyed on one word that only its key option carries, is given away
// by another Q1 item's stem or correct option that prints that word («سالگرہ کی صبح امینہ گلی میں …» →
// امینہ; «ہیروشیما پر نظر آنے والے …» → ہیروشیما), with no other word shared. A wrong option that names it
// tells nothing (one name among four). An item that asks about a word (its meaning, its opposite, its
// kind: «امن» کا متضاد → جنگ) asks no name, whatever stem prints its key.
const NAME_ASK = /(?:^| )(?:نام|شہر|ملک|کہاں|جگہ|مقام)(?: |$)|(?:^| )کس نے(?: |$)|(?:^| )کون (?:تھا|تھی|تھے|ہے|ہیں)(?: |$)/;
const WORD_ASK = /لفظ|الفاظ|متضاد|مترادف|ہم معنی|مطلب|معنی|مفہوم|جملہ|جملے|(?:^| )اسم(?: |$)|(?:^| )حرف|املا/;
function namePrinted(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const stem = plain(q.question);
  if (!NAME_ASK.test(stem) || WORD_ASK.test(stem)) return false;
  const key = plain(keyOption(q));
  if (!key || key.includes(' ') || [...key].length < 3 || STOP.has(key) || termClass(key)) return false;
  const holds = (text) => ` ${plain(text)} `.includes(` ${key} `);
  if (q.options.filter((o) => holds(String(o).replace(OPTION_HEAD, ''))).length !== 1) return false;
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  return holds(by.question) || (told !== key && told.includes(' ') && holds(told));
}
const nameCue = (a, b) => namePrinted(a, b) || namePrinted(b, a);
// Urdu Q1: a key of several words that carries a name («ایدھی فاؤنڈیشن میں … لوگوں کی مدد کرنا»;
// «قائدِ اعظم کے مزار کے احاطے میں») which no other option carries and the item's own stem does not
// print, given away by another item's stem or correct option that prints that name as a person
// («ایدھی صاحب نے …», «قائدِ اعظم نے …», «محترمہ فاطمہ جناح …»). A word is read as a name only where the
// other text marks it so (followed by «صاحب / صاحبہ / نے», or after «محترم / محترمہ / جناب»): a
// common word a key shares with another stem («بچے») is not one, nor is a word inside an example the
// other stem quotes («جملے «بچے نے ٹھنڈا پانی پیا» میں …»). An item that asks about a word asks no name.
// The item whose key is given away is the one held, never the stems that name it (the lesson's hero
// may be named in many).
const NAME_AFTER = new Set(['صاحب', 'صاحبہ', 'نے']);
const NAME_BEFORE = new Set(['محترم', 'محترمہ', 'جناب']);
const NOT_PERSONS = new Set('انھوں انہوں انھیں انہیں ہم تم آپ میں اس ان جس جن کسی سب لوگوں بچوں بچے بچہ لڑکا لڑکی لڑکے آدمی لوگ'.split(' ').map(plain));
function personsIn(text) {
  const w = plain(text).split(' ');
  return new Set(w.filter((x, i) => [...x].length >= 3 && !STOP.has(x) && !NOT_PERSONS.has(x) && !NAME_AFTER.has(x)
    && !NAME_BEFORE.has(x) && (NAME_AFTER.has(w[i + 1]) || NAME_BEFORE.has(w[i - 1]))));
}
function nameInKey(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2 || WORD_ASK.test(plain(q.question))) return false;
  const key = plain(keyOption(q));
  const words = key.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const own = new Set(plain(q.question).split(' '));
  const others = q.options.map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter((o) => o !== key);
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  const persons = personsIn(`${String(by.question || '').replace(QUOTE_SPAN, ' ')} ${told !== key ? told : ''}`);
  return words.some((w) => persons.has(w) && !own.has(w) && !others.some((o) => ` ${o} `.includes(` ${w} `)));
}
// Urdu Section C against Q1: an item that asks a name or a place, keyed on one word only its key
// option carries, whose word a Section C word list prints (Q3's or Q5's words, Q4's ارکان words:
// «ارادہ، کراچی» beside «… کس شہر میں پیدا ہوئیں؟ → کراچی»).
function nameListed(lists) {
  const said = ` ${plain(lists.map((q) => [].concat(Array.isArray(q.words) ? q.words : [], q.slot === 'urdu.C.Q4' ? [q.question] : [])
    .filter((w) => typeof w === 'string').join(' ')).join(' '))} `;
  if (!said.trim()) return null;
  return (q) => {
    if (!Array.isArray(q.options) || q.options.length < 2) return false;
    const stem = plain(q.question);
    if (!NAME_ASK.test(stem) || WORD_ASK.test(stem)) return false;
    const key = plain(keyOption(q));
    if (!key || key.includes(' ') || [...key].length < 3 || STOP.has(key) || termClass(key)) return false;
    if (q.options.filter((o) => ` ${plain(String(o).replace(OPTION_HEAD, ''))} `.includes(` ${key} `)).length !== 1) return false;
    return said.includes(` ${key} `);
  };
}
// Urdu Q1: a رموزِ اوقاف item keyed on a mark its own stem ends with («… سوال پوچھنے پر کون سی علامت
// لگائی جاتی ہے؟» → ؟). The item asks the mark of a sentence printed without it.
const MARK_FOLD = { '?': '؟', '.': '۔', ',': '،', ';': '؛' };
const asMark = (t) => [...String(t || '').replace(/\s+/g, '')].map((c) => MARK_FOLD[c] || c).join('');
function markEndsStem(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const key = asMark(keyOption(q));
  return Boolean(key) && !/[\p{L}\p{N}]/u.test(key) && asMark(q.question).endsWith(key);
}
// Urdu Q1: two options that are one word («مَن» and «من۔»: the same letters once its marks and
// punctuation are set aside, one of them written without marks), the key one of them, are two right
// answers; two wrong options alike leave one right answer («عرض» / «عَرَض» beside «ارض»). Two words
// that differ only by their marks, each written with them («مَن» / «مِن», «سَحَر» / «سِحر»), are two words.
const MARKED = new RegExp(UR_MARKS.source);
function twoRightOptions(q) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const read = q.options.map((o) => {
    // Letters as written: a spelling item's options differ by one letter (ذائقہ / ذایقہ), never folded.
    const t = String(o).replace(OPTION_HEAD, '').normalize('NFC');
    const bare = t.replace(new RegExp(UR_MARKS.source, 'g'), '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
    return { bare, marks: MARKED.test(t) ? t.replace(/[^\u064B-\u065F\u0670]/g, '') : '' };
  });
  const at = keyAt(q);
  const k = read[at];
  return Boolean(k && k.bare) && read.some((b, j) => j !== at && b.bare === k.bare && !(k.marks && b.marks && k.marks !== b.marks));
}
// Urdu Q1: one grammar concept once on the paper. An item asks a concept when its key is the term
// (… کیا کہلاتا ہے؟ → اسم معرفہ), when its stem names the term outside a quoted example (… میں
// اسم معرفہ کون سا ہے؟), or when its stem or key says what the term is («… خاص نام کے بجائے … عام
// چیز …» → اسکول; «… ایک ہی املا …»). The named noun and the common noun are one rule (خاص / عام).
// A word meaning or a story fact asks no grammar concept. The متشابہ pair is one concept however the
// stem asks it: one spelling with two meanings, two words that sound alike but are spelt apart
// («آواز میں ایک جیسے مگر املا میں مختلف»), a word's «دوسرا معنی», «X بمعنی … اور Y بمعنی …». An
// item that asks which word tells a thing's quality («… کون سا لفظ خوبی بیان کر رہا ہے؟») asks صفت, and
// one that asks the word whose quality is told («جس چیز کی خوبی …») asks موصوف. An antonym or a synonym
// item («"X" کا متضاد / مترادف / الٹ کون سا لفظ ہے؟») is a concept on every scope: on chosen lessons
// that do not teach it (lessons 4–5 do), it is grammar from another lesson.
// Each row is written as the book writes it and folded as plain() folds the text it reads (آ as ا,
// ئ as ی, …), so no row can be dead for a letter form.
const foldPattern = (re) => new RegExp(UR_FORMS.reduce((src, [f, to]) => src.replace(new RegExp(f.source, 'g'), to), re.source.replace(UR_MARKS, '')), re.flags);
const CONCEPTS = [
  ['naming', /(?:^| )(?:اسم )?(?:معرفہ|نکرہ)(?: |$)|اسم (?:خاص|عام)|خاص (?:شخص|نام)|مخصوص نام|عام (?:چیز|نام)/],
  ['sound', /اسم صوت|آواز (?:کو )?ظاہر/],
  ['tool', /اسم آلہ|ہتھیار یا اوزار|اوزار کا نام/],
  ['place', /اسم ظرف/],
  ['adjective', /اسم صفت|(?:^| )صفت(?: |$)|خوبی بیان (?:کر|کرتا|کرتی|کرتے)(?: |$)/],
  ['qualified', /موصوف|جس چیز کی خوبی/],
  ['conjunction', /حرف عطف|(?:^| )عطف(?: |$)|جوڑت[ےا]|جوڑنے/],
  ['condition', /حرف (?:شرط|جزا)|شرط و جزا/],
  ['doubt', /شکیہ|شک (?:و شبہ|ظاہر|کا اظہار)/],
  ['wish', /تمنائی|آرزو (?:کا اظہار|ظاہر)/],
  ['homograph', new RegExp(`${HOMOGRAPH.source}|آواز میں ایک (?:جیسے|جیسا)|دوسرا معنی|بمعنی .+ اور (?:.+ )?بمعنی`)],
  ['antonym', /متضاد|مخالف معنی|الٹ(?:ا|ے)? (?:معنی|مطلب)|کا الٹ(?: |$)/],
  ['synonym', /مترادف|ہم معنی/],
].map(([name, re]) => [name, foldPattern(re)]);
const LESSON_ONLY = new Set(['antonym', 'synonym']);
// The holds a grammar concept may make (a repeat, or a tag the stem contradicts).
const GRAMMAR_REPEAT = new Set(['concept_repeat', 'concept_tag_disagrees']);
// `lessons` is read by no row today: a concept is the same on every scope.
// eslint-disable-next-line no-unused-vars
function conceptOf(q, lessons = null) {
  if (!Array.isArray(q.options) || !q.options.length) return null;
  const read = [plain(keyOption(q)), plain(String(q.question || '').replace(QUOTE_SPAN, ' '))];
  const found = CONCEPTS.find(([, re]) => read.some((t) => re.test(t)));
  return found ? found[0] : null;
}
// Urdu Q1 on chosen lessons: the concept Section A says an item asks (its `concept`, never printed),
// read as a CONCEPTS name or a lesson's grammar name; `grammar: false` for vocabulary, a word
// meaning, comprehension, or a name the table does not hold.
function declaredConcept(tag, P) {
  const t = plain(String(tag || ''));
  if (!t) return null;
  // A lesson entry that names two concepts («تمنائی اور شکیہ جملے», «صفت و موصوف»): the tag says the
  // item asks one of them, and the stem says which.
  const pair = (P.lessons || []).flatMap((l) => l.grammar).find((x) => (x.tags || []).length > 1 && t.includes(plain(x.ur)));
  if (pair) return { name: plain(pair.ur), grammar: true, pair: true };
  const row = CONCEPTS.find(([, re]) => re.test(t));
  if (row) return { name: row[0], grammar: true };
  const g = (P.lessons || []).flatMap((l) => l.grammar)
    .find((x) => { const u = plain(x.ur); return t.includes(u) || (u.startsWith(t) && [...t].length >= 4); });
  return g ? { name: plain(g.ur), grammar: true } : { name: null, grammar: false };
}
// The lesson grammar entry a concept name belongs to (a tag, or the entry's own name).
const entryOf = (lessons, name) => lessons.flatMap((l) => l.grammar).find((g) => (g.tags || []).includes(name) || plain(g.ur) === name) || null;
// Why a declared concept cannot print on these lessons: a concept they do not teach (or Q4's), or one
// the stem itself contradicts. Null when it may.
function declaredMiss(q, d, lessons) {
  if (!d) return null;
  const own = entryOf(lessons, d.name);
  if (d.grammar && (!own || own.q4)) return 'concept_tag_outside';
  const c = conceptOf(q, lessons);
  if (c && (!d.grammar || entryOf(lessons, c) !== own)) return 'concept_tag_disagrees';
  return null;
}
// The lessons a chapter or pages paper covers (P.lessons, by number or by any page they share), or
// null: the full syllabus, a subject without a lesson table, or a scope that names none of them.
function scopeLessons(P, scope) {
  if (!P || !Array.isArray(P.lessons) || !scope || (scope.kind !== 'chapters' && scope.kind !== 'pages')) return null;
  const ranges = (text) => String(text || '').split(',').map((part) => part.split('-').map((n) => Number(n.trim())))
    .filter(([a]) => Number.isFinite(a)).map(([a, b]) => [a, Number.isFinite(b) ? b : a]);
  const chapters = scope.kind === 'chapters' && Array.isArray(scope.chapters) ? scope.chapters.map(Number) : [];
  const pages = ranges(scope.pages);
  const chosen = chapters.length
    ? P.lessons.filter((l) => chapters.includes(l.lesson))
    : P.lessons.filter((l) => ranges(l.pages).some(([a, b]) => pages.some(([c, d]) => a <= d && c <= b)));
  return chosen.length ? chosen : null;
}
// Urdu Q1 on lessons that hold one prose story (lessons 6–7: a story and a poem; any single lesson; pages
// inside one lesson): twenty items drawn from one story name each other's people and things, so at most
// eight ask a fact of the story and the rest come from the lessons' word lists, meanings, idioms and
// poem. Section A says where each item comes from (its `source`, never printed).
const STORY_ITEMS = 8;
const oneStory = (lessons) => Boolean(lessons) && lessons.filter((l) => !l.poem).length <= 1;
// A story item by its stem alone, as a short hash (no text): a paper laid out again from a laid one has
// lost its tags, and `_layout.story_ids` tells the layout which of its printed items ask the story.
const storyId = (q) => {
  let h = 0x811c9dc5;
  for (const c of plain(q.question)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
// Urdu Q1 on chosen lessons: the grammar concept an item asks, when it is not one those lessons teach.
function outsideLessons(q, lessons) {
  const concept = lessons && conceptOf(q, lessons);
  if (!concept) return null;
  return lessons.some((l) => l.grammar.some((g) => (g.tags || []).includes(concept))) ? null : concept;
}
function sameQuestion(a, b) {
  const [sa, sb] = [plain(a.question), plain(b.question)];
  if (!sa || !sb) return false;
  const opts = (q) => (Array.isArray(q.options) ? q.options.map((o) => plain(String(o).replace(OPTION_HEAD, ''))).sort().join('|') : '');
  if (opts(a) !== opts(b)) return false;
  if (sa === sb) return true;
  if (!opts(a)) { const k = writtenKey(a.question); return Boolean(k) && k === writtenKey(b.question); }
  if (!opts(a) || plain(keyText(a)) !== plain(keyText(b))) return false;
  const [A, B] = [new Set(sa.split(' ')), new Set(sb.split(' '))];
  const differ = [...A].filter((w) => !B.has(w)).concat([...B].filter((w) => !A.has(w)));
  return differ.every((w) => FRAME_WORDS.has(w));
}

/**
 * takenNote(P, section, examJson) → string | null
 *
 * What the engine's one re-ask of `section` is told, from the first layout (`examJson`): the
 * facts the slot its items are held against already tests. Social Studies C/D: Section A's
 * questions and answers (and D: the Q5 items, and its own items `opts.held` names, from
 * applyLayout's `held`). English A: Q4's words. Urdu A: Q4's questions and answers, Q3/Q5's
 * words and Q6's verse, and on a top-up the Q1 items it keeps with their keys. Null for any
 * other section or subject, so no
 * other prompt changes.
 */
function takenNote(P, section, examJson, opts = {}) {
  const cross = P && CROSS_HOLD[P.key];
  if (!cross || !section || !Array.isArray(section.slots)) return null;
  if (!section.slots.some((s) => cross.held.includes(s.slot))) {
    // Social Studies: a top-up of a section with no held slot (A's Q1) is told what each short slot keeps.
    // Urdu: a Section C top-up for a Q5 held for a Q3 word is told Q3's words.
    if (P.key === 'urdu' && opts.topUp) return [q3Note(section, examJson, opts.shortfall), q4Note(section, examJson, opts.shortfall)].filter(Boolean).join('\n\n') || null;
    if (P.key !== 'social_studies' || !opts.topUp) return null;
    const kept = keptNotes(P, section, examJson, cross, opts.shortfall);
    const back = backNote(section, examJson, opts.held);
    const notes = back ? [back, ...kept] : kept;
    return notes.length ? notes.join('\n\n') : null;
  }
  const against = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) against.push(...list.filter((q) => q && [].concat(cross.against).includes(q.slot)));
      }
    }
  }
  if (P.key === 'english') {
    const words = against.flatMap((q) => (Array.isArray(q.words) ? q.words : [])).filter((w) => typeof w === 'string' && w.trim());
    if (!words.length) return null;
    return `Q4 of this paper asks the child to use these words in sentences: ${words.map((w) => w.trim()).join(', ')}. `
      + 'No item you write in this section may use any of these words, in its stem or in its options.';
  }
  if (P.key === 'urdu') {
    // A Q4 stem can carry its options on the lines below it; the first line is the question. The
    // answers Q4 also accepts are named too: an MCQ keyed on one of them is held as well.
    const also = (q) => [...new Set(acceptOf(q).map((a) => a.trim()).filter((a) => a && plain(a) !== plain(keyText(q))))];
    const asked = against.filter((q) => q.slot === 'urdu.C.Q4' && typeof q.question === 'string' && q.question.trim() && keyText(q).trim())
      .map((q) => `- ${q.question.trim().split('\n')[0].trim()} → ${keyText(q).trim().replace(/\s*\n\s*/g, '; ')}`
        + (also(q).length ? ` (also accepted: ${also(q).join('; ')})` : ''));
    const notes = asked.length ? [`Q4 of this paper already asks these (question → answer):\n${asked.join('\n')}\n`
      + 'No MCQ you write in this section may be keyed on any of these answers or ask any of these again.'] : [];
    // Q3 and Q5's words, and Q6's verse, are printed in Section C: an MCQ on them gives C away.
    const words = [...new Set(against.filter((q) => q.slot === 'urdu.C.Q3' || q.slot === 'urdu.C.Q5')
      .flatMap((q) => (Array.isArray(q.words) ? q.words : [])).filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()))];
    if (words.length) {
      notes.push(`Q3 and Q5 of this paper ask the meaning of, or a sentence with, these words: ${words.join('، ')}\n`
        + 'No MCQ you write in this section may ask the meaning of any of these words, or be keyed on their meaning.');
    }
    const verses = against.filter((q) => q.slot === 'urdu.C.Q6').flatMap((q) => verseLines(q.passage).lines);
    if (verses.length) {
      notes.push(`Q6 of this paper prints these verses:\n${verses.join('\n')}\n`
        + 'No MCQ you write in this section may ask about these verses or be answered from them.');
    }
    // A top-up keeps the first reply's Q1 items: name them and their keys, or the re-ask writes a
    // whole Section A again and its first items ask kept facts under new stems, keyed the same.
    // Its count is the section's own, so a held twin's place goes to the next new item.
    if (opts.topUp) notes.push(...urduKeptNotes(section, examJson, opts.shortfall));
    const story = opts.topUp && storyNote(section, examJson, opts.shortfall);
    if (story) notes.push(story);
    return notes.length ? notes.join('\n\n') : null;
  }
  const facts = against.filter((q) => typeof q.question === 'string' && q.question.trim())
    .map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`);
  const notes = facts.length ? [`Section A of this paper already asks these questions (question → answer):\n${facts.join('\n')}\n`
    + 'Never ask any of these facts again, in any wording: every question you write here must test something Section A does not.'] : [];
  // Section D's re-ask is told the Q5 items on the paper now, with their points (its first ask was
  // told C's first reply, firstAskNote).
  if (section.slots.some((s) => s.slot.startsWith('social_studies.D.'))) {
    const note = q5Note(itemsOf(examJson, Q5_SLOT));
    if (note) notes.push(note);
    // And the items of its own the layout set aside, with what they answer: a re-ask told only what
    // was kept writes the same restatement again.
    const aside = heldNote(section, opts.held);
    if (aside) notes.push(aside);
    const recall = recallNote(section, opts.held);
    if (recall) notes.push(recall);
    const ownKey = (Array.isArray(opts.held) ? opts.held : []).filter((h) => h && h.slot === Q7_SLOT && h.rule === 'key_in_own_stem' && h.q && typeof h.q.question === 'string');
    if (ownKey.length) {
      notes.push(`These Q7 items were set aside: each prints its own answer in its question:\n${ownKey.map(({ q }) => `- ${q.question.trim()} → ${keyText(q).trim()}`).join('\n')}\n`
        + 'A Q7 asks one fact its question does not say.');
    }
    // A D stem that prints a Q1 answer gives that Q1 item away (Section A is then asked again).
    const keys = [...new Set(against.map((q) => keyText(q).trim()).filter(Boolean))];
    if (keys.length) notes.push(`Never print any of these Section A answers in a stem you write (as a name, a date, a number or a term): ${keys.join('، ')}`);
  }
  // A top-up keeps the first reply's items: name what each short held slot keeps, and ask for spares,
  // since the refill is held against Section A as well.
  if (opts.topUp) notes.push(...keptNotes(P, section, examJson, cross, opts.shortfall));
  return notes.length ? notes.join('\n\n') : null;
}
// Social Studies: Section A's top-up, when Q1 items were held because a C/D stem gives them away
// (givenBack), is told every C/D question and those items: a re-ask told nothing keys the same name again.
const SELF_RULES = new Set(['key_in_own_stem', 'names_q1_key']);
function backNote(section, examJson, held) {
  if (!section.slots.some((s) => s.slot === SST_A_Q1)) return null;
  const ofA = (rules) => (Array.isArray(held) ? held : []).filter((h) => h && h.slot === SST_A_Q1 && rules.has(h.rule) && h.q && typeof h.q.question === 'string');
  const line = ({ q }) => `- ${q.question.trim()} → ${keyText(q).trim()}`;
  const set = ofA(BACK_RULES);
  const self = ofA(SELF_RULES);
  const notes = [];
  if (set.length) {
    const asked = ['social_studies.C.Q5', Q6_SLOT, 'social_studies.D.Q7'].flatMap((id) => itemsOf(examJson, id)).map((q) => `- ${q.question.trim()}`);
    notes.push(`${asked.length ? `Sections C and D of this paper ask these questions:\n${asked.join('\n')}\n` : ''}`
      + `These Q1 items were set aside, because one of those questions prints their answer or asks the same thing:\n${set.map(line).join('\n')}\n`
      + 'No Q1 item may be keyed on a name, term, year or number those questions print, or ask what any of them asks.');
  }
  if (self.length) {
    notes.push(`These Q1 items were set aside, because a Q1 question names their answer:\n${self.map(line).join('\n')}\n`
      + 'A Q1 question never names its own answer, nor the answer of another Q1 item.');
  }
  return notes.length ? notes.join('\n\n') : null;
}
// Social Studies: the held items of a section's slots (`held` from applyLayout), never these.
function heldNote(section, held) {
  const own = new Set(section.slots.map((s) => s.slot));
  const lines = (Array.isArray(held) ? held : []).filter((h) => h && !RECALL_RULES.has(h.rule) && h.rule !== 'key_in_own_stem' && own.has(h.slot) && h.q && typeof h.q.question === 'string' && h.q.question.trim())
    .map(({ q }) => {
      const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
        .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
      const key = keyText(q).trim();
      return `- ${q.question.trim()}${key ? ` → ${key}` : ''}${points.length ? `\n  points: ${points.join('; ')}` : ''}`;
    });
  if (!lines.length) return null;
  return `These items were set aside, because a child answering this paper's other items would already have answered them:\n${lines.join('\n')}\n`
    + 'Never these: write none of them again, and no item answered by any of these answers or points, in any wording.';
}
// Social Studies: the Q6 items set aside as book-fact recall (asksRecall, namesBody), and what a Q6 is instead.
const RECALL_RULES = new Set(['recall', 'names_body', 'asks_frame', 'tells_what', 'book_list']);
function recallNote(section, held) {
  if (!section.slots.some((s) => s.slot === Q6_SLOT)) return null;
  const list = (Array.isArray(held) ? held : []).filter((h) => h && RECALL_RULES.has(h.rule) && h.slot === Q6_SLOT && h.q && typeof h.q.question === 'string');
  const lines = list.map(({ q }) => `- ${q.question.trim()}`);
  if (!lines.length) return null;
  const why = (list.some((h) => h.rule === 'names_body') ? ', or only names a government, court or body as its answer' : '')
    + (list.some((h) => h.rule === 'asks_frame') ? ', or only relays what someone asks («… نے پوچھا کہ …», «… جاننا چاہتا ہے کہ …») so its answer is the book\'s text' : '')
    + (list.some((h) => h.rule === 'tells_what') ? ', or only asks to tell someone what a place or a system is like («… کو بتائیں کہ … کیسا …») so its answer is the book\'s description' : '')
    + (list.some((h) => h.rule === 'book_list') ? ', or is answered by a list the book gives, its points the book\'s own sentences in order' : '');
  return `These Q6 items were set aside: each asks only book facts (who heads or chairs a body, what it is called, how many, when, what was done)${why}, whatever the story around them:\n${lines.join('\n')}\n`
    + 'A Q6 is a situation that needs two ideas applied; history recall goes to Q7. Write each new Q6 so the child decides, advises or explains what to do in the case, using two different ideas from these pages.';
}
// Social Studies: Section D is told every Q5 item with its marking points. A Q6 written beside C
// from the same pages set C's own cases again (a purse found on the road in Q5, a wallet in Q6),
// and a child who answers one has answered the other.
const Q5_SLOT = 'social_studies.C.Q5';
function q5Note(list) {
  const lines = list.filter((q) => q && typeof q.question === 'string' && q.question.trim()).map((q) => {
    const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
      .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
    return `- ${q.question.trim()}${points.length ? `\n  points: ${points.join('; ')}` : ''}`;
  });
  if (!lines.length) return null;
  const topics = [...new Set(list.map((q) => q && topicOf(q.question)).filter(Boolean))];
  return `Q5 of this paper asks these questions (under each, the points a full answer gives):\n${lines.join('\n')}\n`
    + 'A child who answers these has already answered them. No Q6 or Q7 item you write may ask anything a child answering these '
    + 'would already have answered, in any wording or with another person, place or object: set every item on a different case.'
    + (topics.length ? `\nQ5 topics: ${topics.join('; ')}.\nEvery Q6 situation must need a DIFFERENT topic from every Q5 topic above, `
      + 'not only different words, people or places: a story about one of these topics restates a Q5 item.' : '');
}
// What a Q5 item is about, as a noun phrase: its first sentence up to the question word or the
// instruction («ماس میڈیا اور سوشل میڈیا میں کیا فرق ہے؟» → «ماس میڈیا اور سوشل میڈیا»), case
// markers, pronouns and «فرق» / «نام» off its tail. Eight words at most; none when nothing is left.
const TOPIC_ENDS = new Set(['کیا', 'کیوں', 'کون', 'کونسا', 'کونسی', 'کس', 'کسے', 'کب', 'کہاں', 'کیسے', 'کتنا', 'کتنی', 'کتنے', 'کن',
  'لکھیں', 'بیان', 'وضاحت', 'واضح', 'بتائیں', 'دیں', 'کریں', 'what', 'why', 'how', 'which', 'who', 'when', 'where', 'explain', 'write', 'name', 'give']);
const TOPIC_TAIL = new Set(['میں', 'کے', 'کی', 'کا', 'کو', 'سے', 'لیے', 'ہمیں', 'ہم', 'آپ', 'اور', 'پر', 'نے', 'فرق', 'نام', 'in', 'of', 'the', 'a', 'and', 'for', 'to', 'is', 'are']);
function topicOf(stem) {
  const first = String(stem == null ? '' : stem).split(/[؟?۔.!]/)[0];
  const words = [];
  for (const w of first.trim().split(/\s+/)) {
    if (!w || TOPIC_ENDS.has(plain(w))) break;
    words.push(w.replace(/[،,:؛;]+$/, ''));
  }
  words.splice(8);
  while (words.length && TOPIC_TAIL.has(plain(words[words.length - 1]))) words.pop();
  const out = words.join(' ').trim();
  return out || null;
}

/**
 * firstAskNote(P, tree) → string | null
 *
 * What Social Studies Section D's FIRST ask is told, from Section C's first reply (`tree`, as the
 * model wrote it): every Q5 item C wrote, spares included, with its marking points. Null for any
 * other subject, or when C wrote no Q5 item.
 */
function firstAskNote(P, tree) {
  if (!P || P.key !== 'social_studies' || !Array.isArray(P.sections)) return null;
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  // Placed as the layout places it: by its tag, or a mis-tag by its tail.
  const slotOf = (tag) => {
    if (!tag) return null;
    const slot = byId.get(slotKey(tag));
    if (slot) return slot;
    const tail = `.${slotKey(tag).split('.').slice(-2).join('.')}`;
    return slots.find((s) => slotKey(s.slot).endsWith(tail)) || null;
  };
  const five = walk(tree).map((e) => e.q).filter((q) => (slotOf(q.slot) || {}).slot === Q5_SLOT);
  return q5Note(five);
}

// Spare items asked of a short held slot on a top-up, beyond the ones it is missing.
const SPARE_ITEMS = 4;
// The laid-out items of one slot, with a question line.
function itemsOf(examJson, slotId) {
  const out = [];
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) out.push(...list.filter((q) => q && q.slot === slotId && typeof q.question === 'string' && q.question.trim()));
    }
  }
  return out;
}
// Every short slot of the section, held or not: a slot that is not held against Section A (A's Q1,
// D's Q6) is only told to write nothing it keeps.
function keptNotes(P, section, examJson, cross, shortfall) {
  const out = [];
  for (const slot of section.slots) {
    const gap = (Array.isArray(shortfall) ? shortfall : []).find((f) => f && f.slot === slot.slot);
    if (!gap || !(gap.missing > 0)) continue;
    const label = slot.label_en || slot.slot.split('.').pop();
    const lines = itemsOf(examJson, slot.slot).map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`);
    // A slot the reply left empty is named where the reply carries it: «Q4 needs 1 more» alone came
    // back with no "Mind Map" twice. A one-item composition is asked for once, never with spares.
    if (!lines.length && slot.generate === 1) {
      out.push(`Your reply had no ${label} at all. Write exactly one ${label} item, under "unseen" → "${slot.category}" → "${slot.type}", `
        + `with "slot": "${slot.slot}"; keep every other item of this section as it was.`);
      continue;
    }
    const tests = cross.held.includes(slot.slot) ? `neither Section A nor ${label}'s kept items test` : `${label}'s kept items do not test`;
    out.push(`${lines.length ? `${label} already keeps these items (question → answer):\n${lines.join('\n')}\nNever write any of these again, in any wording. ` : ''}`
      + `${label} needs ${gap.missing} more: write ${gap.missing + SPARE_ITEMS} new ${label} items, each testing a fact that ${tests}; the paper takes the first ${gap.missing} that are new.`);
  }
  return out;
}
// Urdu Section A on a top-up: each short held slot's kept items and their keys. The re-ask writes
// the section's full count (no spare count asked), so the paper has a new item for every twin it holds.
// A top-up asks for spares beyond what it needs, at least two and half the gap rounded up (a top-up
// for seven wrote three twins of kept facts): an item the layout holds inside the re-ask then takes a
// spare's place.
const urduSpares = (missing) => Math.max(2, Math.ceil(missing / 2));
function urduKeptNotes(section, examJson, shortfall) {
  const out = [];
  for (const slot of section.slots) {
    const gap = (Array.isArray(shortfall) ? shortfall : []).find((f) => f && f.slot === slot.slot);
    if (!gap || !(gap.missing > 0)) continue;
    const label = slot.label_en || slot.slot.split('.').pop();
    const kept = itemsOf(examJson, slot.slot).filter((q) => keyText(q).trim());
    if (!kept.length) continue;
    const keys = [...new Set(kept.map((q) => keyText(q).trim().replace(/\s*\n\s*/g, '; ')))];
    out.push(`${label} already keeps these items (question → answer):\n${kept.map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`).join('\n')}\n`
      + `Never write any of these again, in any wording, and never key a new item on any of these answers: ${keys.join('، ')}\n`
      + `${label} needs ${gap.missing} more. Write ${gap.missing + urduSpares(gap.missing)} new items: the paper takes the first ${gap.missing} of your items that test a fact none of these tests.`);
  }
  return out;
}

// Urdu Section C top-up with Q5 short: the words Q3 keeps, so the new Q5 asks none of them.
function q3Note(section, examJson, shortfall) {
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.C.Q5' && f.missing > 0);
  if (!short || !section.slots.some((s) => s.slot === 'urdu.C.Q5')) return null;
  const words = [];
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) list.filter((q) => q && q.slot === 'urdu.C.Q3' && Array.isArray(q.words)).forEach((q) => words.push(...q.words.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim())));
    }
  }
  return words.length ? `Q3 of this paper asks the meaning of these words: ${words.join('، ')}\nQ5's words and idioms never include any of them: each word on the paper is asked in one place.` : null;
}

// Urdu Section C top-up for a short Q4: the kinds it is missing, and the kinds it already has.
function q4Note(section, examJson, shortfall) {
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.C.Q4' && f.missing > 0);
  if (!short || !section.slots.some((s) => s.slot === 'urdu.C.Q4')) return null;
  const have = new Set(itemsOf(examJson, 'urdu.C.Q4').map(q4Kind).filter((k) => k >= 0));
  const missing = Q4_KINDS.filter((_, k) => !have.has(k)).map(([, label]) => label);
  if (!missing.length) return null;
  const kept = Q4_KINDS.filter((_, k) => have.has(k)).map(([, label]) => label);
  return `Q4 needs one item of each kind it is missing: ${missing.join('، ')}. Write only that kind, under its own heading.`
    + (kept.length ? `\nQ4 already has (never write these again): ${kept.join('، ')}.` : '');
}

// Urdu on one story: how many more Q1 items may ask a fact of the story, from the count the layout
// recorded (`_layout.story_items`), when Q1 is short.
function storyNote(section, examJson, shortfall) {
  const n = examJson && examJson._layout && examJson._layout.story_items;
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.A.Q1' && f.missing > 0);
  if (!Number.isInteger(n) || !short || !section.slots.some((s) => s.slot === 'urdu.A.Q1')) return null;
  const rest = 'from the lessons\' word lists, word meanings, idioms or the poem, and give it its "source"';
  return n >= STORY_ITEMS
    ? `Story items are used up: Q1 already asks ${n} facts of the story. Write every new Q1 item ${rest}.`
    : `Q1 keeps ${n} story items: at most ${STORY_ITEMS - n} new Q1 items may ask a fact of the story; write the others ${rest}.`;
}

/**
 * applyLayout(examJson, P, scope, { now }) → { examJson, placed, unplaced, shortfall }
 *
 * P is one subject of a pattern (patterns.get(id).subjects[key]); scope is
 * { kind: 'fde' | 'chapters' | 'pages', chapters, pages }. `opts.reasked` is true once the
 * engine's one re-ask has run (a held item may then fill a place nothing else takes). Social
 * Studies also gets `held`: every item the last pass set aside, { slot, rule, printed, q },
 * `printed` when it was put back.
 * Never throws.
 */
function applyLayout(examJson, P, scope, opts = {}) {
  const src = examJson && typeof examJson === 'object' ? clone(examJson) : {};
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  const bySlot = new Map(slots.map((slot) => [slot.slot, []]));
  const room = (slot) => bySlot.get(slot.slot).length < slot.generate;
  let unplaced = 0;
  let putBack = [];
  let held = [];
  // Urdu: how many items each rule set aside in the last pass, by slot (`_layout.holds`).
  let tally = new Map();
  // Urdu on chosen lessons: Q1 asks only those lessons' own grammar.
  const lessons = P.key === 'urdu' ? scopeLessons(P, scope) : null;

  const all = walk(src);
  // Urdu: the concept Section A declares for a Q1 item is read here and taken off the item, so it
  // never prints; it is checked on chosen lessons only.
  const declared = new Map();
  // Urdu on one story: the source each Q1 item declares, read and taken off the same way.
  const story = P.key === 'urdu' && oneStory(lessons);
  const sources = new Map();
  const storyIds = new Set(story && src._layout && Array.isArray(src._layout.story_ids) ? src._layout.story_ids : []);
  all.forEach((entry) => {
    stripTags(entry.q); stripStemOptions(entry.q);
    if (P.key === 'social_studies') { stripSpareLabel(entry.q); sectionBStem(entry.q, P); }
    if (P.key !== 'urdu') return;
    stripStemOptions(entry.q, true);
    if (Object.prototype.hasOwnProperty.call(entry.q, 'concept')) {
      if (lessons) declared.set(entry.q, declaredConcept(entry.q.concept, P));
      delete entry.q.concept;
    }
    if (Object.prototype.hasOwnProperty.call(entry.q, 'source')) {
      if (story) sources.set(entry.q, String(entry.q.source || '').trim().toLowerCase());
      delete entry.q.source;
    } else if (storyIds.size && typeof entry.q.question === 'string' && storyIds.has(storyId(entry.q))) sources.set(entry.q, 'story');
  });
  const storyCount = (list) => list.filter((p) => sources.get(p) === 'story').length;
  // Urdu Q1: the items whose key of several words another Q1 item names as a person (nameInKey).
  const q1Items = P.key === 'urdu' ? all.map((e) => e.q).filter((q) => slotKey(q.slot) === slotKey('urdu.A.Q1')) : [];
  const nameGiven = new Set(q1Items.filter((q) => q1Items.some((b) => b !== q && nameInKey(q, b))));
  // Urdu: the words the reply's first Q3 asks the meaning of (a Q5 never asks them again).
  const q3 = P.key === 'urdu' ? all.find((e) => slotKey(e.q.slot) === slotKey('urdu.C.Q3') && Array.isArray(e.q.words)) : null;
  const q3Words = q3 ? q3.q.words.filter((w) => typeof w === 'string') : [];
  // The antonym and synonym rows hold a reply to the prompt that gives Q1 its grammar count, one that
  // declares its concepts; a reply written before it was never asked to keep them once. A paper
  // laid out again from a counted one (`_layout.counted`) stays counted: its placed items have lost
  // their tags, and an item a top-up writes without one is still read by its stem.
  const counted = declared.size || (src._layout && src._layout.counted === true) ? lessons : null;
  // The lessons a concept is read against: the counted ones, or on the full syllabus all of them (it
  // teaches the antonym and the synonym, lessons 4–5), so a concept is asked once on every scope.
  const conceptLessons = counted || (P.key === 'urdu' && !lessons ? P.lessons : null);
  // `id`, the slot both items are placed in: Urdu Q1 items also give each other away by a story
  // name, and ask a grammar concept once.
  // A concept asked again is a twin. `hard`: only a twin that may never print; an antonym or a synonym
  // asked again on lessons 4–5 gives nothing away, and is the last item put back (below).
  // The concepts an item asks: the one its stem or key names, and the one Section A declares for it,
  // as one set (a declared vocabulary item whose stem names a concept still asks it). A lesson entry
  // that names one concept («متشابہ الفاظ») is that concept's row; an entry of two is read by its stem.
  const conceptsOf = (q) => {
    const out = new Set();
    const c = conceptOf(q, conceptLessons);
    // A reply written before Section A declared its concepts was never asked to keep an antonym or a
    // synonym once on chosen lessons: there they stay vocabulary, as they printed.
    if (c && (conceptLessons || !LESSON_ONLY.has(c))) out.add(c);
    const d = declared.get(q);
    if (d && d.grammar && !d.pair) {
      const entry = CONCEPTS.some(([name]) => name === d.name) ? null : entryOf(P.lessons || [], d.name);
      out.add(entry && (entry.tags || []).length === 1 ? entry.tags[0] : d.name);
    }
    return out;
  };
  const conceptTwin = (p, q, hard) => {
    const mine = conceptsOf(q);
    const shared = [...conceptsOf(p)].filter((c) => mine.has(c));
    return hard ? shared.some((c) => !LESSON_ONLY.has(c)) : shared.length > 0;
  };
  // Social Studies: the book's sentences, when the engine passes its pages.
  const sentences = P.key === 'social_studies' ? bookSentences(opts.book) : null;
  const twin = (p, q, id, hard = false) => sameQuestion(p, q) || (P.key === 'social_studies' && (sameKeyFact(p, q) || sameTask(p, q) || sameLine(p, q) || samePassage(p, q, sentences)))
    || (P.key === 'urdu' && (sameStemKey(p, q) || stemGivesKey(p, q) || (id === 'urdu.C.Q4' && sameQ4Kind(p, q))
      || (id === 'urdu.A.Q1' && (storyCue(p, q) || nameCue(p, q) || conceptTwin(p, q, hard)))));
  // `cross`: a subject whose sections can give each other away (CROSS_HOLD), with its rule.
  // `within`: Social Studies, a D item answered by another item's points ([{ slot, rule, name, inSlot }],
  // SAME_POINTS); an in-slot row reads the items already placed in its slot.
  // Social Studies: the items set aside as a repeat of one already placed, with the test that matched.
  let repeated = [];
  // Urdu: the Q5 items the last pass held only for a Q3 word: they may come back after the re-ask, so
  // Section A is read against their words too.
  let mayReturn = [];
  const twinRule = (p, q) => (sameQuestion(p, q) ? 'same_question' : sameKeyFact(p, q) ? 'same_key_fact' : sameTask(p, q) ? 'same_task'
    : sameLine(p, q) ? 'same_line' : 'same_passage');
  // `back`: Social Studies, the Q1 items a placed C/D stem gives away (givenBack), with the test that matched.
  const place = (cross, within, back = null) => {
    bySlot.forEach((list) => { list.length = 0; });
    unplaced = 0;
    held = [];
    repeated = [];
    putBack = [];
    tally = new Map();
    const no = (slot, rule) => {
      if (P.key === 'urdu') tally.set(`${slot.slot}|${rule}`, (tally.get(`${slot.slot}|${rule}`) || 0) + 1);
      return false;
    };
    const holds = (slot) => Boolean(cross) && cross.held.includes(slot.slot);
    const fallback = new Map(); // slot → held items, in reply order
    const inSlot = new Map(); // Urdu Q1: slot → items held inside Q1 that give nothing away, in reply order
    mayReturn = [];
    const keep = (id, q, rule) => { inSlot.set(id, [...(inSlot.get(id) || []), { q, rule }]); tally.set(`${id}|${rule}`, (tally.get(`${id}|${rule}`) || 0) + 1); };
    // An Urdu Q1 twin of a placed item: never printed, or, a concept repeat only, kept for the put-back.
    const twinOf = (slot, q) => {
      if (bySlot.get(slot.slot).some((p) => twin(p, q, slot.slot, true))) return no(slot, 'twin');
      keep(slot.slot, q, 'concept_repeat');
      return false;
    };
    const repeats = new Map(); // Social Studies: slot → items a placed item already asks, in reply order
    const hold = (slot, q, rule) => {
      fallback.set(slot.slot, [...(fallback.get(slot.slot) || []), q]);
      held.push({ slot: slot.slot, rule, printed: false, q });
      return no(slot, rule);
    };
    const restated = (slot, q) => (within || []).find((w) => w.slot === slot.slot
      && (w.inSlot ? (samePoints(bySlot.get(slot.slot)) || (() => false))(q) : w.rule(q)));
    const fits = (slot, q) => {
      if (!settleVerses(slot, q) || !printable(slot, q)) return no(slot, 'unprintable');
      if (slot.slot === DIAGRAM_SLOT && notDiagramName(q)) return no(slot, 'diagram_not_named');
      if (P.key === 'social_studies' && tierSlip(q)) return false;
      if (P.key === 'social_studies' && slot.slot === Q7_SLOT && keyInOwnStem(q)) return hold(slot, q, 'key_in_own_stem');
      if (P.key === 'social_studies' && slot.slot === SST_A_Q1 && namesOwnKey(q)) return hold(slot, q, 'key_in_own_stem');
      if (P.key === 'social_studies' && slot.slot === SST_A_Q1 && bySlot.get(slot.slot).some((p) => stemNamesKey(p, q))) return hold(slot, q, 'names_q1_key');
      if (P.key === 'urdu' && DATE_KEY_SLOTS.has(slot.slot) && keyedOnDate(q)) return no(slot, 'date_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && bySlot.get(slot.slot).some((p) => sameQ4Kind(p, q))) return no(slot, 'q4_kind_repeat');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && !q4TaskKnown(q)) return no(slot, 'q4_task_unknown');
      if (slot.type === 'Story Order' && finallyNotLast(q)) return no(slot, 'order_finally_not_last');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && keyAcceptSplit(q)) return no(slot, 'key_accept_split');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && groupWordListed(q)) return no(slot, 'group_word_listed');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && syllableSplit(q)) { keep(slot.slot, q, 'syllable_split'); return false; }
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && bookSplit(q, P)) { keep(slot.slot, q, 'book_split'); return false; }
      // A word Q3 asks, asked again in Q5, gives nothing away: Section C is asked again first, and the
      // item comes back only if the re-ask leaves its place empty.
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q5' && q3Words.length && wordTwice(q, q3Words)) { keep(slot.slot, q, 'word_twice'); mayReturn.push(q); return false; }
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && printsOwnKey(q)) return no(slot, 'prints_own_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && lettersOfKey(q)) return no(slot, 'letters_of_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && markEndsStem(q)) return no(slot, 'mark_ends_stem');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && nameGiven.has(q)) return no(slot, 'name_in_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && twoRightOptions(q)) return no(slot, 'two_right_options');
      const outsideOf = slot.slot === 'urdu.A.Q1' && outsideLessons(q, lessons);
      const outside = outsideOf && (counted || !LESSON_ONLY.has(outsideOf)) ? outsideOf : null;
      if (outside) { held.push({ slot: slot.slot, rule: 'grammar_outside_lessons', concept: outside }); return no(slot, 'grammar_outside_lessons'); }
      const miss = slot.slot === 'urdu.A.Q1' && counted && declaredMiss(q, declared.get(q), counted);
      // A tag the stem contradicts gives nothing away: the item is asked again first, and comes back
      // only when no printed item asks its concept (a concept asked again never comes back).
      if (miss === 'concept_tag_disagrees') { keep(slot.slot, q, miss); return false; }
      if (miss) return no(slot, miss);
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && asksTwo(q)) { keep(slot.slot, q, 'asks_two'); return false; }
      // Urdu Q1's own twin rules run on every pass, not only once Section C gives a rule: a paper laid
      // out before Section C is in prints no Q1 twin either.
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && !holds(slot) && bySlot.get(slot.slot).some((p) => twin(p, q, slot.slot))) return twinOf(slot, q);
      if (!holds(slot)) {
        const given = back && slot.slot === SST_A_Q1 ? back(q) : null;
        if (given) return hold(slot, q, given);
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && asksRecall(q)) return hold(slot, q, 'recall');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && namesBody(q)) return hold(slot, q, 'names_body');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && asksFrame(q)) return hold(slot, q, 'asks_frame');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && tellsWhat(q)) return hold(slot, q, 'tells_what');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && bookList(q, sentences)) return hold(slot, q, 'book_list');
        // Social Studies: one question once in every slot, not only the held ones (a top-up wrote a
        // kept MCQ again with its options shuffled). The repeat is the last resort: it comes back
        // after the re-ask only for a place nothing else takes.
        const first = P.key === 'social_studies' ? bySlot.get(slot.slot).find((p) => twin(p, q)) : null;
        if (first) {
          repeats.set(slot.slot, [...(repeats.get(slot.slot) || []), q]);
          repeated.push({ slot: slot.slot, rule: twinRule(first, q), q });
          return false;
        }
        const row = restated(slot, q);
        if (row) return hold(slot, q, row.name);
        // A Q1 item that will print sets aside each placed Q1 item whose key its stem names.
        if (P.key === 'social_studies' && slot.slot === SST_A_Q1) {
          const list = bySlot.get(slot.slot);
          list.filter((p) => stemNamesKey(q, p)).forEach((p) => { list.splice(list.indexOf(p), 1); hold(slot, p, 'names_q1_key'); });
        }
        return true;
      }
      const again = bySlot.get(slot.slot).find((p) => twin(p, q, slot.slot));
      if (again) {
        if (P.key === 'social_studies') repeated.push({ slot: slot.slot, rule: twinRule(again, q), q });
        return P.key === 'urdu' && slot.slot === 'urdu.A.Q1' ? twinOf(slot, q) : no(slot, 'twin');
      }
      if (cross.rule(q, slot.slot)) return hold(slot, q, 'section_a');
      const row = restated(slot, q);
      return row ? hold(slot, q, row.name) : true;
    };
    // Urdu on one story: a story item past the eighth gives nothing away, and is the last item put back.
    const storyFull = (slot, q) => {
      if (!story || slot.slot !== 'urdu.A.Q1' || sources.get(q) !== 'story' || storyCount(bySlot.get(slot.slot)) < STORY_ITEMS) return false;
      keep(slot.slot, q, 'story_cap');
      return true;
    };
    const offer = (slot, q) => {
      if (room(slot) && fits(slot, q) && !storyFull(slot, q)) bySlot.get(slot.slot).push(q);
      else unplaced += 1;
    };
    const untagged = [];
    // Tagged items first, so an untagged one cannot take a tagged one's place.
    for (const entry of all) {
      let slot = byId.get(slotKey(entry.q.slot));
      if (!slot && entry.q.slot) {
        const tail = `.${slotKey(entry.q.slot).split('.').slice(-2).join('.')}`;
        slot = slots.find((s) => slotKey(s.slot).endsWith(tail));
      }
      if (!slot) { untagged.push(entry); continue; }
      offer(slot, entry.q);
    }
    for (const entry of untagged) {
      const key = typeKey(entry.type);
      const slot = slots.find((s) => typeKey(s.type) === key && room(s));
      if (slot) offer(slot, entry.q);
      else unplaced += 1;
    }
    // A held item comes back only after the one re-ask (the engine says so, `opts.reasked`): the
    // clean items, the re-asked section's among them, have had their turn, and a paper with a
    // repeat beats no paper. Before it, the held item stays out, so the slot is short and the
    // section is asked again.
    if (!opts.reasked) return;
    // Urdu: an item held against Section C (Q4's sentence, Q6's verse, a Q3/Q5 word) never comes
    // back: it is the give-away a reader sees. The engine tops Section A up once more instead, and
    // only an item held inside Q1 that gives nothing away fills a place left after that: a stem that
    // asks two questions, then an antonym or synonym asked again (a repeat, not a give-away). A twin of
    // a kept item, or a stem that prints a key, never comes back. Q4's ارکان item whose key and
    // accepted answer split a word apart is asked again first, and comes back only if the re-ask leaves
    // its place empty (it printed so before; a paper that refuses is worse). On every scope a grammar
    // concept a printed item already asks never comes back (a tag the stem contradicts on the only item
    // of its concept still may): the engine tops Section A up once more, told grammar is used up, and a
    // place still empty after that fails the paper.
    if (P.key === 'urdu') {
      inSlot.forEach((list, id) => {
        const slot = slots.find((s) => s.slot === id);
        const order = list.filter((x) => x.rule === 'asks_two').concat(list.filter((x) => x.rule !== 'asks_two'));
        for (const { q, rule } of order) {
          if (!room(slot)) return;
          if (GRAMMAR_REPEAT.has(rule) && bySlot.get(id).some((p) => conceptTwin(p, q, false))) continue;
          if (bySlot.get(id).some((p) => twin(p, q, id, rule === 'concept_repeat' || rule === 'concept_tag_disagrees')) || (holds(slot) && cross.rule(q))) continue;
          bySlot.get(id).push(q);
          putBack.push({ slot: id, rule });
          unplaced -= 1;
        }
      });
      return;
    }
    // Social Studies: a caught item never prints, a repeat neither. A choice slot prints fewer
    // items (its count to answer and its marks stay), a compulsory one is short (below).
    if (P.key === 'social_studies') return;
    fallback.forEach((list, id) => {
      const slot = slots.find((s) => s.slot === id);
      for (const q of list) {
        if (!room(slot)) break;
        if (bySlot.get(id).some((p) => twin(p, q))) continue;
        bySlot.get(id).push(q);
        unplaced -= 1;
        held.filter((h) => h.q === q).forEach((h) => { h.printed = true; });
      }
    });
    repeats.forEach((list, id) => {
      const slot = slots.find((s) => s.slot === id);
      for (const q of list) {
        if (!room(slot)) break;
        bySlot.get(id).push(q);
        unplaced -= 1;
      }
    });
  };
  place(null);
  // A subject whose sections can give each other away is laid out again with its rule, built
  // from what the first pass placed in the slot that could be given away.
  const cross = CROSS_HOLD[P.key];
  const against = cross && slots.filter((s) => [].concat(cross.against).includes(s.slot));
  // Each item as the slot it was placed in (a mis-tag, «urdo.C.Q4», is placed by its tail).
  const rule = against && against.length && cross.rule(against.flatMap((s) => bySlot.get(s.slot).concat(s.slot === 'urdu.C.Q5' ? mayReturn : []).map((q) => ({ ...q, slot: s.slot }))));
  if (rule) place({ held: cross.held, rule });
  // Social Studies: D is laid out again against the point sets now placed, one row at a time in
  // SAME_POINTS order, each row built from the slots the rows before it have settled (Q5 is held only
  // against Section A, and Q6 never against Q7, so a later row cannot move an earlier one's slot). A
  // row that holds nothing leaves the paper as it was.
  if (P.key === 'social_studies') {
    const rows = [];
    for (const row of SAME_POINTS) {
      if (!bySlot.has(row.held) || !row.against.every((id) => bySlot.has(id))) continue;
      const inSlot = row.against.includes(row.held);
      // Read against the items placed: a held Social Studies item never prints, so it gives nothing away.
      const test = inSlot ? null : row.rule(row.against.flatMap((id) => bySlot.get(id)));
      if (!inSlot && !test) continue;
      rows.push({ slot: row.held, rule: test, name: row.name, inSlot });
      place(rule ? { held: cross.held, rule } : null, rows);
    }
    // Then Section A against the C and D stems now placed (they are laid out the same way again).
    const back = bySlot.has(SST_A_Q1) && givenBack(['social_studies.C.Q5', Q6_SLOT, 'social_studies.D.Q7']
      .flatMap((id) => (bySlot.get(id) || []).map((q) => ({ ...q, slot: id }))));
    if (back) place(rule ? { held: cross.held, rule } : null, rows, back);
  }
  // Urdu Q4 prints its kinds in FDE's order, whatever order the reply wrote them in.
  if (P.key === 'urdu' && bySlot.has('urdu.C.Q4')) {
    const rank = (q) => { const k = q4Kind(q); return k < 0 ? Q4_KINDS.length : k; };
    bySlot.get('urdu.C.Q4').sort((a, b) => rank(a) - rank(b));
  }
  spreadKeys(slots, bySlot);

  // Marks, lines and the canonical tag come from the pattern, never the model.
  const unseen = {};
  const usedKeys = new Set();
  const shortfall = [];
  // Social Studies after the re-ask: a choice slot that prints fewer than it offers but still
  // leaves the child a choice (at least what the child answers, plus one) is not short; it is
  // recorded. Below that it is short, as a compulsory slot is.
  const shortChoice = [];
  const choiceFloor = (slot) => (P.key === 'social_studies' && opts.reasked && slot.compulsory === false ? Math.min(slot.generate, slot.attempt + 1) : slot.generate);
  let placed = 0;
  for (const slot of slots) {
    const list = bySlot.get(slot.slot);
    list.forEach((q) => {
      q.slot = slot.slot;
      q.marks = slot.marks_each;
      q.lines = slot.lines;
      if (Array.isArray(slot.parts_spec) && Array.isArray(q.parts)) {
        q.parts.forEach((part) => {
          const spec = part && slot.parts_spec.find((s) => s.key === part.key);
          if (spec && Array.isArray(part.questions)) {
            part.questions.forEach((sub) => { if (sub && typeof sub === 'object') sub.marks = spec.marks_each; });
          }
        });
      }
    });
    placed += list.length;
    if (list.length < choiceFloor(slot)) shortfall.push({ slot: slot.slot, missing: choiceFloor(slot) - list.length });
    else if (list.length < slot.generate) shortChoice.push({ slot: slot.slot, printed: list.length, generate: slot.generate });
    let key = slot.type;
    for (let n = 2; usedKeys.has(key); n += 1) key = `${slot.type} (${n})`;
    usedKeys.add(key);
    if (!unseen[slot.category]) unseen[slot.category] = {};
    unseen[slot.category][key] = list;
  }

  const out = {};
  for (const [k, v] of Object.entries(src)) if (k !== 'seen' && k !== 'unseen' && k !== '_layout') out[k] = v;
  out.unseen = unseen;
  out._layout = {
    v: 2,
    preset_id: opts.presetId || 'fde_g5_2027',
    subject: P.key,
    medium: P.medium,
    scope: scopeBlock(P, scope),
    header: clone(P.header),
    sections: withFramePages(clone(P.sections), bySlot),
    legend: clone(P.legend),
    before_exam: clone(P.before_exam),
    supplies: suppliesFor(P, bySlot),
    total_marks: P.total_marks,
    total_time_en: P.total_time_en,
    total_time_ur: P.total_time_ur,
    unplaced,
    generated_at: opts.now || new Date().toISOString(),
    pages: null,
    frame_pages: null,
    notes: [],
  };
  // `held` and `repeated` are Social Studies' only (the engine reads `held` for Section D, and logs both). `putBack` (Urdu: the
  // held items that came back, with their rule) only when there are some. Any other subject gets `held` only for Q1 items
  // held for a grammar concept the chosen lessons do not teach, and only when there are some.
  if (shortChoice.length) out._layout.short_choice = shortChoice;
  // Urdu: the holds by slot and rule, counts only. A paper laid out again from a laid paper (its held
  // items already gone) keeps the larger count the earlier layout recorded.
  if (P.key === 'urdu') {
    if (counted) out._layout.counted = true;
    // On one story: how many printed Q1 items ask a fact of the story (a top-up is told what is left). A
    // paper laid out again from a laid one (its sources already gone) keeps the count it had.
    const told = sources.size ? storyCount(bySlot.get('urdu.A.Q1') || []) : src._layout && src._layout.story_items;
    if (story && Number.isInteger(told)) out._layout.story_items = told;
    if (story && sources.size) out._layout.story_ids = (bySlot.get('urdu.A.Q1') || []).filter((p) => sources.get(p) === 'story').map(storyId);
    const before = src._layout && Array.isArray(src._layout.holds) ? src._layout.holds : [];
    const counts = new Map(before.map((h) => [`${h.slot}|${h.rule}`, h.n]));
    tally.forEach((n, k) => counts.set(k, Math.max(n, counts.get(k) || 0)));
    if (counts.size) out._layout.holds = [...counts].map(([k, n]) => { const [slot, rule] = k.split('|'); return { slot, rule, n }; });
  }
  const base = { examJson: out, placed, unplaced, shortfall, ...(putBack.length ? { putBack } : {}) };
  if (P.key === 'social_studies') return { ...base, held, shortChoice, repeated };
  const outside = held.filter((h) => h.rule === 'grammar_outside_lessons');
  return outside.length ? { ...base, held: outside } : base;
}

module.exports = {
  applyLayout, takenNote, firstAskNote, verseLines, typeKey, slotKey, unitWord, scopeLessons, conceptOf, oneStory, STORY_ITEMS,
  // The rows a concept is read by on any scope; antonym and synonym are concepts on lessons 4–5 only.
  conceptNames: CONCEPTS.map(([name]) => name).filter((name) => !LESSON_ONLY.has(name)),
};
