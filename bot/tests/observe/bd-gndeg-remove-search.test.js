/**
 * bd-gndeg — the remove path gets a search, mirroring the add path.
 *
 * Removing a school offered only a dropdown of the coach's whole list. Fine at
 * 7–15 schools (the current median is 7, the largest 15), awkward as lists grow
 * — and inconsistent with adding, which has searched by name or EMIS since
 * bd-88krt. The operator asked for parity.
 *
 * Shape forced by Meta, not chosen: a screen holds ONE Footer, and routing is a
 * DAG. So the search cannot live ON the removal screen (its Footer is already
 * "Continue → remove"), and a screen cannot route to itself to re-filter. It
 * therefore sits BEFORE the picker — SEARCH → picker → done — exactly like
 * ADD_SEARCH → ADD_RESULTS. The term is optional, so leaving it blank still
 * lists everything and nobody with a short list is forced to type.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const MINE = [
  { school_ext_id: 'niete:610', school_name: 'IMSG (I-X) Sangjani', emis: '610' },
  { school_ext_id: 'niete:611', school_name: 'IMSG (I-X) Jhangi Syedan', emis: '611' },
  { school_ext_id: 'niete:650', school_name: 'IMSG (I-V) Sheikhpur Noon', emis: '650' },
];

const load = () => {
  jest.resetModules();
  jest.doMock('../../shared/services/observe/observe-school-admin.service', () => {
    const real = jest.requireActual('../../shared/services/observe/observe-school-admin.service');
    return { ...real, listMySchools: async () => MINE };
  }, { virtual: true });
  jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
    listPendingDebriefs: async () => [], listUnsentReports: async () => [],
  }), { virtual: true });
  return require('../../shared/handlers/observe-visit-flow.handler');
};

describe('bd-gndeg · searching my own schools before removing one', () => {
  it('opens a search screen rather than dropping straight into the full list', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'ADD_SEARCH', { step: 'manage_search' }, 'c1', null);
    expect(r.screen).toBe('REMOVE_SEARCH');
  });

  it('a term narrows the list to matches by name', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'REMOVE_SEARCH', { step: 'manage', term: 'jhangi' }, 'c1', null);
    expect(r.screen).toBe('MANAGE_SCHOOLS');
    expect(r.data.options.map((o) => o.id)).toEqual(['niete:611']);
  });

  it('a term matches on EMIS too — the code is what a coach has to hand', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'REMOVE_SEARCH', { step: 'manage', term: '650' }, 'c1', null);
    expect(r.data.options.map((o) => o.id)).toEqual(['niete:650']);
  });

  it('a blank term still lists everything — a short list needs no typing', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'REMOVE_SEARCH', { step: 'manage', term: '' }, 'c1', null);
    expect(r.data.options).toHaveLength(3);
  });

  it('no match says so instead of showing an empty picker', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'REMOVE_SEARCH', { step: 'manage', term: 'zzzz' }, 'c1', null);
    expect(r.data.options).toHaveLength(1);
    expect(r.data.options[0].id).toBe('none');
  });

  it('every option carries all four keys the screen declares', async () => {
    const H = load();
    const r = await H.handle('c1', 'data_exchange', 'REMOVE_SEARCH', { step: 'manage' }, 'c1', null);
    for (const o of r.data.options) {
      expect(Object.keys(o).sort()).toEqual(['description', 'id', 'metadata', 'title']);
    }
  });
});

describe('bd-gndeg · the Flow still obeys what Meta enforces', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  it('the search screen exists and is routed to the picker', () => {
    expect(byId.REMOVE_SEARCH).toBeTruthy();
    expect(flow.routing_model.REMOVE_SEARCH).toContain('MANAGE_SCHOOLS');
  });

  it('routing is still a DAG — a self-route to re-filter would fail publish', () => {
    const seen = {};
    const walk = (n, stack) => {
      if (stack.includes(n)) throw new Error(`cycle: ${stack.join(' -> ')} -> ${n}`);
      if (seen[n]) return;
      seen[n] = 1;
      for (const next of flow.routing_model[n] || []) walk(next, [...stack, n]);
    };
    expect(() => Object.keys(flow.routing_model).forEach((n) => walk(n, []))).not.toThrow();
  });

  it('one Footer per screen', () => {
    for (const s of flow.screens) {
      const out = [];
      (function w(ch) { for (const c of ch || []) { out.push(c); w(c.children); } })(s.layout.children);
      expect(out.filter((c) => c.type === 'Footer').length).toBeLessThanOrEqual(1);
    }
  });

  it('the add screen now points at the search, not the raw list', () => {
    const link = byId.ADD_SEARCH.layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(link['on-click-action'].payload.step).toBe('manage_search');
  });
});
