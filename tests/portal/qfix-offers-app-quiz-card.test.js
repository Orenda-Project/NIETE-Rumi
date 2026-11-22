/**
 * The teacher app's "Make a quiz on today's lesson" card, in Home's "Ready for you".
 *
 * When a teacher's 24-hour WhatsApp window is shut, the 15:00 lesson-plan quiz offer and the lesson-plan coaching ask
 * are skipped (a teacher_nudges row, status skipped, context.skip_reason window_closed / window_closed_template). Most
 * of those teachers took the lesson in the app, so the app can make the offer instead: GET /me/notices lists ONE
 * `quiz_offer` item that day, and its tap opens the quiz home the app already has.
 *
 * Held to:
 *   - behind app_settings.quiz_offer_closed_window = { app_card: true }; a missing row, another shape, or a failed
 *     read is OFF, and OFF is today's list exactly (no teacher_nudges read at all);
 *   - only TODAY's (Pakistan) skipped row of one of the two kinds for one of the two reasons, the teacher's only;
 *   - one card per teacher per day (the quiz offer's row first: it names the topics);
 *   - gone once a quiz made today covers the lesson, or once the teacher tapped it (context.app_card_opened_at);
 *   - teacher_notice.quiz_offer_shown / _opened carry only the row's kind and the nudge id, in data_json.
 *
 * The fake database below FILTERS: it answers each statement from fixture tables using the statement's own
 * parameters, so a wrong day, kind, reason or user in the call is a wrong answer here.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OTHER = '7a2d3b8f-1c9e-4d66-8b62-3e8f1f4cad21';
const NUDGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NUDGE2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ = '11111111-1111-4111-8111-111111111111';

// Thursday 2026-10-08, 16:00 in Pakistan (11:00 UTC).
const NOW = new Date('2026-10-08T11:00:00Z');
const TODAY = '2026-10-08';
const DAY_START = '2026-10-07T19:00:00.000Z';
const DAY_END = '2026-10-08T19:00:00.000Z';

const N = () => require('../../dashboard/services/teacher-notices.service');

const offerRow = (over = {}) => ({
  id: NUDGE, user_id: TEACHER, kind: 'lp_quiz_offer', nudge_date: TODAY, status: 'skipped',
  created_at: '2026-10-08T09:55:00Z', updated_at: '2026-10-08T10:00:00Z',
  context: {
    skip_reason: 'window_closed',
    classes: [{ key: 'g4_maths', grade: 4, subject: 'Maths', lessons: [
      { lesson_id: 'm4.c03.l02', topic: 'Comparing fractions' },
      { lesson_id: 'm4.c03.l03', topic: 'Ordering fractions' },
    ] }],
  },
  ...over,
});
const askRow = (over = {}) => ({
  id: NUDGE2, user_id: TEACHER, kind: 'coaching_after_lp', nudge_date: TODAY, status: 'skipped',
  created_at: '2026-10-08T06:00:00Z', updated_at: '2026-10-08T07:30:00Z',
  context: { skip_reason: 'window_closed_template', lesson_id: 'e4.c01.l05', delivered_at: '2026-10-08T05:00:00Z' },
  ...over,
});
const quizRow = (over = {}) => ({
  id: 'q1', teacher_id: TEACHER, status: 'ready', created_at: '2026-10-08T10:30:00Z',
  meta: { lessons: [{ lesson_id: 'm4.c03.l02' }, { lesson_id: 'm4.c03.l03' }] }, ...over,
});
const paperRow = () => ({
  request_id: REQ, grade_code: 'grade_4', subject_code: 'science', chapter_number: 2, requested_questions: 15,
  created_at: '2026-10-08T10:55:00Z', notice_seen_at: null, notice_opened_at: null,
  paper_id: null, paper_status: null, error_code: null, ready_at: null, paper_questions: null,
});

const ON = { app_card: true };

/**
 * A database that answers from fixture tables, by the statement's parameters.
 *   app_settings     WHERE key = $1
 *   teacher_nudges   SELECT … WHERE user_id = $1 AND nudge_date = $2 AND kind = ANY($3) AND status = 'skipped'
 *                    AND context->>'skip_reason' = ANY($4) AND no app_card_opened_at
 *                    UPDATE … (opened) WHERE id = $1 AND user_id = $2 AND kind = ANY($3) AND status = 'skipped'
 *   quizzes          the lesson ids among $3 covered by the teacher's ($1) quizzes made since $2 (not failed / cancelled)
 */
function fakeDb({ settings = {}, nudges = [], quizzes = [], papers = [], settingsError = null, nudgesError = null } = {}) {
  const calls = [];
  const db = {
    calls,
    nudges,
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM app_settings/i.test(sql)) {
        if (settingsError) throw settingsError;
        return { rows: params[0] in settings ? [{ value: settings[params[0]] }] : [] };
      }
      if (/^\s*(WITH[\s\S]*)?UPDATE\s+teacher_nudges/i.test(sql)) {
        const [id, user, kinds] = params;
        const hit = nudges.find((r) => r.id === id && r.user_id === user && kinds.includes(r.kind) && r.status === 'skipped');
        if (!hit) return { rows: [] };
        const was = hit.context.app_card_opened_at || null;
        if (!was) hit.context = { ...hit.context, app_card_opened_at: NOW.toISOString() };
        return { rows: [{ id: hit.id, kind: hit.kind, was }] };
      }
      if (/FROM teacher_nudges/i.test(sql)) {
        if (nudgesError) throw nudgesError;
        const [user, day, kinds, reasons] = params;
        const rows = nudges.filter((r) => r.user_id === user && r.nudge_date === day && kinds.includes(r.kind)
          && r.status === 'skipped' && reasons.includes(r.context.skip_reason) && !r.context.app_card_opened_at);
        return { rows: rows.map((r) => ({ ...r })) };
      }
      if (/FROM quizzes/i.test(sql)) {
        const [user, since, lessonIds] = params;
        const out = new Set();
        quizzes.filter((q) => q.teacher_id === user && new Date(q.created_at) >= new Date(since)
          && !['failed', 'cancelled', 'declined', 'skipped'].includes(q.status))
          .forEach((q) => (q.meta.lessons || []).forEach((l) => { if (lessonIds.includes(l.lesson_id)) out.add(l.lesson_id); }));
        return { rows: [...out].map((lesson_id) => ({ lesson_id })) };
      }
      if (/FROM assessment_requests/.test(sql) && /^\s*SELECT/i.test(sql)) return { rows: papers };
      return { rows: [] };
    }),
  };
  return db;
}

let events;
beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  events = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({
    logEvent: (event, data) => events.push({ event, data }), flush: () => {}, isEnabled: () => true,
  }));
});
afterEach(() => jest.restoreAllMocks());

const quizItems = (items) => items.filter((i) => i.kind === 'quiz_offer');

describe('switch on: a skipped window-closed row today lists one quiz card', () => {
  it('the 15:00 quiz offer row → one quiz_offer item naming the first lesson not yet quizzed', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([expect.objectContaining({
      id: `quiz_offer:${NUDGE}`, kind: 'quiz_offer', state: 'ready',
      title: 'Comparing fractions', grade: 4, subject: 'Maths',
      lessonId: 'm4.c03.l02', nudgeId: NUDGE, from: 'lp_quiz_offer',
      openedAt: null, homeUntil: DAY_END,
    })]);
    // asked for today, in Pakistan, for this teacher, the two kinds, the two reasons
    const read = db.calls.find((c) => /FROM teacher_nudges/.test(c.sql));
    expect(read.params.slice(0, 4)).toEqual([TEACHER, TODAY,
      ['lp_quiz_offer', 'coaching_after_lp'], ['window_closed', 'window_closed_template']]);
  });

  it('the coaching ask row (template reason) → the same card for its lesson; no topic is invented', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [askRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([expect.objectContaining({
      id: `quiz_offer:${NUDGE2}`, title: null, lessonId: 'e4.c01.l05', from: 'coaching_after_lp', homeUntil: DAY_END,
    })]);
  });

  it('both rows the same day → ONE card, the quiz offer (it names the topics)', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [askRow(), offerRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items).map((i) => i.id)).toEqual([`quiz_offer:${NUDGE}`]);
  });

  it('the card sits with the other items of this teacher (newest first) and leaves them as they were', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()], papers: [paperRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(items.map((i) => i.id)).toEqual([`paper:${REQ}`, `quiz_offer:${NUDGE}`]);
  });

  it('listing it logs teacher_notice.quiz_offer_shown once, kind and nudge id only, in data_json', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    await N().listNotices(db.query, TEACHER, { now: NOW });
    await N().listNotices(db.query, TEACHER, { now: NOW });
    const shown = events.filter((e) => e.event === 'teacher_notice.quiz_offer_shown');
    expect(shown).toHaveLength(1);
    expect(Object.keys(shown[0].data)).toEqual(['data_json']);
    expect(JSON.parse(shown[0].data.data_json)).toEqual({ row_kind: 'lp_quiz_offer', nudge_id: NUDGE });
  });
});

describe('no card', () => {
  const on = (over) => fakeDb({ settings: { quiz_offer_closed_window: ON }, ...over });

  it('a quiz made today covers the lesson(s) → no card', async () => {
    const db = on({ nudges: [offerRow()], quizzes: [quizRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([]);
  });

  it('a quiz made today covers ONE of two lessons → the card names the other', async () => {
    const db = on({ nudges: [offerRow()], quizzes: [quizRow({ meta: { lessons: [{ lesson_id: 'm4.c03.l02' }] } })] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([expect.objectContaining({ title: 'Ordering fractions', lessonId: 'm4.c03.l03' })]);
  });

  it('a quiz on that lesson made YESTERDAY, or one that failed today, does not count', async () => {
    const db = on({ nudges: [offerRow()], quizzes: [
      quizRow({ created_at: '2026-10-07T18:59:00Z' }),
      quizRow({ id: 'q2', status: 'failed' }),
    ] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toHaveLength(1);
    const read = db.calls.find((c) => /FROM quizzes/.test(c.sql));
    expect(read.params[1]).toBe(DAY_START);
  });

  it("yesterday's row → no card", async () => {
    const db = on({ nudges: [offerRow({ nudge_date: '2026-10-07' })] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([]);
  });

  it('a row that was sent, skipped for another reason, of another kind, or another teacher\'s → no card', async () => {
    const db = on({ nudges: [
      offerRow({ status: 'sent' }),
      offerRow({ id: 'x2', context: { ...offerRow().context, skip_reason: 'offered_today' } }),
      offerRow({ id: 'x3', kind: 'topic_end_nudge' }),
      offerRow({ id: 'x4', user_id: OTHER }),
    ] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([]);
  });

  it('a row with no lesson in it → no card (nothing to make a quiz on)', async () => {
    const db = on({ nudges: [askRow({ context: { skip_reason: 'window_closed' } })] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([]);
  });

  it('a failed teacher_nudges read leaves Home as it is (no card, no 502)', async () => {
    const db = on({ nudges: [offerRow()], papers: [paperRow()], nudgesError: new Error('boom') });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(items.map((i) => i.id)).toEqual([`paper:${REQ}`]);
  });
});

describe('switch off: Home is today\'s, exactly', () => {
  const shapes = [
    ['no row', {}],
    ['app_card false', { quiz_offer_closed_window: { app_card: false } }],
    ['app_card "true" (a string)', { quiz_offer_closed_window: { app_card: 'true' } }],
    ['a bare true', { quiz_offer_closed_window: true }],
    ['an array', { quiz_offer_closed_window: [{ app_card: true }] }],
    ['another switch\'s key', { quiz_offer_closed_window: { template: true } }],
  ];
  it.each(shapes)('%s → the same items as without the feature, and teacher_nudges is never read', async (_n, settings) => {
    const base = await N().listNotices(fakeDb({ papers: [paperRow()] }).query, TEACHER, { now: NOW });
    jest.resetModules();
    const db = fakeDb({ settings, nudges: [offerRow()], papers: [paperRow()] });
    const out = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(JSON.stringify(out)).toBe(JSON.stringify(base));
    expect(db.calls.some((c) => /FROM teacher_nudges/.test(c.sql))).toBe(false);
  });

  it('an unreadable switch is off (fail-closed), and the rest of Home still loads', async () => {
    const db = fakeDb({ settingsError: new Error('db down'), nudges: [offerRow()], papers: [paperRow()] });
    const { items } = await N().listNotices(db.query, TEACHER, { now: NOW });
    expect(items.map((i) => i.id)).toEqual([`paper:${REQ}`]);
  });

  it('the switch row is read at most once per 30 seconds', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    const reads = () => db.calls.filter((c) => /FROM app_settings/.test(c.sql)).length;
    await N().listNotices(db.query, TEACHER, { now: NOW });
    await N().listNotices(db.query, TEACHER, { now: new Date(NOW.getTime() + 29_000) });
    expect(reads()).toBe(1);
    await N().listNotices(db.query, TEACHER, { now: new Date(NOW.getTime() + 31_000) });
    expect(reads()).toBe(2);
  });
});

describe('tapping it (POST /me/notices/quiz_offer:<id>/opened)', () => {
  it('marks the row once (context.app_card_opened_at), logs _opened once, and the card is gone', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    const svc = N();
    expect(await svc.markOpened(db.query, TEACHER, `quiz_offer:${NUDGE}`, { now: NOW })).toEqual({ ok: true });
    expect(await svc.markOpened(db.query, TEACHER, `quiz_offer:${NUDGE}`, { now: NOW })).toEqual({ ok: true });
    const opened = events.filter((e) => e.event === 'teacher_notice.quiz_offer_opened');
    expect(opened).toHaveLength(1);
    expect(JSON.parse(opened[0].data.data_json)).toEqual({ row_kind: 'lp_quiz_offer', nudge_id: NUDGE });
    // the row keeps its status and its reason: the funnel's counts do not move
    expect(db.nudges[0]).toMatchObject({ status: 'skipped', context: expect.objectContaining({ skip_reason: 'window_closed' }) });
    const { items } = await svc.listNotices(db.query, TEACHER, { now: NOW });
    expect(quizItems(items)).toEqual([]);
  });

  it("another teacher's nudge is not found, and nothing is written", async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow({ user_id: OTHER })] });
    expect(await N().markOpened(db.query, TEACHER, `quiz_offer:${NUDGE}`, { now: NOW })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(db.nudges[0].context.app_card_opened_at).toBeUndefined();
  });

  it('switch off → not found, nothing written', async () => {
    const db = fakeDb({ nudges: [offerRow()] });
    expect(await N().markOpened(db.query, TEACHER, `quiz_offer:${NUDGE}`, { now: NOW })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(db.calls.some((c) => /teacher_nudges/.test(c.sql))).toBe(false);
  });

  it('"seen" is not a thing for this card (it never banners): a bad id, nothing written', async () => {
    const db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    expect(await N().markSeen(db.query, TEACHER, `quiz_offer:${NUDGE}`)).toEqual({ ok: false, code: 'BAD_ID' });
    expect(db.calls.some((c) => /teacher_nudges/.test(c.sql))).toBe(false);
  });
});

describe('through the route (GET /me/notices, POST …/opened) with the real service', () => {
  function findRoute(router, method, path) {
    for (const layer of router.stack) {
      if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
        return layer.route.stack.map((s) => s.handle);
      }
    }
    return null;
  }
  async function invoke(method, path, params = {}) {
    const router = require('../../dashboard/routes/portal-teacher-notices.routes');
    const stack = findRoute(router, method, path);
    const req = { session: { portalUserId: TEACHER }, query: {}, params, body: {}, method: method.toUpperCase(), path, headers: {}, get: () => undefined };
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

  let db;
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    db = fakeDb({ settings: { quiz_offer_closed_window: ON }, nudges: [offerRow()] });
    jest.doMock('../../dashboard/config/database', () => ({ query: (sql, params) => db.query(sql, params) }));
    jest.doMock('../../dashboard/config/supabase', () => ({}));
    jest.doMock('../../dashboard/lib/portal-auth', () => ({ requirePortalAuth: (req, res, next) => next() }));
    jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async () => true }));
  });
  afterEach(() => jest.useRealTimers());

  it('GET lists the card; POST opened takes it off', async () => {
    const got = await invoke('get', '/me/notices');
    expect(got.statusCode).toBe(200);
    expect(quizItems(got.payload.items).map((i) => i.id)).toEqual([`quiz_offer:${NUDGE}`]);
    const tap = await invoke('post', '/me/notices/:id/opened', { id: `quiz_offer:${NUDGE}` });
    expect(tap).toEqual({ statusCode: 200, payload: { success: true } });
    const again = await invoke('get', '/me/notices');
    expect(quizItems(again.payload.items)).toEqual([]);
  });
});
