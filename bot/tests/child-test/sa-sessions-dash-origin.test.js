'use strict';

/**
 * Round 7b, item 15 and Amendment 1 (sa_dash_filters ON):
 *   - each session says whether its child was added on the spot ("Add a child": the draw row written by draw.addChild,
 *     algo_version ctd-added-on-spot-v1 / seed_digest 'added') or came from the system's random draw: `origin`
 *     'added' | 'drawn' (null when the draw cannot be read). The draws are read once for all sessions. The draw id
 *     itself never leaves the bot.
 *   - the stops carry `incomplete_move_on` (the completion rule that replaces the under-20% rule) and still an old
 *     `under20_move_on`, whichever the session holds.
 * OFF: no draw read, no origin.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const S1 = 'cccccccc-0000-4000-8000-000000000001';
const S2 = 'cccccccc-0000-4000-8000-000000000002';
const S3 = 'cccccccc-0000-4000-8000-000000000003';
const D1 = 'dddddddd-0000-4000-8000-000000000001';
const D2 = 'dddddddd-0000-4000-8000-000000000002';
const D3 = 'dddddddd-0000-4000-8000-000000000003';
// (the store's session rows never carry draw_id: the origin read resolves it inside the store)

const session = (id, draw, events = []) => ({
  id, draw_id: draw, coach_user_id: COACH, student_id: `st-${id}`, school_id: 'sch-1', grade: 3, form: 'A', item_bank_version: 'sa-battery',
  status: 'completed', started_at: '2026-10-27T05:00:00Z', created_at: '2026-10-27T05:00:00Z', device: { block: 'rdf_auto', events },
});
const block = (sessionId) => ({ session_id: sessionId, block: 'ur.words4', response_mode: 'record', lang: 'ur', created_at: '2026-10-27T05:05:00Z',
  ai_status: 'scored', ai_marks: { correct: 3, attempted: 4 }, audio_r2_key: `k/${sessionId}.webm`, responses: [{ kind: 'result', mode: 'record' }] });

function world(dash = true) {
  const calls = { draws: [] };
  const store = {
    listSaSessions: async () => ({ ok: true, sessions: [
      session(S1, D1, [{ seq: 1, type: 'incomplete_move_on', task_id: 'ur.letter_names5', at: '2026-10-27T05:02:00Z', data: { by: 'app', section: 'ur', reason: 'time_up', reached: 3, of: 10 } }]),
      session(S2, D2, [{ seq: 1, type: 'under20_move_on', task_id: 'en.words4', at: '2026-10-27T05:03:00Z', data: { by: 'app' } }]),
      session(S3, D3),
    ] }),
    listBlocksForSessions: async (ids) => ({ ok: true, blocks: ids.map(block) }),
    getSchoolsByIds: async () => ({ ok: true, schools: [{ id: 'sch-1', name: 'School One', region: 'Urban-I' }] }),
    getUserNamesByIds: async () => ({ ok: true, users: [{ id: COACH, name: 'Coach Testwala' }] }),
    getSessionDrawOrigins: async (ids) => {
      calls.draws.push(ids);
      return { ok: true, origins: [
        { sessionId: S1, algo_version: 'ctd-added-on-spot-v1', seed_digest: 'added' },
        { sessionId: S2, algo_version: 'ctd-v1-hmac-sha256-fisher-yates', seed_digest: 'abc' },
      ].filter((x) => ids.includes(x.sessionId)) };
    },
  };
  return {
    calls,
    deps: {
      enabled: async () => true, practiceSwitch: false, dashFilters: dash,
      supabase: { from: () => { throw new Error('no direct reads'); } },
      store, saStore: {}, bank: null, now: () => new Date('2026-10-27T08:00:00Z'), log: () => {}, logError: () => {},
    },
  };
}

describe('saSessions: added vs drawn, and the completion rule stop', () => {
  test('ON: origin added / drawn / null (unreadable draw), the draws read once, no draw id in the answer', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    const by = Object.fromEntries(out.sessions.map((r) => [r.results.session.id, r]));
    expect(by[S1].origin).toBe('added');
    expect(by[S2].origin).toBe('drawn');
    expect(by[S3].origin).toBeNull();
    expect(w.calls.draws).toHaveLength(1);
    expect(w.calls.draws[0].sort()).toEqual([S1, S2, S3].sort());
    expect(JSON.stringify(out)).not.toMatch(/dddddddd-/);
  });

  test('ON: incomplete_move_on and an old under20_move_on are both kept as stops', async () => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world().deps);
    const by = Object.fromEntries(out.sessions.map((r) => [r.results.session.id, r]));
    expect(by[S1].stops).toEqual([{ type: 'incomplete_move_on', taskId: 'ur.letter_names5', at: '2026-10-27T05:02:00Z', by: 'app', data: { by: 'app', section: 'ur', reason: 'time_up', reached: 3, of: 10 } }]);
    expect(by[S2].stops.map((s) => s.type)).toEqual(['under20_move_on']);
  });

  test('OFF: no draw read and no origin', async () => {
    const w = world(false);
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(w.calls.draws).toEqual([]);
    expect(out.sessions.every((r) => !('origin' in r))).toBe(true);
  });
});
