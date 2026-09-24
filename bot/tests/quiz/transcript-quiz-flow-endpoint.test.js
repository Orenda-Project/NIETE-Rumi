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

  // A child who typed STOP (or whose quiz stopped on our side) has an
  // `incomplete` session: not finished, and not still going either. The
  // results say which is which.
  test('a child whose quiz stopped is listed as stopped, never as still going', async () => {
    const { resolveUx } = require('../../shared/config/ux-strings');
    const STOPPED = { id: 'qs-4', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Esha', student_class: '5-A', status: 'incomplete', total_questions_answered: 3, correct_answers: 2, mastery_percentage: null };
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [...CHILDREN, STOPPED] });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    // Each line opens with the language's paragraph mark (text-format markLines).
    const lines = out.data.results.split('\n').map((l) => l.replace(/^[\u200E\u200F]/, ''));

    expect(lines).toContain(resolveUx('tqFlowStillGoing', { language: 'en', params: { names: 'Danish' } }));
    expect(lines).toContain(resolveUx('tqFlowStopped', { language: 'en', params: { names: 'Esha' } }));
    expect(out.data.results).toMatch(/2 finished/);
  });

  test('when every unfinished child stopped, there is no "still going" line at all', async () => {
    const { resolveUx } = require('../../shared/config/ux-strings');
    const kids = CHILDREN.map((c) => (c.id === 'qs-3' ? { ...c, status: 'incomplete' } : c));
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: kids });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });

    expect(out.data.results).not.toContain(resolveUx('tqFlowStillGoing', { language: 'en', params: { names: '' } }).trim());
    expect(out.data.results.split('\n').map((l) => l.replace(/^[\u200E\u200F]/, ''))).toContain(resolveUx('tqFlowStopped', { language: 'en', params: { names: 'Danish' } }));
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
    expect(out.data.actions.map((a) => a.id).sort()).toEqual(['make_en', 'make_ur']);
  });

  test('an Urdu-medium subject skips the language choice and offers one Make option', async () => {
    stub({
      users,
      coaching_sessions: [session(1, { analysis_data: { topic: 'واحد اور جمع', subject: 'urdu' } })],
      quizzes: [], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.map((a) => a.id)).toEqual(['make_ur']);
  });

  test('a quiz being made goes straight to its own screen, not a lesson with nothing to tap', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'generating', meta: {} }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    // It used to serve a LESSON carrying an empty, hidden chooser, which is why
    // `visible` and `required` had to be data bindings — the same bindings that
    // left the chooser's value out of the submitted payload in production.
    expect(out.screen).toBe('DONE');
  });

  test('a FAILED quiz offers making it again', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'failed' }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.actions.every((a) => a.id.startsWith('make'))).toBe(true);
  });

  // WHY a recording's quiz failed, said the way the chat said it. A failure that
  // was the MODEL's must not read as a bad recording on the lesson screen either;
  // the rows written before the split carry `digest: <message>` and were the
  // model's too (a recording quiz's digest has no source-side throw).
  const { UX_STRINGS } = require('../../shared/config/ux-strings');
  const { markLines } = require('../../shared/utils/text-format');
  // Every results line opens with the teacher language's paragraph mark.
  const marked = (key, lang) => markLines(UX_STRINGS[key][lang], UX_STRINGS.lineDirMark[lang]);
  test.each([
    ['model_failed', { error: 'model_failed' }],
    ['a pre-split digest row', { error: 'digest: transcript_quiz.digest: empty reply from m' }],
  ])('a FAILED quiz whose model failed (%s) says the recording was not the problem, and can still be made again', async (_label, meta) => {
    for (const lang of ['en', 'ur']) {
      stub({
        users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: lang }],
        coaching_sessions: [session(1)],
        quizzes: [{ ...SENT_QUIZ, status: 'failed', meta }], quiz_sessions: [],
      });
      const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
      expect(out.data.results).not.toBe(marked('tqFlowResultsFailed', lang));
      expect(out.data.results).toBe(marked('tqFlowResultsFailedModel', lang));
      expect(out.data.actions.length).toBeGreaterThan(0);
      expect(out.data.actions.every((a) => a.id.startsWith('make'))).toBe(true);
    }
  });

  test.each([
    ['validator_failed', { error: 'validator_failed' }],
    ['no marker (a row before any reason was stored)', {}],
  ])('a FAILED quiz that is not the model’s (%s) keeps the existing lesson-screen line', async (_label, meta) => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, status: 'failed', meta }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    expect(out.data.results).toBe(marked('tqFlowResultsFailed', 'en'));
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
    // One child has finished: a report with nobody finished is not offered at
    // all (see "a report is only promised when there is something to report").
    stub({
      users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ],
      quiz_sessions: [{ id: 'qs-1', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Ayesha', status: 'completed', total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 }],
    });
    let release;
    Report.generate.mockImplementation(() => new Promise((r) => { release = r; }));

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'report', session_id: 's-1', quiz_id: 'q-1',
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
      step: 'action', tq_action: 'link', session_id: 's-1', quiz_id: 'q-1',
    });

    expect(out.screen).toBe('DONE');
    await new Promise((r) => setImmediate(r));
    expect(Handoff.sendHandoff).toHaveBeenCalledWith('q-1', '923001112222', { firstSend: false });
  });

  test('make_ claims the lesson and enqueues generation in the language the teacher picked', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [], quiz_sessions: [] });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'make_en', session_id: 's-1', quiz_id: '',
    });

    // The chat already says "making it now" (enqueueGenerate sends tqMaking), so
    // the Flow closes from the endpoint instead of ending on a screen that says
    // the same thing. SUCCESS is Meta's reserved endpoint-close, not a declared
    // screen; its params are the flat discriminator the chat side routes on.
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.extension_message_response.params).toEqual({ tq_action: 'make', language: 'en' });
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
      step: 'action', tq_action: '', session_id: 's-1', quiz_id: 'q-1',
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
      step: 'action', tq_action: 'report', session_id: 's-1', quiz_id: 'q-1',
    });
    expect(out.screen).toBe('LESSON');
    expect(out.data.error_message).toBeTruthy();
    // The refusal is drawn on a screen the Flow can render: its required
    // chooser has something in it (Done), never an empty list.
    expect(out.data.actions.map((x) => x.id)).toEqual(['done']);
    expect(Report.generate).not.toHaveBeenCalled();
  });

  test('a quiz belonging to another teacher is never actioned', async () => {
    stub({
      users, coaching_sessions: [session(1)],
      quizzes: [{ ...SENT_QUIZ, teacher_id: OTHER }], quiz_sessions: [],
    });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'link', session_id: 's-1', quiz_id: 'q-1',
    });
    expect(out.data.error_message).toBeTruthy();
    await new Promise((r) => setImmediate(r));
    expect(Handoff.sendHandoff).not.toHaveBeenCalled();
  });

  test('the DONE screen is logged as the close of the Flow', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT_QUIZ], quiz_sessions: [] });
    await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'link', session_id: 's-1', quiz_id: 'q-1',
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
        step: 'action', tq_action: 'link', session_id: 's-1', quiz_id: 'q-1',
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
      step: 'action', tq_action: 'report', session_id: 's-1', quiz_id: 'q-ur',
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

// ---------------------------------------------------------------------------
// R8 lane D task 3.4 — ONE list: a quiz written from a lesson PLAN (lp_v8) has
// no coaching session, and still belongs in /quiz beside the recorded lessons.
describe('an lp_v8 quiz in the /quiz Flow (PLAN_R8 D11)', () => {
  const LP = {
    id: 'lpq-1', teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8',
    status: 'sent', topic: 'Add a 3-digit and a 2-digit number', subject: 'maths', language: 'en',
    // between session(1) (31 Aug) and session(3) (29 Aug)
    created_at: '2026-08-30T10:00:00Z',
    meta: { lesson_date: '2026-08-30', share_code_id: 'sc-lp', student_message: 'forward me' },
  };
  const KIDS = [
    { id: 'qs-a', quiz_id: 'lpq-1', user_id: null, invited_by_student_id: null, student_name: 'Sana', student_class: '2-B', status: 'completed', total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75 },
  ];

  test('LESSONS lists it newest-first among the coaching lessons, as `date · subject` with the full topic', async () => {
    stub({ users, coaching_sessions: [session(1), session(3)], quizzes: [LP], quiz_sessions: KIDS });
    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    expect(out.data.items.map((i) => i.id)).toEqual(['s-1', 'lp_lpq-1', 's-3']);
    const item = out.data.items[1];
    expect(item['main-content'].title).toMatch(/^30 Aug · /);
    expect(item['main-content'].metadata).toBe('Add a 3-digit and a 2-digit number');
    expect(item['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'lesson', session_id: 'lp_lpq-1' } });
    out.data.items.forEach((i) => {
      expect(cp(i['main-content'].title)).toBeLessThanOrEqual(endpoint.TITLE_MAX);
      expect(cp(i['main-content'].description)).toBeLessThanOrEqual(endpoint.DESC_MAX);
    });
  });

  test('another teacher’s lp_v8 quiz is never listed', async () => {
    stub({ users, coaching_sessions: [], quizzes: [{ ...LP, teacher_id: OTHER }], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    expect(out.data.items.map((i) => i.id)).toEqual(['__empty__']);
  });

  test('its LESSON screen shows the live results and offers Generate report / Resend link — never Make', async () => {
    stub({ users, coaching_sessions: [], quizzes: [LP], quiz_sessions: KIDS });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lp_lpq-1' });
    expect(out.screen).toBe('LESSON');
    expect(out.data.heading).toContain('Add a 3-digit');
    expect(out.data.results).toContain('Sana');
    expect(out.data.actions.map((a) => a.id)).toEqual(['report', 'link']);
    expect(out.data.session_id).toBe('lp_lpq-1');
    expect(out.data.quiz_id).toBe('lpq-1');
    expect(out.data.subline).toContain('30 Aug');
  });

  test('Resend link on it runs the same hand-off, after the response', async () => {
    stub({ users, coaching_sessions: [], quizzes: [LP], quiz_sessions: KIDS });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', { step: 'action', session_id: 'lp_lpq-1', quiz_id: 'lpq-1', tq_action: 'link' });
    expect(out.screen).toBe('DONE');
    await new Promise((r) => setImmediate(r));
    expect(Handoff.sendHandoff).toHaveBeenCalledWith('lpq-1', '923001112222', { firstSend: false });
  });

  test('Generate report on it refetches the report for its share code', async () => {
    stub({ users, coaching_sessions: [], quizzes: [LP], quiz_sessions: KIDS });
    await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', { step: 'action', session_id: 'lp_lpq-1', quiz_id: 'lpq-1', tq_action: 'report' });
    await new Promise((r) => setImmediate(r));
    expect(Report.generate).toHaveBeenCalledWith('sc-lp', { reason: 'requested', force: true });
  });

  test('a make_ action on it is refused — there is no session to make it from', async () => {
    stub({ users, coaching_sessions: [], quizzes: [{ ...LP, status: 'failed', meta: { lesson_date: '2026-08-30', error: 'source_missing' } }], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', { step: 'action', session_id: 'lp_lpq-1', quiz_id: 'lpq-1', tq_action: 'make_en' });
    expect(out.screen).not.toBe('SUCCESS');
    expect(writes).toEqual([]);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
  });

  // A teacher who said yes to the afternoon offer but never answered the
  // language ask: the row waits `offered` at `awaiting_language`. The Flow gave
  // it no action and so sent the lesson to the "still being made" wait screen,
  // while nothing was being made.
  const WAIT_ID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
  const WAITING = {
    ...LP, id: WAIT_ID, status: 'offered', language: null,
    meta: { step: 'awaiting_language', awaiting_language: true, source: 'lp_offer', nudge_id: 'nudge-1', lesson_date: '2026-08-30' },
  };
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

  test('an lp_v8 quiz still waiting for its language opens its LESSON screen with the language choices — not the wait screen', async () => {
    stub({ users, coaching_sessions: [], quizzes: [WAITING], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: `lp_${WAIT_ID}` });
    expect(out.screen).toBe('LESSON');
    // The subject rule (maths → Urdu) first, exactly as the chat ask orders it.
    expect(out.data.actions.map((a) => a.id)).toEqual(['make_ur', 'make_en']);
    // A planned lesson was not "taught".
    out.data.actions.forEach((a) => expect(a.description.toLowerCase()).not.toContain('taught'));
    expect(logEvent).not.toHaveBeenCalledWith('transcript_quiz.flow_closed', expect.objectContaining({ kind: 'wait' }));
  });

  test('choosing a language there makes it on the chat ask’s own path: generating in that language, the LP quiz job queued', async () => {
    stub({ users, coaching_sessions: [], quizzes: [WAITING], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', session_id: `lp_${WAIT_ID}`, quiz_id: WAIT_ID, tq_action: 'make_en',
    });
    expect(out.screen).toBe('SUCCESS');
    await flush();
    expect(writes).toContainEqual({
      op: 'update', patch: expect.objectContaining({ status: 'generating', language: 'en' }),
    });
    // The LP job (source lp_offer) — never the transcript quiz's claim, which
    // would re-label the row and queue a job for a coaching session it has not got.
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(
      WAIT_ID, 'quiz_generate', expect.objectContaining({ quizId: WAIT_ID, source: 'lp_offer' }), expect.anything(),
    );
  });

  test('a failed lp_v8 quiz shows LP copy — never "this lesson’s recording"', async () => {
    // A failed row keeps the lessons it is written from (every generate failure write spreads meta).
    stub({ users, coaching_sessions: [], quizzes: [{ ...LP, status: 'failed', meta: { lesson_date: '2026-08-30', error: 'validator_failed', lessons: [{ lesson_id: 'g4_m_ch5_s3' }] } }], quiz_sessions: [] });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lp_lpq-1' });
    expect(out.screen).toBe('LESSON');
    expect(out.data.results.toLowerCase()).toContain('lesson plan');
    expect(out.data.results.toLowerCase()).not.toMatch(/recording|transcript/);
    // Never an empty chooser: the published LESSON screen's RadioButtonsGroup is
    // `required: true` over ${data.actions}, and an empty list cannot be drawn.
    expect(out.data.actions.map((a) => a.id)).toEqual(['remake', 'done']);
  });

  test('an lp_ id of another teacher’s quiz is not yours', async () => {
    stub({ users, coaching_sessions: [], quizzes: [{ ...LP, teacher_id: OTHER }], quiz_sessions: KIDS });
    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lp_lpq-1' });
    expect(out.screen).toBe('LESSONS');
    expect(out.data.error_message).toBeTruthy();
  });

  // A quiz written from a PLANNED lesson must never say the lesson was taught.
  // The one Flow string that does ("8 questions from what you taught in this
  // lesson", tqFlowActionMakeDesc) is endpoint data — the published Flow JSON
  // binds the actions from ${data.actions} and carries no copy of its own — and
  // it rides only a make_ action, which no lp_v8 lesson offers today. This walks
  // every lp_v8 state in both languages through the real endpoint, so the day a
  // make_ action is added for one (an awaiting-language row), the copy on it has
  // to say planned or this goes red.
  test.each([
    ['offered, awaiting its language', { status: 'offered', meta: { lesson_date: '2026-08-30', step: 'awaiting_language', awaiting_language: true } }],
    ['being written', { status: 'generating', meta: { lesson_date: '2026-08-30', step: 'author' } }],
    ['sent', {}],
    ['report sent', { status: 'report_sent' }],
    ['failed (model)', { status: 'failed', meta: { lesson_date: '2026-08-30', error: 'model_failed' } }],
  ])('no screen of an lp_v8 lesson says "taught", in either language — %s', async (_label, over) => {
    for (const lang of ['en', 'ur']) {
      stub({
        users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: lang }],
        coaching_sessions: [], quizzes: [{ ...LP, ...over }], quiz_sessions: KIDS,
      });
      const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lp_lpq-1' });
      const text = JSON.stringify(out.data);
      expect(text).not.toMatch(/taught/i);
      expect(text).not.toMatch(/پڑھایا/);
    }
  });
});

// ---------------------------------------------------------------------------
// Staging, 23 Sep: a FAILED lp_v8 quiz, tapped in the /quiz Flow, showed
// WhatsApp's generic "Something went wrong" on the LESSON screen while the
// endpoint logged nothing wrong. The LESSON screen of the published Flow draws
// a RadioButtonsGroup that is `required: true` over ${data.actions}; the
// endpoint served that screen with `actions: []`, which the client cannot
// render. The rule every state is held to here: a response is renderable by the
// repo's own Flow JSON — every declared data key present with its declared
// type, and every data-bound chooser carrying 1–20 options within Meta's caps.
describe('every lp_v8 state renders a screen the /quiz Flow can draw', () => {
  const FLOW = require('../../../docs/flows/transcript-quiz-flow.json');
  const CHOOSERS = { RadioButtonsGroup: { title: 30, description: 300 }, NavigationList: null };
  const nodesOf = (node, acc = []) => {
    if (Array.isArray(node)) { node.forEach((n) => nodesOf(n, acc)); return acc; }
    if (node && typeof node === 'object') { acc.push(node); Object.values(node).forEach((v) => nodesOf(v, acc)); }
    return acc;
  };
  /** Would the published Flow render this data_exchange answer? */
  function expectRenderable(out) {
    if (out.screen === 'SUCCESS') {           // Meta's reserved endpoint-close
      expect(out.data && out.data.extension_message_response).toBeTruthy();
      return;
    }
    const screen = FLOW.screens.find((x) => x.id === out.screen);
    expect(screen).toBeTruthy();
    for (const [key, spec] of Object.entries(screen.data || {})) {
      expect(`${out.screen}.${key}:${Object.prototype.hasOwnProperty.call(out.data, key)}`).toBe(`${out.screen}.${key}:true`);
      const v = out.data[key];
      const type = Array.isArray(v) ? 'array' : typeof v;
      expect(`${out.screen}.${key}:${type}`).toBe(`${out.screen}.${key}:${spec.type}`);
    }
    for (const node of nodesOf(screen.layout)) {
      if (!(node.type in CHOOSERS)) continue;
      const bound = /^\$\{data\.([a-z_]+)\}$/.exec(node['data-source'] || node['list-items'] || '');
      if (!bound) continue;
      const items = out.data[bound[1]];
      expect(`${out.screen}.${bound[1]} has ${items.length} option(s)`).not.toBe(`${out.screen}.${bound[1]} has 0 option(s)`);
      expect(items.length).toBeLessThanOrEqual(20);
      const caps = CHOOSERS[node.type];
      for (const it of items) {
        expect(typeof it.id).toBe('string');
        if (caps) {
          expect(typeof it.title).toBe('string');
          expect(cp(it.title)).toBeLessThanOrEqual(caps.title);
          if (it.description !== undefined) expect(cp(it.description)).toBeLessThanOrEqual(caps.description);
        }
      }
    }
  }

  const LP_ID = 'a1b2c3d4-0000-4000-8000-00000000fa11';
  const LESSONS = [{ lesson_id: 'grade_4_math_ch5_seg3', asset_id: 'a-1', version_stamp: 'v1' }];
  const lpRow = (over = {}) => ({
    id: LP_ID, teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8',
    status: 'failed', topic: 'Comparing fractions', subject: 'maths', language: 'en',
    created_at: '2026-09-23T10:00:00Z',
    ...over,
    meta: { lesson_date: '2026-09-24', source: 'lp_offer', nudge_id: 'nudge-1', lessons: LESSONS, ...(over.meta || {}) },
  });
  const lessonTap = (lang = 'en', rows = [lpRow()]) => {
    stub({ users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: lang }], coaching_sessions: [], quizzes: rows, quiz_sessions: [] });
    return endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: `lp_${LP_ID}` });
  };
  const submit = (tq_action) => endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
    step: 'action', session_id: `lp_${LP_ID}`, quiz_id: LP_ID, tq_action,
  });
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
  const { UX_STRINGS } = require('../../shared/config/ux-strings');

  test('a quiz that failed on the model renders: it says so honestly, and offers Make it again and Done', async () => {
    const out = await lessonTap('en', [lpRow({ meta: { error: 'model_failed', error_detail: 'digest: empty reply' } })]);
    expectRenderable(out);
    expect(out.screen).toBe('LESSON');
    expect(out.data.actions.map((a) => a.id)).toEqual(['remake', 'done']);
    expect(out.data.results).toContain(UX_STRINGS.tqFlowResultsFailedLpModel.en);
    expect(out.data.results).toContain(UX_STRINGS.tqFlowResultsRemakeHint.en);
  });

  test('the same, for an Urdu teacher, in Urdu', async () => {
    const out = await lessonTap('ur', [lpRow({ meta: { error: 'model_failed' } })]);
    expectRenderable(out);
    expect(out.data.results).toContain(UX_STRINGS.tqFlowResultsFailedLpModel.ur);
    expect(out.data.actions.map((a) => a.title)).toEqual([UX_STRINGS.tqFlowActionRemake.ur, UX_STRINGS.tqFlowActionDone.ur]);
  });

  test('a plan with too little lesson in it says THAT, and offers only Done — a remake would fail the same way', async () => {
    const out = await lessonTap('en', [lpRow({ meta: { error: 'source_unusable' } })]);
    expectRenderable(out);
    expect(out.data.actions.map((a) => a.id)).toEqual(['done']);
    expect(out.data.results).toContain(UX_STRINGS.tqFlowResultsFailedLpUnusable.en);
    expect(out.data.results).not.toContain(UX_STRINGS.tqFlowResultsFailedLpModel.en);
  });

  test('Make it again flips the row failed → generating ONCE and queues the lesson-plan job; a second submit queues nothing', async () => {
    const row = lpRow({ meta: { error: 'model_failed' } });
    // A stateful table: the update really lands, so the second flip sees `generating`.
    writes = [];
    supabase.from.mockImplementation((t) => {
      const rows = { users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: 'en' }], quizzes: [row] }[t] || [];
      const chain = makeChain(rows, writes);
      const filters = [];
      let patch = null;
      const eq = chain.eq;
      chain.eq = (f, v) => { filters.push([f, v]); return eq(f, v); };
      const update = chain.update;
      chain.update = (p) => { patch = p; return update(p); };
      const then = chain.then;
      chain.then = (res) => {
        if (patch) {
          const hit = rows.filter((r) => filters.every(([f, v]) => r[f] === v));
          hit.forEach((r) => Object.assign(r, patch));
          return res({ data: hit.map((r) => ({ id: r.id })), error: null });
        }
        return then(res);
      };
      return chain;
    });

    const first = await submit('remake');
    expect(first.screen).toBe('SUCCESS');
    expectRenderable(first);
    await flush();
    const second = await submit('remake');
    await flush();

    expect(row.status).toBe('generating');
    expect(row.meta).toEqual(expect.objectContaining({ lessons: LESSONS, remakes: 1, previous_error: 'model_failed' }));
    expect(row.meta.error).toBeUndefined();
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(
      LP_ID, 'quiz_generate', expect.objectContaining({ quizId: LP_ID, source: 'lp_offer' }), expect.anything(),
    );
    // The second tap met a row that is no longer failed: refused on the screen, nothing queued.
    expect(second.screen).not.toBe('SUCCESS');
  });

  test('after two remakes the quiz stops offering a third', async () => {
    const out = await lessonTap('en', [lpRow({ meta: { error: 'validator_failed', remakes: 2 } })]);
    expectRenderable(out);
    expect(out.data.actions.map((a) => a.id)).toEqual(['done']);
  });

  test('Done closes the Flow and changes nothing', async () => {
    await lessonTap('en', [lpRow({ meta: { error: 'source_unusable' } })]);
    const out = await submit('done');
    await flush();
    expect(out.screen).toBe('SUCCESS');
    expectRenderable(out);
    expect(out.data.extension_message_response.params).toEqual({ tq_action: 'done' });
    expect(writes).toEqual([]);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
  });

  test('a stale submit on a lesson that has since lost its actions never gets an empty chooser', async () => {
    // Opened while it waited for its language, answered the ask in chat, then Continue.
    await lessonTap('en', [lpRow({ status: 'generating', meta: { step: 'digest' } })]);
    const out = await submit('make_en');
    expectRenderable(out);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
  });

  test.each([
    ['offered, awaiting its language', { status: 'offered', language: null, meta: { step: 'awaiting_language', awaiting_language: true } }],
    ['offered, not awaiting (no writer makes this)', { status: 'offered', meta: { step: 'digest' } }],
    ['generating', { status: 'generating', meta: { step: 'author' } }],
    ['ready (resuming at the hand-off)', { status: 'ready', meta: { step: 'ready' } }],
    ['sent', { status: 'sent', meta: { share_code_id: 'sc-1', student_message: 'forward me' } }],
    ['sent, never handed off', { status: 'sent' }],
    ['report_sent', { status: 'report_sent', meta: { share_code_id: 'sc-1', student_message: 'forward me' } }],
    ['failed — model', { status: 'failed', meta: { error: 'model_failed' } }],
    ['failed — plan unusable', { status: 'failed', meta: { error: 'source_unusable' } }],
    ['failed — plan missing', { status: 'failed', meta: { error: 'source_missing' } }],
    ['failed — checks (key disagreement)', { status: 'failed', meta: { error: 'key_disagreement' } }],
    ['failed — pre-split digest row', { status: 'failed', meta: { error: 'digest_failed', error_detail: 'digest: boom' } }],
    ['failed — queue refused, lessons lost', { status: 'failed', meta: { error: 'queue_failed', lessons: undefined } }],
    ['cancelled', { status: 'cancelled' }],
    ['declined', { status: 'declined' }],
    ['skipped', { status: 'skipped' }],
  ])('a lesson tap on an lp_v8 quiz that is %s answers with a renderable screen, in both languages', async (_label, over) => {
    for (const lang of ['en', 'ur']) {
      const out = await lessonTap(lang, [lpRow(over)]);
      expectRenderable(out);
      expect(['LESSON', 'DONE']).toContain(out.screen);
    }
  });
});

// ---------------------------------------------------------------------------
// Staging, 23 Sep: a sent lesson-plan quiz that only the teacher's own test run
// had taken. Its lesson screen said nobody had opened it — and still offered
// Generate report. The tap answered "Your report is on its way … in a minute or
// two", and nothing ever came: the report service excluded the self-test and
// declined (`video_quiz.report_suppressed {why:'nothing_completed_yet'}`), and
// the endpoint had already promised it. The rule (root rule 24d): the screen
// names the actual state, and a report is only promised when one will come.
describe('a report is only promised when there is something to report', () => {
  const { UX_STRINGS } = require('../../shared/config/ux-strings');
  const WhatsAppService = require('../../shared/services/whatsapp.service');
  const SENT = {
    id: 'q-1', coaching_session_id: 's-1', teacher_id: TEACHER, quiz_source: 'transcript',
    status: 'sent', topic: 'Electric circuits', subject: 'science', language: 'en',
    meta: { share_code_id: 'sc-1', student_message: 'forward me' },
  };
  const SELF_TEST_ONLY = [
    { id: 'qs-self', quiz_id: 'q-1', user_id: TEACHER, invited_by_student_id: null, student_name: 'Me', status: 'completed', total_questions_answered: 8, correct_answers: 8, mastery_percentage: 100 },
  ];
  const STARTED_ONLY = [
    { id: 'qs-2', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Bilal', status: 'in_progress', total_questions_answered: 2, correct_answers: 1, mastery_percentage: null },
  ];
  const ONE_FINISHED = [
    { id: 'qs-1', quiz_id: 'q-1', user_id: null, invited_by_student_id: null, student_name: 'Ayesha', status: 'completed', total_questions_answered: 8, correct_answers: 7, mastery_percentage: 88 },
  ];
  const tapLesson = () => endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
  const submit = (tq_action) => endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
    step: 'action', tq_action, session_id: 's-1', quiz_id: 'q-1',
  });
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

  test.each([
    ['only the teacher’s own test run', SELF_TEST_ONLY],
    ['children started, none finished', STARTED_ONLY],
    ['nobody at all', []],
  ])('%s: the lesson offers Resend link first and Done — never Generate report', async (_label, kids) => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT], quiz_sessions: kids });
    const out = await tapLesson();
    expect(out.screen).toBe('LESSON');
    expect(out.data.actions.map((a) => a.id)).toEqual(['link', 'done']);
  });

  test('a Generate report tap with nobody finished (a stale screen) says so honestly — never "on its way"', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT], quiz_sessions: SELF_TEST_ONLY });
    const out = await submit('report');
    await flush();
    expect(out.screen).toBe('LESSON');
    // Every results line opens with the teacher language's paragraph mark (LRM).
    expect(out.data.results).toBe(`\u200E${UX_STRINGS.tqFlowResultsNothingToReport.en}`);
    expect(out.data.actions.map((a) => a.id)).toEqual(['link', 'done']);
    expect(Report.generate).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_refused',
      expect.objectContaining({ reason: 'nothing_to_report' }));
    expect(logEvent).not.toHaveBeenCalledWith('transcript_quiz.flow_closed', expect.objectContaining({ kind: 'report' }));
  });

  test('the same, for an Urdu teacher, in Urdu', async () => {
    stub({
      users: [{ id: TEACHER, phone_number: '923001112222', preferred_language: 'ur' }],
      coaching_sessions: [session(1)], quizzes: [SENT], quiz_sessions: SELF_TEST_ONLY,
    });
    const out = await submit('report');
    expect(out.data.results).toBe(`\u200F${UX_STRINGS.tqFlowResultsNothingToReport.ur}`);
  });

  test('once one child has finished, Generate report comes first and runs', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT], quiz_sessions: ONE_FINISHED });
    expect((await tapLesson()).data.actions.map((a) => a.id)).toEqual(['report', 'link']);
    const out = await submit('report');
    await flush();
    expect(out.screen).toBe('DONE');
    expect(Report.generate).toHaveBeenCalledWith('sc-1', { reason: 'requested', force: true });
  });

  test('if the report service still declines after the screen was answered, the teacher is told in chat', async () => {
    stub({ users, coaching_sessions: [session(1)], quizzes: [SENT], quiz_sessions: ONE_FINISHED });
    Report.generate.mockResolvedValueOnce(false);
    await submit('report');
    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS.tqNoReportYet.en);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_action_done', expect.objectContaining({ action: 'report', ok: false }));
  });
});

// A child who re-opens the class link gets a new session row (nothing blocks a
// retake), and one who typed STOP and came back has two. /quiz read every row:
// the child counted twice in "started", a retake counted again in "finished"
// and in the average, and a child who stopped and then finished was listed as
// finished AND as stopped. The class report already counts one attempt per
// child (the latest completed, else the latest row); /quiz now counts the same.
describe('/quiz counts one attempt per child, as the class report does', () => {
  const { resolveUx } = require('../../shared/config/ux-strings');
  const at = (d, h) => new Date(Date.UTC(2026, 8, d, h, 0, 0)).toISOString();
  const quizFor = (id, sessionId, extra = {}) => ({
    id, coaching_session_id: sessionId, teacher_id: TEACHER, quiz_source: 'transcript',
    status: 'sent', topic: `Topic ${id}`, subject: 'science', language: 'en',
    meta: { share_code_id: `sc-${id}`, student_message: 'forward me' }, ...extra,
  });
  const row = (id, quizId, studentId, name, status, extra = {}) => ({
    id, quiz_id: quizId, user_id: null, invited_by_student_id: null, student_id: studentId,
    student_name: name, student_class: '5-A', status,
    total_questions_answered: 0, correct_answers: 0, mastery_percentage: null,
    completed_at: null, created_at: at(10, 8), ...extra,
  });
  const done = (pct, completedDay) => ({
    total_questions_answered: 8, correct_answers: Math.round((pct / 100) * 8), mastery_percentage: pct,
    completed_at: at(completedDay, 9),
  });
  const ROWS = [
    row('a1', 'q-1', 'st-a', 'Ayesha', 'completed', done(88, 10)),
    row('b1', 'q-1', 'st-b', 'Bilal', 'completed', done(50, 10)),
    row('d1', 'q-1', 'st-d', 'Danish', 'in_progress'),
    // Esha typed STOP, re-opened the link and finished.
    row('e1', 'q-1', 'st-e', 'Esha', 'incomplete', { created_at: at(10, 8), total_questions_answered: 3, correct_answers: 2 }),
    row('e2', 'q-1', 'st-e', 'Esha', 'completed', { created_at: at(11, 8), ...done(75, 11) }),
    // Farah finished, retook it and did better.
    row('f1', 'q-1', 'st-f', 'Farah', 'completed', { created_at: at(10, 8), ...done(38, 10) }),
    row('f2', 'q-1', 'st-f', 'Farah', 'completed', { created_at: at(12, 8), ...done(88, 12) }),
    // The teacher's own run never counts.
    { ...row('t1', 'q-1', null, 'QA Load Test', 'completed', done(100, 10)), user_id: TEACHER },
    // Esha on ANOTHER lesson's quiz is a child of that quiz, not a retake of this one.
    row('e3', 'q-2', 'st-e', 'Esha', 'in_progress'),
  ];

  /** The same stub, except quiz_sessions answers only the columns asked for —
   *  so a collapse that needs a column the select forgot cannot pass here. */
  function stubProjecting(tables) {
    writes = [];
    supabase.from.mockImplementation((t) => {
      const chain = makeChain(tables[t] || [], writes);
      if (t !== 'quiz_sessions') return chain;
      let cols = null;
      chain.select = (list) => {
        if (typeof list === 'string' && !list.includes('*') && !list.includes('(')) {
          cols = list.split(',').map((c) => c.trim()).filter(Boolean);
        }
        return chain;
      };
      const then = chain.then;
      chain.then = (resolve, reject) => then((res) => resolve({
        ...res,
        data: cols ? res.data.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : res.data,
      }), reject);
      return chain;
    });
  }

  test('the lesson screen counts each child once: started, finished, the average and the lists', async () => {
    stubProjecting({ users, coaching_sessions: [session(1)], quizzes: [quizFor('q-1', 's-1')], quiz_sessions: ROWS });

    const out = await endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
    // Each line opens with its own direction mark; the words are what is asserted here.
    const lines = out.data.results.split('\n').map((l) => l.replace(/^[\u200E\u200F]/, ''));

    // Ayesha 88, Bilal 50, Esha 75, Farah 88 (her latest) → 301 / 4 = 75.25
    expect(lines[0]).toBe(resolveUx('tqFlowResultsHead', { language: 'en', params: { started: 5, finished: 4, avg: 75 } }));
    expect(lines.filter((l) => l.startsWith('• Farah'))).toEqual([expect.stringContaining('7/8 (88%)')]);
    // Esha finished on her second go: one finished line, and on no unfinished list.
    expect(lines.filter((l) => l.includes('Esha'))).toEqual([expect.stringMatching(/^• Esha .*75%/)]);
    expect(lines).toContain(resolveUx('tqFlowStillGoing', { language: 'en', params: { names: 'Danish' } }));
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.flow_lesson', expect.objectContaining({ started: 5, finished: 4 }));
  });

  test('the lessons list counts each child once per quiz', async () => {
    stubProjecting({
      users,
      coaching_sessions: [session(1), session(2)],
      quizzes: [quizFor('q-1', 's-1'), quizFor('q-2', 's-2')],
      quiz_sessions: ROWS,
    });

    const out = await endpoint.handleTranscriptQuizInit(TOKEN);
    const byId = Object.fromEntries(out.data.items.map((i) => [i.id, i['main-content'].description]));

    expect(byId['s-1']).toBe(resolveUx('tqFlowStatusSent', { language: 'en', params: { started: 5 } }));
    expect(byId['s-2']).toBe(resolveUx('tqFlowStatusSent', { language: 'en', params: { started: 1 } }));
  });

  test('a sent report counts each finished child once', async () => {
    stubProjecting({
      users, coaching_sessions: [session(1)],
      quizzes: [quizFor('q-1', 's-1', { status: 'report_sent' })], quiz_sessions: ROWS,
    });

    const out = await endpoint.handleTranscriptQuizInit(TOKEN);

    expect(out.data.items[0]['main-content'].description)
      .toBe(resolveUx('tqFlowStatusReport', { language: 'en', params: { finished: 4 } }));
  });
});
