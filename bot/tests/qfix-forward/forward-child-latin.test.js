'use strict';
/**
 * What a child reads in their own chat says «کوئز», «لنک» and «کلاس کارڈ» in Urdu, never a Latin word: the child's quiz
 * menu row, the "not for students" reply, the quiz hint, the student-quiz menu, its fallback and card button, and the
 * "no class card yet" reply. A slash command stays a Latin atom inside its isolate (⁦/video⁩), because the child types it.
 * English is unchanged, and the button and row titles keep inside WhatsApp's caps (in code points). The catalog is read
 * through the runtime resolver; the "no card yet" reply through its real sender (student-quiz.service sendCard).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('../first-touch/_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('../first-touch/_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { resolveUx, UX_STRINGS } = require('../../shared/config/ux-strings');
const { seedMaker } = require('../first-touch/maker-fixture');

const PARAMS = { topic: 'کسور', score: '۳/۵' };
const KEYS = ['studentTeacherOnly', 'studentQuizHint', 'studentMenuQuizzes', 'sqFlowBody', 'sqActionCard', 'sqFallbackBody', 'sqNoCardYet'];
// a slash command inside its isolate is the one Latin a child's line may carry (they type it)
const prose = (s) => s.replace(/⁦\/[a-z]+⁩/g, '');
const ur = (k) => resolveUx(k, { language: 'ur', params: PARAMS });
const cp = (s) => [...s].length;

describe('the Urdu a child reads', () => {
  test.each(KEYS)('%s: no Latin word outside a slash command', (k) => {
    expect(prose(ur(k))).not.toMatch(/[A-Za-z]/);
  });

  test('the words: «کوئز», «لنک», «کلاس کارڈ»', () => {
    expect(ur('studentTeacherOnly')).toContain('اپنے کوئز کے لیے');
    expect(ur('studentQuizHint')).toContain('آپ کے کوئز کلاس کے لنک سے آتے ہیں');
    expect(ur('studentMenuQuizzes')).toBe('📝 کوئز');
    expect(ur('sqFlowBody')).toContain('کلاس کارڈ');
    expect(ur('sqActionCard')).toBe('میرا کلاس کارڈ');
    expect(ur('sqFallbackBody')).toContain('آپ کا آخری کوئز: *کسور* — ۳/۵');
    expect(ur('sqNoCardYet')).toContain('اس کوئز کا کلاس کارڈ ابھی نہیں');
  });

  test('titles keep inside the caps: menu row ≤ 24, button ≤ 20 code points', () => {
    expect(cp(ur('studentMenuQuizzes'))).toBeLessThanOrEqual(24);
    expect(cp(ur('sqActionCard'))).toBeLessThanOrEqual(20);
  });

  test('English is unchanged', () => {
    expect(UX_STRINGS.studentTeacherOnly.en).toBe('That one isn’t for students. You can send /video for videos, /quiz for your quizzes, or just ask me a school question.');
    expect(UX_STRINGS.studentQuizHint.en).toBe('Your quizzes come from the link your class shares. Ask a school question here, or send /video for videos.');
    expect(UX_STRINGS.studentMenuQuizzes.en).toBe('📝 Quizzes');
    expect(UX_STRINGS.sqFlowBody.en).toBe('Pick a quiz to try it again or see your class card.');
    expect(UX_STRINGS.sqActionCard.en).toBe('See my class card');
    expect(UX_STRINGS.sqFallbackBody.en).toBe('Your last quiz: *{topic}* — {score}.\nTry it again, or see your class card?');
    expect(UX_STRINGS.sqNoCardYet.en).toBe('No class card for that quiz yet — finish it first, and the card comes with the class results.');
  });
});

describe('a real sender: the class card asked for before there is one', () => {
  test('Urdu: the reply says «کلاس کارڈ» and «کوئز», no Latin word', async () => {
    seedMaker(supabase, { on: true });
    const StudentQuiz = require('../../shared/services/quiz/student-quiz.service');
    const ok = await StudentQuiz.sendCard('+92300FIXTURE7', { shareCodeId: 'f0000000-0000-4000-8000-0000000000c7', studentId: 'b0000000-0000-4000-8000-0000000000c7', language: 'ur' });
    expect(ok).toBe(false);
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('کلاس کارڈ');
    expect(sent[0]).toContain('کوئز');
    expect(sent[0]).not.toMatch(/[A-Za-z]/);
  });
});
