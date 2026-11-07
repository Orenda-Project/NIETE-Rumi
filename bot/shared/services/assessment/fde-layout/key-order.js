'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { keyPattern, letterOption } = require('../fde-key-pattern');
const { LATIN_KEY, URDU_KEY, URDU_LETTERS } = require('./scope-frames');

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

function monotonic(v) {
  if (v.some(Number.isNaN)) return false;
  const up = v.every((x, i) => i === 0 || x > v[i - 1]);
  const down = v.every((x, i) => i === 0 || x < v[i - 1]);
  return up || down;
}

// Numbers, or words with an order of their own, printed in order (either way).
function inNumberOrder(texts) {
  return SCALES.some((scale) => monotonic(texts.map((t) => scale(t.trim()))));
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

module.exports = {
  bare, breakPeriod, keyAt, positionalPair, random, readKey, sameValueTwice, seedOf, turned,
};
