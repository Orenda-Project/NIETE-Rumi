'use strict';
/**
 * /quiz lesson provider — the Grades 6-12 lesson plans a teacher RECEIVED.
 *
 * Listed in the quiz menu before any quiz exists (label "From lesson plan"), and made into a quiz
 * ONLY when the teacher taps one — the recording's behaviour and the K-5 plans' (the operator,
 * 24 Sep: "shows the quizzes for the LPs but not have them generated unless the teacher requests
 * them"). The list reads the delivery ledger (`niete_lp612_deliveries`, one row per lesson the
 * teacher was sent); the tap writes the lp612 quiz row every downstream step reads — the lesson's
 * exact version triple in `meta.lessons[0]`, `meta.lesson_date`, the class — and goes through the
 * same language ask / queue step as every lesson-plan quiz.
 *
 * Driven over the stateful in-memory database; WhatsApp, the queue and Redis are the boundary.
 */

const { createMemorySupabase } = require('./helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t), rpc: (n, a) => mockDb.rpc(n, a) }));
const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: (_, fn) => (fn === 'then' ? undefined : async (to, ...args) => { mockSent.push({ fn: String(fn), to, args }); return true; }),
}));
const mockJobs = [];
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn(async (groupId, jobType, payload) => { mockJobs.push({ groupId, jobType, payload }); return 'mid'; }),
}));
const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: async (k) => { if (mockKv.has(k)) return false; mockKv.set(k, 1); return true; },
  delete: async (k) => { mockKv.delete(k); return true; },
  get: async (k) => mockKv.get(k) || null,
  set: async (k, v) => { mockKv.set(k, v); return true; },
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Provider = require('../../bot/shared/services/quiz/providers/lp612.provider');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { logToFile } = require('../../bot/shared/utils/logger');

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PHONE = '923001234567';
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const SEGMENTS = [
  { segment_id: 'grade_8_mathematics.c04.p047-050', grade: 8, subject: 'Mathematics', subtopic_title: 'Inverse proportion', menu_title: 'Inverse proportion', lp_type: 'content', is_religious: false },
  { segment_id: 'grade_7_urdu.c06.p033-034.alfaaz_maani', grade: 7, subject: 'Urdu', subtopic_title: 'الفاظ و معنی', menu_title: 'الفاظ و معنی', lp_type: 'content', is_religious: false },
  { segment_id: 'grade_9_biology.c02.p020-021', grade: 9, subject: 'Biology', subtopic_title: 'Cell membrane', menu_title: 'Cell membrane', lp_type: 'content', is_religious: false },
  { segment_id: 'grade_9_islamiat.c01.p001-002', grade: 9, subject: 'Islamiat', subtopic_title: 'Seerah', menu_title: 'Seerah', lp_type: 'content', is_religious: true },
  { segment_id: 'grade_8_mathematics.c04.p051-051', grade: 8, subject: 'Mathematics', subtopic_title: 'Chapter test', menu_title: 'Chapter test', lp_type: 'assessment', is_religious: false },
];
const d = (id, userId, segment, lang, hoursAgo, extra = {}) => ({
  id, user_id: userId, render_id: `r-${id}`, segment_id: segment, lang, template_version: 'v9.6', surface: 'whatsapp', delivered_at: ago(hoursAgo), ...extra,
});
const DELIVERIES = [
  d('11111111-0000-4000-8000-000000000001', T, SEGMENTS[0].segment_id, 'en', 30),
  d('11111111-0000-4000-8000-000000000002', T, SEGMENTS[0].segment_id, 'en', 3),     // the same lesson re-tapped: one row, the newest
  d('11111111-0000-4000-8000-000000000003', T, SEGMENTS[1].segment_id, 'ur', 5),
  d('11111111-0000-4000-8000-000000000004', T, SEGMENTS[2].segment_id, 'ur', 50),
  d('11111111-0000-4000-8000-000000000005', T, SEGMENTS[3].segment_id, 'ur', 2),     // religious: held
  d('11111111-0000-4000-8000-000000000006', T, SEGMENTS[4].segment_id, 'en', 1),     // an assessment day
  d('11111111-0000-4000-8000-000000000007', OTHER, SEGMENTS[2].segment_id, 'en', 1), // another teacher's
  d('11111111-0000-4000-8000-000000000008', T, SEGMENTS[2].segment_id, 'en', 24 * 40), // outside the window
];

function seed(extra = {}) {
  mockDb = createMemorySupabase({
    niete_lp612_deliveries: DELIVERIES,
    niete_lp612_segments: SEGMENTS,
    quizzes: [],
    users: [{ id: T, phone_number: PHONE, preferred_language: 'en' }],
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSent.length = 0; mockJobs.length = 0; mockKv.clear();
  process.env.QUIZ_LP612_SOURCE = 'on';
  delete process.env.TRANSCRIPT_QUIZ_SUBJECTS;
  delete process.env.LP_612_RELIGIOUS_ENABLED;
  seed();
});
afterAll(() => { delete process.env.QUIZ_LP612_SOURCE; });

describe('the contract the /quiz registry reads', () => {
  test('source lp612, labelled "From lesson plan" like every lesson-plan row', () => {
    expect(Provider.source).toBe('lp612');
    expect(Provider.labelKey).toBe('tqRowFromLessonPlan');
    expect(typeof Provider.list).toBe('function');
    expect(typeof Provider.start).toBe('function');
    expect(typeof Provider.get).toBe('function');
    expect(typeof Provider.existingQuiz).toBe('function');
  });
});

describe('list — the teacher\'s 6-12 lessons with no quiz yet, newest first', () => {
  test('one row per lesson (its newest delivery), this teacher only, the last 30 days, held and assessment days left out', async () => {
    const items = await Provider.list(T, { limit: 20 });
    expect(items.map((i) => i.lessonRef)).toEqual([
      '11111111-0000-4000-8000-000000000002', // maths, re-tapped 3 h ago
      '11111111-0000-4000-8000-000000000003', // urdu 5 h ago
      '11111111-0000-4000-8000-000000000004', // biology 50 h ago
    ]);
    const [maths, urdu, bio] = items;
    expect(maths).toEqual(expect.objectContaining({
      source: 'lp612', grade: 8, subject: 'maths', topic: 'Inverse proportion',
    }));
    expect(urdu.subject).toBe('urdu');
    expect(bio.subject).toBe('science');
    items.forEach((i) => {
      expect(i.lessonRef).toMatch(/^[A-Za-z0-9-]+$/);
      expect(Date.parse(i.date)).not.toBeNaN();
    });
  });

  test('a lesson whose quiz already exists is not offered again', async () => {
    seed({
      quizzes: [{
        id: 'q-1', teacher_id: T, quiz_source: 'lp612', status: 'sent', created_at: ago(2),
        meta: { lessons: [{ segment_id: SEGMENTS[1].segment_id, lang: 'ur', template_version: 'v9.6' }] },
      }],
    });
    const refs = (await Provider.list(T)).map((i) => i.lessonRef);
    expect(refs).not.toContain('11111111-0000-4000-8000-000000000003');
    expect(refs).toContain('11111111-0000-4000-8000-000000000002');
  });

  test('a subject the quiz is not switched on for (TRANSCRIPT_QUIZ_SUBJECTS) is not listed', async () => {
    process.env.TRANSCRIPT_QUIZ_SUBJECTS = 'maths,science';
    const subjects = (await Provider.list(T)).map((i) => i.subject);
    expect(subjects).toEqual(['maths', 'science']);
  });

  test('switched off (QUIZ_LP612_SOURCE not on) it lists nothing and reads nothing', async () => {
    delete process.env.QUIZ_LP612_SOURCE;
    const spy = jest.spyOn(mockDb, 'from');
    expect(await Provider.list(T)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test('the ledger not on this database lists nothing — and never throws into the menu', async () => {
    const from = mockDb.from;
    mockDb.from = (t) => (t === 'niete_lp612_deliveries'
      ? { select: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) }) }) }) }) }
      : from(t));
    await expect(Provider.list(T)).resolves.toEqual([]);
    expect(logToFile).toHaveBeenCalled();
  });
});

describe('start — the tap makes the quiz, once', () => {
  const MATHS = '11111111-0000-4000-8000-000000000002';
  const URDU = '11111111-0000-4000-8000-000000000003';

  test('an Urdu lesson (no language choice) writes the lp612 quiz row and queues it', async () => {
    const out = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE, via: 'list' });
    expect(out.outcome).toBe('queued');
    const [quiz] = mockDb.table('quizzes');
    expect(quiz).toEqual(expect.objectContaining({
      id: out.quizId, teacher_id: T, quiz_source: 'lp612', coaching_session_id: null, status: 'generating',
      subject: 'urdu', grade: '7', topic: 'الفاظ و معنی',
    }));
    expect(quiz.meta).toEqual(expect.objectContaining({
      step: 'digest', source: 'list', class: { grade: 7, subject: 'urdu' },
      lessons: [expect.objectContaining({
        segment_id: SEGMENTS[1].segment_id, lang: 'ur', template_version: 'v9.6', render_id: `r-${URDU}`, title: 'الفاظ و معنی',
      })],
    }));
    expect(quiz.meta.lesson_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockJobs).toEqual([expect.objectContaining({ jobType: 'quiz_generate', payload: expect.objectContaining({ quizId: out.quizId }) })]);
    expect(mockSent.some((m) => m.fn === 'sendMessage' && m.args[0] === UX_STRINGS.lpQuizMaking.en)).toBe(true);
  });

  test('a maths lesson asks the quiz language first and queues nothing until it is answered', async () => {
    const out = await Provider.start({ id: T, preferred_language: 'en' }, MATHS, { phone: PHONE, via: 'list' });
    expect(out.outcome).toBe('asked');
    const [quiz] = mockDb.table('quizzes');
    expect(quiz.status).toBe('offered');
    expect(quiz.meta).toEqual(expect.objectContaining({ awaiting_language: true, step: 'awaiting_language' }));
    expect(mockJobs).toEqual([]);
    expect(mockSent.some((m) => m.fn === 'sendInteractiveButtons')).toBe(true);
  });

  test('a language chosen on the Flow\'s lesson screen makes it at once', async () => {
    const out = await Provider.start({ id: T, preferred_language: 'en' }, MATHS, { phone: PHONE, via: 'flow', quizLanguage: 'ur' });
    expect(out.outcome).toBe('queued');
    const [quiz] = mockDb.table('quizzes');
    expect(quiz).toEqual(expect.objectContaining({ status: 'generating', language: 'ur' }));
    expect(quiz.meta.source).toBe('flow');
  });

  test('a second tap makes no second quiz', async () => {
    const first = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE });
    const second = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE });
    expect(mockDb.table('quizzes')).toHaveLength(1);
    expect(second).toEqual(expect.objectContaining({ outcome: 'already', quizId: first.quizId }));
  });

  test('"already" is answered by the caller: the provider hands back the quiz that covers the lesson and says nothing', async () => {
    // The registry contract: the list/Flow caller answers `already` with the existing quiz
    // (the same answer as a tap on that quiz's own row). A provider that also answered would
    // send the teacher two messages for one tap.
    const first = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE });
    const sentBefore = mockSent.length;
    const second = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE });
    expect(second.outcome).toBe('already');
    expect(second.existing).toEqual(expect.objectContaining({ id: first.quizId }));
    expect(mockSent.slice(sentBefore)).toEqual([]);
  });

  test('a tap that queues the quiz is the teacher\'s yes: the funnel records it as accepted, stream lp612', async () => {
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    const out = await Provider.start({ id: T, preferred_language: 'en' }, URDU, { phone: PHONE, via: 'flow' });
    expect(out.outcome).toBe('queued');
    const accepted = logEvent.mock.calls.filter((c) => c[0] === 'quiz_funnel.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0][1]).toEqual(expect.objectContaining({ quiz_id: out.quizId, source: 'lp612', channel: 'quiz_menu' }));
  });

  test('a tap that only asks the language is not yet a yes — the answer to the ask is', async () => {
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    const out = await Provider.start({ id: T, preferred_language: 'en' }, MATHS, { phone: PHONE, via: 'list' });
    expect(out.outcome).toBe('asked');
    expect(logEvent.mock.calls.filter((c) => c[0] === 'quiz_funnel.accepted')).toHaveLength(0);
  });

  test('another teacher\'s lesson, a held lesson or an assessment day is not made', async () => {
    for (const ref of ['11111111-0000-4000-8000-000000000007', '11111111-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000006']) {
      // eslint-disable-next-line no-await-in-loop
      const out = await Provider.start({ id: T, preferred_language: 'en' }, ref, { phone: PHONE });
      expect(out.outcome).toBe('unavailable');
    }
    expect(mockDb.table('quizzes')).toHaveLength(0);
    expect(mockSent.filter((m) => m.args[0] === UX_STRINGS.tqNotYours.en)).toHaveLength(3);
  });
});

describe('QUIZ_LP612_SOURCE off', () => {
  test('a tap on a listed lesson is answered as unavailable and writes nothing', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    const out = await Provider.start({ id: T, preferred_language: 'en' }, '11111111-0000-4000-8000-000000000003', { phone: PHONE });
    expect(out.outcome).toBe('unavailable');
    expect(mockDb.table('quizzes')).toHaveLength(0);
    expect(mockJobs).toEqual([]);
  });

  test('it is read at call time — switching it back on needs no restart', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    expect(await Provider.list(T)).toEqual([]);
    process.env.QUIZ_LP612_SOURCE = 'on';
    expect((await Provider.list(T)).length).toBeGreaterThan(0);
  });
});

describe('the queue refusing the job', () => {
  test('the quiz fails queue_failed, keeps its lesson, says it could not start — and the funnel names the 6-12 stream', async () => {
    const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    SQS.queueJob.mockRejectedValueOnce(new Error('queue down'));
    const out = await Provider.start({ id: T, preferred_language: 'en' }, '11111111-0000-4000-8000-000000000003', { phone: PHONE });
    expect(out.outcome).toBe('queue_failed');
    const [quiz] = mockDb.table('quizzes');
    expect(quiz.status).toBe('failed');
    expect(quiz.meta).toEqual(expect.objectContaining({ error: 'queue_failed', lessons: [expect.objectContaining({ segment_id: SEGMENTS[1].segment_id })] }));
    expect(mockSent.some((m) => m.args[0] === UX_STRINGS.lpQuizCouldNotStart.en)).toBe(true);
    const failed = logEvent.mock.calls.find((c) => c[0] === 'quiz_funnel.generation_failed');
    expect(failed && failed[1]).toEqual(expect.objectContaining({ source: 'lp612', reason: 'queue_failed' }));
  });
});
