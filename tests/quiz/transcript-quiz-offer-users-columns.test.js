'use strict';
/**
 * The offer's session read joins `users(...)`. Every column in that join must
 * exist on the users table as the schema file declares it — a column that was
 * dropped by a migration makes PostgREST refuse the WHOLE read, and the worker
 * then reports "session not found" for every coaching session that finishes.
 *
 * That is what happened on 15 Sep 2026: V1.4.5 dropped `users.grade`, the join
 * still asked for it, and every quiz offer from 06:03Z failed with
 * `column users_1.grade does not exist` while the offer job kept "succeeding".
 *
 * The stub below behaves like PostgREST: it parses the join and answers the
 * read with that exact error when a requested users column is not in the
 * schema. So the test executes the real select string through processOffer().
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true),
  introShownCount: jest.fn().mockResolvedValue(5),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { chain } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

function usersColumnsFromSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');
  const m = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?users\s*\(([\s\S]*?)\n\);/);
  return new Set(m[1].split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|--)/i.test(l))
    .map((l) => l.split(/\s+/)[0].replace(/"/g, '')));
}

/** PostgREST's answer to `select` with a users(...) join: refuse an unknown column, by name. */
function postgrestLike(tables, usersColumns) {
  return jest.fn((table) => chain((calls) => {
    const sel = calls.find((c) => c[0] === 'select');
    const join = sel && String(sel[1]).match(/users(?:!inner)?\(([^)]*)\)/);
    if (join) {
      const missing = join[1].split(',').map((c) => c.trim()).find((c) => c && !usersColumns.has(c));
      if (missing) return { data: null, error: { code: '42703', message: `column users_1.${missing} does not exist` } };
    }
    const r = tables[table];
    return typeof r === 'function' ? r(calls) : r;
  }));
}

const SID = '11111111-1111-4111-8111-111111111111';
const QID = '22222222-2222-4222-8222-222222222222';
const SESSION = {
  id: SID, user_id: 'u-1', status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-15T05:00:00Z',
  analysis_data: { topic: 'Fractions', subject: 'Maths' },
  users: { id: 'u-1', phone_number: '923001234567', preferred_language: 'ur', name: 'Rifat', grades_taught: ['4'] },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.TRANSCRIPT_QUIZ_OFFER_MODE = 'every';
});

test('the session read asks only for users columns the schema still has, so a finished lesson is offered a quiz', async () => {
  const cols = usersColumnsFromSchema();
  expect(cols.has('grades_taught')).toBe(true);           // the fixture is the real schema
  Digest.run.mockResolvedValue({
    digest: { topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
      language_of_instruction: 'ur', confidence: 0.9,
      slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }] },
    grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001,
  });
  supabase.from.mockImplementation(postgrestLike({
    coaching_sessions: { data: [SESSION] },
    quizzes: { data: [{ id: QID }] },
  }, cols));

  const r = await Offer.processOffer(SID, {});

  const notFound = logToFile.mock.calls.find((c) => /session not found for offer/.test(c[0]));
  expect(notFound ? notFound[1] : null).toBeNull();
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  expect(Digest.run).toHaveBeenCalledTimes(1);
});
