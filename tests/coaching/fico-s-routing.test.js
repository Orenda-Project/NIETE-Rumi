'use strict';
/**
 * bd-31ziu8.2 — FICO-S v1.1 routing for ICT HITL. Operator, 18 Nov ~14:30: "for ICT we get 2 rubrics only. For 1 to 5,
 * remains the same FICO v6. For 6 onwards all the way to 12, it is going to be FICO-S v1.1 ... GB remains the same."
 *
 * With app_settings.fico_s_coach on for an observer, on an ICT visit:
 *   - the class is asked (even with obs612_coach off), and every grade 6-12 lesson asks its subject;
 *   - a grade 6-8 lesson is FICO-S, not FDE's tool; a grade 9-12 lesson is FICO-S, not FICO17 v6;
 *   - grades 1-5 are untouched (FICO17 v6 by the coach switch);
 *   - the capture stamps coaching_sessions.framework with the current FICO-S id ('fico_s_v1_2' from queue #218; v1.1 before) and makes the visit's form row on it.
 * GB is untouched whatever the switch says (coaching/fde-region.js). Off (the default): everything as before.
 * The real chain is run: the switches → asksClass / handleTap → the capture's stamp → the portal's stamp.
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
  getForm: jest.fn((id) => Promise.resolve({ ok: true, form: mockForms[id] || null })),
  createLessonForm: jest.fn((row) => Promise.resolve({ ok: true, form: { id: 'form-9', observer_user_id: row.observerUserId, rubric_version: row.rubricVersion, visit_context: row.visitContext, coaching_session_id: row.sessionId } })),
}));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => {
    if (mockRegistryFail) return Promise.reject(new Error('registry down'));
    return Promise.resolve(({ sihala: 'niete', 'urban-i': 'niete', 'gilgit-baltistan': 'moawin' })[String(region || '').trim().toLowerCase()] || null);
  }),
}));

let mockRegistryFail = false;
let mockForms = {};
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
const FicoSSwitch = require('../../bot/shared/services/coaching/fico-s-switch');

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
  FicoSSwitch._resetCache();
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

const ON_FOR = (...ids) => JSON.stringify(Object.fromEntries(ids.map((id) => [`user:${id}`, 'on'])));
const LESSON = (grade, subject, tool, rubricId) => ({ primary: false, grade, subject, rubricId, tool, sheet: null });

describe('the rubric registry: which tool a lesson gets', () => {
  const O = () => require('../../bot/shared/services/coaching/frameworks/obs612');
  test('FICO-S on: grades 6-12 → fico_s_v1_2 whatever the subject; grades 1-5 → none (FICO)', () => {
    for (const g of [6, 7, 8, 9, 10, 11, 12]) {
      expect(O().toolFor(g, 'maths', { ficoS: true })).toEqual({ tool: 'ficos', rubricId: 'fico_s_v1_2', sheet: null });
      expect(O().toolFor(g, null, { ficoS: true })).toEqual({ tool: 'ficos', rubricId: 'fico_s_v1_2', sheet: null });
    }
    for (const g of [1, 3, 5]) expect(O().toolFor(g, 'maths', { ficoS: true })).toBeNull();
  });
  test('FICO-S off: exactly as before (6-8 FDE by subject, 9-12 none)', () => {
    expect(O().toolFor(7, 'maths')).toEqual({ tool: 'msci', rubricId: 'obs612-msci-v1', sheet: null });
    expect(O().toolFor(7, 'urdu')).toEqual({ tool: 'enur', rubricId: 'obs612-enur-v1', sheet: 'ur' });
    expect(O().toolFor(10, 'science')).toBeNull();
  });
});

describe('the class question: FICO-S asks it too, never on a GB visit', () => {
  const Visit = () => require('../../bot/shared/services/observe/obs612/visit');

  test('fico_s_coach on with obs612_coach off: an ICT coach is asked; a GB coach is not', async () => {
    mockSettings = { fico_s_coach: ON_FOR(ICT_COACH, GB_COACH) };
    await expect(Visit().asksClass(row(ICT_COACH))).resolves.toBe(true);
    await expect(Visit().asksClass(row(GB_COACH))).resolves.toBe(false);
    await expect(FicoSSwitch.forVisit(row(GB_COACH))).resolves.toBe(false);
    await expect(FicoSSwitch.forVisit(row(ICT_COACH), { schoolExtId: 'niete:100' })).resolves.toBe(true);
  });

  test('a role key: every ICT principal (role:principal@ict), never a GB one', async () => {
    mockSettings = { fico_s_coach: JSON.stringify({ 'role:principal@ict': 'on' }) };
    await expect(FicoSSwitch.forVisit(row(ICT_PRINCIPAL))).resolves.toBe(true);
    await expect(FicoSSwitch.forVisit(row(GB_PRINCIPAL))).resolves.toBe(false);
    await expect(FicoSSwitch.forVisit(row(ICT_COACH))).resolves.toBe(false);
  });

  test('default off: no row, a bad value, or a failed read', async () => {
    mockSettings = {};
    await expect(FicoSSwitch.isOn({ userId: ICT_COACH, region: 'Urban-I' })).resolves.toBe(false);
    FicoSSwitch._resetCache();
    mockSettings = { fico_s_coach: JSON.stringify({ [`user:${ICT_COACH}`]: 'yes' }) };
    await expect(FicoSSwitch.isOn({ userId: ICT_COACH, region: 'Urban-I' })).resolves.toBe(false);
  });
});

describe('/observe taps: with FICO-S a grade 6-12 class asks its subject and the lesson is FICO-S', () => {
  const Visit = () => require('../../bot/shared/services/observe/obs612/visit');
  const WA = () => require('../../bot/shared/services/whatsapp.service');
  const ObserveState = () => require('../../bot/shared/services/observe/observe-state.service');
  const ict = { ...row(ICT_COACH), preferred_language: 'en' };
  const askState = () => ({
    state: 'awaiting_audio', origin: 'observe', obs612Ask: 'n1', obs612Visit: { teacherUserId: T_ICT_MIDDLE, schoolExtId: 'niete:100' },
  });
  const lastLesson = () => {
    const calls = ObserveState().setState.mock.calls.filter((c) => c[2] && c[2].obs612Lesson);
    return calls.length ? calls[calls.length - 1][2].obs612Lesson : null;
  };

  test('grade 10 with FICO-S: the subject is asked (not a FICO lesson at once)', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:g:o:n1:10');
    const list = WA().sendInteractiveMessage.mock.calls[0][1];
    expect(list.action.sections[0].rows[0].id).toMatch(/^o612:s:o:n1:10:/);
    expect(lastLesson()).toBeNull();
  });

  test('grade 10 Science with FICO-S → a FICO-S lesson, and the prompt names FICO-S', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:s:o:n1:10:science');
    expect(lastLesson()).toEqual(LESSON(10, 'science', 'ficos', 'fico_s_v1_2'));
    expect(WA().sendMessage.mock.calls.map((c) => c[1]).join('\n')).toMatch(/FICO 6-12/);
  });

  test('grade 7 Maths with FICO-S → FICO-S, not FDE\'s Maths & Science tool', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:s:o:n1:7:maths');
    expect(lastLesson()).toEqual(LESSON(7, 'maths', 'ficos', 'fico_s_v1_2'));
  });

  test('grade 3 with FICO-S: a FICO lesson, as before (v6 decides)', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:g:o:n1:3');
    expect(lastLesson()).toEqual({ primary: true, grade: 3, subject: null });
  });

  test('FICO-S off: grade 10 is a FICO lesson at once, grade 7 Maths is FDE (unchanged)', async () => {
    mockSettings = PROD_ROWS();
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:g:o:n1:10');
    expect(lastLesson()).toEqual({ primary: true, grade: 10, subject: null });
    mockState.value = askState();
    await Visit().handleTap(ict, '9230', 'o612:s:o:n1:7:maths');
    expect(lastLesson()).toEqual(LESSON(7, 'maths', 'msci', 'obs612-msci-v1'));
  });

  test('a GB visit with the switch on is never FICO-S (the visit kept at the question decides)', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = { ...askState(), obs612Visit: { teacherUserId: T_GB_MIDDLE, schoolExtId: null } };
    await Visit().handleTap(ict, '9230', 'o612:g:o:n1:10');
    expect(lastLesson()).toEqual({ primary: true, grade: 10, subject: null });
  });

  test('the question keeps the visit, and its words name FICO-S', async () => {
    mockSettings = { fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = { state: 'awaiting_audio', origin: 'observe' };
    await Visit().askForObserve(ict, '9230', { teacherName: 'Rabia', visit: { teacherUserId: T_ICT_MIDDLE, schoolExtId: 'niete:100' } });
    const st = ObserveState().setState.mock.calls[0][2];
    expect(st.obs612Visit).toEqual({ teacherUserId: T_ICT_MIDDLE, schoolExtId: 'niete:100' });
    expect(WA().sendInteractiveMessage.mock.calls[0][1].body.text).toMatch(/FICO 6-12/);
  });
});

describe('the capture: a FICO-S lesson stamps fico_s_v1_2 and gets its form row', () => {
  const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
  const stampOf = () => {
    const w = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
    return w ? w[2] : null;
  };

  test.each([[7, 'maths'], [10, 'science']])('ICT grade %i %s → fico_s_v1_2, the FICO-S form is sent', async (grade, subject) => {
    process.env.FICO_S_FLOW_ID = 'F-FICOS';
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON(grade, subject, 'ficos', 'fico_s_v1_2'),
      boundTeacher: { user_id: T_ICT_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico_s_v1_2');
    expect(stampOf()).toEqual({ framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_lesson' });
    expect(Store.createLessonForm).toHaveBeenCalledWith(expect.objectContaining({
      rubricVersion: 'fico_s_v1_2', visitContext: expect.objectContaining({ grade, subject, via: 'observe' }),
    }));
    const flow = require('../../bot/shared/services/whatsapp.service').sendFlow.mock.calls[0][1];
    expect(flow.flowId).toBe('F-FICOS');
    expect(flow.flowToken).toBe(`${ICT_COACH}:obs612:form-9:fs`);
    expect(flow.buttonText).toBe('Open FICO 6-12 form');
    delete process.env.FICO_S_FLOW_ID;
  });

  test('a GB coach\'s visit that named a FICO-S lesson anyway: fico17_v6, no form (GB unchanged)', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(GB_COACH) };
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON(7, 'maths', 'ficos', 'fico_s_v1_2'),
      boundTeacher: { user_id: T_GB_MIDDLE, teacher_ext_id: 'tx1', school_ext_id: 'niete:71657', teacher_name: 'Maryam' },
    };
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
    expect(Store.createLessonForm).not.toHaveBeenCalled();
  });

  test('FICO_S_FLOW_ID unset: the observer is told, never left waiting', async () => {
    delete process.env.FICO_S_FLOW_ID;
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON(10, 'english', 'ficos', 'fico_s_v1_2'),
      boundTeacher: { user_id: T_ICT_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    const WA = require('../../bot/shared/services/whatsapp.service');
    expect(WA.sendFlow).not.toHaveBeenCalled();
    expect(WA.sendMessage.mock.calls.map((c) => c[1]).join('\n')).toMatch(/FICO 6-12 form isn't switched on/);
  });
});

describe('the portal: the class question and the stamp', () => {
  const Svc = () => require('../../bot/shared/services/observe/portal-observe.service');
  const d = () => ({ supabase: require('../../bot/shared/config/supabase'), principalApp: () => Promise.resolve(true) });

  test('lessonQuestion: FICO-S asks the subject for every grade 6-12', async () => {
    mockSettings = { fico_s_coach: ON_FOR(ICT_COACH) };
    await expect(Svc().lessonQuestion({ userId: ICT_COACH }, d())).resolves.toMatchObject({
      status: 'ok', ask: true, rubric: 'fico_s', subjectGrades: [6, 7, 8, 9, 10, 11, 12],
    });
    FicoSSwitch._resetCache();
    Obs612Switch._resetCache();
    mockSettings = PROD_ROWS();
    await expect(Svc().lessonQuestion({ userId: ICT_COACH }, d())).resolves.toMatchObject({ rubric: 'fde', subjectGrades: [6, 7, 8] });
  });

  test('decideStamp: ICT grade 7 / grade 10 → FICO-S; grade 3 → v6; GB → v6; switch off → FDE / v6 as before', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH, GB_COACH) };
    const coach = row(ICT_COACH);
    const s7 = await Svc()._decideStamp(d(), coach, T_ICT_MIDDLE, { grade: 7, subject: 'maths' }, 'niete:100');
    expect(s7.fdeLesson).toMatchObject({ rubricId: 'fico_s_v1_2', tool: 'ficos', grade: 7, subject: 'maths' });
    const s10 = await Svc()._decideStamp(d(), coach, T_ICT_MIDDLE, { grade: 10, subject: 'science' }, 'niete:100');
    expect(s10.fdeLesson).toMatchObject({ rubricId: 'fico_s_v1_2', grade: 10, subject: 'science' });
    const s3 = await Svc()._decideStamp(d(), coach, T_ICT_PRIMARY, { primary: true }, 'niete:100');
    expect(s3.fdeLesson).toBeNull();
    expect(s3.v6Stamp).toBe('fico17_v6');
    const gb = await Svc()._decideStamp(d(), row(GB_COACH), T_GB_MIDDLE, { grade: 7, subject: 'maths' }, 'niete:71657');
    expect(gb.fdeLesson).toBeNull();
    expect(gb.v6Stamp).toBe('fico17_v6');
    FicoSSwitch._resetCache();
    mockSettings = PROD_ROWS();
    const off = await Svc()._decideStamp(d(), coach, T_ICT_MIDDLE, { grade: 7, subject: 'maths' }, 'niete:100');
    expect(off.fdeLesson).toMatchObject({ rubricId: 'obs612-msci-v1' });
  });
});

describe('"Plan my visit" Flow: with FICO-S, High asks the subject and both bands name FICO-S', () => {
  const LF = () => require('../../bot/shared/services/observe/obs612/lesson-flow');
  const token = `${ICT_COACH}:o612lesson:o:n1`;
  const deps = (ficoS) => ({ userLang: () => 'en', teacherName: () => null, ficoS: () => ficoS });

  test('ficoS: High → SUBJECT; the subject closes with a subject tap; the bands say FICO-S', async () => {
    const init = await LF().handleRequest({ action: 'INIT', flow_token: token }, deps(true));
    expect(init.data.options.find((o) => o.id === 'high').description).toMatch(/FICO 6-12/);
    const g = await LF().handleRequest({ action: 'data_exchange', flow_token: token, data: { step: 'grade', grade: '10' } }, deps(true));
    expect(g.screen).toBe('SUBJECT');
    const s = await LF().handleRequest({ action: 'data_exchange', flow_token: token, data: { step: 'subject', grade: '10', subject: 'science' } }, deps(true));
    expect(s.data.extension_message_response.params.tap).toBe('o612:s:o:n1:10:science');
  });

  test('without FICO-S: High closes at the grade, as before', async () => {
    const g = await LF().handleRequest({ action: 'data_exchange', flow_token: token, data: { step: 'grade', grade: '10' } }, deps(false));
    expect(g.screen).toBe('SUCCESS');
    expect(g.data.extension_message_response.params.tap).toBe('o612:g:o:n1:10');
  });
});

// Queue #184 (operator 19 Nov: "all HITL go to DC"): app_settings.fico_s_dc, per user, OFF by default. With it on (and
// fico_s_coach on) a FICO 6-12 visit with a recording goes to the Digital Coach: stamped 'fico_s_dc' at its start, its
// form made but sent only once Rumi has filled it in (obs612/fico-s-dc.js), the capture's ordinary ack meanwhile.
describe('fico_s_dc: a FICO 6-12 visit for the Digital Coach', () => {
  const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
  const stampOf = () => {
    const w = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
    return w ? w[2] : null;
  };
  const WA = () => require('../../bot/shared/services/whatsapp.service');

  test('default off: no row, a bad value, or only fico_s_coach on', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    await expect(FicoSSwitch.dcForVisit(row(ICT_COACH), { teacherUserId: T_ICT_MIDDLE })).resolves.toBe(false);
    FicoSSwitch._resetCache();
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH), fico_s_dc: '{not json' };
    await expect(FicoSSwitch.dcForVisit(row(ICT_COACH), { teacherUserId: T_ICT_MIDDLE })).resolves.toBe(false);
    FicoSSwitch._resetCache();
    mockSettings = { ...PROD_ROWS(), fico_s_dc: ON_FOR(ICT_COACH) }; // DC on, FICO-S off: nothing
    await expect(FicoSSwitch.dcForVisit(row(ICT_COACH), { teacherUserId: T_ICT_MIDDLE })).resolves.toBe(false);
  });

  test('on per user, both switches: ICT yes; GB never; another coach no', async () => {
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH, GB_COACH, ICT_COACH_BARE), fico_s_dc: ON_FOR(ICT_COACH, GB_COACH) };
    await expect(FicoSSwitch.dcForVisit(row(ICT_COACH), { teacherUserId: T_ICT_MIDDLE })).resolves.toBe(true);
    await expect(FicoSSwitch.dcForVisit(row(GB_COACH), { teacherUserId: T_GB_MIDDLE })).resolves.toBe(false);
    await expect(FicoSSwitch.dcForVisit(row(ICT_COACH_BARE), { teacherUserId: T_ICT_MIDDLE })).resolves.toBe(false);
  });

  test.each([[7, 'maths'], [10, 'science']])('capture, grade %i %s: stamped fico_s_dc, the form made but not sent, the ordinary ack', async (grade, subject) => {
    process.env.FICO_S_FLOW_ID = 'F-FICOS';
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH), fico_s_dc: ON_FOR(ICT_COACH) };
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe', obs612Lesson: LESSON(grade, subject, 'ficos', 'fico_s_v1_2'),
      boundTeacher: { user_id: T_ICT_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico_s_v1_2');
    expect(stampOf()).toEqual({ framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_dc' });
    expect(Store.createLessonForm).toHaveBeenCalledWith(expect.objectContaining({ rubricVersion: 'fico_s_v1_2' }));
    expect(WA().sendFlow).not.toHaveBeenCalled();
    expect(WA().sendInteractiveButtons).toHaveBeenCalled();
    delete process.env.FICO_S_FLOW_ID;
  });

  test('portal decideStamp: the FICO-S lesson carries dc only with fico_s_dc on', async () => {
    const Svc = require('../../bot/shared/services/observe/portal-observe.service');
    const d = { supabase: require('../../bot/shared/config/supabase'), principalApp: () => Promise.resolve(true) };
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH), fico_s_dc: ON_FOR(ICT_COACH) };
    const on = await Svc._decideStamp(d, row(ICT_COACH), T_ICT_MIDDLE, { grade: 10, subject: 'science' }, 'niete:100');
    expect(on.fdeLesson).toMatchObject({ rubricId: 'fico_s_v1_2', dc: true });
    FicoSSwitch._resetCache();
    mockSettings = { ...PROD_ROWS(), fico_s_coach: ON_FOR(ICT_COACH) };
    const off = await Svc._decideStamp(d, row(ICT_COACH), T_ICT_MIDDLE, { grade: 10, subject: 'science' }, 'niete:100');
    expect(off.fdeLesson.dc).toBeUndefined();
  });
});
