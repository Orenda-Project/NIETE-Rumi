/**
 * What happens between the tap and the PDF.
 *
 * The decision this service makes is small — cache hit, or author it now — but
 * every branch of it reaches a teacher, so every branch is asserted here:
 *
 *  - a HIT sends the document and enqueues nothing (the whole point of caching
 *    an expensive render is that the second teacher does not pay for it);
 *  - a MISS acks FIRST and enqueues second, because the ack is the only thing
 *    standing between her and two minutes of silence;
 *  - a CONCURRENT miss joins the render already running instead of starting a
 *    second one — the same lesson authored twice is ~$1.50 and several minutes
 *    thrown away, and the unique constraint is what makes that detectable;
 *  - a HELD segment is declined with a sentence, not a dead end;
 *  - nothing, anywhere, fails silently.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockQueueJob = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockBuildR2PublicUrl = jest.fn((k) => `https://r2.example/${k}`);
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
}));
// The queue module exports a singleton INSTANCE, and its queueJob reads
// `this.queueUrl` / `this.quizQueueUrl`. Destructuring it strips the receiver
// and throws at the first real call — in production, not in a test that mocked
// it as a plain function. So the double is deliberately `this`-dependent: it
// records the receiver, and the test below fails if the service ever calls it
// detached.
const queueModule = {
  __isQueueSingleton: true,
  queueJob(...args) {
    if (!this || this.__isQueueSingleton !== true) {
      throw new TypeError(
        "queueJob called without its receiver — `this.queueUrl` would be undefined in production",
      );
    }
    return mockQueueJob(...args);
  },
};
jest.mock('../../bot/shared/services/queue', () => queueModule);
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: mockGetPresignedUrl,
  buildR2PublicUrl: mockBuildR2PublicUrl,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: mockSegmentById,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(
      mockDbResults.length ? mockDbResults.shift() : { data: null, error: null },
    );
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
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Serving = require('../../bot/shared/services/lp612-serving.service');

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
};

const REQ = { userId: 'user-1', phone: '923001234567', lang: 'en', correlationId: 'corr-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/lp.pdf');
  process.env.LP_612_TEMPLATE_VERSION = 'v9.1';
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── cache hit ───────────────────────────────────────────────────────────────

describe('a cached render is served immediately', () => {
  test('sends the PDF and enqueues nothing', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null,
    });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentByLink.mock.calls[0][0]).toBe('923001234567');
    expect(mockSendDocumentByLink.mock.calls[0][1]).toBe('https://signed.example/lp.pdf');
    expect(mockQueueJob).not.toHaveBeenCalled();
  });

  test('the link is presigned — a raw R2 URL 400s at Meta', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null,
    });
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    expect(mockGetPresignedUrl).toHaveBeenCalledWith('https://r2.example/lp612/v9.1/en/seg.pdf');
  });

  test('the cache is keyed on segment, language AND template version', async () => {
    mockDbResults.push({ data: null, error: null });   // lookup: miss
    mockDbResults.push({ data: { id: 'r2' }, error: null }); // insert
    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    const lookup = mockDbCalls[0];
    expect(lookup.filters).toEqual(expect.arrayContaining([
      ['segment_id', SEGMENT.segment_id],
      ['lang', 'en'],
      ['template_version', 'v9.1'],
    ]));
  });
});

// ── cache miss ──────────────────────────────────────────────────────────────

describe('a miss authors the lesson at request time', () => {
  test('acks the teacher BEFORE enqueuing — the ack is what buys the two minutes', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r2' }, error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('queued');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/2 minutes/);
    const ackOrder = mockSendMessage.mock.invocationCallOrder[0];
    const queueOrder = mockQueueJob.mock.invocationCallOrder[0];
    expect(ackOrder).toBeLessThan(queueOrder);
  });

  test('enqueues an lp612_author job carrying the render row it must fill', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'render-99' }, error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(mockQueueJob).toHaveBeenCalledTimes(1);
    const [groupId, jobType, payload] = mockQueueJob.mock.calls[0];
    expect(jobType).toBe('lp612_author');
    expect(groupId).toBe(SEGMENT.segment_id);
    expect(payload).toMatchObject({
      renderId: 'render-99',
      segmentId: SEGMENT.segment_id,
      lang: 'en',
      templateVersion: 'v9.1',
    });
  });

  test('the new render row records who is waiting for it', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r2' }, error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    const insert = mockDbCalls.find((c) => c.op === 'insert');
    expect(insert.payload.status).toBe('authoring');
    expect(insert.payload.waiters).toEqual([
      expect.objectContaining({ user_id: 'user-1', phone: '923001234567' }),
    ]);
  });
});

// ── the concurrency case ────────────────────────────────────────────────────

describe('two teachers, one lesson, one authoring run', () => {
  test('a second request joins the run in flight instead of starting another', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'authoring', waiters: [{ user_id: 'other' }] }, error: null,
    });
    mockDbResults.push({ data: { id: 'r1' }, error: null });   // waiter append

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const update = mockDbCalls.find((c) => c.op === 'update');
    expect(update.payload.waiters).toHaveLength(2);
  });

  test('a teacher already on the waiter list is not added twice', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'authoring', waiters: [{ user_id: 'user-1', phone: '923001234567' }] },
      error: null,
    });
    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    expect(out.outcome).toBe('joined');
    // She is already on the list, so there is nothing to write — and the list
    // must not have grown. Asserted as "no waiter write happened at all",
    // because a re-write with the same length would still be a wasted round
    // trip on every repeat tap.
    const update = mockDbCalls.find((c) => c.op === 'update');
    expect(update).toBeUndefined();
    // ...and she is still told what is happening, exactly once.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test('losing the insert race joins the winner rather than erroring at her', async () => {
    mockDbResults.push({ data: null, error: null });                                 // lookup: miss
    mockDbResults.push({ data: null, error: { code: '23505', message: 'dup' } });     // insert loses
    mockDbResults.push({ data: { id: 'r1', status: 'authoring', waiters: [] }, error: null }); // re-read
    mockDbResults.push({ data: { id: 'r1' }, error: null });                          // waiter append

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('joined');
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});

// ── the operator's holds ────────────────────────────────────────────────────

describe('religious content is held behind its own flag', () => {
  test('a held segment is declined with a real sentence and never authored', async () => {
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('held');
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/reviewed/i);
  });

  test('the hold lifts only when LP_612_RELIGIOUS_ENABLED is on', async () => {
    process.env.LP_612_RELIGIOUS_ENABLED = 'true';
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r2' }, error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    expect(out.outcome).toBe('queued');
  });
});

// ── failure is never silence ────────────────────────────────────────────────

describe('nothing fails silently', () => {
  test('an unknown segment gets a message telling her what to do', async () => {
    mockSegmentById.mockResolvedValue(null);
    const out = await Serving.requestLesson({ segmentId: 'nope', ...REQ });
    expect(out.outcome).toBe('not_found');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test('a previously failed render is retried, not left dead', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'failed', error_code: 'AUTHOR_LLM_FAILED' }, error: null,
    });
    mockDbResults.push({ data: { id: 'r1' }, error: null });   // reset to authoring

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('retry');
    expect(mockQueueJob).toHaveBeenCalledTimes(1);
    const update = mockDbCalls.find((c) => c.op === 'update');
    expect(update.payload.status).toBe('authoring');
    expect(update.payload.error_code).toBeNull();
  });

  test('a ready row whose r2_key is missing is treated as a miss, not served as a hit', async () => {
    // "ready" is a claim; the key is the evidence. Serving a row with no key
    // would send a presign of `undefined` and fail at Meta with nothing logged.
    mockDbResults.push({ data: { id: 'r1', status: 'ready', r2_key: null }, error: null });
    mockDbResults.push({ data: { id: 'r1' }, error: null });

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).not.toBe('cache_hit');
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('a send failure on a cache hit is surfaced, not swallowed', async () => {
    mockDbResults.push({
      data: { id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/seg.pdf' }, error: null,
    });
    mockSendDocumentByLink.mockRejectedValue(new Error('Meta 400'));

    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });

    expect(out.outcome).toBe('deliver_failed');
    expect(out.error).toMatch(/Meta 400/);
  });
});

// ── language ────────────────────────────────────────────────────────────────

describe('language', () => {
  test('an unoffered language clamps to English rather than keying a cache row on junk', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r2' }, error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ, lang: 'sw' });

    expect(mockDbCalls[0].filters).toContainEqual(['lang', 'en']);
  });

  test('Urdu is served in Urdu and cached under its own key', async () => {
    mockDbResults.push({ data: null, error: null });
    mockDbResults.push({ data: { id: 'r2' }, error: null });

    await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ, lang: 'ur' });

    expect(mockDbCalls[0].filters).toContainEqual(['lang', 'ur']);
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);
  });
});

// ── the WhatsApp body that goes with the file ───────────────────────────────

/**
 * `one_screen` is the lesson on one phone screen — 150-260 words, the field the
 * authoring brief calls "the WhatsApp body" and the lint gate sizes as such. It
 * was being authored on every plan and then dropped: the teacher got a PDF and a
 * caption, and the one artefact designed to be read WITHOUT opening a file never
 * left the worker.
 *
 * It is sent BEFORE the document on purpose. She is on a phone, often on a poor
 * connection, and the summary is useful in the two seconds before a 2MB PDF has
 * downloaded.
 *
 * The video link rides on the same message as a plain url — WhatsApp linkifies
 * it, and a plain url costs no new catalog string and therefore no new field cap
 * to get wrong in either language.
 */
describe('the lesson body that goes out with the PDF', () => {
  const PICK = {
    url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
    video_id: 'pWLEUhu-60A',
    title: 'Definition of Chemistry',
  };
  const ONE_SCREEN = 'Today the class defines chemistry and names its branches.';

  // jest.clearAllMocks() clears CALLS but keeps IMPLEMENTATIONS, and an earlier
  // suite in this file installs a permanent `mockRejectedValue` on the document
  // send. Without this the whole block inherits a WhatsApp that always 400s.
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockSendDocumentByLink.mockReset();
  });

  it('sends the one_screen body before the document', async () => {
    await Serving.deliverRender({
      phone: '923001234567', r2Key: 'lp612/v9.1/en/x.pdf', segment: SEGMENT,
      lang: 'en', oneScreen: ONE_SCREEN,
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toContain(ONE_SCREEN);
    expect(mockSendMessage.mock.invocationCallOrder[0])
      .toBeLessThan(mockSendDocumentByLink.mock.invocationCallOrder[0]);
  });

  it('appends the video link as a plain url when the segment has a pick', async () => {
    await Serving.deliverRender({
      phone: '923001234567', r2Key: 'k', segment: { ...SEGMENT, yt: PICK },
      lang: 'en', oneScreen: ONE_SCREEN,
    });
    const body = mockSendMessage.mock.calls[0][1];
    expect(body).toContain(ONE_SCREEN);
    expect(body).toContain('https://www.youtube.com/watch?v=pWLEUhu-60A');
  });

  it('sends NO body message at all when there is neither a summary nor a link', async () => {
    // Renders cached before this shipped have no stored one_screen. They must
    // still deliver, and they must not deliver an empty message.
    await Serving.deliverRender({
      phone: '923001234567', r2Key: 'k', segment: SEGMENT, lang: 'en',
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  it('a pick with no url adds nothing — never a bare emoji on its own line', async () => {
    await Serving.deliverRender({
      phone: '923001234567', r2Key: 'k', segment: { ...SEGMENT, yt: { title: 'x' } },
      lang: 'en', oneScreen: ONE_SCREEN,
    });
    expect(mockSendMessage.mock.calls[0][1].trim()).toBe(ONE_SCREEN);
  });

  it('a failure to send the body does not cost her the lesson', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('meta 400'));
    await Serving.deliverRender({
      phone: '923001234567', r2Key: 'k', segment: SEGMENT, lang: 'en', oneScreen: ONE_SCREEN,
    });
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });

  it('a cache hit sends the stored one_screen, not just the file', async () => {
    // The body must not be a first-hit-only luxury: every teacher after the
    // first is served entirely from this row.
    mockDbResults.push({
      data: {
        id: 'r1', status: 'ready', r2_key: 'lp612/v9.1/en/x.pdf',
        waiters: [], error_code: null, one_screen: ONE_SCREEN,
      },
      error: null,
    });
    const out = await Serving.requestLesson({ segmentId: SEGMENT.segment_id, ...REQ });
    expect(out.outcome).toBe('cache_hit');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toContain(ONE_SCREEN);
  });
});
