'use strict';
/**
 * bd-sex15q.13 — the COACHIP route contract (contracts/API.md §1, §14; contracts/routes.json, copied to
 * tests/coachip/fixtures/routes.json), every row, through the real router, real flag readers, real scope and codec
 * services, against a throwaway Postgres. What every route must do whatever its handler does:
 *
 *   signed out → 401 (the house body) · a teacher session → 404 (R1: 200, all null) · no app_settings rows → 404
 *   (R1: 200, all null; B8) · Cache-Control: private, no-store on every answer · a malformed id → 400 · a coach-only
 *   user on an RM route and an RM-only user on a coach route → 404 · a POST with one extra key, a non-JSON body or a
 *   body over 4 kB → 400 · an invented id → 404 with the byte-identical body (B3) · no codec secret → coach routes 503.
 */
const fs = require('fs');
const path = require('path');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const { startApp } = require('./helpers/app');

const run = hasPostgres() ? describe : describe.skip;
const ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'routes.json'), 'utf8'));
const PREFIX = ROUTES.prefix;
const { fid } = seed;

const COACH = fid('coach', 1);        // portal_coachip on; holds S1
const COACH_OFF = fid('coach', 2);    // a coach with no switch
const RM = fid('rm', 1);              // portal_coachip_rm {RM: Urban-I}
const TEACHER = fid('teacher', 1);    // role teacher at S1
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday, 11:00 PKT
const TODAY = '2026-10-26';
const INVENTED = '00000000-0000-4000-8000-ff0000000001';

/** Fill a routes.json path with valid placeholders (ids that exist nowhere). */
function fill(p, over = {}) {
  const v = { wId: 'W-IP-TIME', momentId: INVENTED, sessionId: INVENTED, stepId: INVENTED, noteId: INVENTED,
    coachUserId: INVENTED, weekStart: '2026-10-19', schoolId: INVENTED, ...over };
  return PREFIX + p.replace(/\{(\w+)\}/g, (_m, k) => v[k]);
}
function fillBody(body, over = {}) {
  if (!body) return undefined;
  const v = { codeId: INVENTED, schoolId: INVENTED, wId: 'W-IP-TIME', iId: 'I-IP-TIME-1', coachUserId: INVENTED, dueOn: TODAY, stepId: INVENTED, ...over };
  return JSON.parse(JSON.stringify(body).replace(/"\{(\w+)\}"/g, (_m, k) => JSON.stringify(v[k])));
}
/** The caller who reaches a route's handler: an RM for rm routes, else the coach. */
const callerFor = (r) => (r.kind === 'rm' ? RM : COACH);
const notMedia = (r) => !r.media;

run('COACHIP route contract over routes.json (Postgres)', () => {
  let pg; let app;

  beforeAll(async () => {
    pg = await startPg();
    const q = pg.query;
    await seed.school(q, { id: fid('school', 1), n: 1 });
    await seed.user(q, { id: COACH, role: 'coach' });
    await seed.user(q, { id: COACH_OFF, role: 'coach' });
    await seed.user(q, { id: RM, role: 'coach' });
    await seed.user(q, { id: TEACHER, role: 'teacher', schoolId: fid('school', 1) });
    await seed.holds(q, { coachId: COACH, schoolId: fid('school', 1) });
    await seed.holds(q, { coachId: COACH_OFF, schoolId: fid('school', 1) });
    app = await startApp(pg, { now: NOW });
  }, 180000);
  afterAll(async () => { if (app) await app.close(); if (pg) await pg.close(); });

  const flagsOn = async () => {
    await seed.setting(pg.query, 'portal_coachip', [COACH]);
    await seed.setting(pg.query, 'portal_coachip_rm', { [RM]: 'Urban-I' });
  };
  const flagsOff = () => pg.query("DELETE FROM app_settings WHERE key LIKE 'portal_coachip%'");

  test('routes.json is the contract the router serves: 21 rows, R1..R21', () => {
    expect(ROUTES.routes.map((r) => r.id)).toEqual(Array.from({ length: 21 }, (_, i) => `R${i + 1}`));
  });

  describe('switched off (no app_settings rows)', () => {
    beforeAll(flagsOff);

    test.each(ROUTES.routes.map((r) => [r.id, r]))('%s signed out → 401 with the house body, private', async (_id, r) => {
      const res = await app.call(r.method, fill(r.path), { body: fillBody(r.body) });
      expect(res.status).toBe(401);
      expect(res.body).toEqual(ROUTES.bodies['401']);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    test.each(ROUTES.routes.map((r) => [r.id, r]))('%s as a teacher → routes.json teacher_session', async (_id, r) => {
      const res = await app.call(r.method, fill(r.path), { as: TEACHER, body: fillBody(r.body) });
      expect(r.teacher_session).toContain(res.status);
      if (r.id === 'R1') expect(res.body).toMatchObject(r.flag_off_body);
      else expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    test.each(ROUTES.routes.map((r) => [r.id, r]))('%s as a coach with no rows → routes.json flag_off (B8)', async (_id, r) => {
      for (const who of [COACH, RM]) {
        const res = await app.call(r.method, fill(r.path), { as: who, body: fillBody(r.body) });
        expect(r.flag_off).toContain(res.status);
        if (r.id === 'R1') {
          expect(res.body).toMatchObject(r.flag_off_body);
          expect(Object.keys(res.body).sort()).toEqual(['coach', 'computed_at', 'decode', 'lang', 'rm']);
        } else {
          expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
        }
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
    });

    test('an unknown /coachip path → the same JSON 404 (401 signed out)', async () => {
      expect((await app.call('GET', `${PREFIX}/nothing-here`, { as: COACH })).text).toBe(JSON.stringify(ROUTES.bodies['404']));
      expect((await app.call('GET', `${PREFIX}/nothing-here`)).status).toBe(401);
    });
  });

  describe('switched on', () => {
    beforeAll(flagsOn);
    afterAll(flagsOff);

    test('R1 /me for the coach and for the RM', async () => {
      const c = await app.call('GET', `${PREFIX}/me`, { as: COACH });
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ coach: { schoolCount: 1, teacherCount: 1 }, rm: null, decode: false, lang: 'en' });
      const r = await app.call('GET', `${PREFIX}/me`, { as: RM });
      expect(r.body).toMatchObject({ coach: null, rm: { sector: 'Urban-I', schoolCount: 1, coachCount: 2 }, decode: false });
      expect(JSON.stringify(c.body) + JSON.stringify(r.body)).not.toContain(TEACHER);
    });

    test('R1 /me decode only with the coach switch on too', async () => {
      await seed.setting(pg.query, 'portal_coachip_decode', [COACH, RM]);
      expect((await app.call('GET', `${PREFIX}/me`, { as: COACH })).body.decode).toBe(true);
      expect((await app.call('GET', `${PREFIX}/me`, { as: RM })).body.decode).toBe(false);
      await pg.query("DELETE FROM app_settings WHERE key = 'portal_coachip_decode'");
    });

    const withIds = ROUTES.routes.filter((r) => r.ids.some((k) => /Id$/.test(k) && k !== 'code_id' && k !== 'schoolId' && r.path.includes(`{${k}}`)));
    test.each(withIds.map((r) => [r.id, r]))('%s a malformed path id → 400 bad_request', async (_id, r) => {
      const bad = fill(r.path, { wId: 'w-ip', momentId: 'not-a-uuid', sessionId: '1', stepId: 'x', noteId: 'x', coachUserId: encodeURIComponent("1' OR 1=1") });
      const res = await app.call(r.method, bad, { as: callerFor(r), body: fillBody(r.body) });
      expect(res.status).toBe(400);
      expect(res.text).toBe(JSON.stringify(ROUTES.bodies['400']));
    });

    test('R5 / R9 query grammar → 400: a W id out of grammar, a non-Monday week, a week 8+ weeks back, a non-UUID school', async () => {
      for (const p of ['/moments?w=ip', '/moments?week=2026-10-20', '/moments?week=2026-08-31', '/moments?week=2026-11-02', '/i/W-IP-TIME?school=nope']) {
        const res = await app.call('GET', PREFIX + p, { as: COACH });
        expect([p, res.status]).toEqual([p, 400]);
      }
    });

    const posts = ROUTES.routes.filter((r) => r.method === 'POST');
    test.each(posts.map((r) => [r.id, r]))('%s strict body: one extra key, a missing key, non-JSON, over 4 kB → 400', async (_id, r) => {
      const p = fill(r.path); const as = callerFor(r); const b = fillBody(r.body);
      for (const body of [{ ...b, teacher_key: 'abc' }, { ...b, lines: ['x'] }, Object.fromEntries(Object.entries(b).slice(1))]) {
        const res = await app.call('POST', p, { as, body });
        expect(res.status).toBe(400);
        expect(res.text).toBe(JSON.stringify(ROUTES.bodies['400']));
      }
      expect((await app.call('POST', p, { as, raw: '{"oops', headers: { 'content-type': 'application/json' } })).status).toBe(400);
      expect((await app.call('POST', p, { as, raw: JSON.stringify({ ...b, pad: 'x'.repeat(5000) }) })).status).toBe(400);
      expect((await app.call('POST', p, { as, raw: 'code_id=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(400);
    });

    test.each(ROUTES.routes.filter((r) => r.kind === 'rm').map((r) => [r.id, r]))('%s as a coach-only user → 404', async (_id, r) => {
      const res = await app.call(r.method, fill(r.path), { as: COACH, body: fillBody(r.body) });
      expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
    });
    test.each(ROUTES.routes.filter((r) => r.kind === 'coach').map((r) => [r.id, r]))('%s as an RM-only user → 404', async (_id, r) => {
      const res = await app.call(r.method, fill(r.path), { as: RM, body: fillBody(r.body) });
      expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
    });
    test.each(ROUTES.routes.filter((r) => r.kind !== 'none').map((r) => [r.id, r]))('%s as a coach whose switch is off → 404', async (_id, r) => {
      const res = await app.call(r.method, fill(r.path), { as: COACH_OFF, body: fillBody(r.body) });
      expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
    });

    // B3: an id that exists nowhere answers exactly what another coach's id answers (the handlers' per-route tests prove
    // the "another coach's id" half against seeded rows; this proves no route leaks a different body for "not found").
    const scoped = ROUTES.routes.filter((r) => r.scoped_by && notMedia(r) && r.id !== 'R16');
    test.each(scoped.map((r) => [r.id, r.scoped_by, r]))('%s an invented %s → the byte-identical 404', async (_id, _by, r) => {
      const res = await app.call(r.method, fill(r.path), { as: callerFor(r), body: fillBody(r.body) });
      expect(res.status).toBe(404);
      expect(res.text).toBe(JSON.stringify(ROUTES.bodies['404']));
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    test('media routes without m-player\'s module: behind the chain, 503 with the contract body, never a URL', async () => {
      const clip = await app.call('GET', fill('/m/{momentId}/clip'), { as: COACH });
      expect(clip.status).toBe(503);
      expect(clip.body).toEqual(ROUTES.bodies['503_clip']);
      const audio = await app.call('GET', fill('/session/{sessionId}/audio'), { as: COACH });
      expect(audio.body).toEqual(ROUTES.bodies['503_audio']);
      expect((await app.call('GET', fill('/session/{sessionId}/audio'), { as: RM })).status).toBe(404);   // A4: coach only
      expect((await app.call('GET', `${PREFIX}/m/x/clip`, { as: COACH })).status).toBe(400);
    });
  });

  describe('no codec secret (A13)', () => {
    let bare;
    beforeAll(async () => { await flagsOn(); bare = await startApp(pg, { now: NOW, secret: '' }); });
    afterAll(async () => { await bare.close(); await flagsOff(); });

    test.each(ROUTES.routes.filter((r) => r.kind === 'coach' && notMedia(r)).map((r) => [r.id, r]))('%s → 503 unavailable, never an unkeyed hash', async (_id, r) => {
      const res = await bare.call(r.method, fill(r.path), { as: COACH, body: fillBody(r.body) });
      expect(res.status).toBe(503);
      expect(res.body).toEqual(ROUTES.bodies['503_codec']);
    });
    test('RM routes still answer (an RM payload carries no code); /me says coach null', async () => {
      expect((await bare.call('GET', `${PREFIX}/me`, { as: COACH })).body.coach).toBeNull();
      expect((await bare.call('GET', `${PREFIX}/rm/coach/${INVENTED}`, { as: RM })).status).toBe(404);
    });
  });
});
