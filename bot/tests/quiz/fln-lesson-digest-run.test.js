/**
 * bd-chz35n.26 — the transcript digest returns the FLN lesson key beside lpHint, and the quiz row's meta stores it
 * as `fln_lesson`. The key never enters the digest prompt: the quiz the teacher gets is unchanged.
 *
 * Real: transcript-quiz-digest.run, fln-lesson-hint, fln-lesson-key. Mocked: database client, LLM call, loggers.
 */
const fs = require('fs');
const path = require('path');

const mockTables = {};
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    gte: (col, val) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    lte: (col, val) => { rows = rows.filter((r) => String(r[col]) <= String(val)); return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
const mockPrompts = [];
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/transcript-quiz-llm', () => ({
  completeJson: jest.fn(async ({ prompt }) => {
    mockPrompts.push(prompt);
    return {
      json: { topic: 'Letters', subject: 'urdu', grade_band: '1-2', language_of_instruction: 'ur', confidence: 0.9,
        slos: [{ id: 'S1', statement: 'x' }, { id: 'S2', statement: 'y' }] },
      model: 'm', costUsd: 0, latencyMs: 1,
    };
  }),
}));

const Digest = require('../../shared/services/quiz/transcript-quiz-digest.service');

const AT = '2026-11-10T08:00:00.000Z';
const KEY = 'fln1:rh-ur:daily:u1:l2:letter_sounds:p10152';
const session = { id: 'cs1', user_id: 'u1', created_at: AT, transcript_text: 'الف ب پ', transcript_language: 'ur', analysis_data: { subject: 'urdu' } };

test('run returns flnLesson from the one FLN plan opened before the lesson; the prompt never sees it', async () => {
  mockTables.niete_lp_opens = [{ user_id: 'u1', plan_kind: 'fln', plan_ref: '10152', lesson_key: KEY, opened_at: '2026-11-10T05:00:00.000Z' }];
  const r = await Digest.run({ session, user: { grades_taught: '["grade_1"]' } });
  expect(r.flnLesson).toMatchObject({ key: KEY, book: 'rh-ur', unit_no: 1, lesson_no: 2, skill: 'letter_sounds', plan_id: '10152' });
  expect(r.lpHint).toBeNull();
  expect(r.grade).toBe('1');
  expect(mockPrompts.join('\n')).not.toMatch(/fln1|10152|letter_sounds/);
});

test('no FLN open → flnLesson null', async () => {
  mockTables.niete_lp_opens = [];
  const r = await Digest.run({ session, user: null });
  expect(r.flnLesson).toBeNull();
});

test('both quiz writers store it as meta.fln_lesson, only when present', () => {
  for (const f of ['transcript-quiz-offer.service.js', 'transcript-quiz-generate.service.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../../shared/services/quiz', f), 'utf8');
    expect([f, /\.\.\.\((?:r\.)?flnLesson \? \{ fln_lesson: (?:r\.)?flnLesson \} : \{\}\)/.test(src)]).toEqual([f, true]);
  }
});
