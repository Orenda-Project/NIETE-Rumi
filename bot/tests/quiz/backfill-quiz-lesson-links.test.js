'use strict';
/**
 * bd-ptl6x9.13.1 — put the lesson plan on PAST quizzes, only where the link is recorded already:
 * a plan quiz's own `meta.lessons`, or a recording where the teacher picked her plan. Dry run by
 * default (counts only); --apply needs --expect-ref; only quizzes a week old or more are written,
 * so a live quiz's meta is never raced; a quiz that already has links is never touched.
 */
const { makeDb } = require('../../../tests/quiz/helpers/memory-db');
const Backfill = require('../../scripts/quiz/backfill-quiz-lesson-links');

const NOW = new Date('2026-11-24T12:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * 864e5).toISOString();

function seed() {
  return makeDb({
    quizzes: [
      { id: 'q1', quiz_source: 'lp_v8', created_at: ago(20), meta: { step: 'sent', lessons: [{ lesson_id: 'grade_3_math_ch4_seg2', asset_id: 'A1' }] } },
      { id: 'q2', quiz_source: 'lp612', created_at: ago(20), meta: { lessons: [{ segment_id: 'grade_9_physics.c05.p123-124', render_id: 'R1' }] } },
      { id: 'q3', quiz_source: 'transcript', coaching_session_id: 'S1', created_at: ago(20), meta: { step: 'sent' } },
      { id: 'q4', quiz_source: 'transcript', coaching_session_id: 'S2', created_at: ago(20), meta: {} },
      { id: 'q5', quiz_source: 'lp_v8', created_at: ago(2), meta: { lessons: [{ lesson_id: 'grade_1_urdu_ch1_seg1' }] } },
      { id: 'q6', quiz_source: 'lp_v8', created_at: ago(20), meta: { lessons: [{ lesson_id: 'x' }], lesson_links: [{ lesson_id: 'x' }] } },
      { id: 'q7', quiz_source: 'video', created_at: ago(20), meta: {} },
      { id: 'q8', quiz_source: 'lp_v8', created_at: ago(20), meta: { lessons: [] } },
    ],
    coaching_sessions: [
      { id: 'S1', lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_2_maths_ch3_seg1' } } },
      { id: 'S2', lesson_plan_link_method: 'none', lesson_plan_structured: null },
    ],
  });
}

const quiet = () => {};

test('dry run: counts per source and outcome, writes nothing', async () => {
  const db = seed();
  const before = JSON.stringify(db.tables.quizzes);
  const r = await Backfill.run({ supabase: db, now: NOW, log: quiet });
  expect(r.dryRun).toBe(true);
  expect(r.counts).toEqual({
    lp_v8: { linked: 1, no_link: 1, has_links: 1, too_recent: 1 },
    lp612: { linked: 1 },
    transcript: { linked: 1, no_link: 1 },
  });
  expect(r.written).toBe(0);
  expect(JSON.stringify(db.tables.quizzes)).toBe(before);
});

test('apply: adds lesson_links only, keeps the rest of meta, leaves every other quiz alone', async () => {
  const db = seed();
  const r = await Backfill.run({ supabase: db, now: NOW, dryRun: false, log: quiet });
  expect(r.written).toBe(3);
  const by = Object.fromEntries(db.tables.quizzes.map((q) => [q.id, q]));
  expect(by.q1.meta).toEqual(expect.objectContaining({ step: 'sent', lessons: expect.any(Array) }));
  expect(by.q1.meta.lesson_links).toEqual([expect.objectContaining({ lesson_id: 'grade_3_math_ch4_seg2', plan_asset_id: 'A1', book: 'grade_3_maths', via: 'plan' })]);
  expect(by.q2.meta.lesson_links[0]).toEqual(expect.objectContaining({ book: 'grade_9_physics', chapter: 5 }));
  expect(by.q3.meta.lesson_links).toEqual([expect.objectContaining({ lesson_id: 'grade_2_maths_ch3_seg1', via: 'teacher_picked' })]);
  expect(by.q3.meta.step).toBe('sent');
  for (const id of ['q4', 'q5', 'q7', 'q8']) expect(by[id].meta.lesson_links).toBeUndefined();
  expect(by.q6.meta.lesson_links).toEqual([{ lesson_id: 'x' }]);
  // Idempotent: a second run finds nothing to write.
  expect((await Backfill.run({ supabase: db, now: NOW, dryRun: false, log: quiet })).written).toBe(0);
});

test('--apply without the matching project ref is refused before any read', async () => {
  const db = seed();
  const out = await Backfill.main(['--apply', '--expect-ref', 'other'], { env: { SUPABASE_URL: 'https://abc.supabase.co' }, db, print: quiet });
  expect(out).toEqual({ refused: true });
  expect(db.from).not.toHaveBeenCalled();
});
