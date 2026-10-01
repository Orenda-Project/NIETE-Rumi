'use strict';
/**
 * bd-onxyu — every door to a feature asks that feature's app-redirect switch.
 *
 * Drives the REAL text handler and the REAL menu router (the harness is the one
 * tests/quiz/quiz-bare-text-routing.test.js uses). Each case turns on ONLY the
 * switch it expects, so a Play Store notice proves the door asks the right one;
 * with every switch off the same message behaves exactly as before.
 *
 * Doors that cannot be driven here (voice notes, images, webhook buttons) are
 * pinned at the source, with comments stripped so a match cannot land on prose.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const fs = require('fs');
const path = require('path');
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  },
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
const mockGetResponse = jest.fn().mockResolvedValue('a warm answer');
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...a) => mockGetResponse(...a),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
};
const mockTypingStop = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
  sendLanguageSelectionList: (...a) => mockWa.sendLanguageSelectionList(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: mockTypingStop }),
}));

jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(async ({ existingContext }) => existingContext || null),
  buildLpContext: jest.fn().mockResolvedValue({ entries: [] }),
  deliveryHint: () => '',
}));
jest.mock('../../bot/shared/services/lp612-edit-router.service', () => ({
  maybeHandleLp612Reply: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(async () => global.__TEST_USER__),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn(),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

// The exam session lives in a table the memory stub cannot query (.not()); its
// lookup is stubbed, the keyword matcher stays real.
const mockActiveExam = jest.fn().mockResolvedValue(false);
const mockHandleExamText = jest.fn().mockResolvedValue(null);
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  ...jest.requireActual('../../bot/shared/handlers/exam-checker.handler'),
  hasActiveExamSession: (...a) => mockActiveExam(...a),
  handleExamText: (...a) => mockHandleExamText(...a),
}));

const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { PROMPTS } = require('../../bot/shared/config/conversational-components');

const PLAY = 'https://play.google.com/store/apps/details?id=pk.edu.niete';
const PHONE = '923002220000';
const TEACHER = {
  id: 'u-teacher', phone_number: PHONE, name: 'T', first_name: 'T', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};
const ALL_KEYS = [
  'teacher_training', 'lesson_plan', 'assessment_generator', 'ai_coaching', 'observe', 'remark',
  'reading_test', 'quiz', 'video', 'homework', 'exam_checker', 'attendance', 'classes',
  'presentation', 'general_chat',
].map((f) => `app_redirect_${f}`);

function seed(onKeys = []) {
  return {
    users: [{ ...TEACHER }],
    app_settings: onKeys.map((key) => ({ key, value: true })),
    user_feature_first_use: [],
    coaching_sessions: [],
  };
}

// Doors that exist on one branch and not another (sandbox carries /observe2 and the LP
// worker's cutover rescue; staging/main carry the pic-to-LP image route). Each check runs
// where its door exists, so one copy of this file holds on every branch.
const botFile = (rel) => path.join(__dirname, '../../bot', rel);
const HAS_OBSERVE2 = fs.existsSync(botFile('shared/services/observe/observe2/start.js'));

const ENV = {
  TEACHER_TRAINING_FLOW_ID: 'flow-training',
  ASSESSMENT_GEN_FLOW_ID: 'flow-assess',
  PAKISTAN_LP_FLOW_ID: 'flow-lp',
  HOMEWORK_FLOW_ID: 'flow-hw',
  TRANSCRIPT_QUIZ_ENABLED: 'true',
  TRANSCRIPT_QUIZ_FLOW_ID: 'flow-tq',
};

let handler;
function load(onKeys) {
  jest.resetModules();
  mockDb = makeDb(seed(onKeys));
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function say(body) {
  global.__TEST_USER__ = { ...TEACHER };
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, { ...TEACHER });
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

const notices = () => mockWa.sendMessage.mock.calls.filter(([, b]) => typeof b === 'string' && b.includes(PLAY));
const anyOtherSend = () =>
  mockWa.sendFlow.mock.calls.length
  + mockWa.sendInteractiveMessage.mock.calls.length
  + mockWa.sendInteractiveButtons.mock.calls.length
  + mockWa.sendFeatureMenuCarousel.mock.calls.length
  + mockWa.sendMessage.mock.calls.filter(([, b]) => !(typeof b === 'string' && b.includes(PLAY))).length;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  Object.assign(process.env, ENV);
  delete process.env.APP_STORE_URL;
});
afterAll(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

// [message, the ONE switch that must answer it]
const TEXT_DOORS = [
  ['/training', 'teacher_training'],
  ['/trainings', 'teacher_training'],
  ['training', 'teacher_training'],
  ['open training', 'teacher_training'],
  ['/certificates', 'teacher_training'],
  [PROMPTS[2], 'teacher_training'], // "Teacher training" chip
  ['/assessment', 'assessment_generator'],
  ['/assess', 'assessment_generator'],
  ['/exams', 'assessment_generator'],
  ['lesson plan', 'lesson_plan'], // bare LP command
  [PROMPTS[0], 'lesson_plan'], // "Lesson plan" chip
  ['/coaching', 'ai_coaching'],
  ['coaching', 'ai_coaching'],
  [PROMPTS[1], 'ai_coaching'], // "AI coaching" chip
  ['/observe', 'observe'],
  ...(HAS_OBSERVE2 ? [['/observe2', 'observe']] : []),
  ['/remark', 'remark'],
  ['/reading test', 'reading_test'],
  ['/readingtest', 'reading_test'],
  ['/quiz', 'quiz'],
  ['quiz', 'quiz'],
  ['/video', 'video'],
  ['/videos', 'video'],
  ['homework', 'homework'],
  ['/homework', 'homework'],
  ['check papers', 'exam_checker'],
  ['attendance', 'attendance'],
  ['/attendance', 'attendance'],
  ['/roster', 'classes'],
  ['/classes', 'classes'],
];

describe('switch on → that door sends the Play Store notice and nothing else', () => {
  test.each(TEXT_DOORS)('%s → app_redirect_%s', async (text, feature) => {
    load([`app_redirect_${feature}`]);
    await say(text);
    expect(notices()).toHaveLength(1);
    expect(notices()[0][1]).toBe(resolveUx('appRedirectNotice', { language: 'en', params: { url: PLAY } }));
    expect(anyOtherSend()).toBe(0);
    expect(mockGetResponse).not.toHaveBeenCalled();
    expect(mockTypingStop).toHaveBeenCalled();
    expect(mockDb.tables.user_feature_first_use).toEqual([
      expect.objectContaining({ user_id: TEACHER.id, feature: 'app_redirect_notice', intro_shown_count: 1 }),
    ]);
  });
});

describe('open messages — the classifier\'s answer picks the switch', () => {
  test.each([
    ['lesson_plan', 'lesson_plan', 'make me a lesson plan on fractions for grade 4'],
    ['presentation', 'presentation', 'make slides on the water cycle'],
    ['video', 'video', 'make an animated video about magnets'],
    ['general', 'general_chat', 'how do I manage a noisy class?'],
  ])('intent %s → app_redirect_%s', async (intentType, feature, text) => {
    load([`app_redirect_${feature}`]);
    mockDetectIntent.mockResolvedValueOnce({ type: intentType, message: text });
    await say(text);
    expect(notices()).toHaveLength(1);
    expect(anyOtherSend()).toBe(0);
    expect(mockGetResponse).not.toHaveBeenCalled();
  });

  test('general chat switched off → the teacher gets her AI answer as before', async () => {
    load([]);
    mockDetectIntent.mockResolvedValueOnce({ type: 'general', message: 'hi' });
    await say('how do I manage a noisy class?');
    expect(notices()).toHaveLength(0);
    expect(mockGetResponse).toHaveBeenCalled();
  });
});

describe('exam checker', () => {
  test('a teacher already inside an exam session keeps going — her answer is not a new request', async () => {
    load(['app_redirect_exam_checker']);
    mockActiveExam.mockResolvedValueOnce(true);
    mockHandleExamText.mockResolvedValueOnce({ handled: true });
    await say('check papers');
    expect(notices()).toHaveLength(0);
    expect(mockHandleExamText).toHaveBeenCalled();
  });
});

describe('the quiet hour holds across doors', () => {
  test('second request inside the hour: no reply at all — no notice, no feature, no AI chat', async () => {
    load(ALL_KEYS);
    await say('/training');
    expect(notices()).toHaveLength(1);
    jest.clearAllMocks();

    await say('/assessment');
    await say('lesson plan');
    mockDetectIntent.mockResolvedValueOnce({ type: 'general', message: 'x' });
    await say('how do I manage a noisy class?');

    expect(mockWa.sendMessage).not.toHaveBeenCalled();
    expect(anyOtherSend()).toBe(0);
    expect(mockGetResponse).not.toHaveBeenCalled();
  });

  test('after the hour the next request gets the notice again', async () => {
    load(['app_redirect_teacher_training']);
    mockDb.tables.user_feature_first_use.push({
      user_id: TEACHER.id, feature: 'app_redirect_notice',
      video_shown_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(), intro_shown_count: 1,
    });
    await say('/training');
    expect(notices()).toHaveLength(1);
  });
});

describe('switches off (the default) → nothing changes', () => {
  test.each([
    ['/training', 'flow-training'],
    ['/assessment', null],
    ['lesson plan', 'flow-lp'],
  ])('%s behaves as before', async (text, flowId) => {
    load([]);
    await say(text);
    expect(notices()).toHaveLength(0);
    if (flowId) expect(mockWa.sendFlow.mock.calls.some(([, o]) => o && o.flowId === flowId)).toBe(true);
    expect(mockDb.tables.user_feature_first_use).toHaveLength(0);
  });
});

describe('account and navigation commands are never redirected', () => {
  test.each(['/menu', '/language', '/settings', '/portal', '/status', '/register'])(
    '%s with every switch on sends no notice', async (text) => {
      load(ALL_KEYS);
      await say(text);
      expect(notices()).toHaveLength(0);
    });
});

describe('the menu router', () => {
  const menu = () => require('../../bot/shared/services/menu.service');

  test.each([
    ['menu_training', 'teacher_training'],
    ['menu_lesson_plan', 'lesson_plan'],
    ['menu_assessment', 'assessment_generator'],
    ['menu_coaching', 'ai_coaching'],
    ['menu_observe', 'observe'],
    ['menu_reading', 'reading_test'],
    ['menu_quiz', 'quiz'],
    ['menu_videos', 'video'],
    ['menu_video', 'video'],
    ['menu_attendance', 'attendance'],
    ['menu_classes', 'classes'],
    ['menu_roster', 'classes'],
  ])('row %s → app_redirect_%s', async (row, feature) => {
    load([`app_redirect_${feature}`]);
    await menu().handleMenuButtonResponse({ ...TEACHER }, PHONE, row, 'en');
    expect(notices()).toHaveLength(1);
    expect(anyOtherSend()).toBe(0);
  });

  test('menu_language is never redirected', async () => {
    load(ALL_KEYS);
    await menu().handleMenuButtonResponse({ ...TEACHER }, PHONE, 'menu_language', 'en');
    expect(notices()).toHaveLength(0);
    expect(mockWa.sendLanguageSelectionList).toHaveBeenCalled();
  });

  test.each([[1, 'ai_coaching'], [2, 'lesson_plan'], [3, 'video'], [4, 'general_chat']])(
    'numbered choice %s → app_redirect_%s', async (choice, feature) => {
      load([`app_redirect_${feature}`]);
      await menu().handleMenuChoice(String(choice), TEACHER.id, 'sess-1', PHONE, 'text', 'en');
      expect(notices()).toHaveLength(1);
      expect(anyOtherSend()).toBe(0);
    });
});

describe('the shared doors ask too (any door not yet routed through a router)', () => {
  test('openTrainingFlow', async () => {
    load(['app_redirect_teacher_training']);
    const { openTrainingFlow } = require('../../bot/shared/services/training/training-entry.service');
    expect(await openTrainingFlow({ ...TEACHER }, PHONE, 'en')).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
  });

  test('openAssessmentFlow', async () => {
    load(['app_redirect_assessment_generator']);
    const { openAssessmentFlow } = require('../../bot/shared/services/assessment-entry.service');
    expect(await openAssessmentFlow({ from: PHONE, userId: TEACHER.id, language: 'en' })).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
  });

  test('openLpBrowseFlow reports HANDLED so no caller falls back to another LP path', async () => {
    load(['app_redirect_lesson_plan']);
    const { openLpBrowseFlow } = require('../../bot/shared/services/lp-browse-entry.service');
    expect(await openLpBrowseFlow({ from: PHONE, userId: TEACHER.id, language: 'en' })).toBe(true);
    expect(notices()).toHaveLength(1);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
  });

  test('the coaching door ("Record my lesson" lands here too)', async () => {
    load(['app_redirect_ai_coaching']);
    await require('../../bot/shared/services/menu.service')
      ._handleClassroomCoachingChoice(TEACHER.id, 'sess-1', PHONE, 'en');
    expect(notices()).toHaveLength(1);
    expect(anyOtherSend()).toBe(0);
  });
});

describe('doors that cannot be driven here are wired at the source', () => {
  const src = (rel) => fs.readFileSync(path.join(__dirname, '../../bot', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  test('voice: a classroom recording asks ai_coaching; the intent asks its switch, else general_chat', () => {
    const s = src('shared/handlers/voice-message.handler.js');
    expect(s).toMatch(/redirectIfFlagged\('ai_coaching'/);
    expect(s).toMatch(/\[intent\.type\]\s*\|\|\s*'general_chat'/);
    expect(s).toMatch(/redirectIfFlagged\(voiceFeature/);
  });

  test('image: generic vision analysis asks general_chat before it runs', () => {
    const s = src('shared/handlers/image-message.handler.js');
    const ask = s.indexOf("redirectIfFlagged('general_chat'");
    expect(ask).toBeGreaterThan(-1);
    // Either at the call site, or as the first thing inside runImageAnalysis itself (where
    // every caller, including the pic-LP coalescer's fallback, passes through it).
    const def = s.indexOf('async function runImageAnalysis(');
    const call = s.indexOf('await runImageAnalysis(');
    expect(call).toBeGreaterThan(-1);
    const insideDef = def > -1 && ask > def && ask < s.indexOf('\n}\n', def);
    expect(insideDef || ask < call).toBe(true);
  });

  test('image: where the pic-to-LP route exists, a textbook page asks lesson_plan before any session', () => {
    const s = src('shared/handlers/image-message.handler.js');
    const fnAt = s.indexOf('async function handleCoalescedBatch(');
    if (fnAt === -1) return; // no pic-to-LP route on this branch
    const fn = s.slice(fnAt, s.indexOf('\n}\n', fnAt));
    const ask = fn.indexOf("redirectIfFlagged('lesson_plan'");
    const create = fn.indexOf('PicLpSession.create(');
    expect(ask).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(create);
  });

  test('the LP worker\'s cutover rescue redirects BEFORE it opens the menu and adds its menu line', () => {
    const s = src('workers/lesson-plan-generation.worker.js');
    const at = s.indexOf('async function openLpBrowseFlowForCutover');
    if (at === -1) return; // no cutover rescue on this branch
    const fn = s.slice(at);
    const ask = fn.indexOf("redirectIfFlagged('lesson_plan'");
    const open = fn.indexOf('await openLpBrowseFlow(');
    expect(ask).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(open);
  });

  test('webhook buttons that START training or the video library ask their switch', () => {
    const s = src('whatsapp-bot.js');
    expect(s).toMatch(/module_exam_start_'\)\) \{\s*if \(await buttonRedirectsToApp\('teacher_training'/);
    expect(s).toMatch(/capstone_start_'\)\) \{\s*if \(await buttonRedirectsToApp\('teacher_training'/);
    expect(s).toMatch(/openStudentVideosFlowFromCta\(message, from, user\) \{\s*if \(await buttonRedirectsToApp\('video'/);
  });
});
