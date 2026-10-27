'use strict';
/**
 * bd-sex15q.19 (fix-r5, red-2 181122, SPEC v2.1 §11.6): assertClean on the wire. One res.json wrapper inside the COACHIP
 * router walks every body for the keys API.md §1 forbids and for the three URL patterns, and answers 500
 * {"error":"server_error"} with a log line naming the route and the key only. The real router runs; only the handlers,
 * the flag readers, the scope and the codec are stubbed (no Postgres needed). The read tests over the fixture world
 * (coachip-*-read.test.js) are the false-positive check: they run through the same wrapper.
 */
const path = require('path');
const http = require('http');

const express = require(path.join(__dirname, '..', '..', 'dashboard', 'node_modules', 'express'));
const { createCoachipRouter } = require('../../dashboard/routes/portal-coachip.routes');

const COACH = '00000000-0000-4000-8000-0700000000c1';
const SCHOOL = '00000000-0000-4000-8000-0100000000a1';

let planted;
const handlers = {
  home: async () => ({ status: 200, body: planted }),
  teacherName: async () => ({ status: 200, body: planted }),
  rmCircle: async () => ({ status: 200, body: planted }),
};
const deps = {
  query: async () => ({ rows: [{ id: COACH, role: 'coach', preferred_language: 'en' }] }),
  flags: { coachOn: async () => true, rmSector: async () => 'Urban-I', decodeOn: async () => true },
  scope: {
    coachScope: async () => ({ schoolIds: [SCHOOL], schoolCount: 1, teacherCount: 1, teacherSchool: new Map() }),
    rmScope: async () => ({ sector: 'Urban-I', schoolIds: [SCHOOL], coachUserIds: [COACH] }),
  },
  codes: { ready: () => true },
  handlers,
};

let srv; let logs; let errSpy;
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { req.session = { portalUserId: COACH }; next(); });
  app.use('/api/portal', createCoachipRouter(deps));
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
});
afterAll(() => new Promise((r) => srv.close(r)));
beforeEach(() => {
  logs = [];
  errSpy = jest.spyOn(console, 'error').mockImplementation((...a) => { logs.push(a.join(' ')); });
});
afterEach(() => errSpy.mockRestore());

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const get = (p) => call('GET', `/api/portal${p}`);

describe('assertClean on the wire: a forbidden key or URL in any COACHIP body → 500 server_error', () => {
  test('a stubbed handler plants a teacher_key deep in the payload → 500, and the log names the route and the key only', async () => {
    planted = { ws: [{ w_id: 'W-IP', schools: [{ codes: [{ code: 'T-01', teacher_key: '0123456789abcdef' }] }] }] };
    const res = await get('/coachip/home');
    expect(res.status).toBe(500);
    expect(res.text).toBe('{"error":"server_error"}');
    const line = logs.find((l) => /assertClean/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain('/coachip/home');
    expect(line).toContain('teacher_key');
    expect(line).not.toContain('0123456789abcdef');
    expect(line).not.toContain('T-01');
  });

  test.each([
    ['phone', { coach: { phone: '929999991101' } }],
    ['phone_number', { coach: { phone_number: '929999991101' } }],
    ['user_id', { rows: [{ user_id: COACH }] }],
    ['teacher_id', { teacher_id: COACH }],
    ['name', { coach: { name: 'Fixture Coach 01' } }],
    ['first_name', { coach: { first_name: 'Fixture' } }],
    ['rationale', { moment: { rationale: 'a grader string' } }],
  ])('the key %s → 500', async (key, body) => {
    planted = body;
    const res = await get('/coachip/home');
    expect([key, res.status, res.text]).toEqual([key, 500, '{"error":"server_error"}']);
    expect(logs.find((l) => /assertClean/.test(l))).toContain(key);
  });

  test.each([
    ['a presigned URL', { audio: 'https://bucket.example/obj.mp3?X-Amz-Signature=abc' }],
    ['the bucket host', { key: 'rumi-sandbox.r2.cloudflarestorage.com/coachip/clips/a.mp3' }],
    ['any http URL in a string value', { materials: [{ title: 'see http://example.org' }] }],
  ])('%s in a string value → 500', async (_n, body) => {
    planted = body;
    const res = await get('/coachip/rm/circle');
    expect(res.status).toBe(500);
    expect(res.text).toBe('{"error":"server_error"}');
    const line = logs.find((l) => /assertClean/.test(l));
    expect(line).toContain('/coachip/rm/circle');
    expect(line).not.toMatch(/X-Amz-Signature=abc|example\.org|cloudflarestorage\.com\/coachip/);
  });

  test('the allowed names pass: school_name, coach_label, short_name*, title', async () => {
    planted = { school: { school_id: SCHOOL, school_name: 'Govt. Primary School Fictional-01' }, coach_label: 'C-01',
      short_name: { en: 'Practice', ur: 'مشق' }, short_name_ur: 'مشق', title: { en: 'Five step lesson', ur: 'پانچ قدم' }, coach_user_id: COACH };
    const res = await get('/coachip/home');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual(planted);
  });

  test('the decode answer (API §9.3) may carry the teacher name it exists to give; any other forbidden key still fails', async () => {
    planted = { code: 'T-01', name: 'Fictional Teacher' };
    const ok = await call('POST', '/api/portal/coachip/teacher-name', { code_id: '00000000-0000-4000-8000-0f00000000a1' });
    expect(ok.status).toBe(200);
    planted = { code: 'T-01', name: 'Fictional Teacher', teacher_key: '0123456789abcdef' };
    const bad = await call('POST', '/api/portal/coachip/teacher-name', { code_id: '00000000-0000-4000-8000-0f00000000a1' });
    expect(bad.status).toBe(500);
  });
});
