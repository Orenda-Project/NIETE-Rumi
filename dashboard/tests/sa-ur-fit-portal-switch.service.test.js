'use strict';
/**
 * sa_ur_fit on the portal: GET /sa/switches tells the coach's Learning assessment pages whether to fit their Urdu
 * (portal/src/portal/lib/assess/urFit.ts). The same app_settings row as the child's screens (sa-battery-switches.js).
 */
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
    return { status: r.status, body: await r.json() };
  } finally { srv.close(); }
}

beforeEach(() => { for (const k of Object.keys(rows)) delete rows[k]; rows.portal_child_test_sa = true; });

test('ON: sa_ur_fit true → switches.urFit true', async () => {
  rows.sa_ur_fit = true;
  const r = await switches();
  expect(r.status).toBe(200);
  expect(r.body.switches.urFit).toBe(true);
});

test('OFF: no sa_ur_fit row → switches.urFit false', async () => {
  const r = await switches();
  expect(r.status).toBe(200);
  expect(r.body.switches.urFit).toBe(false);
});
