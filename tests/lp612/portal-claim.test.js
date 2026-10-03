/**
 * bd-5rz1v.21 — every teacher who asks for a READY 6-12 lesson in the portal can open it, not only
 * the first teacher who ever asked for it.
 *
 * THE BUG. A render is shared: one row per (segment, lang, template_version), written once and
 * served to everyone after. The portal asks for a lesson (POST /lp612/request), gets
 * `{ state: 'ready', renderId }` on a cache hit, and then reads it by render id (GET
 * /lp612/status/:id, GET /lp612/file/:id). Those reads are allowed only to a teacher with a CLAIM
 * on the render — and the claim was `requested_by` (the FIRST requester) or `waiters` (emptied the
 * moment the render completes). A cache hit wrote neither, so every later teacher was told
 * "No such lesson request" (404) about a lesson the request had just told her was ready.
 * Production, 3 Sep - 3 Oct 2026: 114 (render, teacher) portal cache hits, 98 of them by a teacher
 * holding no claim (48 teachers, 95 renders); 212 × 404 on /lp612/status.
 *
 * THE FIX, in the claim model and not in the portal: the cache hit records a DELIVERY for her in
 * `niete_lp612_deliveries` (surface 'portal' — the value V1.5.5 reserved for exactly this), and the
 * claim check accepts a delivery of THIS render to THIS teacher, whatever the surface. A teacher who
 * never asked for the render still gets nothing.
 *
 * Driven against ONE stateful in-memory database (tests/quiz/helpers/memory-supabase), so what the
 * serving path WRITES is what the browse path READS — the seam itself, not two halves each mocked
 * to agree with the test (pre-merge checklist, class O).
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: jest.fn().mockResolvedValue(undefined),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
const mockSegmentById = jest.fn();
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockFailDeliveriesRead = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    if (t === 'niete_lp612_deliveries' && mockFailDeliveriesRead) {
      const err = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      const b = new Proxy({}, {
        get: (_, k) => {
          if (k === 'then') return (res) => Promise.resolve(err).then(res);
          if (k === 'single' || k === 'maybeSingle') return async () => err;
          return () => b;
        },
      });
      return b;
    }
    return mockDb.from(t);
  },
  rpc: (...a) => mockDb.rpc(...a),
}));

const RENDERS = 'niete_lp612_renders';
const DELIVERIES = 'niete_lp612_deliveries';

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const WHATSAPP_TEACHER = '44444444-4444-4444-8444-444444444444';
const RENDER_ID = 'dca06359-7585-480a-ab13-1efc713ee73c';
const OTHER_RENDER_ID = '55555555-5555-4555-8555-555555555555';

const SEGMENT = {
  segment_id: 'grade_9_biology.c04.p056-056',
  book_stem: 'grade_9_biology',
  chapter_key: 'c04',
  grade: 9,
  subject: 'Biology',
  chapter_number: 4,
  chapter_title: 'Cell cycle',
  subtopic_title: 'Mitosis',
  menu_title: 'Mitosis',
  printed_page_start: 56,
  printed_page_end: 56,
  is_religious: false,
};

/** A ready render the way production holds one: requested by its first teacher, waiters emptied. */
const READY = {
  id: RENDER_ID,
  segment_id: SEGMENT.segment_id,
  lang: 'en',
  template_version: 'v9.9',
  status: 'ready',
  r2_key: 'lp612/v9.9/en/grade_9_biology.c04.p056-056.pdf',
  one_screen: 'Mitosis in one screen.',
  waiters: [],
  requested_by: FIRST,
  overlay_dropped: false,
  render_degraded: false,
  started_at: '2026-10-01T05:00:00Z',
  completed_at: '2026-10-01T05:03:00Z',
};

let Serving;
let Browse;
let Deliveries;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockFailDeliveriesRead = false;
  mockDb = createMemorySupabase({ [RENDERS]: [{ ...READY }], [DELIVERIES]: [] });
  process.env.LP_612_TEMPLATE_VERSION = 'v9.9';
  delete process.env.LP_612_RELIGIOUS_ENABLED;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
  Serving = require('../../bot/shared/services/lp612-serving.service');
  Browse = require('../../bot/shared/services/lp612-browse.service');
  Deliveries = require('../../bot/shared/services/lp612-deliveries.store');
  Deliveries.__resetForTests();
});

const askInPortal = (userId) => Serving.requestLesson({
  segmentId: SEGMENT.segment_id, userId, lang: 'en', surface: 'portal',
});

describe('a second teacher who asks for a ready lesson in the portal can open it', () => {
  test('the request answers ready, and then her poll and her file read find it', async () => {
    const out = await askInPortal(SECOND);
    expect(out.outcome).toBe('cache_hit');
    expect(out.renderId).toBe(RENDER_ID);

    // GET /lp612/status/:id and GET /lp612/file/:id both go through renderStatus.
    const row = await Browse.renderStatus(RENDER_ID, SECOND);
    expect(row).toBeTruthy();
    expect(row.status).toBe('ready');
    expect(row.r2_key).toBe(READY.r2_key);
    // The ownership columns are still never handed to the caller.
    expect(row).not.toHaveProperty('requested_by');
    expect(row).not.toHaveProperty('waiters');
  });

  test('her request leaves a durable portal delivery of THIS render, with the exact version', async () => {
    await askInPortal(SECOND);
    const rows = mockDb.table(DELIVERIES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      user_id: SECOND,
      render_id: RENDER_ID,
      segment_id: SEGMENT.segment_id,
      lang: 'en',
      template_version: 'v9.9',
      surface: 'portal',
    }));
    expect(Date.parse(rows[0].delivered_at)).not.toBeNaN();
  });

  test('nothing is sent on WhatsApp for it', async () => {
    await askInPortal(SECOND);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('the first teacher keeps her access, as before', async () => {
    expect(await Browse.renderStatus(RENDER_ID, FIRST)).toBeTruthy();
  });

  test('her "My lesson plans" list now has it', async () => {
    await askInPortal(SECOND);
    const mine = await Browse.myRenders(SECOND);
    expect(mine.map((r) => r.id)).toEqual([RENDER_ID]);
  });

  test('asking twice still lists it once', async () => {
    await askInPortal(SECOND);
    await askInPortal(SECOND);
    const mine = await Browse.myRenders(SECOND);
    expect(mine.map((r) => r.id)).toEqual([RENDER_ID]);
  });
});

describe('the render is still not open to people who never asked for it', () => {
  test('a teacher with no request, no wait and no delivery gets nothing', async () => {
    await askInPortal(SECOND);
    expect(await Browse.renderStatus(RENDER_ID, STRANGER)).toBeNull();
    expect(await Browse.myRenders(STRANGER)).toEqual([]);
  });

  test('a delivery of a DIFFERENT render does not open this one', async () => {
    mockDb.table(DELIVERIES).push({
      id: 'd-other', user_id: STRANGER, render_id: OTHER_RENDER_ID, segment_id: SEGMENT.segment_id,
      lang: 'en', template_version: 'v9.8', surface: 'portal', delivered_at: '2026-10-02T05:00:00Z',
    });
    expect(await Browse.renderStatus(RENDER_ID, STRANGER)).toBeNull();
  });

  test('a delivery ledger that cannot be read is not a claim', async () => {
    mockFailDeliveriesRead = true;
    expect(await Browse.renderStatus(RENDER_ID, SECOND)).toBeNull();
    // Said, at error level — not a silent 404.
    expect(mockLog.mock.calls.some((c) => /claim/i.test(String(c[0])) && c[2] === 'error')).toBe(true);
  });
});

describe('a teacher who RECEIVED the render on WhatsApp may open it in the portal too', () => {
  test('her WhatsApp delivery of this render is a claim on it', async () => {
    // What deliverRender writes on a WhatsApp cache hit.
    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id, userId: WHATSAPP_TEACHER, phone: '923001234567', lang: 'en',
    });
    expect(mockDb.table(DELIVERIES).map((r) => r.surface)).toEqual(['whatsapp']);
    expect(await Browse.renderStatus(RENDER_ID, WHATSAPP_TEACHER)).toBeTruthy();
  });
});

describe('portal deliveries do not change what the WhatsApp side reads', () => {
  test('the /quiz lesson list reads only lessons received on WhatsApp (or backfilled)', async () => {
    // Seeded directly, so this pins the READER whatever the writer does.
    mockDb.table(DELIVERIES).push({
      id: 'd-portal', user_id: SECOND, render_id: RENDER_ID, segment_id: SEGMENT.segment_id,
      lang: 'en', template_version: 'v9.9', surface: 'portal', delivered_at: '2026-10-03T05:00:00Z',
    });
    mockDb.table(DELIVERIES).push({
      id: 'd-backfill', user_id: SECOND, render_id: null, segment_id: 'grade_7_science.c01.p001-002',
      lang: 'en', template_version: 'v9.2', surface: 'backfill', delivered_at: '2026-09-20T05:00:00Z',
    });
    mockDb.table(DELIVERIES).push({
      id: 'd-wa', user_id: SECOND, render_id: OTHER_RENDER_ID, segment_id: 'grade_8_mathematics.c05.p071-073',
      lang: 'en', template_version: 'v9.9', surface: 'whatsapp', delivered_at: '2026-10-02T05:00:00Z',
    });
    const listed = await Deliveries.recentForTeacher(SECOND);
    expect(listed.map((r) => r.id)).toEqual(['d-wa', 'd-backfill']);
  });

  test('a portal delivery cannot be fetched by id for a quiz either', async () => {
    mockDb.table(DELIVERIES).push({
      id: 'd-portal', user_id: SECOND, render_id: RENDER_ID, segment_id: SEGMENT.segment_id,
      lang: 'en', template_version: 'v9.9', surface: 'portal', delivered_at: '2026-10-03T05:00:00Z',
    });
    expect(await Deliveries.byIdForTeacher('d-portal', SECOND)).toBeNull();
  });
});
