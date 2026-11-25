'use strict';
/**
 * The coaching report page's data, shaped to Amena's ICT-3 template — v10 coaching test, bd-v0toag.55.
 * Pure: the session row, her first name and her past scores in; what the card and the detailed screen
 * show out. Anything the session does not carry is left out, never filled in (no duration, no why).
 * Rendered by coaching-report-page.js. The bot's score adapter is not imported: it pulls the bot's
 * logger, which this service does not install, so the four FICO sections are read here.
 */
const { practiceWhy } = require('../../bot/shared/services/coaching/practice-why');
// The card's header, steps and what she did well are shared with the slim WhatsApp image (bd-v0toag.57).
const { stepOf, cardHeader, wells, pktDate } = require('../../bot/shared/services/coaching/report-card');
const { disagreementsFor } = require('../../bot/shared/services/coaching/live-moves/disagreements');
// bd-r2uzg1.12: the same soft line the hero image adds after a lesson-mismatch Section B (groups C and D read it here).
const { lessonMismatchNote, withNote } = require('../../bot/shared/services/coaching/report-v2/lesson-mismatch-note');

const { isOwnRubric, isV6Scored } = require('./coaching-frameworks.service');

// fico-framework.js DOMAINS, in its order; the Urdu name in brackets as on the template.
const SECTIONS = [
  ['lesson_plan_fidelity', 'Lesson Plan Fidelity', 'سبق کے منصوبے پر عمل'],
  ['high_leverage_practices', 'High-Leverage Practices', 'مؤثر تدریسی طریقے'],
  ['student_engagement', 'Student Engagement', 'طلبہ کی شمولیت'],
  ['teacher_subject_knowledge', 'Teacher Subject Knowledge', 'استاد کا مضمون سے متعلق علم'],
];

function https(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch (_) {
    return null;
  }
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function colourOf(pct) {
  if (pct == null) return null;
  if (pct >= 75) return 'green';
  return pct >= 60 ? 'amber' : 'red';
}

function thing(s, a, l) {
  const pa = s.prioritized_action || {};
  const t = pa.thing_to_try || {};
  const move = text(t.text);
  if (!move) {
    const action = text(pa.action);
    return action ? { text: action, why: null, step: null } : null;
  }
  // bd-v0toag.100.8: an ask carried from an earlier lesson keeps its stored step.
  if ('step' in t) return { text: move, why: practiceWhy(t.tag, l), step: t.step || null };
  const moves = (a.lp_fidelity && Array.isArray(a.lp_fidelity.moves)) ? a.lp_fidelity.moves : [];
  const m = moves.find((x) => x && t.move_id && x.move_id === t.move_id);
  return { text: move, why: practiceWhy(t.tag, l), step: m ? stepOf(m.phase) : null };
}

function sections(a, l, s) {
  const domains = a.domains || a.areas;
  if (!domains || typeof domains !== 'object') return [];
  const whys = (a.report_narrative && a.report_narrative.domain_whys) || {};
  return SECTIONS.filter(([k]) => domains[k]).map(([k, en, ur]) => {
    const d = domains[k];
    const name = l === 'ur' ? `${en} (${ur})` : en;
    if (d.assessed === false) return { key: k, name, score: null, max: null, pct: null, colour: null, notAssessed: true, why: null };
    const score = num(d.domain_score ?? d.area_score);
    const max = num(d.domain_max ?? d.area_max);
    const pct = score != null && max ? Math.round((score / max) * 100) : null;
    const why = text(whys[k]);
    const note = k === 'lesson_plan_fidelity' ? lessonMismatchNote(a, s, l) : null;
    return { key: k, name, score, max, pct, colour: colourOf(pct), notAssessed: false, why: note ? withNote(why, note) : why };
  });
}

/**
 * Queue #282 / bd-ra8xu.64.2 — a report scored on FICO17 v6 keeps its sections under its own keys (v6_teacher,
 * v6_children, v6_subject: frameworks/fico17-v6 SECTIONS C, D, F), so the V3 rows above found none. Its rows, in the
 * names her WhatsApp v6 image prints (the catalog's reportV6Section*, the rubric's own section names): B, the plan
 * steps followed (outside the v6 total, on the image's /40), then C, D, F as stored (domain_score / domain_max). A
 * section with no levelled row (every row couldn't-tell) is not assessed, never "0/0"; so is B with no plan read.
 */
const V6_ROWS = [
  ['lesson_plan_fidelity', 'reportV6SectionPlan'],
  ['v6_teacher', 'reportV6SectionTeacher'],
  ['v6_children', 'reportV6SectionChildren'],
  ['v6_subject', 'reportV6SectionSubject'],
];
const PLAN_MAX = 40; // the v6 image's B bar (fico17-v6-adapter FIDELITY_MAX)

function v6Sections(a, l, s) {
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  const domains = a.domains && typeof a.domains === 'object' ? a.domains : {};
  const whys = (a.report_narrative && a.report_narrative.domain_whys) || {};
  const notAssessed = (key, name) => ({ key, name, score: null, max: null, pct: null, colour: null, notAssessed: true, why: null });
  return V6_ROWS.map(([k, uxKey]) => {
    const words = UX_STRINGS[uxKey] || {};
    const name = l === 'ur' && words.ur ? `${words.en} (${words.ur})` : words.en;
    if (k === 'lesson_plan_fidelity') {
      const lp = a.lp_fidelity;
      const fp = lp && lp.status === 'ok' ? num(lp.fidelity_pct) : null;
      if (fp == null) return notAssessed(k, name);
      const pct = Math.round(fp);
      const note = lessonMismatchNote(a, s, l);
      const why = text(whys[k]);
      return { key: k, name, score: Math.round((fp / 100) * PLAN_MAX), max: PLAN_MAX, pct, colour: colourOf(pct), notAssessed: false, why: note ? withNote(why, note) : why };
    }
    const d = domains[k];
    if (!d || typeof d !== 'object') return null;
    const score = num(d.domain_score);
    const max = num(d.domain_max);
    if (score == null || !max || max <= 0) return notAssessed(k, name);
    const pct = Math.round((score / max) * 100);
    return { key: k, name, score, max, pct, colour: colourOf(pct), notAssessed: false, why: text(whys[k]) };
  }).filter(Boolean);
}

function journey(trend) {
  const points = (Array.isArray(trend) ? trend : []).map((p) => num(p && p.pct)).filter((p) => p != null).map(Math.round);
  if (points.length < 2) return null;
  return { points, first: points[0], best: Math.max(...points), now: points[points.length - 1] };
}

/**
 * input = { session, firstName, language, trend: [{created_at, pct}] oldest first, quizMessage, card? (bd-v0toag.31),
 *           video? (bd-gzfdu9: the recommended clip's card, shaped by video-reco-events.cardFor; absent → no key) }
 */
function buildReportView(input = {}) {
  const l = input.language === 'ur' ? 'ur' : 'en';
  const s = input.session || {};
  const a = s.analysis_data || {};
  return {
    language: l,
    header: cardHeader(s, a, input.firstName, l),
    wells: wells(a, l),
    thing: thing(s, a, l),
    // Queue #282 / bd-ra8xu.64.2: a v6 report's own sections; no journey beside a report on a rubric of its own (the
    // trend is V3 points only, so its "now" would be an older V3 lesson; the WhatsApp hero leaves it out too).
    sections: isV6Scored(a) ? v6Sections(a, l, s) : sections(a, l, s),
    journey: isOwnRubric(a) ? null : journey(input.trend),
    quizMessage: text(input.quizMessage) ? input.quizMessage : null,
    voice: https(s.voice_debrief_url),
    report: https(s.report_pdf_url),
    disagreements: disagreementsFor(a.live_moves, a.lp_fidelity, input.card),
    ...(input.video ? { video: input.video } : {}),
  };
}

module.exports = { buildReportView, stepOf, colourOf, pktDate, https };
