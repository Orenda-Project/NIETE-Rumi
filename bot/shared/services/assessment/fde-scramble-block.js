'use strict';
/**
 * The mixed letters of a scramble item (bd-5jmnfj.4.50.9). The model mixes them the easy way:
 * v22 G1 English Q2 moved the last letter to the front of every item ("d b c"), Q4 spelled four
 * words backwards ("g o d"), G1 Urdu Q2 printed three items as the key reversed. A child who sees
 * the pattern reads nothing. Each item is mixed again here: never the key, never the key turned
 * round or read backwards, never another answer on the paper and, while the paper has mixes
 * left, never the same mix as another item. The key is not touched.
 * Pure: exam JSON in, exam JSON out. An item it cannot read is left as it is.
 */

const { permutations } = require('./fde-order-block');

const TYPES = new Set(['Alphabetical Order', 'Unscramble Words']);
const COMMA = /\s*[،,]\s*/;
const sameItems = (a, b) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/** "d b c" / "م، د، ت" / "n u s" with its key → { parts, truth, sep }; null when unreadable. */
function parseScramble(q) {
  const text = String(q.question ?? '').trim();
  const key = String(q.answer ?? '').trim();
  const comma = COMMA.test(text);
  const split = (s) => s.split(comma ? COMMA : /\s+/).map((t) => t.trim()).filter(Boolean);
  const parts = split(text);
  const said = split(key);
  // An unscramble key is the word itself: its letters are the true order.
  const truth = said.length === 1 && parts.length > 1 ? [...key] : said;
  if (parts.length < 2 || !sameItems(parts, truth)) return null;
  return { parts, truth, sep: comma ? (text.includes('،') ? '، ' : ', ') : ' ' };
}

/** The key, each turn of it and the key read backwards: the mixes a child reads without reading. */
function giveaways(truth) {
  const n = truth.length;
  const turns = truth.map((_, k) => truth.map((__, i) => truth[(i + k) % n]));
  return new Set([...turns, [...truth].reverse()].map((t) => t.join('\u0000')));
}

/** Every answer on the paper, as a child would spell it: a mix that spells one is a giveaway too. */
function paperAnswers(examJson) {
  const out = new Set();
  Object.values(examJson.unseen || {}).forEach((byType) => Object.values(byType || {}).forEach((list) => {
    if (Array.isArray(list)) list.forEach((q) => out.add(String((q && q.answer) ?? '').replace(/[\s،,]+/g, '').toLowerCase()));
  }));
  return out;
}

// v25 G2 Urdu Q2 iv keyed «خواب، مکڑا، ٹڈی»; ٹ comes first. An alphabetical key is worked out here (bd-5jmnfj.4.57).
const URDU = 'ا آ ب پ ت ٹ ث ج چ ح خ د ڈ ذ ر ڑ ز ژ س ش ص ض ط ظ ع غ ف ق ک گ ل م ن و ہ ھ ء ی ے'.split(' ');
const SAME = { 'ۂ': 'ہ', 'ة': 'ہ', 'ئ': 'ء', 'ؤ': 'و', 'ي': 'ی', 'ك': 'ک', 'ى': 'ی', 'ه': 'ہ', 'ں': 'ن', 'ۓ': 'ے', 'أ': 'ا' };
const rank = (ch) => {
  if (/[a-z]/.test(ch)) return ch.charCodeAt(0);
  const i = URDU.indexOf(SAME[ch] || ch);
  return i < 0 ? null : 1000 + i;
};

/** The words in alphabet order (Urdu or English), or null when a letter is not one the order knows. */
function alphabetKey(words) {
  const ranks = words.map((w) => [...String(w).normalize('NFC').toLowerCase().replace(/[ً-ْٰ\s-]/g, '')].map(rank));
  if (ranks.some((r) => !r.length || r.includes(null))) return null;
  const cmp = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };
  return words.map((w, i) => [w, ranks[i]]).sort((x, y) => cmp(x[1], y[1])).map(([w]) => w);
}

function sortKey(q) {
  const p = parseScramble(q);
  const sorted = p && p.truth.length === p.parts.length && alphabetKey(p.truth);
  if (!sorted || sorted.join('\u0000') === p.truth.join('\u0000')) return q;
  return { ...q, answer: sorted.join(p.sep), ...(q.scheme ? { scheme: { ...q.scheme, accept: [sorted.join(' ')] } } : {}) };
}

function dealItems(items, answers) {
  const used = new Set();
  return items.map((q, k) => {
    const p = parseScramble(q);
    if (!p || p.truth.length > 6) return q;
    const n = p.truth.length;
    const bad = giveaways(p.truth);
    const ok = permutations(n).filter((perm) => {
      const out = perm.map((i) => p.truth[i]);
      return !bad.has(out.join('\u0000')) && !answers.has(out.join('').toLowerCase());
    });
    if (!ok.length) return q;
    // Start each item at its own place in the list, as fde-order-block does.
    const start = (k * 7 + n) % ok.length;
    const turn = [...ok.slice(start), ...ok.slice(0, start)];
    const pick = turn.find((perm) => !used.has(perm.join())) || turn[0];
    used.add(pick.join());
    return { ...q, question: pick.map((i) => p.truth[i]).join(p.sep) };
  });
}

function dealScrambles(examJson) {
  const laid = ((examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || []);
  const slots = new Set(laid.filter((s) => TYPES.has(s.type)).map((s) => s.slot));
  const sorted = new Set(laid.filter((s) => s.type === 'Alphabetical Order').map((s) => s.slot));
  if (!slots.size) return examJson;
  const answers = paperAnswers(examJson);
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType).map(([type, list]) => {
      if (!Array.isArray(list) || !list.some((q) => slots.has(q.slot))) return [type, list];
      const mine = dealItems(list.filter((q) => slots.has(q.slot)).map((q) => (sorted.has(q.slot) ? sortKey(q) : q)), answers);
      let i = 0;
      return [type, list.map((q) => (slots.has(q.slot) ? mine[i++] : q))];
    }))]));
  return { ...examJson, unseen };
}

module.exports = { dealScrambles, parseScramble, alphabetKey };
