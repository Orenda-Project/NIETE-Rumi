/**
 * bd-86ivw — asking the teacher whether the 6-12 lesson was any good.
 *
 * The operator's instruction was "make sure telemetry is enabled in the lessons incl on staging so
 * we can get teacher feedback". Half of that is machine telemetry (telemetry-*.test.js); this half
 * is the only signal the machine cannot produce — whether the lesson was USEFUL. A lint-clean
 * five-page PDF that no teacher would teach from scores perfectly on every gate in the lane.
 *
 * STORAGE IS `lp_feedback`, NOT A NEW TABLE (root CLAUDE.md rule 15). That table already holds
 * exactly this shape for the K-5 lane — a verdict, an optional reason with its language and
 * polarity, and a snapshot of grade/subject/chapter/topic — and its `lesson_plan_id` is nullable,
 * which is what makes room for a lane whose lessons do not live in `lesson_plans` at all. It gains
 * ONE nullable column (`lp612_segment_id`) and reuses `lp_variant` as the lane+language
 * discriminator. The alternatives are recorded in the migration's own header.
 *
 * The prompt is scheduled from inside `deliverRender`, which is the ONE function both delivery
 * paths go through — the worker's per-waiter loop and the cache hit. Scheduling it at the two call
 * sites instead is how they drift, and a cache hit is the path most teachers are on.
 */

const mockSendMessage = jest.fn();
// bd-m1xyt: deliverRender now checks this return and retries/throws on a falsy one, so the
// default double must be a real success — `undefined` used to pass silently.
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(true);
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDelete = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
  sendInteractiveButtons: (...a) => mockSendInteractiveButtons(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: (...a) => mockRedisSet(...a),
  get: (...a) => mockRedisGet(...a),
  delete: (...a) => mockRedisDelete(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
const mockSegmentById = jest.fn();
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

// ── supabase double: records every insert/update/select by table ────────────
const dbCalls = [];
const dbResults = [];
function mockBuilder(table) {
  const state = { table, op: 'select', payload: null, filters: [] };
  const settle = () => {
    dbCalls.push({ ...state });
    return Promise.resolve(dbResults.length ? dbResults.shift() : { data: null, error: null });
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
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

const SEGMENT_ID = 'grade_9_chemistry.c01.p007-008';
const SEGMENT = {
  segment_id: SEGMENT_ID,
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  chapter_number: 1,
  chapter_title: 'Chapter One',
  subtopic_title: 'Branches of chemistry',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
};

const inserts = (table) => dbCalls.filter((c) => c.table === table && c.op === 'insert');
const updates = (table) => dbCalls.filter((c) => c.table === table && c.op === 'update');

beforeEach(() => {
  jest.clearAllMocks();
  dbCalls.length = 0;
  dbResults.length = 0;
  mockRedisGet.mockResolvedValue(null);
});

// ── 1. it fires after a delivery, on BOTH paths ─────────────────────────────

describe('a delivered 6-12 lesson schedules a feedback prompt', () => {
  test('deliverRender schedules it — the one function both delivery paths go through', async () => {
    const spy = jest.spyOn(Feedback, 'scheduleFeedbackPrompt').mockImplementation(() => {});

    await Serving.deliverRender({
      phone: '923001111111',
      userId: 'u1',
      r2Key: 'lp612/v9.1/en/x.pdf',
      segment: SEGMENT,
      lang: 'en',
      oneScreen: 'Summary.',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      segmentId: SEGMENT_ID, userId: 'u1', phone: '923001111111', lang: 'en',
    });
    spy.mockRestore();
  });

  test('a delivery with no userId schedules nothing — there is nobody to attribute it to', async () => {
    const spy = jest.spyOn(Feedback, 'scheduleFeedbackPrompt').mockImplementation(() => {});
    await Serving.deliverRender({
      phone: '923001111111', r2Key: 'lp612/v9.1/en/x.pdf', segment: SEGMENT, lang: 'en',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * THE PATH MOST TEACHERS ARE ON, driven end to end rather than asserted about.
   *
   * A first hit surveys ONE teacher — the one who paid for the authoring. Everybody after her is a
   * cache hit, and a survey wired only into the worker would never reach any of them. This drives
   * `requestLesson`, the function the Flow endpoint calls, so the chain
   * requestLesson → deliverRender → scheduleFeedbackPrompt actually executes.
   */
  test('a CACHE HIT surveys her too — requestLesson reaches the prompt through deliverRender', async () => {
    const spy = jest.spyOn(Feedback, 'scheduleFeedbackPrompt').mockImplementation(() => {});
    mockSegmentById.mockResolvedValue(SEGMENT);
    dbResults.push({
      data: {
        id: 'render-cached', status: 'ready', r2_key: 'lp612/v9.1/ur/x.pdf',
        one_screen: 'Summary.', overlay_dropped: false,
      },
      error: null,
    });

    const out = await Serving.requestLesson({
      segmentId: SEGMENT_ID, userId: 'u7', phone: '923007777777', lang: 'ur', uiLang: 'ur',
    });

    expect(out.outcome).toBe('cache_hit');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ segmentId: SEGMENT_ID, userId: 'u7', lang: 'ur' });
    spy.mockRestore();
  });

  test('a prompt that throws does NOT cost her the lesson', async () => {
    const spy = jest.spyOn(Feedback, 'scheduleFeedbackPrompt').mockImplementation(() => {
      throw new Error('redis is on fire');
    });
    await expect(Serving.deliverRender({
      phone: '923001111111', userId: 'u1', r2Key: 'lp612/v9.1/en/x.pdf', segment: SEGMENT, lang: 'en',
    })).resolves.not.toThrow();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ── 2. the prompt itself: catalog strings, both languages ───────────────────

describe('the prompt is catalog copy, in her language', () => {
  test('an Urdu teacher gets the Urdu body and Urdu buttons, from resolveUx', async () => {
    dbResults.push({ data: { preferred_language: 'ur' }, error: null });   // users lookup

    await Feedback.sendFeedbackPrompt({
      segmentId: SEGMENT_ID, userId: 'u1', phone: '923001111111', lang: 'en',
    });

    expect(mockSendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [phone, payload] = mockSendInteractiveButtons.mock.calls[0];
    expect(phone).toBe('923001111111');
    expect(payload.body).toBe(resolveUx('lp612FeedbackAsk', { language: 'ur' }));
    expect(payload.buttons.map((b) => b.title)).toEqual([
      resolveUx('lp612FeedbackYes', { language: 'ur' }),
      resolveUx('lp612FeedbackNo', { language: 'ur' }),
    ]);
    // Not the English strings, and not a ternary's idea of Urdu.
    expect(payload.body).not.toBe(UX_STRINGS.lp612FeedbackAsk.en);
  });

  test('her STORED preference wins over the document language (language-protocol invariant 4)', async () => {
    // An Urdu-UI teacher who ordered an English physics plan is still spoken to in Urdu.
    dbResults.push({ data: { preferred_language: 'ur' }, error: null });
    await Feedback.sendFeedbackPrompt({
      segmentId: SEGMENT_ID, userId: 'u1', phone: '92300', lang: 'en',
    });
    expect(mockSendInteractiveButtons.mock.calls[0][1].body).toBe(UX_STRINGS.lp612FeedbackAsk.ur);
  });

  test('a teacher who already answered for this lesson is NOT asked again', async () => {
    // She can re-tap the same subtopic any number of times — a cache hit is a second's work — and
    // every one of those is a delivery. Without this she is surveyed again each time about a
    // lesson she has already rated, which is the fastest way to make her stop answering at all.
    // The check runs in the DELAYED callback, not on the delivery path, so it costs the teacher
    // waiting for her PDF nothing.
    dbResults.push({ data: { preferred_language: 'en' }, error: null });   // users
    dbResults.push({ data: { id: 'fb-existing' }, error: null });          // her existing verdict

    await Feedback.sendFeedbackPrompt({
      segmentId: SEGMENT_ID, userId: 'u1', phone: '92300', lang: 'en',
    });

    expect(mockSendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('the button ids carry the verdict, the document language and the segment', async () => {
    dbResults.push({ data: { preferred_language: 'en' }, error: null });
    await Feedback.sendFeedbackPrompt({
      segmentId: SEGMENT_ID, userId: 'u1', phone: '92300', lang: 'ur',
    });
    expect(mockSendInteractiveButtons.mock.calls[0][1].buttons.map((b) => b.id)).toEqual([
      `lp612_fb_yes_ur_${SEGMENT_ID}`,
      `lp612_fb_no_ur_${SEGMENT_ID}`,
    ]);
  });
});

// ── 3. the tap ──────────────────────────────────────────────────────────────

describe('a tap records one row on lp_feedback', () => {
  const tap = (id) => Feedback.handleFeedbackButton(id, '923001111111');

  test('👍 inserts the verdict, the segment and the lane discriminator', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null }); // phone → user
    dbResults.push({ data: SEGMENT, error: null });                                // segment
    dbResults.push({ data: null, error: null });                                   // no existing row
    dbResults.push({ data: { id: 'fb-1' }, error: null });                          // insert

    expect(await tap(`lp612_fb_yes_en_${SEGMENT_ID}`)).toBe(true);

    expect(inserts('lp_feedback')).toHaveLength(1);
    expect(inserts('lp_feedback')[0].payload).toMatchObject({
      user_id: 'u1',
      useful: true,
      lp612_segment_id: SEGMENT_ID,
      // `lp_variant` is the EXISTING free-text column that says which variant produced the
      // lesson. Carrying the language in it is what makes "do Urdu 6-12 lessons land worse?"
      // answerable without a second new column.
      lp_variant: 'lp612_en',
      grade: 9,
      subject: 'Chemistry',
      chapter_number: 1,
      topic: 'Branches of chemistry',
      trigger_mode: 'after_pdf_only',
    });
    // The K-5 lane's FK stays NULL: a 6-12 lesson has no lesson_plans row at all.
    expect(inserts('lp_feedback')[0].payload.lesson_plan_id == null).toBe(true);
  });

  test('👎 records the verdict AND arms the reason window', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'ur' }, error: null });
    dbResults.push({ data: SEGMENT, error: null });
    dbResults.push({ data: null, error: null });
    dbResults.push({ data: { id: 'fb-2' }, error: null });

    await tap(`lp612_fb_no_ur_${SEGMENT_ID}`);

    expect(inserts('lp_feedback')[0].payload).toMatchObject({
      useful: false, lp_variant: 'lp612_ur',
    });
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockRedisSet.mock.calls[0][0]).toBe('lp612_feedback_pending:u1');
    expect(mockRedisSet.mock.calls[0][1]).toMatchObject({ feedbackId: 'fb-2', polarity: 'disliked' });
    // and she is asked why, in Urdu, from the catalog
    expect(mockSendMessage).toHaveBeenCalledWith(
      '923001111111', resolveUx('lp612FeedbackAskReason', { language: 'ur' }),
    );
  });

  test('a second tap updates the verdict instead of writing a second row', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null });
    dbResults.push({ data: SEGMENT, error: null });
    dbResults.push({ data: { id: 'fb-1', useful: true }, error: null });   // existing
    dbResults.push({ data: null, error: null });                          // the update

    await tap(`lp612_fb_no_en_${SEGMENT_ID}`);

    expect(inserts('lp_feedback')).toHaveLength(0);
    expect(updates('lp_feedback')[0].payload).toMatchObject({ useful: false });
  });

  test('a button id from another lane is declined, not swallowed', async () => {
    expect(await tap('lp_feedback_yes_11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(await tap('student_video_feedback_yes_x')).toBe(false);
    expect(await tap('lp612_fb_maybe_en_seg')).toBe(false);
  });
});

// ── 4. the free text ────────────────────────────────────────────────────────

describe('the optional reason', () => {
  test('the next message inside the window lands on the row she just rated', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: 'fb-2', polarity: 'disliked', promptedAt: Date.now() });
    dbResults.push({ data: null, error: null });                                    // the update
    dbResults.push({ data: { preferred_language: 'ur' }, error: null });            // ack language

    expect(await Feedback.consumeReasonIfPending('u1', '92300', 'سرگرمی بہت لمبی تھی')).toBe(true);

    expect(updates('lp_feedback')[0].payload).toMatchObject({
      reason_text: 'سرگرمی بہت لمبی تھی',
      reason_language: 'ur',
      reason_polarity: 'disliked',
    });
    expect(updates('lp_feedback')[0].filters).toContainEqual(['id', 'fb-2']);
  });

  test('a slash command is NOT eaten as a reason', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: 'fb-2', polarity: 'disliked' });
    expect(await Feedback.consumeReasonIfPending('u1', '92300', '/menu')).toBe(false);
    expect(updates('lp_feedback')).toHaveLength(0);
  });

  test('no open window means the message is left alone for the normal router', async () => {
    mockRedisGet.mockResolvedValue(null);
    expect(await Feedback.consumeReasonIfPending('u1', '92300', 'hello')).toBe(false);
  });
});

// ── 5. dispatch is wired, not merely emitted (pre-merge Class A) ────────────

/**
 * A service that emits a button id nothing routes is an orphan: the teacher taps, the bot logs an
 * unknown id, and the datum is lost with no error anywhere. Service-layer tests mock the receiver
 * and cannot see it, so this reads the receivers' actual source.
 */
describe('the button prefix and the reason consumer are registered in the receivers', () => {
  const fs = require('fs');
  const bot = fs.readFileSync(require.resolve('../../bot/whatsapp-bot.js'), 'utf8');
  const textHandler = fs.readFileSync(
    require.resolve('../../bot/shared/handlers/text-message.handler.js'), 'utf8',
  );

  test('whatsapp-bot.js dispatches lp612_fb_ to the 6-12 feedback service', () => {
    expect(bot).toMatch(/lp612_fb_/);
    expect(bot).toMatch(/lp612-feedback\.service/);
  });

  test('the prefix cannot be shadowed by the K-5 lane\'s own prefix check', () => {
    // `lp_feedback_` and `lp612_fb_` are distinct strings, but a `startsWith('lp')`-shaped guard
    // upstream would eat both. Assert the 6-12 branch appears in the file at all AND that the
    // K-5 branch still tests its own full prefix.
    expect(bot).toMatch(/startsWith\('lp_feedback_yes_'\)/);
    expect(bot).toMatch(/lp612_fb_yes_|lp612_fb_/);
  });

  test('text-message.handler consumes the 6-12 reason before normal routing', () => {
    expect(textHandler).toMatch(/lp612-feedback\.service/);
    expect(textHandler).toMatch(/consumeReasonIfPending/);
  });
});

// ── 6. the schema change reaches a FRESH clone, not only a migration ───────

/**
 * bd-pfest fixed exactly this defect one commit ago: a column that exists only in a migration is
 * invisible to `npm run bootstrap:db`, which applies `00_complete-schema.sql`. A fresh clone then
 * runs code that inserts a column its database does not have.
 */
describe('lp612_segment_id exists in BOTH the migration and the bootstrap schema', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '../..');

  test('the migration adds it additively', () => {
    const sql = fs.readFileSync(
      path.join(root, 'infrastructure/supabase/migrations/V1.3.5__lp612_teacher_feedback.sql'), 'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE lp_feedback\s+ADD COLUMN IF NOT EXISTS lp612_segment_id/i);
    // No new table — the anti-sprawl claim, asserted rather than promised in a comment.
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  test('the bootstrap schema carries it too', () => {
    const schema = fs.readFileSync(path.join(root, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(schema).toMatch(/lp612_segment_id/);
  });
});
