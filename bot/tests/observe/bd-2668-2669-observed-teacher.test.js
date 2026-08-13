/**
 * bd-2668 / bd-2669 — name the observed teacher (TDD, red-first).
 *
 * Aleeha (R28) and Riffat (R29), Aug 2026: with two or more pending debriefs a
 * coach cannot tell which teacher each one belongs to — the list shows only a
 * DATE and the focus area.
 *
 * Root cause (live data, 2026-08-13): an observation only records WHO was
 * observed when the coach went through the visit picker. 66 of 85 observations
 * are self-owned; 47 of those were recorded by a coach who HAD the picker
 * available and skipped it, 19 by a coach with no patch at all. Either way the
 * teacher's identity was never captured, so nothing downstream can show it.
 *
 * Fix: when a capture is unbound, ask "who did you observe?" straight after the
 * recording (analysis continues meanwhile — this must never block or restart
 * the capture), and record the answer as an observation_schedules row, which
 * ALREADY carries teacher_name/school_name/school_ext_id and links to the
 * session via session_id. No new table, no new column, and the portal resolver
 * (bd-2670) reads that link already.
 */

// Repo convention (see observe-draft-fico-prefill.test.js): stub the Supabase
// env BEFORE requiring, because shared/config/supabase.js exits the process
// when it is missing.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
// observe-debrief.service pulls in gpt5-mini, which constructs an LLM client at
// import time — it needs a key present, never used here.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  buildWhoPayload, parseWhoId, buildObservationRecord, WHO_PREFIX,
} = require('../../shared/services/observe/observe-who.service');
const { buildPendingListPayload } = require('../../shared/services/observe/observe-debrief.service');

const S = {
  who_body: 'Who did you observe?',
  who_button: 'Pick teacher',
  who_section: 'Your teachers',
  who_other: 'Someone else',
  who_other_desc: 'Not in this list',
  list_body: 'Pending', list_button: 'Open', list_section_title: 'Observations',
  list_new_observation: '🎙 New observation', list_new_observation_desc: 'Start one',
  list_row_default_desc: 'Tap to start the debrief',
  list_send_desc_prefix: 'Send to',
  list_send_default_desc: 'Send the report',
};

const TEACHERS = [
  { teacher_ext_id: 'p1', teacher_name: 'Tahira Manzoor', teacher_phone_e164: '923001111111', school_ext_id: 'niete:509', school_name: 'IMSG Mohra Nagial' },
  { teacher_ext_id: 'p2', teacher_name: 'Touseef Ahmed', teacher_phone_e164: '923002222222', school_ext_id: 'niete:541', school_name: 'IMCB Mughal' },
];

describe('bd-2668 — asking who was observed', () => {
  it('offers one row per teacher plus an escape hatch', () => {
    const p = buildWhoPayload(TEACHERS, S, 'sess-1');
    const rows = p.action.sections[0].rows;
    expect(rows).toHaveLength(TEACHERS.length + 1);
    expect(rows[0].title).toBe('Tahira Manzoor');
    expect(rows[rows.length - 1].id).toBe(`${WHO_PREFIX}sess-1_other`);
  });

  it('carries the session id in every row id, so a late tap still lands on the right observation', () => {
    const p = buildWhoPayload(TEACHERS, S, 'sess-1');
    for (const r of p.action.sections[0].rows) expect(r.id).toContain('sess-1');
  });

  it('respects WhatsApp list limits (24-char title, 72-char description, ≤10 rows)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      teacher_ext_id: `p${i}`,
      teacher_name: `A very long teacher name number ${i} that will not fit`,
      teacher_phone_e164: `92300000${i}`, school_ext_id: 'niete:1', school_name: 'A school with quite a long name indeed',
    }));
    const rows = buildWhoPayload(many, S, 'sess-1').action.sections[0].rows;
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description || '').length).toBeLessThanOrEqual(72);
    }
  });

  it('parses its own row ids and refuses foreign ones', () => {
    expect(parseWhoId(`${WHO_PREFIX}sess-1_0`)).toEqual({ sessionId: 'sess-1', index: 0, other: false });
    expect(parseWhoId(`${WHO_PREFIX}sess-1_other`)).toEqual({ sessionId: 'sess-1', index: null, other: true });
    expect(parseWhoId('observe_pickt_1')).toBeNull();
    expect(parseWhoId('observe_debrief_abc')).toBeNull();
    expect(parseWhoId(null)).toBeNull();
  });

  it('records the answer as a completed observation_schedules row linked to the session', () => {
    const row = buildObservationRecord({
      leaderUserId: 'coach-1', sessionId: 'sess-1', teacher: TEACHERS[0], today: '2026-08-13',
    });
    expect(row).toMatchObject({
      leader_user_id: 'coach-1',
      session_id: 'sess-1',
      teacher_ext_id: 'p1',
      teacher_name: 'Tahira Manzoor',
      school_ext_id: 'niete:509',
      school_name: 'IMSG Mohra Nagial',
      scheduled_for: '2026-08-13',
      status: 'done',
    });
  });

  it('never writes a record without a session to attach it to', () => {
    expect(() => buildObservationRecord({ leaderUserId: 'c', sessionId: null, teacher: TEACHERS[0], today: '2026-08-13' })).toThrow();
    expect(() => buildObservationRecord({ leaderUserId: 'c', sessionId: 's', teacher: null, today: '2026-08-13' })).toThrow();
  });
});

describe('bd-2669 — the pending-debrief list names the teacher', () => {
  const pendings = [
    { id: 'c1', created_at: '2026-08-12T09:00:00Z', analysis_data: null, teacher_name: 'Tahira Manzoor', school_name: 'IMSG Mohra Nagial' },
    { id: 'c2', created_at: '2026-08-11T09:00:00Z', analysis_data: null },   // unknown — legacy row
  ];

  it('puts the teacher name in the row title', () => {
    const rows = buildPendingListPayload(pendings, S).action.sections[0].rows;
    expect(rows[0].title).toContain('Tahira Manzoor');
  });

  it('keeps the date and adds the school in the description', () => {
    const rows = buildPendingListPayload(pendings, S).action.sections[0].rows;
    expect(rows[0].description).toMatch(/IMSG Mohra Nagial/);
    expect(rows[0].description).toMatch(/12/);
  });

  it('still renders a legacy row with no teacher (falls back to the date)', () => {
    const rows = buildPendingListPayload(pendings, S).action.sections[0].rows;
    expect(rows[1].title).toBeTruthy();
    expect(rows[1].title).not.toMatch(/undefined|null/);
    expect(rows[1].description).not.toMatch(/undefined|null/);
  });

  it('respects the 24/72 caps with a long name and school', () => {
    const long = [{
      id: 'c3', created_at: '2026-08-12T09:00:00Z', analysis_data: null,
      teacher_name: 'Muhammad Abdul Rehman Khan Niazi The Third',
      school_name: 'Islamabad Model School For Girls (I-V) Mohra Nagial Sector G-11/4',
    }];
    const r = buildPendingListPayload(long, S).action.sections[0].rows[0];
    expect(r.title.length).toBeLessThanOrEqual(24);
    expect(r.description.length).toBeLessThanOrEqual(72);
  });
});
