'use strict';
/**
 * Three more slip models for a board-pattern maths `common_error` (bd-5jmnfj.4.57), beside the
 * two in fde-scheme-figures.js. v25 printed figures the slip it named does not give:
 *  - counting back or on past a run: "45, 46, 47, __, __" said counting back writes 44, 43
 *    (from 47 a child writes 46, 45);
 *  - adding without carrying: 324 + 258 said "in the ones or tens, giving 472" (only the ones
 *    carry, and dropping that carry gives 572);
 *  - not lining up the decimal points: 45.75 + 12.50 said Rs. 50.25 or Rs. 57.25 (both have two
 *    places, so the slip changes nothing and there is no wrong figure to print).
 * A figure is replaced only when the model covers the item and the figure is not one the slip
 * gives; anything the models cannot read is left exactly as written.
 *
 * Pure: no I/O, never throws. Rewrites `q.scheme.common_error` in place, as checkSchemeFigures does.
 */

const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const MONEY = String.raw`(?:Rs\.?\s*)?${NUM}`;
const VERB = String.raw`(?:writes|giving|gives|getting|to\s+get)`;
// "writes 44, 43" / "giving 315 or 325" / "giving Rs. 50.25 or Rs. 57.25"
const FIGURES = new RegExp(String.raw`(\b${VERB}\s+(?:an?\s+answer\s+of\s+)?)(${MONEY}(?:\s*(?:,|\bor\b|\band\b)\s*${MONEY})*)`, 'i');
const COUNTING = /\bcount(?:s|ing)?\s+(back|down|on|forwards?|up)\b/i;
const CARRY = /\b(?:not|without|no)\s+carry|\bforg[eo]t\w*\s+(?:to\s+)?carry/i;
const DECIMAL = /\b(?:lin(?:e|es|ing)\s+up|align\w*)\s+the\s+decimal/i;
const COLUMN_NAMES = ['ones', 'tens', 'hundreds', 'thousands', 'ten thousands'];
const IN_COLUMNS = /\bin\s+the\s+((?:ones|tens|hundreds|thousands)(?:\s*(?:,|\bor\b|\band\b)\s*(?:the\s+)?(?:ones|tens|hundreds|thousands))*)/i;

const figuresOf = (list) => (list.match(new RegExp(NUM, 'g')) || []).map((n) => n.replace(/,/g, ''));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => Number(x) === Number(b[i]));

/** "45, 46, 47, __, __" counted back → ['46', '45']; null unless numbers then trailing blanks. */
function countSlip(q, error) {
  const how = COUNTING.exec(error);
  const parts = String(q.question ?? '').split(',').map((t) => t.trim());
  const blanks = parts.length - parts.findIndex((t) => /^_+$/.test(t));
  const nums = parts.slice(0, parts.length - blanks);
  if (!how || blanks < 1 || blanks === parts.length + 1 || nums.length < 2) return null;
  if (!parts.slice(nums.length).every((t) => /^_+$/.test(t)) || !nums.every((t) => /^\d+$/.test(t))) return null;
  const n = nums.map(Number);
  const step = n[1] - n[0];
  if (!step || n.some((x, i) => i && x - n[i - 1] !== step)) return null;
  const by = /\bby\s+(\d+)/i.exec(error);
  const size = by ? Number(by[1]) : Math.abs(step);
  const dir = /back|down/i.test(how[1]) ? -1 : 1;
  const out = Array.from({ length: blanks }, (_, k) => n[n.length - 1] + dir * (k + 1) * size);
  return out.every((x) => x >= 0) ? out.map(String) : null;
}

/** Whole-number a + b → { slips, all, carrying }: each column's own dropped carry, and all dropped. */
function carrySlips(a, b) {
  const da = [...a].reverse().map(Number);
  const db = [...b].reverse().map(Number);
  const width = Math.max(da.length, db.length);
  const add = (drop) => {
    let carry = 0;
    let out = 0;
    for (let i = 0; i < width; i += 1) {
      const s = (da[i] || 0) + (db[i] || 0) + carry;
      const top = i === width - 1;
      out += (top ? s : s % 10) * 10 ** i;
      carry = top || drop(i) ? 0 : Math.floor(s / 10);
    }
    return out;
  };
  const carrying = [];
  let carry = 0;
  for (let i = 0; i < width - 1; i += 1) {
    carry = Math.floor(((da[i] || 0) + (db[i] || 0) + carry) / 10);
    if (carry) carrying.push(i);
  }
  return { slips: new Set([...carrying.map((c) => add((i) => i === c)), add(() => true)]), all: add(() => true), carrying };
}

function fixCarry(q, s) {
  const sum = /(?<![\d.,])(\d+)\s*\+\s*(\d+)(?![\d.,]\d)/;
  const at = sum.exec(String(q.answer ?? '')) || sum.exec(String(q.question ?? ''));
  if (!at) return;
  const { slips, all, carrying } = carrySlips(at[1], at[2]);
  if (!carrying.length) return;
  const named = IN_COLUMNS.exec(s.common_error);
  const real = carrying.map((i) => COLUMN_NAMES[i]);
  if (named && real.join() !== COLUMN_NAMES.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(named[1])).join()) {
    s.common_error = s.common_error.replace(named[1], real.join(' or '));
  }
  const fig = FIGURES.exec(s.common_error);
  if (fig && !figuresOf(fig[2]).every((f) => slips.has(Number(f)))) {
    const start = fig.index + fig[1].length;
    s.common_error = s.common_error.slice(0, start) + String(all) + s.common_error.slice(start + fig[2].length);
  }
}

function fixDecimal(q, s) {
  const at = /(\d+(?:\.(\d+))?)\s*([+\-−])\s*(\d+(?:\.(\d+))?)/.exec(String(q.answer ?? ''));
  const fig = FIGURES.exec(s.common_error);
  if (!at || !fig || (!at[2] && !at[5])) return;
  const pa = (at[2] || '').length;
  const pb = (at[5] || '').length;
  if (pa === pb) {
    // Same places: lined up or not, the columns are the same, so no wrong figure exists.
    const end = /\.\s*$/.test(s.common_error) ? '.' : '';
    s.common_error = s.common_error.slice(0, fig.index).replace(/[\s,]+$/, '') + end;
    return;
  }
  const A = Number(at[1].replace('.', ''));
  const B = Number(at[4].replace('.', ''));
  const raw = at[3] === '+' ? A + B : A - B;
  if (raw < 0) return;
  const places = Math.max(pa, pb);
  const slip = (raw / 10 ** places).toFixed(places);
  if (sameList(figuresOf(fig[2]), [slip])) return;
  const start = fig.index + fig[1].length;
  const to = (/^Rs/i.test(fig[2]) ? 'Rs. ' : '') + slip;
  s.common_error = s.common_error.slice(0, start) + to + s.common_error.slice(start + fig[2].length);
}

function checkCommonError(q) {
  try {
    const s = q && q.scheme;
    if (!s || typeof s.common_error !== 'string') return;
    const error = s.common_error;
    if (COUNTING.test(error)) {
      const fig = FIGURES.exec(error);
      const slip = fig && countSlip(q, error);
      if (slip && figuresOf(fig[2]).length === slip.length && !sameList(figuresOf(fig[2]), slip)) {
        const start = fig.index + fig[1].length;
        s.common_error = error.slice(0, start) + slip.join(', ') + error.slice(start + fig[2].length);
      }
    } else if (CARRY.test(error)) fixCarry(q, s);
    else if (DECIMAL.test(error) && !/misplac/i.test(error)) fixDecimal(q, s);
  } catch (_) {
    // A shape nothing above expected: leave the error as it was.
  }
}

module.exports = { checkCommonError, countSlip, carrySlips };
