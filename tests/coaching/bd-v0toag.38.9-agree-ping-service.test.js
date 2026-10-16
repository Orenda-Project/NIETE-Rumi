'use strict';
/**
 * v10 coaching test (bd-v0toag.38.9): the "Do you agree?" coach ping, replacing #2295's one-tap ping.
 *   · template coach_visit_request_v2: carries the score, her reasons and a link to the coach card;
 *   · migration V1.6.9: reasons + a voice-note key on coach_visit_requests, and a 'visited' status;
 *   · the service: her coach (picked for her when the school has one), her reasons and note stored, the ping
 *     with v2, falling back to the approved v1 so a coach is never left unpinged while v2 waits for Meta.
 */
const fs = require('fs');
const path = require('path');

const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
const R = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const C1 = '9d1f0a3b-1111-4c2d-8e9f-0a1b2c3d4e5f';
const C2 = '9d1f0a3b-2222-4c2d-8e9f-0a1b2c3d4e5f';
const ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example' };
});
afterAll(() => { process.env = ENV; });

describe('template coach_visit_request_v2', () => {
  const { TEMPLATE_V2, EXAMPLES_V2 } = require('../../bot/shared/templates/coach-visit-request.template');
  test('en_US and ur, six parameters, never at the start or end', () => {
    expect(TEMPLATE_V2.name).toBe('coach_visit_request_v2');
    expect(Object.keys(TEMPLATE_V2.bodies).sort()).toEqual(['en_US', 'ur']);
    for (const [lang, body] of Object.entries(TEMPLATE_V2.bodies)) {
      expect([...new Set(body.match(/\{\{\d\}\}/g))].sort()).toEqual(['{{1}}', '{{2}}', '{{3}}', '{{4}}', '{{5}}', '{{6}}']);
      expect(body.trim()).not.toMatch(/^\{\{|\}\}$/);
      expect(EXAMPLES_V2[lang]).toHaveLength(6);
    }
    expect(TEMPLATE_V2.bodies.en_US).toMatch(/does not agree/);
  });
  test('the registrar submits v2 by default as UTILITY', () => {
    const { payloads } = require('../../bot/scripts/register-coach-visit-request-template');
    expect(payloads().map((p) => [p.name, p.language, p.category])).toEqual(
      Object.keys(TEMPLATE_V2.bodies).map((l) => ['coach_visit_request_v2', l, 'UTILITY']),
    );
  });
});

describe('migration V1.6.9 coach_visit_requests reasons', () => {
  const ROOT = path.join(__dirname, '..', '..', 'infrastructure', 'supabase');
  const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  test('adds reasons and the voice-note key, allows visited; additive and re-runnable', () => {
    const up = code('migrations/V1.6.9__coach_visit_reasons.sql');
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS reasons\s+TEXT\[\]/);
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS voice_note_key\s+TEXT/);
    expect(up).toMatch(/'pending', 'sent', 'failed', 'no_coach', 'visited'/);
    expect(up).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE |TRUNCATE/i);
  });
  test('rollback removes them; the schema mirror has them', () => {
    const down = code('migrations/ROLLBACK_V1.6.9__coach_visit_reasons.sql');
    expect(down).toMatch(/DROP COLUMN IF EXISTS reasons/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS voice_note_key/);
    const mirror = code('00_complete-schema.sql');
    expect(mirror).toMatch(/reasons\s+TEXT\[\]/);
    expect(mirror).toMatch(/'no_coach', 'visited'/);
  });
});

describe('reasons', () => {
  const { REASONS, cleanReasons, reasonText } = require('../../dashboard/services/coach-ping-reasons');
  test('the four reasons from the design, in both languages', () => {
    expect(Object.keys(REASONS)).toEqual(['score', 'missed', 'wont_work', 'unclear']);
    expect(REASONS.score.en).toBe('My score doesn’t seem right');
    expect(REASONS.missed.ur).toBe('میں نے یہ کیا تھا، رپورٹ نے نہیں پکڑا');
  });
  test('only known codes, once each, in the design order', () => {
    expect(cleanReasons(['unclear', 'bogus', 'score', 'score'])).toEqual(['score', 'unclear']);
    expect(cleanReasons('missed')).toEqual(['missed']);
    expect(cleanReasons(undefined)).toEqual([]);
  });
  test('joined for the coach in their language, one line', () => {
    expect(reasonText(['score', 'missed'], 'en')).toBe('My score doesn’t seem right; I did this, but the report missed it');
    expect(reasonText([], 'en')).toBe('a voice note');
  });
});

describe('coach card link', () => {
  const t = () => require('../../dashboard/services/coach-card-token');
  test('signs a request id and reads it back; a tampered or foreign token is bad', () => {
    const tok = t().signCoachCard(R);
    expect(t().verifyCoachCard(tok)).toEqual({ ok: true, requestId: R });
    expect(t().verifyCoachCard(`${tok}x`).ok).toBe(false);
    const report = require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: S, userId: U });
    expect(t().verifyCoachCard(report).ok).toBe(false);
    expect(t().coachCardUrl(R)).toBe(`https://portal.example/cv/${tok}`);
  });
});

/** A fake supabase: rows per table, eq/in filters, inserts/updates recorded; insert().select().single() returns an id. */
function supa(tables, { conflict = false } = {}) {
  const ops = [];
  const from = (t) => {
    const filters = [];
    const rows = () => (tables[t] || []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
    const done = (res) => ({ select: () => ({ single: async () => res }), then: (ok, bad) => Promise.resolve(res).then(ok, bad) });
    const c = {
      select: () => c,
      eq: (k, v) => { filters.push([k, v]); return c; },
      in: (k, v) => { filters.push([k, v]); return c; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      update: (p) => { ops.push([t, 'update', p]); return c; },
      insert: (r) => {
        ops.push([t, 'insert', r]);
        return done(conflict ? { data: null, error: { code: '23505' } } : { data: { id: R }, error: null });
      },
      then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return c;
  };
  return { from, ops };
}
const WORLD = {
  coaching_sessions: [{ id: S, user_id: U, analysis_data: { scores: { overall_percentage: 64 } } }],
  users: [
    { id: U, name: 'Sadia Bibi', school_id: 'sch1' },
    { id: C1, name: 'Sana Iqbal', phone_number: '923001112223', preferred_language: 'en' },
    { id: C2, name: 'Bilal Ahmed', phone_number: '923004445556', preferred_language: 'ur' },
  ],
  leader_schools: [{ leader_user_id: C1, school_id: 'sch1', school_name: 'IMSG I-8/1' }],
};
const TWO = { ...WORLD, leader_schools: [...WORLD.leader_schools, { leader_user_id: C2, school_id: 'sch1', school_name: 'IMSG I-8/1' }] };

describe('requestVisit', () => {
  const svc = () => require('../../dashboard/services/coach-visit-request');
  const ok = async () => ({ ok: true, messageId: 'wamid.2' });

  test('one coach at her school: picked for her; reasons stored; v2 carries score, reasons and the card link', async () => {
    const db = supa(WORLD);
    const sent = [];
    const out = await svc().requestVisit(db, { sessionId: S, userId: U, group: 'C', reasons: ['score', 'missed'] },
      { send: async (m) => { sent.push(m); return ok(); } });
    expect(out).toEqual({ status: 'sent' });
    expect(db.ops[0]).toEqual(['coach_visit_requests', 'insert', expect.objectContaining({
      coaching_session_id: S, coach_user_id: C1, ab_group: 'C', status: 'pending', reasons: ['score', 'missed'],
    })]);
    const link = require('../../dashboard/services/coach-card-token').coachCardUrl(R);
    expect(sent).toEqual([{ to: '923001112223', language: 'en_US', template: 'coach_visit_request_v2', params: [
      'Sana', 'Sadia Bibi', 'IMSG I-8/1', '64%', 'My score doesn’t seem right; I did this, but the report missed it', link,
    ] }]);
    expect(db.ops.at(-1)).toEqual(['coach_visit_requests', 'update', expect.objectContaining({ status: 'sent', wa_message_id: 'wamid.2' })]);
  });

  test('her voice note goes to storage under the request and its key is stored', async () => {
    const db = supa(WORLD);
    const put = jest.fn(async () => 'https://r2/x');
    const note = { buffer: Buffer.from('ogg'), type: 'audio/webm' };
    await svc().requestVisit(db, { sessionId: S, userId: U, group: 'D', reasons: [], note }, { send: ok, put });
    expect(put).toHaveBeenCalledWith(note.buffer, `coach-visit-notes/${R}.webm`, 'audio/webm');
    expect(db.ops).toContainEqual(['coach_visit_requests', 'update', { voice_note_key: `coach-visit-notes/${R}.webm` }]);
  });

  test('two coaches: she must pick one; the one she picked gets it in Urdu', async () => {
    const send = jest.fn(ok);
    expect(await svc().requestVisit(supa(TWO), { sessionId: S, userId: U, group: 'C', reasons: ['score'] }, { send })).toEqual({ status: 'invalid' });
    expect(send).not.toHaveBeenCalled();
    await svc().requestVisit(supa(TWO), { sessionId: S, userId: U, group: 'C', reasons: ['score'], coachId: C2 }, { send });
    expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({ to: '923004445556', language: 'ur' }));
    expect(send.mock.calls[0][0].params[4]).toBe('میرا اسکور درست نہیں لگتا');
  });

  test('v2 not approved yet: the approved v1 still reaches the coach', async () => {
    const db = supa(WORLD);
    const send = jest.fn(async (m) => (m.template === 'coach_visit_request_v1' ? { ok: true, messageId: 'wamid.1' } : { ok: false }));
    expect(await svc().requestVisit(db, { sessionId: S, userId: U, group: 'C', reasons: ['unclear'] }, { send })).toEqual({ status: 'sent' });
    expect(send.mock.calls[1][0]).toEqual(expect.objectContaining({ template: 'coach_visit_request_v1', params: ['Sana', 'Sadia Bibi', 'IMSG I-8/1'] }));
  });

  test('both refused: failed; no coach at her school: no_coach with her reasons kept', async () => {
    expect(await svc().requestVisit(supa(WORLD), { sessionId: S, userId: U, group: 'C', reasons: ['score'] }, { send: async () => ({ ok: false }) }))
      .toEqual({ status: 'failed' });
    const db = supa({ ...WORLD, leader_schools: [] });
    expect(await svc().requestVisit(db, { sessionId: S, userId: U, group: 'C', reasons: ['score'] }, { send: jest.fn() })).toEqual({ status: 'no_coach' });
    expect(db.ops[0][2]).toEqual(expect.objectContaining({ coach_user_id: null, status: 'no_coach', reasons: ['score'] }));
  });

  test('a second send on the same report: already, nobody pinged, nothing uploaded', async () => {
    const send = jest.fn();
    const put = jest.fn();
    const note = { buffer: Buffer.from('x'), type: 'audio/mp4' };
    expect(await svc().requestVisit(supa(WORLD, { conflict: true }), { sessionId: S, userId: U, group: 'C', reasons: ['score'], note }, { send, put }))
      .toEqual({ status: 'already' });
    expect(send).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test('group A, or not her report: invalid; a database error: failed', async () => {
    expect(await svc().requestVisit(supa(WORLD), { sessionId: S, userId: U, group: 'A', reasons: ['score'] }, { send: jest.fn() })).toEqual({ status: 'invalid' });
    expect(await svc().requestVisit(supa({ ...WORLD, coaching_sessions: [] }), { sessionId: S, userId: U, group: 'C', reasons: ['score'] }, { send: jest.fn() }))
      .toEqual({ status: 'invalid' });
    expect(await svc().requestVisit({ from: () => { throw new Error('down'); } }, { sessionId: S, userId: U, group: 'C', reasons: ['score'] }, { send: jest.fn() }))
      .toEqual({ status: 'failed' });
  });
});

describe('the coach card behind the link', () => {
  const svc = () => require('../../dashboard/services/coach-visit-request');
  const ROW = { id: R, coaching_session_id: S, teacher_user_id: U, coach_user_id: C1, school_id: 'sch1', status: 'sent',
    reasons: ['score'], voice_note_key: `coach-visit-notes/${R}.webm` };
  const world = (row = ROW) => ({ ...WORLD, coach_visit_requests: [row] });

  test('loadCard: teacher, school, her reasons, the report view and a short-lived link to her note', async () => {
    const presign = jest.fn(async () => 'https://r2/signed');
    const loadReport = jest.fn(async () => ({ session: { id: S, analysis_data: {} }, language: 'en', trend: [] }));
    const card = await svc().loadCard(supa(world()), R, { presign, loadReport });
    expect(card).toEqual(expect.objectContaining({ teacher: 'Sadia Bibi', school: 'IMSG I-8/1', language: 'en', status: 'sent',
      reasons: ['score'], noteUrl: 'https://r2/signed' }));
    expect(card.view).toBeTruthy();
    expect(presign).toHaveBeenCalledWith(ROW.voice_note_key, 3600);
    expect(loadReport).toHaveBeenCalledWith(expect.anything(), S, U);
    expect(await svc().loadCard(supa({ ...WORLD, coach_visit_requests: [] }), R, { presign, loadReport })).toBeNull();
  });

  test('markVisited: the note is deleted, the row reads visited with no key', async () => {
    const db = supa(world());
    const del = jest.fn(async () => true);
    expect(await svc().markVisited(db, R, { del })).toBe(true);
    expect(del).toHaveBeenCalledWith(ROW.voice_note_key);
    expect(db.ops).toContainEqual(['coach_visit_requests', 'update', expect.objectContaining({ status: 'visited', voice_note_key: null })]);
    expect(await svc().markVisited({ from: () => { throw new Error('down'); } }, R, { del })).toBe(false);
  });
});
