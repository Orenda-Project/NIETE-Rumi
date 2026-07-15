/**
 * Unit tests for OxbridgeLpService (FEAT-080 / bd-2016).
 *
 * Covers:
 *   1. findMatches — grade eligibility gate (only 6..12)
 *   2. findMatches — Ramisha's acceptance-test query:
 *      Grade 7 + topic "Dispersion of Light" resolves to the row where
 *      description embeds "Topic: Dispersion Of Light" — even though the
 *      chapter_title is the broader "Waves and Energy" and the subject is
 *      "General Science" (not "Physics" as the teacher may have typed).
 *   3. findMatches — no match returns empty
 *   4. htmlToPlainText — strips tags, preserves paragraph breaks
 *   5. sendPicker — emits 2 buttons and caches pending state
 *   6. deliverOxbridgeLp — sends text + PDF, both derived from content_html
 *      (verbatim; no LLM call)
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockSupabaseFrom = jest.fn();
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockSupabaseFrom(...a) }));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockRedis = {
  isConnected: jest.fn(() => true),
  redis: {
    setex: jest.fn(() => Promise.resolve('OK')),
    get: jest.fn(() => Promise.resolve(null)),
    del: jest.fn(() => Promise.resolve(1)),
  },
};
jest.mock('../../shared/services/cache/railway-redis.service', () => mockRedis);

const mockSendMessage = jest.fn(() => Promise.resolve(true));
const mockSendDocument = jest.fn(() => Promise.resolve(true));
const mockSendButtons = jest.fn(() => Promise.resolve(true));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocument: mockSendDocument,
  sendInteractiveButtons: mockSendButtons,
}));

const mockHtmlToPdf = jest.fn(() => Promise.resolve(Buffer.from('%PDF-1.4 fake')));
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: mockHtmlToPdf }));

// Helpers for the Supabase chain-builder — .from().select().eq().eq().eq() → { data, error }
function chain(result) {
  const b = {};
  const rec = () => b;
  b.select = rec;
  b.eq = rec;
  b.limit = rec;
  b.maybeSingle = () => Promise.resolve(result);
  b.then = (onF, onR) => Promise.resolve(result).then(onF, onR);
  return b;
}

const OxbridgeLpService = require('../../shared/services/oxbridge-lp.service');

const DISPERSION_ROW = {
  id: 13,
  source: 'oxbridge',
  grade: 'Grade Seven',
  subject: 'General Science',
  chapter_title: 'Waves and Energy',
  description: '<p><strong>Topic: </strong>Dispersion Of Light</p><p><strong>Ref No: </strong>G7_Science_Lesson_Plan_8</p>',
  content_html: '<h1>Dispersion of Light</h1><p>Learning outcome: Students will describe how white light disperses through a prism.</p><p><strong>Do-Now:</strong> Ask students to name colors in a rainbow.</p>',
};

const OTHER_G7_ROW = {
  id: 9,
  source: 'oxbridge',
  grade: 'Grade Seven',
  subject: 'General Science',
  chapter_title: 'Plant System',
  description: '<p><strong>Topic: </strong>Reproduction In Plants</p>',
  content_html: '<p>Reproduction body</p>',
};

describe('OxbridgeLpService.isEligibleGrade', () => {
  it('accepts grades 6 through 12', () => {
    for (const g of [6, 7, 8, 9, 10, 11, 12]) {
      expect(OxbridgeLpService.isEligibleGrade(g)).toBe(true);
    }
  });
  it('rejects grades outside 6..12', () => {
    for (const g of [null, undefined, 0, 1, 2, 5, 13, 14, 'seven']) {
      expect(OxbridgeLpService.isEligibleGrade(g)).toBe(false);
    }
  });
});

describe('OxbridgeLpService.findMatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [] for grades outside 6..12', async () => {
    const out = await OxbridgeLpService.findMatches({ grade: 5, topic: 'anything' });
    expect(out).toEqual([]);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('ACCEPTANCE — resolves Grade 7 "Dispersion of Light" to the Waves-and-Energy row via description', async () => {
    mockSupabaseFrom.mockReturnValueOnce(chain({ data: [DISPERSION_ROW, OTHER_G7_ROW], error: null }));

    const out = await OxbridgeLpService.findMatches({
      grade: 7, topic: 'Dispersion of Light', subject: 'physics',
    });

    expect(mockSupabaseFrom).toHaveBeenCalledWith('lesson_plan_catalog');
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].id).toBe(13); // Dispersion row is the top match
  });

  it('returns [] when topic has no chapter_title or description overlap', async () => {
    mockSupabaseFrom.mockReturnValueOnce(chain({ data: [OTHER_G7_ROW], error: null }));

    const out = await OxbridgeLpService.findMatches({
      grade: 7, topic: 'quantum entanglement for kindergarten',
    });
    expect(out).toEqual([]);
  });

  it('returns [] when the catalog query errors', async () => {
    mockSupabaseFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'db down' } }));
    const out = await OxbridgeLpService.findMatches({ grade: 7, topic: 'dispersion' });
    expect(out).toEqual([]);
  });
});

describe('OxbridgeLpService.htmlToPlainText', () => {
  it('strips tags and preserves paragraph breaks', () => {
    const html = '<h1>Title</h1><p>Line 1</p><p>Line 2</p>';
    const out = OxbridgeLpService.htmlToPlainText(html);
    expect(out).toContain('Title');
    expect(out).toContain('Line 1');
    expect(out).toContain('Line 2');
    expect(out).not.toMatch(/<[a-z]+>/i);
  });

  it('decodes common HTML entities', () => {
    expect(OxbridgeLpService.htmlToPlainText('<p>A &amp; B &nbsp; C</p>')).toContain('A & B');
  });
});

describe('OxbridgeLpService.sendPicker', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends exactly 2 interactive buttons with the top match id embedded', async () => {
    const ok = await OxbridgeLpService.sendPicker(
      '923333232533', [DISPERSION_ROW, OTHER_G7_ROW],
      { topic: 'Dispersion of Light', grade: 7, subject: 'physics', language: 'en' }
    );

    expect(ok).toBe(true);
    expect(mockSendButtons).toHaveBeenCalledTimes(1);
    const [ toPhone, opts ] = mockSendButtons.mock.calls[0];
    expect(toPhone).toBe('923333232533');
    expect(opts.buttons).toHaveLength(2);
    expect(opts.buttons[0].id).toBe('oxbridge_lp_pick_13');
    expect(opts.buttons[1].id).toBe('oxbridge_lp_rumi');

    // Pending picker state cached in Redis
    expect(mockRedis.redis.setex).toHaveBeenCalledTimes(1);
    const [ key, ttl, payload ] = mockRedis.redis.setex.mock.calls[0];
    expect(key).toBe('oxbridge_picker:923333232533');
    expect(ttl).toBeGreaterThan(0);
    const parsed = JSON.parse(payload);
    expect(parsed.matchIds).toEqual([13, 9]);
    expect(parsed.topic).toBe('Dispersion of Light');
  });

  it('returns false without sending when no matches provided', async () => {
    const ok = await OxbridgeLpService.sendPicker('923333232533', [], { topic: 'x' });
    expect(ok).toBe(false);
    expect(mockSendButtons).not.toHaveBeenCalled();
  });
});

describe('OxbridgeLpService.deliverOxbridgeLp', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('delivers the content_html verbatim as text + PDF (no LLM call)', async () => {
    const ok = await OxbridgeLpService.deliverOxbridgeLp('923333232533', DISPERSION_ROW, 'en');

    expect(ok).toBe(true);

    // 1. Text message includes the LP content
    expect(mockSendMessage).toHaveBeenCalled();
    const textArgs = mockSendMessage.mock.calls[0];
    expect(textArgs[0]).toBe('923333232533');
    expect(textArgs[1]).toMatch(/Dispersion of Light/);
    expect(textArgs[1]).toMatch(/Waves and Energy/);
    // No tags leaked
    expect(textArgs[1]).not.toMatch(/<h1>|<p>/);

    // 2. PDF rendered from content_html
    expect(mockHtmlToPdf).toHaveBeenCalledTimes(1);
    const rendered = mockHtmlToPdf.mock.calls[0][0];
    expect(rendered).toContain('Dispersion of Light');
    expect(rendered).toContain('Learning outcome');

    // 3. Document sent to WhatsApp
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    const [ toPhone, _tmpPath, filename ] = mockSendDocument.mock.calls[0];
    expect(toPhone).toBe('923333232533');
    expect(filename).toMatch(/Oxbridge/);
    expect(filename).toMatch(/Waves and Energy/);
  });

  it('returns false gracefully if row has no content_html', async () => {
    const ok = await OxbridgeLpService.deliverOxbridgeLp('923333232533', { id: 1, chapter_title: 'X' }, 'en');
    expect(ok).toBe(false);
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });
});
