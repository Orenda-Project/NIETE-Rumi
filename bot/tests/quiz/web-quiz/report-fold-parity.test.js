'use strict';
/**
 * quiz_report_fold_by_child, three surfaces, one fixture: the web report (/r, quizReport), the teacher home's count
 * (classReport — the home's playedOwn reads it) and the 12 h WhatsApp quiz report (video-quiz-report generate()).
 * ON, all three name the same number of children: a child not on the class list is one per CHILD
 * (merged_into ?? id; the same typed name folds only on a shared phone or an unbound side).
 * OFF, each surface counts as it does today, and the numbers are named here so the difference is a known line:
 * the web report folds off-list children by typed name; the home and the WhatsApp report count one per record.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendDocument: jest.fn(async () => true), sendTemplateMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn(async () => ({ MessageId: 'm1' })) }));
const mockRenderHtml = jest.fn(() => '<html></html>');
jest.mock('../../../shared/templates/video-quiz-report.template', () => mockRenderHtml);
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF')) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClientForModel: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '' } }] }) } } }) }));

const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');
const F = require('./web-quiz-identity-fixture');

const KEY = 'quiz_report_fold_by_child';
const NOW = Date.parse('2026-10-16T09:00:00Z');
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const done = (id, studentId, name, correct, h) => ({
  id, quiz_id: F.QUIZ, share_code_id: F.SC, student_id: studentId, student_name: name, user_id: null, status: 'completed',
  correct_answers: correct, total_questions_answered: 5, mastery_percentage: correct * 20, completed_at: ago(h), created_at: ago(h + 0.1),
  invited_by_student_id: null, device_ref: `dev-${id}`, student_class: '4',
});
const TYPED2 = '44444444-4444-4444-8444-444444444445';
const loose = (id, name, extra = {}) => ({ id, student_name: name, self_reported_class: '4-A', list_id: null, is_active: true, status: 'active',
  created_at: '2026-10-02T00:00:00Z', merged_into: null, ...extra });
const bind = (canonicalId, tomb) => ({ id: `b-${canonicalId.slice(-2)}-${tomb}`, canonical_id: canonicalId, phone_norm: null, phone_tomb: tomb,
  via: 'guest', revoked_at: null, expires_at: '2099-03-31T18:59:59.000Z', bound_at: ago(30) });

// Ayesha (on the class list) + "Dansh" typed by two records off the list, per case
const CASES = {
  'two children, one typed name, two phones': { second: {}, secondName: 'dansh ', bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] },
  'one child again on ONE phone (a re-join)': { second: {}, secondName: 'dansh ', bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-a')] },
  'one typed name, no binding (a fresh browser)': { second: {}, secondName: 'dansh ', bindings: [] },
  'a merged pair, another typed name, another phone': { second: { merged_into: F.TYPED, status: 'merged' }, secondName: 'Danish', bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] },
};

let Data;
function wire({ on, second, secondName, bindings }) {
  const sessions = [done('s1', F.kid(1), 'Ayesha Testwala', 4, 20), done('s3', F.TYPED, 'Dansh', 5, 18), done('s4', TYPED2, secondName, 2, 10)];
  const tables = F.db({ sessions });
  tables.quizzes = tables.quizzes.map((q) => ({ ...q, teacher_id: F.TEACHER, status: 'sent', created_at: ago(30), quiz_source: 'transcript', meta: { share_code_id: F.SC } }));
  const fake = makeFake(tables);
  fake.db.students.push(loose(TYPED2, secondName, second));
  fake.db.child_phone_bindings = bindings;
  fake.db.users = [...(fake.db.users || []).filter((u) => u.id !== F.TEACHER), { id: F.TEACHER, name: 'Asma Testwala', phone_number: fixturePhone(61), preferred_language: 'en' }];
  fake.db.app_settings = [...(fake.db.app_settings || []), ...(on ? [{ key: KEY, value: true }] : [])];
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  Data = require('../../../shared/services/quiz/teacher-report.data');
  return fake;
}

async function counts() {
  const web = (await Data.quizReport(F.TEACHER, F.QUIZ)).summary.played;
  const home = (await Data.classReport(F.TEACHER, { now: NOW })).quizzes.find((q) => q.id === F.QUIZ).played;
  mockRenderHtml.mockClear();
  await require('../../../shared/services/quiz/video-quiz-report.service').generate(F.SC, { reason: 'scheduled' });
  const vm = mockRenderHtml.mock.calls[0] && mockRenderHtml.mock.calls[0][0];
  return { web, home, whatsapp: vm ? vm.finished : null };
}

beforeAll(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
afterAll(() => { jest.useRealTimers(); });

describe('on: the three surfaces name the same children', () => {
  test.each([
    ['two children, one typed name, two phones', 3],
    ['one child again on ONE phone (a re-join)', 2],
    ['one typed name, no binding (a fresh browser)', 2],
    ['a merged pair, another typed name, another phone', 2],
  ])('%s → %i on every surface', async (name, n) => {
    wire({ on: true, ...CASES[name] });
    expect(await counts()).toEqual({ web: n, home: n, whatsapp: n });
  });
});

describe('off: today\'s numbers, named (the web report folds typed names; the home and WhatsApp count records)', () => {
  test.each([
    ['two children, one typed name, two phones', { web: 2, home: 3, whatsapp: 3 }],
    ['one child again on ONE phone (a re-join)', { web: 2, home: 3, whatsapp: 3 }],
    ['one typed name, no binding (a fresh browser)', { web: 2, home: 3, whatsapp: 3 }],
    ['a merged pair, another typed name, another phone', { web: 3, home: 3, whatsapp: 3 }],
  ])('%s', async (name, expected) => {
    wire({ on: false, ...CASES[name] });
    expect(await counts()).toEqual(expected);
  });
});
