/**
 * bd-snkn32.59 (queue #165) — the unit service behind the portal's "A whole unit" screens: chapters with day counts,
 * pace counts, save a unit, read it with each day's plan state, change it, and open a day (plan made on demand:
 * review/test days are the book's own ready day, no model call; a made day is never made twice).
 */
const { createUnitService } = require('../../bot/shared/services/lp-own-unit.service');
const catalog = require('../../bot/data/lp_catalog.json');

const bookFor = (grade, subject) => catalog.books.find((b) => b.grade === grade && b.subject_key === subject && !b.opt_in) || null;
const MATHS = { grade: 3, subject: 'math' };

let rows;
let plans;
let made;
function svc(over = {}) {
  rows = [];
  plans = [];
  made = [];
  return createUnitService({
    bookFor,
    bookMinutes: async () => 40,
    store: {
      insert: async (r) => { const row = { ...r, id: `unit${rows.length + 1}`, status: 'active', updated_at: 't' }; rows.push(row); return row; },
      list: async (userId) => rows.filter((r) => r.user_id === userId),
      get: async (userId, id) => rows.find((r) => r.user_id === userId && r.id === id) || null,
      update: async (userId, id, patch) => { const r = rows.find((x) => x.user_id === userId && x.id === id); Object.assign(r, patch); return r; },
      dayPlans: async (userId, unitId) => plans.filter((p) => p.user_id === userId && p.unit_id === unitId),
      latestPeriod: async (userId, q) => (rows.filter((r) => r.user_id === userId && r.subject === q.subject && r.grade === q.grade).pop() || {}).period_minutes || null,
    },
    makeDay: async (q) => { made.push(q); return { outcome: 'queued', renderId: `own${made.length}` }; },
    ...over,
  });
}
const create = (s, over = {}) => s.create({ userId: 'u1', ...MATHS, from: 2, to: 3, period: 35, pace: 'recommended', ...over });

describe('chapters + paces', () => {
  it('lists her book\'s chapters with their day counts, and no saved period yet', async () => {
    const out = await svc().chapters({ userId: 'u1', ...MATHS });
    expect(out.outcome).toBe('ok');
    expect(out.chapters.find((c) => c.number === 2)).toEqual({ number: 2, title: 'Plus and Minus Mysteries', days: 11 });
    expect(out.period).toBeNull();
  });
  it('the period she last chose for this grade + subject comes back pre-filled', async () => {
    const s = svc();
    await create(s);
    expect((await s.chapters({ userId: 'u1', ...MATHS })).period).toBe(35);
    expect((await s.chapters({ userId: 'u2', ...MATHS })).period).toBeNull();
  });
  it('grades 1-5 only; an unknown book is not_found', async () => {
    expect((await svc().chapters({ userId: 'u1', grade: 7, subject: 'math' })).outcome).toBe('bad_request');
    expect((await svc().chapters({ userId: 'u1', grade: 3, subject: 'astrology' })).outcome).toBe('not_found');
  });
  it('pace counts 21 / 25 / 17', async () => {
    expect(await svc().paces({ ...MATHS, from: 2, to: 3, period: 35 })).toEqual({ outcome: 'ok', counts: { recommended: 21, slower: 25, faster: 17 } });
  });
});

describe('create + read', () => {
  it('saves the built outline with her choices, and reads it back with every day "not made"', async () => {
    const s = svc();
    const out = await create(s);
    expect(out.outcome).toBe('ok');
    expect(rows[0]).toMatchObject({ user_id: 'u1', book_stem: 'grade_3_math', grade: 3, subject: 'math', start_kind: 'book', chapter_from: 2, chapter_to: 3, period_minutes: 35, pace: 'recommended' });
    expect(rows[0].outline).toHaveLength(21);
    const read = await s.read({ userId: 'u1', id: out.unit.id });
    expect(read.unit.days).toHaveLength(21);
    expect(read.unit.days[0]).toMatchObject({ day: 1, kind: 'lesson', plan: null });
    expect(read.unit.next).toBe(1);
  });
  it('accepts her edited outline when it passes the check, refuses one that does not', async () => {
    const s = svc();
    const built = (await s.paces({ ...MATHS, from: 2, to: 3, period: 35 })) && (await create(s)).unit.days.map(({ day, plan, ...d }) => d);
    const joined = [{ ...built[0], lesson_ids: [...built[0].lesson_ids, ...built[1].lesson_ids] }, ...built.slice(2)];
    expect((await create(s, { outline: joined })).outcome).toBe('ok');
    expect((await create(s, { outline: built.slice(1) })).outcome).toBe('bad_request');
  });
  it('someone else\'s unit is not_found', async () => {
    const s = svc();
    const { unit } = await create(s);
    expect((await s.read({ userId: 'u2', id: unit.id })).outcome).toBe('not_found');
  });
});

describe('update', () => {
  it('a new pace or period rebuilds the outline; an outline is checked', async () => {
    const s = svc();
    const { unit } = await create(s);
    expect((await s.update({ userId: 'u1', id: unit.id, pace: 'slower' })).unit.days).toHaveLength(25);
    expect(rows[0].pace).toBe('slower');
    expect((await s.update({ userId: 'u1', id: unit.id, outline: [{ kind: 'party' }] })).outcome).toBe('bad_request');
  });
  it('the outline cannot change once a day\'s plan is made (her made days keep their place)', async () => {
    const s = svc();
    const { unit } = await create(s);
    plans.push({ user_id: 'u1', unit_id: unit.id, day_no: 1, id: 'own9', status: 'ready' });
    expect((await s.update({ userId: 'u1', id: unit.id, pace: 'faster' })).outcome).toBe('locked');
  });
});

describe('openDay — a plan is made only when she opens that day', () => {
  const answers = { size: '31_50', level: 'on_track', way: 'cpa', resources: ['textbook'] };
  it('a lesson day: one make, with the unit context (period, recap of yesterday, day of the unit)', async () => {
    const s = svc();
    const { unit } = await create(s);
    const out = await s.openDay({ userId: 'u1', id: unit.id, day: 4, answers });
    expect(out).toEqual({ outcome: 'queued', renderId: 'own1' });
    expect(made).toHaveLength(1);
    expect(made[0]).toEqual({
      userId: 'u1',
      lessonId: 'grade_3_math_ch2_seg4',
      answers: {
        ...answers,
        unit: { unit_id: unit.id, day_no: 4, of: 21, kind: 'lesson', period: 35, lessons: ['grade_3_math_ch2_seg4'], recap: 'Addition word problems (CUBES)' },
      },
    });
  });
  it('a review or test day opens the book\'s own ready day: no make', async () => {
    const s = svc();
    const { unit } = await create(s);
    expect(await s.openDay({ userId: 'u1', id: unit.id, day: 10, answers })).toEqual({ outcome: 'book', lessonId: 'grade_3_math_ch2_seg990' });
    expect(await s.openDay({ userId: 'u1', id: unit.id, day: 11, answers })).toEqual({ outcome: 'book', lessonId: 'grade_3_math_ch2_seg995' });
    expect(made).toHaveLength(0);
  });
  it('a day already made (or being made) is opened, never made twice', async () => {
    const s = svc();
    const { unit } = await create(s);
    plans.push({ user_id: 'u1', unit_id: unit.id, day_no: 4, id: 'own7', status: 'authoring' });
    expect(await s.openDay({ userId: 'u1', id: unit.id, day: 4, answers })).toEqual({ outcome: 'made', ownId: 'own7', status: 'authoring' });
    expect(made).toHaveLength(0);
  });
  it('a practice day and a joined day carry their kind and lessons', async () => {
    const s = svc();
    const { unit } = await create(s, { pace: 'slower' });
    await s.openDay({ userId: 'u1', id: unit.id, day: 5, answers });
    expect(made[0].answers.unit).toMatchObject({ kind: 'practice', lessons: ['grade_3_math_ch2_seg1', 'grade_3_math_ch2_seg2', 'grade_3_math_ch2_seg3', 'grade_3_math_ch2_seg4'] });
    expect(made[0].lessonId).toBe('grade_3_math_ch2_seg4');
  });
  it('a day out of range is bad_request', async () => {
    const s = svc();
    const { unit } = await create(s);
    expect((await s.openDay({ userId: 'u1', id: unit.id, day: 22, answers })).outcome).toBe('bad_request');
  });
});
