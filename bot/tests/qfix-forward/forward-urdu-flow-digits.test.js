'use strict';
/**
 * The child's quiz-list Flow (student-quiz-flow-endpoint) shows each quiz's date: the QUIZZES row metadata and the
 * QUIZ subline. A CHILD reads it, so in Urdu the date takes Urdu digits (language-protocol §9.4), as the class
 * message's {date} does. Only the date: the class label («جماعت 4», A26) and the English rows stay as they are.
 */
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-only';
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ quizzesForHandset: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  loadClassRows: jest.fn().mockResolvedValue({ rows: [{ pct: 50 }] }),
}));

const SQ = require('../../shared/services/quiz/student-quiz.service');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');
const EP = require('../../shared/routes/student-quiz-flow-endpoint');

const QUIZ = {
  shareCodeId: 'sc-1', active: true, topic: 'Plants', className: '4', studentName: 'Ayesha', lastAt: '2026-11-25T05:00:00Z',
  latest: { id: 's1', correct_answers: 6, total_questions_answered: 8 }, best: null,
};
const token = (language) => ChildFlowToken.build({ phone: '923001234567', shareCodeId: 'sc-1', studentId: 'st-1', language });

beforeEach(() => { SQ.quizzesForHandset.mockResolvedValue([QUIZ]); });

describe('the child Flow date in Urdu digits', () => {
  test('QUIZZES row metadata: ur reads ۲۵ نومبر, en is unchanged', async () => {
    const ur = (await EP.handleStudentQuizInit(token('ur'))).data.items[0]['main-content'].metadata;
    expect(ur).toMatch(/^۲۵ نومبر · /);
    expect(ur.split(' · ')[0]).not.toMatch(/[0-9]/);
    const en = (await EP.handleStudentQuizInit(token('en'))).data.items[0]['main-content'].metadata;
    expect(en).toBe('25 Nov · 4 · Ayesha');
  });

  test('QUIZ subline: ur reads ۲۵ نومبر, en is unchanged', async () => {
    const ur = (await EP.handleStudentQuizDataExchange(token('ur'), 'QUIZZES', { step: 'quiz', share_code_id: 'sc-1' })).data.subline;
    expect(ur).toMatch(/^۲۵ نومبر · /);
    expect(ur.split(' · ')[0]).not.toMatch(/[0-9]/);
    const en = (await EP.handleStudentQuizDataExchange(token('en'), 'QUIZZES', { step: 'quiz', share_code_id: 'sc-1' })).data.subline;
    expect(en).toBe('25 Nov · 4');
  });
});
