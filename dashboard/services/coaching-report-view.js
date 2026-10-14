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
  const moves = (a.lp_fidelity && Array.isArray(a.lp_fidelity.moves)) ? a.lp_fidelity.moves : [];
  const m = moves.find((x) => x && t.move_id && x.move_id === t.move_id);
  return { text: move, why: practiceWhy(t.tag, l), step: m ? stepOf(m.phase) : null };
}

function sections(a, l) {
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
    return { key: k, name, score, max, pct, colour: colourOf(pct), notAssessed: false, why: text(whys[k]) };
  });
}

function journey(trend) {
  const points = (Array.isArray(trend) ? trend : []).map((p) => num(p && p.pct)).filter((p) => p != null).map(Math.round);
  if (points.length < 2) return null;
  return { points, first: points[0], best: Math.max(...points), now: points[points.length - 1] };
}

/** input = { session, firstName, language, trend: [{created_at, pct}] oldest first, quizMessage } */
function buildReportView(input = {}) {
  const l = input.language === 'ur' ? 'ur' : 'en';
  const s = input.session || {};
  const a = s.analysis_data || {};
  return {
    language: l,
    header: cardHeader(s, a, input.firstName, l),
    wells: wells(a, l),
    thing: thing(s, a, l),
    sections: sections(a, l),
    journey: journey(input.trend),
    quizMessage: text(input.quizMessage) ? input.quizMessage : null,
    voice: https(s.voice_debrief_url),
    report: https(s.report_pdf_url),
  };
}

module.exports = { buildReportView, stepOf, colourOf, pktDate, https };
