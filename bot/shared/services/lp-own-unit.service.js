'use strict';
/**
 * bd-snkn32.59 (queue #165) — "Make my own → A whole unit" (grades 1–5, book start). What the portal's unit screens
 * ask; every rule lives here, the route only passes the session's user. Dependencies injected (createUnitService):
 *   bookFor(grade, subjectKey) → catalogue book | null      bookMinutes(lessonId) → the day's own minutes | null
 *   store: insert, list, get, update, dayPlans(userId, unitId), latestPeriod(userId, { grade, subject })
 *   makeDay({ userId, lessonId, answers }) → the own-plan make's answer ({ outcome: 'queued', renderId } | refusal)
 *
 * Cost and load (plan #165): the outline is code, no AI. A day's plan is made only when she opens that day (one make,
 * the same as one "Make my own" plan); a review or test day is the book's own ready day (no model call); a day with a
 * plan already (ready, or still being made) is opened, never made again.
 */
const { buildOutline, paceCounts } = require('./lp-own-unit-outline');
const G = require('./lp-own-unit-goals');
const { checkOutline } = require('./lp-own-unit-edit');

const K5_MAX_GRADE = 5;
const SUBJECT = /^[a-z_]{2,40}$/;
/** bd-snkn32.59.4 — a goal unit's goals as stored (her words, in her order) → the outline's goal list. */
const storedGoals = (row) => (row.goals || []).map((text) => ({ text }));
const isGoals = (row) => row.start_kind === 'goals';
const bad = (error) => ({ outcome: 'bad_request', error });

function createUnitService(deps) {
  const d = deps;

  function bookOf(grade, subject) {
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 1 || g > K5_MAX_GRADE || typeof subject !== 'string' || !subject) return { error: bad('grade 1-5 and subject') };
    const book = d.bookFor(g, subject);
    return book ? { book, grade: g } : { error: { outcome: 'not_found' } };
  }

  async function minutesFor(book, from) {
    const ch = book.chapters.find((c) => c.number === Number(from));
    const first = ch && ch.lessons.find((l) => l.lp_type === 'content');
    try { return first ? await d.bookMinutes(first.lesson_id) : null; } catch (_) { return null; }
  }

  async function chapters({ userId, grade, subject }) {
    const b = bookOf(grade, subject);
    if (b.error) return b.error;
    const period = await d.store.latestPeriod(userId, { grade: b.grade, subject });
    return {
      outcome: 'ok',
      book: b.book.stem,
      chapters: b.book.chapters.map((c) => ({ number: c.number, title: c.title, days: c.lessons.length })),
      period: period || null,
    };
  }

  async function paces({ grade, subject, from, to, period }) {
    const b = bookOf(grade, subject);
    if (b.error) return b.error;
    const q = { book: b.book, from, to, period, bookMinutes: await minutesFor(b.book, from) };
    const probe = buildOutline({ ...q, pace: 'recommended' });
    if (!probe.ok) return bad(probe.error);
    return { outcome: 'ok', counts: paceCounts(q) };
  }

  /** bd-snkn32.59.4 — a goal unit's day count per pace: it depends only on how many goals she has. */
  function goalPaces({ count, period }) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < G.MIN_GOALS || n > G.MAX_GOALS) return bad('goals_count');
    const goals = Array.from({ length: n }, (_, i) => ({ text: `goal ${i + 1}` }));
    const probe = G.buildGoalOutline({ goals, pace: 'recommended', period });
    if (!probe.ok) return bad(probe.error);
    return { outcome: 'ok', counts: G.goalPaceCounts({ goals, period }) };
  }

  /** bd-snkn32.59.4 — a unit from her goals alone: no book is read, named or stored (Amena 20 Nov). */
  async function createFromGoals({ userId, grade, subject, classId, goals, period, pace, outline }) {
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 1 || g > K5_MAX_GRADE || typeof subject !== 'string' || !SUBJECT.test(subject)) return bad('grade 1-5 and subject');
    const parsed = G.parseUnitGoals(goals);
    if (!parsed.ok) return bad(parsed.error);
    const built = G.buildGoalOutline({ goals: parsed.goals, pace, period });
    if (!built.ok) return bad(built.error);
    let days = built.days;
    if (outline !== undefined) {
      const ok = checkOutline(outline, built.days);
      if (!ok.ok) return bad(ok.error);
      days = outline;
    }
    const row = await d.store.insert({
      user_id: userId, class_id: typeof classId === 'string' && classId ? classId : null, book_stem: null, grade: g, subject,
      start_kind: 'goals', goals: parsed.goals.map((x) => x.text), period_minutes: Number(period), pace, outline: days,
    });
    if (!row || !row.id) return { outcome: 'error' };
    return { outcome: 'ok', unit: await view(userId, row) };
  }

  /** The unit as the portal shows it: its days numbered, each with its plan (if made) and the next day to teach. */
  async function view(userId, row) {
    const made = await d.store.dayPlans(userId, row.id);
    const byDay = new Map(made.map((p) => [p.day_no, { ownId: p.id, status: p.status }]));
    const days = row.outline.map((day, i) => ({ day: i + 1, ...day, plan: byDay.get(i + 1) || null }));
    const next = (days.find((x) => !x.plan) || days[days.length - 1]).day;
    const { outline: _o, ...rest } = row;
    return { ...rest, days, next };
  }

  async function create({ userId, grade, subject, classId, from, to, period, pace, outline, start, goals }) {
    if (start === 'goals') return createFromGoals({ userId, grade, subject, classId, goals, period, pace, outline });
    const b = bookOf(grade, subject);
    if (b.error) return b.error;
    const built = buildOutline({ book: b.book, from, to, pace, period, bookMinutes: await minutesFor(b.book, from) });
    if (!built.ok) return bad(built.error);
    let days = built.days;
    if (outline !== undefined) {
      const ok = checkOutline(outline, built.days);
      if (!ok.ok) return bad(ok.error);
      days = outline;
    }
    const row = await d.store.insert({
      user_id: userId,
      class_id: typeof classId === 'string' && classId ? classId : null,
      book_stem: b.book.stem,
      grade: b.grade,
      subject,
      start_kind: 'book',
      chapter_from: Number(from),
      chapter_to: Number(to),
      period_minutes: Number(period),
      pace,
      outline: days,
    });
    if (!row || !row.id) return { outcome: 'error' };
    return { outcome: 'ok', unit: await view(userId, row) };
  }

  async function list(userId) {
    const rows = await d.store.list(userId);
    return { outcome: 'ok', units: rows.map(({ outline, ...r }) => ({ ...r, days: Array.isArray(outline) ? outline.length : 0 })) };
  }

  async function read({ userId, id }) {
    const row = await d.store.get(userId, id);
    return row ? { outcome: 'ok', unit: await view(userId, row) } : { outcome: 'not_found' };
  }

  async function update({ userId, id, pace, period, outline }) {
    const row = await d.store.get(userId, id);
    if (!row) return { outcome: 'not_found' };
    if ((await d.store.dayPlans(userId, id)).length) return { outcome: 'locked' };
    const p = pace === undefined ? row.pace : pace;
    const m = period === undefined ? row.period_minutes : Number(period);
    let built;
    if (isGoals(row)) built = G.buildGoalOutline({ goals: storedGoals(row), pace: p, period: m });
    else {
      const b = bookOf(row.grade, row.subject);
      if (b.error) return b.error;
      built = buildOutline({ book: b.book, from: row.chapter_from, to: row.chapter_to, pace: p, period: m, bookMinutes: await minutesFor(b.book, row.chapter_from) });
    }
    if (!built.ok) return bad(built.error);
    let days = built.days;
    if (outline !== undefined) {
      const ok = checkOutline(outline, built.days);
      if (!ok.ok) return bad(ok.error);
      days = outline;
    }
    const saved = await d.store.update(userId, id, { pace: p, period_minutes: m, outline: days });
    return { outcome: 'ok', unit: await view(userId, saved) };
  }

  /** Yesterday's topic, for a 3-minute recap: the nearest earlier lesson or practice day. */
  function recapOf(days, i) {
    for (let j = i - 1; j >= 0; j -= 1) if (days[j].kind === 'lesson' || days[j].kind === 'practice') return days[j].topic;
    return null;
  }

  async function openDay({ userId, id, day, answers }) {
    const row = await d.store.get(userId, id);
    if (!row) return { outcome: 'not_found' };
    const n = Number(day);
    const days = row.outline;
    if (!Number.isInteger(n) || n < 1 || n > days.length) return bad('day is not in this unit');
    const at = days[n - 1];
    if (!isGoals(row) && (at.kind === 'review' || at.kind === 'test')) return { outcome: 'book', lessonId: at.lesson_ids[0] };
    const already = (await d.store.dayPlans(userId, id)).find((p) => p.day_no === n && p.status !== 'failed');
    if (already) return { outcome: 'made', ownId: already.id, status: already.status };
    const recap = recapOf(days, n - 1);
    if (isGoals(row)) {
      // bd-snkn32.59.4 — every day of a goal unit is made from her goals alone (review and check days too).
      const unit = {
        unit_id: row.id, day_no: n, of: days.length, kind: at.kind, period: row.period_minutes, start: 'goals',
        grade: row.grade, subject: row.subject, lang: row.subject === 'urdu' ? 'ur' : 'en', goals: G.goalsOfDay(at, row.goals || []),
        ...(recap ? { recap: String(recap).slice(0, 400) } : {}),
      };
      return d.makeDay({ userId, lessonId: null, answers: { ...(answers || {}), unit } });
    }
    const unit = {
      unit_id: row.id,
      day_no: n,
      of: days.length,
      kind: at.kind,
      period: row.period_minutes,
      lessons: at.lesson_ids,
      ...(at.part ? { part: at.part } : {}),
      ...(recap ? { recap } : {}),
    };
    // A practice day practises its topic's days: it starts from the topic's last (most recent) day.
    const lessonId = at.kind === 'practice' ? at.lesson_ids[at.lesson_ids.length - 1] : at.lesson_ids[0];
    return d.makeDay({ userId, lessonId, answers: { ...(answers || {}), unit } });
  }

  return { chapters, paces, goalPaces, create, list, read, update, openDay };
}

module.exports = { createUnitService };
