'use strict';
/**
 * A settings outage costs each quiz-link and join switch ONE read per its own 30 s, not one per request.
 *
 * Six readers: one-door.flags, walk-persona, web-quiz-link-known, web-quiz-identity-roster, web-quiz-identity-flags
 * (the join's switches, read by student-ingress) and the teacher weekly report's switch.
 *
 *   (1) 20 calls during an outage (the read throws, or returns { error }) → 1 read and 1 log line
 *   (2) after the TTL → exactly 1 more read
 *   (3) recovery: an outage, then a good read after the TTL → the good value
 *   (4) last known ON, then an outage → ON for the TTL; never read, then an outage → OFF
 *   (5) a healthy store: ON and OFF answers, one read per TTL, as today
 *
 * Supabase and the logger are the boundary; every reader takes the clock as an argument.
 */

const mockDb = { mode: 'ok', rows: [], reads: 0 };
function mockFromTable(table) {
  return {
    select: () => ({
      in: (col, keys) => {
        if (table === 'app_settings') mockDb.reads += 1;
        if (mockDb.mode === 'throw') return Promise.reject(new Error('settings store down'));
        if (mockDb.mode === 'error') return Promise.resolve({ data: null, error: { message: 'settings store down' } });
        return Promise.resolve({ data: mockDb.rows.filter((r) => keys.includes(r.key)), error: null });
      },
    }),
  };
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockFromTable(t) }));
const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: () => {} }));
// The join switches' parent (its own read is not under test here): the hub is on, read from nowhere.
jest.mock('../../shared/services/quiz/web-quiz-hub-flags', () => ({ flags: async () => ({ hub: true }), prime: () => {} }));

const OneDoor = require('../../shared/services/first-touch/one-door.flags');
const Walk = require('../../shared/services/first-touch/walk-persona');
const LinkKnown = require('../../shared/services/quiz/web-quiz-link-known');
const Roster = require('../../shared/services/quiz/web-quiz-identity-roster');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const Weekly = require('../../shared/services/coaching/weekly-report/switch');

const TTL = 30 * 1000;

const MODULES = [
  { name: 'one-door.flags', reset: () => OneDoor._resetCache(), call: (now) => OneDoor.flags(now), on: (r) => r.on === true,
    onRows: [{ key: 'quiz_one_door', value: true }], offRows: [{ key: 'quiz_one_door', value: false }],
    offShape: { on: false, ownCap: 20, eventsV3: false, teacherHome: false, doorUncapped: false } },
  { name: 'walk-persona', reset: () => Walk._resetCache(), call: (now) => Walk.flagOn(now), on: (r) => r === true,
    onRows: [{ key: 'quiz_test_personas', value: true }], offRows: [], offShape: false },
  { name: 'web-quiz-link-known', reset: () => LinkKnown._resetCache(), call: (now) => LinkKnown.isOn(now), on: (r) => r === true,
    onRows: [{ key: 'web_quiz_link_known_child', value: true }], offRows: [{ key: 'web_quiz_link_known_child', value: 'true' }], offShape: false },
  { name: 'web-quiz-identity-roster', reset: () => Roster._resetCache(), call: (now) => Roster.watchRootState(now).then(async (s) => ({ ...s, mode: await Roster.identityMode(now) })),
    on: (r) => r.mode === 'v2', onRows: [{ key: 'web_quiz_identity', value: 'v2' }], offRows: [],
    offShape: { root: null, unreadable: true, mode: null } },
  { name: 'web-quiz-identity-flags (student-ingress)', reset: () => IdFlags._resetCache(), call: (now) => IdFlags.flags(now), on: (r) => r.makerPage === true,
    onRows: [{ key: 'quiz_maker_page', value: true }], offRows: [],
    offShape: { canon: false, phoneBind: false, guestHome: false, makerPage: false, firstDoor: false } },
  { name: 'weekly-report/switch', reset: () => Weekly._resetCache(), call: (now) => Weekly.reportSettings(now), on: (r) => r.enabled === true,
    onRows: [{ key: 'v10_weekly_report_enabled', value: true }], offRows: [], offShape: { enabled: false, approved: [] } },
];

const healthy = (rows) => { mockDb.mode = 'ok'; mockDb.rows = rows; };
const down = (kind = 'error') => { mockDb.mode = kind; };
const logLines = () => mockLog.mock.calls.length;

/** 10 callers at once, then 10 more spread over the window: 20 calls, all inside one TTL from `t0`. */
async function twentyCalls(m, t0) {
  const together = await Promise.all(Array.from({ length: 10 }, () => m.call(t0)));
  const spread = [];
  for (let i = 1; i <= 10; i += 1) spread.push(await m.call(t0 + i * 2900));
  return [...together, ...spread];
}

describe.each(MODULES)('$name', (m) => {
  beforeEach(() => { m.reset(); mockDb.reads = 0; mockDb.rows = []; mockDb.mode = 'ok'; mockLog.mockClear(); });

  test.each(['error', 'throw'])('(1) 20 calls during an outage (read %s) → 1 read, 1 log line, all OFF', async (kind) => {
    down(kind);
    const answers = await twentyCalls(m, 0);
    expect(mockDb.reads).toBe(1);
    expect(logLines()).toBe(1);
    for (const a of answers) expect(a).toEqual(m.offShape);
  });

  test('(2) after the TTL, still down → exactly 1 more read (and 1 more log line)', async () => {
    down();
    await twentyCalls(m, 0);
    expect(mockDb.reads).toBe(1);
    await m.call(TTL);
    await m.call(TTL + 1);
    expect(mockDb.reads).toBe(2);
    expect(logLines()).toBe(2);
  });

  test('(3) recovery: an outage, then the first good read after the TTL takes effect', async () => {
    down();
    expect(m.on(await m.call(0))).toBe(false);
    healthy(m.onRows);
    expect(m.on(await m.call(TTL - 1))).toBe(false);   // still the failed read's window
    expect(m.on(await m.call(TTL))).toBe(true);
    expect(mockDb.reads).toBe(2);
  });

  test('(4a) last known ON, then an outage → ON for the TTL, one read', async () => {
    healthy(m.onRows);
    expect(m.on(await m.call(0))).toBe(true);
    down();
    const answers = await twentyCalls(m, TTL);
    for (const a of answers) expect(m.on(a)).toBe(true);
    expect(mockDb.reads).toBe(2);
    expect(logLines()).toBe(1);
  });

  test('(4b) never read, then an outage → OFF', async () => {
    down('throw');
    expect(await m.call(5)).toEqual(m.offShape);
  });

  test('(5) healthy store: ON and OFF answers, one read per TTL, as today', async () => {
    healthy(m.onRows);
    expect(m.on(await m.call(0))).toBe(true);
    expect(m.on(await m.call(TTL - 1))).toBe(true);
    expect(mockDb.reads).toBe(1);
    healthy(m.offRows);
    expect(m.on(await m.call(TTL))).toBe(false);
    expect(mockDb.reads).toBe(2);
    expect(logLines()).toBe(0);
  });
});
