/**
 * bd-rlxkkt.9 — the ICT HITL owner, 6 Nov 2026: when a coach completes a Coach Training module she gets a "complete"
 * option. A coach marks a module done (and can undo it); the portal's Coach Training list shows which are done.
 *
 * Where it is kept: users.preferences.coach_training_done = { <module key>: <ISO time she marked it> }. The column
 * already exists (jsonb, default {}) and other features keep their own keys in it (observe_teachers, video_clips,
 * observe_onboarding_arm), so a write is a read-merge-write of THIS key only and never drops another.
 *
 *   GET /coach/coach-training/progress          → { success, done: { praise: '2026-…Z', … } } (known modules only)
 *   PUT /coach/coach-training/progress/:key     body { done: true | false } → the same shape after the change
 */
const fs = require('fs');
const path = require('path');
const { createCoachTrainingProgressRouter, MODULE_KEYS } = require('../../dashboard/routes/coach-training-progress.routes');

const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';

function handlersOf(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${routePath}`);
  return layer.route.stack.map((s) => s.handle);
}
const last = (hs) => hs[hs.length - 1];

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** A supabase stand-in holding one users row; records every update. */
function fakeSupabase(preferences) {
  const state = { row: { id: ME, preferences }, updates: [], reads: 0 };
  const client = {
    from(table) {
      if (table !== 'users') throw new Error(`unexpected table ${table}`);
      const q = { filters: {} };
      q.select = () => q;
      q.eq = (c, v) => { q.filters[c] = v; return q; };
      q.maybeSingle = async () => { state.reads += 1; return { data: q.filters.id === ME ? { preferences: state.row.preferences } : null, error: null }; };
      q.update = (patch) => ({
        eq: async (c, v) => {
          state.updates.push({ patch, where: [c, v] });
          if (c === 'id' && v === ME) state.row.preferences = patch.preferences;
          return { error: null };
        },
      });
      return q;
    },
  };
  return { client, state };
}

const req = (extra = {}) => ({ params: {}, body: {}, query: {}, session: { portalUserId: ME }, ...extra });

describe('the module keys (ten since bd-rlxkkt.12)', () => {
  it('are the Coach Training page\'s own (portal coachTraining/modules.ts), in order', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../portal/src/portal/coach/coachTraining/modules.ts'), 'utf8');
    const keys = [...src.matchAll(/\{ n: \d+, key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(10);
    expect(MODULE_KEYS).toEqual(keys);
    expect(MODULE_KEYS[9]).toBe('evidence');
  });
});

describe('GET /coach/coach-training/progress', () => {
  it('her done modules from users.preferences.coach_training_done, known keys only', async () => {
    const { client } = fakeSupabase({ observe_teachers: ['x'], coach_training_done: { praise: '2026-11-06T08:00:00.000Z', bogus: 'x', moment: '2026-11-06T08:05:00.000Z' } });
    const router = createCoachTrainingProgressRouter({ supabase: client });
    const res = fakeRes();
    await last(handlersOf(router, 'get', '/coach/coach-training/progress'))(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, done: { praise: '2026-11-06T08:00:00.000Z', moment: '2026-11-06T08:05:00.000Z' } });
  });

  it('nothing done yet: an empty map (no preferences, or none for Coach Training)', async () => {
    for (const prefs of [null, {}, { observe_teachers: [] }]) {
      const { client } = fakeSupabase(prefs);
      const res = fakeRes();
      await last(handlersOf(createCoachTrainingProgressRouter({ supabase: client }), 'get', '/coach/coach-training/progress'))(req(), res);
      expect(res.body).toEqual({ success: true, done: {} });
    }
  });
});

describe('PUT /coach/coach-training/progress/:key', () => {
  const put = async (client, key, body) => {
    const res = fakeRes();
    await last(handlersOf(createCoachTrainingProgressRouter({ supabase: client, now: () => new Date('2026-11-06T09:00:00.000Z') }), 'put', '/coach/coach-training/progress/:key'))(req({ params: { key }, body }), res);
    return res;
  };

  it('done: true adds the module with the time, keeps every other preference', async () => {
    const { client, state } = fakeSupabase({ observe_teachers: ['t1'], video_clips: { stopped: true }, coach_training_done: { praise: '2026-11-06T08:00:00.000Z' } });
    const res = await put(client, 'moment', { done: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, done: { praise: '2026-11-06T08:00:00.000Z', moment: '2026-11-06T09:00:00.000Z' } });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].where).toEqual(['id', ME]);
    expect(state.row.preferences).toEqual({
      observe_teachers: ['t1'], video_clips: { stopped: true },
      coach_training_done: { praise: '2026-11-06T08:00:00.000Z', moment: '2026-11-06T09:00:00.000Z' },
    });
  });

  it('bd-rlxkkt.12 — Module 10 (evidence) can be marked done and undone like the other nine', async () => {
    const { client, state } = fakeSupabase({ coach_training_done: { praise: 'a' } });
    const res = await put(client, 'evidence', { done: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, done: { praise: 'a', evidence: '2026-11-06T09:00:00.000Z' } });
    expect(state.row.preferences).toEqual({ coach_training_done: { praise: 'a', evidence: '2026-11-06T09:00:00.000Z' } });
    const read = fakeRes();
    await last(handlersOf(createCoachTrainingProgressRouter({ supabase: client }), 'get', '/coach/coach-training/progress'))(req(), read);
    expect(read.body.done).toEqual({ praise: 'a', evidence: '2026-11-06T09:00:00.000Z' });
    const undo = await put(client, 'evidence', { done: false });
    expect(undo.body).toEqual({ success: true, done: { praise: 'a' } });
  });

  it('done: true on a module already done keeps its first time', async () => {
    const { client } = fakeSupabase({ coach_training_done: { praise: '2026-11-06T08:00:00.000Z' } });
    const res = await put(client, 'praise', { done: true });
    expect(res.body.done).toEqual({ praise: '2026-11-06T08:00:00.000Z' });
  });

  it('done: false takes it off (undo), and only it', async () => {
    const { client, state } = fakeSupabase({ observe_teachers: ['t1'], coach_training_done: { praise: 'a', moment: 'b' } });
    const res = await put(client, 'praise', { done: false });
    expect(res.body).toEqual({ success: true, done: { moment: 'b' } });
    expect(state.row.preferences).toEqual({ observe_teachers: ['t1'], coach_training_done: { moment: 'b' } });
  });

  it('a key that is not one of the ten is 404, and a done that is not true/false is 400; nothing is written', async () => {
    const { client, state } = fakeSupabase({});
    expect((await put(client, 'nope', { done: true })).statusCode).toBe(404);
    expect((await put(client, 'praise', { done: 'yes' })).statusCode).toBe(400);
    expect((await put(client, 'praise', {})).statusCode).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});

describe('who may call it', () => {
  it('every route runs the guards it is given, before its handler', () => {
    const g1 = () => {}; const g2 = () => {};
    const router = createCoachTrainingProgressRouter({ supabase: fakeSupabase({}).client, guards: [g1, g2] });
    for (const [m, p] of [['get', '/coach/coach-training/progress'], ['put', '/coach/coach-training/progress/:key']]) {
      const hs = handlersOf(router, m, p);
      expect(hs.slice(0, 2)).toEqual([g1, g2]);
    }
  });

  it('portal.routes mounts it behind the coach app chain (signed in, leader role, coach app on)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
    const at = src.indexOf("require('./coach-training-progress.routes').createCoachTrainingProgressRouter(");
    expect(at).toBeGreaterThan(src.indexOf('const coachV2 = ['));
    const block = src.slice(at, src.indexOf('}));', at));
    expect(block).toMatch(/guards:\s*coachV2/);
    expect(block).toMatch(/supabase/);
  });
});
