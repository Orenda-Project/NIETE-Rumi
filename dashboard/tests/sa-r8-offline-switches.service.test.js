'use strict';
/**
 * Round 8 (sa-offline-r8): GET /sa/switches carries r8OfflineFirst, r8OfflinePrep and r8FastStart (app_settings
 * sa_r8_offline_first / sa_r8_offline_prep / sa_r8_fast_start: true or a list of user ids; off when absent).
 */
const express = require('express');

// the portal's flag cache (lib/feature-flags.js) would carry one test's row into the next
process.env.FLAG_CACHE_TTL_MS = '0';

const rows = {};
jest.mock('../config/supabase', () => ({
  from: (table) => {
    const q = { _eq: null };
    q.select = () => q;
    q.eq = (_col, val) => { q._eq = val; return q; };
    q.maybeSingle = async () => {
      if (table === 'users') return { data: { id: q._eq, role: 'coach' }, error: null };
      if (table === 'app_settings') return { data: q._eq in rows ? { value: rows[q._eq] } : null, error: null };
      return { data: null, error: null };
    };
    return q;
  },
}));

async function switches() {
  const app = express();
  app.use((req, _res, next) => { req.session = { portalUserId: 'coach-1' }; next(); });
  app.use('/', require('../routes/portal-child-test.routes'));
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/switches`);
    return await r.json();
  } finally { srv.close(); }
}

beforeEach(() => { for (const k of Object.keys(rows)) delete rows[k]; rows.portal_child_test_sa = true; });

const KEYS = { r8OfflineFirst: 'sa_r8_offline_first', r8OfflinePrep: 'sa_r8_offline_prep', r8FastStart: 'sa_r8_fast_start' };

test('each ON on its own: true, or a list naming the coach', async () => {
  for (const [name, key] of Object.entries(KEYS)) {
    for (const k of Object.values(KEYS)) delete rows[k];
    rows[key] = true;
    const on = (await switches()).switches;
    expect(Object.fromEntries(Object.keys(KEYS).map((n) => [n, on[n]]))).toEqual(Object.fromEntries(Object.keys(KEYS).map((n) => [n, n === name])));
    rows[key] = ['coach-1'];
    expect((await switches()).switches[name]).toBe(true);
    rows[key] = ['someone-else'];
    expect((await switches()).switches[name]).toBe(false);
  }
});
test('OFF: no rows → all three false', async () => {
  const on = (await switches()).switches;
  for (const name of Object.keys(KEYS)) expect(on[name]).toBe(false);
});
