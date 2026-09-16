/**
 * bd-b708h — the 6-12 lane never asked "did you get to use it in class?".
 *
 * MEASURED, not suspected. `lp_feedback.used_in_class` over 2026-09-01 → 09-16:
 * set on 4,103 of 12,396 K-5 rows (33%) and on **0 of 524** lp612 rows. The cause is one
 * branch: on a 👍 the 6-12 lane sent a thank-you and returned, while the K-5 lane sends the
 * Q2 usage prompt gated on `trigger_mode === 'after_voice_note'` — and the 6-12 lane is
 * PDF-only, so Q2 could never fire for it.
 *
 * WHY THIS COLUMN AND NOT ANOTHER. The lane has no delivery signal anywhere:
 * `niete_lp612_renders.status='ready'` means the PDF exists, `picked_up_at` is a worker claim
 * written even on undelivered failures, and `waiters` is dead. `used_in_class` is the only
 * instrument that can separate *a document was produced* from *a lesson was taught*, and it
 * was switched off in the one lane that has nothing else.
 *
 * SCOPE. bd-vw0aj gated Q2 to the voicenote bundle so a teacher whose audio failed would not
 * be asked about audio she never heard. The question asks about the LESSON, not the audio, so
 * it carries to a PDF-only lane unchanged. K-5 behaviour is asserted untouched below.
 */

const mockSendMessage = jest.fn();
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(true);
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDelete = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendInteractiveButtons: (...a) => mockSendInteractiveButtons(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: (...a) => mockRedisSet(...a),
  get: (...a) => mockRedisGet(...a),
  delete: (...a) => mockRedisDelete(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

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

const Feedback = require('../../bot/shared/services/lp612-feedback.service');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

// A real segment id, chosen because it is FULL of underscores — the part of the button id the
// parse must treat as "everything after the verdict", exactly as BUTTON_RX already does.
const SEGMENT_ID = 'grade_9_chemistry.c01.p007-008';
const SEGMENT = {
  segment_id: SEGMENT_ID, grade: 9, subject: 'Chemistry',
  chapter_number: 1, subtopic_title: 'Branches of chemistry', menu_title: 'Branches of chemistry',
};
const PHONE = '923001111111';

const updates = (table) => dbCalls.filter((c) => c.table === table && c.op === 'update');
const cps = (s) => Array.from(s).length;

/** The four reads a 👍 tap makes before the lane decides what to send. */
function primeThumbsUp(lang = 'en') {
  dbResults.push({ data: { id: 'u1', preferred_language: lang }, error: null });
  dbResults.push({ data: SEGMENT, error: null });
  dbResults.push({ data: null, error: null });
  dbResults.push({ data: { id: 'fb-1' }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  dbCalls.length = 0;
  dbResults.length = 0;
  mockRedisGet.mockResolvedValue(null);
});

// ── 1. the 👍 path now asks the second question ─────────────────────────────

describe('a thumbs-up is followed by the usage question', () => {
  test('three buttons go out, ids carrying the answer and the segment', async () => {
    primeThumbsUp('en');

    expect(await Feedback.handleFeedbackButton(`lp612_fb_yes_en_${SEGMENT_ID}`, PHONE)).toBe(true);

    expect(mockSendInteractiveButtons).toHaveBeenCalledTimes(1);
    const sent = mockSendInteractiveButtons.mock.calls[0][1];
    expect(sent.buttons.map((b) => b.id)).toEqual([
      `lp612_used_taught_${SEGMENT_ID}`,
      `lp612_used_planned_${SEGMENT_ID}`,
      `lp612_used_not_yet_${SEGMENT_ID}`,
    ]);
    expect(sent.body).toBe(resolveUx('lp612UsedAsk', { language: 'en' }));
  });

  test('she is asked in HER language, not the document\'s', async () => {
    // Urdu-UI teacher, English physics plan. Language-protocol invariant 4: the voice and the
    // document are separate territories, and the existing lane already honours it on Q1.
    primeThumbsUp('ur');

    await Feedback.handleFeedbackButton(`lp612_fb_yes_en_${SEGMENT_ID}`, PHONE);

    expect(mockSendInteractiveButtons.mock.calls[0][1].body)
      .toBe(resolveUx('lp612UsedAsk', { language: 'ur' }));
  });

  test('the bare thank-you no longer stands in for the question', async () => {
    primeThumbsUp('en');
    await Feedback.handleFeedbackButton(`lp612_fb_yes_en_${SEGMENT_ID}`, PHONE);
    // The prompt IS the acknowledgement. Sending both is two notifications for one tap.
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('a thumbs-down is left alone', () => {
  test('no usage prompt — she is asked why instead', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'ur' }, error: null });
    dbResults.push({ data: SEGMENT, error: null });
    dbResults.push({ data: null, error: null });
    dbResults.push({ data: { id: 'fb-2' }, error: null });

    await Feedback.handleFeedbackButton(`lp612_fb_no_ur_${SEGMENT_ID}`, PHONE);

    expect(mockSendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      PHONE, resolveUx('lp612FeedbackAskReason', { language: 'ur' }),
    );
  });
});

// ── 2. the tap that writes the column ───────────────────────────────────────

describe('handleUsageButton records what she did with the lesson', () => {
  const tap = (id) => Feedback.handleUsageButton(id, PHONE);

  test.each([['taught'], ['planned'], ['not_yet']])(
    '%s is written to used_in_class', async (answer) => {
      dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null });
      dbResults.push({ data: null, error: null });

      expect(await tap(`lp612_used_${answer}_${SEGMENT_ID}`)).toBe(true);

      expect(updates('lp_feedback')).toHaveLength(1);
      expect(updates('lp_feedback')[0].payload).toEqual({ used_in_class: answer });
    },
  );

  test('it updates HER row for THIS segment — not every row for the lesson', async () => {
    // The K-5 handler keys its UPDATE on `lesson_plan_id` alone. This lane has no such column
    // and one row per (teacher, segment), so both halves of that key must be in the filter or
    // one teacher's answer lands on every teacher who rated the same segment.
    dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null });
    dbResults.push({ data: null, error: null });

    await tap(`lp612_used_taught_${SEGMENT_ID}`);

    expect(updates('lp_feedback')[0].filters).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['lp612_segment_id', SEGMENT_ID]]),
    );
  });

  test('a segment id full of underscores survives the parse', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null });
    dbResults.push({ data: null, error: null });

    await tap(`lp612_used_not_yet_${SEGMENT_ID}`);

    // `not_yet` itself contains the separator, so a greedy split on '_' would hand the column
    // 'not' and the segment 'yet_grade_9_…'.
    expect(updates('lp_feedback')[0].payload).toEqual({ used_in_class: 'not_yet' });
    expect(updates('lp_feedback')[0].filters).toContainEqual(['lp612_segment_id', SEGMENT_ID]);
  });

  test('she is thanked in her own language', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'ur' }, error: null });
    dbResults.push({ data: null, error: null });

    await tap(`lp612_used_taught_${SEGMENT_ID}`);

    expect(mockSendMessage).toHaveBeenCalledWith(
      PHONE, resolveUx('lp612UsedThanks', { language: 'ur' }),
    );
  });

  test('an unstorable tap still gets a thank-you — she has done her part', async () => {
    dbResults.push({ data: { id: 'u1', preferred_language: 'en' }, error: null });
    dbResults.push({ data: null, error: { message: 'connection reset' } });

    expect(await tap(`lp612_used_taught_${SEGMENT_ID}`)).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test('an unattributable phone is owned and acked, never silent', async () => {
    dbResults.push({ data: null, error: { message: 'no such user' } });

    expect(await tap(`lp612_used_taught_${SEGMENT_ID}`)).toBe(true);
    expect(updates('lp_feedback')).toHaveLength(0);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['lp_used_taught_1f1b6a3e-0000-4000-8000-000000000000'], // the K-5 lane's own id
    ['lp612_fb_yes_en_grade_9_chemistry.c01.p007-008'],      // Q1, not Q2
    ['lp612_used_maybe_grade_9_chemistry.c01.p007-008'],     // not an offered answer
    [''], [null],
  ])('%s is not ours — returns false and touches nothing', async (id) => {
    expect(await tap(id)).toBe(false);
    expect(dbCalls).toHaveLength(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ── 3. the copy, and the cap that silently kills a send ─────────────────────

describe('every string comes from the catalog and fits WhatsApp\'s limits', () => {
  const BUTTONS = ['lp612UsedTaught', 'lp612UsedPlanned', 'lp612UsedNotYet'];
  const BODIES = ['lp612UsedAsk', 'lp612UsedThanks'];

  test.each([...BUTTONS, ...BODIES])('%s exists in both offered languages', (key) => {
    expect(UX_STRINGS[key]).toBeDefined();
    for (const lang of ['en', 'ur']) expect(typeof UX_STRINGS[key][lang]).toBe('string');
  });

  test.each(BUTTONS)('%s is inside the 20-code-point button cap', (key) => {
    // Meta does not truncate an over-cap title — it REJECTS the whole message (#131009) and
    // the question silently never appears, which is this bead's own failure mode again.
    for (const lang of ['en', 'ur']) expect(cps(UX_STRINGS[key][lang])).toBeLessThanOrEqual(20);
  });

  test.each(BODIES)('%s is inside the 1024-code-point body cap', (key) => {
    for (const lang of ['en', 'ur']) expect(cps(UX_STRINGS[key][lang])).toBeLessThanOrEqual(1024);
  });

  /**
   * EVERY file the survey lives in, discovered — not one path spelled out (bd-2dpco).
   *
   * The guard below used to name `lp612-feedback.service.js` alone. That was correct while the
   * survey was one file; the moment it was split it would have gone on passing while covering a
   * third of the code, which is the quietest way a guard dies. Globbing the prefix means a future
   * split is covered the day it lands, and a rename that escapes the prefix fails the count
   * assertion rather than silently emptying the list.
   */
  const SERVICE_DIR = require('path').resolve(__dirname, '../../bot/shared/services');
  const surveyFiles = require('fs')
    .readdirSync(SERVICE_DIR)
    .filter((f) => /^lp612-feedback.*\.js$/.test(f))
    .sort();

  test('the glob finds every file the survey lives in', () => {
    expect(surveyFiles.length).toBeGreaterThan(0);
    expect(surveyFiles).toContain('lp612-feedback.service.js');
  });

  test.each(surveyFiles)('%s stays inside the 300-line limit', (f) => {
    // Root rules — 300 lines, and "splits > abstractions". A survey that schedules, sends,
    // handles two different taps and consumes a free-text window is four jobs; it reads as one
    // file only until someone has to change one of them.
    const lines = require('fs').readFileSync(require('path').join(SERVICE_DIR, f), 'utf8')
      .split('\n').length;
    expect(lines).toBeLessThanOrEqual(300);
  });

  test.each(surveyFiles)('%s carries no inline language ternary', (f) => {
    // Root CLAUDE.md rule 20 — one catalog, one writer. The two older survey services carry
    // inline `language === 'ur' ? … : …` maps and this one deliberately does not; copying the
    // pattern in for Q2 would put five new strings outside the code-point gate.
    // Comment lines are stripped first: the file's own header NAMES the anti-pattern in prose.
    const code = require('fs')
      .readFileSync(require('path').join(SERVICE_DIR, f), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/===\s*'ur'\s*\?/);
  });
});

// ── 4. wired, not merely emitted ────────────────────────────────────────────

describe('the new prefix is dispatched and the column can reach a fresh clone', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '../..');
  const bot = fs.readFileSync(require.resolve('../../bot/whatsapp-bot.js'), 'utf8');

  test('whatsapp-bot.js routes lp612_used_ to the 6-12 service', () => {
    expect(bot).toMatch(/startsWith\('lp612_used_'\)/);
    expect(bot).toMatch(/handleUsageButton/);
  });

  test('the K-5 usage branch still tests its own full prefix', () => {
    // `lp612_used_` does not start with `lp_used_`, but a loosened guard upstream would eat
    // both and route a segment id into a handler whose regex demands a UUID.
    expect(bot).toMatch(/startsWith\('lp_used_'\)/);
  });

  test('used_in_class is in the bootstrap schema, not only in a migration', () => {
    // bd-pfest's defect class: a column that exists only in a migration is invisible to
    // `npm run bootstrap:db`, so a fresh clone runs code writing a column it does not have.
    const schema = fs.readFileSync(path.join(root, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(schema).toMatch(/used_in_class/);
    expect(schema).toMatch(/'taught',\s*'planned',\s*'not_yet'/);
  });
});
