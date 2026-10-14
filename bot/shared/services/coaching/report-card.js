'use strict';
/**
 * v10 coaching test (bd-v0toag.57): what the report card says, on Amena's ICT-3 template. Shared by the /cr
 * page (dashboard/services/coaching-report-view.js, .55) and the slim WhatsApp image C and D get
 * (report-v2/slim-card.template.js), so the two always agree. Pure, no imports. Anything the analysis does
 * not carry is left out, never filled in.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PKT_MS = 5 * 3600 * 1000;

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

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function pktDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + PKT_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function stepOf(phase) {
  const i = PHASE_STEP[String(phase || '').toLowerCase()];
  return i ? { name: STEPS[i - 1], index: i } : null;
}

/** The card's header: name, "Grade N · subject · topic", the PKT date and the score. */
function cardHeader(s, a, firstName, l) {
  const c = COPY[l] || COPY.en;
  const meta = [num(a.grade) != null ? c.grade(num(a.grade)) : null, text(a.subject), text(a.topic)].filter(Boolean).join(' · ');
  const sc = a.scores || {};
  const pct = num(sc.overall_percentage);
  return {
    name: text(firstName) || '', meta, date: pktDate((s || {}).created_at),
    pct: pct == null ? null : Math.round(pct), marks: num(sc.overall_marks), max: num(sc.overall_max_marks),
  };
}

/** What she did well: a better swap first (the grader's lp_fidelity strengths), then its strengths; three at most. */
function wells(a, l) {
  const c = COPY[l] || COPY.en;
  const lf = a.lp_fidelity || {};
  const swaps = (Array.isArray(lf.strengths) ? lf.strengths : []).map((x) => text(x && x.text)).filter(Boolean).map(c.swap);
  const own = (Array.isArray(a.strengths) ? a.strengths : []).map((x) => text(typeof x === 'string' ? x : x && x.title)).filter(Boolean);
  return [...swaps, ...own].slice(0, 3);
}

module.exports = { STEPS, stepOf, cardHeader, wells, pktDate };
