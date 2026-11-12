/**
 * bd-5l1dnw: one app open of a v10 lesson logged lp.v10.plan_served two to nine times (prod 10-12 Nov:
 * 4,516 of 8,497 teacher+lesson+minute groups), because the portal asks the bot for the PDF more than once
 * per open. That doubled the v10 A/B counts. The event is now logged once per teacher + lesson + channel
 * within a window; the teacher still gets the plan on every ask.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockLog = { logEvent: jest.fn() };
jest.mock('../../bot/shared/utils/structured-logger', () => mockLog);
const mockArms = { groupFor: jest.fn() };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => mockArms);

const Card = require('../../bot/shared/services/lp-v10-card.service');

const LESSON = { id: 'a-v9', lesson_id: 'L1', asset_kind: 'lesson', r2_key: 'v9.pdf', is_current: true };
const CARD = { id: 'a-card', lesson_id: 'L1', asset_kind: 'card', r2_key: 'card.pdf', is_current: true };

function db(rows) {
  mockSupabase.from.mockImplementation(() => {
    const filters = [];
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn((c, v) => { filters.push([c, v]); return chain; }),
      maybeSingle: jest.fn(async () => ({
        data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) || null, error: null,
      })),
    };
    return chain;
  });
}

let now;
beforeEach(() => {
  jest.clearAllMocks();
  Card._resetServedLog();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockArms.groupFor.mockResolvedValue({ group: 'B', plan: 'v10', report: 'today' });
  db([LESSON, CARD]);
});
afterEach(() => jest.restoreAllMocks());

const serve = (over = {}) => Card.servedFor({ userId: 'u', lessonId: 'L1', lesson: LESSON, channel: 'app', ...over });
const served = () => mockLog.logEvent.mock.calls.filter(([e]) => e === 'lp.v10.plan_served').length;

test('two asks for one open: the card both times, logged once', async () => {
  expect(await serve()).toBe(CARD);
  now += 3000;
  expect(await serve()).toBe(CARD);
  expect(served()).toBe(1);
});

test('nine asks inside the window log once', async () => {
  for (let i = 0; i < 9; i += 1) { await serve(); now += 1000; }
  expect(served()).toBe(1);
});

test('a reopen after the window is a new serve', async () => {
  await serve();
  now += Card.SERVED_WINDOW_MS + 1;
  await serve();
  expect(served()).toBe(2);
});

test('another teacher, lesson or channel is logged on its own', async () => {
  await serve();
  await serve({ userId: 'u2' });
  await serve({ lessonId: 'L2', lesson: { ...LESSON, lesson_id: 'L2' } });
  await serve({ channel: 'whatsapp' });
  expect(served()).toBe(4);
});

test('a leader read never logs and does not use up the teacher window', async () => {
  await serve({ reader: 'leader' });
  expect(served()).toBe(0);
  await serve();
  expect(served()).toBe(1);
});

test('the dedupe store prunes old entries, so it cannot grow without bound', async () => {
  for (let i = 0; i < 50; i += 1) await serve({ userId: `t${i}` });
  now += Card.SERVED_WINDOW_MS + 1;
  await serve({ userId: 'fresh' });
  expect(Card._servedLogSize()).toBe(1);
});
