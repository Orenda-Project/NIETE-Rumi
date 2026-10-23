/**
 * v10 coaching test (bd-v0toag.8, PR2): the thing to try, on the lesson plan in the teacher app.
 *
 *   GET  /api/portal/teacher/thing-to-try?lessonId=   → { success, thing: { text, tag } | null }
 *   POST /api/portal/teacher/thing-to-try/tap         { lessonId, step } → 204
 *
 * What the tests hold it to:
 *   - only groups C and D (the new report), only while ab_v10_enabled is on; everyone else gets
 *     thing null, and nothing past the switch is read while it is off;
 *   - the group comes from niete_coaching_ab_assignment (by her school) — never the ch3-8 LP test's
 *     niete_lp_ab_assignment;
 *   - the thing to try is the latest session's prioritized_action.thing_to_try (bd-v0toag.20);
 *   - PR3: thing.step is the step (Opening … Check) of the move it was picked from, from that session's
 *     lp_fidelity via report-card stepOf; null when the move or its phase cannot be found;
 *   - any failed read is thing null — the plan still opens, the strip just is not there;
 *   - a shown strip and a tap are logged with the group, the move and the step; a tap from anyone
 *     outside C and D is not logged;
 *   - the teacher is the SESSION's user; dark (404) unless portal_teacher_v2 is on for her.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const LESSON = 'grade_1_english_ch8_seg6';
const THING = { move_id: 'm4', lesson_id: 'grade_1_english_ch8_seg5', text: '  Ask one child to explain to a neighbour. ', tag: 'hlp_peer_talk' };

const S = () => require('../../dashboard/services/thing-to-try.service');

/** A supabase stand-in: rows per table, filtered by eq; records the tables read. */
function fakeSupabase(tables, { fail = {} } = {}) {
  const read = [];
  return {
    read,
    from(table) {
      read.push(table);
      let rows = [...(tables[table] || [])];
      const done = () => (fail[table] ? { data: null, error: { message: 'boom' } } : null);
      const b = {
        select: () => b,
        eq: (c, v) => { rows = rows.filter((r) => String(r[c]) === String(v)); return b; },
        not: () => b,
        order: () => b,
        limit: async () => done() || { data: rows, error: null },
        maybeSingle: async () => done() || { data: rows[0] || null, error: null },
      };
      return b;
    },
  };
}

function world(group = 'C', over = {}) {
  return {
    app_settings: [{ key: 'ab_v10_enabled', value: 'true' }],
    users: [{ id: TEACHER, school_id: 's1' }],
    niete_coaching_ab_assignment: group ? [{ school_id: 's1', ab_group: group }] : [],
    coaching_sessions: [{
      user_id: TEACHER,
      prioritized_action: { action: 'old', teacher_response: 'yes', thing_to_try: THING },
      lp_fidelity: { status: 'ok', moves: [{ move_id: 'm1', phase: 'warm_up' }, { move_id: 'm4', phase: 'guided' }] },
    }],
    ...over,
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('thingFor', () => {
  test.each([['C'], ['D']])('%s: the stored thing to try, trimmed, with the group', async (g) => {
    const sb = fakeSupabase(world(g));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toEqual({
      group: g,
      thing: {
        text: 'Ask one child to explain to a neighbour.', tag: 'hlp_peer_talk', moveId: 'm4', setOnLessonId: THING.lesson_id,
        step: { name: 'We Do', index: 3 },
      },
    });
  });

  test.each([['A'], ['B']])('%s: null, and no session is read', async (g) => {
    const sb = fakeSupabase(world(g));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
    expect(sb.read).not.toContain('coaching_sessions');
  });

  test('switch off: null, nothing past the switch read', async () => {
    const sb = fakeSupabase(world('C', { app_settings: [{ key: 'ab_v10_enabled', value: 'false' }] }));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
    expect(sb.read).toEqual(['app_settings']);
  });

  test('switch row missing: off', async () => {
    const sb = fakeSupabase(world('C', { app_settings: [] }));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
  });

  test('school not in the draw: null', async () => {
    expect(await S().thingFor(fakeSupabase(world(null)), TEACHER, LESSON)).toBeNull();
  });

  test('no school on her row: null', async () => {
    expect(await S().thingFor(fakeSupabase(world('C', { users: [{ id: TEACHER, school_id: null }] })), TEACHER, LESSON)).toBeNull();
  });

  test('never reads the ch3-8 LP test assignment', async () => {
    const sb = fakeSupabase(world('C'));
    await S().thingFor(sb, TEACHER, LESSON);
    expect(sb.read).toContain('niete_coaching_ab_assignment');
    expect(sb.read).not.toContain('niete_lp_ab_assignment');
  });

  test.each([
    [{ prioritized_action: { action: 'old' } }],
    [{ prioritized_action: { thing_to_try: { text: '   ' } } }],
  ])('no usable thing to try stored: null (%p)', async (row) => {
    const sb = fakeSupabase(world('C', { coaching_sessions: [{ user_id: TEACHER, ...row }] }));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
  });

  test('no session at all: null', async () => {
    expect(await S().thingFor(fakeSupabase(world('C', { coaching_sessions: [] })), TEACHER, LESSON)).toBeNull();
  });

  test.each([['users'], ['niete_coaching_ab_assignment'], ['coaching_sessions']])('a failed %s read: null, never throws', async (t) => {
    const sb = fakeSupabase(world('C'), { fail: { [t]: true } });
    await expect(S().thingFor(sb, TEACHER, LESSON)).resolves.toBeNull();
  });

  test('no user id: null, nothing read', async () => {
    const sb = fakeSupabase(world('C'));
    expect(await S().thingFor(sb, null, LESSON)).toBeNull();
    expect(sb.read).toEqual([]);
  });
});

describe('cleanTap', () => {
  test('a lesson id and a step', () => {
    expect(S().cleanTap({ lessonId: LESSON, step: 3 })).toEqual({ lessonId: LESSON, step: 3 });
  });
  test('no step: step null', () => {
    expect(S().cleanTap({ lessonId: LESSON })).toEqual({ lessonId: LESSON, step: null });
  });
  test.each([[0], [31], [2.5], ['3'], [-1]])('a step outside 1-30 whole numbers is null (%p)', (step) => {
    expect(S().cleanTap({ lessonId: LESSON, step }).step).toBeNull();
  });
  test.each([[{}], [null], [{ lessonId: 'DROP TABLE' }], [{ lessonId: 'x'.repeat(81) }], [{ lessonId: 7 }]])(
    'a missing or malformed lesson id is lessonId null (%p)', (body) => {
      expect(S().cleanTap(body).lessonId).toBeNull();
    },
  );
});

/* ── routes ────────────────────────────────────────────────────────────── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = TEACHER, query = {}, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-thing-to-try.routes');
  const stack = findRoute(router, method, path);
  if (!stack) throw new Error(`Route ${method} ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, body, params: {}, method, path, headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    end() { return this; },
    sendStatus(c) { statusCode = c; return this; },
  };
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
  let v2On; let found; let telemetry; let thingFor;
  const STEP = { name: 'You Do', index: 4 };
  const SHOWN = { group: 'D', thing: { text: 'Wait five seconds.', tag: 'hlp_wait_time', moveId: 'm2', setOnLessonId: 'grade_1_english_ch8_seg5', step: STEP } };
  beforeEach(() => {
    v2On = true;
    found = SHOWN;
    telemetry = { logEvent: jest.fn() };
    thingFor = jest.fn(async () => found);
    jest.doMock('../../dashboard/services/telemetry.service', () => telemetry);
    jest.doMock('../../dashboard/config/supabase', () => ({}));
    jest.doMock('../../dashboard/lib/feature-flags', () => ({
      PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
      isFlagEnabledForUser: jest.fn(async (_s, key) => key === 'portal_teacher_v2' && v2On),
    }));
    jest.doMock('../../dashboard/services/thing-to-try.service', () => ({
      ...jest.requireActual('../../dashboard/services/thing-to-try.service'),
      thingFor: (...a) => thingFor(...a),
    }));
  });
  afterEach(() => {
    ['telemetry', 'thing-to-try'].forEach((m) => jest.dontMock(`../../dashboard/services/${m}.service`));
    jest.dontMock('../../dashboard/config/supabase');
    jest.dontMock('../../dashboard/lib/feature-flags');
  });

  test.each([['get', '/teacher/thing-to-try'], ['post', '/teacher/thing-to-try/tap']])(
    '%s %s signed out: 401, nothing read', async (m, p) => {
      expect((await invoke(m, p, { userId: null })).statusCode).toBe(401);
      expect(thingFor).not.toHaveBeenCalled();
    },
  );

  test.each([['get', '/teacher/thing-to-try'], ['post', '/teacher/thing-to-try/tap']])(
    '%s %s with portal_teacher_v2 off: 404, nothing read', async (m, p) => {
      v2On = false;
      expect((await invoke(m, p)).statusCode).toBe(404);
      expect(thingFor).not.toHaveBeenCalled();
    },
  );

  test('GET: the text, tag and step only, for the session\'s user, and the showing is logged', async () => {
    const { statusCode, payload } = await invoke('get', '/teacher/thing-to-try', { query: { lessonId: LESSON } });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, thing: { text: 'Wait five seconds.', tag: 'hlp_wait_time', step: STEP } });
    expect(thingFor.mock.calls[0][1]).toBe(TEACHER);
    expect(thingFor.mock.calls[0][2]).toBe(LESSON);
    expect(telemetry.logEvent).toHaveBeenCalledWith('coaching.thing_to_try.portal_shown', {
      userId: TEACHER, group: 'D', lessonId: LESSON, moveId: 'm2', setOnLessonId: 'grade_1_english_ch8_seg5', tag: 'hlp_wait_time', step: 4,
    });
  });

  test('GET: nothing for her (A, B, outside the draw, switch off): thing null, nothing logged', async () => {
    found = null;
    const { statusCode, payload } = await invoke('get', '/teacher/thing-to-try', { query: { lessonId: LESSON } });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, thing: null });
    expect(telemetry.logEvent).not.toHaveBeenCalled();
  });

  test('GET: a malformed lessonId is logged as null', async () => {
    await invoke('get', '/teacher/thing-to-try', { query: { lessonId: 'a b c' } });
    expect(telemetry.logEvent.mock.calls[0][1].lessonId).toBeNull();
  });

  test('GET: a telemetry failure does not fail the answer', async () => {
    telemetry.logEvent.mockImplementation(() => { throw new Error('axiom'); });
    const { statusCode, payload } = await invoke('get', '/teacher/thing-to-try');
    expect(statusCode).toBe(200);
    expect(payload.thing).toEqual({ text: 'Wait five seconds.', tag: 'hlp_wait_time', step: STEP });
  });

  test('POST tap: 204, logged with the group, the move and the step', async () => {
    const { statusCode } = await invoke('post', '/teacher/thing-to-try/tap', { body: { lessonId: LESSON, step: 4 } });
    expect(statusCode).toBe(204);
    expect(thingFor.mock.calls[0][2]).toBe(LESSON);
    expect(telemetry.logEvent).toHaveBeenCalledWith('coaching.thing_to_try.tap', {
      userId: TEACHER, group: 'D', lessonId: LESSON, step: 4, moveId: 'm2', setOnLessonId: 'grade_1_english_ch8_seg5', tag: 'hlp_wait_time',
    });
  });

  test('GET: a thing with no step answers step null', async () => {
    found = { ...SHOWN, thing: { ...SHOWN.thing, step: null } };
    const { payload } = await invoke('get', '/teacher/thing-to-try');
    expect(payload.thing.step).toBeNull();
  });

  test('POST tap from someone outside C and D: 204, not logged', async () => {
    found = null;
    const { statusCode } = await invoke('post', '/teacher/thing-to-try/tap', { body: { lessonId: LESSON, step: 1 } });
    expect(statusCode).toBe(204);
    expect(telemetry.logEvent).not.toHaveBeenCalled();
  });

  test('POST tap: a failed read is still 204, never an error', async () => {
    thingFor = jest.fn(async () => { throw new Error('x'); });
    expect((await invoke('post', '/teacher/thing-to-try/tap', { body: { lessonId: LESSON } })).statusCode).toBe(204);
  });
});
