'use strict';
/**
 * bd-ik5e8j.4 (queue #85) — GET /api/portal/help and POST /api/portal/help/seen (dashboard/routes/portal-help.routes.js).
 * Dark unless BOTH portal_teacher_v2 and portal_help_videos are on for her (404). "seen" is one row in the EXISTING
 * user_feature_first_use (feature 'portal_help'), upserted idempotently. Real Express over HTTP; flags, auth and the
 * database stubbed.
 */
const http = require('http');
const express = require('express');

let flags;
let db;          // { users: {...}, firstUse: Set<"user|feature"> }
let upserts;
let videosAsked;

function supabaseStub() {
  return {
    from(table) {
      const q = { table, filters: {}, payload: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { q.filters[col] = val; return chain; },
        limit() {
          if (table === 'user_feature_first_use') {
            const key = `${q.filters.user_id}|${q.filters.feature}`;
            return Promise.resolve({ data: db.firstUse.has(key) ? [{ id: 'row' }] : [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === 'users') return Promise.resolve({ data: db.users[q.filters.id] || null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        upsert(row, opts) {
          upserts.push({ table, row, opts });
          if (db.failUpsert) return Promise.resolve({ error: { message: 'boom' } });
          db.firstUse.add(`${row.user_id}|${row.feature}`);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  flags = { portal_teacher_v2: true, portal_help_videos: true };
  db = { users: { 'u-1': { role: 'teacher', preferred_language: 'ur' } }, firstUse: new Set(), failUpsert: false };
  upserts = [];
  videosAsked = [];
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async (_s, key) => flags[key] === true }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_HELP_VIDEOS_KEY: 'portal_help_videos',
    isFlagEnabledForUser: async (_s, key) => {
      if (flags[key] instanceof Error) throw flags[key];
      return flags[key] === true;
    },
  }));
});

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start({ videos = [] } = {}, session = { portalUserId: 'u-1' }) {
  const { buildRouter } = require('../../dashboard/routes/portal-help.routes');
  const router = buildRouter({ helpVideos: { videosFor: async (who) => { videosAsked.push(who); return videos; } } });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use('/api/portal', router);
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const call = (method, path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, agent: false,
    headers: { 'Content-Type': 'application/json' } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on('error', reject);
  req.end(method === 'POST' ? '{}' : undefined);
});

test('switch off: both routes are 404 and nothing is read or written', async () => {
  flags.portal_help_videos = false;
  await start();
  expect((await call('GET', '/api/portal/help')).status).toBe(404);
  expect((await call('POST', '/api/portal/help/seen')).status).toBe(404);
  expect(upserts).toEqual([]);
  expect(videosAsked).toEqual([]);
});

test('teacher app off: 404 even with the help switch on', async () => {
  flags.portal_teacher_v2 = false;
  await start();
  expect((await call('GET', '/api/portal/help')).status).toBe(404);
});

test('a failed flag read is OFF (fail-closed)', async () => {
  flags.portal_help_videos = new Error('db down');
  await start();
  expect((await call('GET', '/api/portal/help')).status).toBe(404);
});

test('signed out: 401', async () => {
  await start({}, {});
  expect((await call('GET', '/api/portal/help')).status).toBe(401);
});

test('no videos yet: an empty list, not seen', async () => {
  await start({ videos: [] });
  const r = await call('GET', '/api/portal/help');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ success: true, seen: false, videos: [] });
  expect(videosAsked).toEqual([{ role: 'teacher', lang: 'ur' }]);
});

test('the page language wins over the stored one; the role is hers', async () => {
  db.users['u-1'] = { role: 'principal', preferred_language: 'ur' };
  await start();
  await call('GET', '/api/portal/help?lang=en');
  expect(videosAsked).toEqual([{ role: 'principal', lang: 'en' }]);
});

test('seen: one upsert on (user_id, feature) that ignores a second, then GET says seen', async () => {
  await start();
  const a = await call('POST', '/api/portal/help/seen');
  const b = await call('POST', '/api/portal/help/seen');
  expect(a.body).toEqual({ success: true, seen: true });
  expect(b.body).toEqual({ success: true, seen: true });
  expect(upserts.map((u) => u.row)).toEqual([
    { user_id: 'u-1', feature: 'portal_help' }, { user_id: 'u-1', feature: 'portal_help' },
  ]);
  expect(upserts[0].table).toBe('user_feature_first_use');
  expect(upserts[0].opts).toEqual({ onConflict: 'user_id,feature', ignoreDuplicates: true });
  expect(db.firstUse.size).toBe(1);
  expect((await call('GET', '/api/portal/help')).body.seen).toBe(true);
});

test('seen is always the session user, and a failed write says so (500)', async () => {
  db.failUpsert = true;
  await start({}, { portalUserId: 'u-1' });
  const r = await call('POST', '/api/portal/help/seen');
  expect(r.status).toBe(500);
  expect(r.body.success).toBe(false);
});
