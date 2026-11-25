'use strict';
/**
 * bd-5j1zaf — the report link the teacher asks for from the quiz list (sendTeacherReportLink) says where the open came
 * from: with app_settings quiz_teacher_home_reports on (JSON true only), the TEXT transport's link is the live report
 * + "?from=list". The TEMPLATE transport (a URL button whose suffix is the token) is unchanged in both states. Off, or
 * the switch unreadable, the text is today's.
 *
 * The real link, gate, token and flag code run. Faked: Supabase (in-memory, filters applied) and WhatsApp.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const TEACHER = { id: '11111111-1111-4111-8111-111111111111', preferred_language: 'en' };
const QUIZ = '22222222-2222-4222-8222-222222222222';
const KEY = 'quiz_teacher_home_reports';
const BASE = 'https://portal.example.test';

function seed({ late = undefined, template = null, failRead = false } = {}) {
  const rows = [];
  if (late !== undefined) rows.push({ key: KEY, value: late });
  if (template) rows.push({ key: 'teacher_report_template', value: template });
  const fake = makeFake({ app_settings: rows });
  supabase.from.mockImplementation((t) => {
    const b = fake.from(t);
    if (!failRead || t !== 'app_settings') return b;
    const { eq } = b;
    b.eq = (c, v) => (c === 'key' && v === KEY ? Promise.resolve({ data: null, error: { message: 'down' } }) : eq(c, v));
    return b;
  });
}

const Link = require('../../shared/services/quiz/teacher-report-link');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const Flag = require('../../shared/services/quiz/report-late-flag');

beforeEach(() => {
  jest.clearAllMocks();
  Gate._resetCache();
  Flag._resetCache();
  process.env.WEB_QUIZ_BASE_URL = BASE;
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
});

const send = () => Link.sendTeacherReportLink({ teacher: TEACHER, phone: '000', quizId: QUIZ, topic: 'Plants', counts: { played: 3, of: null } });
const textSent = () => String(WhatsAppService.sendMessage.mock.calls[0][1]);
const urlsIn = (t) => t.match(/https:\/\/\S+/g) || [];

test('on, text transport: the live link carries ?from=list', async () => {
  seed({ late: true });
  expect(await send()).toEqual({ ok: true, how: 'text' });
  const [url] = urlsIn(textSent());
  expect(url).toMatch(new RegExp(`^${BASE}/r/[A-Za-z0-9._%-]+\\?from=list$`));
});

test.each([
  ['no row', undefined],
  ['the string "true"', 'true'],
])('off (%s), text transport: today\'s link, no from', async (_, late) => {
  seed({ late });
  await send();
  const [url] = urlsIn(textSent());
  expect(url).toMatch(new RegExp(`^${BASE}/r/[A-Za-z0-9._%-]+$`));
});

test('the switch unreadable: today\'s link', async () => {
  seed({ late: true, failRead: true });
  await send();
  expect(urlsIn(textSent())[0]).not.toContain('from=');
});

test.each([true, undefined])('template transport (switch %s): the URL button\'s suffix is the token alone, nothing appended', async (late) => {
  Gate._resetCache();
  seed({ late, template: 'quiz_teacher_report_v1' });
  // an approved template is what the gate reads; a refused one falls back to text (covered above)
  jest.spyOn(Gate, 'reportTemplate').mockResolvedValue('quiz_teacher_report_v1');
  expect(await send()).toEqual({ ok: true, how: 'template' });
  const components = WhatsAppService.sendTemplate.mock.calls[0][3];
  const suffix = components.find((c) => c.type === 'button').parameters[0].text;
  expect(suffix).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  expect(suffix).not.toContain('from');
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  Gate.reportTemplate.mockRestore();
});
