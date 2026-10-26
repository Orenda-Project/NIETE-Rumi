'use strict';
/**
 * bd-sex15q.13 — the anonymisation codec (SPEC v2 §8, API.md §4 + A13), against a real Postgres carrying the
 * COACHIP schema (tests/coachip/helpers/pg-harness.js).
 *
 *   teacherKey(id)  hex(HMAC-SHA256(COACHIP_TEACHER_KEY_SECRET, 'coachip-teacher|' + id))[0:16]; no secret → not ready
 *   codeFor         assigns the coach's next ordinal on first appearance; a second call returns the same row; never
 *                   reassigned; a teacher who moves to another coach keeps the old code with the old coach and gets a
 *                   new one with the new coach
 *   keyFor          the key for the caller's own code_id; null for another coach's
 *   audit           one append-only row per call
 */
const crypto = require('crypto');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const { createCoachipCodes, teacherKeyFor } = require('../../dashboard/services/coachip-codes.service');

const run = hasPostgres() ? describe : describe.skip;
const C1 = seed.fid('coach', 1);
const C2 = seed.fid('coach', 2);
const T = (n) => seed.fid('teacher', n);

run('coachip codec (Postgres)', () => {
  let pg; let codes;
  beforeAll(async () => { pg = await startPg(); }, 180000);
  afterAll(async () => { if (pg) await pg.close(); });
  beforeEach(async () => {
    await pg.truncate();
    await seed.user(pg.query, { id: C1, role: 'coach' });
    await seed.user(pg.query, { id: C2, role: 'coach' });
    codes = createCoachipCodes({ query: pg.query, secret: seed.SECRET });
  });

  test('teacherKey is the contract HMAC: own secret, label coachip-teacher|, 16 hex', () => {
    const want = crypto.createHmac('sha256', seed.SECRET).update(`coachip-teacher|${T(1)}`).digest('hex').slice(0, 16);
    expect(codes.teacherKey(T(1))).toBe(want);
    expect(teacherKeyFor(seed.SECRET, T(1))).toBe(want);
    expect(codes.teacherKey(T(1))).toMatch(/^[0-9a-f]{16}$/);
    expect(codes.teacherKey(T(2))).not.toBe(codes.teacherKey(T(1)));
  });

  test('no secret, or one under 32 bytes → not ready and no key (never an unkeyed hash)', () => {
    for (const secret of [undefined, '', 'short-secret']) {
      const c = createCoachipCodes({ query: pg.query, secret });
      expect(c.ready()).toBe(false);
      expect(c.teacherKey(T(1))).toBeNull();
    }
    expect(codes.ready()).toBe(true);
  });

  test('codeFor: ordinals on first appearance, a second call returns the same row', async () => {
    const k1 = codes.teacherKey(T(1)); const k2 = codes.teacherKey(T(2));
    const a = await codes.codeFor(C1, k1);
    const b = await codes.codeFor(C1, k2);
    const again = await codes.codeFor(C1, k1);
    expect(a.code).toBe('T-01');
    expect(b.code).toBe('T-02');
    expect(again).toEqual(a);
    expect(a.code_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(a).sort()).toEqual(['code', 'code_id']);
    const { rows } = await pg.query('SELECT count(*)::int AS n FROM coachip_teacher_codes');
    expect(rows[0].n).toBe(2);
  });

  test('codesFor (batch) keeps first-appearance order and re-uses existing rows', async () => {
    const keys = [T(5), T(3), T(4)].map(codes.teacherKey);
    await codes.codeFor(C1, keys[1]);                         // T(3) appears first, alone
    const map = await codes.codesFor(C1, keys);
    expect(map.get(keys[1]).code).toBe('T-01');
    expect(map.get(keys[0]).code).toBe('T-02');
    expect(map.get(keys[2]).code).toBe('T-03');
  });

  test('codeFor calls racing for the same coach all succeed with distinct ordinals', async () => {
    const ks = [T(7), T(8), T(9), T(10)].map(codes.teacherKey);
    const out = await Promise.all(ks.map((k) => codes.codeFor(C1, k)));
    expect(new Set(out.map((c) => c.code)).size).toBe(4);
  });

  test('a teacher held by two coaches has two codes that do not join; moving keeps the old code with the old coach', async () => {
    const k = codes.teacherKey(T(1));
    await codes.codeFor(C2, codes.teacherKey(T(2)));
    const withC1 = await codes.codeFor(C1, k);
    const withC2 = await codes.codeFor(C2, k);               // the teacher now also appears in C2's scope
    expect(withC1.code).toBe('T-01');
    expect(withC2.code).toBe('T-02');
    expect(withC2.code_id).not.toBe(withC1.code_id);
    expect(await codes.codeFor(C1, k)).toEqual(withC1);       // never reassigned with the old coach
  });

  test('keyFor: own code → key; another coach\'s code_id or an invented id → null', async () => {
    const k = codes.teacherKey(T(1));
    const mine = await codes.codeFor(C1, k);
    expect(await codes.keyFor(C1, mine.code_id)).toBe(k);
    expect(await codes.keyFor(C2, mine.code_id)).toBeNull();
    expect(await codes.keyFor(C1, seed.fid('code', 999))).toBeNull();
  });

  test('a bad key is refused before it reaches the table', async () => {
    await expect(codes.codeFor(C1, 'not-a-key')).rejects.toThrow();
    await expect(codes.codeFor(C1, T(1))).rejects.toThrow();   // a users.id is never a key
  });

  test('audit writes one append-only row; the table refuses an update', async () => {
    const subject = seed.fid('moment', 1);
    await codes.audit(C1, 'clip', subject);
    const { rows } = await pg.query('SELECT actor_user_id, action::text, subject_id FROM coachip_audit_log');
    expect(rows).toEqual([{ actor_user_id: C1, action: 'clip', subject_id: subject }]);
    await expect(pg.query("UPDATE coachip_audit_log SET action = 'decode'")).rejects.toThrow(/append-only/);
  });
});
