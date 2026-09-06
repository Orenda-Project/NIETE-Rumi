'use strict';
/**
 * PLAN_R5 D4 — sending a "select all that apply" question and grading the set
 * that comes back.
 *
 * Three things here have burned this repo before and are asserted rather than
 * assumed:
 *  - a Flow that cannot be sent must DEGRADE, never blank the question
 *    (`QUIZ_MULTI_FLOW_ID` unset, or Meta refusing the send);
 *  - a duplicate submission takes the 23505 reconcile path, exactly as a
 *    double tap on a single-answer question does;
 *  - a `vqm:` reply is never allowed to fall through to detectFlowType, whose
 *    attendance_marking rule matches ANY flow_token containing a colon.
 *
 * Every fixture is invented; nothing here comes from a real lesson.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid-1'),
  sendTextReturningId: jest.fn().mockResolvedValue('mid-2'),
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn(), delete: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const render = require('../../shared/services/quiz/video-quiz-render.service');
const Multi = require('../../shared/services/quiz/transcript-quiz-multi');
const VQ = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000000';
const FLOW_ID = '1234567890';

function row(over = {}) {
  return {
    id: 'q-multi', external_id: 'tq:z1:S2:2',
    question_text: 'Which of these shapes have four sides?',
    option_a: 'Square', option_b: 'Circle', option_c: 'Rectangle', option_d: 'Triangle',
    correct_option: 'A,C',
    explanation: 'A square and a rectangle both have four sides.',
    option_feedback: {
      correct: 'Both of those have four sides.',
      wrong: { 1: 'A circle has no straight sides.', 3: 'A triangle has three sides.' },
    },
    media: { answer_mode: 'multi', language: 'en', display_order: [0, 1, 2, 3] },
    render_pattern: 'P1',
    ...over,
  };
}

async function sendInteraction(q, ctx = {}) {
  jest.clearAllMocks();
  const msgs = render.build(q);
  return sender.sendPhase(PHONE, msgs, 'interaction',
    { questionId: q.id, sessionId: 's1', language: (q.media || {}).language || 'en', ...ctx });
}

describe('the send', () => {
  const OLD = process.env.QUIZ_MULTI_FLOW_ID;
  afterEach(() => { if (OLD === undefined) delete process.env.QUIZ_MULTI_FLOW_ID; else process.env.QUIZ_MULTI_FLOW_ID = OLD; });

  test('with the Flow configured the child gets the Flow, not a picker', async () => {
    process.env.QUIZ_MULTI_FLOW_ID = FLOW_ID;
    const res = await sendInteraction(row());
    expect(res.pickerFailed).toBe(false);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [phone, opts] = WhatsAppService.sendFlow.mock.calls[0];
    expect(phone).toBe(PHONE);
    expect(opts.flowId).toBe(FLOW_ID);
    expect(opts.screen).toBe('PICK');
    expect(opts.flowToken).toBe('vqm:s1:q-multi');
    expect(opts.screenData.options).toEqual([
      { id: '0', title: 'Square' }, { id: '1', title: 'Circle' },
      { id: '2', title: 'Rectangle' }, { id: '3', title: 'Triangle' },
    ]);
  });

  test('the picture is the Flow’s image header, sent once', async () => {
    process.env.QUIZ_MULTI_FLOW_ID = FLOW_ID;
    await sendInteraction(row({ media: { answer_mode: 'multi', language: 'en', question_card: 'https://example.test/card.png' } }));
    expect(WhatsAppService.sendImageFromUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow.mock.calls[0][1].headerImage).toBe('https://example.test/card.png');
  });

  test('an Urdu quiz gets Urdu chrome inside the Flow', async () => {
    process.env.QUIZ_MULTI_FLOW_ID = FLOW_ID;
    await sendInteraction(row({ media: { answer_mode: 'multi', language: 'ur', display_order: [0, 1, 2, 3] } }), { language: 'ur' });
    const opts = WhatsAppService.sendFlow.mock.calls[0][1];
    expect(opts.buttonText).toBe('جواب دیں');
    expect(opts.screenData.instruction).toBe('سب درست جواب چنیں۔');
    expect(opts.screenData.submit_label).toBe('جواب بھیجیں');
    expect(/[A-Za-z]/.test(opts.footer)).toBe(false);
  });

  test('no Flow configured → a picker that SAYS more than one answer is right, never a blank', async () => {
    delete process.env.QUIZ_MULTI_FLOW_ID;
    const res = await sendInteraction(row());
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    const body = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].body.text;
    expect(body).toContain('More than one answer is right');
    const rows = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.id)).toEqual(['vq_q-multi_0', 'vq_q-multi_1', 'vq_q-multi_2', 'vq_q-multi_3']);
    expect(res.pickerFailed).toBe(false);
  });

  test('Meta refusing the Flow falls back to the picker rather than stranding the child', async () => {
    process.env.QUIZ_MULTI_FLOW_ID = FLOW_ID;
    WhatsAppService.sendFlow.mockResolvedValueOnce(false);
    const res = await sendInteraction(row());
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(res.pickerFailed).toBe(false);
  });

  test('the picture still reaches the child on the fallback path', async () => {
    delete process.env.QUIZ_MULTI_FLOW_ID;
    await sendInteraction(row({ media: { answer_mode: 'multi', language: 'en', question_card: 'https://example.test/card.png' } }));
    expect(WhatsAppService.sendImageFromUrl).toHaveBeenCalledWith(PHONE, 'https://example.test/card.png', '');
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
  });
});

describe('grading the set', () => {
  const inserts = [];
  const updates = [];
  let insertError = null;

  // The answers already in the table. The counters are written FROM this, never
  // from the state blob (writeCountersFromAnswers), so a test that wants to see
  // a counter move has to put the answer here.
  let storedAnswers = [];

  function chain(table) {
    const c = {
      select: () => c, eq: () => c, in: () => c, is: () => c, order: () => c,
      // `.or(...)` is the monotonic-counter guard and terminates the chain.
      or: async () => ({ error: null }),
      update: (patch) => { updates.push([table, patch]); return c; },
      insert: async (payload) => {
        inserts.push([table, payload]);
        if (!insertError && table === 'quiz_answers') {
          storedAnswers.push({ question_id: payload.question_id, is_correct: payload.is_correct });
        }
        return { error: insertError };
      },
      single: async () => ({ data: row(), error: null }),
      maybeSingle: async () => ({ data: table === 'quiz_sessions' ? { total_questions_answered: 1, correct_answers: 1 } : null }),
      then: (resolve) => resolve({ data: table === 'quiz_answers' ? storedAnswers : [], error: null }),
    };
    return c;
  }

  beforeEach(() => {
    inserts.length = 0; updates.length = 0; insertError = null;
    // One earlier answer already recorded, so the counter has somewhere to move
    // from — the same shape a real session is in at question 2.
    storedAnswers = [{ question_id: 'q-earlier', is_correct: true }];
    jest.clearAllMocks();
    supabase.from.mockImplementation(chain);
    redis.get.mockResolvedValue({
      sessionId: 's1', quizId: 'z1', language: 'en',
      questionIds: ['q-multi', 'q-next'], index: 1, answered: 1, correct: 1,
    });
  });

  const verdict = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');

  test('the exact set scores, and stores the letters the child chose', async () => {
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0', '2'], quiz_multi_action: 'answer' });
    const answer = inserts.find(([t]) => t === 'quiz_answers');
    expect(answer[1]).toMatchObject({ selected_option: 'A,C', is_correct: true, question_id: 'q-multi' });
    expect(verdict()).toContain('✅');
    expect(verdict()).toContain('Both of those have four sides.');
  });

  test('a partial set is wrong and names what was missed', async () => {
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0'] });
    const answer = inserts.find(([t]) => t === 'quiz_answers');
    expect(answer[1]).toMatchObject({ selected_option: 'A', is_correct: false });
    expect(verdict()).toContain('❌');
    expect(verdict()).toContain('Rectangle');
  });

  test('a superset is wrong and names the option that does not belong', async () => {
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0', '1', '2'] });
    expect(inserts.find(([t]) => t === 'quiz_answers')[1]).toMatchObject({ selected_option: 'A,B,C', is_correct: false });
    expect(verdict()).toContain('A circle has no straight sides.');
  });

  test('the counters are written from the answers TABLE, and the state mirrors them', async () => {
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0', '2'] });
    // Two rows in quiz_answers (the earlier one plus this set), both correct.
    const sess = updates.find(([t]) => t === 'quiz_sessions');
    expect(sess[1]).toMatchObject({ total_questions_answered: 2, correct_answers: 2 });
    const saved = redis.set.mock.calls.map((c) => c[1]).find((s) => s && s.index === 2);
    expect(saved).toMatchObject({ answered: 2, correct: 2 });
  });

  /**
   * The counter bug lane A fixed for the single-answer path is exactly as easy
   * to write on this one: increment the blob, and a session that has recorded
   * eight answers reports whatever the last cached read said.
   */
  test('a stale state blob cannot put a number on the scorecard the table does not support', async () => {
    redis.get.mockResolvedValue({
      sessionId: 's1', quizId: 'z1', language: 'en',
      questionIds: ['q-multi', 'q-next'], index: 1, answered: 97, correct: 96,
    });
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0', '2'] });
    const sess = updates.find(([t]) => t === 'quiz_sessions');
    expect(sess[1].total_questions_answered).toBe(2);
    const saved = redis.set.mock.calls.map((c) => c[1]).pop();
    expect(saved.answered).toBe(2);
  });

  test('a double submission takes the 23505 reconcile path, not a second score', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: ['0', '2'] });
    // The reconcile rebuilds from the answers table (empty here) rather than
    // incrementing the in-memory counters a second time.
    const saved = redis.set.mock.calls.map((c) => c[1]).pop();
    expect(saved.answered).toBe(1);   // the one earlier answer, from the table
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('')).not.toContain('✅');
  });

  test('a vqm reply is ALWAYS claimed, even when the payload is unreadable', async () => {
    expect(await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', {})).toBe(true);
    expect(await VQ.handleMultiFlowReply(PHONE, 'vqm:s1:q-multi', { picks: [] })).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  test('somebody else’s Flow reply is not claimed', async () => {
    expect(await VQ.handleMultiFlowReply(PHONE, 'coach-1:sess-2', { absent_students: [] })).toBe(false);
    expect(await VQ.handleMultiFlowReply(PHONE, 'vq:s1:q9', { picks: ['1'] })).toBe(false);
  });
});

describe('the bot routes it before anything else can claim it', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');

  // A textual assertion, and only for the ORDERING — which is a property of the
  // source, not of any function. What the branch DOES is executed by the tests
  // above, through the same handleFlowReply() the branch calls.
  test('the vqm branch runs before detectFlowType', () => {
    const branch = SRC.indexOf("startsWith('vqm:')");
    const detect = SRC.indexOf('detectFlowType(responseJson)');
    expect(branch).toBeGreaterThan(-1);
    expect(detect).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(detect);
  });
});
