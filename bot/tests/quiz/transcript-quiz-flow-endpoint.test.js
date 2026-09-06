'use strict';
/**
 * R6 lane M — `/quiz` as ONE WhatsApp Flow.
 *
 * The operator's three items, encoded as tests:
 *   1. paging never leaves the Flow  → a `page` step answers with the SAME
 *      screen id and the next slice, plus the Newer/Older items;
 *   2. a lesson tap continues the Flow → a `lesson` step answers with the
 *      lesson's live per-student results and the actions that apply to it;
 *   3. nothing but the terminal screen ends the Flow → every action answers
 *      with DONE, and the work happens AFTER that response is returned.
 *
 * The supabase stub applies eq/is/in/range as real filters over fixtures, so a
 * source query that forgets `.eq('user_id', …)` fails here rather than leaking
 * another teacher's lesson at runtime (the idiom in
 * video-quiz-report-self-test.test.js).
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/transcript-quiz-handoff.service', () => ({
  sendHandoff: jest.fn().mockResolvedValue({ ok: true, reused: true, pdfSent: true }),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  generate: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const SQSQueueService = require('../../shared/services/queue/sqs-queue.service');
const Handoff = require('../../shared/services/quiz/transcript-quiz-handoff.service');
const Report = require('../../shared/services/quiz/video-quiz-report.service');
const { logEvent } = require('../../shared/utils/structured-logger');

const endpoint = require('../../shared/routes/transcript-quiz-flow-endpoint');

const TEACHER = 'teacher-1';
const OTHER = 'teacher-2';
const TOKEN = `${TEACHER}:transcript-quiz:1757100000000`;

const cp = (s) => [...String(s || '')].length;
const LONG_TRANSCRIPT = 'x'.repeat(4000);

/** A chain that really filters, orders and ranges, like PostgREST would. */
function makeChain(rows, writes) {
  let data = [...(rows || [])];
  let desc = false;
  let orderKey = null;
  const chain = {
    select: () => chain,
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    neq: (f, v) => { data = data.filter((r) => r[f] !== v); return chain; },
    is: (f, v) => {
      data = data.filter((r) => (v === null ? (r[f] === null || r[f] === undefined) : r[f] === v));
      return chain;
    },
    in: (f, vs) => { data = data.filter((r) => vs.includes(r[f])); return chain; },
    order: (f, opts) => { orderKey = f; desc = opts && opts.ascending === false; return chain; },
    range: (from, to) => {
      if (orderKey) {
        data = [...data].sort((a, b) => {
          const av = new Date(a[orderKey]).getTime();
          const bv = new Date(b[orderKey]).getTime();
          return desc ? bv - av : av - bv;
        });
      }
      data = data.slice(from, to + 1);
      return chain;
    },
    limit: (n) => { data = data.slice(0, n); return chain; },
    update: (patch) => { writes.push({ op: 'update', patch }); return chain; },
    insert: (row) => { writes.push({ op: 'insert', row }); data = [{ id: 'new-quiz', ...row }]; return chain; },
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}

let writes;
function stub(tables) {
  writes = [];
  supabase.from.mockImplementation((t) => makeChain(tables[t] || [], writes));
}

function session(n, extra = {}) {
  return {
    id: `s-${n}`,
    user_id: TEACHER,
    status: 'completed',
    observation_type: null,
    created_at: new Date(Date.UTC(2026, 8, 1, 6, 0, 0) - n * 86400000).toISOString(),
    transcript_text: LONG_TRANSCRIPT,
    analysis_data: { topic: `Lesson topic number ${n}`, subject: 'science' },
    ...extra,
  };
}

const users = [
  { id: TEACHER, phone_number: '923001112222', preferred_language: 'en' },
  { id: OTHER, phone_number: '923009998888', preferred_language: 'en' },
];

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
describe('INIT → the LESSONS screen', () => {
  test('answers with LESSONS, the newest lesson first, and the FULL topic on every item', async () => {
    stub({ users, coaching_sessions: [session(1), session(2)], quizzes: [], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizInit(TOKEN);

    expect(out.screen).toBe('LESSONS');
    expect(out.data.items.length).toBe(2);
    const first = out.data.items[0];
    expect(first.id).toBe('s-1');
    // The full topic is never truncated away: the NavigationList metadata slot
    // is 80 code points, four times a WhatsApp list row's description.
    expect(first['main-content'].metadata).toBe('Lesson topic number 1');
    expect(first['on-click-action']).toEqual({
      name: 'data_exchange',
      payload: { step: 'lesson', session_id: 's-1' },
    });
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_opened', expect.objectContaining({ userId: TEACHER }));
  });

  test('every item fits Meta’s NavigationList caps (30 / 20 / 80) and there are never more than 20', async () => {
    const many = Array.from({ length: 25 }, (_, i) => session(i + 1, {
      analysis_data: { topic: 'A very long lesson topic that would blow past a list row description cap easily', subject: 'science' },
    }));
    stub({ users, coaching_sessions: many, quizzes: [], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizInit(TOKEN);

    expect(out.data.items.length).toBeLessThanOrEqual(20);
    for (const item of out.data.items) {
      expect(cp(item['main-content'].title)).toBeLessThanOrEqual(30);
      expect(cp(item['main-content'].description)).toBeLessThanOrEqual(20);
      expect(cp(item['main-content'].metadata)).toBeLessThanOrEqual(80);
    }
  });

  test('an empty page-1 (no lessons at all) still answers a renderable screen, never a dead end', async () => {
    stub({ users, coaching_sessions: [], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    expect(out.screen).toBe('LESSONS');
    expect(Array.isArray(out.data.items)).toBe(true);
    expect(out.data.items.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
describe('paging stays inside the Flow (operator item 1)', () => {
  const many = Array.from({ length: 40 }, (_, i) => session(i + 1));

  test('page 1 ends with an "older" item and no "newer" item', async () => {
    stub({ users, coaching_sessions: many, quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    const ids = out.data.items.map((i) => i.id);
    expect(ids).toContain('__older__');
    expect(ids).not.toContain('__newer__');
    const older = out.data.items.find((i) => i.id === '__older__');
    expect(older['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'page', page: 2 } });
  });

  test('a page step answers with the SAME screen id and the next slice', async () => {
    stub({ users, coaching_sessions: many, quizzes: [], quiz_sessions: [] });
    const page1 = await endpoint.handleTranscriptQuizInit(TOKEN);
    const page2 = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'page', page: 2 });

    expect(page2.screen).toBe('LESSONS');
    const p1 = page1.data.items.filter((i) => !i.id.startsWith('__')).map((i) => i.id);
    const p2 = page2.data.items.filter((i) => !i.id.startsWith('__')).map((i) => i.id);
    expect(p2.length).toBeGreaterThan(0);
    expect(p1.some((id) => p2.includes(id))).toBe(false);
    const ids = page2.data.items.map((i) => i.id);
    expect(ids).toContain('__newer__');
    expect(ids).toContain('__older__');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_page', expect.objectContaining({ page: 2 }));
  });

  test('the last page carries a "newer" item and no "older" item', async () => {
    stub({ users, coaching_sessions: many, quizzes: [], quiz_sessions: [] });
    const last = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'page', page: 3 });
    const ids = last.data.items.map((i) => i.id);
    expect(ids).toContain('__newer__');
    expect(ids).not.toContain('__older__');
  });
});

// ---------------------------------------------------------------------------
describe('a lesson tap continues the Flow with the live results (operator item 2)', () => {
  const SENT_QUIZ = {
    id: 'q-1', coaching_session_id: 's-1', teacher_id: TEACHER, quiz_source: 'transcript',
    status: 'sent', topic: 'Electric circuits', subject: 'science', language: 'en',
    meta: { share_code_id: 'sc-1', student_message: 'forward me' },
  };
  const CHILDREN = [
    { id: 'qs-1', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Ayesha', student_class: '5-A', status: 'completed', total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
    { id: 'qs-2', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Bilal', student_class: '5-A', status: 'completed', total_questions_answered: 8, correct_answers: 4, mastery_percentage: 50 },
    { id: 'qs-3', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Danish', student_class: '5-A', status: 'active', total_questions_answered: 2, correct_answers: 1, mastery_percentage: null },
    // the teacher's own test run — R5 D8: never a pupil in her own numbers
    { id: 'qs-self', quiz_id: 'q-1', user_id: TEACHER, invited_by_student_id: null, student_name: 'QA Load Test', student_class: null, status: 'completed', total_questions_answered: 8, correct_answers: 8, mastery_percentage: 100 },
  ];

  test('LESSON carries one line per child, the counts, and never the teacher’s own run', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: CHILDREN });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });

    expect(out.screen).toBe('LESSON');
    expect(out.data.heading).toContain('Electric circuits');
    expect(out.data.results).toContain('Ayesha');
    expect(out.data.results).toContain('7/8');
    expect(out.data.results).toContain('Bilal');
    expect(out.data.results).toContain('Danish');           // started, not finished
    expect(out.data.results).not.toContain('QA Load Test');  // the self-test
    expect(out.data.results).toMatch(/3 started/);            // 4 rows minus the self-test
    expect(out.data.results).toMatch(/2 finished/);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_lesson', expect.objectContaining({
      status: 'sent', started: 3, finished: 2,
    }));
  });

  test('a SENT quiz offers exactly Generate report and Resend link', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: CHILDREN });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.map((a) => a.id)).toEqual(['report', 'link']);
    expect(out.data.quiz_id).toBe('q-1');
    expect(out.data.actions_visible).toBe(true);
  });

  test('a REPORT_SENT quiz offers the same two, and the label never says "regenerate"', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'report_sent' }], quiz_sessions: CHILDREN,
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.map((a) => a.id)).toEqual(['report', 'link']);
    expect(out.data.actions[0].title).toBe('Generate report');
  });

  test('a lesson with NO quiz offers making it, one option per language when the subject leaves a choice', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.length).toBe(2);
    expect(out.data.actions.map((a) => a.id).sort()).toEqual(['make:en', 'make:ur']);
  });

  test('an Urdu-medium subject skips the language choice and offers one Make option', async () => {
    stub({
      users,
      coaching_sessions: [session(1, { analysis_data: { topic: 'واحد اور جمع', subject: 'urdu' } })],
      quizzes: [], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.map((a) => a.id)).toEqual(['make:ur']);
  });

  test('a quiz being made shows the status and offers nothing to tap', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'generating', meta: {} }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions).toEqual([]);
    expect(out.data.actions_visible).toBe(false);
    expect(out.data.action_required).toBe(false);
  });

  test('a FAILED quiz offers making it again', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'failed' }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.every((a) => a.id.startsWith('make'))).toBe(true);
  });

  test('another teacher’s session is refused — the Flow stays on LESSONS with a message', async () => {
    stub({
      users,
      coaching_sessions: [session(1), { ...session(9), id: 's-other', user_id: OTHER }],
      quizzes: [], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-other' });
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBeTruthy();
    expect(Array.isArray(out.data.items)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the actions run AFTER the response (operator item 3)', () => {
  const SENT_QUIZ = {
    id: 'q-1', coaching_session_id: 's-1', teacher_id: TEACHER, quiz_source: 'transcript',
    status: 'sent', topic: 'Electric circuits', subject: 'science', language: 'en',
    meta: { share_code_id: 'sc-1', student_message: 'forward me' },
  };

  test('report: DONE comes back BEFORE Report.generate resolves, and force-refetches', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [] });
    let release;
    Report.generate.mockImplementation(() => new Promise((r) => { release = r; }));

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'report', session_id: 's-1', quiz_id: 'q-1',
    });

    expect(out.screen).toBe('DONE');
    expect(out.data.heading).toBeTruthy();
    await new Promise((r) => setImmediate(r));
    expect(Report.generate).toHaveBeenCalledWith('sc-1', { reason: 'requested', force: true });
    release(true);
    await new Promise((r) => setImmediate(r));
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_done', expect.objectContaining({ action: 'report', ok: true }));
  });

  test('link: the SAME hand-off the teacher already had, never a new code', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'link', session_id: 's-1', quiz_id: 'q-1',
    });

    expect(out.screen).toBe('DONE');
    await new Promise((r) => setImmediate(r));
    expect(Handoff.sendHandoff).toHaveBeenCalledWith('q-1', '923001112222', { firstSend: false });
  });

  test('make: claims the lesson and enqueues generation in the language the teacher picked', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'make:en', session_id: 's-1', quiz_id: '',
    });

    expect(out.screen).toBe('DONE');
    await new Promise((r) => setImmediate(r));
    const insert = writes.find((w) => w.op === 'insert');
    expect(insert).toBeDefined();
    expect(insert.row).toMatchObject({ teacher_id: TEACHER, quiz_source: 'transcript', coaching_session_id: 's-1', language: 'en', status: 'generating' });
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(
      'new-quiz', 'quiz_generate', expect.objectContaining({ quizId: 'new-quiz' }), expect.anything(),
    );
  });

  test('an action with nothing selected keeps the teacher on LESSON with a message', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: '', session_id: 's-1', quiz_id: 'q-1',
    });
    expect(out.screen).toBe('LESSON');
    expect(out.data.error_message).toBeTruthy();
    expect(Report.generate).not.toHaveBeenCalled();
    expect(Handoff.sendHandoff).not.toHaveBeenCalled();
  });

  test('a report asked for on a quiz with no share code does not pretend it sent one', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, meta: {} }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'report', session_id: 's-1', quiz_id: 'q-1',
    });
    expect(out.screen).toBe('LESSON');
    expect(out.data.error_message).toBeTruthy();
    expect(Report.generate).not.toHaveBeenCalled();
  });

  test('a quiz belonging to another teacher is never actioned', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, teacher_id: OTHER }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'link', session_id: 's-1', quiz_id: 'q-1',
    });
    expect(out.data.error_message).toBeTruthy();
    await new Promise((r) => setImmediate(r));
    expect(Handoff.sendHandoff).not.toHaveBeenCalled();
  });

  test('the DONE screen is logged as the close of the Flow', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [] });
    await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', action: 'link', session_id: 's-1', quiz_id: 'q-1',
    });
    await new Promise((r) => setImmediate(r));
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action', expect.objectContaining({ action: 'link' }));
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_closed', expect.anything());
  });
});

// ---------------------------------------------------------------------------
describe('tokens and back', () => {
  test('a token whose user does not exist answers a screen, never a throw', async () => {
    stub({ users: [], coaching_sessions: [], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizInit('nobody:transcript-quiz:1');
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBeTruthy();
  });

  test('BACK re-serves the lessons list', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizBack(TOKEN, 'LESSON');
    expect(out.screen).toBe('LESSONS');
    expect(out.data.items.length).toBe(1);
  });

  test('an unknown step answers the current screen with a message instead of a dead end', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'nonsense' });
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('the Flow JSON and the endpoint agree', () => {
  const flow = require('../../../docs/flows/transcript-quiz-flow.json');

  test('every ${data.x} a screen renders is supplied by the endpoint for that screen', async () => {
    stub({
      users,
      coaching_sessions: [session(1)],
      quizzes: [{
        id: 'q-1', coaching_session_id: 's-1', teacher_id: TEACHER, quiz_source: 'transcript',
        status: 'sent', topic: 'Electric circuits', subject: 'science', language: 'en',
        meta: { share_code_id: 'sc-1', student_message: 'forward me' },
      }],
      quiz_sessions: [],
    });
    const responses = {
      LESSONS: await endpoint.handleTranscriptQuizInit(TOKEN),
      LESSON: await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' }),
      DONE: await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
        step: 'action', action: 'link', session_id: 's-1', quiz_id: 'q-1',
      }),
    };
    await new Promise((r) => setImmediate(r));

    for (const screen of flow.screens) {
      const rendered = JSON.stringify(screen.layout);
      const refs = [...rendered.matchAll(/\$\{data\.([a-z_]+)\}/g)].map((m) => m[1]);
      const supplied = responses[screen.id].data;
      for (const ref of new Set(refs)) {
        expect(`${screen.id}.${ref}`).toBe(`${screen.id}.${Object.prototype.hasOwnProperty.call(supplied, ref) ? ref : 'MISSING'}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('the Urdu teacher gets the same screens, inside the same caps', () => {
  const URDU_TEACHER = 'teacher-ur';
  const UR_TOKEN = `${URDU_TEACHER}:transcript-quiz:1757100000000`;
  const urUsers = [{ id: URDU_TEACHER, phone_number: '923004445555', preferred_language: 'ur' }];
  const urSession = {
    ...session(1), user_id: URDU_TEACHER,
    analysis_data: { topic: 'واحد اور جمع — اسم کی گنتی اور اس کی مثالیں', subject: 'urdu' },
  };
  const urQuiz = {
    id: 'q-ur', coaching_session_id: 's-1', teacher_id: URDU_TEACHER, quiz_source: 'transcript',
    status: 'report_sent', topic: 'واحد اور جمع', subject: 'urdu', language: 'ur',
    meta: { share_code_id: 'sc-ur', student_message: 'forward me' },
  };
  const urChildren = [
    { id: 'u1', quiz_id: 'q-ur', user_id: null, invited_by_student_id: null, student_name: 'عائشہ', student_class: '5-A', status: 'completed', total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
    { id: 'u2', quiz_id: 'q-ur', user_id: null, invited_by_student_id: null, student_name: 'Bilal', student_class: '5-A', status: 'active', total_questions_answered: 1, correct_answers: 1, mastery_percentage: null },
  ];

  test('every LESSONS item is inside 30 / 20 / 80 in Urdu too', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...urSession, id: `s-${i + 1}`, created_at: new Date(Date.UTC(2026, 8, 1) - i * 86400000).toISOString() }));
    stub({ users: urUsers, coaching_sessions: many, quizzes: [], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizInit(UR_TOKEN);
    expect(out.data.items.length).toBeLessThanOrEqual(20);
    for (const item of out.data.items) {
      expect(cp(item['main-content'].title)).toBeLessThanOrEqual(30);
      expect(cp(item['main-content'].description)).toBeLessThanOrEqual(20);
      expect(cp(item['main-content'].metadata)).toBeLessThanOrEqual(80);
    }
  });

  test('the LESSON screen is in Urdu, inside the heading / option / footer caps', async () => {
    stub({ users: urUsers, coaching_sessions: [urSession], quizzes: [urQuiz], quiz_sessions: urChildren });
    const out = await endpoint.handleTranscriptQuizDataExchange(UR_TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.heading).toMatch(/[؀-ۿ]/);
    expect(cp(out.data.heading)).toBeLessThanOrEqual(80);
    expect(cp(out.data.cta)).toBeLessThanOrEqual(35);
    expect(cp(out.data.actions_label)).toBeLessThanOrEqual(80);
    for (const a of out.data.actions) {
      expect(cp(a.title)).toBeLessThanOrEqual(30);
      expect(cp(a.description)).toBeLessThanOrEqual(300);
    }
    expect(cp(out.data.results)).toBeLessThanOrEqual(4096);
    // A Latin child's name inside an Urdu results block is bidi-isolated so the
    // bullet, the brackets and the score keep their side of the line.
    expect(out.data.results).toContain('⁨Bilal⁩');
    expect(out.data.results).toContain('عائشہ');
  });

  test('the DONE screen is in Urdu and its footer fits', async () => {
    stub({ users: urUsers, coaching_sessions: [urSession], quizzes: [urQuiz], quiz_sessions: urChildren });
    const out = await endpoint.handleTranscriptQuizDataExchange(UR_TOKEN, 'LESSON', {
      step: 'action', action: 'report', session_id: 's-1', quiz_id: 'q-ur',
    });
    expect(out.screen).toBe('DONE');
    expect(out.data.heading).toMatch(/[؀-ۿ]/);
    expect(cp(out.data.close)).toBeLessThanOrEqual(35);
    await new Promise((r) => setImmediate(r));
  });
});

describe('a failed teacher lookup is reported, never mistaken for an unknown teacher', () => {
  const { logToFile } = require('../../shared/utils/logger');
  function stubFailingUsers() {
    writes = [];
    supabase.from.mockImplementation((t) => {
      const chain = makeChain(t === 'users' ? users : [], writes);
      if (t === 'users') chain.maybeSingle = async () => ({ data: null, error: { message: 'boom: fetch failed' } });
      return chain;
    });
  }
  beforeEach(() => { logEvent.mockClear(); logToFile.mockClear(); });

  test('INIT answers the retry copy, logs the error and emits flow_lookup_failed', async () => {
    stubFailingUsers();
    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBe('Could not load your lessons just now. Please tap again.');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_lookup_failed', expect.objectContaining({ error: 'boom: fetch failed' }));
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('lookup failed'), expect.objectContaining({ error: 'boom: fetch failed' }), 'error');
  });

  test('a data_exchange step answers the same retry copy, not "could not be found"', async () => {
    stubFailingUsers();
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'page', page: 2 });
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBe('Could not load your lessons just now. Please tap again.');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_lookup_failed', expect.objectContaining({ step: 'page' }));
  });

  test('a genuinely unknown teacher still gets the not-found copy and no lookup_failed event', async () => {
    stub({ users, coaching_sessions: [], quizzes: [] });
    const out = await endpoint.handleTranscriptQuizInit('nobody:transcript-quiz:1');
    expect(out.data.error_message).toBe('That lesson could not be found.');
    expect(logEvent).not.toHaveBeenCalledWith('transcript_quiz.flow_lookup_failed', expect.anything());
  });
});
