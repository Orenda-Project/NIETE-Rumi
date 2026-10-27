'use strict';
/** Round 7b item 14: GET /sa/switches carries `cwpm` (app_settings sa_cwpm: true or a list of user ids; off when absent). */
const express = require('express');

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

test('ON: sa_cwpm true, or a list naming the coach → cwpm true', async () => {
  rows.sa_cwpm = true;
  expect((await switches()).switches.cwpm).toBe(true);
  rows.sa_cwpm = ['coach-1'];
  expect((await switches()).switches.cwpm).toBe(true);
});
test('OFF: no row → cwpm false', async () => {
  expect((await switches()).switches.cwpm).toBe(false);
});
