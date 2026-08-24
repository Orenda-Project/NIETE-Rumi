/**
 * bd-tju8f T1.2 — explicit audio→observation binding.
 *
 * The park is a small FIFO (never a silent overwrite — a coach recording two
 * classes before answering the question must lose NEITHER), the list leads
 * with today's scheduled visits, a tap binds and consumes through the normal
 * capture, a double-tap creates exactly one session (SETNX), and an identical
 * re-sent recording (same sha, ≤24h) is answered as a dupe instead of running
 * a second pipeline (Sumaya + Naveera both re-sent on 24 Aug).
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const s = new Map();
  return {
    __store: s,
    get: jest.fn(async (k) => (s.has(k) ? JSON.parse(s.get(k)) : null)),
    setexWithCeiling: jest.fn(async (k, ttl, v) => { s.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
    setNX: jest.fn(async (k, v) => { if (s.has(k)) return false; s.set(k, JSON.stringify(v)); return true; }),
    delete: jest.fn(async (k) => s.delete(k)),
  };
});
const store = require('../../shared/services/cache/railway-redis.service').__store;

jest.mock('../../shared/services/whatsapp.service', () => ({
  __lists: [], __msgs: [],
  sendInteractiveMessage: jest.fn(async function (to, p) { module.exports = module.exports; return true; }),
  sendMessage: jest.fn(async () => true),
}));
const WA = require('../../shared/services/whatsapp.service');
WA.sendInteractiveMessage.mockImplementation(async (to, p) => { WA.__lists.push(p); return true; });
WA.sendMessage.mockImplementation(async (to, m) => { WA.__msgs.push(m); return true; });
const sentLists = WA.__lists;
const sentMsgs = WA.__msgs;
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  listUpcoming: jest.fn(async () => ([
    { id: 'v1', teacher_ext_id: 't-9', school_ext_id: 'sch-273', teacher_name: 'Ayesha Khan',
      school_name: 'IMS G-10/2', scheduled_for: '2026-08-24', scheduled_slot: 'morning' },
  ])),
}));
jest.mock('../../shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn(async () => ({ id: 'sess-new' })),
}));
const { startFromAudio } = require('../../shared/services/observe/observe-capture.service');
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'chat-1') }));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async () => true),
  getState: jest.fn(async () => null),
  clearState: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(async () => ({
    user_id: 'u-9', teacher_ext_id: 't-9', teacher_name: 'Ayesha Khan', phone_e164: '92300xxxxxxx',
  })),
}));
jest.mock('../../shared/handlers/observe-command.handler', () => ({
  sendVisitRedirect: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => []),
  buildPendingListPayload: jest.fn(() => ({ body: 'x', action: { button: 'y', sections: [] } })),
  startDebriefFromAudio: jest.fn(async () => true),
}));

const Binding = require('../../shared/services/observe/observe-binding.service');
const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'ur' };
const FROM = '923260000001';

beforeEach(() => {
  store.clear(); sentLists.length = 0; sentMsgs.length = 0; jest.clearAllMocks();
  WA.sendInteractiveMessage.mockImplementation(async (to, p) => { WA.__lists.push(p); return true; });
  WA.sendMessage.mockImplementation(async (to, m) => { WA.__msgs.push(m); return true; });
  startFromAudio.mockImplementation(async () => ({ id: 'sess-new' }));
  require('../../shared/services/observe/observe-schedule.service').listUpcoming.mockImplementation(async () => ([
    { id: 'v1', teacher_ext_id: 't-9', school_ext_id: 'sch-273', teacher_name: 'Ayesha Khan',
      school_name: 'IMS G-10/2', scheduled_for: '2026-08-24', scheduled_slot: 'morning' },
  ]));
  require('../../shared/services/observe/observe-debrief.service').listPendingDebriefs.mockImplementation(async () => []);
  require('../../shared/services/observe/observe-debrief.service').buildPendingListPayload.mockImplementation(
    () => ({ body: 'x', action: { button: 'y', sections: [] } }));
});

test('parkAndAsk parks the audio and the list leads with the scheduled visit', async () => {
  const r = await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  expect(r.action).toBe('asked');
  expect(store.has('observe:parked:coach-1')).toBe(true);
  const rows = sentLists[0].action.sections.flatMap((s) => s.rows);
  expect(rows[0].id).toBe('observe_bind_visit_v1');
  expect(rows.map((x) => x.id)).toContain('observe_bind_other');
  expect(rows.map((x) => x.id)).toContain('observe_bind_not_obs');
});

test('a second recording parked before answering QUEUES — it never overwrites the first', async () => {
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a2', sha256: 'sha-B', durationSeconds: 1100 });
  const q = JSON.parse(store.get('observe:parked:coach-1'));
  expect(q.map((e) => e.audioId)).toEqual(['a1', 'a2']);
});

test('at the FIFO cap the coach is told to answer first — nothing is dropped silently', async () => {
  for (const [id, sha] of [['a1', 's1'], ['a2', 's2'], ['a3', 's3']]) {
    await Binding.parkAndAsk(COACH, FROM, { audioId: id, sha256: sha, durationSeconds: 1000 });
  }
  const r = await Binding.parkAndAsk(COACH, FROM, { audioId: 'a4', sha256: 's4', durationSeconds: 1000 });
  expect(r.action).toBe('park_full');
  expect(JSON.parse(store.get('observe:parked:coach-1')).length).toBe(3);
});

test('a visit tap binds, consumes the OLDEST parked audio through capture, and pops it', async () => {
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  await Binding.handleBindingTap('observe_bind_visit_v1', FROM, COACH);
  expect(startFromAudio).toHaveBeenCalledWith(COACH, FROM, 'a1', 'chat-1', 1200);
  expect(store.has('observe:parked:coach-1')).toBe(false);
  const ObserveState = require('../../shared/services/observe/observe-state.service');
  const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
  expect(armed[2].boundTeacher.teacher_ext_id).toBe('t-9');
});

test('a double tap creates exactly ONE session (SETNX bind lock)', async () => {
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  await Binding.handleBindingTap('observe_bind_visit_v1', FROM, COACH);
  await Binding.handleBindingTap('observe_bind_visit_v1', FROM, COACH);
  expect(startFromAudio).toHaveBeenCalledTimes(1);
});

test('an identical re-sent recording (same sha, ≤24h) is a dupe — no second park, no second list', async () => {
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  await Binding.handleBindingTap('observe_bind_visit_v1', FROM, COACH);
  const r = await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1-resent', sha256: 'sha-A', durationSeconds: 1200 });
  expect(r.action).toBe('dupe');
  expect(sentLists.length).toBe(1);
});

test('"not an observation" clears the parked entry and continues chat', async () => {
  await Binding.parkAndAsk(COACH, FROM, { audioId: 'a1', sha256: 'sha-A', durationSeconds: 1200 });
  await Binding.handleBindingTap('observe_bind_not_obs', FROM, COACH);
  expect(store.has('observe:parked:coach-1')).toBe(false);
  expect(startFromAudio).not.toHaveBeenCalled();
});
