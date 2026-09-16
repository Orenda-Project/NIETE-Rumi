/**
 * bd-b708h, second layer — the whole survey as the teacher walks it.
 *
 * The unit suite (`used-in-class.test.js`) calls each handler directly with a hand-written button
 * id. That cannot catch the failure this lane's own header opens with: the id the bot EMITS and
 * the id the bot PARSES drifting apart. A teacher taps, an unknown id is logged, and the datum is
 * gone with no error anywhere — which is exactly how `used_in_class` came to read 0 of 524.
 *
 * So nothing here is hardcoded. Every tap replays an id taken out of the payload the previous step
 * actually sent, from `deliverRender` — the one function both delivery paths go through — to the
 * row. The only strings asserted are the catalog's own.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(true);
const mockRedisStore = new Map();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
  sendInteractiveButtons: (...a) => mockSendInteractiveButtons(...a),
}));
// A real (in-memory) Redis, not a jest.fn: the 👎 branch ARMS a window that a later step must
// find still armed. A double that always returns null would make that leg vacuously pass.
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: async (k, v) => { mockRedisStore.set(k, v); return true; },
  get: async (k) => (mockRedisStore.has(k) ? mockRedisStore.get(k) : null),
  delete: async (k) => { mockRedisStore.delete(k); return true; },
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

/**
 * Per-TABLE result queues, not the single FIFO the unit suite uses. A journey runs `deliverRender`
 * first, and its own reads would eat results queued for the survey three steps later — leaving a
 * green test that proved nothing. Anything unqueued settles as an empty success.
 */
const dbCalls = [];
const dbResults = {};
const queue = (table, ...rows) => {
  dbResults[table] = (dbResults[table] || []).concat(rows.map((data) => ({ data, error: null })));
};
function mockBuilder(table) {
  const state = { table, op: 'select', payload: null, filters: [] };
  const settle = () => {
    dbCalls.push({ ...state });
    const q = dbResults[table];
    return Promise.resolve(q && q.length ? q.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: jest.fn(() => Promise.resolve({ data: [], error: null })),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const Feedback = require('../../bot/shared/services/lp612-feedback.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const PHONE = '923001111111';
const USER_ID = 'u1';
const SEGMENT_ID = 'grade_9_chemistry.c01.p007-008';
const SEGMENT = {
  segment_id: SEGMENT_ID, book_stem: 'grade_9_chemistry', grade: 9, subject: 'Chemistry',
  chapter_number: 1, chapter_title: 'Chapter One', subtopic_title: 'Branches of chemistry',
  menu_title: 'Branches of chemistry', printed_page_start: 7, printed_page_end: 8,
};

const updates = (t) => dbCalls.filter((c) => c.table === t && c.op === 'update');
const inserts = (t) => dbCalls.filter((c) => c.table === t && c.op === 'insert');
const lastButtons = () => {
  const calls = mockSendInteractiveButtons.mock.calls;
  return calls.length ? calls[calls.length - 1][1] : null;
};
/** Find the button she is about to tap BY ITS CATALOG TITLE, never by a guessed id. */
const buttonTitled = (payload, key, language) => {
  const title = resolveUx(key, { language });
  const found = (payload.buttons || []).find((b) => b.title === title);
  if (!found) throw new Error(`no button titled "${title}" in ${JSON.stringify(payload.buttons)}`);
  return found.id;
};

/**
 * Delivery, then the thirty-second wait, then Q1 on her screen.
 * @returns the Q1 payload as WhatsApp received it.
 */
async function deliverAndWaitForSurvey(language) {
  queue('users', { preferred_language: language });          // _voiceOf, inside the timer
  queue('lp_feedback', null);                                // ask-once check: not yet asked

  await Serving.deliverRender({
    phone: PHONE, userId: USER_ID, r2Key: 'lp612/v9.6/en/x.pdf',
    segment: SEGMENT, lang: 'en', oneScreen: 'Summary.',
  });

  await jest.advanceTimersByTimeAsync(Feedback.FEEDBACK_DELAY_MS);
  return lastButtons();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  dbCalls.length = 0;
  Object.keys(dbResults).forEach((k) => delete dbResults[k]);
  mockRedisStore.clear();
});
afterEach(() => jest.useRealTimers());

describe('👍 → she is asked whether she taught it, and the answer reaches the column', () => {
  test('delivery to used_in_class, every tap replayed from what was sent', async () => {
    // She is an Urdu-UI teacher who ordered an ENGLISH chemistry plan. Both questions must arrive
    // in Urdu (language-protocol invariant 4) even though the document is English.
    const q1 = await deliverAndWaitForSurvey('ur');
    expect(q1.body).toBe(resolveUx('lp612FeedbackAsk', { language: 'ur' }));

    // ── tap 👍 ────────────────────────────────────────────────────────────
    queue('users', { id: USER_ID, preferred_language: 'ur' });
    queue('niete_lp612_segments', SEGMENT);
    queue('lp_feedback', null, { id: 'fb-1' });               // no existing verdict → insert

    const owned = await Feedback.handleFeedbackButton(
      buttonTitled(q1, 'lp612FeedbackYes', 'ur'), PHONE,
    );
    expect(owned).toBe(true);
    expect(inserts('lp_feedback')[0].payload).toMatchObject({
      user_id: USER_ID, lp612_segment_id: SEGMENT_ID, useful: true,
      trigger_mode: 'after_pdf_only', lp_variant: 'lp612_en',
    });

    // ── Q2 is now on her screen, in place of the old dead-end thank-you ───
    const q2 = lastButtons();
    expect(q2).not.toBe(q1);
    expect(q2.body).toBe(resolveUx('lp612UsedAsk', { language: 'ur' }));
    expect(q2.buttons).toHaveLength(3);

    // ── tap "آج پڑھا دیا" ─────────────────────────────────────────────────
    queue('users', { id: USER_ID, preferred_language: 'ur' });

    const taughtId = buttonTitled(q2, 'lp612UsedTaught', 'ur');
    expect(await Feedback.handleUsageButton(taughtId, PHONE)).toBe(true);

    // The point of the whole bead: the column is no longer NULL for a 6-12 row.
    const written = updates('lp_feedback');
    expect(written).toHaveLength(1);
    expect(written[0].payload).toEqual({ used_in_class: 'taught' });
    expect(written[0].filters).toEqual(
      expect.arrayContaining([['user_id', USER_ID], ['lp612_segment_id', SEGMENT_ID]]),
    );

    expect(mockSendMessage).toHaveBeenLastCalledWith(
      PHONE, resolveUx('lp612UsedThanks', { language: 'ur' }),
    );
  });

  test('"Not yet" is an answer, not a silence — it lands as not_yet', async () => {
    // The distinction the column exists for. A teacher who has the plan and has not taught it yet
    // is NOT the same as one we never asked, and both used to be NULL.
    const q1 = await deliverAndWaitForSurvey('en');

    queue('users', { id: USER_ID, preferred_language: 'en' });
    queue('niete_lp612_segments', SEGMENT);
    queue('lp_feedback', null, { id: 'fb-2' });
    await Feedback.handleFeedbackButton(buttonTitled(q1, 'lp612FeedbackYes', 'en'), PHONE);

    queue('users', { id: USER_ID, preferred_language: 'en' });
    await Feedback.handleUsageButton(
      buttonTitled(lastButtons(), 'lp612UsedNotYet', 'en'), PHONE,
    );

    expect(updates('lp_feedback')[0].payload).toEqual({ used_in_class: 'not_yet' });
  });
});

describe('👎 → the lane still asks why, and never asks about use', () => {
  test('a thumbs-down arms the reason window and consumes her next message', async () => {
    const q1 = await deliverAndWaitForSurvey('en');
    const buttonsBefore = mockSendInteractiveButtons.mock.calls.length;

    queue('users', { id: USER_ID, preferred_language: 'en' });
    queue('niete_lp612_segments', SEGMENT);
    queue('lp_feedback', null, { id: 'fb-3' });
    await Feedback.handleFeedbackButton(buttonTitled(q1, 'lp612FeedbackNo', 'en'), PHONE);

    // No second interactive message at all — asking a teacher who just said the plan was no use
    // whether she taught it reads as not listening.
    expect(mockSendInteractiveButtons.mock.calls).toHaveLength(buttonsBefore);
    expect(mockSendMessage).toHaveBeenLastCalledWith(
      PHONE, resolveUx('lp612FeedbackAskReason', { language: 'en' }),
    );

    // The window really is armed — proven by driving the consumer, not by inspecting a spy.
    queue('users', { preferred_language: 'en' });
    const consumed = await Feedback.consumeReasonIfPending(
      USER_ID, PHONE, 'The experiment needs apparatus we do not have.',
    );
    expect(consumed).toBe(true);
    const reasonWrite = updates('lp_feedback').find((c) => c.payload.reason_text);
    expect(reasonWrite.payload.reason_text).toBe('The experiment needs apparatus we do not have.');
    expect(updates('lp_feedback').some((c) => 'used_in_class' in c.payload)).toBe(false);
  });
});

describe('the ids survive the round trip', () => {
  test('every emitted Q2 id parses back to the same segment the PDF was for', async () => {
    const q1 = await deliverAndWaitForSurvey('en');

    queue('users', { id: USER_ID, preferred_language: 'en' });
    queue('niete_lp612_segments', SEGMENT);
    queue('lp_feedback', null, { id: 'fb-4' });
    await Feedback.handleFeedbackButton(buttonTitled(q1, 'lp612FeedbackYes', 'en'), PHONE);

    // The segment id is dotted, hyphenated and full of underscores; the emitter and the parser
    // must agree about where it starts. Checked for all three answers, because `not_yet` is the
    // one whose own underscore can be mistaken for the separator.
    for (const { id } of lastButtons().buttons) {
      const m = Feedback.USAGE_RX.exec(id);
      expect(m).not.toBeNull();
      expect(m[2]).toBe(SEGMENT_ID);
    }
  });
});
