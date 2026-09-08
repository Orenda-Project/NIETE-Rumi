/**
 * bd-oak77.26 — response-side observability for the Pakistan LP Flow endpoint.
 *
 * The hole this closes: `pakistan-lp-endpoint.js` logged `Pakistan LP
 * data_exchange` with `{flowToken, screen, step}` and NOTHING about what it
 * handed back. A screen Meta rejects, and a `{data:{error}}` object — which is
 * literally what renders as "Something went wrong. Try again later." — were
 * indistinguishable in the logs from a served screen.
 *
 * Red-first, and the assertions below execute the CHANGED lines on the live
 * dispatcher (root CLAUDE.md rule 6): the wiring tests call the exported
 * `handlePakistanLpDataExchange` / `handlePakistanLpInit` and read what the
 * structured logger was actually handed.
 */

const emitted = [];
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: jest.fn((event, data) => emitted.push({ event, data })),
}));

const mockV8Available = new Set();
const mockV8Downloaded = new Set();
jest.mock('../../shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn(async () => mockV8Available),
  downloadedLessonIds: jest.fn(async () => mockV8Downloaded),
  deliverV8Lesson: jest.fn(async () => ({ ok: true })),
}));

const mockOxRows = [];
jest.mock('../../shared/services/oxbridge-lp.service', () => ({
  gradeWord: jest.fn((g) => ({ 6: 'Grade Six', 7: 'Grade Seven' }[g] || null)),
  extractTopicFromDescription: jest.fn(() => 'Ox Topic'),
  getById: jest.fn(async () => null),
  deliverOxbridgeLp: jest.fn(async () => true),
}));

function mockBuilder(rows) {
  let out = [...rows];
  const b = {
    select: () => b,
    eq: (col, val) => { out = out.filter((r) => String(r[col]) === String(val)); return b; },
    order: () => b,
    limit: () => Promise.resolve({ data: out, error: null }),
    range: (from, to) => Promise.resolve({ data: out.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: out[0] || null, error: null }),
    maybeSingle: () => Promise.resolve({ data: out[0] || null, error: null }),
    then: (f, r) => Promise.resolve({ data: out, error: null }).then(f, r),
  };
  return b;
}
const PHONE = '923001234567';
const mockPreGenRows = [];
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'pre_generated_lps') return mockBuilder(mockPreGenRows);
    if (table === 'lesson_plan_catalog') return mockBuilder(mockOxRows);
    if (table === 'users') return mockBuilder([{ id: 'user-1', phone_number: PHONE, preferred_language: 'en' }]);
    return mockBuilder([]);
  }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const EP = require('../../shared/routes/pakistan-lp-endpoint');
const T = require('../../shared/routes/pakistan-lp-telemetry');

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 3 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      lessons: [1, 2, 3].map((i) => ({
        lesson_id: `grade_1_english_ch1_seg${i}`,
        segment_index: i, lp_type: 'content', day_label: `Day ${i}`,
        section: 'Memory Lane', section_short: 'Memory Lane',
        topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
        row: { title: 'Memory Lane', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
      })),
    }],
  }],
};

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  emitted.length = 0;
  mockV8Available.clear();
  [1, 2, 3].forEach((i) => mockV8Available.add(`grade_1_english_ch1_seg${i}`));
  mockV8Downloaded.clear();
  mockOxRows.length = 0;
  mockPreGenRows.length = 0;
});

const TOKEN = 'user-1:pakistan-lp:1788800000000';
const of = (name) => emitted.filter((e) => e.event === name).map((e) => e.data);

// ─────────────────────────────────────────────────────────────────────────
describe('1. every data_exchange and INIT logs what we returned', () => {
  test('a served screen emits lp612.flow.response with outcome=screen, item count, bytes and duration', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');

    const rows = of('lp612.flow.response');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.action).toBe('data_exchange');
    expect(r.outcome).toBe('screen');
    expect(r.screenOut).toBe('SELECT_SUBJECT');
    expect(r.screenIn).toBe('SELECT_GRADE');
    expect(r.itemCount).toBe(res.data.items.length);
    expect(r.bytes).toBe(Buffer.byteLength(JSON.stringify(res), 'utf8'));
    expect(r.wireBytesEst).toBeGreaterThan(r.bytes);
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    // no error event on a good screen
    expect(of('lp612.flow.error_screen')).toHaveLength(0);
  });

  test('INIT is observed too', async () => {
    const res = await EP.handlePakistanLpInit(TOKEN);
    const rows = of('lp612.flow.response');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('INIT');
    expect(rows[0].outcome).toBe('screen');
    expect(rows[0].screenOut).toBe('SELECT_GRADE');
    expect(rows[0].itemCount).toBe(res.data.items.length);
  });

  test('BACK is observed too', async () => {
    await EP.handlePakistanLpBack(TOKEN, 'SELECT_SUBJECT');
    const rows = of('lp612.flow.response');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('BACK');
    expect(rows[0].screenOut).toBe('SELECT_GRADE');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('2. an error object is greppable and countable', () => {
  test('a {data:{error}} response emits outcome=error AND a distinct lp612.flow.error_screen with the message', async () => {
    // No subject in the payload → the endpoint returns {data:{error:{message}}},
    // which is what Meta renders as "Something went wrong. Try again later."
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { step: 'subject', grade: '1' });
    expect(res.data.error).toBeTruthy();

    const resp = of('lp612.flow.response');
    expect(resp).toHaveLength(1);
    expect(resp[0].outcome).toBe('error');

    const errs = of('lp612.flow.error_screen');
    expect(errs).toHaveLength(1);
    expect(errs[0].errorMessage).toBe(res.data.error.message);
    expect(errs[0].outcome).toBe('error');
    expect(errs[0].step).toBe('subject');
  });

  test('an unroutable data_exchange — the invisible case — is reported as an error screen', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'MYSTERY_SCREEN', {});
    expect(res.data.error).toBeTruthy();
    expect(of('lp612.flow.error_screen')).toHaveLength(1);
    expect(of('lp612.flow.error_screen')[0].errorMessage).toBe('Something went wrong.');
  });

  test('a THROW out of the dispatcher (Meta gets a 500 → "Something went wrong") is observed, then rethrown', async () => {
    const boom = new Error('supabase exploded');
    const spy = jest.spyOn(V8Catalog, 'buildSubjectItems').mockImplementation(() => { throw boom; });
    await expect(
      EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' })
    ).rejects.toThrow('supabase exploded');
    spy.mockRestore();

    expect(of('lp612.flow.response')[0].outcome).toBe('throw');
    expect(of('lp612.flow.error_screen')[0].errorMessage).toBe('supabase exploded');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('3. identifying fields, and NOTHING that identifies a person', () => {
  test('the inbound payload identifiers ride on the event', async () => {
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', {
      step: 'lp612_chapter', grade: '9', subject: 'Chemistry', chapter_key: 'c01',
      book_stem: 'grade_9_chemistry',
    });
    const r = of('lp612.flow.response')[0];
    expect(r.grade).toBe('9');
    expect(r.subject).toBe('Chemistry');
    expect(r.chapterKey).toBe('c01');
    expect(r.bookStem).toBe('grade_9_chemistry');
    expect(r.step).toBe('lp612_chapter');
  });

  test('segment_id and lang ride on the serve step', async () => {
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: 'seg-abc', lang: 'ur',
    });
    const r = of('lp612.flow.response')[0];
    expect(r.segmentId).toBe('seg-abc');
    expect(r.lang).toBe('ur');
  });

  test('the raw flow token and the phone number NEVER appear in any emitted event', async () => {
    await EP.handlePakistanLpInit(TOKEN);
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', {
      step: 'lesson', lesson: 'grade_1_english_ch1_seg1',
    });
    expect(emitted.length).toBeGreaterThan(0);
    const blob = JSON.stringify(emitted);
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain(PHONE);
    expect(blob).not.toContain('flowToken');
    // the user uuid IS carried — it is the join key, and lp612.tap.received
    // already emits it.
    expect(of('lp612.flow.response')[0].userId).toBe('user-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('4. step vocabulary — K-5 vs 6-12 in one query', () => {
  test.each([
    ['grade', 'k5_shared'], ['subject', 'k5_shared'], ['chapter', 'k5_shared'],
    ['lesson', 'k5_shared'], ['lesson_page', 'k5_shared'],
    ['lp612_subject', 'lp612'], ['lp612_chapter', 'lp612'], ['lp612_chapter_page', 'lp612'],
    ['lp612_segment', 'lp612'], ['lp612_segment_page', 'lp612'], ['lp612_serve', 'lp612'],
  ])('step %s → vocab %s', (step, vocab) => {
    expect(T.stepVocabulary(step, 'SELECT_GRADE')).toBe(vocab);
  });

  test('a v2-Flow payload with no step is v2_screen, an unrecognised step says so', () => {
    expect(T.stepVocabulary(undefined, 'SELECT_GRADE')).toBe('v2_screen');
    expect(T.stepVocabulary(undefined, null)).toBe('none');
    expect(T.stepVocabulary('teleport', 'SELECT_GRADE')).toBe('unknown_step');
  });

  test('the vocab field lands on the live event', async () => {
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(of('lp612.flow.response')[0].vocab).toBe('k5_shared');
    emitted.length = 0;
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { step: 'lp612_subject', grade: '9' });
    expect(of('lp612.flow.response')[0].vocab).toBe('lp612');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('5. the caps that make Meta reject a screen', () => {
  test('the caps are the documented ones, in CODE POINTS', () => {
    expect(T.NAV_CAPS).toEqual({ title: 30, description: 20, metadata: 80 });
    expect(T.NAV_MAX_ITEMS).toBe(20);
    expect(T.RESPONSE_BYTES_CAP).toBe(1000000);
    // and they are the same numbers the K-5 catalogue clips to
    expect(T.NAV_CAPS.title).toBe(V8Catalog.TITLE_CAP);
    expect(T.NAV_CAPS.description).toBe(V8Catalog.DESC_CAP);
    expect(T.NAV_CAPS.metadata).toBe(V8Catalog.META_CAP);
    expect(T.NAV_MAX_ITEMS).toBe(V8Catalog.PAGE_SIZE);
  });

  test('KNOWN_SCREENS is exactly what the PUBLISHED Flow JSON declares', () => {
    const flow = require('../../../docs/flows/pakistan-lp-flow-v3.json');
    expect([...T.KNOWN_SCREENS].sort()).toEqual(flow.screens.map((s) => s.id).sort());
  });

  test('a 21-row NavigationList is a breach, with the measured value and the screen', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ id: `i${i}`, 'main-content': { title: 'ok' } }));
    const br = T.capBreaches({ screen: 'SELECT_LESSON', data: { items } });
    expect(br).toContainEqual(expect.objectContaining({ kind: 'nav_items', measured: 21, cap: 20 }));
  });

  test('title/description/metadata are measured in CODE POINTS, not UTF-16 units', () => {
    // 16 astral code points = 32 UTF-16 units. Under the 20 cap by the correct
    // measure; a `.length` check would call this a breach.
    const astral = '🙂'.repeat(16);
    expect(astral.length).toBe(32);
    expect(T.capBreaches({ screen: 'SELECT_LESSON', data: { items: [{ id: 'a', 'main-content': { description: astral } }] } }))
      .toHaveLength(0);
    // Urdu: 21 code points in a 20-cap description IS a breach
    const urdu = 'ا'.repeat(21);
    const br = T.capBreaches({ screen: 'SELECT_LESSON', data: { items: [{ id: 'a', 'main-content': { description: urdu } }] } });
    expect(br).toContainEqual(expect.objectContaining({
      kind: 'nav_text', field: 'description', measured: 21, cap: 20, itemIndex: 0, itemId: 'a',
    }));
  });

  test('a screen name the published Flow does not declare is a breach', () => {
    expect(T.capBreaches({ screen: 'SELECT_TOPIC', data: {} }))
      .toContainEqual(expect.objectContaining({ kind: 'unknown_screen' }));
    expect(T.capBreaches({ screen: 'SELECT_LESSON_MORE', data: {} })).toHaveLength(0);
  });

  test('an over-size response is a breach measured on the WIRE bytes Meta sees', () => {
    const big = { screen: 'SUCCESS', data: { message: 'x'.repeat(1000001) } };
    expect(T.capBreaches(big)).toContainEqual(expect.objectContaining({ kind: 'response_bytes' }));
  });

  test('a breach is emitted as its own countable event, carrying the screen', () => {
    T.observeFlowResponse({
      action: 'data_exchange', screenIn: 'SELECT_CHAPTER', payload: { step: 'lp612_chapter', grade: '9' },
      userId: 'user-1', startedAt: Date.now(),
      response: { screen: 'SELECT_LESSON', data: { items: [{ id: 'a', 'main-content': { title: 'z'.repeat(31) } }] } },
    });
    const b = of('lp612.flow.cap_breach');
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual(expect.objectContaining({
      kind: 'nav_text', field: 'title', measured: 31, cap: 30,
      screenOut: 'SELECT_LESSON', vocab: 'lp612', grade: '9',
    }));
  });

  test('the live corpus screens we actually serve breach nothing', async () => {
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { step: 'subject', grade: '1', subject: 'English' });
    expect(of('lp612.flow.cap_breach')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('6. telemetry is inert — it changes nothing a teacher sees', () => {
  test('a logger that throws does not break the response', async () => {
    const SL = require('../../shared/utils/structured-logger');
    SL.logEvent.mockImplementationOnce(() => { throw new Error('axiom down'); });
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');
  });

  test('the returned object is passed through byte-identical', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res).toEqual({
      screen: 'SELECT_SUBJECT',
      data: expect.objectContaining({ grade_value: '1', grade_display: 'Grade 1' }),
    });
    expect(Object.keys(res).sort()).toEqual(['data', 'screen']);
  });

  test('observeFlowResponse never throws on a malformed response', () => {
    expect(() => T.observeFlowResponse({ action: 'data_exchange', response: null })).not.toThrow();
    expect(() => T.observeFlowResponse(null)).not.toThrow();
    expect(() => T.observeFlowResponse({ action: 'x', response: 'not-an-object' })).not.toThrow();
  });
});
