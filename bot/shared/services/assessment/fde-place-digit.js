'use strict';
/**
 * The digit a key names is the digit the number holds in that place (v37 G5 Maths Q2 i). Rounding
 * 2,306,745 to the nearest thousand, the key paid "Looks at the hundreds digit (6)" and accepted
 * "because the hundreds digit is 6": the hundreds digit is 7, so the paid step taught a wrong rule.
 *
 *   digitAt(number, place)  the digit of a printed number in a named place, or null.
 *   mendPlaceDigits(exam)   for each scheme point and accept line naming "<place> digit (d)" or
 *                           "<place> digit is d": when no number in the item holds d there and the
 *                           stem prints one number that has the place, d is rewritten to that number's
 *                           digit if both sit on the same side of 5 (the rounding call stands);
 *                           otherwise the row is listed in `wrong`. Common errors are left alone.
 *
 * Pure: exam JSON in, { examJson, notes, wrong } out; never throws, never mutates.
 */

const PLACES = { ones: 0, tens: 1, hundreds: 2, thousands: 3, 'ten thousands': 4, 'hundred thousands': 5, millions: 6 };
const NAMED = /\b(ones|tens|hundreds|thousands|ten[ -]thousands|hundred[ -]thousands|millions)\s+digit\s+(?:\((\d)\)|is\s+(\d))/gi;
const NUMBER = /\d{1,3}(?:,\d{3})+|\d{4,}/g;

const placeKey = (p) => String(p).toLowerCase().replace('-', ' ');

function digitAt(number, place) {
  const digits = String(number).replace(/,/g, '');
  const k = PLACES[placeKey(place)];
  if (!/^\d+$/.test(digits) || k === undefined || k >= digits.length) return null;
  return Number(digits[digits.length - 1 - k]);
}

const numbersIn = (s) => (typeof s === 'string' ? s.match(NUMBER) || [] : []);
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);

function mendText(text, item, where, notes, wrong) {
  if (typeof text !== 'string') return text;
  const all = [item.question, item.answer].concat(subs(item).flatMap((s) => [s.question, s.answer])).flatMap(numbersIn);
  const stem = [...new Set([item.question].concat(subs(item).map((s) => s.question)).flatMap(numbersIn))];
  return text.replace(NAMED, (whole, place, a, b) => {
    const named = Number(a !== undefined ? a : b);
    if (all.some((n) => digitAt(n, place) === named)) return whole;
    const held = stem.map((n) => digitAt(n, place)).filter((d) => d !== null);
    if (held.length !== 1) return whole;
    const real = held[0];
    if ((real >= 5) !== (named >= 5)) { wrong.push({ slot: item.slot, where, text }); return whole; }
    notes.push(`${item.slot} ${where}: ${placeKey(place)} digit ${named} → ${real}`);
    return whole.replace(String(named), String(real));
  });
}

function mendItem(q, notes, wrong) {
  if (!q || typeof q !== 'object' || !q.scheme || typeof q.scheme !== 'object') return q;
  const before = notes.length + wrong.length;
  const scheme = { ...q.scheme };
  if (Array.isArray(scheme.points)) {
    scheme.points = scheme.points.map((p, i) => (p && typeof p.text === 'string'
      ? { ...p, text: mendText(p.text, q, `point ${i + 1}`, notes, wrong) } : p));
  }
  if (Array.isArray(scheme.accept)) scheme.accept = scheme.accept.map((t, i) => mendText(t, q, `accept ${i + 1}`, notes, wrong));
  return notes.length + wrong.length === before ? q : { ...q, scheme };
}

function mendPlaceDigits(examJson) {
  const notes = [];
  const wrong = [];
  try {
    if (!examJson || typeof examJson !== 'object') return { examJson, notes, wrong };
    const out = { ...examJson };
    ['seen', 'unseen'].forEach((branch) => {
      if (!out[branch] || typeof out[branch] !== 'object') return;
      out[branch] = Object.fromEntries(Object.entries(out[branch]).map(([cat, types]) => [cat,
        types && typeof types === 'object' ? Object.fromEntries(Object.entries(types).map(([t, list]) => [t,
          Array.isArray(list) ? list.map((q) => mendItem(q, notes, wrong)) : list])) : types]));
    });
    return { examJson: out, notes, wrong };
  } catch (err) {
    return { examJson, notes: [`place digit check stopped: ${err.message}`], wrong };
  }
}

module.exports = { digitAt, mendPlaceDigits };
