/**
 * v10 coaching test (bd-v0toag.50.1): the v10 card is served to plan-arm v10 schools (B, D).
 *
 * The card is its own asset kind ('card') beside the v9 lesson, so the v9 row stays current for
 * everyone else. A teacher in a v10 school gets the current card PDF; anyone else, a day with no
 * card, the switch off or any failure gets the v9 lesson. The v9 lesson stays the plan of record
 * (the download row, grading and the quiz key off it). Every send to a drawn teacher is logged as
 * lp.v10.plan_served, so a card send is told apart from a v9 send.
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

function db(rows, error = null) {
  const filters = [];
  mockSupabase.from.mockImplementation(() => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn((c, v) => { filters.push([c, v]); return chain; }),
      maybeSingle: jest.fn(async () => (error
        ? { data: null, error: { message: error } }
        : { data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) || null, error: null })),
    };
    return chain;
  });
  return filters;
}

const arm = (group, plan) => ({ group, plan, report: 'today' });

beforeEach(() => { jest.clearAllMocks(); mockArms.groupFor.mockResolvedValue(null); });

describe('pickServed (pure)', () => {
  test('plan v10 with a card → the card', () => {
    expect(Card.pickServed({ plan: 'v10', lesson: LESSON, card: CARD })).toEqual({ asset: CARD, served: 'card' });
  });
  test.each([
    ['plan v9', { plan: 'v9', lesson: LESSON, card: CARD }],
    ['no arm', { plan: null, lesson: LESSON, card: CARD }],
    ['no card', { plan: 'v10', lesson: LESSON, card: null }],
    ['card without a file', { plan: 'v10', lesson: LESSON, card: { ...CARD, r2_key: null } }],
  ])('%s → the v9 lesson', (_, args) => {
    expect(Card.pickServed(args)).toEqual({ asset: LESSON, served: 'v9' });
  });
  test('no v9 lesson → nothing, even with a card (the card never stands alone)', () => {
    expect(Card.pickServed({ plan: 'v10', lesson: null, card: CARD })).toEqual({ asset: null, served: 'v9' });
  });
});

describe('servedFor', () => {
  test('not in the draw: the lesson, no card read, nothing logged', async () => {
    db([LESSON, CARD]);
    const out = await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp' });
    expect(out).toBe(LESSON);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockLog.logEvent).not.toHaveBeenCalled();
  });

  test('group B: the current card row, logged as a card send', async () => {
    mockArms.groupFor.mockResolvedValue(arm('B', 'v10'));
    const filters = db([LESSON, CARD]);
    const out = await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'app' });
    expect(out).toBe(CARD);
    expect(filters).toEqual(expect.arrayContaining([['lesson_id', 'L1'], ['asset_kind', 'card'], ['is_current', true]]));
    expect(mockLog.logEvent).toHaveBeenCalledWith('lp.v10.plan_served', expect.objectContaining({
      userId: 'u', lessonId: 'L1', group: 'B', plan: 'v10', served: 'card', channel: 'app',
      cardAssetId: 'a-card', lessonAssetId: 'a-v9',
    }));
  });

  test('group D with no card for the day: v9, logged as a v9 send', async () => {
    mockArms.groupFor.mockResolvedValue(arm('D', 'v10'));
    db([LESSON]);
    const out = await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp' });
    expect(out).toBe(LESSON);
    expect(mockLog.logEvent).toHaveBeenCalledWith('lp.v10.plan_served', expect.objectContaining({
      group: 'D', served: 'v9', cardAssetId: null,
    }));
  });

  test('group C (plan v9): v9 without reading cards, still logged', async () => {
    mockArms.groupFor.mockResolvedValue(arm('C', 'v9'));
    db([LESSON, CARD]);
    expect(await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp' })).toBe(LESSON);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockLog.logEvent).toHaveBeenCalledWith('lp.v10.plan_served', expect.objectContaining({ group: 'C', served: 'v9' }));
  });

  test('a card read error: v9, never throws', async () => {
    mockArms.groupFor.mockResolvedValue(arm('B', 'v10'));
    db([CARD], 'boom');
    expect(await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp' })).toBe(LESSON);
  });

  test('an arm lookup that throws: v9', async () => {
    mockArms.groupFor.mockRejectedValue(new Error('down'));
    expect(await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'whatsapp' })).toBe(LESSON);
  });

  test('no v9 lesson: null, and the card is not read', async () => {
    mockArms.groupFor.mockResolvedValue(arm('B', 'v10'));
    db([CARD]);
    expect(await Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: null, channel: 'whatsapp' })).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
