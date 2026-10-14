'use strict';
/**
 * The coaching report page's data, shaped to Amena's ICT-3 template — v10 coaching test, bd-v0toag.55.
 * Pure: the session row, her first name and her past scores in; what the card and the detailed screen
 * show out. Anything the session does not carry is left out, never filled in (no duration, no why).
 * Rendered by coaching-report-page.js. The bot's score adapter is not imported: it pulls the bot's
 * logger, which this service does not install, so the four FICO sections are read here.
 */
const { practiceWhy } = require('../../bot/shared/services/coaching/practice-why');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PKT_MS = 5 * 3600 * 1000;

// fico-framework.js DOMAINS, in its order; the Urdu name in brackets as on the template.
const SECTIONS = [
  ['lesson_plan_fidelity', 'Lesson Plan Fidelity', 'سبق کے منصوبے پر عمل'],
  ['high_leverage_practices', 'High-Leverage Practices', 'مؤثر تدریسی طریقے'],
  ['student_engagement', 'Student Engagement', 'طلبہ کی شمولیت'],
  ['teacher_subject_knowledge', 'Teacher Subject Knowledge', 'استاد کا مضمون سے متعلق علم'],
];

// The plan's move phases (practice-tag.js BY_PHASE and the grader's phases) → the template's five steps.
const STEPS = ['Opening', 'Explanation', 'We Do', 'You Do', 'Check'];
const PHASE_STEP = {
  warm_up: 1, recall: 1, hook: 1, announce: 1,
  explain: 2,
  guided: 3, grouping: 3,
  independent: 4,
  exit: 5, peer_review: 5,
};

const COPY = {
  en: { grade: (g) => `Grade ${g}`, swap: (t) => `You did “${t}” your own way, and it worked better.` },
  ur: { grade: (g) => `جماعت ${g}`, swap: (t) => `آپ نے «${t}» اپنے طریقے سے کیا، اور وہ بہتر رہا۔` },
};

function https(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch (_) {
    return null;
  }
}

function pktDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + PKT_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function stepOf(phase) {
  const i = PHASE_STEP[String(phase || '').toLowerCase()];
  return i ? { name: STEPS[i - 1], index: i } : null;
}

function colourOf(pct) {
  if (pct == null) return null;
  if (pct >= 75) return 'green';
  return pct >= 60 ? 'amber' : 'red';
}

function header(s, a, firstName, l) {
  const meta = [num(a.grade) != null ? COPY[l].grade(num(a.grade)) : null, text(a.subject), text(a.topic)].filter(Boolean).join(' · ');
  const sc = a.scores || {};
  const pct = num(sc.overall_percentage);
  return {
    name: text(firstName) || '', meta, date: pktDate(s.created_at),
    pct: pct == null ? null : Math.round(pct), marks: num(sc.overall_marks), max: num(sc.overall_max_marks),
  };
}

function wells(a, l) {
  const lf = a.lp_fidelity || {};
  const swaps = (Array.isArray(lf.strengths) ? lf.strengths : []).map((x) => text(x && x.text)).filter(Boolean).map(COPY[l].swap);
  const own = (Array.isArray(a.strengths) ? a.strengths : []).map((x) => text(typeof x === 'string' ? x : x && x.title)).filter(Boolean);
  return [...swaps, ...own].slice(0, 3);
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
    header: header(s, a, input.firstName, l),
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
