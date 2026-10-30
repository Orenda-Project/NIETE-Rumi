'use strict';
/**
 * bd-tbprit.1 — the disagreements card ships behind its own app_settings row, coach_disagreement_card:
 * off unless set. /api/portal/config carries it as features.coachDisagreements for the SESSION user,
 * false on a failed read; and the portal router mounts the API at /coach/disagreements.
 */
const { COACH_DISAGREEMENT_CARD_KEY } = require('../../dashboard/lib/feature-flags');

let settings;
const inserted = []; // bd-whlsm0: rows the routes insert, as [table, row]
function makeChain(table) {
  let key = null;
  const chain = {
    insert: async (row) => { inserted.push([table, row]); return { data: null, error: null }; },
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => (table === 'app_settings' && Object.prototype.hasOwnProperty.call(settings, key)
      ? { data: { value: settings[key] }, error: null } : { data: null, error: null }),
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function loadRoutes() {
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  return require('../../dashboard/routes/portal.routes');
}

async function getConfig(userId) {
  const routes = loadRoutes();
  const layer = routes.stack.find((l) => l.route && l.route.path === '/config' && l.route.methods.get);
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', headers: {}, get: () => undefined, session: { portalUserId: userId, id: 's' } };
  let payload = null;
  const res = { status() { return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of layer.route.stack.map((s) => s.handle)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally { errors.mockRestore(); }
  return payload;
}

describe('coach_disagreement_card wiring', () => {
  beforeEach(() => { jest.resetModules(); settings = {}; });
  afterEach(() => jest.resetModules());

  test('the key is coach_disagreement_card', () => {
    expect(COACH_DISAGREEMENT_CARD_KEY).toBe('coach_disagreement_card');
  });

  test('no row: features.coachDisagreements is false', async () => {
    expect((await getConfig('coach-1')).features.coachDisagreements).toBe(false);
  });

  test('a pilot list: true for the coach it names, false for another', async () => {
    settings.coach_disagreement_card = ['coach-1'];
    expect((await getConfig('coach-1')).features.coachDisagreements).toBe(true);
    jest.resetModules();
    expect((await getConfig('coach-2')).features.coachDisagreements).toBe(false);
  });

  test('the portal router serves the three disagreements routes', () => {
    const routes = loadRoutes();
    const paths = [];
    const walk = (stack) => stack.forEach((l) => {
      if (l.route) paths.push(`${Object.keys(l.route.methods)[0]} ${l.route.path}`);
      else if (l.handle && l.handle.stack) walk(l.handle.stack);
    });
    walk(routes.stack);
    expect(paths).toEqual(expect.arrayContaining([
      'get /coach/disagreements', 'get /coach/disagreements/:id', 'post /coach/disagreements/:id/visited',
      'post /coach/disagreements/:id/undone', // bd-tbprit.12
      'get /coach/disagreements/:id/clip',
    ]));
  });
});

describe('coach Report an issue wiring (bd-whlsm0)', () => {
  test('the portal router serves POST /coach/feedback and stores the report in coach_feedback for the coach', async () => {
    const routes = loadRoutes();
    let layer = null;
    const walk = (stack) => stack.forEach((l) => {
      if (l.route && l.route.path === '/coach/feedback' && l.route.methods.post) layer = l;
      else if (l.handle && l.handle.stack) walk(l.handle.stack);
    });
    walk(routes.stack);
    expect(layer).not.toBeNull();
    // the last handler stores; the guards before it (coach app v2) are the coach app's own
    const handlers = layer.route.stack.map((x) => x.handle);
    expect(handlers.length).toBeGreaterThan(3);
    let sent = null;
    const res = { status() { return this; }, json(v) { sent = v; return this; }, set() { return this; } };
    inserted.length = 0;
    await handlers[handlers.length - 1]({ coachId: 'coach-1', body: { kind: 'idea', message: ' More tiles ', page: '/portal/coach/more' } }, res);
    expect(sent).toEqual({ success: true });
    expect(inserted).toEqual([['coach_feedback', { user_id: 'coach-1', kind: 'idea', message: 'More tiles', page: '/portal/coach/more' }]]);
  });
});
