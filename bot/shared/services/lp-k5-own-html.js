'use strict';
/**
 * bd-snkn32.12 — a grades 1–5 v9/v10 day read IN FULL, as the slide script Make my own rewrites and prints
 * (lp-k5-own.js, lp-k5-own-render.js). Pure: HTML in, script out.
 *
 * KNOWN DESIGN DEBT: there is no table for a grades 1–5 day's full plan. The v9/v10 day IS its authored HTML (stored
 * on R2 per exact served version, `niete_lp_asset_sources.source_url`); the row's own slide_script is the QUIZ digest
 * (lp-v9-html-source.toSlideScript), which keeps only what a quiz needs: no Opening, no We Do, no I-Do steps. Make my
 * own started from that digest printed an "I Do" and a mistake and nothing else. This reads the same document again,
 * all of it, rather than storing a second copy.
 *
 * The parts come from each section bar's own class, because We Do and You Do share data-sec="activity":
 * s-i Opening → hook · s-d Explanation/I Do → iDo · s-we We Do → weDo · s-a You Do → youDo · s-c Check and
 * s-h Homework → wrap. A "continued" bar on a new page adds to the part it continues. Never carried: the coaching
 * corner (its offer names a contact), the page footer, diagrams (svg). The outcome and meta come from the digest
 * reader, so both agree on what the day is.
 */
const { parse, toSlideScript } = require('./quiz/lp-v9-html-source');

const BIDI = /[⁦-⁩‎‏‪-‮]/g;
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Labels and furniture inside a block: never part of what the teacher says or does. */
const SKIP = ['a', 'lbl', 'cl', 'mvt', 'dct', 'tag', 'kind', 'rp', 'n', 'al', 'arow'];
const PART = { 's-i': 'hook', 's-d': 'iDo', 's-we': 'weDo', 's-a': 'youDo', 's-c': 'check', 's-h': 'homework' };

const clean = (s) => String(s || '').replace(BIDI, '').replace(/\s+/g, ' ').trim();
const isEl = (n) => n && typeof n === 'object';
const has = (n, c) => isEl(n) && n.cls.has(c);
function raw(n, skip = SKIP) {
  if (typeof n === 'string') return n;
  if (!isEl(n) || n.tag === 'svg' || skip.some((c) => n.cls.has(c))) return '';
  return n.children.map((c) => raw(c, skip)).join(' ');
}
const text = (n, skip) => clean(raw(n, skip));
function all(n, pred, out = []) {
  if (!isEl(n)) return out;
  if (pred(n)) out.push(n);
  n.children.forEach((c) => all(c, pred, out));
  return out;
}
const cls = (n, c) => all(n, (x) => x.cls.has(c));
const one = (n, c) => cls(n, c)[0] || null;
const answer = (n) => clean(cls(n, 'a').map((a) => raw(a, [])).join(' ')).replace(/^→\s*/, '');
const minutesOf = (bar) => Number(clean(text(one(bar, 'mins'), [])).replace(/[۰-۹]/g, (d) => URDU_DIGITS.indexOf(d)).match(/\d+/)) || null;

/** The blocks under each part, in document order: { hook: {minutes, nodes[]}, … }. */
function parts(root) {
  const out = {};
  let cur = null;
  const walk = (n) => {
    if (!isEl(n) || has(n, 'coach') || has(n, 'foot') || n.tag === 'svg') return;
    if (has(n, 'bar')) {
      const key = Object.keys(PART).find((c) => n.cls.has(c));
      cur = key ? (out[PART[key]] = out[PART[key]] || { minutes: null, nodes: [] }) : null;
      if (cur && !has(n, 'cont') && cur.minutes == null) cur.minutes = minutesOf(n);
      return;
    }
    if (cur && (has(n, 'blk') || has(n, 'grid3') || n.tag === 'figure')) { cur.nodes.push(n); return; }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** One script turn: a "do" is an action; say/ask/calc/frame are said; a routine is its name and its steps. */
function turn(tn) {
  if (has(tn, 'k-routine')) {
    const steps = all(tn, (x) => x.tag === 'li').map((li) => text(li)).filter(Boolean);
    const name = text(one(tn, 'rn'), []);
    const t = [name, steps.join(' ')].filter(Boolean).join(': ');
    return t ? { action: t } : null;
  }
  const t = text(one(tn, 'tx') || tn);
  if (!t) return null;
  return has(tn, 'k-do') ? { action: t } : { say: t };
}

const numbered = (xs) => xs.filter(Boolean).map((x, i) => ({ n: i + 1, ...x }));
const listOf = (n) => all(n, (x) => x.tag === 'li').map((li) => text(li)).filter(Boolean);

/** What one part's blocks hold, read the same way for every part. */
function read(nodes) {
  const r = { steps: [], lines: [], setup: [], cfu: null, mis: null, problems: [], ask: null, behind: null, ahead: null, warm: [], hooks: [], exit: [], reteach: null };
  for (const n of nodes) {
    if (n.tag === 'figure') continue;
    if (has(n, 'wu')) {
      r.warm.push(...cls(n, 'it').map((it) => ({ teacherAsks: text(one(it, 'q')), expectedAnswer: answer(it) })).filter((w) => w.teacherAsks));
    } else if (has(n, 'hook')) {
      r.hooks.push(...cls(n, 'q').map((q) => text(q)).filter(Boolean));
      r.lines.push(...listOf(n));
    } else if (has(n, 'exit')) {
      r.exit.push(...cls(n, 'it').map((it) => ({ prompt: text(it).replace(/^[\d۰-۹]+[.)]\s*/, ''), answer: answer(it) })).filter((o) => o.prompt));
    } else if (has(n, 'reteach')) {
      r.reteach = text(one(n, 't') || n) || r.reteach;
    } else if (has(n, 'askb')) {
      r.ask = text(one(n, 'q')) || r.ask;
    } else if (has(n, 'pr')) {
      r.problems.push(...cls(n, 'it').map((it) => ({ prompt: text(one(it, 'q')), answer: answer(it) })).filter((p) => p.prompt));
    } else if (cls(n, 'card').length) {
      for (const card of cls(n, 'card')) {
        const label = text(one(card, 'lbl'), []);
        const body = listOf(card).join(' ') || text(card);
        if (/stuck|struggl|اٹک|مشکل/i.test(label)) r.behind = { prompt: body };
        else if (/early|finish|فارغ|مزید/i.test(label)) r.ahead = { prompt: body };
      }
    } else if (cls(n, 'mis').length) {
      const mis = one(n, 'mis');
      r.mis = r.mis || { slip: text(one(mis, 'x')), fix: text(one(mis, 'v')) };
    } else if (cls(n, 'tn').length) {
      r.setup.push(...all(n, (x) => has(x, 'setup')).flatMap(listOf));
      r.steps.push(...cls(n, 'tn').map(turn));
    } else {
      r.lines.push(...listOf(n));
    }
    if (!r.cfu) r.cfu = text(one(n, 'cfu')) || null;
  }
  return r;
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const actions = (lines) => lines.map((action) => ({ action }));

/**
 * @param {string} html the day's authored document (the exact served version)
 * @param {{lessonId:string}} key
 * @returns {object} the slide script: meta, goal, sloFull, sloCode, hook, iDo, weDo, youDo, wrap
 */
function toK5Script(html, { lessonId } = {}) {
  const doc = String(html || '');
  const digest = toSlideScript(doc, { lessonId });
  const root = parse(doc);
  const p = parts(root);
  const r = (k) => read((p[k] && p[k].nodes) || []);
  const mins = (k) => (p[k] && p[k].minutes) || null;
  const [h, i, w, y, c, hw] = ['hook', 'iDo', 'weDo', 'youDo', 'check', 'homework'].map(r);

  const keyWords = cls(root, 'kr').map((kr) => ({ term: text(all(kr, (x) => x.tag === 'b')[0] || kr, []), def: clean(kr.children.filter((x) => !isEl(x) || x.tag !== 'b').map((x) => raw(x)).join(' ')) }))
    .filter((k) => k.term);
  const board = cls(root, 'board').flatMap((b) => cls(b, 'bp').map((bp) => cls(bp, 'bb').map((bb) => bb.children.filter(isEl).map((x) => text(x)).filter(Boolean).join(' · ')).join(' ')))
    .filter(Boolean);
  const materials = cls(root, 'mi').map((m) => text(m)).filter(Boolean);

  const [warmUp, ...moreWarm] = h.warm;
  return {
    meta: digest.meta,
    goal: digest.goal,
    sloFull: digest.sloFull,
    sloCode: digest.sloCode,
    hook: compact({
      minutes: mins('hook'),
      warmUp: warmUp || null,
      conversation: [...moreWarm.map((x) => ({ teacherAsks: x.teacherAsks })), ...h.hooks.map((q) => ({ teacherAsks: q }))],
      steps: numbered([...h.steps, ...actions(h.lines)]),
      keyWords,
      board: board.length ? { content: board.join('\n') } : null,
      materials,
    }),
    iDo: compact({
      minutes: mins('iDo'),
      steps: numbered([...i.steps, ...actions(i.lines)]),
      worked: digest.iDo.worked,
      cfu: i.cfu,
      misconception: i.mis,
    }),
    weDo: compact({
      minutes: mins('weDo'),
      strategy: w.setup.join(' ') || null,
      steps: numbered([...w.steps, ...actions(w.lines)]),
      cfu: w.cfu || w.ask,
    }),
    youDo: compact({
      minutes: mins('youDo'),
      steps: numbered([...y.steps, ...actions(y.lines)]),
      problems: y.problems.map((x, n) => ({ n: n + 1, prompt: x.prompt, ...(x.answer ? { answer: x.answer } : {}) })),
      cfu: y.ask || y.cfu,
      behind: y.behind,
      ahead: y.ahead,
    }),
    wrap: compact({
      minutes: mins('check'),
      exitOptions: c.exit.map((x) => ({ prompt: x.prompt, ...(x.answer ? { answer: x.answer } : {}) })),
      reteach: [c.reteach, ...c.lines].filter(Boolean).join(' ') || null,
      homework: [...hw.lines, ...hw.steps.map((s) => s && (s.action || s.say))].filter(Boolean),
    }),
  };
}

module.exports = { toK5Script };
