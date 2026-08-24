/**
 * bd-tju8f T2.1 — stage A exists and is visible.
 *
 * 80 of 212 pending debriefs (37%) were menu-invisible on 2026-08-24 because
 * both list queries required status='observer_review_complete'. listUnfinished
 * makes the pre-form backlog queryable with a per-status resume kind, and
 * buildPendingListPayload renders three labelled stage sections inside the
 * WhatsApp 10-row cap.
 */

const SESSIONS = [
  { id: 's-gate', status: 'awaiting_lesson_plan', debrief_status: 'pending',
    created_at: '2026-08-21T05:08:00Z', updated_at: '2026-08-21T05:10:00Z', analysis_data: {} },
  { id: 's-form', status: 'awaiting_observer_review', debrief_status: 'pending',
    created_at: '2026-08-20T04:55:00Z', updated_at: '2026-08-20T04:56:00Z', analysis_data: {} },
  { id: 's-fail', status: 'failed', debrief_status: 'pending',
    created_at: '2026-07-23T08:05:00Z', updated_at: '2026-07-23T08:06:00Z', analysis_data: {} },
];

// Minimal chainable supabase stub: coaching_sessions returns mockSessions,
// observation_schedules returns nothing (name join degrades gracefully).
const mockSessions = SESSIONS;
jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const rows = table === 'coaching_sessions' ? mockSessions : [];
    const b = {
      select: () => b, eq: () => b, in: () => b, order: () => b, not: () => b,
      range: () => Promise.resolve({ data: rows, error: null }),
      limit: () => Promise.resolve({ data: rows, error: null }),
      single: () => Promise.resolve({ data: rows[0] || null, error: null }),
      then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return b;
  },
}));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
}));

const Debrief = require('../../shared/services/observe/observe-debrief.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');
const S = observeStrings('ur');

test('listUnfinished returns gate-parked, form-unsubmitted and failed rows with resume kinds', async () => {
  const list = await Debrief.listUnfinished('coach-1');
  expect(list.map((r) => r.resume).sort()).toEqual(['form', 'gate', 'retry']);
});

test('resumeKindFor maps every status family, and a silent 30-min "analyzing" counts as stuck', () => {
  const now = Date.parse('2026-08-24T10:00:00Z');
  expect(Debrief.resumeKindFor('awaiting_photo', '2026-08-24T09:00:00Z', now)).toBe('gate');
  expect(Debrief.resumeKindFor('awaiting_lesson_plan', '2026-08-24T09:00:00Z', now)).toBe('gate');
  expect(Debrief.resumeKindFor('awaiting_observer_review', '2026-08-24T09:00:00Z', now)).toBe('form');
  expect(Debrief.resumeKindFor('failed', '2026-08-24T09:00:00Z', now)).toBe('retry');
  expect(Debrief.resumeKindFor('analyzing', '2026-08-24T09:58:00Z', now)).toBe('wait');
  expect(Debrief.resumeKindFor('analyzing', '2026-08-24T09:00:00Z', now)).toBe('retry');
});

test('the payload renders labelled stage sections and the new-observation section', () => {
  expect(typeof S.section_stage_a).toBe('string');   // strings must actually exist
  const unfinished = [{ id: 's-gate', resume: 'gate', created_at: '2026-08-21T05:08:00Z', analysis_data: {} }];
  const payload = Debrief.buildPendingListPayload([], S, [], unfinished);
  const titles = payload.action.sections.map((x) => x.title);
  expect(titles[0]).toBe(S.section_stage_a.slice(0, 24));
  const first = payload.action.sections[0].rows[0];
  expect(first.id).toBe('observe_resume_s-gate');
  expect([...first.title].length).toBeLessThanOrEqual(25); // 24 + emoji-pair slack
});

test('total rows across all sections never exceed the WhatsApp 10-row cap', () => {
  const mk = (p) => Array.from({ length: 9 }, (_, i) => ({
    id: `${p}${i}`, resume: 'form', created_at: '2026-08-21T05:08:00Z', analysis_data: {},
  }));
  const payload = Debrief.buildPendingListPayload(mk('p'), S, mk('u'), mk('f'));
  const total = payload.action.sections.reduce((n, x) => n + x.rows.length, 0);
  expect(total).toBeLessThanOrEqual(10);
});

test('legacy shape still works: no unfinished arg behaves like today (debriefs + sends + new)', () => {
  const pendings = [{ id: 'p1', created_at: '2026-08-21T05:08:00Z', analysis_data: {} }];
  const payload = Debrief.buildPendingListPayload(pendings, S, []);
  const ids = payload.action.sections.flatMap((x) => x.rows).map((r) => r.id);
  expect(ids).toContain('observe_debrief_p1');
  expect(ids).toContain('observe_new');
});
