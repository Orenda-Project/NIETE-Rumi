/**
 * A send that an HTTP response is waiting on must never wait out a phone's pacing schedule.
 *
 * THE BUG (introduced by per-recipient pacing, caught in review before merge). Meta gives a
 * WhatsApp Flow's data_exchange request about 10 seconds, and some endpoints AWAIT a send before
 * returning the next screen — the Student Videos Flow sends "🎬 Sending your video…" and only then
 * returns SUCCESS, so the ack lands above the screen. With pacing, that send waits for its slot in
 * the recipient's schedule: 6 s per message once the burst is spent, up to the 120 s shed cap. The
 * Student Videos Flow is opened most by a CHILD straight after finishing a quiz (the binge round) —
 * exactly the phone that has just spent its burst — so the Flow would time out and the child would
 * see Meta's "Something went wrong".
 *
 * THE FIX. A send may carry a synchronous budget: `{ maxWaitMs: 1500, ifLate }`. Within the budget
 * it waits for its slot as any send does. Past it, it never waits:
 *   - ifLate 'skip' — not sent at all, logged `whatsapp.paced {outcome:'skipped', reason:'sync_budget'}`.
 *     For an ack that precedes the real content (the video / lesson plan follows seconds later).
 *   - ifLate 'send' — sent NOW, unpaced (exactly what every send did before pacing existed), and it
 *     still takes a slot so what follows is paced behind it. For a send that IS the deliverable.
 * A budgeted send is never retried: the shortest backoff (6 s) would itself blow the budget.
 *
 * Everything here runs the REAL WhatsApp service and pacer and, for the routes, the REAL endpoint
 * handler. Only the network is faked: `fetch`, the axios stub, supabase, R2, and the Redis boundary
 * (helpers/fake-pair-store.js — the same arithmetic as the Lua script).
 */

jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'),
  logEvent: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn(),
  getPresignedUrl: jest.fn(async () => 'https://signed.example/lp.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));

const { FakePairStore } = require('./helpers/fake-pair-store');
const mockStore = new FakePairStore();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockStore.isAvailable(),
  evalScript: (...a) => mockStore.evalScript(...a),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  setexWithCeiling: jest.fn().mockResolvedValue('OK'),
}));

// A supabase fake: rows per table, honouring .eq() and the terminal shapes these routes use.
const mockTables = {};
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = (table) => {
    let rows = (mockTables[table] || []).slice();
    const q = {
      select: () => q, is: () => q, not: () => q, order: () => q, limit: () => q, gte: () => q,
      in: (k, vs) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
      eq: (k, v) => { rows = rows.filter((r) => String(r[k]) === String(v)); return q; },
      range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
      single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }),
      maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      insert: () => Promise.resolve({ data: null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return { from: jest.fn((t) => builder(t)), rpc: jest.fn().mockResolvedValue({ data: null, error: null }) };
});

// The Student Videos delivery that FOLLOWS the response (not what is under test here).
jest.mock('../../bot/shared/services/quiz/video-quiz.service', () => ({
  quizForVideo: jest.fn().mockResolvedValue({ id: 'quiz-1' }),
  startSession: jest.fn().mockResolvedValue(undefined),
  offerAfterVideo: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/student-video-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(),
}));

const axios = require('axios'); // mapped stub
const { logToFile } = require('../../bot/shared/utils/logger');
const pacer = require('../../bot/shared/services/whatsapp-send-pacer');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const CHILD = '923001110003';
const TEACHER = '923001110004';
const T0 = 1_800_000_000_000;
const BUDGET = 1500;
const SKIP = { maxWaitMs: BUDGET, ifLate: 'skip' };
const SEND = { maxWaitMs: BUDGET, ifLate: 'send' };

const ok = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) });
const refused = (code) => ({
  ok: false, status: 400,
  json: async () => ({ error: { message: `(#${code}) refused`, code, fbtrace_id: 'X' } }),
});
const eventsNamed = (name) => logToFile.mock.calls.filter((c) => c[0] === name);
const bodiesTo = (phone) => global.fetch.mock.calls
  .map((c) => JSON.parse(c[1].body)).filter((b) => b.to === phone);
const axiosMessagesTo = (phone) => axios.post.mock.calls
  .filter((c) => /\/messages$/.test(c[0]) && c[1] && c[1].to === phone);

/** Resolve `p` against fake time; answer whether it settled within `ms`. */
async function settlesWithin(p, ms) {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await jest.advanceTimersByTimeAsync(ms);
  return settled;
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  mockStore.tat.clear();
  mockStore.calls = [];
  mockStore.available = true;
  logToFile.mockClear();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.AX' }] }, status: 200 });
  global.fetch = jest.fn().mockResolvedValue(ok());
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  process.env.WA_PAIR_INTERVAL_MS = '6000';
  process.env.WA_PAIR_BURST = '8';
  process.env.WA_RATE_LIMIT_RETRY_BASE_MS = '6000';
});

afterEach(() => { jest.useRealTimers(); });

afterAll(() => {
  delete process.env.WA_PAIR_INTERVAL_MS;
  delete process.env.WA_PAIR_BURST;
  delete process.env.WA_RATE_LIMIT_RETRY_BASE_MS;
});

describe('the budget, through the real WhatsApp service', () => {
  test("ifLate 'skip' on a full schedule: returns false at once, sends nothing, takes no slot", async () => {
    await mockStore.fill(pacer.pairKey(CHILD));
    const p = WhatsAppService.sendMessage(CHILD, 'ack', { budget: SKIP });
    expect(await settlesWithin(p, 0)).toBe(true);
    await expect(p).resolves.toBe(false);
    expect(bodiesTo(CHILD)).toHaveLength(0);

    const paced = eventsNamed('whatsapp.paced');
    expect(paced).toHaveLength(1);
    expect(paced[0][2]).toBe('info');
    expect(paced[0][1]).toMatchObject({ outcome: 'skipped', reason: 'sync_budget', delayMs: 6000 });
    // Not an error line: a deliberate skip is not a failed send.
    expect(logToFile.mock.calls.find((c) => c[0] === '❌ Error sending WhatsApp message')).toBeUndefined();

    // The skipped ack took no slot: the next ordinary send still waits one interval, not two.
    const next = WhatsAppService.sendMessage(CHILD, 'video follows');
    expect(await settlesWithin(next, 6000)).toBe(true);
  });

  test("ifLate 'skip' within the budget: waits for its slot and sends", async () => {
    await mockStore.fill(pacer.pairKey(CHILD));
    await jest.advanceTimersByTimeAsync(4800); // the next slot is now 1.2 s away
    const p = WhatsAppService.sendMessage(CHILD, 'ack', { budget: SKIP });
    expect(await settlesWithin(p, 1199)).toBe(false);
    expect(await settlesWithin(p, 1)).toBe(true);
    await expect(p).resolves.toBe(true);
    expect(bodiesTo(CHILD)).toHaveLength(1);
  });

  test("ifLate 'send' on a full schedule: sent now, unpaced, and it still takes a slot", async () => {
    await mockStore.fill(pacer.pairKey(TEACHER));
    const p = WhatsAppService.sendMessage(TEACHER, 'the deliverable', { budget: SEND });
    expect(await settlesWithin(p, 0)).toBe(true);
    await expect(p).resolves.toBe(true);
    expect(bodiesTo(TEACHER)).toHaveLength(1);
    expect(eventsNamed('whatsapp.paced')[0][1]).toMatchObject({ outcome: 'unpaced', reason: 'sync_budget' });

    // It took the next slot, so the ordinary send after it waits two intervals.
    const next = WhatsAppService.sendMessage(TEACHER, 'next');
    expect(await settlesWithin(next, 11999)).toBe(false);
    expect(await settlesWithin(next, 1)).toBe(true);
  });

  test('a budgeted send refused with 131056 is not retried — the backoff alone would blow the budget', async () => {
    global.fetch.mockResolvedValue(refused(131056));
    const p = WhatsAppService.sendMessage(TEACHER, 'the deliverable', { budget: SEND });
    expect(await settlesWithin(p, 0)).toBe(true);
    await expect(p).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const give = eventsNamed('whatsapp.rate_limited');
    expect(give).toHaveLength(1);
    expect(give[0][2]).toBe('error');
    expect(give[0][1]).toMatchObject({ code: 131056, gaveUp: true, reason: 'sync_budget' });
    // The phone is still pushed back, so what follows the response backs off.
    expect(mockStore.calls.some((c) => c.args[3] === 'penalize')).toBe(true);
  });

  test('the axios senders take the budget too (document by link, template)', async () => {
    await mockStore.fill(pacer.pairKey(TEACHER));
    const doc = WhatsAppService.sendDocumentByLink(TEACHER, 'https://x/p.pdf', 'p.pdf', '', { budget: SEND });
    expect(await settlesWithin(doc, 0)).toBe(true);
    await expect(doc).resolves.toBe(true);
    const tpl = WhatsAppService.sendTemplate(TEACHER, 'otp', 'en', [], { budget: SEND });
    expect(await settlesWithin(tpl, 0)).toBe(true);
    await expect(tpl).resolves.toBe(true);
    expect(axiosMessagesTo(TEACHER)).toHaveLength(2);
  });
});

describe('Student Videos Flow: a child who just finished a quiz picks the next video', () => {
  test('SELECT_TOPIC answers within the budget; the ack is skipped, the video still follows', async () => {
    const ChildFlowToken = require('../../bot/shared/services/quiz/child-flow-token');
    const { handleStudentVideosDataExchange } = require('../../bot/shared/routes/student-videos-endpoint');
    mockTables.student_videos = [{
      id: 'video-1', grade: '3', subject: 'Maths', clean_chapter: 'Numbers',
      clean_title: 'Even and Odd', r2_url: 'https://r2/v1.mp4', migration_status: 'done',
    }];
    const token = ChildFlowToken.build({ phone: CHILD, shareCodeId: 'sc-1', studentId: 'stu-1', language: 'en' });
    // The quiz she just finished spent her burst.
    await mockStore.fill(pacer.pairKey(CHILD));

    const p = handleStudentVideosDataExchange(token, 'SELECT_TOPIC', { grade: '3', subject: 'Maths', video: 'video-1' });

    expect(await settlesWithin(p, BUDGET)).toBe(true);
    const res = await p;
    expect(res.screen).toBe('SUCCESS');
    expect(bodiesTo(CHILD).filter((b) => /Sending your video/.test((b.text || {}).body || ''))).toHaveLength(0);
    expect(eventsNamed('whatsapp.paced').map((e) => e[1])).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcome: 'skipped', reason: 'sync_budget' })]),
    );
    const VideoQuizService = require('../../bot/shared/services/quiz/video-quiz.service');
    expect(VideoQuizService.startSession).toHaveBeenCalledWith(expect.objectContaining({ phone: CHILD }));
  });

  test('a child with room still gets the ack BEFORE the SUCCESS screen, as before', async () => {
    const ChildFlowToken = require('../../bot/shared/services/quiz/child-flow-token');
    const { handleStudentVideosDataExchange } = require('../../bot/shared/routes/student-videos-endpoint');
    mockTables.student_videos = [{
      id: 'video-1', grade: '3', subject: 'Maths', clean_chapter: 'Numbers',
      clean_title: 'Even and Odd', r2_url: 'https://r2/v1.mp4', migration_status: 'done',
    }];
    const token = ChildFlowToken.build({ phone: CHILD, shareCodeId: 'sc-1', studentId: 'stu-1', language: 'en' });
    const res = await handleStudentVideosDataExchange(token, 'SELECT_TOPIC', { grade: '3', subject: 'Maths', video: 'video-1' });
    expect(res.screen).toBe('SUCCESS');
    expect(bodiesTo(CHILD).filter((b) => /Sending your video/.test(b.text.body))).toHaveLength(1);
  });
});

describe('LP Flow (pre-generated lesson): a teacher who just had several lesson plans', () => {
  test('SELECT_TOPIC answers within the budget; the ack is skipped, the PDF still follows', async () => {
    mockTables.pre_generated_lps = [{
      id: 'r-1', grade: 3, subject: 'English', chapter_number: 1, chapter_title: 'Hello',
      pdf_r2_key_en: 'lesson_plans/x.pdf', pdf_r2_key_ur: null,
    }];
    mockTables.users = [{ id: 'u-1', phone_number: TEACHER, preferred_language: 'en' }];
    const { handlePakistanLpDataExchange } = require('../../bot/shared/routes/pakistan-lp-endpoint');
    await mockStore.fill(pacer.pairKey(TEACHER));

    const p = handlePakistanLpDataExchange('u-1:pakistan-lp:1', 'SELECT_TOPIC', { topic: 'PK-r-1' });

    expect(await settlesWithin(p, BUDGET)).toBe(true);
    expect((await p).screen).toBe('SUCCESS');
    expect(bodiesTo(TEACHER).filter((b) => /Sending your lesson plan/.test((b.text || {}).body || ''))).toHaveLength(0);
    // The PDF itself is sent after the response, paced like any other send.
    await jest.advanceTimersByTimeAsync(6000);
    expect(axiosMessagesTo(TEACHER).filter((c) => c[1].type === 'document')).toHaveLength(1);
  });
});

describe('observe form refused (the observation is over): the notice IS the deliverable', () => {
  test('the refusal answers within the budget and the notice is sent now, unpaced', async () => {
    process.env.OBSERVE_FRAMEWORK = 'fico';
    mockTables.coaching_sessions = [{
      id: 'sess-1', user_id: 't-1', observer_user_id: 'coach-1', status: 'cancelled',
      observation_type: 'leader_observation', analysis_data: {},
    }];
    mockTables.users = [{ id: 'coach-1', phone_number: TEACHER, preferred_language: 'en' }];
    const { handleObserveMewakaRequest: handle } = require('../../bot/shared/routes/observe-mewaka-endpoint');
    await mockStore.fill(pacer.pairKey(TEACHER));

    const p = handle({ action: 'INIT', flow_token: 'coach-1:sess-1', data: {} });

    expect(await settlesWithin(p, BUDGET)).toBe(true);
    await p;
    expect(bodiesTo(TEACHER)).toHaveLength(1);
    expect(eventsNamed('whatsapp.paced')[0][1]).toMatchObject({ outcome: 'unpaced', reason: 'sync_budget' });
  });
});
