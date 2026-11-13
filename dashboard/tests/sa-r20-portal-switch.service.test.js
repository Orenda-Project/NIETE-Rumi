'use strict';
/**
 * Round 20: the coach page reads sa_r20_auto_end_section (GET /sa/switches → r20AutoEndSection), so End this section shows
 * in RDF auto too. Its own file: the flag reader caches per process, so ON and OFF each get a fresh module registry.
 */
const express = require('express');

function mount(rows) {
  jest.resetModules();
  jest.doMock('../config/supabase', () => ({
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
  const app = express();
  app.use((req, _res, next) => { req.session = { portalUserId: 'coach-1' }; next(); });
  app.use('/', require('../routes/portal-child-test.routes'));
  return app;
}
async function switches(rows) {
  const srv = mount({ portal_child_test_sa: true, ...rows }).listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/switches`);
    return (await r.json()).switches;
  } finally { srv.close(); }
}

describe('GET /sa/switches: r20AutoEndSection', () => {
  test('ON (true, or a list naming the coach)', async () => {
    expect((await switches({ sa_r20_auto_end_section: true })).r20AutoEndSection).toBe(true);
    expect((await switches({ sa_r20_auto_end_section: ['coach-1'] })).r20AutoEndSection).toBe(true);
  });
  test('OFF: no row, or a list without the coach', async () => {
    expect((await switches({})).r20AutoEndSection).toBe(false);
    expect((await switches({ sa_r20_auto_end_section: ['someone-else'] })).r20AutoEndSection).toBe(false);
  });
});
