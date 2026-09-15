/**
 * The free-form messaging window is Meta's 24 hours, measured with a margin of
 * minutes rather than a whole hour.
 *
 * `_hasOpenMessageWindow` cut at 23 hours, so a teacher who wrote 23-24 hours
 * ago was classified cold. Measured across the 152 observe template sends since
 * 7 Sep: 5 (3.3%) went to a teacher whose last inbound was 23.05-23.92 hours
 * earlier, and zero sends fell under 23h, so the other side of the line was
 * behaving correctly. All five were tapped and delivered, so the cost was not a
 * lost report -- it was Rumi telling a coach her active teacher had not written
 * recently, and a paid template nobody needed.
 *
 * The hour of margin was there because nothing underneath caught a window that
 * had actually closed. Now the direct path falls back to the invite template on
 * a 131047, so the margin can be what it should always have been: a few minutes
 * of clock skew, not an hour of guessing.
 *
 * The negative cache's TTL is asserted against the same constant, because the
 * two must move together -- a cache that outlives the check re-closes a window
 * the check has just opened.
 */

const PHONE = '923001234567';
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const mockState = { chatSessionRows: [], userRow: null };

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/quiz/meta-window-cache.service', () => ({
  isWindowClosed: jest.fn(async () => false),
  markWindowClosed: jest.fn(),
  _TTL_SECONDS: jest.requireActual('../../shared/services/quiz/meta-window-cache.service')._TTL_SECONDS,
}));
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const state = { table, cutoff: null };
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      gte: jest.fn((_col, value) => { state.cutoff = value; return chain; }),
      single: jest.fn(async () => {
        if (state.table === 'users') return { data: mockState.userRow, error: null };
        const cut = Date.parse(state.cutoff);
        const hit = mockState.chatSessionRows.find((iso) => Date.parse(iso) >= cut);
        return hit ? { data: { id: 'cs-1' }, error: null } : { data: null, error: null };
      }),
    };
    return chain;
  }),
}));

const QuizDelivery = require('../../shared/services/quiz/quiz-delivery.service');
const metaWindowCache = jest.requireActual('../../shared/services/quiz/meta-window-cache.service');

beforeEach(() => {
  mockState.chatSessionRows = [];
  mockState.userRow = { id: 'teacher-uuid-1' };
});

describe('the window is 24 hours', () => {
  it('a teacher who wrote 22h ago is inside it (unchanged)', async () => {
    mockState.chatSessionRows = [ago(22 * HOUR)];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(true);
  });

  it('a teacher who wrote 23h15m ago is inside it — the band that produced the false invites', async () => {
    mockState.chatSessionRows = [ago(23 * HOUR + 15 * 60 * 1000)];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(true);
  });

  it('a teacher who wrote 23h50m ago is inside it', async () => {
    mockState.chatSessionRows = [ago(23 * HOUR + 50 * 60 * 1000)];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(true);
  });

  it('a margin of minutes is kept, so the last moments before 24h are not claimed', async () => {
    mockState.chatSessionRows = [ago(24 * HOUR - 60 * 1000)];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(false);
  });

  it('the cutoff is exactly the constant, asserted without racing the clock', async () => {
    // The cases above sit clear of the boundary on purpose. A case placed ON it
    // flips on the milliseconds between the test reading the clock and the
    // service reading it — which is a flaky test, not a caught bug. The
    // boundary itself is asserted here, against the constant.
    const justInside = ago(QuizDelivery.MESSAGE_WINDOW_MS - 30 * 1000);
    const justOutside = ago(QuizDelivery.MESSAGE_WINDOW_MS + 30 * 1000);
    mockState.chatSessionRows = [justInside];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(true);
    mockState.chatSessionRows = [justOutside];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(false);
  });

  it('a teacher who wrote 25h ago is outside it (unchanged)', async () => {
    mockState.chatSessionRows = [ago(25 * HOUR)];
    await expect(QuizDelivery._hasOpenMessageWindow(PHONE)).resolves.toBe(false);
  });

  it('the window is one named constant, not a literal buried in a cutoff', async () => {
    expect(QuizDelivery.MESSAGE_WINDOW_MS).toBeGreaterThan(23 * HOUR);
    expect(QuizDelivery.MESSAGE_WINDOW_MS).toBeLessThan(24 * HOUR);
  });
});

describe('the negative cache and the window check move together', () => {
  it('the cache TTL equals the window the check measures', () => {
    // If the flag outlived the cutoff, a teacher who re-engaged would stay
    // marked closed for the remainder of the old 23h TTL.
    expect(metaWindowCache._TTL_SECONDS * 1000).toBe(QuizDelivery.MESSAGE_WINDOW_MS);
  });
});
