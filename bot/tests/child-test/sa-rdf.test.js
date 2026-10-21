'use strict';

/**
 * The RDF short form on the server (app_settings sa_rdf_form, default OFF): ON, a present child may take block 'rdf'
 * and the battery is the form's rdf[] list; OFF, 'rdf' is refused as any unknown block; a form with no rdf[] answers
 * not_ready (409) rdf_unavailable.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');
const bank = require('../../shared/data/child-test/item-bank.sa.v1.json');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID = 'sess-now';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world({ on, heldBlock = null, noRdf = false } = {}) {
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-now', visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: {} };
  const calls = { setClient: [], markSynced: [] };
  const store = {
    getSession: async () => ({ ok: true, session }),
    getDraw: async () => ({ ok: true, draw: { id: 'd-now', cycle_id: 'ICT-2026-Q4', school_id: SCHOOL, student_id: 'st-1', status: 'tested' } }),
    getSessionByDraw: async () => ({ ok: true, session }),
    listSessionsForVisit: async () => ({ ok: true, sessions: [session] }),
    createSession: async () => ({ ok: true, session, created: true }),
    recordTiming: async () => ({ ok: true }),
  };
  const saStore = {
    findByClient: async () => ({ ok: true, sessionId: null }),
    setClient: async (id, v) => { calls.setClient.push(v); return { ok: true }; },
    summary: async () => ({ ok: true, block: heldBlock }),
    markSynced: async (id, v) => { calls.markSynced.push(v); return { ok: true, device: { block: v.block } }; },
  };
  const formsOf = noRdf ? Object.fromEntries(Object.entries(bank.forms).map(([k, f]) => { const { rdf: _r, ...rest } = f; return [k, rest]; })) : bank.forms;
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store, saStore, draw: { markOutcome: async () => ({ ok: true, list: null }) },
    bank: { ...bank, forms: formsOf },
    now: () => new Date('2026-10-21T05:00:00Z'),
    log: () => {}, logError: () => {},
    blockByHistory: false,
    ...(on === undefined ? {} : { rdfForm: on }),
  };
  return { deps, calls };
}

const present = (deps, block) => sa.dayOutcome({
  userId: COACH, schoolId: SCHOOL, drawId: 'd-now', outcome: 'present', clientSessionId: '11111111-2222-4333-8444-555555555555', block,
}, deps);

describe('RDF on the server', () => {
  test('switch OFF: block rdf is refused like any unknown block', async () => {
    const { deps, calls } = world({ on: false });
    expect(await present(deps, 'rdf')).toEqual({ status: 'invalid', reason: 'bad_block' });
    expect(calls.setClient).toEqual([]);
  });

  test('switch ON: a present child takes rdf, kept on the session', async () => {
    const { deps, calls } = world({ on: true });
    const out = await present(deps, 'rdf');
    expect(out.status).toBe('ok');
    expect(calls.setClient[0]).toEqual({ clientSessionId: '11111111-2222-4333-8444-555555555555', block: 'rdf' });
  });

  test('switch ON: the battery of a session held on rdf is the form\'s rdf[] list, named RDF', async () => {
    const { deps } = world({ on: true, heldBlock: 'rdf' });
    const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
    expect(out.status).toBe('ok');
    const f = bank.forms['coach.G3.A'];
    expect(out.battery.block).toBe('rdf');
    expect(out.battery.blockName).toEqual({ en: 'RDF', ur: 'آر ڈی ایف' });
    expect(out.battery.forms['coach.G3.A'].order).toEqual(f.rdf);
    expect(Object.keys(out.battery.tasks)).toEqual(f.rdf.map((t) => `coach.G3.A/${t}`));
  });

  test('a form with no rdf[] answers not_ready rdf_unavailable (HTTP 409)', async () => {
    const { deps } = world({ on: true, heldBlock: 'rdf', noRdf: true });
    expect(await sa.saBattery({ userId: COACH, sessionId: SID }, deps)).toEqual({ status: 'not_ready', reason: 'rdf_unavailable', error: 'rdf_unavailable' });
  });

  test('the five blocks and the full battery are as before with the switch either way', async () => {
    for (const on of [true, false]) {
      const { deps } = world({ on, heldBlock: 'full' });
      const out = await sa.saBattery({ userId: COACH, sessionId: SID }, deps);
      expect([on, out.battery.block, out.battery.forms['coach.G3.A'].order]).toEqual([on, 'full', bank.forms['coach.G3.A'].full]);
    }
  });
});
