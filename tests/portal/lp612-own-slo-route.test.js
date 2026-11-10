'use strict';
/**
 * bd-snkn32.13 — GET /api/portal/lp612/own/slo/:segmentId: does this Grade 9–12 lesson mix Summative and Formative
 * SLOs? The Make my own form asks "which first?" only when it does. Same gate as POST /lp612/own (both flags, 404
 * off). Answered from the map the bot uses (lp612-own-slo), so the form and the instruction agree.
 */
const http = require('http');
const express = require('express');

let flags;
beforeEach(() => {
  jest.resetModules();
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async (_s, key) => flags[key] === true }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_LP_MAKE_OWN_KEY: 'portal_lp_make_own',
    isFlagEnabledForUser: async (_s, key) => flags[key] === true,
  }));
});

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start() {
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: 'u1' }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const get = (seg) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal/lp612/own/slo/${encodeURIComponent(seg)}`, agent: false }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

const real = require('../../bot/shared/data/lp612-fbise-slo-tags.json');
const { sloMix } = require('../../bot/shared/services/lp612-own-slo');
const MIXED = Object.keys(real).find((k) => sloMix(k));
const PLAIN = Object.keys(real).find((k) => !sloMix(k));

test('a mixed segment: its Summative and Formative codes', async () => {
  await start();
  const r = await get(MIXED);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ success: true, mixed: true, ...sloMix(MIXED) });
});

test('a segment that is not mixed, or not in the map: mixed false', async () => {
  await start();
  expect((await get(PLAIN)).body).toEqual({ success: true, mixed: false, summative: [], formative: [] });
  expect((await get('grade_7_science.c01.p001')).body.mixed).toBe(false);
});

test('flag off: 404', async () => {
  flags.portal_lp_make_own = false;
  await start();
  expect((await get(MIXED)).status).toBe(404);
});
