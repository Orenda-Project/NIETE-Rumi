/**
 * 6-12 LPs · the language step — «اردو / English» as the FINAL tap.
 *
 * The 6-12 lane renders on demand and caches per (segment, lang, template), so
 * a per-request language choice is nearly free — the only thing hard-wired was
 * the one call site that passed `preferred_language`. This suite pins the menu:
 *
 *  - flag OFF means byte-for-byte yesterday: the tap serves in her stored
 *    preference and no language screen exists;
 *  - flag ON turns the segment tap into a SELECT_LANGUAGE screen whose two rows
 *    carry `step: lp612_serve` payloads — the choice lives in the row, never in
 *    a stored preference (no setUserLanguage, no preferred_language write);
 *  - her usual language is the FIRST row; a teacher with none gets the
 *    deployment's offer default (ur) first;
 *  - the new lp612_serve step hands serving BOTH languages: `lang` (the
 *    document) and `uiLang` (the acks) — the two territories diverge the moment
 *    an Urdu-UI teacher orders an English physics plan;
 *  - lp612_serve is behind lp612Guard like every other step: flag-off-means-off
 *    holds for rows living on in scrollback.
 */

const mockBuildSubjectItems = jest.fn();
const mockBuildChapterItems = jest.fn();
const mockBuildSegmentItems = jest.fn();
const mockBuildGradeItems = jest.fn();
const mockSegmentById = jest.fn();
const mockRequestLesson = jest.fn();

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: mockBuildGradeItems,
  buildSubjectItems: mockBuildSubjectItems,
  buildChapterItems: mockBuildChapterItems,
  buildSegmentItems: mockBuildSegmentItems,
  segmentById: mockSegmentById,
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  requestLesson: mockRequestLesson,
}));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`,
  deliverOxbridgeLp: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn().mockResolvedValue(new Set()),
  downloadedLessonIds: jest.fn().mockResolvedValue(new Set()),
  deliverV8Lesson: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let userRow = { phone_number: '923001234567', preferred_language: 'en' };
function mockBuilder(table) {
  const settle = () => {
    if (table === 'users') return Promise.resolve({ data: userRow, error: null });
    return Promise.resolve({ data: [], error: null });
  };
  const b = {
    select: () => b,
    eq: () => b,
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
  language: 'en',
};

const cp = (s) => [...String(s)].length; // CODE POINTS, never .length

beforeEach(() => {
  jest.clearAllMocks();
  userRow = { phone_number: '923001234567', preferred_language: 'en' };
  process.env.LP_612_ENABLED = 'true';
  delete process.env.LP_612_LANG_MENU;
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockRequestLesson.mockResolvedValue({ outcome: 'queued' });
});

afterAll(() => {
  delete process.env.LP_612_ENABLED;
  delete process.env.LP_612_LANG_MENU;
});

// ── flag off: byte-for-byte yesterday ───────────────────────────────────────

describe('with LP_612_LANG_MENU off', () => {
  test('a segment tap serves immediately in her stored preference — no language screen', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.screen).toBe('SUCCESS');
    expect(mockRequestLesson).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: SEGMENT.segment_id, lang: 'en',
    }));
  });
});

// ── flag on: the menu ───────────────────────────────────────────────────────

describe('with LP_612_LANG_MENU on', () => {
  beforeEach(() => { process.env.LP_612_LANG_MENU = 'true'; });

  test('a segment tap returns SELECT_LANGUAGE and does NOT serve yet', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.screen).toBe('SELECT_LANGUAGE');
    expect(mockRequestLesson).not.toHaveBeenCalled();
    expect(res.data.items).toHaveLength(2);
  });

  test('each row carries the whole decision in its own payload — step, segment, lang', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    for (const item of res.data.items) {
      expect(item['on-click-action']).toEqual({
        name: 'data_exchange',
        payload: {
          step: 'lp612_serve',
          segment_id: SEGMENT.segment_id,
          lang: item.id,
        },
      });
    }
    const ids = res.data.items.map((i) => i.id).sort();
    expect(ids).toEqual(['en', 'ur']);
  });

  test('the approved copy, inside the NavigationList caps, measured in code points', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    const byId = Object.fromEntries(res.data.items.map((i) => [i.id, i['main-content']]));

    expect(byId.ur.title).toBe('اردو');
    expect(byId.ur.description).toBe('مکمل سبق اردو میں');
    expect(byId.ur.metadata).toBe('سائنسی اصطلاحات انگریزی میں رہتی ہیں');
    expect(byId.en.title).toBe('English');
    expect(byId.en.description).toBe('Full plan in English');
    // Operator decision 2026-09-03: NO preferred-row metadata stamp.
    expect(byId.en.metadata).toBeUndefined();

    for (const c of Object.values(byId)) {
      expect(cp(c.title)).toBeLessThanOrEqual(30);
      if (c.description) expect(cp(c.description)).toBeLessThanOrEqual(20);
      if (c.metadata) expect(cp(c.metadata)).toBeLessThanOrEqual(80);
    }
  });

  test('her usual language is the first row', async () => {
    userRow = { phone_number: '923001234567', preferred_language: 'en' };
    let res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.data.items[0].id).toBe('en');

    userRow = { phone_number: '923001234567', preferred_language: 'ur' };
    res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.data.items[0].id).toBe('ur');
  });

  test('a teacher with no stored preference gets the deployment default (ur) first', async () => {
    userRow = { phone_number: '923001234567', preferred_language: null };
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.data.items[0].id).toBe('ur');
  });

  test('the screen names the lesson she is choosing for', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });
    expect(res.data.header_text).toContain('Branches of chemistry');
  });

  test('an unknown segment is refused, not offered a language', async () => {
    mockSegmentById.mockResolvedValue(null);
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: 'no-such-row',
    });
    expect(res.data.error).toBeTruthy();
    expect(mockRequestLesson).not.toHaveBeenCalled();
  });
});

// ── the new serve step ──────────────────────────────────────────────────────

describe('the lp612_serve step', () => {
  beforeEach(() => { process.env.LP_612_LANG_MENU = 'true'; });

  test('hands serving the CHOSEN document language and her UI language separately', async () => {
    userRow = { phone_number: '923001234567', preferred_language: 'ur' };
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang: 'en',
    });
    expect(res.screen).toBe('SUCCESS');
    expect(mockRequestLesson).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: SEGMENT.segment_id,
      userId: 'user-1',
      phone: '923001234567',
      lang: 'en',
      uiLang: 'ur',
    }));
  });

  test('returns SUCCESS immediately and does not wait for serving', async () => {
    let resolveServing;
    mockRequestLesson.mockReturnValue(new Promise((r) => { resolveServing = r; }));
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang: 'ur',
    });
    expect(res.screen).toBe('SUCCESS');
    resolveServing({ outcome: 'queued' });
  });

  test('is refused while LP_612_ENABLED is off — scrollback rows outlive flags', async () => {
    process.env.LP_612_ENABLED = 'false';
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang: 'ur',
    });
    expect(mockRequestLesson).not.toHaveBeenCalled();
    expect(res.data.error).toBeTruthy();
  });

  test('a payload with no segment id is refused rather than queued', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', lang: 'ur',
    });
    expect(mockRequestLesson).not.toHaveBeenCalled();
    expect(res.data.error).toBeTruthy();
  });

  test('a tampered lang rides through to serving, whose clamp floors it — no second validator', async () => {
    // clampLanguage inside requestLesson is the ONE validation surface; the
    // endpoint deliberately does not grow a second opinion about languages.
    await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang: 'sw',
    });
    expect(mockRequestLesson).toHaveBeenCalledWith(expect.objectContaining({ lang: 'sw' }));
  });

  test('a serving failure after SUCCESS is logged, not thrown into the Flow', async () => {
    mockRequestLesson.mockRejectedValue(new Error('db down'));
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
      step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang: 'ur',
    });
    expect(res.screen).toBe('SUCCESS');
    await new Promise((r) => setImmediate(r));
  });
});
