'use strict';
/**
 * bd-5jmnfj.38.31 (a8) — the thinking-level split of a G6-12 free paper, by marks: 30% Remember, 30%
 * Understand, 20% Apply, 10% Analyze/Evaluate, 10% Create (panel A6b). Pure: no I/O.
 *
 *   plan(types, light)   before writing: a level for every item and part, so that the planned marks land
 *                        within 5 points of the split, with Create on a written item (never an MCQ)
 *   planText(units)      the plan as the writer reads it: "MCQ 1: Understand", "Extended answer 1: (a) …"
 *   paperSplit(exam)     after writing: the split read from the tags (part_levels per part, else blooms)
 *   levelIssues(exam)    a split more than 10 points off, or no Create on a paper with written items, sends
 *                        the items to move to the rewrite, each told the level to write it (or a part) at
 */

const { items } = require('./free-secondary-checks');

const LEVELS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const BUCKETS = ['R', 'U', 'A', 'AE', 'C'];
const SHARE = { R: 0.3, U: 0.3, A: 0.2, AE: 0.1, C: 0.1 };
const NAME = { R: 'Remember', U: 'Understand', A: 'Apply', AE: 'Analyze', C: 'Create' };
const PLAN_TOL = 0.05;
const REWRITE_TOL = 0.1;
const LABEL = { mcq: 'MCQ', srq: 'Short answer', erq: 'Extended answer', grammar: 'Grammar' };
const PART_LINE = /^\s*\(?([a-f]|i{1,3}|iv|الف|ب|ج|د)\)\s*(.*)$/;
const PART_MARKS = /\((\d+)\s*(?:marks?|نمبر)\)/i;

function bucketOf(level) {
  const l = String(level || '').trim().toLowerCase();
  if (l === 'remember') return 'R';
  if (l === 'understand') return 'U';
  if (l === 'apply') return 'A';
  if (l === 'analyze' || l === 'analyse' || l === 'evaluate') return 'AE';
  if (l === 'create') return 'C';
  return null;
}

const isObjective = (t) => t.category === 'objective' || t.id === 'mcq';

/** Integer marks per bucket, by largest remainder; ties go R, U, A, AE, C. */
function targets(total) {
  const raw = BUCKETS.map((b) => total * SHARE[b]);
  const out = Object.fromEntries(BUCKETS.map((b, i) => [b, Math.floor(raw[i])]));
  let left = total - BUCKETS.reduce((s, b) => s + out[b], 0);
  const order = BUCKETS.map((b, i) => [b, raw[i] - Math.floor(raw[i]), i]).sort((x, y) => y[1] - x[1] || x[2] - y[2]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left -= 1) out[order[i][0]] += 1;
  return out;
}

/** The units a planned paper prints: one per item, an extended answer in three parts. */
function unitsOf(types, light) {
  const out = [];
  types.forEach((t) => {
    for (let i = 0; i < (Number(t.count) || 0); i += 1) {
      if (isObjective(t)) out.push({ type: t.id, idx: i, marks: 1, mcq: true });
      else if (t.id === 'erq') [0, 1, 2].forEach((part) => out.push({ type: t.id, idx: i, part, marks: light ? 1 : 2 }));
      else out.push({ type: t.id, idx: i, marks: light ? 2 : 3 });
    }
  });
  return out;
}

function fill(cands, target) {
  let cur = 0;
  cands.forEach((u) => { if (!u.level && cur + u.marks <= target) { u.picked = true; cur += u.marks; } });
  if (cur < target) {
    const extra = cands.filter((u) => !u.picked && !u.level).sort((x, y) => x.marks - y.marks)
      .find((u) => Math.abs(cur + u.marks - target) < Math.abs(cur - target));
    if (extra) { extra.picked = true; cur += extra.marks; }
  }
  return cands.filter((u) => u.picked);
}

/** A level for every planned unit. Highest buckets first, from the end of each section. */
function plan(types, light) {
  const units = unitsOf(types, light);
  const goal = targets(units.reduce((s, u) => s + u.marks, 0));
  const free = (u) => !u.level;
  const written = units.filter((u) => !u.mcq && u.part === undefined).reverse();
  const mcqs = units.filter((u) => u.mcq).reverse();
  const erqPart = (k) => units.filter((u) => u.part === k);
  [['C', 2, false], ['AE', 1, true], ['A', 0, true]].forEach(([b, k, mcqOk]) => {
    // A Create part is a small "design / suggest a way": a short answer takes it before a grammar item.
    const ws = b === 'C' ? [...written.filter((u) => u.type !== 'grammar'), ...written.filter((u) => u.type === 'grammar')] : written;
    const cands = [...erqPart(k), ...ws, ...(mcqOk ? mcqs : [])].filter(free);
    fill(cands, goal[b]).forEach((u) => { u.level = NAME[b]; delete u.picked; });
  });
  const restM = units.filter((u) => u.mcq && free(u));
  const restW = units.filter((u) => !u.mcq && free(u));
  const mixed = [];
  for (let i = 0; i < Math.max(restM.length, restW.length); i += 1) {
    if (restM[i]) mixed.push(restM[i]);
    if (restW[i]) mixed.push(restW[i]);
  }
  fill(mixed, goal.U).forEach((u) => { u.level = NAME.U; delete u.picked; });
  units.filter(free).forEach((u) => { u.level = NAME.R; });
  return units.map(({ picked, ...u }) => u);
}

function splitOf(units) {
  const total = units.reduce((s, u) => s + u.marks, 0) || 1;
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  units.forEach((u) => { const b = bucketOf(u.level); if (b) out[b] += u.marks / total; });
  return out;
}

/** The plan as the writer reads it. MCQs asked for beyond the plan (the pool) cycle the MCQ levels. */
function planText(units, opts = {}) {
  const lines = [];
  const seen = new Map();
  units.forEach((u) => {
    const key = `${u.type}:${u.idx}`;
    if (!seen.has(key)) { seen.set(key, []); lines.push(key); }
    seen.get(key).push(u);
  });
  const text = lines.map((key) => {
    const us = seen.get(key);
    const name = `${LABEL[us[0].type] || us[0].type} ${us[0].idx + 1}`;
    if (us[0].part === undefined) return `${name}: ${us[0].level}`;
    return `${name}: ${us.map((u) => `(${'abcdef'[u.part]}) ${u.level}`).join(', ')}`;
  });
  const mcqLevels = units.filter((u) => u.mcq).map((u) => u.level);
  for (let i = 0; i < (opts.extraMcqs || 0) && mcqLevels.length; i += 1) {
    text.push(`MCQ ${mcqLevels.length + i + 1}: ${mcqLevels[i % mcqLevels.length]}`);
  }
  return text.join('\n');
}

/** The units of a written paper: an item in labelled parts gives one unit per part. */
function paperUnits(examJson) {
  const out = [];
  items(examJson).forEach(({ n, item, isMcq }) => {
    const marks = Number(item.marks) || 1;
    const lines = String(item.question || '').split('\n').map((l) => l.match(PART_LINE)).filter(Boolean);
    const levels = Array.isArray(item.part_levels) ? item.part_levels : [];
    if (!isMcq && lines.length >= 2) {
      lines.forEach((m, i) => {
        const own = m[2].match(PART_MARKS);
        out.push({ n, item, part: i, label: m[1], last: i === lines.length - 1, mcq: false,
          marks: own ? Number(own[1]) : marks / lines.length, level: levels[i] || item.blooms });
      });
    } else out.push({ n, item, mcq: isMcq, marks, level: item.blooms });
  });
  return out;
}

const paperSplit = (examJson) => splitOf(paperUnits(examJson));

/** Moves that bring a written paper's tags back to the split; none when it is close and has a Create. */
function levelIssues(examJson) {
  const units = paperUnits(examJson);
  const total = units.reduce((s, u) => s + u.marks, 0);
  if (!total) return [];
  const goal = targets(total);
  const cur = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  units.forEach((u) => { u.bucket = bucketOf(u.level); if (u.bucket) cur[u.bucket] += u.marks; });
  if (!units.some((u) => u.bucket)) return [];
  const hasWritten = units.some((u) => !u.mcq);
  const off = (tol) => BUCKETS.some((b) => Math.abs(cur[b] - goal[b]) / total > tol);
  if (!off(REWRITE_TOL) && !(hasWritten && cur.C === 0)) return [];
  const surplus = (u) => (u.bucket ? cur[u.bucket] - goal[u.bucket] : u.marks);
  const move = (u, b) => { if (u.bucket) cur[u.bucket] -= u.marks; cur[b] += u.marks; u.to = b; };
  const error = () => BUCKETS.reduce((s, b) => s + Math.abs(cur[b] - goal[b]), 0);
  if (hasWritten && cur.C === 0) {
    const pick = units.filter((u) => !u.mcq).sort((x, y) => Number(!!y.last) - Number(!!x.last)
      || surplus(y) - surplus(x) || x.marks - y.marks)[0];
    move(pick, 'C');
  }
  for (let guard = 0; off(PLAN_TOL) && guard < units.length; guard += 1) {
    const deficits = BUCKETS.filter((b) => cur[b] < goal[b]).sort((x, y) => (goal[y] - cur[y]) - (goal[x] - cur[x]));
    let moved = false;
    for (const d of deficits) {
      const need = goal[d] - cur[d];
      const cands = units.filter((u) => !u.to && u.bucket !== d && surplus(u) > 0 && !(d === 'C' && u.mcq))
        .sort((x, y) => surplus(y) - surplus(x) || Math.abs(x.marks - need) - Math.abs(y.marks - need));
      for (const u of cands) {
        const before = error();
        const from = u.bucket;
        move(u, d);
        if (error() < before) { moved = true; break; }
        cur[d] -= u.marks; if (from) cur[from] += u.marks; delete u.to;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  const byN = new Map();
  units.filter((u) => u.to).forEach((u) => {
    if (!byN.has(u.n)) byN.set(u.n, []);
    byN.get(u.n).push(u);
  });
  return [...byN.entries()].map(([n, us]) => ({ n, check: 'level-split', text: `${us.map((u) => (u.part === undefined
    ? `write it at ${NAME[u.to]}; it is tagged ${u.level || 'with no level'}`
    : `write part (${u.label}) at ${NAME[u.to]}; it is tagged ${u.level || 'with no level'}`)).join('; ')}. The paper's thinking levels are off the 30/30/20/10/10 split of marks: rewrite the item so it really asks for that level and tag it so; a book activity or worked example reproduced counts as Remember.` }));
}

module.exports = { LEVELS, plan, planText, splitOf, paperSplit, levelIssues, itemsOf: items, targets };
