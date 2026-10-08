/**
 * bd-fmf24g.3 — "All lesson plans" (teacher app v2, LessonsAll): her lesson-plan history for a
 * date range, the four numbers above it, and the same numbers for the period before.
 *
 *   GET /api/portal/lesson-plans/history?range=…&from=&to=[&prevFrom=&prevTo=][&grade=&subject=]
 *   → { success, range, previous, filter, kpis: { lessonPlans, classesCovered, sentOnWhatsapp,
 *       daysActive } (each { value, previous }), trend: { bucketDays, points }, items, total, truncated }
 *
 * What the tests hold it to:
 *   - every number is COUNTED from her use rows (lp-activity's three ledgers: opened in the portal,
 *     received on WhatsApp K-5 and 6-12) — no new table, no stored total;
 *   - a plan is one plan however often it was used; a day is a Pakistan day;
 *   - "classes covered" = distinct grade·subject of the plans she used, as the bot names them;
 *   - the class filter (grade + subject, any spelling) narrows the numbers AND the list alike;
 *   - the previous period is the same stretch one step back (the DateRangeBar rule): this month
 *     1–8 Oct → 1–8 Sep, this week → last week, this year → last year, n picked days → the n days
 *     before, All time → none; the client may send its own prevFrom/prevTo;
 *   - one row per plan, at its last use in the range, newest first, saying which way it came;
 *   - the bot names plans (at most 200 a call); a naming failure is a 502, never unnamed rows.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const H = () => require('../../dashboard/services/lp-history.service');

const use = (kind, ref, at, via, lang = null) => ({ kind, ref, lang, at, via });
const NAMES = {
  'k5:g4sci1': { grade: 4, subject: 'General Science', title: 'Parts of a plant', chapterNumber: 1, chapterTitle: 'Plants', dayLabel: 'Day 1', pagesLabel: 'p.2' },
  'k5:g4sci2': { grade: 4, subject: 'General Science', title: 'How plants make food', chapterNumber: 1, chapterTitle: 'Plants', dayLabel: 'Day 2', pagesLabel: 'p.4' },
  'k5:g5math': { grade: 5, subject: 'Math', title: 'Fractions', chapterNumber: 3, chapterTitle: 'Fractions', dayLabel: 'Day 1', pagesLabel: 'p.40' },
  'g612:g9phy': { grade: 9, subject: 'Physics', title: 'Speed', chapterNumber: 2, chapterTitle: 'Kinematics', dayLabel: null, pagesLabel: 'p.10' },
};
const describePlans = jest.fn(async (plans) => plans.map((p) => ({
  kind: p.kind, ref: p.ref, lang: p.lang || null, found: Boolean(NAMES[`${p.kind}:${p.ref}`]), ...(NAMES[`${p.kind}:${p.ref}`] || {}),
})));

// Current: 1–8 Oct 2026 (this month, pinned to 8 Oct). Previous: 1–8 Sep.
const CURRENT = [
  use('k5', 'g4sci1', '2026-10-08T04:00:00Z', 'portal'), //   8 Oct, opened
  use('k5', 'g4sci1', '2026-10-06T04:00:00Z', 'whatsapp'), // same plan again — one plan
  use('k5', 'g4sci2', '2026-10-07T20:30:00Z', 'whatsapp'), // 01:30 on 8 Oct in Pakistan
  use('k5', 'g5math', '2026-10-02T05:00:00Z', 'portal'),
  use('g612', 'g9phy', '2026-10-01T05:00:00Z', 'whatsapp', 'en'),
];
const PREVIOUS = [
  use('k5', 'g4sci1', '2026-09-03T05:00:00Z', 'whatsapp'),
];

function queryFor(cur = CURRENT, prev = PREVIOUS) {
  return jest.fn(async (sql, params) => {
    if (!/FROM lp_activity/.test(sql)) return { rows: [] };
    // The previous window starts 1 Sep; every other window (this month, All time) is the current one.
    const rows = params[1] === '2026-09-01' ? prev : cur;
    return { rows };
  });
}

const RANGE = { key: 'this_month', from: '2026-10-01', to: '2026-10-08', timezone: 'Asia/Karachi' };

beforeEach(() => {
  jest.resetModules();
  describePlans.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the four numbers', () => {
  test('counted from her uses: plans, classes, WhatsApp, days — and the same for the period before', async () => {
    const out = await H().lpHistory(queryFor(), TEACHER, { range: RANGE, describe: describePlans });
    expect(out.kpis).toEqual({
      lessonPlans: { value: 4, previous: 1 },
      classesCovered: { value: 3, previous: 1 }, // 4·science, 5·maths, 9·physics
      sentOnWhatsapp: { value: 3, previous: 1 }, // g4sci1 (6 Oct), g4sci2, g9phy
      daysActive: { value: 4, previous: 1 }, //     1, 2, 6, 8 Oct (20:30Z on 7 Oct is 8 Oct in PK)
    });
    expect(out.previous).toEqual({ from: '2026-09-01', to: '2026-09-08' });
  });

  test('All time has no period before: previous values are null', async () => {
    const q = queryFor();
    const out = await H().lpHistory(q, TEACHER, { range: { key: 'all', from: null, to: null }, describe: describePlans });
    expect(out.previous).toBeNull();
    expect(out.kpis.lessonPlans).toEqual({ value: 4, previous: null });
    expect(q).toHaveBeenCalledTimes(1);
  });

  test('her uses are read per teacher, per window, from the three ledgers', async () => {
    const q = queryFor();
    await H().lpHistory(q, TEACHER, { range: RANGE, describe: describePlans });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/niete_lp_opens/);
    expect(sql).toMatch(/niete_lp_downloads/);
    expect(sql).toMatch(/niete_lp612_deliveries/);
    expect(params.slice(0, 3)).toEqual([TEACHER, '2026-10-01', '2026-10-08']);
    expect(q.mock.calls[1][1].slice(0, 3)).toEqual([TEACHER, '2026-09-01', '2026-09-08']);
  });
});

describe('the class filter', () => {
  test('grade + subject in any spelling narrows the numbers and the list alike', async () => {
    const out = await H().lpHistory(queryFor(), TEACHER, { range: RANGE, describe: describePlans, filter: { grade: 4, subject: 'science' } });
    expect(out.filter).toEqual({ grade: 4, subjectKey: 'science' });
    expect(out.kpis.lessonPlans).toEqual({ value: 2, previous: 1 });
    expect(out.kpis.classesCovered).toEqual({ value: 1, previous: 1 });
    expect(out.items.map((i) => i.planKey)).toEqual(['k5:g4sci1', 'k5:g4sci2']);
  });

  test('a plan the bot cannot name is not counted under any class filter (but is with none)', async () => {
    const cur = [...CURRENT, use('k5', 'gone', '2026-10-05T05:00:00Z', 'portal')];
    const all = await H().lpHistory(queryFor(cur), TEACHER, { range: RANGE, describe: describePlans });
    expect(all.kpis.lessonPlans.value).toBe(5);
    expect(all.kpis.classesCovered.value).toBe(3);
    const narrowed = await H().lpHistory(queryFor(cur), TEACHER, { range: RANGE, describe: describePlans, filter: { grade: 5, subject: 'Mathematics' } });
    expect(narrowed.kpis.lessonPlans.value).toBe(1);
  });
});

describe('the list', () => {
  test('one row per plan at its last use in the range, newest first, with how it came', async () => {
    const { items, total, truncated } = await H().lpHistory(queryFor(), TEACHER, { range: RANGE, describe: describePlans });
    expect(items.map((i) => [i.planKey, i.day, i.via])).toEqual([
      ['k5:g4sci1', '2026-10-08', 'portal'],
      ['k5:g4sci2', '2026-10-08', 'whatsapp'],
      ['k5:g5math', '2026-10-02', 'portal'],
      ['g612:g9phy', '2026-10-01', 'whatsapp'],
    ]);
    expect(items[0]).toEqual(expect.objectContaining({
      kind: 'k5', title: 'Parts of a plant', grade: 4, subject: 'General Science', subjectKey: 'science',
      chapterNumber: 1, lastUsedAt: '2026-10-08T04:00:00.000Z', open: { lane: 'k5', lessonId: 'g4sci1' },
    }));
    expect(items[3].open).toEqual({ lane: 'g612', segmentId: 'g9phy', lang: 'en' });
    expect(total).toBe(4);
    expect(truncated).toBe(false);
  });

  test('more uses than the read cap: truncated, said so', async () => {
    const svc = H();
    const many = Array.from({ length: svc.USES_LIMIT }, (_, i) => use('k5', 'g4sci1', `2026-10-0${1 + (i % 8)}T05:00:00Z`, 'portal'));
    const out = await svc.lpHistory(queryFor(many), TEACHER, { range: RANGE, describe: describePlans });
    expect(out.truncated).toBe(true);
  });

  test('the bot names at most 200 plans a call', async () => {
    const svc = H();
    const cur = Array.from({ length: 450 }, (_, i) => use('k5', `p${i}`, '2026-10-03T05:00:00Z', 'portal'));
    await svc.lpHistory(queryFor(cur, []), TEACHER, { range: RANGE, describe: describePlans });
    expect(describePlans.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
  });

  test('naming fails → throws (the route answers 502), never unnamed rows', async () => {
    const broken = jest.fn(async () => { throw new Error('bot down'); });
    await expect(H().lpHistory(queryFor(), TEACHER, { range: RANGE, describe: broken })).rejects.toThrow('bot down');
  });
});

describe('the trend under "Lesson plans"', () => {
  test('a day each up to 14 days: distinct plans per Pakistan day, oldest → newest', async () => {
    const { trend } = await H().lpHistory(queryFor(), TEACHER, { range: RANGE, describe: describePlans });
    expect(trend).toEqual({ bucketDays: 1, points: [1, 1, 0, 0, 0, 1, 0, 2] });
  });

  test('a week each up to 120 days, 30 days beyond', () => {
    const { bucketDaysFor } = H();
    expect(bucketDaysFor(14)).toBe(1);
    expect(bucketDaysFor(15)).toBe(7);
    expect(bucketDaysFor(120)).toBe(7);
    expect(bucketDaysFor(121)).toBe(30);
  });
});

describe('previousRange — the same stretch one step back', () => {
  test.each([
    [{ key: 'this_month', from: '2026-10-01', to: '2026-10-08' }, { from: '2026-09-01', to: '2026-09-08' }],
    [{ key: 'this_month', from: '2026-03-01', to: '2026-03-31' }, { from: '2026-02-01', to: '2026-02-28' }],
    [{ key: 'this_week', from: '2026-10-05', to: '2026-10-08' }, { from: '2026-09-28', to: '2026-10-01' }],
    [{ key: 'this_year', from: '2026-01-01', to: '2026-10-08' }, { from: '2025-01-01', to: '2025-10-08' }],
    [{ key: 'last_3_months', from: '2026-07-11', to: '2026-10-08' }, { from: '2026-04-12', to: '2026-07-10' }],
    [{ key: 'custom', from: '2026-09-01', to: '2026-09-15' }, { from: '2026-08-17', to: '2026-08-31' }],
    [{ key: 'all', from: null, to: null }, null],
  ])('%j → %j', (range, prev) => {
    expect(H().previousRange(range)).toEqual(prev);
  });
});

/* ── the route ─────────────────────────────────────────────────────────── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId = TEACHER, query = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-lessons.routes');
  const stack = findRoute(router, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params: {}, method: 'GET', path, headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

describe('GET /lesson-plans/history', () => {
  let lpHistory;
  const STUBS = ['../../dashboard/services/lp-history.service', '../../dashboard/config/database', '../../dashboard/services/lp-catalogue.service'];
  beforeEach(() => {
    lpHistory = jest.fn(async () => ({ kpis: {}, items: [] }));
    const real = jest.requireActual('../../dashboard/services/lp-history.service');
    jest.doMock('../../dashboard/services/lp-history.service', () => ({ ...real, lpHistory }));
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({ describePlans }));
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
    jest.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    STUBS.forEach((m) => jest.dontMock(m));
  });

  test('signed out: 401', async () => {
    expect((await invoke('/lesson-plans/history', { userId: null })).statusCode).toBe(401);
    expect(lpHistory).not.toHaveBeenCalled();
  });

  test('default range this month, the SESSION\'s teacher, the bot names the plans', async () => {
    const { statusCode, payload } = await invoke('/lesson-plans/history');
    expect(statusCode).toBe(200);
    const [, userId, opts] = lpHistory.mock.calls[0];
    expect(userId).toBe(TEACHER);
    expect(opts.range).toEqual(expect.objectContaining({ key: 'this_month', from: '2026-10-01', to: '2026-10-08' }));
    expect(opts.describe).toBe(describePlans);
    expect(payload).toEqual(expect.objectContaining({ success: true, range: expect.objectContaining({ key: 'this_month' }) }));
  });

  test('the client\'s own previous period and class filter are passed through', async () => {
    await invoke('/lesson-plans/history', { query: { range: 'custom', from: '2026-09-01', to: '2026-09-15', prevFrom: '2026-08-01', prevTo: '2026-08-15', grade: '4', subject: 'General Science' } });
    const opts = lpHistory.mock.calls[0][2];
    expect(opts.previous).toEqual({ from: '2026-08-01', to: '2026-08-15' });
    expect(opts.filter).toEqual({ grade: 4, subject: 'General Science' });
  });

  test.each([
    [{ range: 'fortnight' }],
    [{ range: 'custom', from: '2026-09-15', to: '2026-09-01' }],
    [{ prevFrom: '2026-08-01' }],
    [{ prevFrom: '2026-08-15', prevTo: '2026-08-01' }],
    [{ grade: 'x' }],
    [{ grade: '13' }],
  ])('a bad query %j is a 400', async (query) => {
    expect((await invoke('/lesson-plans/history', { query })).statusCode).toBe(400);
    expect(lpHistory).not.toHaveBeenCalled();
  });

  test('naming or reading fails: 502', async () => {
    lpHistory.mockRejectedValueOnce(new Error('bot down'));
    const { statusCode, payload } = await invoke('/lesson-plans/history');
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});
