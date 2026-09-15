'use strict';
/**
 * bd-2yyry.13 — the child's /quiz Flow endpoint, and the separation from the
 * teacher's: its own token shape, its own discriminator (sq_action), its own
 * completion arm. Executed through the exported handlers with the data
 * service at the boundary.
 */
// The completion-ack assertion requires flow-response.handler, whose import
// chain constructs the LLM client at module scope.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-only';
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({
  quizzesForHandset: jest.fn(),
  retry: jest.fn().mockResolvedValue(true),
  sendCard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  loadClassRows: jest.fn().mockResolvedValue({ rows: [{ pct: 50 }, { pct: 100 }] }),
}));

const SQ = require('../../shared/services/quiz/student-quiz.service');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');
const { detectFlowType } = require('../../shared/utils/flow-type-detector');
const { resolveUx } = require('../../shared/config/ux-strings');
const EP = require('../../shared/routes/student-quiz-flow-endpoint');

const PHONE = '923001234567';
const TOKEN = ChildFlowToken.build({ phone: PHONE, shareCodeId: 'sc-1', studentId: 'st-1', language: 'en' });
const QUIZ = {
  shareCodeId: 'sc-1', code: 'K7RM2X', active: true, quizId: 'q1', topic: 'Proper Fractions', subject: 'maths',
  language: 'en', studentId: 'st-1', studentName: 'Ayesha', className: '4', attempts: 2, lastAt: '2026-09-14T09:00:00Z',
  latest: { id: 's2', correct_answers: 6, total_questions_answered: 8 }, best: { id: 's1', correct_answers: 7, total_questions_answered: 8 },
};

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { jest.clearAllMocks(); SQ.quizzesForHandset.mockResolvedValue([QUIZ]); });

describe('INIT', () => {
  test('a child token lists the quizzes on the handset, each row within the NavigationList caps', async () => {
    const res = await EP.handleStudentQuizInit(TOKEN);
    expect(res.screen).toBe('QUIZZES');
    expect(res.data.items).toHaveLength(1);
    const row = res.data.items[0];
    expect(row['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'quiz', share_code_id: 'sc-1' } });
    expect(Array.from(row['main-content'].title).length).toBeLessThanOrEqual(30);
    expect(Array.from(row['main-content'].description).length).toBeLessThanOrEqual(20);
    expect(Array.from(row['main-content'].metadata).length).toBeLessThanOrEqual(80);
    expect(row['main-content'].description).toContain('6/8');
  });

  test('a teacher-shaped token (userId:…) is not a child: the entry screen with the error line, nothing read', async () => {
    const res = await EP.handleStudentQuizInit('9b2f0c1e-0000-4000-8000-000000000000:1726300000');
    expect(res.screen).toBe('QUIZZES');
    expect(res.data.error_message).toBeTruthy();
    expect(res.data.items[0].id).toBe('__empty__');
    expect(SQ.quizzesForHandset).not.toHaveBeenCalled();
  });

  test('no quizzes: the entry screen with one "no quizzes yet" row (a NavigationList is never empty)', async () => {
    SQ.quizzesForHandset.mockResolvedValue([]);
    const res = await EP.handleStudentQuizInit(TOKEN);
    expect(res.screen).toBe('QUIZZES');
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]['main-content'].title).toBe(resolveUx('sqDoneEmptyHeading', { language: 'en' }));
    expect(Array.from(res.data.items[0]['main-content'].metadata).length).toBeLessThanOrEqual(80);
  });

  test('a quiz that vanished between screens closes the Flow on DONE', async () => {
    const res = await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZ', { step: 'action', sq_action: 'retry', share_code_id: 'sc-gone' });
    expect(res).toMatchObject({ screen: 'DONE', data: { kind: 'error' } });
  });
});

describe('data_exchange', () => {
  test('step=quiz shows latest, best and the class average, with Try again and See my class card', async () => {
    const res = await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZZES', { step: 'quiz', share_code_id: 'sc-1' });
    expect(res.screen).toBe('QUIZ');
    expect(res.data.results).toContain('6/8');
    expect(res.data.results).toContain('7/8');
    expect(res.data.results).toContain('75%');            // (50 + 100) / 2
    expect(res.data.actions.map((a) => a.id)).toEqual(['retry', 'card']);
    expect(res.data.share_code_id).toBe('sc-1');
  });

  test('a closed link offers the card only', async () => {
    SQ.quizzesForHandset.mockResolvedValue([{ ...QUIZ, active: false }]);
    const res = await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZZES', { step: 'quiz', share_code_id: 'sc-1' });
    expect(res.data.actions.map((a) => a.id)).toEqual(['card']);
  });

  test('step=action retry: the Flow closes with SUCCESS carrying sq_action, and the retry runs AFTER the response for this child', async () => {
    const res = await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZ', { step: 'action', sq_action: 'retry', share_code_id: 'sc-1' });
    expect(res).toEqual({ screen: 'SUCCESS', data: { extension_message_response: { params: { sq_action: 'retry' } } } });
    expect(SQ.retry).not.toHaveBeenCalled();   // not yet — the screen closes first
    await flush();
    expect(SQ.retry).toHaveBeenCalledWith(PHONE, expect.objectContaining({ shareCodeId: 'sc-1', studentId: 'st-1', code: 'K7RM2X', active: true }));
  });

  test('step=action card: same close, the card send runs after', async () => {
    await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZ', { step: 'action', sq_action: 'card', share_code_id: 'sc-1' });
    await flush();
    expect(SQ.sendCard).toHaveBeenCalledWith(PHONE, expect.objectContaining({ shareCodeId: 'sc-1', studentId: 'st-1' }));
  });

  test('an unknown action re-serves the list with an error line rather than closing', async () => {
    const res = await EP.handleStudentQuizDataExchange(TOKEN, 'QUIZ', { step: 'action', sq_action: 'delete', share_code_id: 'sc-1' });
    expect(res.screen).toBe('QUIZZES');
    expect(res.data.error_message).toBeTruthy();
  });
});

describe('separation from the teacher Flow', () => {
  test('the detector routes sq_action to student_quiz, ahead of tq_action and the colon fallback', () => {
    expect(detectFlowType({ sq_action: 'retry' })).toBe('student_quiz');
    expect(detectFlowType({ tq_action: 'make' })).toBe('transcript_quiz');
    expect(detectFlowType({ sq_action: 'card', flow_token: 'childpick:1:2:3:en:4' })).toBe('student_quiz');
  });

  test('the payload uses no reserved request field and the two Flows share no discriminator', () => {
    const fs = require('fs');
    const path = require('path');
    const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/flows/student-quiz-flow.json'), 'utf8'));
    const reserved = new Set(['action', 'screen', 'flow_token', 'data', 'version']);
    const keys = new Set();
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') {
        if (o['on-click-action'] && o['on-click-action'].payload) Object.keys(o['on-click-action'].payload).forEach((k) => keys.add(k));
        Object.values(o).forEach(walk);
      }
    };
    walk(flow.screens);
    for (const k of keys) expect(reserved.has(k)).toBe(false);
    expect(keys.has('sq_action')).toBe(true);
    expect(keys.has('tq_action')).toBe(false);
    expect(flow.screens.map((s) => s.id)).toEqual(['QUIZZES', 'QUIZ', 'DONE']);
  });

  test('the bot has its own completion arm for student_quiz, and the ack is exported', () => {
    const fs = require('fs');
    const path = require('path');
    const bot = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    const sq = bot.indexOf("flowType === 'student_quiz'");
    const tq = bot.indexOf("flowType === 'transcript_quiz'");
    expect(sq).toBeGreaterThan(-1);
    expect(tq).toBeGreaterThan(sq);
    const FRH = require('../../shared/handlers/flow-response.handler');
    expect(typeof FRH.handleStudentQuizFlowCompletion).toBe('function');
    expect(typeof FRH.handleTranscriptQuizFlowCompletion).toBe('function');
    const routes = fs.readFileSync(path.join(__dirname, '../../shared/routes/flow-endpoint.routes.js'), 'utf8');
    expect(routes).toMatch(/router\.post\('\/student-quiz'/);
    expect(routes).toMatch(/router\.post\('\/transcript-quiz'/);
  });
});
