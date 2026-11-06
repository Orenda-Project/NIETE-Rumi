'use strict';
/**
 * WHERE TO COACH, read side (bd-17v39c.4.14.3). Coach only, never shared, read only. Behind the same switch and access
 * rules as the School card (its routes live in coach-school-card.routes.js, behind portal_coach_v2 AND
 * portal_coach_school_card): a teacher must be on the roster of one of HER schools; a school must be one of hers.
 *
 *   getWhereToCoach  one teacher for a period: Rifat's DC pattern engine (where-to-coach.engine.js) on her DC reports
 *                    and her reviewed FICO-form coach observations — framework sections, the focus practice and why,
 *                    the weakest practices, the strength, the plan steps she skipped — with the content library's tips
 *                    (where-to-coach.library.js), the AI coach's last advice (the next step her latest report showed
 *                    her, by the v10 rule), her last 8 DC sessions and her NIETE-use check-in.
 *   getCoachFirst    one school for a period: every teacher in the first group her rules put them in (ours: her spec
 *                    has no rule for ranking teachers): agree_low · low_most · no_dc · one_dc · none.
 *
 * The same reports the School card counts: a DC report is a completed, scored, non-duplicate DC session
 * (isDcObservation); a coach observation counts only once REVIEWED and on the FICO form (a /observe2 field-form visit
 * is never mixed in). No transcript is read.
 *
 * CHECK-IN (her spec, "NIETE use check-in"): a card per feature with low or no use in the period — Digital Coaching: 0,
 * or fewer than 3 a week (her coach-only cut, kept as she wrote it); lesson plans: 0, or fewer than half the school's
 * median; training: no part finished in the period while a training she is assigned is unfinished (ours: her "next
 * level not started", read from her assigned trainings' parts); assessments: 0. Saving the blocker a coach taps needs a
 * table and a write, so it waits for a schema decision (plan risk 3): the page shows the support line only.
 */
const Card = require('./coach-school-card.service');
const Engine = require('./where-to-coach.engine');
const Lib = require('./where-to-coach.library');
const P = require('../lib/school-card-period');
const { karachiToday } = require('../lib/visit-time');

const I = Card.internals;
const { SQL, isDcObservation, isCoachObservation, nextStepShown, reportTitleOf, lessonPlansOf } = Card;
const rowsOf = I.rowsOf;

const LIST_MAX = 8; // her spec: "the session list shows the last 8"
const DAY_MS = 24 * 3600 * 1000;

const SQL_WTC = Object.freeze({
  // The day of each teacher's latest DC report, ever (for the "no DC" rows): completed, not a re-send.
  lastDc: `/* sc:last-dc */
    SELECT DISTINCT ON (c.user_id) c.user_id, c.created_at AS at
      FROM coaching_sessions c
     WHERE c.user_id = ANY($1::uuid[]) AND c.observation_type IS NULL AND c.status = 'completed'
       AND c.duplicate_of_session_id IS NULL
     ORDER BY c.user_id, c.created_at DESC`,
});

const byAt = (a, b) => (Date.parse(a.at instanceof Date ? a.at.toISOString() : a.at) || 0) - (Date.parse(b.at instanceof Date ? b.at.toISOString() : b.at) || 0);
const daysBetween = (from, to) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

/** The engine's input row for a session, from its domains read (analysis_data.domains + lp_fidelity). */
const inputOf = (domainsById) => (s) => {
  const r = domainsById.get(s.id) || {};
  return { id: s.id, date: s.day, domains: r.domains || null, lp_fidelity: r.lp_fidelity || null };
};

/** A practice with its tips (both languages; the page picks hers), or null. */
const withTips = (framework) => (p) => (p ? { ...p, tips: Lib.suggestionsFor(framework, p.id) } : null);

/** Her two lists in the period: DC reports, and coach observations that are reviewed and on the FICO form. */
function scoredInPeriod(act, period, userId) {
  const inP = (s) => P.inPeriod(period, s.day) && (!userId || s.user_id === userId);
  const pctOf = (s) => (act.scored.get(s.id) || {}).pct;
  const dc = act.sessions.filter((s) => inP(s) && isDcObservation(s, pctOf(s))).sort(byAt);
  const coach = act.sessions.filter((s) => inP(s) && isCoachObservation(s) && I.ficoVisitScore(act, s) != null).sort(byAt);
  return { dc, coach };
}

async function domainsOf(query, sessions) {
  const ids = [...new Set(sessions.map((s) => s.id))];
  if (!ids.length) return new Map();
  return new Map(rowsOf(await query(SQL.domains, [ids])).map((r) => [r.id, r]));
}

/** The middle value of the school's lesson-plan counts, as her prototype takes it (sorted, the element at n/2). */
function medianOf(counts) {
  if (!counts.length) return 0;
  const s = counts.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Her NIETE-use check-in cards (see the header). */
async function checkinOf(query, coachId, teacher, period, events, dcCount) {
  const inP = (list) => list.filter((e) => P.inPeriod(period, e.day)).length;
  const usage = { dc: dcCount, lp: inP(events.lp), training: inP(events.training), papers: inP(events.papers) };
  const items = [];
  const card = (feature, state, extra = {}) => items.push({ feature, state, count: usage[feature], ...extra, content: Lib.checkinFor(feature) });

  const weeks = Math.max(period.schoolDaysSoFar, 1) / 5;
  if (usage.dc === 0) card('dc', 'none');
  else if (usage.dc < Math.round(3 * weeks)) card('dc', 'low', { cut: Math.round(3 * weeks) });

  if (usage.lp === 0) card('lp', 'none');
  else {
    const ctx = teacher.emis ? await I.schoolContext(query, coachId, String(teacher.emis)) : null;
    if (ctx && ctx.teachers.length) {
      const ids = ctx.teachers.map((t) => t.id);
      const b = P.boundsOf(period);
      const [lp, opens] = await Promise.all([query(SQL.lp, [ids, b.fromTs, b.toTs]), query(SQL.opens, [ids, b.fromTs, b.toTs])]);
      const plans = lessonPlansOf(rowsOf(lp), rowsOf(opens)).filter((p) => P.inPeriod(period, p.day));
      const median = medianOf(ids.map((id) => plans.filter((p) => p.userId === id).length));
      if (median > 0 && usage.lp < median * 0.5) card('lp', 'low', { median });
    }
  }

  if (usage.training === 0) {
    const mine = (await I.trainingsOf(query, [teacher.id])).get(teacher.id);
    const unfinished = !!mine && mine.vendors.some((v) => v.module_count > 0 && v.completed_module_count < v.module_count);
    if (unfinished) card('training', 'next');
  }

  if (usage.papers === 0) card('papers', 'none');
  return { usage, items };
}

/** GET /coach/teacher/:ext/where */
async function getWhereToCoach(query, coachId, ext, opts = {}) {
  const teacher = await I.teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act, events } = await I.teacherActivity(query, teacher, opts);
  const { dc, coach } = scoredInPeriod(act, period, teacher.id);
  const domains = await domainsOf(query, [...dc, ...coach]);
  const fw = I.frameworkConstants();
  const result = Engine.whereToCoach(
    { dc: dc.map(inputOf(domains)), coach: coach.map(inputOf(domains)) },
    undefined,
    { scaleMax: fw && fw.scaleMax },
  );
  const tips = withTips(result.framework);

  // Her last 8 DC sessions, newest first, and the AI coach's last advice (the newest report that showed her a step).
  const newest = dc.slice().reverse();
  const listed = newest.slice(0, LIST_MAX);
  const group = newest.length ? await I.groupOf(query, teacher.school_id) : null;
  const actions = newest.length
    ? new Map(rowsOf(await query(SQL.actions, [newest.map((s) => s.id), group])).map((r) => [r.id, r]))
    : new Map();
  let lastAdvice = null;
  for (const s of newest) {
    const a = actions.get(s.id) || {};
    const t = nextStepShown({ action: a.action, thing_to_try: { text: a.thing_text } }, group);
    if (t) { lastAdvice = { text: t, date: s.day, sessionId: s.id }; break; }
  }
  const reports = listed.map((s) => {
    const info = (act.scored.get(s.id) || {}).info || {};
    const a = actions.get(s.id) || {};
    const secs = Engine.readReport(inputOf(domains)(s), fw && fw.scaleMax).sections;
    const weakest = Object.keys(secs).sort((x, y) => secs[x] - secs[y])[0] || null;
    return {
      id: s.id, date: s.day, grade: info.grade || null, subject: info.subject || null,
      title: reportTitleOf(a.topic, a.lesson_label, a.framework), score: I.pctOfSession(act, s), weakest,
    };
  });

  return {
    teacher: I.teacherOut(teacher),
    period: P.publicPeriod(period),
    framework: result.framework,
    scaleMax: result.scaleMax,
    sessions: result.sessions,
    signal: result.signal,
    sections: result.sections,
    focus: tips(result.focus),
    weakest: result.weakest.map(tips),
    strength: tips(result.strength),
    plan: result.plan && { ...result.plan, skipped: result.plan.skipped.map((st) => ({ ...st, tips: Lib.stepTipFor(st.step) })) },
    lastAdvice,
    reports,
    moreReports: Math.max(0, dc.length - LIST_MAX),
    checkin: await checkinOf(query, coachId, teacher, period, events, dc.length),
  };
}

/** GET /coach/school/:emis/first */
async function getCoachFirst(query, coachId, emis, opts = {}) {
  const ctx = await I.schoolContext(query, coachId, emis, opts.level);
  if (!ctx) return null;
  const period = I.resolvePeriod(opts);
  const today = opts.today || karachiToday();
  const ids = ctx.teachers.map((t) => t.id);
  const act = await I.loadActivity(query, ids, period, opts);
  const lists = new Map(ctx.teachers.map((t) => [t.id, scoredInPeriod(act, period, t.id)]));
  const domains = await domainsOf(query, [...lists.values()].flatMap((l) => [...l.dc, ...l.coach]));
  const fw = I.frameworkConstants();
  const noDc = ctx.teachers.filter((t) => !lists.get(t.id).dc.length).map((t) => t.id);
  const lastDc = noDc.length
    ? new Map(rowsOf(await query(SQL_WTC.lastDc, [noDc])).map((r) => [r.user_id, P.pkDayOf(r.at)]))
    : new Map();

  const rows = ctx.teachers.map((t) => {
    const l = lists.get(t.id);
    const r = Engine.whereToCoach({ dc: l.dc.map(inputOf(domains)), coach: l.coach.map(inputOf(domains)) }, undefined, { scaleMax: fw && fw.scaleMax });
    const f = r.focus;
    const last = lastDc.get(t.id) || null;
    return {
      teacherExtId: t.teacherExtId,
      name: t.name,
      isPrincipal: t.isPrincipal,
      group: Engine.coachFirstGroupOf(r),
      focus: f ? { id: f.id, name: f.name, section: f.section, why: f.why } : null,
      k: f ? f.k : null,
      n: f ? f.n : null,
      share: f ? f.share : null,
      avgShare: f ? f.avgShare : null,
      sessions: r.sessions,
      lastDcDaysAgo: l.dc.length ? null : (last ? daysBetween(last, today) : null),
    };
  }).sort(Engine.coachFirstOrder);

  return {
    school: { emis: ctx.school.emis, name: ctx.school.name },
    period: P.publicPeriod(period),
    level: ctx.level,
    teachers: rows.length,
    groups: Engine.COACH_FIRST_GROUPS.map((key) => ({
      key,
      rows: rows.filter((x) => x.group === key).map(({ share, avgShare, ...x }) => x),
    })),
  };
}

module.exports = { getWhereToCoach, getCoachFirst };
