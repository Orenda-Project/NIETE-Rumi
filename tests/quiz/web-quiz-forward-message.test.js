'use strict';
/**
 * The message a teacher forwards to the class says what the child will be asked first.
 *
 * On the WhatsApp link the bot asks the child's name and class; on the WEB link the page asks
 * only the name. So the forwardable text is chosen where the link is chosen: the web link gets
 * tqStudentMessageWeb ("your name first"), the wa.me link keeps tqStudentMessage unchanged.
 *
 * Driven through the real hand-off and the real web-quiz-link chooser; Supabase (app_settings,
 * quizzes), WhatsApp, the queue, R2 and the PDF renderer are the stand-ins.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Teacher' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));


const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const WebLink = require('../../bot/shared/services/quiz/web-quiz-link');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const DIGEST = { topic: 'Fractions', subject: 'maths', grade_band: '3-5', language_of_instruction: 'en', confidence: 0.9, slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }] };
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};

async function forwarded(language, webOn) {
  const meta = { digest: DIGEST, cost_usd: 0.01 };
  const quiz = { id: QID, teacher_id: 'u-1', topic: 'Fractions', subject: 'maths', language, grade: '4', status: 'ready', coaching_session_id: SID, meta };
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    app_settings: { data: webOn ? [{ key: 'web_quiz_enabled', value: 'true' }, { key: 'web_quiz_teachers', value: '"all"' }] : [] },
  });
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  const out = await Handoff.sendHandoff(QID, '920000000001', {
    firstSend: true,
    prepared: { quiz, session: { id: SID, created_at: '2026-09-05T05:00:00Z' }, questions: null, qRows: [ROW], digest: DIGEST, teacherName: 'Teacher', meta, language, teacherLang: language },
  });
  expect(out.ok).toBe(true);
  const texts = WA.sendMessage.mock.calls.map((c) => c[1]);
  return texts[texts.length - 1];
}

const ENV = process.env.PORTAL_URL;
beforeEach(() => {
  jest.clearAllMocks(); WA.sendMessage.mockResolvedValue(true); WA.sendDocument.mockResolvedValue(true);
  WebLink._resetCache(); process.env.PORTAL_URL = 'https://portal.example';
});
afterAll(() => { if (ENV === undefined) delete process.env.PORTAL_URL; else process.env.PORTAL_URL = ENV; });

describe.each(['en', 'ur'])('quiz in %s', (lang) => {
  test('the web link: the page link, and the child is told only the name is asked', async () => {
    const msg = await forwarded(lang, true);
    expect(msg).toContain('https://portal.example/q/ABC234');
    expect(msg).not.toMatch(/wa\.me/);
    const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
    expect(msg.split('\n\n').pop()).toBe(UX_STRINGS.tqStudentMessageWeb[lang].split('\n\n').pop());
    expect(msg).not.toMatch(lang === 'ur' ? /جماعت/ : /class/);
  });

  test('the WhatsApp link keeps today\'s message exactly (name and class)', async () => {
    const msg = await forwarded(lang, false);
    expect(msg).toMatch(/wa\.me\/920000000000\?text=QUIZ-ABC234/);
    expect(msg).toMatch(lang === 'ur' ? /نام اور جماعت/ : /your name and class first/);
  });
});

test('the web string is the WhatsApp string with only the last line changed', () => {
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  for (const lang of ['en', 'ur']) {
    const wa = UX_STRINGS.tqStudentMessage[lang].split('\n\n');
    const web = UX_STRINGS.tqStudentMessageWeb[lang].split('\n\n');
    expect(web.slice(0, -1)).toEqual(wa.slice(0, -1));
    expect(web[web.length - 1]).not.toEqual(wa[wa.length - 1]);
  }
});
