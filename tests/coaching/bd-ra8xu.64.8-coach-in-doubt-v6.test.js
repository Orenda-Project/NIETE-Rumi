'use strict';
/**
 * bd-ra8xu.64.8 (queue #282) — a coach visit the coach switch puts on v6 is FICO17 v6 when in doubt, never V3.
 *
 * The operator, 26 Nov ~12:30: "DC everywhere: v6.2 or whichever one is the latest. Everywhere. All regions." Queue #294
 * found 11 ICT /observe visits since the 14 Nov rollout (the last 26 Nov 08:45) stamped V3: the observed teacher spans
 * bands (or has no level, or no teacher was bound) and no class was named, so decideVisitFramework returned no stamp and
 * the deployment default OBSERVE_FRAMEWORK=fico (V3) scored the visit. Now:
 *   - FDE / FICO-S (ICT grades 6-12) are decided first, at the class question, exactly as before (untouched here);
 *   - every other visit the coach switch says v6 for is fico17_v6: a mixed-band, grades 6-8 only, no-level or unbound
 *     teacher, and a failed read, in ICT as in GB;
 *   - the switch itself (fico_coach_rubric for a non-coach), the readiness flag and a non-FICO deployment still decide
 *     "no stamp", as before: those are the levers, not a fallback.
 * The real chain is run: the switches -> decideVisitFramework -> the capture's coaching_sessions stamp.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));
const mockState = { value: null };
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(() => Promise.resolve(true)),
  getState: jest.fn(() => Promise.resolve(mockState.value)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/bound-teacher', () => ({
  resolveBoundTeacherUserId: jest.fn((b) => Promise.resolve((b && b.user_id) || null)),
}));
jest.mock('../../bot/shared/services/observe/observe2/capture-link', () => ({ linkRecording: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueTranscription: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({ markDone: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-who.service', () => ({ maybeAskObservedTeacher: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  createLessonForm: jest.fn((row) => Promise.resolve({ ok: true, form: { id: 'form-9', observer_user_id: row.observerUserId, rubric_version: row.rubricVersion, visit_context: row.visitContext, coaching_session_id: row.sessionId } })),
}));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => {
    if (mockRegistryFail) return Promise.reject(new Error('registry down'));
    return Promise.resolve(({ sihala: 'niete', 'urban-i': 'niete', 'gilgit-baltistan': 'moawin' })[String(region || '').trim().toLowerCase()] || null);
  }),
}));

let mockRegistryFail = false;
let mockSettings = {};
let mockTables = {};
let mockFail = {};
const mockWrites = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _t: table, _f: [], _keys: null };
    const match = () => (mockTables[table] || []).filter((r) => q._f.every(([c, v]) => String(r[c]) === String(v)));
    q.select = () => q;
    q.eq = (col, v) => { if (table === 'app_settings' && col === 'key') q._keys = [v]; else q._f.push([col, v]); return q; };
    q.in = (col, v) => { if (col === 'key') q._keys = v; return q; };
    q.insert = (row) => { mockWrites.push(['insert', table, row]); q._row = row; return q; };
    q.update = (patch) => { mockWrites.push(['update', table, patch]); q._upd = true; return q; };
    q.single = () => Promise.resolve({ data: { id: 'sess-1', framework: null, ...(q._row || {}) }, error: null });
    q.maybeSingle = async () => {
      if (mockFail[table]) return { data: null, error: { message: `${table} read failed` } };
      return { data: match()[0] || null, error: null };
    };
    q.then = (res, rej) => {
      if (table === 'app_settings') {
        const rows = (q._keys || []).filter((k) => mockSettings[k] !== undefined).map((k) => ({ key: k, value: mockSettings[k] }));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      }
      if (q._upd || q._row) return Promise.resolve({ data: null, error: null }).then(res, rej);
      if (mockFail[table]) return Promise.resolve({ data: null, error: { message: `${table} read failed` } }).then(res, rej);
      return Promise.resolve({ data: match(), error: null }).then(res, rej);
    };
    return q;
  },
}));

const FicoSwitch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const Obs612Switch = require('../../bot/shared/services/coaching/obs612-switch');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');

// People (prod-shaped): an ICT coach, an ICT principal not named by the coach switch, ICT teachers of every band shape.
const ICT_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const ICT_PRINCIPAL_OFF = 'bbbbbbbb-0000-4000-8000-0000000000b9';
const ICT_SCHOOL = 'dddddddd-0000-4000-8000-000000000001';
const T_MIXED = 'cccccccc-0000-4000-8000-0000000000a1'; // PRIMARY + MIDDLE (queue #294's 11 visits)
const T_MIDHIGH = 'cccccccc-0000-4000-8000-0000000000a2';
const T_MIDDLE = 'cccccccc-0000-4000-8000-0000000000a3';
const T_NO_LEVEL = 'cccccccc-0000-4000-8000-0000000000a4';
const T_PRIMARY = 'cccccccc-0000-4000-8000-0000000000a5';
const users = () => [
  { id: ICT_COACH, role: 'coach', region: 'Urban-I', source: 'direct', school_id: null },
  { id: ICT_PRINCIPAL_OFF, role: 'principal', region: 'Sihala', source: 'direct', school_id: ICT_SCHOOL },
  { id: T_MIXED, role: 'teacher', region: 'Urban-I', school_id: ICT_SCHOOL, teacher_level: ['PRIMARY', 'MIDDLE'] },
  { id: T_MIDHIGH, role: 'teacher', region: 'Urban-I', school_id: ICT_SCHOOL, teacher_level: ['MIDDLE', 'HIGH'] },
  { id: T_MIDDLE, role: 'teacher', region: 'Urban-I', school_id: ICT_SCHOOL, teacher_level: ['MIDDLE'] },
  { id: T_NO_LEVEL, role: 'teacher', region: 'Urban-I', school_id: ICT_SCHOOL, teacher_level: null },
  { id: T_PRIMARY, role: 'teacher', region: 'Urban-I', school_id: ICT_SCHOOL, teacher_level: ['PRIMARY'] },
];
const row = (id) => users().find((u) => u.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  FicoSwitch._resetCache();
  Obs612Switch._resetCache();
  mockRegistryFail = false;
  mockFail = {};
  mockWrites.length = 0;
  // Prod-shaped: coaches are always v6 (queue #191); principals by role key; this one principal is named off.
  mockSettings = {
    fico_coach_rubric: JSON.stringify({ 'role:principal': 'v6', [`user:${ICT_PRINCIPAL_OFF}`]: 'current' }),
    obs612_coach: JSON.stringify({ [`user:${ICT_COACH}`]: 'on', 'role:principal': 'on' }),
  };
  mockTables = {
    users: users(),
    schools: [{ id: ICT_SCHOOL, region: 'Urban-I', is_probable_test: false }],
    leader_schools: [{ leader_user_id: ICT_COACH, school_ext_id: 'niete:100', school_id: ICT_SCHOOL }],
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
  process.env.OBS612_FLOW_ID = 'F-FDE';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; delete process.env.OBS612_FLOW_ID; });

const O6 = () => require('../../bot/shared/services/observe/observe-fico17-v6');

describe('decideVisitFramework: in doubt is FICO17 v6, in ICT too', () => {
  test.each([
    ['a PRIMARY + MIDDLE teacher (queue #294)', T_MIXED],
    ['a MIDDLE + HIGH teacher', T_MIDHIGH],
    ['a grades 6-8 only teacher with no class named', T_MIDDLE],
    ['a teacher with no level', T_NO_LEVEL],
    ['an unbound capture (no teacher)', null],
    ['a teacher id with no users row', 'cccccccc-0000-4000-8000-00000000ffff'],
  ])('%s → fico17_v6', async (_label, teacherUserId) => {
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId })).resolves.toBe('fico17_v6');
  });

  test('a failed teacher read is v6 too, never V3', async () => {
    mockFail.users = true;
    // The coach role is passed by the switch's own reader; with users unreadable the coach row read fails as well, so
    // name the coach on the switch the way prod names test coaches.
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${ICT_COACH}`]: 'v6' });
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_MIXED })).resolves.toBe('fico17_v6');
  });

  test('a grades 1-5 teacher is v6, as before', async () => {
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_PRIMARY })).resolves.toBe('fico17_v6');
  });

  test('the levers still decide: a principal the switch names off, the readiness flag unset, a non-FICO deployment', async () => {
    await expect(O6().decideVisitFramework({ userId: ICT_PRINCIPAL_OFF, region: 'Sihala', teacherUserId: T_MIXED })).resolves.toBeNull();
    delete process.env.OBSERVE_FICO17_V6_READY;
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_MIXED })).resolves.toBeNull();
    process.env.OBSERVE_FICO17_V6_READY = 'true';
    process.env.OBSERVE_FRAMEWORK = 'hots';
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_MIXED })).resolves.toBeNull();
    process.env.OBSERVE_FRAMEWORK = 'fico';
  });
});

describe('the capture (WhatsApp /observe): queue #294\'s visit shape is stamped v6', () => {
  const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
  const stampOf = () => {
    const w = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
    return w ? w[2] : null;
  };

  test('an ICT coach observes a PRIMARY + MIDDLE teacher, no class named: fico17_v6 on the row', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe',
      boundTeacher: { user_id: T_MIXED, teacher_ext_id: 'tx1', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
    expect(stampOf()).toEqual({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
  });

  test('an unbound capture (no teacher picked) is v6 too', async () => {
    mockState.value = { state: 'awaiting_audio', origin: 'observe' };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
  });

  test('an ICT grade 7 lesson named at the class question is still FDE (unchanged)', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe',
      obs612Lesson: { primary: false, grade: 7, subject: 'maths', rubricId: 'obs612-msci-v1', tool: 'msci', sheet: null },
      boundTeacher: { user_id: T_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('obs612-msci-v1');
  });
});
