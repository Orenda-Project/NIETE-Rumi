'use strict';
/**
 * A child's "portal" is the app (G2 of the keyword-entry review, 27 Oct 2026; decision D1 = yes).
 *
 * Production, 7 days to 27 Oct 2026: 2 children's "/portal" got "That one isn't for students", and a child's bare
 * "portal" goes to the AI tutor as a school question. For a child the word can only mean "the app", so "portal" and
 * "/portal" get exactly what "quiz" gets: ONE button into their own home.
 *
 * Real door (student-ingress: classify + route) and the real child-quiz service (student-quiz.service: the home link);
 * Supabase (in-memory tables that apply filters), Redis (a Map) and the WhatsApp send are the faked boundaries — the
 * phone-binder harness (bind-way-back.test.js). The one first-party module stood in for is the child tutor
 * (text-message.handler handleGeneralConversation): it is where a sentence goes, never the code under test.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false),
  sendReaction: jest.fn(async () => true),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
}));
jest.mock('../../shared/handlers/text-message.handler', () => ({
  handleGeneralConversation: jest.fn().mockResolvedValue(undefined),
  tryChildVideoMenu: jest.fn().mockResolvedValue(true),
}));

const { makeFake } = require('./web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const WhatsApp = require('../../shared/services/whatsapp.service');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../shared/services/student-ingress');
const { fixturePhone } = require('./web-quiz/fixture-phone');

const PHONE = fixturePhone(812);
const KID = 'f0000000-0000-4000-8000-000000000081';
const UNKNOWN_USER = { id: 'u-child-phone', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const iso = (ms) => new Date(ms).toISOString();
// a chat-joined child on this handset: the door's proven child (no teacher identity or activity, an active row, list_id NULL)
const CHAT_KID = { id: KID, student_name: 'Hamza Testwala', phone: PHONE, list_id: null, is_active: true, status: 'active',
  self_reported_class: '3', created_at: iso(Date.now() - 600000) };

let fake;
function seed() {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }],
    students: [{ ...CHAT_KID }], child_phone_bindings: [], quiz_sessions: [], class_enrollments: [], student_lists: [],
    class_teachers: [], quizzes: [], coaching_sessions: [], lesson_plans: [], training_assessment_attempts: [],
    assessment_requests: [], message_ledger: [],
  });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
/** One message from the child's handset through the real door: classify, then route. → handled? */
const say = async (body) => {
  const user = { ...UNKNOWN_USER };
  await Ingress.attach(user, PHONE, { body });
  expect(user.persona).toBe('student'); // the door's verdict: a proven child
  return Ingress.route({ message: { id: `wamid.${Math.random()}`, type: 'text' }, messageType: 'text', messageBody: body, from: PHONE, user });
};
/** What the turn sent: the cta_url buttons (url with the token masked) and every plain line. */
const sent = () => ({
  cta: WhatsApp.sendCtaUrl.mock.calls.map(([to, a]) => ({ to, body: a.body, buttonText: a.buttonText, url: String(a.url).replace(/\/h\/[^?#]+/, '/h/<T>') })),
  lines: WhatsApp.sendMessage.mock.calls.length,
});

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  delete process.env.PORTAL_KEYWORD_ROUTING;
  jest.clearAllMocks();
  redisService.__keys.clear();
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('a proven child\'s "portal" opens their home, exactly as "quiz" does', () => {
  let quizReply;
  beforeEach(async () => {
    expect(await say('quiz')).toBe(true);
    quizReply = sent();
    // the control: one button into the child home, no refusal
    expect(quizReply.cta).toHaveLength(1);
    expect(quizReply.cta[0].url).toContain('/h/<T>');
    jest.clearAllMocks();
    redisService.__keys.clear();
    seed();
  });

  test.each([['portal'], ['Portal'], ['/portal'], ['/Portal'], ['/ portal'], ['portal/'], ['پورٹل'], ['open portal'], ['mera portal']])(
    '%j → the same one button as "quiz"; no refusal, no tutor', async (typed) => {
      expect(await say(typed)).toBe(true);
      expect(sent()).toEqual(quizReply);
      expect(events('student_ingress.refused')).toHaveLength(0);
      expect(events('quiz_menu.requested')).toEqual([expect.objectContaining({ route: 'child_quizzes', trigger: 'portal' })]);
    },
  );
});

describe('a sentence that says "portal" is still a school question for the tutor (unchanged)', () => {
  test('"what is a portal" does not open the home', async () => {
    const TextHandler = require('../../shared/handlers/text-message.handler');
    expect(await say('what is a portal')).toBe(true);
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(TextHandler.handleGeneralConversation).toHaveBeenCalled();
  });
});

describe('kill switch PORTAL_KEYWORD_ROUTING=false: today\'s answers', () => {
  test('"/portal" is refused as a teacher command', async () => {
    process.env.PORTAL_KEYWORD_ROUTING = 'false';
    expect(await say('/portal')).toBe(true);
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(events('student_ingress.refused')).toEqual([expect.objectContaining({ what: 'command:/portal' })]);
  });
});
