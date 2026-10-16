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
 */
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

function stripStemOptions(q) {
  if (!q || typeof q.question !== 'string' || q.question.length > STEM_MAX) return;
  if (!Array.isArray(q.options) || q.options.length !== 4) return;
  const text = q.question;
  const labels = [...text.matchAll(STEM_LABEL)];
  // The list must be the last four labels, a to d in order, and end the stem.
  if (labels.length < 4) return;
  const four = labels.slice(-4);
  if (four.map((m) => m[2].toLowerCase()).join('') !== 'abcd') return;
  const segments = four.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i < 3 ? four[i + 1].index + four[i + 1][1].length : text.length;
    return optionText(text.slice(from, to));
  });
  // Each segment is one of the options, each option once: then it is the options again.
  const options = q.options.map(optionText);
  if (new Set(segments).size !== 4 || !segments.every((seg) => seg && options.includes(seg))) return;
  q.question = text.slice(0, four[0].index + four[0][1].length).trim();
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
// fact a Q1 MCQ already tests (the MCQ's key is inside one of the item's keys, or one of the
// item's keys is inside the MCQ's stem, AND the two ask about the same thing). The held item takes no place: the next item in
// reply order does (on a re-ask, the second reply's), and with none left the slot is short.
// The other slot is never touched.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textsOf = (...values) => values.flat().filter((t) => typeof t === 'string');

function q4Words(q4s) {
  const words = q4s.flatMap((q) => (Array.isArray(q.words) ? q.words : []))
    .map((w) => (typeof w === 'string' ? w.replace(/^[\s"'“‘(]+|[\s"'”’).,;:!?]+$/g, '') : ''))
    .filter(Boolean)
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
// An answer of one line (ten words or fewer, function words aside) is a key in itself.
const ONE_LINE = 10;
// Same thing asked: at least three of the MCQ's own words, and at least half of them.
const SAME_WORDS = 3;
const SAME_SHARE = 0.5;

function sameFact(q1s) {
  const mcqs = q1s.map((m) => ({ key: new Set(tokensOf(keyText(m))), stem: new Set(tokensOf(m.question)) }))
    .filter((m) => m.key.size && m.stem.size);
  if (!mcqs.length) return null;
  return (q) => {
    const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
    const points = Array.isArray(scheme.points) ? scheme.points.map((p) => p && p.text) : [];
    const accept = Array.isArray(scheme.accept) ? scheme.accept : [];
    const said = new Set(tokensOf(textsOf(q.question, q.answer, points, accept).join(' ')));
    // The item's keys: each marking point and accepted answer, and the answer when it is one line or
    // the item has no points (never its stem, and never a long answer that only mentions the
    // MCQ's key on the way to its own).
    const marked = textsOf(points, accept);
    const keys = textsOf(marked, !marked.length || tokensOf(q.answer).length <= ONE_LINE ? [q.answer] : [])
      .map((t) => new Set(tokensOf(t))).filter((k) => k.size);
    // What the MCQ asks (its stem, the shared key taken out) is what the item says too.
    const asksSame = (asks) => {
      const both = asks.filter((w) => said.has(w)).length;
      return both >= SAME_WORDS && both / asks.length >= SAME_SHARE;
    };
    return mcqs.some((m) => {
      const stem = [...m.stem].filter((w) => !m.key.has(w));
      if (keys.some((k) => [...m.key].every((w) => k.has(w))) && asksSame(stem)) return true;
      // The item's key printed in the MCQ's stem: a name both carry is not by itself the same question.
      return keys.some((k) => [...k].every((w) => m.stem.has(w)) && asksSame(stem.filter((w) => !k.has(w))));
    });
  };
}

const CROSS_HOLD = {
  english: { held: ['english.A.Q1a'], against: 'english.C.Q4', rule: q4Words },
  social_studies: { held: ['social_studies.C.Q5', 'social_studies.D.Q7'], against: 'social_studies.A.Q1', rule: sameFact },
};

/**
 * applyLayout(examJson, P, scope, { now }) → { examJson, placed, unplaced, shortfall }
 *
 * P is one subject of a pattern (patterns.get(id).subjects[key]); scope is
 * { kind: 'fde' | 'chapters' | 'pages', chapters, pages }. Never throws.
 */
function applyLayout(examJson, P, scope, opts = {}) {
  const src = examJson && typeof examJson === 'object' ? clone(examJson) : {};
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  const bySlot = new Map(slots.map((slot) => [slot.slot, []]));
  const room = (slot) => bySlot.get(slot.slot).length < slot.generate;
  let unplaced = 0;

  const all = walk(src);
  all.forEach((entry) => { stripTags(entry.q); stripStemOptions(entry.q); });
  const place = (held) => {
    bySlot.forEach((list) => { list.length = 0; });
    unplaced = 0;
    const fits = (slot, q) => settleVerses(slot, q) && printable(slot, q) && !(held && held(slot, q));
    const untagged = [];
    // Tagged items first, so an untagged one cannot take a tagged one's place.
    for (const entry of all) {
      let slot = byId.get(slotKey(entry.q.slot));
      if (!slot && entry.q.slot) {
        const tail = `.${slotKey(entry.q.slot).split('.').slice(-2).join('.')}`;
        slot = slots.find((s) => slotKey(s.slot).endsWith(tail));
      }
      if (!slot) { untagged.push(entry); continue; }
      if (room(slot) && fits(slot, entry.q)) bySlot.get(slot.slot).push(entry.q);
      else unplaced += 1;
    }
    for (const entry of untagged) {
      const key = typeKey(entry.type);
      const slot = slots.find((s) => typeKey(s.type) === key && room(s));
      if (slot && fits(slot, entry.q)) bySlot.get(slot.slot).push(entry.q);
      else unplaced += 1;
    }
  };
  place(null);
  // A subject whose sections can give each other away is laid out again, the held items
  // set aside, against what the first pass placed in the slot they would give away.
  const cross = CROSS_HOLD[P.key];
  const against = cross && slots.find((s) => s.slot === cross.against);
  const rule = against && cross.rule(bySlot.get(against.slot).slice());
  if (rule) place((slot, q) => cross.held.includes(slot.slot) && rule(q));
  spreadKeys(slots, bySlot);

  // Marks, lines and the canonical tag come from the pattern, never the model.
  const unseen = {};
  const usedKeys = new Set();
  const shortfall = [];
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
    if (list.length < slot.generate) shortfall.push({ slot: slot.slot, missing: slot.generate - list.length });
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
    sections: clone(P.sections),
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
  return { examJson: out, placed, unplaced, shortfall };
}

module.exports = { applyLayout, typeKey, slotKey, unitWord };
