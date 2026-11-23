'use strict';
/**
 * bd-ra8xu.60 — Observation Notes on WhatsApp /observe: the offer after "Got the recording".
 *
 * With app_settings.observation_notes on for the coach, a visit stamped FICO17 v6 gets ONE extra message right after the
 * recording's acknowledgement: the Observation Notes Flow (OBSERVE_NOTES_FLOW_ID), opened on its one screen with the
 * words in the coach's language, token obsnotes:<session id>. The 2-5 minutes while Rumi listens is the moment: the
 * notes land before Rumi's form, so they are the one coach signal not shaped by Rumi's levels.
 * Switch off, a visit that is not v6 (V3, FDE, /observe2), or no Flow id: nothing new is sent.
 * The real chain runs (startFromAudio → the stamp → the offer); Supabase and WhatsApp are mocked at the boundary.
 * Harness: tests/coaching/bd-hk2jm3-fde-ict-only.test.js.
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
const NotesSwitch = require('../../bot/shared/services/observe/observation-notes-switch');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');

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
  NotesSwitch._resetCache();
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


const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
const GB_VISIT = () => ({
  state: 'awaiting_audio', origin: 'observe',
  boundTeacher: { user_id: T_GB_MIDDLE, teacher_ext_id: 'tx1', school_ext_id: 'niete:71657', teacher_name: 'Maryam' },
});
const notesFlows = () => WhatsAppService.sendFlow.mock.calls.filter(([, f]) => String(f.flowToken || '').startsWith('obsnotes:'));
const cp = (s) => Array.from(String(s)).length;

describe('the Observation Notes offer after the recording', () => {
  beforeEach(() => {
    process.env.OBSERVE_NOTES_FLOW_ID = 'F-NOTES';
    mockSettings.observation_notes = JSON.stringify({ [`user:${GB_COACH}`]: 'on' });
  });
  afterAll(() => { delete process.env.OBSERVE_NOTES_FLOW_ID; });

  test('a v6 visit, switch on: the notes Flow follows the acknowledgement, on its one screen, in English', async () => {
    mockState.value = GB_VISIT();
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
    expect(notesFlows()).toHaveLength(1);
    const [to, f] = notesFlows()[0];
    expect(to).toBe('9230');
    expect(f).toMatchObject({ flowId: 'F-NOTES', flowToken: 'obsnotes:sess-1', screen: 'NOTES', buttonText: 'Add notes' });
    expect(f.body).toMatch(/^📝 While you wait: what did you see in the room/);
    expect(f.screenData).toMatchObject({ heading: 'What did you see in the room?', who: 'Maryam', who_v: true, save: 'Save notes' });
    // After the recording's acknowledgement, never before it.
    const ackOrder = WhatsAppService.sendInteractiveButtons.mock.invocationCallOrder[0];
    const offerOrder = WhatsAppService.sendFlow.mock.invocationCallOrder[WhatsAppService.sendFlow.mock.calls.indexOf(notesFlows()[0])];
    expect(ackOrder).toBeLessThan(offerOrder);
  });

  test('in Urdu, within WhatsApp\'s limits (button 20, body 1024 code points)', async () => {
    mockState.value = GB_VISIT();
    await startFromAudio({ ...row(GB_COACH), preferred_language: 'ur' }, '9230', 'audio-1', 'chat-1', 1800);
    const [, f] = notesFlows()[0];
    expect(f.buttonText).toBe('نوٹس لکھیں');
    expect(f.screenData.heading).toBe('آپ نے کلاس میں کیا دیکھا؟');
    expect(cp(f.buttonText)).toBeLessThanOrEqual(20);
    expect(cp(f.body)).toBeLessThanOrEqual(1024);
  });

  test('switch off (the default): nothing new is sent', async () => {
    delete mockSettings.observation_notes;
    mockState.value = GB_VISIT();
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
    expect(notesFlows()).toHaveLength(0);
  });

  test('switch on, but not a v6 visit (FDE grade 7): no offer', async () => {
    mockSettings.observation_notes = '"on"';
    mockState.value = {
      state: 'awaiting_audio', origin: 'observe',
      obs612Lesson: { primary: false, grade: 7, subject: 'maths', rubricId: 'obs612-msci-v1', tool: 'msci', sheet: null },
      boundTeacher: { user_id: T_ICT_MIDDLE, teacher_ext_id: 'tx2', school_ext_id: 'niete:100', teacher_name: 'Rabia' },
    };
    const session = await startFromAudio({ ...row(ICT_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('obs612-msci-v1');
    expect(notesFlows()).toHaveLength(0);
  });

  test('no Flow id on this deployment: no offer, and it is logged', async () => {
    delete process.env.OBSERVE_NOTES_FLOW_ID;
    mockState.value = GB_VISIT();
    await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(notesFlows()).toHaveLength(0);
    expect(logToFile.mock.calls.some(([m]) => /OBSERVE_NOTES_FLOW_ID/.test(m))).toBe(true);
  });

  test('the offer failing never costs the capture', async () => {
    WhatsAppService.sendFlow.mockImplementationOnce(() => Promise.reject(new Error('Meta 500')));
    mockState.value = GB_VISIT();
    const session = await startFromAudio({ ...row(GB_COACH), preferred_language: 'en' }, '9230', 'audio-1', 'chat-1', 1800);
    expect(session && session.id).toBe('sess-1');
  });
});
