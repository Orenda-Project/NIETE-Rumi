/**
 * THE TEACHER'S SIDE OF THE UNDATED VERDICT — bd-2cbwr, e2e half.
 *
 * The unit suite (`cache-lint-staleness.test.js`) proves the classifier. This one drives the real
 * `requestLesson` cache-hit path — the path most teachers are on, since every teacher after the
 * first is served entirely from the row — and asserts the two things that actually matter in
 * production:
 *
 *   1. A stale verdict is LOUD. `lp612.cache.lint_stale` fires naming the row, the ruleset it was
 *      judged under and the one running now, so "which cached lessons predate the current gate"
 *      is a query. Without this the 2026-09-14 backfill gap recurs silently on the next gate change.
 *
 *   2. A stale verdict is NOT a withheld lesson. Those documents are serving today. Holding one on
 *      a version mismatch would take a lesson off a teacher over bookkeeping, and brief §4c/G5c is
 *      explicit that the automated check is not what clears religious content — the native-speaker
 *      review is. So the lesson still goes out, and the event is what carries the doubt.
 *
 * Mocking the module under test would prove nothing about the real call path, so
 * `lp612-serving.service` is the genuine module here (root CLAUDE.md rule 6); only its collaborators
 * are doubled.
 */

const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockPushToShelf = jest.fn().mockResolvedValue(undefined);
const mockScheduleFeedbackPrompt = jest.fn();
const mockLogEvent = jest.fn();
const mockGetPresignedUrl = jest.fn().mockResolvedValue('https://signed.example/x.pdf');
const mockSegmentById = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: (...a) => mockPushToShelf(...a),
}));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({
  scheduleFeedbackPrompt: (...a) => mockScheduleFeedbackPrompt(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  segmentById: (...a) => mockSegmentById(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

const mockDbResults = [];
function mockBuilder() {
  const settle = () => Promise.resolve(
    mockDbResults.length ? mockDbResults.shift() : { data: null, error: null },
  );
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: settle, maybeSingle: settle, then: (r, j) => settle().then(r, j),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockBuilder(), rpc: jest.fn() }));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const { LP612_LINT_VERSION } = require('../../bot/shared/services/lp612-lint-staleness');

const SEGMENT = {
  segment_id: 'grade_6_urdu.c03.p021-024',
  book_stem: 'grade_6_urdu',
  chapter_key: 'c03',
  grade: 6,
  subject: 'Urdu',
  chapter_number: 3,
  chapter_title: 'باب سوم',
  subtopic_title: 'تفہیم',
  menu_title: 'تفہیم',
  printed_page_start: 21,
  printed_page_end: 24,
};

const RELIGIOUS = 'RELIGIOUS_MARKS: /sections/0/blocks/1/text names the Prophet ("نبی") with no honorific after it';

/** Queue one `ready` row for findRender to return, then tap the lesson. */
const tapWithRow = async (row) => {
  mockDbResults.push({
    data: {
      id: 'render-1', status: 'ready', r2_key: 'lp612/v9.6/ur/x.pdf', one_screen: 'خلاصہ', ...row,
    },
    error: null,
  });
  return Serving.requestLesson({
    segmentId: SEGMENT.segment_id, userId: 'user-1', phone: '923001234567', lang: 'ur',
  });
};

const staleEvent = () => mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.cache.lint_stale');

beforeEach(() => {
  jest.clearAllMocks();
  mockDbResults.length = 0;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockSendMessage.mockResolvedValue(true);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/x.pdf');
});

describe('a cached lesson judged by a gate that has since moved', () => {
  test('THE RED TEST — the stale verdict is announced, naming both rulesets', async () => {
    const out = await tapWithRow({ lint_clean: true, lint_fails: [], lint_version: '2026-09-01' });

    expect(out.outcome).toBe('cache_hit');
    const ev = staleEvent();
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({
      renderId: 'render-1',
      segmentId: SEGMENT.segment_id,
      lang: 'ur',
      reason: 'version_moved',
      stampedVersion: '2026-09-01',
      currentVersion: LP612_LINT_VERSION,
    });
  });

  test('she still gets the lesson — a stale stamp is doubt, not a refusal', async () => {
    const out = await tapWithRow({ lint_clean: true, lint_fails: [], lint_version: '2026-09-01' });

    expect(out.outcome).toBe('cache_hit');
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(mockPushToShelf).toHaveBeenCalled();
  });

  test('an UNSTAMPED row — the shape of every row on production today — is stale too', async () => {
    await tapWithRow({ lint_clean: true, lint_fails: [], lint_version: null });

    expect(staleEvent()[1]).toMatchObject({ reason: 'unstamped', stampedVersion: null });
  });

  test('a REUSED render, where the gate never ran, is named as such', async () => {
    await tapWithRow({ lint_clean: null, lint_fails: null, lint_version: null });

    expect(staleEvent()[1]).toMatchObject({ reason: 'never_looked' });
  });
});

describe('a cached lesson already carrying a religious finding', () => {
  test('the finding rides on the event — this is the population bd-2cbwr was filed over', async () => {
    await tapWithRow({ lint_clean: false, lint_fails: [RELIGIOUS], lint_version: '2026-09-01' });

    const ev = staleEvent();
    expect(ev[1].religiousFails).toEqual([RELIGIOUS]);
  });

  test('a fresh stamp does not silence a religious finding that is still being served', async () => {
    // Staleness and violation are independent. A lesson judged by today's gate and found wanting
    // is going out under that finding either way, so it stays findable.
    await tapWithRow({ lint_clean: false, lint_fails: [RELIGIOUS], lint_version: LP612_LINT_VERSION });

    const ev = staleEvent();
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({ reason: 'current', religiousFails: [RELIGIOUS] });
  });
});

describe('the quiet case stays quiet', () => {
  test('a current, clean verdict emits NO staleness event at all', async () => {
    const out = await tapWithRow({
      lint_clean: true, lint_fails: [], lint_version: LP612_LINT_VERSION,
    });

    expect(out.outcome).toBe('cache_hit');
    expect(staleEvent()).toBeUndefined();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });
});
