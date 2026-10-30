'use strict';
/**
 * bd-sex15q.13 — mount the real COACHIP router on an express app for HTTP tests: the dashboard's own express (4.x,
 * dashboard/node_modules; the root has 5.x), a session stub, the real fail-closed flag readers reading app_settings
 * through a minimal supabase-shaped adapter over the harness's Postgres, and the real scope and codec services.
 */
const http = require('http');
const path = require('path');
const { ROOT } = require('./pg-harness');
const seed = require('./seed');

const express = require(path.join(ROOT, 'dashboard', 'node_modules', 'express'));
const { createCoachipRouter } = require('../../../dashboard/routes/portal-coachip.routes');
const { createCoachipCodes } = require('../../../dashboard/services/coachip-codes.service');
const { createCoachipScope } = require('../../../dashboard/services/coachip-scope.service');
const { isFlagEnabledForUser, rmSectorFor, PORTAL_COACHIP_KEY, PORTAL_COACHIP_DECODE_KEY } = require('../../../dashboard/lib/feature-flags');

// The flag readers cache app_settings for 30 s (1cde063493); these suites switch rows mid-file, so every ask reads.
process.env.FLAG_CACHE_TTL_MS = '0';

/** supabase.from('app_settings').select('value').eq('key', k).maybeSingle() over pg — the only shape the flag readers use. */
function pgSupabase(query) {
  return {
    from(table) {
      if (table !== 'app_settings') throw new Error(`pgSupabase: ${table} not supported`);
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; return chain; },
        async maybeSingle() {
          try {
            const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
            return { data: rows[0] || null, error: null };
          } catch (err) { return { data: null, error: { message: err.message } }; }
        },
      };
      return chain;
    },
  };
}

/**
 * @param {object} pg   the harness
 * @param {object} [o]  { now: Date, secret, mediaRoutes, handlers, flags }
 * @returns {Promise<{ srv, call(method, path, {as, body, raw, headers}) → {status, headers, text, body}, close }>}
 */
async function startApp(pg, o = {}) {
  const now = o.now || new Date('2026-10-26T06:00:00Z');
  const supabase = pgSupabase(pg.query);
  const codes = createCoachipCodes({ query: pg.query, secret: o.secret === undefined ? seed.SECRET : o.secret });
  const scope = createCoachipScope({ query: pg.query, codes, now: () => now });
  const flags = o.flags || {
    coachOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_KEY, uid),
    rmSector: (uid) => rmSectorFor(supabase, uid),
    decodeOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_DECODE_KEY, uid),
  };
  const app = express();
  app.use((req, _res, next) => {
    const as = req.headers['x-test-user'];
    req.session = as ? { portalUserId: as } : {};
    next();
  });
  app.use('/api/portal', createCoachipRouter({
    query: pg.query, pool: pg.pool, flags, scope, codes, now: () => now, mediaRoutes: o.mediaRoutes, handlers: o.handlers,
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  function call(method, p, { as = null, body, raw, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const payload = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : null);
      const h = { ...headers };
      if (as) h['x-test-user'] = as;
      if (payload !== null && !h['content-type']) h['content-type'] = 'application/json';
      if (payload !== null) h['content-length'] = Buffer.byteLength(payload);
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers: h }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = undefined; }
          resolve({ status: res.statusCode, headers: res.headers, text, body: parsed });
        });
      });
      r.on('error', reject);
      if (payload !== null) r.write(payload);
      r.end();
    });
  }
  return { srv, call, codes, scope, close: () => new Promise((r) => srv.close(r)) };
}

module.exports = { startApp, pgSupabase };
