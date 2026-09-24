'use strict';
/**
 * The /quiz FLOW lists lesson plans with no quiz yet, labels every row, and
 * makes the quiz only when the teacher chooses "Make it in …" on the lesson.
 *
 * The label rides in the NavigationList item's `metadata` line — a field the
 * published Flow JSON already renders (`main-content.metadata`, 80 code
 * points) — so no Flow republish is needed for it. Driven through the real
 * endpoint, list service, providers and claim; network boundary mocked.
 */

const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() },
  isAvailable: () => true,
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm-1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: jest.fn() };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Endpoint = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');

const T = 'u-teacher';
const PHONE = '923001112222';
const TOKEN = `${T}:transcript-quiz:1`;
const cp = (s) => [...String(s || '')].length;

function pkt(days, hourPkt) {
  const d = new Date(Date.now() - days * 86400000);
  const ymd = new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hourPkt).padStart(2, '0')}:00:00+05:00`).toISOString();
}
const asset = (id, lessonId) => ({
  id, lesson_id: lessonId, asset_kind: 'lesson', version_stamp: `v8-${id}`, content_hash: `h-${id}`, is_current: true,
});
const sourceOf = (a) => ({ asset_id: a.id, lesson_id: a.lesson_id, version_stamp: a.version_stamp, content_hash: a.content_hash, verified: 'upload', slide_script: {} });
const download = (id, a, createdAt) => ({
  id, user_id: T, lesson_id: a.lesson_id, asset_id: a.id, version_stamp: a.version_stamp, content_hash: a.content_hash,
  status: 'sent', grade: Number(a.lesson_id.split('_')[1]), subject: a.lesson_id.split('_').slice(2, -2).join('_'), created_at: createdAt,
});

function seedWith(downloads, assets, { sessions = [], language = 'en' } = {}) {
  return {
    users: [{ id: T, phone_number: PHONE, preferred_language: language, role: 'teacher' }],
    niete_lp_assets: assets,
    niete_lp_asset_sources: assets.map(sourceOf),
    niete_lp_downloads: downloads,
    coaching_sessions: sessions,
    quizzes: [],
    quiz_sessions: [],
    teacher_nudges: [],
  };
}

const A_MATH = asset('a-math', 'grade_4_math_ch1_seg1');
const A_URDU = asset('a-urdu', 'grade_4_urdu_ch2_seg3');
const REC = {
  id: 'cs-1', user_id: T, status: 'completed', observation_type: null, created_at: pkt(5, 9),
  transcript_text: 'x'.repeat(4000), analysis_data: { topic: 'Photosynthesis', subject: 'science' },
};

const flush = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));
const quizRows = () => mockDb.tables.quizzes.filter((q) => q.quiz_source === 'lp_v8');

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  mockDb = makeDb(seedWith([download('d-math', A_MATH, pkt(2, 9)), download('d-urdu', A_URDU, pkt(3, 9))],
    [A_MATH, A_URDU], { sessions: [REC] }));
});

describe('LESSONS — lesson plans listed, every item labelled, caps held', () => {
  test('the lesson plans appear next to the recording, newest first, labelled in metadata', async () => {
    const res = await Endpoint.handleTranscriptQuizInit(TOKEN);
    expect(res.screen).toBe('LESSONS');
    const items = res.data.items;
    expect(items.map((i) => i.id)).toEqual(['lsn_lp_v8_d-math', 'lsn_lp_v8_d-urdu', 'cs-1']);
    const lp = resolveUx('tqRowFromLessonPlan', { language: 'en' });
    const tr = resolveUx('tqRowFromTranscript', { language: 'en' });
    expect(items[0]['main-content'].metadata.startsWith(`${lp} · `)).toBe(true);
    expect(items[2]['main-content'].metadata.startsWith(`${tr} · `)).toBe(true);
    expect(items[0]['main-content'].description).toBe(resolveUx('tqFlowStatusNone', { language: 'en' }));
    expect(items[0]['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'lesson', session_id: 'lsn_lp_v8_d-math' } });
    items.forEach((i) => {
      expect(cp(i['main-content'].title)).toBeLessThanOrEqual(30);
      expect(cp(i['main-content'].description)).toBeLessThanOrEqual(20);
      expect(cp(i['main-content'].metadata)).toBeLessThanOrEqual(80);
    });
    expect(quizRows()).toHaveLength(0);
  });

  test('Urdu teacher: the Urdu label', async () => {
    mockDb = makeDb(seedWith([download('d-math', A_MATH, pkt(2, 9))], [A_MATH], { language: 'ur' }));
    const res = await Endpoint.handleTranscriptQuizInit(TOKEN);
    const label = resolveUx('tqRowFromLessonPlan', { language: 'ur' });
    expect(res.data.items[0]['main-content'].metadata.startsWith(`${label} · `)).toBe(true);
  });

  test('more than one page: 18 per page, the lesson plans page like everything else', async () => {
    const assets = [];
    const downloads = [];
    for (let i = 1; i <= 20; i += 1) {
      const a = asset(`a-${i}`, `grade_4_english_ch${i}_seg1`);
      assets.push(a);
      downloads.push(download(`d-${String(i).padStart(2, '0')}`, a, pkt(i, 9)));
    }
    mockDb = makeDb(seedWith(downloads, assets));
    const p1 = await Endpoint.handleTranscriptQuizInit(TOKEN);
    expect(p1.data.items).toHaveLength(19);
    expect(p1.data.items[18].id).toBe('__older__');
    const p2 = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'page', page: 2 });
    expect(p2.data.items.map((i) => i.id)).toEqual(['__newer__', 'lsn_lp_v8_d-19', 'lsn_lp_v8_d-20']);
  });
});

describe('LESSON → make: generated only on the teacher\'s choice', () => {
  test('a maths lesson offers the two languages; nothing is made by opening it', async () => {
    const res = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lsn_lp_v8_d-math' });
    expect(res.screen).toBe('LESSON');
    expect(res.data.actions.map((a) => a.id).sort()).toEqual(['make_en', 'make_ur']);
    expect(res.data.heading).toBe('Place value & reading 5-digit numbers');
    expect(quizRows()).toHaveLength(0);
  });

  test('an Urdu lesson offers one "Make the quiz"', async () => {
    const res = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lsn_lp_v8_d-urdu' });
    expect(res.data.actions.map((a) => a.id)).toEqual(['make_ur']);
  });

  test('Make it in English → the Flow closes, ONE lp_v8 quiz in English is queued, a second submit makes nothing', async () => {
    const submit = () => Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'make_en', session_id: 'lsn_lp_v8_d-math', quiz_id: '',
    });
    const res = await submit();
    expect(res).toEqual({ screen: 'SUCCESS', data: { extension_message_response: { params: { tq_action: 'make', language: 'en' } } } });
    await flush();
    const [q] = quizRows();
    expect(q).toEqual(expect.objectContaining({ status: 'generating', language: 'en', quiz_source: 'lp_v8' }));
    expect(q.meta).toEqual(expect.objectContaining({ source: 'flow', language_choice: 'en' }));
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('lpQuizMaking', { language: 'en' }));

    // The Flow re-drawn after the make: the lesson is its quiz now, not a second "make".
    const again = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lsn_lp_v8_d-math' });
    expect(again.data && again.data.actions ? again.data.actions.map((a) => a.id) : []).not.toContain('make_en');
    await submit();
    await flush();
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('a recording still makes its quiz from the lesson screen (regression)', async () => {
    const res = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'make_en', session_id: 'cs-1', quiz_id: '',
    });
    expect(res.screen).toBe('SUCCESS');
    await flush();
    const tq = mockDb.tables.quizzes.filter((q) => q.quiz_source === 'transcript');
    expect(tq).toHaveLength(1);
    expect(tq[0]).toEqual(expect.objectContaining({ coaching_session_id: 'cs-1', status: 'generating', language: 'en' }));
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });
});

// ── kill switches (operator, 24 Sep): unset = on; 'false' / '0' / 'off' = the old behaviour, exactly ──

describe('kill switches in the Flow', () => {
  afterEach(() => { delete process.env.QUIZ_MENU_LESSON_ROWS; delete process.env.QUIZ_MENU_SOURCE_LABELS; });

  test('QUIZ_MENU_LESSON_ROWS=false: no lesson-plan item, and a lesson key from an older screen makes nothing', async () => {
    process.env.QUIZ_MENU_LESSON_ROWS = 'false';
    const res = await Endpoint.handleTranscriptQuizInit(TOKEN);
    expect(res.data.items.map((i) => i.id)).toEqual(['cs-1']);
    const opened = await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 'lsn_lp_v8_d-math' });
    expect(opened.screen).toBe('LESSONS');
    expect(opened.data.error_message).toBeTruthy();
    await Endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'make_en', session_id: 'lsn_lp_v8_d-math', quiz_id: '',
    });
    await flush();
    expect(quizRows()).toHaveLength(0);
  });

  test('QUIZ_MENU_SOURCE_LABELS=false: an item\'s metadata is its topic alone, as before', async () => {
    process.env.QUIZ_MENU_SOURCE_LABELS = 'off';
    const res = await Endpoint.handleTranscriptQuizInit(TOKEN);
    const rec = res.data.items.find((i) => i.id === 'cs-1');
    expect(rec['main-content'].metadata).toBe('Photosynthesis');
  });
});
