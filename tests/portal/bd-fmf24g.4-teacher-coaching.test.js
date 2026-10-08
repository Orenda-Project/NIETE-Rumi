/**
 * bd-fmf24g.4 — teacher app v2: the Digital Coaching + Observations reads the portal had no source for.
 *
 *   GET /api/portal/teacher/visits                 → { next, inProgress }
 *   GET /api/portal/teacher/coaching/:id/journey   → { points: [{ date, pct }] }
 *   GET /api/portal/teacher/coaching/history?range → "All DC observations": items, kpis, trend
 *
 * What the tests hold it to:
 *   - the teacher is ALWAYS the session's user, and every route is dark (404) unless
 *     portal_teacher_v2 is on for her — nothing is read before that check;
 *   - her next visit is HER row in observation_schedules (teacher_ext_id is her phone, as digits),
 *     upcoming and not in the past — never another teacher's;
 *   - a coach visit still being worked on shows its stage, the date and the coach — no scores,
 *     no notes, no draft;
 *   - the journey is her own scored sessions up to this one, oldest first, at most 12;
 *   - the history is her Digital Coach lessons only (no coach visits), with the period before.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const SESSION = '0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

const S = () => require('../../dashboard/services/teacher-coaching.service');

/** A pool.query stand-in: answers by the tag each SQL statement carries, and records every call. */
function fakeQuery(answers = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    const tag = (String(sql).match(/teacher-coaching:([a-z-]+)/) || [])[1];
    const answer = answers[tag];
    if (answer instanceof Error) throw answer;
    return { rows: typeof answer === 'function' ? answer(params) : (answer || []) };
  });
  query.calls = calls;
  query.sqlOf = (tag) => (calls.find((c) => c.sql.includes(`teacher-coaching:${tag}`)) || {});
  return query;
}

beforeEach(() => { jest.resetModules(); });

/* ── next visit ────────────────────────────────────────────────────────── */

describe('nextVisit', () => {
  test('her phone, as digits, against teacher_ext_id; upcoming; not before today', async () => {
    const query = fakeQuery({
      phone: [{ phone_number: '+92 300-1234567' }],
      'next-visit': [{ scheduled_for: '2026-10-12', scheduled_slot: 'morning', school_name: 'IMSG I-10/1', coach_name: 'Hataf' }],
    });
    const visit = await S().nextVisit(query, TEACHER, { today: '2026-10-08' });

    expect(visit).toEqual({ date: '2026-10-12', slot: 'morning', coachName: 'Hataf', schoolName: 'IMSG I-10/1' });
    expect(query.sqlOf('phone').params).toEqual([TEACHER]);
    const { sql, params } = query.sqlOf('next-visit');
    expect(params).toEqual(['923001234567', '2026-10-08']);
    expect(sql).toMatch(/status\s*=\s*'upcoming'/);
    expect(sql).toMatch(/scheduled_for\s*>=\s*\$2/);
    expect(sql).toMatch(/teacher_ext_id/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/u\.name AS coach_name/); // NIETE's one name column (bd-60092)
  });

  test('a Date scheduled_for comes back as its calendar day', async () => {
    const query = fakeQuery({
      phone: [{ phone_number: '923001234567' }],
      'next-visit': [{ scheduled_for: new Date('2026-10-12T00:00:00Z'), scheduled_slot: null, school_name: null, coach_name: null }],
    });
    expect(await S().nextVisit(query, TEACHER, { today: '2026-10-08' }))
      .toEqual({ date: '2026-10-12', slot: null, coachName: null, schoolName: null });
  });

  test('no phone on her account: null, and no schedule is read', async () => {
    const query = fakeQuery({ phone: [{ phone_number: null }] });
    expect(await S().nextVisit(query, TEACHER, { today: '2026-10-08' })).toBeNull();
    expect(query.sqlOf('next-visit').sql).toBeUndefined();
  });

  test('nothing upcoming: null', async () => {
    const query = fakeQuery({ phone: [{ phone_number: '923001234567' }], 'next-visit': [] });
    expect(await S().nextVisit(query, TEACHER, { today: '2026-10-08' })).toBeNull();
  });
});

/* ── coach visits being worked on ──────────────────────────────────────── */

describe('visitsInProgress', () => {
  test('stage from the session; only date, coach and stage leave the server', async () => {
    const query = fakeQuery({
      'in-progress': [
        { id: 'a', created_at: '2026-10-07T05:00:00Z', status: 'awaiting_observer_review', debrief_status: 'pending', coach_name: 'Hataf', analysis_data: { scores: { overall_percentage: 61 } } },
        { id: 'b', created_at: '2026-10-05T05:00:00Z', status: 'observer_review_complete', debrief_status: 'pending', coach_name: 'Hataf' },
        { id: 'c', created_at: '2026-10-03T05:00:00Z', status: 'observer_review_complete', debrief_status: 'done', coach_name: null },
      ],
    });
    const out = await S().visitsInProgress(query, TEACHER);

    expect(out).toEqual([
      { sessionId: 'a', date: '2026-10-07', coachName: 'Hataf', stage: 'reviewing' },
      { sessionId: 'b', date: '2026-10-05', coachName: 'Hataf', stage: 'debrief' },
      { sessionId: 'c', date: '2026-10-03', coachName: null, stage: 'report' },
    ]);
    const { sql, params } = query.sqlOf('in-progress');
    expect(params[0]).toBe(TEACHER);
    expect(sql).toMatch(/user_id\s*=\s*\$1/);
    expect(sql).toMatch(/observation_type\s*=\s*'leader_observation'/);
    expect(sql).toMatch(/'sent'/);
    expect(sql).toMatch(/'failed'/);
    expect(sql).toMatch(/'cancelled'/);
    expect(sql).toMatch(/'abandoned'/);
  });

  test('hitlStage: anything before the coach finishes is "reviewing"', () => {
    expect(S().hitlStage({ status: 'transcribing' })).toBe('reviewing');
    expect(S().hitlStage({ status: 'analysis_complete', debrief_status: null })).toBe('reviewing');
    expect(S().hitlStage({ status: 'observer_review_complete', debrief_status: 'pending' })).toBe('debrief');
    expect(S().hitlStage({ status: 'completed', debrief_status: 'done' })).toBe('report');
  });
});

/* ── journey ───────────────────────────────────────────────────────────── */

describe('journey', () => {
  test('not her session: null, and no history is read', async () => {
    const query = fakeQuery({ owner: [] });
    expect(await S().journey(query, TEACHER, SESSION)).toBeNull();
    expect(query.sqlOf('owner').params).toEqual([SESSION, TEACHER]);
    expect(query.sqlOf('journey').sql).toBeUndefined();
  });

  test('her scored sessions up to this one, oldest first; unscored ones left out', async () => {
    const query = fakeQuery({
      owner: [{ id: SESSION, created_at: '2026-10-02T06:00:00Z' }],
      journey: [ // newest first, as the SQL orders them
        { created_at: '2026-10-02T06:00:00Z', scores: { overall_percentage: 58 } },
        { created_at: '2026-09-20T06:00:00Z', scores: {} },
        { created_at: '2026-09-10T06:00:00Z', scores: { overall_marks: 26, overall_max_marks: 52 } },
      ],
    });
    expect(await S().journey(query, TEACHER, SESSION)).toEqual([
      { date: '2026-09-10', pct: 50 },
      { date: '2026-10-02', pct: 58 },
    ]);
    const { sql, params } = query.sqlOf('journey');
    expect(params).toEqual([TEACHER, '2026-10-02T06:00:00Z', 12]);
    expect(sql).toMatch(/status\s*=\s*'completed'/);
    expect(sql).toMatch(/created_at\s*<=\s*\$2/);
    expect(sql).toMatch(/analysis_data->'scores'/); // never the whole analysis_data (class R)
  });
});

/* ── All DC observations ───────────────────────────────────────────────── */

describe('dcHistory', () => {
  const RANGE = { key: 'this_month', from: '2026-10-01', to: '2026-10-08', timezone: 'Asia/Karachi' };
  const row = (o) => ({ status: 'completed', audio_duration_seconds: 1800, scores: null, topic: null, subject: null, grade: null, ...o });

  test('items, the three numbers and the period before', async () => {
    const query = fakeQuery({
      history: (params) => (params[1] === '2026-10-01'
        ? [
          row({ id: 's3', created_at: '2026-10-08T04:00:00Z', status: 'analyzing', audio_duration_seconds: 2040 }),
          row({ id: 's2', created_at: '2026-10-06T04:00:00Z', topic: 'How plants make food', subject: 'General Science', grade: '4', scores: { overall_percentage: 71 } }),
          row({ id: 's1', created_at: '2026-10-02T04:00:00Z', audio_duration_seconds: 1860, topic: 'Naming words', subject: 'English', scores: { overall_percentage: 63 } }),
        ]
        : [row({ id: 'p1', created_at: '2026-09-05T04:00:00Z', audio_duration_seconds: 1500 })]),
    });
    const out = await S().dcHistory(query, TEACHER, { range: RANGE });

    expect(out.previous).toEqual({ from: '2026-09-01', to: '2026-09-08' });
    expect(out.items).toEqual([
      { id: 's3', date: '2026-10-08', topic: null, subject: null, grade: null, minutes: 34, percentage: null, reportReady: false },
      { id: 's2', date: '2026-10-06', topic: 'How plants make food', subject: 'General Science', grade: 4, minutes: 30, percentage: 71, reportReady: true },
      { id: 's1', date: '2026-10-02', topic: 'Naming words', subject: 'English', grade: null, minutes: 31, percentage: 63, reportReady: true },
    ]);
    expect(out.kpis).toEqual({
      sessions: { value: 3, previous: 1 },
      minutes: { value: 95, previous: 25 },
      reports: { value: 2, previous: 1 },
    });
    expect(out.trend.bucketDays).toBe(1);
    expect(out.trend.points.reduce((a, b) => a + b, 0)).toBe(3);
    expect(out.trend.points).toHaveLength(8);
    expect(out.total).toBe(3);

    const first = query.calls[0];
    expect(first.params[0]).toBe(TEACHER);
    expect(first.sql).toMatch(/observation_type IS NULL/);
    expect(first.sql).toMatch(/'failed'/);
    expect(first.sql).toMatch(/'initiated'/);
    expect(first.sql).not.toMatch(/,\s*analysis_data\s*\n/); // paths only (class R)
  });

  test('All time: no period before, nothing compared', async () => {
    const query = fakeQuery({ history: [row({ id: 's1', created_at: '2026-10-02T04:00:00Z' })] });
    const out = await S().dcHistory(query, TEACHER, { range: { key: 'all', from: null, to: null } });
    expect(out.previous).toBeNull();
    expect(out.kpis.sessions).toEqual({ value: 1, previous: null });
    expect(query.calls).toHaveLength(1);
  });

  test('the client\'s own period before wins', async () => {
    const query = fakeQuery({ history: [] });
    const out = await S().dcHistory(query, TEACHER, { range: RANGE, previous: { from: '2026-08-01', to: '2026-08-08' } });
    expect(out.previous).toEqual({ from: '2026-08-01', to: '2026-08-08' });
    expect(query.calls[1].params.slice(1, 3)).toEqual(['2026-08-01', '2026-08-08']);
  });
});

/* ── the routes ────────────────────────────────────────────────────────── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId = TEACHER, query = {}, params = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-coaching.routes');
  const stack = findRoute(router, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params, method: 'GET', path, headers: {}, get: () => undefined };
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

describe('routes', () => {
  let svc; let flagOn;
  beforeEach(() => {
    flagOn = true;
    svc = {
      nextVisit: jest.fn(async () => ({ date: '2026-10-12', slot: 'morning', coachName: 'Hataf', schoolName: 'IMSG' })),
      visitsInProgress: jest.fn(async () => []),
      journey: jest.fn(async () => [{ date: '2026-10-02', pct: 58 }]),
      dcHistory: jest.fn(async () => ({ previous: null, kpis: {}, trend: { bucketDays: 1, points: [] }, items: [], total: 0, truncated: false })),
    };
    jest.doMock('../../dashboard/services/teacher-coaching.service', () => svc);
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
    jest.doMock('../../dashboard/config/supabase', () => ({}));
    jest.doMock('../../dashboard/lib/feature-flags', () => ({
      PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
      isFlagEnabledForUser: jest.fn(async (_s, key) => key === 'portal_teacher_v2' && flagOn),
    }));
  });

  test.each([
    '/teacher/visits', '/teacher/coaching/:id/journey', '/teacher/coaching/history',
  ])('%s signed out: 401, nothing read', async (path) => {
    const { statusCode } = await invoke(path, { userId: null, params: { id: SESSION } });
    expect(statusCode).toBe(401);
    expect(svc.nextVisit).not.toHaveBeenCalled();
    expect(svc.journey).not.toHaveBeenCalled();
    expect(svc.dcHistory).not.toHaveBeenCalled();
  });

  test.each([
    '/teacher/visits', '/teacher/coaching/:id/journey', '/teacher/coaching/history',
  ])('%s with portal_teacher_v2 off: 404, nothing read', async (path) => {
    flagOn = false;
    const { statusCode } = await invoke(path, { params: { id: SESSION } });
    expect(statusCode).toBe(404);
    expect(svc.nextVisit).not.toHaveBeenCalled();
    expect(svc.visitsInProgress).not.toHaveBeenCalled();
    expect(svc.journey).not.toHaveBeenCalled();
    expect(svc.dcHistory).not.toHaveBeenCalled();
  });

  test('visits: next + in progress, for the session\'s user', async () => {
    svc.visitsInProgress.mockResolvedValue([{ sessionId: 'a', date: '2026-10-07', coachName: 'Hataf', stage: 'reviewing' }]);
    const { statusCode, payload } = await invoke('/teacher/visits');
    expect(statusCode).toBe(200);
    expect(payload).toEqual({
      success: true,
      next: { date: '2026-10-12', slot: 'morning', coachName: 'Hataf', schoolName: 'IMSG' },
      inProgress: [{ sessionId: 'a', date: '2026-10-07', coachName: 'Hataf', stage: 'reviewing' }],
    });
    expect(svc.nextVisit.mock.calls[0][1]).toBe(TEACHER);
    expect(svc.nextVisit.mock.calls[0][2].today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(svc.visitsInProgress.mock.calls[0][1]).toBe(TEACHER);
  });

  test('visits: a read that fails is a 502, never "no visit"', async () => {
    svc.nextVisit.mockRejectedValue(new Error('db down'));
    const { statusCode, payload } = await invoke('/teacher/visits');
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });

  test('journey: hers → points; not hers → 404', async () => {
    let r = await invoke('/teacher/coaching/:id/journey', { params: { id: SESSION } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({ success: true, points: [{ date: '2026-10-02', pct: 58 }] });
    expect(svc.journey.mock.calls[0].slice(1)).toEqual([TEACHER, SESSION]);

    svc.journey.mockResolvedValue(null);
    r = await invoke('/teacher/coaching/:id/journey', { params: { id: SESSION } });
    expect(r.statusCode).toBe(404);
  });

  test('journey: an id that is not a uuid is a 404 without a read', async () => {
    const r = await invoke('/teacher/coaching/:id/journey', { params: { id: 'nope' } });
    expect(r.statusCode).toBe(404);
    expect(svc.journey).not.toHaveBeenCalled();
  });

  test('history: range resolved, previous passed through, 502 on failure', async () => {
    let r = await invoke('/teacher/coaching/history', { query: { range: 'custom', from: '2026-10-01', to: '2026-10-08', prevFrom: '2026-09-01', prevTo: '2026-09-08' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.success).toBe(true);
    expect(r.payload.range).toMatchObject({ key: 'custom', from: '2026-10-01', to: '2026-10-08' });
    const opts = svc.dcHistory.mock.calls[0][2];
    expect(opts.range).toMatchObject({ from: '2026-10-01', to: '2026-10-08' });
    expect(opts.previous).toEqual({ from: '2026-09-01', to: '2026-09-08' });

    r = await invoke('/teacher/coaching/history', { query: { range: 'someday' } });
    expect(r.statusCode).toBe(400);

    svc.dcHistory.mockRejectedValue(new Error('db down'));
    r = await invoke('/teacher/coaching/history', { query: {} });
    expect(r.statusCode).toBe(502);
  });
});
