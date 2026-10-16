'use strict';
/**
 * v10 coaching test (bd-v0toag.45): the parts behind "ask my coach to visit".
 *   · the template coach_visit_request_v1: one definition for the sender and the registrar, en_US + ur, three
 *     parameters (coach, teacher, school), never starting or ending on a parameter (Meta refuses those);
 *   · migration V1.6.7 coach_visit_requests: one row per report (UNIQUE session), additive, with a rollback;
 *   · the service: her school's coaches, one request per report, the ping, the row's status.
 */
const fs = require('fs');
const path = require('path');

const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
const C1 = '9d1f0a3b-1111-4c2d-8e9f-0a1b2c3d4e5f';
const C9 = '9d1f0a3b-9999-4c2d-8e9f-0a1b2c3d4e5f';

describe('template coach_visit_request_v1', () => {
  const { TEMPLATE, EXAMPLES } = require('../../bot/shared/templates/coach-visit-request.template');
  test('en_US and ur, three parameters in order, never at the start or end', () => {
    expect(TEMPLATE.name).toBe('coach_visit_request_v1');
    expect(Object.keys(TEMPLATE.bodies).sort()).toEqual(['en_US', 'ur']);
    for (const [lang, body] of Object.entries(TEMPLATE.bodies)) {
      expect(body.match(/\{\{\d\}\}/g).sort()).toEqual(['{{1}}', '{{2}}', '{{3}}']);
      expect(body.trim()).not.toMatch(/^\{\{|\}\}$/);
      expect(EXAMPLES[lang]).toHaveLength(3);
    }
    expect(TEMPLATE.bodies.en_US).toMatch(/observation visit/);
  });
  test('the registrar submits exactly these bodies as UTILITY', () => {
    const { payloads } = require('../../bot/scripts/register-coach-visit-request-template');
    expect(payloads(TEMPLATE).map((p) => [p.name, p.language, p.category, p.components[0].text])).toEqual(
      Object.entries(TEMPLATE.bodies).map(([l, t]) => ['coach_visit_request_v1', l, 'UTILITY', t]),
    );
  });
});

describe('migration V1.6.7 coach_visit_requests', () => {
  const ROOT = path.join(__dirname, '..', '..', 'infrastructure', 'supabase');
  const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  test('one row per report, C/D only, a status the tracker can count; additive and re-runnable', () => {
    const up = code('migrations/V1.6.7__coach_visit_requests.sql');
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS coach_visit_requests/);
    expect(up).toMatch(/coaching_session_id\s+UUID NOT NULL UNIQUE REFERENCES coaching_sessions \(id\)/);
    expect(up).toMatch(/ab_group\s+TEXT NOT NULL CHECK \(ab_group IN \('C', 'D'\)\)/);
    expect(up).toMatch(/status\s+TEXT NOT NULL CHECK \(status IN \('pending', 'sent', 'failed', 'no_coach'\)\)/);
    expect(up).not.toMatch(/DROP |DELETE FROM|UPDATE |TRUNCATE/i);
  });
  test('rollback drops it; the schema mirror has it', () => {
    expect(code('migrations/ROLLBACK_V1.6.7__coach_visit_requests.sql')).toMatch(/DROP TABLE IF EXISTS coach_visit_requests/);
    expect(code('00_complete-schema.sql')).toMatch(/CREATE TABLE IF NOT EXISTS coach_visit_requests/);
  });
});

/** A fake supabase: rows per table, filters applied for eq/in, inserts and updates recorded. */
function supa(tables, { conflict = false } = {}) {
  const ops = [];
  const from = (t) => {
    const filters = [];
    const rows = () => (tables[t] || []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
    const c = {
      select: () => c,
      eq: (k, v) => { filters.push([k, v]); return c; },
      in: (k, v) => { filters.push([k, v]); return c; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      update: (p) => { ops.push([t, 'update', p]); return c; },
      insert: async (r) => {
        ops.push([t, 'insert', r]);
        return conflict ? { error: { code: '23505', message: 'duplicate' } } : { error: null };
      },
      then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return c;
  };
  return { from, ops };
}
const WORLD = {
  coaching_sessions: [{ id: S, user_id: U }],
  users: [
    { id: U, name: 'Sadia Bibi', school_id: 'sch1', preferred_language: 'en' },
    { id: C1, name: 'Sana Iqbal', phone_number: '923001112223', preferred_language: 'ur' },
  ],
  leader_schools: [{ leader_user_id: C1, school_id: 'sch1', school_name: 'IMSG I-8/1' }],
};

// The send itself (pending → sent/failed, already, no_coach) moved to bd-v0toag.38.9-agree-ping-service.test.js
// when the one-tap ask became "Do you agree?".
describe('service', () => {
  const svc = () => require('../../dashboard/services/coach-visit-request');

  test("her school's coaches, by name, never their phone", async () => {
    expect(await svc().coachesFor(supa(WORLD), U)).toEqual([{ id: C1, name: 'Sana Iqbal' }]);
    expect(await svc().coachesFor(supa({ ...WORLD, leader_schools: [] }), U)).toEqual([]);
  });





  test('a coach not of her school, or not her report: refused, nothing written', async () => {
    const send = jest.fn();
    const db = supa(WORLD);
    expect(await svc().requestVisit(db, { sessionId: S, userId: U, group: 'C', coachId: C9 }, { send })).toEqual({ status: 'invalid' });
    const other = supa({ ...WORLD, coaching_sessions: [] });
    expect(await svc().requestVisit(other, { sessionId: S, userId: U, group: 'C', coachId: C1 }, { send })).toEqual({ status: 'invalid' });
    expect([...db.ops, ...other.ops]).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test('a database error: failed, never throws', async () => {
    const out = await svc().requestVisit({ from: () => { throw new Error('down'); } }, { sessionId: S, userId: U, group: 'C', coachId: C1 }, { send: jest.fn() });
    expect(out).toEqual({ status: 'failed' });
  });
});
