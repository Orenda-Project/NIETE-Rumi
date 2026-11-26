/**
 * Long plans (ICT feedback sheet, 82+ rows; bd-zrdvmi.71, decision bd-jrarr): the one-page v10 card
 * first for EVERY teacher, its "Full details ›" links leading into the full v9 plan. Behind
 * app_settings.lp_card_for_all, off by default (fail closed). While the coaching test runs, a drawn
 * school keeps its arm: the switch only reaches teachers the test does not cover.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockLog = { logEvent: jest.fn() };
jest.mock('../../bot/shared/utils/structured-logger', () => mockLog);
const mockArms = { groupFor: jest.fn(async () => null) };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => mockArms);

const Card = require('../../bot/shared/services/lp-v10-card.service');

const LESSON = { id: 'a-v9', lesson_id: 'L1', asset_kind: 'lesson', r2_key: 'v9.pdf', is_current: true };
const CARD = { id: 'a-card', lesson_id: 'L1', asset_kind: 'card', r2_key: 'card.pdf', is_current: true };

/** tables: { app_settings: [...], niete_lp_assets: [...] }; error: a table name whose reads fail. */
function db(tables, failTable = null) {
  mockSupabase.from.mockImplementation((table) => {
    const filters = [];
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn((c, v) => { filters.push([c, v]); return chain; }),
      maybeSingle: jest.fn(async () => (table === failTable
        ? { data: null, error: { message: 'boom' } }
        : { data: (tables[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) || null, error: null })),
    };
    return chain;
  });
}

const ON = [{ key: 'lp_card_for_all', value: true }];
const ask = (extra = {}) => Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  Card._resetServedLog();
  Card._resetCardForAll();
  mockArms.groupFor.mockResolvedValue(null);
});

describe('lp_card_for_all', () => {
  test('switch on, not in the draw, a card for the day: the card', async () => {
    db({ app_settings: ON, niete_lp_assets: [LESSON, CARD] });
    expect(await ask()).toBe(CARD);
  });

  test('switch on, also for a leader reading in the portal', async () => {
    db({ app_settings: ON, niete_lp_assets: [LESSON, CARD] });
    expect(await ask({ channel: 'app', reader: 'leader' })).toBe(CARD);
  });

  test('switch on, no card for the day (6-12, GB): the full plan', async () => {
    db({ app_settings: ON, niete_lp_assets: [LESSON] });
    expect(await ask()).toBe(LESSON);
  });

  test('switch on, card without a file: the full plan', async () => {
    db({ app_settings: ON, niete_lp_assets: [LESSON, { ...CARD, r2_key: null }] });
    expect(await ask()).toBe(LESSON);
  });

  test.each([
    ['no row', []],
    ['false', [{ key: 'lp_card_for_all', value: false }]],
    ['"true" string is on', null],
  ])('switch %s', async (name, rows) => {
    if (rows === null) {
      db({ app_settings: [{ key: 'lp_card_for_all', value: 'true' }], niete_lp_assets: [LESSON, CARD] });
      expect(await ask()).toBe(CARD);
      return;
    }
    db({ app_settings: rows, niete_lp_assets: [LESSON, CARD] });
    expect(await ask()).toBe(LESSON);
  });

  test('switch read fails: off (the full plan)', async () => {
    db({ niete_lp_assets: [LESSON, CARD] }, 'app_settings');
    expect(await ask()).toBe(LESSON);
  });

  test('card read fails: the full plan, never throws', async () => {
    db({ app_settings: ON }, 'niete_lp_assets');
    expect(await ask()).toBe(LESSON);
  });

  test('a drawn v9-arm school keeps the full plan while the test runs, switch on or not', async () => {
    mockArms.groupFor.mockResolvedValue({ group: 'A', plan: 'v9', report: 'today' });
    db({ app_settings: ON, niete_lp_assets: [LESSON, CARD] });
    expect(await ask()).toBe(LESSON);
  });

  test('not logged as a coaching-test send (that event counts drawn teachers only)', async () => {
    db({ app_settings: ON, niete_lp_assets: [LESSON, CARD] });
    await ask();
    expect(mockLog.logEvent).not.toHaveBeenCalledWith('lp.v10.plan_served', expect.anything());
  });

  test('no lesson: nothing, switch on or not (the card never stands alone)', async () => {
    db({ app_settings: ON, niete_lp_assets: [CARD] });
    expect(await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: null, channel: 'app' })).toBeNull();
  });
});
