'use strict';
/**
 * After the old-link redirect's 'Start quiz' button, a child who TYPES (prod 8 Oct: 6 of 26 children who
 * read the button but did not tap typed a name or a greeting 12-115 s later, and each got an AI reply)
 * is answered ONCE with the same button, for ten minutes, instead of the AI chat. Plus: the redirect's
 * body names that button, and the redirect logs the id of the message it sent.
 *
 * Driven through the REAL text handler, with the network boundary mocked (WhatsApp, Supabase) and an
 * in-memory Redis.
 */
process.env.WEB_QUIZ_BASE_URL = 'https://portal.test';
process.env.INTERNAL_API_KEY = 'test-only-internal-key';
process.env.REFERRAL_BOT_NUMBER = '923000000000';
delete process.env.STUDENT_JOIN_FLOW_ID;
delete process.env.STUDENT_JOIN_LOCALIZED_FLOW_ID;

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/openai.service', () => ({
  detectIntent: jest.fn().mockResolvedValue({ type: 'general_conversation' }),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));
jest.mock('../../shared/services/content.service', () => ({}));
jest.mock('../../shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => null),
}));
jest.mock('../../shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn().mockResolvedValue(false),
  countUserFeatures: jest.fn().mockResolvedValue(0),
  sendNameQuestion: jest.fn().mockResolvedValue(undefined),
  handleNameResponse: jest.fn().mockResolvedValue({ success: true, firstName: 'X' }),
}));
jest.mock('../../shared/services/context.service', () => ({}));
// An in-memory Redis with TTLs on Date.now(), so a 10-minute window can be crossed by moving the clock.
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const live = (k) => { const e = store.get(k); if (!e) return null; if (e.exp && Date.now() >= e.exp) { store.delete(k); return null; } return e; };
  const svc = {
    _store: store,
    isAvailable: jest.fn(() => true),
    get: jest.fn(async (k) => { const e = live(k); return e ? JSON.parse(JSON.stringify(e.v)) : null; }),
    set: jest.fn(async (k, v, ttl) => { store.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : null }); return true; }),
    setNX: jest.fn(async (k, v, ttl) => { if (live(k)) return false; store.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : null }); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    exists: jest.fn(async (k) => Boolean(live(k))),
  };
  svc.redis = { get: svc.get, set: svc.set, del: svc.delete };
  return svc;
});
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn() }));
jest.mock('../../shared/services/helper-agent.service', () => ({
  detectCapabilityInquiry: jest.fn().mockResolvedValue({ detected: false }),
}));
jest.mock('../../shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../shared/services/reading-assessment.service', () => ({}));
jest.mock('../../shared/services/feature-linker.service', () => ({}));
jest.mock('../../shared/services/feature-intro.service', () => ({}));
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../shared/services/video/video-orchestrator.service', () => ({
  checkAwaitingTopic: jest.fn().mockResolvedValue(null),
  checkAwaitingCustomization: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null),
  isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
  setUserLanguage: jest.fn(),
}));
jest.mock('../../shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => null),
  parseSubjectAndGrade: jest.fn(() => ({})),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn().mockResolvedValue(undefined),
  storeLessonPlan: jest.fn(),
}));
jest.mock('../../shared/config/supabase', () => {
  const chain = {};
  ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert',
   'delete', 'not', 'gte', 'lte', 'is'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
});
// The job queue is the network boundary of the clip head start (SQS on the bot).
jest.mock('../../shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));

// --- inline-required (lazy) modules on the text path — all fall-through ---
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({
  isSchoolLeader: jest.fn(() => false),
  OBSERVE_TRIGGER_RX: /^\/observe\b/i,
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/handlers/exam-checker.handler', () => ({
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));


const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const OpenAIService = require('../../shared/services/openai.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');
const WebQuizLink = require('../../shared/services/quiz/web-quiz-link');
const WebQuizService = require('../../shared/services/quiz/web-quiz.service');
const OldLink = require('../../shared/services/quiz/web-quiz-old-link');
const { resolveUx } = require('../../shared/config/ux-strings');

const CHILD = '923001112233';
const TEACHER_PHONE = '923009998877';
const TEACHER_ID = 'teacher-1';
const CODE = 'K7RM2Q';
const MESSAGE = { id: 'wamid.inbound.test' };
const shareCode = (over = {}) => ({
  id: 'sc-1', code: CODE, quiz_id: 'quiz-1', video_id: null, teacher_user_id: TEACHER_ID,
  teacher_name: 'Ms Hina', topic: 'Fractions', language: 'en', active: true, expires_at: null,
  invited_by_student_id: null, parent_share_code_id: null, ...over,
});
function stub({ sc = shareCode(), settings = {} } = {}) {
  supabase.from.mockImplementation((table) => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'not', 'gte', 'lte', 'is', 'neq'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.maybeSingle = jest.fn(async () => {
      if (table === 'quiz_share_codes') return { data: sc, error: null };
      if (table === 'users') return { data: { id: TEACHER_ID, phone_number: TEACHER_PHONE, first_name: 'Hina' }, error: null };
      return { data: null, error: null };
    });
    chain.single = jest.fn(async () => ({ data: null, error: { code: 'PGRST116' } }));
    chain.then = (resolve) => Promise.resolve({ data: table === 'app_settings' ? Object.entries(settings).map(([key, value]) => ({ key, value })) : [], error: null }).then(resolve);
    return chain;
  });
}
async function settle() { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); }
const ON = { web_quiz_enabled: 'true', web_quiz_teachers: '"all"', web_quiz_old_link_redirect: 'true' };
const OFF = { web_quiz_enabled: 'true', web_quiz_teachers: '"all"', web_quiz_old_link_redirect: 'false' };
const events = (name) => logEvent.mock.calls.filter(([e]) => e === name).map(([, p]) => p);
let now;
let wamidSeq;

/** The child's two moves: the old link (a real redirect through the handler), then a typed text. */
async function redirect(phone = CHILD) {
  await handleTextMessage(MESSAGE, phone, `QUIZ-${CODE}`, null);
  await settle();
}
async function typed(text, phone = CHILD) {
  // A text that reaches the general conversation goes past what this harness mocks; that is the AI path.
  await handleTextMessage(MESSAGE, phone, text, null).catch(() => {});
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  redisService._store.clear();
  now = Date.parse('2026-10-08T05:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  wamidSeq = 0;
  WhatsAppService.sendCtaUrl.mockImplementation(async (to, msg, opts) => {
    wamidSeq += 1;
    if (opts && typeof opts.onMessageId === 'function') opts.onMessageId(`wamid.cta.${wamidSeq}`);
    return true;
  });
  WebQuizLink._resetCache();
  OldLink._resetCache();
  try { require('../../shared/services/quiz/web-quiz-handset')._resetCache(); } catch (_) { /* absent */ }
});
afterEach(() => { Date.now.mockRestore && Date.now.mockRestore(); });

describe('the redirect body names the button the child must tap, and says there is nothing to type', () => {
  test.each(['en', 'ur'])('%s: the body names the button exactly as it renders, within the field caps', async (lang) => {
    stub({ sc: shareCode({ language: lang }), settings: ON });
    await redirect();
    const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    const button = resolveUx('vqOldLinkBtn', { language: lang });
    expect(msg.buttonText).toBe(button);
    expect(msg.body).toContain(`*${button}*`);
    expect(msg.body).toContain('👇');
    expect(msg.body).toMatch(lang === 'en' ? /no need to type/ : /لکھنے کی ضرورت نہیں/);
    expect(msg.body).not.toMatch(/https?:\/\//);
    expect([...msg.body].length).toBeLessThanOrEqual(1024);
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
  });
});

describe('the redirect logs the id of the message it sent', () => {
  test('web_quiz.old_link_redirect carries the wamid Meta returned (ids only)', async () => {
    stub({ settings: ON });
    await redirect();
    const [ev] = events('web_quiz.old_link_redirect');
    expect(ev).toEqual(expect.objectContaining({ sent: true, wamid: 'wamid.cta.1' }));
    expect(JSON.stringify(ev)).not.toContain(CHILD);
  });
});

describe('a child who TYPES after the button gets the same button once, instead of the AI chat', () => {
  test('a text within 10 minutes: ONE more button, identical to the first, and no AI reply', async () => {
    stub({ settings: ON });
    await redirect();
    now += 40 * 1000;
    await typed('Ayesha');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(2);
    const [first, again] = WhatsAppService.sendCtaUrl.mock.calls;
    expect(again[0]).toBe(CHILD);
    expect(again[1]).toEqual(first[1]);
    expect(OpenAIService.detectIntent).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    const [ev] = events('web_quiz.old_link_reoffer');
    expect(ev).toEqual(expect.objectContaining({ code: CODE, shareCodeId: 'sc-1', quizId: 'quiz-1', sent: true, wamid: 'wamid.cta.2', phoneTail: CHILD.slice(-4) }));
    expect(ev.afterS).toBe(40);
    expect(JSON.stringify(ev)).not.toMatch(/Ayesha|923001112233/);
  });

  test('the second text goes to the AI chat as today (never more than one re-offer per redirect)', async () => {
    stub({ settings: ON });
    await redirect();
    now += 20 * 1000;
    await typed('Ayesha');
    now += 20 * 1000;
    await typed('hello?');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(2);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(1);
    expect(OpenAIService.detectIntent).toHaveBeenCalledTimes(1);
  });

  test('two texts racing in the same instant still get ONE re-offer', async () => {
    stub({ settings: ON });
    await redirect();
    now += 5 * 1000;
    await Promise.all([typed('Ayesha'), typed('Khan')]);
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(2);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(1);
  });

  test('after 10 minutes: the AI chat, no button', async () => {
    stub({ settings: ON });
    await redirect();
    now += 10 * 60 * 1000 + 1000;
    await typed('Ayesha');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
    expect(OpenAIService.detectIntent).toHaveBeenCalledTimes(1);
  });

  test('mid chat quiz: unchanged — no button', async () => {
    stub({ settings: ON });
    await redirect();
    await redisService.set(`videoquiz:${CHILD}:active`, { sessionId: 'sess-7', quizId: 'quiz-1' });
    now += 30 * 1000;
    await typed('hello');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
    expect(events('web_quiz.old_link_reoffer_skipped')).toEqual([expect.objectContaining({ reason: 'chat_quiz_running', code: CODE })]);
  });

  test('the page was opened on that code since the button: no button (the tap worked)', async () => {
    stub({ settings: ON });
    await redirect();
    now += 15 * 1000;
    WebQuizService.events({ events: [{ n: 'page_open', code: CODE, src: 'quiz' }] });
    await settle();
    now += 30 * 1000;
    await typed('done');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer_skipped')).toEqual([expect.objectContaining({ reason: 'opened' })]);
    expect(OpenAIService.detectIntent).toHaveBeenCalledTimes(1);
  });

  test('a page_open BEFORE the button (another child, earlier) does not block the re-offer', async () => {
    stub({ settings: ON });
    WebQuizService.events({ events: [{ n: 'page_open', code: CODE, src: 'quiz' }] });
    await settle();
    now += 5 * 1000;
    await redirect();
    now += 20 * 1000;
    await typed('Ayesha');
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(1);
  });

  test('the redirect flag turned off since: the AI chat, no button', async () => {
    stub({ settings: ON });
    await redirect();
    stub({ settings: OFF });
    OldLink._resetCache();
    now += 20 * 1000;
    await typed('Ayesha');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
  });

  test("the teacher's own self-test redirect is never re-offered: a teacher's next text is for the assistant", async () => {
    stub({ settings: ON });
    await redirect(TEACHER_PHONE);
    now += 20 * 1000;
    await typed('make me a lesson plan', TEACHER_PHONE);
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
  });

  test('a /command after the button is its own request: no button, and the re-offer stays for a plain text', async () => {
    stub({ settings: ON });
    await redirect();
    now += 20 * 1000;
    await typed('/quiz');
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
  });

  test('a phone that got no redirect: unchanged', async () => {
    stub({ settings: ON });
    await typed('Ayesha');
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(OpenAIService.detectIntent).toHaveBeenCalledTimes(1);
  });

  test('a refused re-offer send falls through to the AI chat, logged sent:false', async () => {
    stub({ settings: ON });
    await redirect();
    WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
    now += 20 * 1000;
    await typed('Ayesha');
    expect(events('web_quiz.old_link_reoffer')).toEqual([expect.objectContaining({ sent: false })]);
    expect(OpenAIService.detectIntent).toHaveBeenCalledTimes(1);
  });

  test('a redirect that Meta refused leaves nothing to re-offer', async () => {
    stub({ settings: ON });
    WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
    await redirect();
    now += 20 * 1000;
    await typed('Ayesha');
    expect(events('web_quiz.old_link_reoffer')).toHaveLength(0);
  });
});
