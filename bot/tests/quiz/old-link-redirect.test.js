'use strict';
/**
 * An old WhatsApp quiz link — a text carrying `QUIZ-<code>`, handed out before the
 * web quiz was switched on — must open the WEB quiz instead of starting the chat
 * quiz, once app_settings `web_quiz_old_link_redirect` is on.
 *
 * Driven through the REAL text handler (handleTextMessage → tryShareCodeJoin →
 * beginFromCodeLocked → beginFromCode), with only the network boundary mocked:
 * WhatsApp sends, Supabase, Redis. The redirect is ONE cta_url message; nothing
 * is started in chat. Every guard keeps today's path: flag off, the web quiz off
 * for that teacher, a chat quiz already running on the phone, a refused send.
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
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
}));
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
const { logEvent } = require('../../shared/utils/structured-logger');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');
const WebQuizLink = require('../../shared/services/quiz/web-quiz-link');
const Queue = require('../../shared/services/queue');
const OldLink = (() => { try { return require('../../shared/services/quiz/web-quiz-old-link'); } catch (_) { return null; } })();

const CHILD = '923001112233';
const TEACHER_PHONE = '923009998877';
const TEACHER_ID = 'teacher-1';
const CODE = 'K7RM2Q';
const MESSAGE = { id: 'wamid.old-link.test' };
const shareCode = (over = {}) => ({
  id: 'sc-1', code: CODE, quiz_id: 'quiz-1', video_id: null, teacher_user_id: TEACHER_ID,
  teacher_name: 'Ms Hina', topic: 'Fractions', language: 'en', active: true, expires_at: null,
  invited_by_student_id: null, parent_share_code_id: null, ...over,
});

/** Table-driven Supabase: the share code, the app_settings flags, the teacher row for the self-test. */
function stub({ sc = shareCode(), settings = {}, teacherPhone = TEACHER_PHONE, quiz = null } = {}) {
  const rows = (table) => {
    if (table === 'app_settings') return Object.entries(settings).map(([key, value]) => ({ key, value }));
    return [];
  };
  supabase.from.mockImplementation((table) => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'not', 'gte', 'lte', 'is', 'neq'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.maybeSingle = jest.fn(async () => {
      if (table === 'quiz_share_codes') return { data: sc, error: null };
      if (table === 'users') return { data: { id: TEACHER_ID, phone_number: teacherPhone, first_name: 'Hina' }, error: null };
      if (table === 'quizzes') return { data: quiz, error: null };
      return { data: null, error: null };
    });
    chain.single = jest.fn(async () => ({ data: null, error: { code: 'PGRST116' } }));
    chain.then = (resolve) => Promise.resolve({ data: rows(table), error: null }).then(resolve);
    return chain;
  });
}

/** The join runs after the webhook has answered (setImmediate); let it finish. */
async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
}

const ON = { web_quiz_enabled: 'true', web_quiz_teachers: '"all"', web_quiz_old_link_redirect: 'true' };

beforeEach(() => {
  jest.clearAllMocks();
  redisService.get.mockResolvedValue(null);
  redisService.set.mockResolvedValue('OK');
  redisService.setNX = jest.fn().mockResolvedValue(true);
  redisService.delete = jest.fn().mockResolvedValue(true);
  WhatsAppService.sendCtaUrl.mockResolvedValue(true);
  WebQuizLink._resetCache();
  if (OldLink && OldLink._resetCache) OldLink._resetCache();
});

describe('an old wa.me quiz link, with the redirect on', () => {
  test('a child texting QUIZ-<code> gets ONE cta_url to the web quiz page and nothing starts in chat', async () => {
    stub({ settings: ON });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();

    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(to).toBe(CHILD);
    expect(msg.url).toBe(`https://portal.test/q/${CODE}`);
    expect(msg.body).toMatch(/Ms Hina/);
    expect(msg.body).toMatch(/Fractions/);
    expect(msg.body).not.toMatch(/https?:\/\//);          // nothing forwardable carries the link
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
    // Nothing started in chat: no join Flow, no name question, no question 1.
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    // The chat join state is cleared so the child's next text is not eaten as a name.
    expect(redisService.delete).toHaveBeenCalledWith(`videoquiz:${CHILD}:join`);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.objectContaining({
      shareCodeId: 'sc-1', quizId: 'quiz-1', code: CODE, kind: 'child', sent: true,
    }));
    const [, payload] = logEvent.mock.calls.find(([e]) => e === 'web_quiz.old_link_redirect');
    expect(JSON.stringify(payload)).not.toMatch(CHILD);
    expect(payload.phoneTail).toBe(CHILD.slice(-4));   // the join key the other quiz events carry, never the phone
    // The running-quiz state is never touched: only the pre-name join state is cleared.
    expect(redisService.delete).not.toHaveBeenCalledWith(`videoquiz:${CHILD}:active`);
  });

  test('an Urdu quiz: the body and the button are Urdu, the button within 20 code points', async () => {
    stub({ sc: shareCode({ language: 'ur' }), settings: ON });
    await handleTextMessage(MESSAGE, CHILD, `quiz-${CODE.toLowerCase()}`, null);
    await settle();

    const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(msg.body).toMatch(/[؀-ۿ]/);
    expect(msg.buttonText).toMatch(/[؀-ۿ]/);
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
    expect(msg.url).toBe(`https://portal.test/q/${CODE}`);
  });

  test("the teacher's own link opens the web page as a signed preview (?p=), still never a child", async () => {
    stub({ settings: ON });
    await handleTextMessage(MESSAGE, TEACHER_PHONE, `QUIZ-${CODE}`, null);
    await settle();

    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(msg.url).toMatch(new RegExp(`^https://portal.test/q/${CODE}\\?p=.+`));
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.objectContaining({ kind: 'self_test' }));
  });

  test("a friend's invite code redirects to that code's page (the web collapses it to the class)", async () => {
    stub({ sc: shareCode({ id: 'sc-inv', invited_by_student_id: 'stu-9', parent_share_code_id: 'sc-1' }), settings: ON });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();

    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendCtaUrl.mock.calls[0][1].url).toBe(`https://portal.test/q/${CODE}`);
  });

  test('an expired code is still told so in chat, not redirected', async () => {
    stub({ sc: shareCode({ expires_at: '2020-01-01T00:00:00Z' }), settings: ON });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();

    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/expired/i);
  });
});

describe("today's chat path is kept when", () => {
  const expectChatJoin = ({ ctaTried = false } = {}) => {
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(ctaTried ? 1 : 0);
    // No join Flow configured in this test: the child is asked their name in chat, as today.
    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1]));
    expect(bodies.some((b) => /what is your name/i.test(b))).toBe(true);
  };

  test('the flag is off (default)', async () => {
    stub({ settings: { web_quiz_enabled: 'true', web_quiz_teachers: '"all"' } });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expectChatJoin();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_kept', expect.objectContaining({ shareCodeId: 'sc-1', reason: 'flag_off' }));
  });

  test('the web quiz is off for this teacher (fail closed, like the new links)', async () => {
    stub({ settings: { web_quiz_enabled: 'true', web_quiz_teachers: '["someone-else"]', web_quiz_old_link_redirect: 'true' } });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expectChatJoin();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_kept', expect.objectContaining({ reason: 'web_off' }));
  });

  test('a chat quiz is already running on this phone (the child finishes it in chat)', async () => {
    stub({ settings: ON });
    redisService.get.mockImplementation(async (key) => (key === `videoquiz:${CHILD}:active` ? { sessionId: 'sess-7', quizId: 'quiz-1' } : null));
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_kept', expect.objectContaining({ reason: 'chat_quiz_running', phoneTail: CHILD.slice(-4) }));
    expect(redisService.delete).not.toHaveBeenCalledWith(`videoquiz:${CHILD}:active`);
  });

  test('Meta refuses the cta_url send: no dead end, the chat join runs', async () => {
    stub({ settings: ON });
    WhatsAppService.sendCtaUrl.mockResolvedValue(false);
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expectChatJoin({ ctaTried: true });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.objectContaining({ sent: false }));
  });

  test('unrelated text that merely mentions a quiz is not a code', async () => {
    stub({ settings: ON });
    // Not a code, so the text goes on down the handler to the general conversation, which is
    // not under test here (its model client is not mocked past the intent door).
    await handleTextMessage(MESSAGE, CHILD, 'QUIZ-ABC', null).catch(() => {});
    await settle();
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith('quiz_share_codes');
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.anything());
  });
});

// An old chat quiz was never opened on the web, so its read-aloud clips do not exist yet. They take
// about a minute to record, and children start 20-160 s after the button: asked for only when the
// page first opens, they land after the child has begun, and a phone with no voice reads in silence.
// So the redirect asks for them the moment it decides to redirect, before the button is even sent.
describe('the read-aloud clips get a head start at the redirect', () => {
  const audioJobs = () => Queue.queueJob.mock.calls.filter((c) => c[1] === 'quiz_web_audio');
  const NOT_CURRENT = { id: 'x', audio_v: null, audio_voice: null };
  const CURRENT = { id: 'x', audio_v: String(require('../../shared/services/quiz/web-quiz-publish.service').AUDIO_VERSION), audio_voice: 'sx-grace' };

  test('a quiz without current clips: ONE quiz_web_audio job for that quiz, asked before the button is sent', async () => {
    stub({ sc: shareCode({ quiz_id: 'quiz-hs-new' }), settings: ON, quiz: NOT_CURRENT });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(audioJobs()).toHaveLength(1);
    expect(audioJobs()[0][2]).toEqual({ quizId: 'quiz-hs-new' });
    // Asked before the send: the quiz's clip state is read before the button goes out.
    const read = supabase.from.mock.calls.findIndex(([t]) => t === 'quizzes');
    expect(read).toBeGreaterThanOrEqual(0);
    expect(supabase.from.mock.invocationCallOrder[read]).toBeLessThan(WhatsAppService.sendCtaUrl.mock.invocationCallOrder[0]);
  });

  test("the teacher's own link (self-test preview) asks for them too", async () => {
    stub({ sc: shareCode({ quiz_id: 'quiz-hs-self' }), settings: ON, quiz: NOT_CURRENT });
    await handleTextMessage(MESSAGE, TEACHER_PHONE, `QUIZ-${CODE}`, null);
    await settle();
    expect(audioJobs().map((c) => c[2].quizId)).toEqual(['quiz-hs-self']);
  });

  test('a quiz whose clips are already current: no job', async () => {
    stub({ sc: shareCode({ quiz_id: 'quiz-hs-current' }), settings: ON, quiz: CURRENT });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(audioJobs()).toHaveLength(0);
  });

  test.each([
    ['flag_off', { web_quiz_enabled: 'true', web_quiz_teachers: '"all"' }, null],
    ['web_off', { web_quiz_enabled: 'true', web_quiz_teachers: '["someone-else"]', web_quiz_old_link_redirect: 'true' }, null],
    ['chat_quiz_running', ON, { sessionId: 'sess-7', quizId: 'quiz-1' }],
  ])('kept on the chat path (%s): no job', async (reason, settings, active) => {
    stub({ sc: shareCode({ quiz_id: `quiz-hs-kept-${reason}` }), settings, quiz: NOT_CURRENT });
    if (active) redisService.get.mockImplementation(async (key) => (key === `videoquiz:${CHILD}:active` ? active : null));
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_kept', expect.objectContaining({ reason }));
    expect(audioJobs()).toHaveLength(0);
  });

  test('a queue that throws never breaks the redirect: the button is still sent, nothing starts in chat', async () => {
    stub({ sc: shareCode({ quiz_id: 'quiz-hs-throw' }), settings: ON, quiz: NOT_CURRENT });
    Queue.queueJob.mockImplementationOnce(() => { throw new Error('queue down'); });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(Queue.queueJob).toHaveBeenCalledWith('quiz-hs-throw', 'quiz_web_audio', { quizId: 'quiz-hs-throw' }, expect.anything());
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.objectContaining({ quizId: 'quiz-hs-throw', sent: true }));
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a quiz read that fails never breaks the redirect either', async () => {
    stub({ sc: shareCode({ quiz_id: 'quiz-hs-dbfail' }), settings: ON, quiz: NOT_CURRENT });
    const base = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => { if (table === 'quizzes') throw new Error('db down'); return base(table); });
    await handleTextMessage(MESSAGE, CHILD, `QUIZ-${CODE}`, null);
    await settle();
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.old_link_redirect', expect.objectContaining({ sent: true }));
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});
