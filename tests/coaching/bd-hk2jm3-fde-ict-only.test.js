'use strict';
/**
 * bd-hk2jm3 — FDE's grade 6-8 tools (obs612) are ICT's only; GB keeps FICO17 v6 for HITL at every grade.
 *
 * Operator, 17 Nov ~15:15: "The rubrics that we changed for 6 to 8, those are supposed to be for ICT only, not for GB.
 * ... for Gilgit Baltistan, it's gonna be the same Fico one that's live everywhere else. So for DC, it's supposed to be
 * V3, and for HITL, it's supposed to be V6".
 *
 * On prod (14-17 Nov) obs612_coach named GB coaches by id and every principal by role, so a GB grade 6-8 visit got FDE's
 * form. The rule now lives in the code, whatever the switch rows say:
 *   - a GB visit (the visit's school, else the teacher, else the observer) is never FDE: the class question is not
 *     asked, a lesson named 6-8 anyway is a FICO lesson, the portal stamp is never FDE;
 *   - a GB visit's HITL is FICO17 v6 at every grade (the grades 1-5 / 9-12 gate exists only because FDE owns 6-8 in ICT);
 *   - a test school never decides (FDE's own ICT testers observe test teachers at GB's "(Rumi QA)" schools);
 *   - ICT is unchanged, including coaches whose users.region the registry does not list ('ICT', none).
 * The real chain is run: the switches → asksClass / decideVisitFramework → the capture's coaching_sessions stamp.
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

// People (prod-shaped, 17 Nov): ICT coaches with a sector, with 'ICT' (not in the registry); GB FMOs; principals.
const ICT_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const ICT_COACH_BARE = 'aaaaaaaa-0000-4000-8000-0000000000c2'; // users.region 'ICT': the registry does not know it
const GB_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c3';
const ICT_PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const GB_PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const GB_IMPORTED_PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b3'; // source main_rumi_gb, no region
const ICT_TESTER = 'bbbbbbbb-0000-4000-8000-0000000000b4'; // FDE's tester: region 'ICT', her school a GB test school
const ICT_SCHOOL = 'dddddddd-0000-4000-8000-000000000001';
const GB_SCHOOL = 'dddddddd-0000-4000-8000-000000000002';
const GB_TEST_SCHOOL = 'dddddddd-0000-4000-8000-000000000003';
const T_ICT_MIDDLE = 'cccccccc-0000-4000-8000-000000000001';
const T_ICT_PRIMARY = 'cccccccc-0000-4000-8000-000000000002';
const T_GB_MIDDLE = 'cccccccc-0000-4000-8000-000000000003';
const T_GB_NO_LEVEL = 'cccccccc-0000-4000-8000-000000000004';
const T_GB_TEST = 'cccccccc-0000-4000-8000-000000000005';
const T_GB_NO_SCHOOL = 'cccccccc-0000-4000-8000-000000000006';

const users = () => [
  { id: ICT_COACH, role: 'coach', region: 'Urban-I', source: 'direct', school_id: null },
  { id: ICT_COACH_BARE, role: 'coach', region: 'ICT', source: 'direct', school_id: null },
  { id: GB_COACH, role: 'coach', region: 'Gilgit-Baltistan', source: 'direct', school_id: null },
  { id: ICT_PRINCIPAL, role: 'principal', region: 'Sihala', source: 'direct', school_id: ICT_SCHOOL },
  { id: GB_PRINCIPAL, role: 'principal', region: 'Gilgit-Baltistan', source: 'direct', school_id: GB_SCHOOL },
  { id: GB_IMPORTED_PRINCIPAL, role: 'principal', region: null, source: 'main_rumi_gb', school_id: null },
  { id: ICT_TESTER, role: 'principal', region: 'ICT', source: 'direct', school_id: GB_TEST_SCHOOL },
  { id: T_ICT_MIDDLE, role: 'teacher', region: 'Urban-I', source: 'direct', school_id: ICT_SCHOOL, teacher_level: ['MIDDLE'] },
  { id: T_ICT_PRIMARY, role: 'teacher', region: 'Urban-I', source: 'direct', school_id: ICT_SCHOOL, teacher_level: ['PRIMARY'] },
  { id: T_GB_MIDDLE, role: 'teacher', region: 'Gilgit-Baltistan', source: 'direct', school_id: GB_SCHOOL, teacher_level: ['MIDDLE'] },
  { id: T_GB_NO_LEVEL, role: 'teacher', region: null, source: 'main_rumi_gb', school_id: GB_SCHOOL, teacher_level: null },
  { id: T_GB_TEST, role: 'teacher', region: 'Gilgit-Baltistan', source: 'direct', school_id: GB_TEST_SCHOOL, teacher_level: ['MIDDLE'] },
  { id: T_GB_NO_SCHOOL, role: 'teacher', region: null, source: 'main_rumi_gb', school_id: null, teacher_level: ['MIDDLE'] },
];
const row = (id) => users().find((u) => u.id === id);

// Prod's two rows (17 Nov), shape for shape: explicit coach ids (ICT and GB) plus every principal by role.
const PROD_ROWS = () => ({
  obs612_coach: JSON.stringify({
    [`user:${ICT_COACH}`]: 'on', [`user:${ICT_COACH_BARE}`]: 'on', [`user:${GB_COACH}`]: 'on', [`user:${ICT_TESTER}`]: 'on', 'role:principal': 'on',
  }),
  fico_coach_rubric: JSON.stringify({
    [`user:${ICT_COACH}`]: 'v6', [`user:${ICT_COACH_BARE}`]: 'v6', [`user:${GB_COACH}`]: 'v6', [`user:${ICT_TESTER}`]: 'v6', 'role:principal': 'v6',
  }),
});

beforeEach(() => {
  jest.clearAllMocks();
  FicoSwitch._resetCache();
  Obs612Switch._resetCache();
  mockRegistryFail = false;
  mockFail = {};
  mockWrites.length = 0;
  mockSettings = PROD_ROWS();
  mockTables = {
    users: users(),
    schools: [
      { id: ICT_SCHOOL, region: 'Urban-I', is_probable_test: false },
      { id: GB_SCHOOL, region: 'Gilgit-Baltistan', is_probable_test: false },
      { id: GB_TEST_SCHOOL, region: 'Gilgit-Baltistan', is_probable_test: true },
    ],
    leader_schools: [
      { leader_user_id: GB_COACH, school_ext_id: 'niete:71657', school_id: GB_SCHOOL },
      { leader_user_id: ICT_COACH, school_ext_id: 'niete:100', school_id: ICT_SCHOOL },
      { leader_user_id: ICT_COACH, school_ext_id: 'niete:gb-test-middle-rumi-qa', school_id: GB_TEST_SCHOOL },
    ],
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
  process.env.OBS612_FLOW_ID = 'F-FDE';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; delete process.env.OBS612_FLOW_ID; });

describe('the visit\'s region: its school, else its teacher, else the observer; a test school never decides', () => {
  const R = () => require('../../bot/shared/services/coaching/fde-region');

  test('the school the coach picked decides, whoever the observer is', async () => {
    await expect(R().visitRegion({ observer: row(ICT_COACH), schoolExtId: 'niete:100' })).resolves.toBe('ict');
    await expect(R().visitRegion({ observer: row(GB_COACH), schoolExtId: 'niete:71657' })).resolves.toBe('gb');
    // an ICT coach at a real GB school (by the teacher's own school row)
    await expect(R().visitRegion({ observer: row(ICT_COACH), teacherUserId: T_GB_MIDDLE })).resolves.toBe('gb');
  });

  test('a teacher with no school row: her own region (the GB import source counts)', async () => {
    await expect(R().visitRegion({ observer: row(ICT_COACH_BARE), teacherUserId: T_GB_NO_SCHOOL })).resolves.toBe('gb');
  });

  test('no teacher yet: the observer (users.region, the GB import source, her own school)', async () => {
    await expect(R().visitRegion({ observer: row(GB_COACH) })).resolves.toBe('gb');
    await expect(R().visitRegion({ observer: row(GB_IMPORTED_PRINCIPAL) })).resolves.toBe('gb');
    await expect(R().visitRegion({ observer: row(ICT_PRINCIPAL) })).resolves.toBe('ict');
    // an observer passed by id only (the portal's coach row has no source / school_id): read from users
    await expect(R().visitRegion({ observer: { id: GB_PRINCIPAL, region: null } })).resolves.toBe('gb');
  });

  test('ICT coaches whose users.region the registry does not list are unknown, never GB', async () => {
    await expect(R().visitRegion({ observer: row(ICT_COACH_BARE) })).resolves.toBe('unknown');
    await expect(R().fdeAllowed({ observer: row(ICT_COACH_BARE) })).resolves.toBe(true);
  });

  test('a test school never decides: FDE\'s ICT tester at a GB test school is not GB; a GB tester there is GB', async () => {
    await expect(R().visitRegion({ observer: row(ICT_COACH), schoolExtId: 'niete:gb-test-middle-rumi-qa', teacherUserId: T_GB_TEST })).resolves.toBe('ict');
    await expect(R().visitRegion({ observer: row(ICT_TESTER), teacherUserId: T_GB_TEST })).resolves.toBe('unknown');
    await expect(R().fdeAllowed({ observer: row(ICT_TESTER), teacherUserId: T_GB_TEST })).resolves.toBe(true);
    await expect(R().visitRegion({ observer: row(GB_COACH), teacherUserId: T_GB_TEST })).resolves.toBe('gb');
  });

  test('a read that fails: no FDE (fail closed), and no GB widening either', async () => {
    mockRegistryFail = true;
    await expect(R().visitRegion({ observer: row(GB_COACH) })).resolves.toBe('error');
    await expect(R().fdeAllowed({ observer: row(ICT_COACH) })).resolves.toBe(false);
    await expect(R().isGbVisit({ observer: row(GB_COACH) })).resolves.toBe(false);
    mockRegistryFail = false;
    mockFail.users = true;
    await expect(R().visitRegion({ observer: { id: GB_COACH } })).resolves.toBe('error');
  });
});

describe('the class question (asksClass): never for a GB visit, whatever obs612_coach says', () => {
  const Visit = () => require('../../bot/shared/services/observe/obs612/visit');

  test('a GB coach named on obs612_coach by id is not asked; an ICT coach still is', async () => {
    await expect(Visit().asksClass(row(GB_COACH))).resolves.toBe(false);
    await expect(Visit().asksClass(row(ICT_COACH))).resolves.toBe(true);
    await expect(Visit().asksClass(row(ICT_COACH_BARE))).resolves.toBe(true);
  });

  test('role:principal: an ICT principal is asked, a GB principal (by region or by the GB import) is not', async () => {
    await expect(Visit().asksClass(row(ICT_PRINCIPAL))).resolves.toBe(true);
    await expect(Visit().asksClass(row(GB_PRINCIPAL))).resolves.toBe(false);
    await expect(Visit().asksClass(row(GB_IMPORTED_PRINCIPAL))).resolves.toBe(false);
  });

  test('keyed on the visit: an ICT coach visiting a real GB school is not asked; FDE\'s tester at a GB test school is', async () => {
    await expect(Visit().asksClass(row(ICT_COACH), { teacherUserId: T_GB_MIDDLE })).resolves.toBe(false);
    await expect(Visit().asksClass(row(ICT_COACH), { schoolExtId: 'niete:100', teacherUserId: T_ICT_MIDDLE })).resolves.toBe(true);
    await expect(Visit().asksClass(row(ICT_TESTER), { teacherUserId: T_GB_TEST })).resolves.toBe(true);
  });

  test('queue #191: an ICT coach is asked with no obs612_coach row at all (the switch is no gate for a coach)', async () => {
    mockSettings = {};
    await expect(Visit().asksClass(row(ICT_COACH))).resolves.toBe(true);
    // ...and the guard still takes FDE away from a GB visit
    await expect(Visit().asksClass(row(ICT_COACH), { teacherUserId: T_GB_MIDDLE })).resolves.toBe(false);
  });
});

describe('HITL v6 (decideVisitFramework): a GB visit is v6 at every grade; ICT keeps the grades 1-5 / 9-12 gate', () => {
  const O6 = () => require('../../bot/shared/services/observe/observe-fico17-v6');

  test('GB: a grade 6-8 teacher, a teacher with no level, an unbound capture → fico17_v6', async () => {
    await expect(O6().decideVisitFramework({ userId: GB_COACH, region: 'Gilgit-Baltistan', teacherUserId: T_GB_MIDDLE })).resolves.toBe('fico17_v6');
    await expect(O6().decideVisitFramework({ userId: GB_COACH, region: 'Gilgit-Baltistan', teacherUserId: T_GB_NO_LEVEL })).resolves.toBe('fico17_v6');
    await expect(O6().decideVisitFramework({ userId: GB_COACH, region: 'Gilgit-Baltistan', teacherUserId: null })).resolves.toBe('fico17_v6');
    await expect(O6().decideVisitFramework({ userId: GB_PRINCIPAL, region: 'Gilgit-Baltistan', teacherUserId: T_GB_MIDDLE, schoolExtId: null })).resolves.toBe('fico17_v6');
  });

  test('ICT: a grade 6-8 teacher is not v6 here (FDE\'s, through the class question), a primary teacher is', async () => {
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_ICT_MIDDLE })).resolves.toBeNull();
    await expect(O6().decideVisitFramework({ userId: ICT_COACH, region: 'Urban-I', teacherUserId: T_ICT_PRIMARY })).resolves.toBe('fico17_v6');
  });

  test('queue #191: a GB coach not on fico_coach_rubric is v6 too (the switch is no gate for a coach)', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${ICT_COACH}`]: 'v6' });
    await expect(O6().decideVisitFramework({ userId: GB_COACH, region: 'Gilgit-Baltistan', teacherUserId: T_GB_MIDDLE })).resolves.toBe('fico17_v6');
  });

  test('DC is untouched: fico_dc_rubric is a separate switch (V3 unless an account is named)', async () => {
    await expect(FicoSwitch.dcRubric({ userId: GB_COACH, region: 'Gilgit-Baltistan' })).resolves.toBe('v3');
  });
});

describe('the capture (WhatsApp /observe): a GB grade 6-8 lesson is FICO17 v6, never FDE', () => {
  const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
  const LESSON_7_MATHS = { primary: false, grade: 7, subject: 'maths', rubricId: 'obs612-msci-v1', tool: 'msci', sheet: null };
  const stampOf = () => {
    const w = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
    return w ? w[2] : null;
  };

  test('a GB coach\'s visit that named grade 7 Maths (asked before this fix): stamped fico17_v6, no FDE form', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON_7_MATHS,
      boundTeacher: { user_id: T_GB_MIDDLE, teacher_ext_id: 'tx1', school_ext_id: 'niete:71657', teacher_name: 'Maryam' },
    };
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(Store.createLessonForm).not.toHaveBeenCalled();
    expect(session.framework).toBe('fico17_v6');
    expect(stampOf()).toEqual({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
  });

  test('a GB visit with no class named (the question is no longer asked): fico17_v6 for a grade 6-8 teacher', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe',
      boundTeacher: { user_id: T_GB_MIDDLE, teacher_ext_id: 'tx1', school_ext_id: 'niete:71657', teacher_name: 'Maryam' },
    };
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
  });

  test('an ICT coach\'s grade 7 Maths visit at an ICT school is FDE, exactly as before', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON_7_MATHS,
      boundTeacher: { user_id: T_ICT_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('obs612-msci-v1');
    expect(Store.createLessonForm).toHaveBeenCalledWith(expect.objectContaining({ rubricVersion: 'obs612-msci-v1', teacherUserId: T_ICT_MIDDLE }));
  });

  test('FDE\'s ICT tester at a GB test school keeps FDE (her tests run as before)', async () => {
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON_7_MATHS,
      boundTeacher: { user_id: T_GB_TEST, teacher_ext_id: 'tx3', school_ext_id: 'niete:gb-test-middle-rumi-qa', teacher_name: 'Test' },
    };
    const session = await startFromAudio({ ...row(ICT_TESTER), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('obs612-msci-v1');
  });
});

describe('the portal (coach app, principal app): the class question and the stamp follow the same rule', () => {
  const SVC = '../../bot/shared/services/observe/portal-observe.service';

  test('lessonQuestion with the real FDE check: a GB coach is not asked the class; an ICT coach is', async () => {
    const Svc = require(SVC);
    const d = { supabase: require('../../bot/shared/config/supabase') };
    await expect(Svc.lessonQuestion({ userId: GB_COACH }, d)).resolves.toEqual({ status: 'ok', ask: false });
    await expect(Svc.lessonQuestion({ userId: ICT_COACH }, d)).resolves.toMatchObject({ status: 'ok', ask: true });
  });
});
