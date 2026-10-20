'use strict';
/**
 * The big flight's sink (/api/internal/sagame/s/*, sa-game/sink.routes.js + sink.js + store-adapter.js; switch
 * sa_game, default OFF). A real http server, fetch, and an in-memory stand-in for the database and R2 — nothing live.
 *
 * Covers: off → 404 before anything; no child → 401; a session and its token; the same session again (idempotent);
 * a batch acked; a bad or foreign token; caps (413) and task ids (400); presign mime/size; register's own-prefix rule;
 * status; and the store's choice of path (child-test tables when their columns exist, else the runs table).
 * Invented ids only.
 */
const http = require('http');
const express = require('express');

const mockOn = jest.fn();
jest.mock('../../shared/services/sa-game/flag', () => ({ on: (...a) => mockOn(...a) }));
const mockWho = jest.fn();
jest.mock('../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockWho(...a) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

// ── an in-memory database: tables, the columns each has, and the CHECKs that matter here ──────────────────────
const mockDb = { tables: {}, columns: {}, checks: {}, calls: [] };
function mockResetDb({ childTest = false, battery = true } = {}) {
  mockDb.tables = { web_quiz_challenge_runs: [], child_test_sessions: [], child_test_draws: [], child_test_sa_events: [], child_test_sa_results: [], students: [{ id: 'stu-1', school_id: 'sch-1', class_id: 'cls-1' }] };
  mockDb.columns = {
    web_quiz_challenge_runs: null, // any column
    child_test_sessions: childTest ? null : ['id', 'draw_id', 'status', 'student_id'],
    child_test_draws: null,
    child_test_sa_events: null,
    child_test_sa_results: null,
    students: null,
  };
  mockDb.checks = {
    web_quiz_challenge_runs: (r) => (battery || r.exercise !== 'battery' ? null : 'web_quiz_challenge_runs_exercise_check'),
  };
  mockDb.calls = [];
}
function mockBuilder(table) {
  const st = { table, op: 'select', cols: null, filters: [], row: null, patch: null, limit: null, single: false, ret: false, onConflict: null, ignore: false };
  const missingCol = (cols) => {
    const have = mockDb.columns[table];
    if (have === undefined) return { code: '42P01', message: `relation "${table}" does not exist` };
    if (!have || !cols) return null;
    const bad = String(cols).split(',').map((c) => c.trim()).find((c) => c && c !== '*' && !have.includes(c));
    return bad ? { code: '42703', message: `column ${table}.${bad} does not exist` } : null;
  };
  const match = (r) => st.filters.every(([k, v, how]) => (how === 'is' ? r[k] === v : (k === 'meta' ? JSON.stringify(r[k]) === v : r[k] === v)));
  const run = () => {
    mockDb.calls.push({ table, op: st.op });
    const rows = mockDb.tables[table];
    if (st.op === 'select') {
      const err = missingCol(st.cols);
      if (err) return { data: null, error: err };
      let out = rows.filter(match);
      if (st.limit != null) out = out.slice(0, st.limit);
      return st.single ? { data: out[0] || null, error: null } : { data: out, error: null };
    }
    if (st.op === 'insert') {
      const list = Array.isArray(st.row) ? st.row : [st.row];
      for (const r of list) {
        const err = missingCol(Object.keys(r).join(','));
        if (err) return { data: null, error: err };
        const chk = mockDb.checks[table] && mockDb.checks[table](r);
        if (chk) return { data: null, error: { code: '23514', message: `new row violates check constraint "${chk}"` } };
        if (rows.some((x) => x.id === r.id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      list.forEach((r) => rows.push(JSON.parse(JSON.stringify(r))));
      return { data: null, error: null };
    }
    if (st.op === 'upsert') {
      const list = Array.isArray(st.row) ? st.row : [st.row];
      const keys = String(st.onConflict).split(',');
      for (const r of list) {
        const at = rows.findIndex((x) => keys.every((k) => x[k] === r[k]));
        if (at < 0) rows.push(JSON.parse(JSON.stringify(r)));
        else if (!st.ignore) rows[at] = { ...rows[at], ...JSON.parse(JSON.stringify(r)) };
      }
      return { data: null, error: null };
    }
    if (st.op === 'update') {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.patch))));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (st.op === 'delete') {
      mockDb.tables[table] = rows.filter((r) => !match(r));
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'unknown op' } };
  };
  const b = {
    select(cols) { if (st.op === 'select') st.cols = cols; else st.ret = true; return b; },
    insert(row) { st.op = 'insert'; st.row = row; return b; },
    upsert(row, o = {}) { st.op = 'upsert'; st.row = row; st.onConflict = o.onConflict; st.ignore = !!o.ignoreDuplicates; return b; },
    update(patch) { st.op = 'update'; st.patch = patch; return b; },
    delete() { st.op = 'delete'; return b; },
    eq(k, v) { st.filters.push([k, v, 'eq']); return b; },
    is(k, v) { st.filters.push([k, v, 'is']); return b; },
    order() { return b; },
    limit(n) { st.limit = n; return b; },
    maybeSingle() { st.single = true; return b; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));

const mockR2 = { getPresignedUploadUrl: jest.fn(), headObject: jest.fn() };
jest.mock('../../shared/storage/r2', () => ({
  getPresignedUploadUrl: (...a) => mockR2.getPresignedUploadUrl(...a),
  headObject: (...a) => mockR2.headObject(...a),
}));

const T = require('../../shared/services/quiz/web-quiz-token');
const { createRouter } = require('../../shared/services/sa-game/routes');
const Store = require('../../shared/services/sa-game/store-adapter');

let server;
let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'test-key';
  process.env.CHILD_TEST_R2_ENV = 'test';
  const app = express();
  app.use('/api/internal/sagame', createRouter());
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/internal/sagame/s`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  mockOn.mockReset().mockResolvedValue(true);
  mockWho.mockReset().mockResolvedValue({ studentId: 'stu-1', grade: '3', lang: 'ur' });
  mockR2.getPresignedUploadUrl.mockReset().mockResolvedValue('https://r2.example/put?sig=1');
  mockR2.headObject.mockReset().mockResolvedValue({ exists: true, sizeBytes: 1000 });
  mockResetDb();
  Store.__reset();
});

const HDR = { 'x-api-key': 'test-key', 'x-wq-device': 'dev-1', 'content-type': 'application/json' };
const post = (path, body) => fetch(base + path, { method: 'POST', headers: HDR, body: JSON.stringify(body) });
const KID = '0123456789abcdef';
const newSession = async (extra = {}) => (await post('/session', { t: 'tok.sig', kid: KID, part: 'urdu', form: 'game.G23', lang: 'ur', ...extra })).json();

describe('the switch and the child', () => {
  test('switch off: 404 {off:true} on every route, nothing read', async () => {
    mockOn.mockResolvedValue(false);
    for (const [p, b] of [['/session', { t: 'x' }], ['/batch', {}], ['/audio/presign', {}], ['/audio/register', {}]]) {
      const r = await post(p, b);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ off: true });
    }
    const g = await fetch(`${base}/status?st=x`, { headers: HDR });
    expect(g.status).toBe(404);
    expect(mockWho).not.toHaveBeenCalled();
    expect(mockDb.calls).toEqual([]);
  });

  test('no internal key: 401', async () => {
    const r = await fetch(`${base}/session`, { method: 'POST', headers: { ...HDR, 'x-api-key': 'nope' }, body: '{}' });
    expect(r.status).toBe(401);
  });

  test('not a child on this phone: 401, nothing stored', async () => {
    mockWho.mockResolvedValue(null);
    const r = await post('/session', { t: 'tok.sig', kid: KID, part: 'urdu', form: 'game.G23' });
    expect(r.status).toBe(401);
    expect(mockWho).toHaveBeenCalledWith('tok.sig', KID, 'dev-1');
    expect(mockDb.tables.web_quiz_challenge_runs).toEqual([]);
  });

  test('a part or form outside the game: 400', async () => {
    expect((await post('/session', { t: 'tok.sig', kid: KID, part: 'science', form: 'game.G23' })).status).toBe(400);
    expect((await post('/session', { t: 'tok.sig', kid: KID, part: 'urdu', form: 'coach.G3' })).status).toBe(400);
  });

  test('a thrown read: 503, never a 500', async () => {
    mockWho.mockRejectedValue(new Error('db down'));
    const r = await post('/session', { t: 'tok.sig', kid: KID, part: 'urdu', form: 'game.G23' });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'unavailable' });
  });
});

describe('session', () => {
  test('a child: a run tagged as the game, and a token that carries no student id', async () => {
    const s = await newSession();
    expect(s.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const p = T.verify(s.st, 'sag');
    expect(p.sid).toBe(s.session_id);
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(11 * 3600);
    expect(JSON.stringify(p)).not.toContain('stu-1');
    const rows = mockDb.tables.web_quiz_challenge_runs;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: s.session_id, student_id: 'stu-1', exercise: 'battery', admin_mode: 'self_run', lang: 'ur', grade: 3, status: 'served' });
    expect(rows[0].meta).toMatchObject({ mode: 'game', part: 'urdu', form: 'game.G23', n: 1 });
  });

  test('the same child, part, form, day and run number: the same session, one row', async () => {
    const a = await newSession();
    const b = await newSession();
    expect(b.session_id).toBe(a.session_id);
    expect(mockDb.tables.web_quiz_challenge_runs).toHaveLength(1);
    const c = await newSession({ n: 2 });
    expect(c.session_id).not.toBe(a.session_id);
    const d = await newSession({ part: 'maths' });
    expect(d.session_id).not.toBe(a.session_id);
    expect(mockDb.tables.web_quiz_challenge_runs).toHaveLength(3);
  });

  test('the runs table refuses exercise "battery" (its CHECK not yet widened): 503, the phone keeps its data', async () => {
    mockResetDb({ battery: false });
    const r = await post('/session', { t: 'tok.sig', kid: KID, part: 'urdu', form: 'game.G23' });
    expect(r.status).toBe(503);
    expect(Store.mode()).toBe('none');
  });
});

describe('batch', () => {
  const batchOf = (s, extra = {}) => ({
    st: s.st, session_id: s.session_id, seq_from: 1, seq_to: 3,
    events: [{ seq: 1, type: 'task_start', task_id: 'ur.letters' }, { seq: 2, type: 'tap', task_id: 'ur.letters', item_id: 'i1', value: { tap: 'ب' } }, { seq: 3, type: 'task_end', task_id: 'ur.letters' }],
    results: [{ task_id: 'ur.letters', attempted: 10, correct: 7 }],
    ...extra,
  });

  test('stored and acked; a resend changes nothing; status reads it back', async () => {
    const s = await newSession();
    const r = await post('/batch', batchOf(s));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, acked_to: 3, ackedTo: 3 });
    const again = await (await post('/batch', batchOf(s))).json();
    expect(again).toEqual({ ok: true, acked_to: 3, ackedTo: 3 });
    const meta = mockDb.tables.web_quiz_challenge_runs[0].meta;
    expect(Object.keys(meta.events)).toEqual(['1', '2', '3']);
    expect(meta.results['ur.letters']).toMatchObject({ attempted: 10, correct: 7, mode: 'game' });
    expect(meta.last_seq).toBe(3);
    const st = await (await fetch(`${base}/status?st=${encodeURIComponent(s.st)}`, { headers: HDR })).json();
    expect(st).toEqual({ status: 'in_progress', tasks_done: ['ur.letters'], last_seq: 3 });
  });

  test('the engine adapter\'s camelCase shapes (seqFrom, seqTo, sessionId): the same batch, ackedTo answered', async () => {
    const s = await newSession();
    const r = await (await post('/batch', { st: s.st, sessionId: s.session_id, seqFrom: 1, seqTo: 2, events: [{ seq: 1, type: 'tap' }, { seq: 2, type: 'tap' }],
      results: [{ task_id: 'ur.letters', legacy_block: 'ur.letters', mode: 'game', stop_reason: 'time_up', scored_on: 'device', answers: [] }] })).json();
    expect(r).toEqual({ ok: true, acked_to: 2, ackedTo: 2 });
    expect(mockDb.tables.web_quiz_challenge_runs[0].meta.results['ur.letters']).toMatchObject({ legacy_block: 'ur.letters', stop_reason: 'time_up', mode: 'game' });
  });

  test('battery_end completes the run', async () => {
    const s = await newSession();
    await post('/batch', batchOf(s, { seq_from: 4, seq_to: 4, events: [{ seq: 4, type: 'battery_end' }], results: [] }));
    const st = await (await fetch(`${base}/status?st=${encodeURIComponent(s.st)}`, { headers: HDR })).json();
    expect(st.status).toBe('completed');
  });

  test('a bad token: 401; a token for another session: 403', async () => {
    const s = await newSession();
    expect((await post('/batch', batchOf(s, { st: 'forged.token' }))).status).toBe(401);
    expect((await post('/batch', batchOf(s, { st: T.sign({ k: 'c', sid: s.session_id, exp: Math.floor(Date.now() / 1000) + 60 }) }))).status).toBe(401);
    const other = await newSession({ n: 2 });
    expect((await post('/batch', batchOf(s, { st: other.st }))).status).toBe(403);
  });

  test('over the caps: 413 (events > 500, results > 50, body > 512 kB)', async () => {
    const s = await newSession();
    const ev = Array.from({ length: 501 }, (_, i) => ({ seq: i + 1, type: 'tap' }));
    expect((await post('/batch', batchOf(s, { events: ev, seq_from: 1, seq_to: 501 }))).status).toBe(413);
    const res = Array.from({ length: 51 }, (_, i) => ({ task_id: `ma.t${i}` }));
    expect((await post('/batch', batchOf(s, { results: res }))).status).toBe(413);
    const big = batchOf(s, { results: [{ task_id: 'ur.story', pad: 'x'.repeat(600 * 1024) }] });
    expect((await post('/batch', big)).status).toBe(413);
  });

  test('a task id outside ma|en|ur: 400; an event without seq: 400', async () => {
    const s = await newSession();
    expect((await post('/batch', batchOf(s, { results: [{ task_id: 'sci.atoms' }] }))).status).toBe(400);
    expect((await post('/batch', batchOf(s, { results: [{ task_id: 'UR.letters' }] }))).status).toBe(400);
    expect((await post('/batch', batchOf(s, { events: [{ type: 'tap' }] }))).status).toBe(400);
  });
});

describe('audio', () => {
  test('presign: the session prefix, no child id in the key; mime and size checked', async () => {
    const s = await newSession();
    const r = await post('/audio/presign', { st: s.st, task_id: 'ur.story', mime: 'audio/webm;codecs=opus', bytes: 200000 });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out).toEqual({ url: 'https://r2.example/put?sig=1', key: `child-test/test/game/${s.session_id}/ur.story.webm` });
    expect(out.key).not.toContain('stu-1');
    expect(mockR2.getPresignedUploadUrl).toHaveBeenCalledWith(out.key, 'audio/webm', 900);
    const item = await (await post('/audio/presign', { st: s.st, task_id: 'en.listening', item_id: 'q2', mime: 'audio/mp4', bytes: 10 })).json();
    expect(item.key).toBe(`child-test/test/game/${s.session_id}/en.listening/q2.m4a`);
    expect((await post('/audio/presign', { st: s.st, task_id: 'ur.story', mime: 'video/mp4', bytes: 10 })).status).toBe(400);
    expect((await post('/audio/presign', { st: s.st, task_id: 'ur.story', mime: 'audio/webm', bytes: 8 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await post('/audio/presign', { st: s.st, task_id: 'ur.story', mime: 'audio/webm', bytes: 0 })).status).toBe(400);
    expect((await post('/audio/presign', { st: 'bad.tok', task_id: 'ur.story', mime: 'audio/webm', bytes: 10 })).status).toBe(401);
  });

  test('per-item recordings (camelCase taskId/itemId/durationMs) are appended, never written over', async () => {
    const s = await newSession();
    const k1 = `child-test/test/game/${s.session_id}/en.listening/q1.webm`;
    const k2 = `child-test/test/game/${s.session_id}/en.listening/q2.webm`;
    for (const [itemId, key] of [['q1', k1], ['q2', k2], ['q1', k1]]) {
      expect((await post('/audio/register', { st: s.st, taskId: 'en.listening', itemId, key, bytes: 10, durationMs: 4000 })).status).toBe(200);
    }
    const meta = mockDb.tables.web_quiz_challenge_runs[0].meta;
    expect(meta.audio_items['en.listening']).toEqual([
      { item_id: 'q1', key: k1, bytes: 10, duration_ms: 4000 },
      { item_id: 'q2', key: k2, bytes: 10, duration_ms: 4000 },
    ]);
    expect(meta.audio).toEqual({});
    const pre = await (await post('/audio/presign', { st: s.st, taskId: 'en.listening', itemId: 'q3', mime: 'audio/ogg', bytes: 5 })).json();
    expect(pre.key).toBe(`child-test/test/game/${s.session_id}/en.listening/q3.ogg`);
  });

  test('register: only a key under this session\'s prefix, and only once it is in R2', async () => {
    const s = await newSession();
    const other = await newSession({ n: 2 });
    const mine = `child-test/test/game/${s.session_id}/ur.story.webm`;
    const r = await post('/audio/register', { st: s.st, task_id: 'ur.story', key: mine, bytes: 1000, duration_ms: 60000 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(mockDb.tables.web_quiz_challenge_runs.find((x) => x.id === s.session_id).meta.audio['ur.story']).toEqual({ key: mine, bytes: 1000, duration_ms: 60000 });
    const theirs = `child-test/test/game/${other.session_id}/ur.story.webm`;
    expect((await post('/audio/register', { st: s.st, task_id: 'ur.story', key: theirs, bytes: 1, duration_ms: 1 })).status).toBe(403);
    expect((await post('/audio/register', { st: s.st, task_id: 'ur.story', key: `${mine}/../x`, bytes: 1, duration_ms: 1 })).status).toBe(403);
    mockR2.headObject.mockResolvedValue({ exists: false });
    expect((await post('/audio/register', { st: s.st, task_id: 'ur.story', key: mine, bytes: 1, duration_ms: 1 })).status).toBe(409);
  });
});

describe('the store path', () => {
  test('child-test columns missing: the runs table is used and said', async () => {
    const s = await newSession();
    expect(Store.mode()).toBe('runs');
    expect(T.verify(s.st, 'sag').m).toBe('r');
    expect(mockDb.tables.child_test_draws).toEqual([]);
  });

  test('child-test columns present: a game draw + a self_run web session, results in the child-test SA tables', async () => {
    mockResetDb({ childTest: true });
    const s = await newSession();
    expect(Store.mode()).toBe('child_test');
    expect(T.verify(s.st, 'sag').m).toBe('c');
    expect(mockDb.tables.web_quiz_challenge_runs).toEqual([]);
    const sess = mockDb.tables.child_test_sessions[0];
    expect(sess).toMatchObject({ id: s.session_id, admin_mode: 'self_run', channel: 'web', selection_method: 'self', student_id: 'stu-1' });
    expect(sess.visit_key).toMatch(/^sa:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/);
    const r = await (await post('/batch', { st: s.st, session_id: s.session_id, seq_from: 1, seq_to: 1, events: [{ seq: 1, type: 'tap', task_id: 'ma.add1' }], results: [{ task_id: 'ma.add1', correct: 3 }] })).json();
    expect(r).toEqual({ ok: true, acked_to: 1, ackedTo: 1 });
    expect(mockDb.tables.child_test_sa_events).toHaveLength(1);
    expect(mockDb.tables.child_test_sa_results[0]).toMatchObject({ session_id: s.session_id, task_id: 'ma.add1', result: { task_id: 'ma.add1', correct: 3, mode: 'game' } });
    // idempotent here too
    expect((await newSession()).session_id).toBe(s.session_id);
    expect(mockDb.tables.child_test_sessions).toHaveLength(1);
  });

  test('child-test path refused by a CHECK at insert: the draw is taken back and the runs table is used', async () => {
    mockResetDb({ childTest: true });
    mockDb.checks.child_test_sessions = () => 'child_test_sessions_grade_check';
    const s = await newSession();
    expect(mockDb.tables.child_test_draws).toEqual([]);
    expect(mockDb.tables.web_quiz_challenge_runs).toHaveLength(1);
    expect(T.verify(s.st, 'sag').m).toBe('r');
    expect(Store.mode()).toBe('runs');
  });
});
