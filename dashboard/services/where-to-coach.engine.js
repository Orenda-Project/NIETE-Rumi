'use strict';
/**
 * WHERE TO COACH — Rifat's "DC pattern engine" (bd-17v39c.4.14.1).
 *
 * Source: her School Card Spec (28 Oct 2026, rev 18), section "DC pattern engine: from scores to coaching suggestions",
 * https://claude.ai/artifact/EdtxjjD313c3XVKWDAuvmr . Her five steps, as built here:
 *
 *   1 Collect          the teacher's DC reports and reviewed coach (HITL) observations in the period. 2+ DC: patterns
 *                      as normal; 1 DC: "an early signal"; none: the coach observations alone, or empty.
 *   2 Score each       per practice, across the DC reports: the average; k of n, the sessions where it scored "low"
 *     practice         (2 or less of 4); the latest score; the change (latest minus the first in the period).
 *   3 Find patterns    per section, DC % and coach % (averaged over the reports); "agree low" when both are under 60%;
 *                      "AI and coach differ" when they are 18 points or more apart.
 *   4 Rank and pick    the focus rule: 1 its section is agree low · 2 highest share of low sessions (k ÷ n) · 3 linked
 *                      to a lesson-plan step she skipped · 4 lowest average · tie D, C, B, F, then the lower code
 *                      number. Tests 1–2 need at least 2 scored sessions. Weakest = the focus, then the two
 *                      next-lowest averages. Strength = the highest average (3 or more of 4) in another section.
 *   5 Look up          the suggestions, by the focus practice's code: the content library (where-to-coach.library.js).
 *
 * A pure function of the stored scores and the settings (dashboard/data/where-to-coach/settings.json), as she asks: no
 * database, no clock, no AI call. The same inputs always give the same answer.
 *
 * WHERE OURS. Each is marked "ours" below and in the settings file:
 *   - every cut is a share of the report's own scale (low ≤ 0.5, strength ≥ 0.75), so her 1–4 numbers hold on FICO v3
 *     (production, 1–4) and FICO v4 (sandbox, 0–2) alike; the stored scale says which FICO a report was scored on;
 *   - a period that spans the v3 → v4 cutover uses only the reports on the newest report's scale (practice ids mean
 *     different things on each);
 *   - section B is the plan steps (lp_fidelity), never B1–B10 (the operator's 30 Oct decision, live since), so B has no
 *     practices to rank; a section % is the stored domain_score ÷ domain_max, as the DC report shows it;
 *   - test 3's step links are re-keyed to the live plan steps and practice ids (settings.stepLinks);
 *   - "Focus here" marks the focus practice's section (hers: "the weakest"; the two are the same in her example).
 *
 * WHO TO COACH FIRST (ours: her spec has no rule for ranking teachers). coachFirstGroupOf puts a teacher in the first
 * group that fits, by which of her tests fired: agree_low (test 1) · low_most (the focus is low in at least half of
 * 2+ DC sessions, test 2) · no_dc · one_dc (her early signal) · none.
 */

const DEFAULT_SETTINGS = require('../data/where-to-coach/settings.json');
// Pure (no requires): the report card's five plan steps (Opening, Explanation, We Do, You Do, Check).
const { stepOf } = require('../../bot/shared/services/coaching/report-card');

/** The four FICO sections in framework order (coach-school-card.service SECTIONS). */
const SECTIONS = Object.freeze([
  { code: 'B', key: 'lesson_plan_fidelity' },
  { code: 'C', key: 'high_leverage_practices' },
  { code: 'D', key: 'student_engagement' },
  { code: 'F', key: 'teacher_subject_knowledge' },
]);
const RANKED = Object.freeze(['C', 'D', 'F']); // B is the plan steps: no practices to rank

const COACH_FIRST_GROUPS = Object.freeze(['agree_low', 'low_most', 'no_dc', 'one_dc', 'none']);

const EPS = 1e-9;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const tenths = (x) => Math.round(x * 10) / 10;
const meanOf = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const codeNumber = (id) => { const m = /(\d+)\s*$/.exec(String(id || '')); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id || '').localeCompare(String(b.id || ''));

/** A plan step's verdict, as the School card and the report page read it: done | partly | skipped | null. */
function verdictOf(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['executed', 'substituted_equivalent', 'substituted_better', 'done'].includes(v)) return 'done';
  if (['not_done', 'skipped'].includes(v)) return 'skipped';
  if (['partial', 'partly'].includes(v)) return 'partly';
  return null;
}

/** A section's scale: its stored maximum over the practices it scored (domain_max ÷ indicators_applicable). */
function scaleOfDomain(d) {
  const max = num(d && d.domain_max);
  const n = num(d && d.indicators_applicable);
  return max && n && n > 0 && Number.isInteger(max / n) ? max / n : null;
}

/** One stored report, read once: its scale, each practice's score, each section's %, and its measured plan. */
function readReport(r, fallbackScale) {
  const domains = r && r.domains && typeof r.domains === 'object' ? r.domains : {};
  let scaleMax = null;
  for (const { key } of SECTIONS) { scaleMax = scaleMax || scaleOfDomain(domains[key]); }
  scaleMax = scaleMax || num(fallbackScale);
  const practices = [];
  const sections = {};
  for (const { code, key } of SECTIONS) {
    const d = domains[key];
    if (!d || typeof d !== 'object') continue;
    if (code !== 'B') {
      const score = num(d.domain_score);
      const max = num(d.domain_max);
      if (d.assessed !== false && d.assessed !== 'false' && score != null && max && max > 0) sections[code] = (score / max) * 100;
      if (!scaleMax) continue;
      for (const i of Array.isArray(d.indicators) ? d.indicators : []) {
        const id = i && (text(i.id) || text(i.code));
        const s = i && i.applicable !== false ? num(i.score) : null;
        if (!id || s == null) continue;
        practices.push({ id, section: code, name: text(i.name), score: s, share: Math.max(0, Math.min(1, s / scaleMax)) });
      }
    }
  }
  const lp = r && r.lp_fidelity;
  const planPct = lp && lp.status === 'ok' ? num(lp.fidelity_pct) : null;
  const plan = planPct == null ? null : { pct: planPct, moves: Array.isArray(lp.moves) ? lp.moves.filter(Boolean) : [] };
  if (plan) sections.B = planPct;
  return { id: r && r.id, date: r && r.date, scaleMax, practices, sections, plan };
}

/** Step 2: every practice the source reports scored, with her numbers. */
function practiceStats(reports, settings, scaleMax) {
  const acc = new Map();
  for (const rep of reports) {
    for (const p of rep.practices) {
      if (!RANKED.includes(p.section)) continue;
      if (!acc.has(p.id)) acc.set(p.id, { id: p.id, section: p.section, name: p.name, scores: [], shares: [] });
      const e = acc.get(p.id);
      e.scores.push(p.score);
      e.shares.push(p.share);
      if (p.name) e.name = p.name;
    }
  }
  return [...acc.values()].map((e) => {
    const n = e.shares.length;
    const k = e.shares.filter((s) => s <= settings.lowShareOfScale + EPS).length;
    const avgShare = meanOf(e.shares);
    const latest = e.scores[n - 1];
    return {
      id: e.id, section: e.section, name: e.name,
      n, k, share: n ? k / n : 0,
      avg: tenths(avgShare * scaleMax), avgShare, scaleMax,
      latest, change: n >= 2 ? latest - e.scores[0] : null,
    };
  });
}

/** Step 3: each section's DC % and coach %, and her two flags. Weakest first (by DC %, else coach %). */
function sectionPatterns(dcReports, coachReports, settings) {
  const pctOf = (reports, code) => {
    const v = reports.map((r) => r.sections[code]).filter((x) => typeof x === 'number');
    return v.length ? Math.round(meanOf(v)) : null;
  };
  const tie = (code) => settings.tieOrder.indexOf(code);
  return SECTIONS.map(({ code }) => {
    const dc = pctOf(dcReports, code);
    const coach = pctOf(coachReports, code);
    if (dc == null && coach == null) return null;
    const both = dc != null && coach != null;
    return {
      code, dc, coach,
      agreeLow: both && dc < settings.agreeLowBelowPct && coach < settings.agreeLowBelowPct,
      differ: both && Math.abs(dc - coach) >= settings.differPoints,
    };
  }).filter(Boolean).sort((a, b) => {
    const x = a.dc != null ? a.dc : a.coach;
    const y = b.dc != null ? b.dc : b.coach;
    return x - y || tie(a.code) - tie(b.code);
  });
}

/** The plan block: the mean share of steps followed over the DC reports that measured one; steps skipped most often. */
function planOf(reports) {
  const plans = reports.filter((r) => r.plan);
  if (!plans.length) return null;
  const steps = new Map();
  for (const p of plans) {
    const seen = new Map();
    for (const m of p.plan.moves) {
      const step = stepOf(m.phase);
      const v = verdictOf(m.verdict);
      if (!step || !v) continue;
      // A step counts once per plan: skipped when any of its moves was skipped.
      seen.set(step.index, { step, skipped: (seen.get(step.index) || {}).skipped || v === 'skipped' });
    }
    for (const [index, s] of seen) {
      if (!steps.has(index)) steps.set(index, { step: s.step.name, index, skipped: 0, of: 0 });
      const e = steps.get(index);
      e.of += 1;
      if (s.skipped) e.skipped += 1;
    }
  }
  return {
    pct: Math.round(meanOf(plans.map((p) => p.plan.pct))),
    measured: plans.length,
    of: reports.length,
    skipped: [...steps.values()].filter((s) => s.skipped > 0).sort((a, b) => b.skipped - a.skipped || a.index - b.index),
  };
}

/**
 * GET WHERE TO COACH for one teacher.
 * @param {{dc: Array, coach: Array}} input her DC reports and her reviewed FICO-form coach observations in the period,
 *   each { id, date (YYYY-MM-DD), domains (analysis_data.domains), lp_fidelity (analysis_data.lp_fidelity) }
 * @param {object} [settings] the settings table (default: dashboard/data/where-to-coach/settings.json)
 * @param {{scaleMax?: number}} [opts] the deployed framework's scale, for a report that does not store its own
 */
function whereToCoach(input = {}, settings = DEFAULT_SETTINGS, opts = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const read = (list) => (Array.isArray(list) ? list : []).filter(Boolean).map((r) => readReport(r, opts.scaleMax))
    .filter((r) => r.scaleMax).sort(byDate);
  let dcAll = read(input.dc);
  let coachAll = read(input.coach);
  // Ours: one scale per period, the newest report's.
  const newest = [...dcAll, ...coachAll].sort(byDate).pop();
  const scaleMax = newest ? newest.scaleMax : null;
  dcAll = dcAll.filter((r) => r.scaleMax === scaleMax);
  coachAll = coachAll.filter((r) => r.scaleMax === scaleMax);
  const framework = scaleMax ? (s.frameworkByScale[String(scaleMax)] || null) : null;
  const sessions = { dc: dcAll.length, coach: coachAll.length };
  const signal = sessions.dc >= s.minSessions ? 'patterns' : sessions.dc === 1 ? 'early' : sessions.coach ? 'coach_only' : 'empty';
  const empty = { framework, scaleMax, sessions, signal, sections: [], practices: [], focus: null, weakest: [], strength: null, plan: null };
  if (signal === 'empty') return empty;

  // Step 1: the DC reports, or the coach observations alone when she has no DC.
  const sourceKind = sessions.dc ? 'dc' : 'coach';
  const source = sessions.dc ? dcAll : coachAll;
  const practices = practiceStats(source, s, scaleMax);
  const sections = sectionPatterns(dcAll, coachAll, s);
  const plan = planOf(dcAll);
  if (!practices.length) return { ...empty, sections, plan };

  // Step 4: her focus rule, as her pseudocode's sort key (descending), then her tie order.
  const agreeLow = new Set(sections.filter((x) => x.agreeLow).map((x) => x.code));
  const links = (s.stepLinks && s.stepLinks[framework]) || {};
  const skippedSteps = plan ? plan.skipped : [];
  const linkedStepOf = (id) => (skippedSteps.find((st) => (links[st.step] || []).includes(id)) || {}).step || null;
  const tie = (p) => s.tieOrder.indexOf(p.section);
  const keyOf = (p) => ({
    t1: sourceKind === 'dc' && agreeLow.has(p.section) && p.n >= s.minSessions,
    t2: p.n >= s.minSessions ? p.share : 0,
    t3: !!linkedStepOf(p.id),
  });
  const ranked = practices.map((p) => ({ ...p, rank: keyOf(p) })).sort((a, b) => (
    (Number(b.rank.t1) - Number(a.rank.t1))
    || (b.rank.t2 - a.rank.t2)
    || (Number(b.rank.t3) - Number(a.rank.t3))
    || (a.avgShare - b.avgShare)
    || (tie(a) - tie(b))
    || (codeNumber(a.id) - codeNumber(b.id))
  ));
  const top = ranked[0];
  // The why line names the first of her tests that holds for the focus.
  const why = top.rank.t1 ? { test: 1, reason: 'both' }
    : top.rank.t2 > 0 ? { test: 2, reason: 'low', k: top.k, n: top.n, source: sourceKind }
      : top.rank.t3 ? { test: 3, reason: 'step', step: linkedStepOf(top.id) }
        : { test: 4, reason: 'lowest' };
  const clean = ({ rank, ...p }) => p;
  const focus = { ...clean(top), why, linkedStep: linkedStepOf(top.id) };

  // Weakest: the focus, then the two next-lowest averages.
  const byAvg = (a, b) => (a.avgShare - b.avgShare) || (tie(a) - tie(b)) || (codeNumber(a.id) - codeNumber(b.id));
  const rest = practices.filter((p) => p.id !== focus.id).sort(byAvg);
  const weakest = [{ ...clean(top), focus: true }, ...rest.slice(0, 2).map((p) => ({ ...p, focus: false }))];

  // Strength: the highest average of 3 or more (of 4) in a section other than the focus's.
  const strength = practices
    .filter((p) => p.section !== focus.section && p.avgShare >= s.strengthShareOfScale - EPS)
    .sort((a, b) => (b.avgShare - a.avgShare) || (b.n - a.n) || (tie(a) - tie(b)) || (codeNumber(a.id) - codeNumber(b.id)))[0] || null;

  return {
    framework, scaleMax, sessions, signal,
    sections: sections.map((x) => ({ ...x, focusHere: x.code === focus.section })),
    practices: practices.slice().sort(byAvg),
    focus,
    weakest,
    strength,
    plan,
  };
}

/** WHO TO COACH FIRST (ours): the first group her fired tests put the teacher in. */
function coachFirstGroupOf(r) {
  const dc = (r && r.sessions && r.sessions.dc) || 0;
  const f = r && r.focus;
  if (f && f.why && f.why.test === 1) return 'agree_low';
  const min = (DEFAULT_SETTINGS.minSessions) || 2;
  if (f && dc >= min && f.why && f.why.source === 'dc' && f.k > 0 && f.share >= 0.5 - EPS) return 'low_most';
  if (dc === 0) return 'no_dc';
  if (dc === 1) return 'one_dc';
  return 'none';
}

/** Rows of the list: by group, then the higher share of low sessions, then the lower average, then the name. */
function coachFirstOrder(a, b) {
  const g = (x) => { const i = COACH_FIRST_GROUPS.indexOf(x.group); return i < 0 ? COACH_FIRST_GROUPS.length : i; };
  const v = (x, k, d) => (typeof x[k] === 'number' ? x[k] : d);
  return (g(a) - g(b))
    || (v(b, 'share', -1) - v(a, 'share', -1))
    || (v(a, 'avgShare', 2) - v(b, 'avgShare', 2))
    || String(a.name || '').localeCompare(String(b.name || ''));
}

module.exports = { whereToCoach, coachFirstGroupOf, coachFirstOrder, COACH_FIRST_GROUPS, verdictOf, readReport, DEFAULT_SETTINGS };
