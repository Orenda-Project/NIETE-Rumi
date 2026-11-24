'use strict';
/**
 * bd-chz35n.10.3 — the day-3 retest (bd-v0toag.10) names the original's anchor questions on the new quiz
 * (meta.anchor_from), so the generate step asks them again word for word. Only with app_settings
 * quiz_anchor_items on; off, the retest is exactly what it was. The retest itself still needs its own
 * switch (quiz_slo_retest_enabled). In-memory DB; queue/Redis mocked.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ setNX: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Flag = require('../../bot/shared/services/quiz/quiz-v21-flag');
const Anchors = require('../../bot/shared/services/quiz/quiz-anchors');
const Sweep = require('../../bot/shared/services/quiz/quiz-retest-sweep');

const DAY = 864e5;
const NOW = new Date('2026-10-20T06:00:00Z'); // 11:00 PKT
const META = { lessons: [{ lesson_id: 'L1' }], digest: { slos: [{ id: 'S1' }, { id: 'S2' }] }, step: 'sent' };
const Q1 = {
  id: 'Q1', teacher_id: 'T1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Adding', subject: 'maths',
  grade: '2', language: 'en', status: 'sent', meta: META, created_at: new Date(NOW.getTime() - 3.5 * DAY).toISOString(),
};
const qq = (n, slo, over = {}) => ({
  id: `qq${n}`, quiz_id: 'Q1', sort_order: n, external_id: `tq:Q1:${slo}:${n}`, question_text: `Q${n}?`,
  option_a: '1', option_b: '2', option_c: '3', correct_option: 'A', media: {}, ...over,
});

function seed({ anchors }) {
  const settings = [{ key: 'quiz_slo_retest_enabled', value: true }];
  if (anchors) settings.push({ key: 'quiz_anchor_items', value: true });
  mockDb = makeDb({
    app_settings: settings,
    quizzes: [Q1],
    quiz_sessions: [{ id: 's1', quiz_id: 'Q1', status: 'completed' }],
    quiz_questions: [qq(1, 'S1', { media: { question_image: 'https://r2/p.png' } }), qq(2, 'S1'), qq(3, 'S1'), qq(4, 'S2')],
    users: [{ id: 'T1', phone_number: '923001112223' }],
  });
}
const retest = () => mockDb.tables.quizzes.find((q) => q.meta && q.meta.source === 'retest');

beforeEach(() => { jest.clearAllMocks(); Flag._reset(); Anchors._reset(); });

test('anchors on → the retest names one plain question per skill of the original as its anchors', async () => {
  seed({ anchors: true });
  expect((await Sweep.sweep({ now: NOW })).made).toBe(1);
  expect(retest().meta.anchor_from).toEqual(['qq2', 'qq4']);
  // the author is still told not to repeat ANY old question: the anchors are added after it writes
  expect(retest().meta.retest_avoid).toEqual(['Q1?', 'Q2?', 'Q3?', 'Q4?']);
  expect(logEvent).toHaveBeenCalledWith('quiz.retest_made', expect.objectContaining({ anchors: 2 }));
});

test('anchors off (no row) → the retest is unchanged: no anchor_from', async () => {
  seed({ anchors: false });
  expect((await Sweep.sweep({ now: NOW })).made).toBe(1);
  expect(retest().meta).not.toHaveProperty('anchor_from');
});
