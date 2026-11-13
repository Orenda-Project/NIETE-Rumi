'use strict';
/**
 * bd-snkn32.40 — the SOFT rules of a grades 1–5 rewrite, fixed in code after the model's reply. Pure (no I/O).
 *
 * WHY. Since bd-snkn32.30 the gate refused a rewrite whose minutes did not add up to the period, that carried more
 * activities than her class size allows, or that ran longer than her day plan. Each refusal paid for a repair round,
 * and a second refusal failed her row ("Couldn't make it"). These are arithmetic, not teaching: code fixes them
 * exactly, every time, for nothing. The HARD rules (the five GRR parts, You Do alone, no rote, no slates, the
 * outcome and day and language) still refuse, in lp-k5-own.checkK5Rewrite.
 *
 *   fitMinutes  — fill missing minutes and scale so the five parts add up exactly to the period (whole numbers,
 *                 each at least 1, the opening and the check kept small). A plan that already fits is not touched.
 *   trimToLoad  — cut the extra steps / You Do questions / checks / homework beyond her class size's cap, from the
 *                 end; never an item carrying a diagram, a board drawing or a worked example.
 *   fitK5       — both, then the length: longer than her day plan is a WARNING, never a refusal.
 *   repairOnly  — a teacher checking each child in a class over 30: code cannot rewrite that sentence safely (the
 *                 Urdu forms carry verb agreement; dropping the line can empty a check), so it goes back to the model
 *                 once, and is never the final refusal on its own (lp-k5-own-author).
 */
const P = require('./lp-own-period');

const { SECTIONS } = P;
const MIDDLE = ['iDo', 'weDo', 'youDo'];
/** The opening and the check stay small: at most this share of the period each. */
const SMALL = 0.15;
/** A make may carry no more words than her day plan; a change ("Change this plan") keeps its 1.3x allowance. */
const MAKE_GROWTH = 1;
const EDIT_GROWTH = 1.3;
/** An item in a capped list that carries a picture or a worked example is never cut. */
const KEEP = /diagram|board|worked|image|svg|picture/i;

const clone = (o) => JSON.parse(JSON.stringify(o));
const minutesOf = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** True when the five parts are whole, positive and add up to the period: the plan is left as it is. */
function fits(s, period) {
  const m = SECTIONS.map((k) => s[k] && s[k].minutes);
  return m.every((x) => Number.isInteger(x) && x > 0) && m.reduce((a, x) => a + x, 0) === period;
}

/** { script, fixed } — the parts' minutes filled and scaled to exactly `period`. No period, nothing changes. */
function fitMinutes(script, period) {
  const s = script || {};
  if (!(Number.isInteger(period) && period >= SECTIONS.length) || SECTIONS.some((k) => !s[k] || typeof s[k] !== 'object') || fits(s, period)) {
    return { script, fixed: false };
  }
  const share = { hook: 0.1, iDo: 0.2, weDo: 0.3, youDo: 0.3, wrap: 0.1 };
  const w = {};
  SECTIONS.forEach((k) => { w[k] = minutesOf(s[k].minutes) || period * share[k]; });
  const total = SECTIONS.reduce((a, k) => a + w[k], 0);
  const x = {};
  SECTIONS.forEach((k) => { x[k] = (w[k] * period) / total; });
  // the opening and the check stay small; what they give up goes to I Do / We Do / You Do in proportion
  const small = Math.max(1, Math.round(period * SMALL));
  let spare = 0;
  ['hook', 'wrap'].forEach((k) => { if (x[k] > small) { spare += x[k] - small; x[k] = small; } });
  const mid = MIDDLE.reduce((a, k) => a + x[k], 0);
  MIDDLE.forEach((k) => { x[k] += (spare * x[k]) / mid; });
  // whole minutes, each at least 1, then the remainder by largest fraction (I Do / We Do / You Do first)
  const n = {};
  SECTIONS.forEach((k) => { n[k] = Math.max(1, Math.floor(x[k])); });
  let diff = period - SECTIONS.reduce((a, k) => a + n[k], 0);
  const order = [...MIDDLE, 'hook', 'wrap'].sort((a, b) => (x[b] - Math.floor(x[b])) - (x[a] - Math.floor(x[a])));
  for (let i = 0; diff > 0; i++) {
    const k = order[i % order.length];
    if ((k === 'hook' || k === 'wrap') && n[k] >= small) continue;
    n[k] += 1; diff -= 1;
  }
  while (diff < 0) {
    const k = [...SECTIONS].sort((a, b) => n[b] - n[a])[0];
    n[k] -= 1; diff += 1;
  }
  const out = clone(s);
  SECTIONS.forEach((k) => { out[k].minutes = n[k]; });
  return { script: out, fixed: true };
}

/** { script, trimmed } — each capped list cut to her class size, from the end, never a picture. */
function trimToLoad(script, size) {
  const c = P.LOAD[size];
  if (!c || !script) return { script, trimmed: [] };
  const caps = [
    ['hook', 'steps', c.steps], ['hook', 'conversation', c.checks], ['iDo', 'steps', P.IDO_STEPS], ['weDo', 'steps', c.steps],
    ['youDo', 'steps', c.steps], ['youDo', 'problems', c.problems], ['wrap', 'exitOptions', c.checks], ['wrap', 'homework', c.homework],
  ];
  const over = caps.filter(([k, f, max]) => script[k] && Array.isArray(script[k][f]) && script[k][f].length > max);
  if (!over.length) return { script, trimmed: [] };
  const out = clone(script);
  const trimmed = [];
  over.forEach(([k, f, max]) => {
    const list = out[k][f];
    const was = list.length;
    for (let i = list.length - 1; i >= 0 && list.length > max; i--) {
      const item = list[i];
      const kept = item && typeof item === 'object' && Object.keys(item).some((key) => KEEP.test(key));
      if (!kept) list.splice(i, 1);
    }
    if (list.length < was) trimmed.push(`${k}.${f} ${was}→${list.length}`);
  });
  return { script: out, trimmed };
}

/** A make is measured in the words she reads; a change keeps the JSON measure it always had. */
const lengthOf = (o, make) => (make ? strings(o).join('').length : JSON.stringify(o).length);

/**
 * The soft fixes in one pass. `size` given = a make (minutes, caps, 1x length); absent = a change (1.3x length only).
 * @returns {{ script: object, fixes: string[], warnings: string[] }}
 */
function fitK5(orig, next, { size, period } = {}) {
  const make = Boolean(P.LOAD[size]);
  let script = next;
  const fixes = [];
  if (make) {
    const m = fitMinutes(script, period);
    if (m.fixed) { script = m.script; fixes.push(`minutes set to fill the ${period}-minute period`); }
    const t = trimToLoad(script, size);
    if (t.trimmed.length) { script = t.script; fixes.push(...t.trimmed.map((x) => `trimmed ${x}`)); }
  }
  const warnings = [];
  const was = lengthOf(orig, make);
  const now = lengthOf(script, make);
  if (was && now > was * (make ? MAKE_GROWTH : EDIT_GROWTH)) {
    warnings.push(`longer than her day plan (${Math.round((now / was) * 100)}%)`);
  }
  return { script, fixes, warnings };
}

/** Reasons worth one repair round but never a final refusal: a per-child teacher check in a class over 30. */
function repairOnly(script, size) {
  if (!P.LOAD[size] || size === 'up30') return [];
  const one = P.perChildChecks(script)[0];
  return one ? [`a teacher check on each child ("${one.slice(0, 60)}"): in a big class check the whole class at once (choral, fingers, books up)`] : [];
}

module.exports = { fitMinutes, trimToLoad, fitK5, repairOnly, MAKE_GROWTH, EDIT_GROWTH, SMALL };
