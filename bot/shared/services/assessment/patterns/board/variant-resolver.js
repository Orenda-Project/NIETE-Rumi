'use strict';
/**
 * Which variant of a G6-12 board subject a paper is set in (DESIGN R11, SPEC §4).
 *
 * A subject entry carries `variants[]`; each says where it applies in `applies_to`:
 *   { sessions: ['1A2027', ...] | ['*'] }  explicit sessions, '*' = every session, [] = none
 *   { from: '1A2028' }                     this session and every later one
 *   { before: '1A2028' }                   every session before this one
 *   { grades: [10] }                       optional, only for these grades
 * The first variant that applies wins; no `applies_to` means "everywhere". The FBISE notification-242
 * phasing (which subjects go 50% MCQ, from which session per grade) is data below; `fbiseAppliesTo`
 * turns it into the `applies_to` a pattern entry stores, so the rule is written once.
 *
 * Sessions are FBISE codes: `<n>A<year>`, n 1 = annual, 2 = supplementary. Pure: `now` is passed in.
 */

// The academic year rolls over in July (1-based): from 1 July the next annual session is next year's.
const ROLLOVER_MONTH = 7;

// Notification 242 (7 Aug 2026), r0-boards F1; BLUEPRINTS §4-§7.
const FBISE_50PCT = Object.freeze({
  subjects: Object.freeze(['maths', 'physics', 'chemistry', 'biology', 'computer_science']),
  first_session: Object.freeze({ 9: '1A2027', 10: '1A2028', 11: '1A2027', 12: '1A2028' }),
});

const KINDS = ['50pct', 'nonpct', 'single'];

function parseSession(code) {
  if (typeof code !== 'string') return null;
  const m = /^([12])A(\d{4})$/.exec(code.trim().toUpperCase());
  return m ? { n: Number(m[1]), year: Number(m[2]) } : null;
}

function mustParse(code) {
  const s = parseSession(code);
  if (!s) throw new Error(`variant-resolver: cannot read exam session ${JSON.stringify(code)}`);
  return s;
}

function compareSessions(a, b) {
  const x = mustParse(a);
  const y = mustParse(b);
  return x.year === y.year ? x.n - y.n : x.year - y.year;
}

function sessionFor(now) {
  const year = now.getUTCFullYear() + (now.getUTCMonth() + 1 >= ROLLOVER_MONTH ? 1 : 0);
  return `1A${year}`;
}

function fbiseAppliesTo(grade, subjectKey, kind) {
  const first = FBISE_50PCT.first_session[Number(grade)];
  if (!first) throw new Error(`variant-resolver: FBISE grade 9-12 only, got ${grade}`);
  if (!KINDS.includes(kind)) throw new Error(`variant-resolver: unknown variant kind ${kind}`);
  if (kind === 'single') return { sessions: ['*'] };
  if (!FBISE_50PCT.subjects.includes(subjectKey)) return { sessions: kind === '50pct' ? [] : ['*'] };
  return kind === '50pct' ? { from: first } : { before: first };
}

function applies(rule, grade, session) {
  if (!rule) return true;
  if (rule.grades && grade != null && !rule.grades.includes(Number(grade))) return false;
  if (rule.grades && grade == null) return false;
  if (rule.sessions) {
    return rule.sessions.some((s) => s === '*' || compareSessions(s, session) === 0);
  }
  if (rule.from && compareSessions(session, rule.from) < 0) return false;
  if (rule.before && compareSessions(session, rule.before) >= 0) return false;
  return true;
}

function resolve(subject, { grade = null, examSession = null, now = new Date() } = {}) {
  const variants = subject && subject.variants;
  if (!Array.isArray(variants) || variants.length === 0) throw new Error('variant-resolver: subject has no variants');
  const session = examSession == null ? sessionFor(now) : examSession;
  mustParse(session);
  return variants.find((v) => applies(v.applies_to, grade, session)) || null;
}

module.exports = { resolve, sessionFor, parseSession, compareSessions, fbiseAppliesTo, FBISE_50PCT, ROLLOVER_MONTH };
