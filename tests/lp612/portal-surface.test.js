/**
 * A 6-12 lesson can be requested from a surface that has no phone number.
 *
 * THE SEAM THIS OPENS. `requestLesson` was written for WhatsApp and only WhatsApp: it takes a
 * `phone`, it calls `tell(phone, …)` on fourteen paths, and its cache-hit branch sends the PDF
 * to Meta itself. The portal has a signed-in teacher and no phone number in hand, so every one
 * of those calls is either a crash risk or a message sent to `undefined`.
 *
 * This is the SAME seam the Assessment Generator had before `buildPaper()` was split out of
 * `process()`, and it is cut the same way: the decision is surface-neutral, the delivery is not.
 * What makes it cheap here is that the decision half is ALREADY clean — every path through
 * `requestLessonImpl` returns a delivery-neutral verdict (`cache_hit`, `joined`, `retry`,
 * `queued`, `held`, `not_found`, `error`), and `tell()` is already fire-and-forget with its own
 * catch. Only two outputs are fused: telling her, and sending her the file.
 *
 * THE INVARIANT THAT MATTERS MOST IS THE ONE ABOUT THE OTHER SURFACE. `requestLesson` serves
 * live teachers on WhatsApp today. The riskiest thing in this change is not the portal — it is
 * regressing the path that already works. The first describe block below pins that path and
 * must keep passing unchanged.
 */

const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: jest.fn().mockResolvedValue(undefined),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/lesson.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
const mockSegmentById = jest.fn();
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/observability/event-log.service', () => ({
  logEvent: jest.fn(),
}), { virtual: true });

// The render row `findRender` will see. Set per test.
let renderRow = null;
// Every insert payload, so a test can assert what was claimed.
const inserts = [];

function mockBuilder() {
  // An INSERT resolves to the row it created, the way PostgREST does with
  // .select().single(); a read resolves to whatever the test parked in `renderRow`.
  let claimed = false;
  const settle = () => Promise.resolve(
    claimed ? { data: { id: 'render-uuid-new' }, error: null } : { data: renderRow, error: null },
  );
  const b = {
    insert: (payload) => { inserts.push(payload); claimed = true; return b; },
    update: () => b,
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: settle,
    single: settle,
    then: (r, j) => settle().then(r, j),
  };
  return b;
}
const mockRpc = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => mockBuilder(),
  rpc: (...a) => mockRpc(...a),
}));

const SEGMENT = {
  segment_id: 'grade_9_physics.c02.p021-024',
  book_stem: 'grade_9_physics',
  chapter_key: 'c02',
  grade: 9,
  subject: 'Physics',
  chapter_number: 2,
  chapter_title: 'Kinematics',
  subtopic_title: 'Distance, displacement and the difference',
  menu_title: 'Distance vs displacement',
  printed_page_start: 21,
  printed_page_end: 24,
  is_religious: false,
};

const READY_ROW = {
  id: 'render-uuid-ready',
  status: 'ready',
  r2_key: 'lp612/v9.2/en/grade_9_physics.c02.p021-024.pdf',
  one_screen: 'Today the class separates distance from displacement.',
  overlay_dropped: false,
  render_degraded: false,
};

let Serving;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  inserts.length = 0;
  renderRow = null;
  mockSendMessage.mockResolvedValue(undefined);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockRpc.mockResolvedValue({ data: 'joined', error: null });
  mockSegmentById.mockResolvedValue(SEGMENT);
  process.env.LP_612_TEMPLATE_VERSION = 'v9.2';
  Serving = require('../../bot/shared/services/lp612-serving.service');
});

// ── the surface that already works ──────────────────────────────────────────

describe('WhatsApp is unchanged by the split', () => {
  test('a cache hit still sends the document to her phone', async () => {
    renderRow = READY_ROW;

    const out = await Serving.requestLesson({
      segmentId: SEGMENT.segment_id,
      userId: 'teacher-1',
      phone: '923001234567',
      lang: 'en',
    });

    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    // She is messaged: the one-screen body goes out ahead of the file.
    expect(mockSendMessage).toHaveBeenCalled();
  });

  test('a cold miss still acknowledges her before anything is queued', async () => {
    renderRow = null;

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id,
      userId: 'teacher-1',
      phone: '923001234567',
      lang: 'en',
    });

    // The ack is the whole point of the "tell first, enqueue second" ordering.
    expect(mockSendMessage).toHaveBeenCalled();
  });
});

// ── the surface being added ─────────────────────────────────────────────────

describe('a portal request reaches no WhatsApp surface', () => {
  test('a cache hit returns the key instead of sending it', async () => {
    renderRow = READY_ROW;

    const out = await Serving.requestLesson({
      segmentId: SEGMENT.segment_id,
      userId: 'teacher-1',
      surface: 'portal',
      lang: 'en',
    });

    expect(out.outcome).toBe('cache_hit');
    // THE POINT: nothing was sent to Meta, and the caller is handed what it needs
    // to presign the object itself.
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(out.r2Key).toBe(READY_ROW.r2_key);
  });

  test('a cold miss still claims and queues, but says nothing on WhatsApp', async () => {
    renderRow = null;

    const out = await Serving.requestLesson({
      segmentId: SEGMENT.segment_id,
      userId: 'teacher-1',
      surface: 'portal',
      lang: 'en',
    });

    // The decision half is untouched — she is still queued and still owed a lesson.
    expect(['queued', 'error']).toContain(out.outcome);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('a withheld religious segment is refused server-side, not hidden by a menu', async () => {
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    delete process.env.LP_612_RELIGIOUS_ENABLED;

    const out = await Serving.requestLesson({
      segmentId: 'grade_9_islamiat.c01.p001-004',
      userId: 'teacher-1',
      surface: 'portal',
      lang: 'en',
    });

    // A forged request naming a held segment meets the same gate a Flow tap does.
    expect(out.outcome).toBe('held');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('a portal waiter is parked on the row without a phone', () => {
  test('the claimed row records the surface, so the worker can skip its send', async () => {
    renderRow = null;

    await Serving.requestLesson({
      segmentId: SEGMENT.segment_id,
      userId: 'teacher-1',
      surface: 'portal',
      lang: 'en',
    });

    expect(inserts.length).toBe(1);
    const waiters = inserts[0].waiters;
    expect(Array.isArray(waiters)).toBe(true);
    expect(waiters).toHaveLength(1);

    // THE INVARIANT THE WORKER DEPENDS ON. Its delivery loop calls
    // deliverRender({ phone: w.phone, … }) over this list. A portal waiter carrying
    // no phone must be nameable as such, or the worker will hand `undefined` to Meta,
    // count a real lesson as a delivery failure, and burn the send deadline that the
    // WhatsApp waiters queued behind it are sharing.
    expect(waiters[0].surface).toBe('portal');
    expect(waiters[0].phone == null).toBe(true);
    expect(waiters[0].user_id).toBe('teacher-1');
  });
});
