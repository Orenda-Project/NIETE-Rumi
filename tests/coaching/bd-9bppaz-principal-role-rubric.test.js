'use strict';
/**
 * bd-9bppaz — a principal observing one of their teachers gets the coach's HITL rubric, by ROLE.
 *
 * The coach rubric switches (fico_coach_rubric, obs612_coach, and the others built on the same lookup) named only
 * explicit accounts ("user:<id>"), a region, an organization or "*". Principals were left out of the 14 Nov rollout,
 * and listing ~520 principal ids by hand (then every new one) is how a principal gets missed. A role key names everyone
 * with that users.role:
 *
 *   {"role:principal": "v6"}          every principal
 *   {"role:principal@ict": "v6"}      every principal in a region FDE owns (organization niete)
 *   {"role:principal@sihala": "v6"}   every principal in one region
 *
 * Lookup order: "user:<id>", then the role keys (scoped to the region, then to the organization, then the bare role),
 * then the region, the organization and "*". The user's role is read only when a map holds a role key and the caller
 * did not pass it; a failed read is OFF (the T2.2 rule: never guess when the key that could decide cannot be checked).
 *
 * The real chain is run below: the switch → /observe's v6 decision → the capture's coaching_sessions stamp.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
// The capture's neighbours (the observe state, the bound teacher, sends, the queue), as in tests/observe/obs612-capture.
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
jest.mock('../../bot/shared/services/observe/bound-teacher', () => ({ resolveBoundTeacherUserId: jest.fn(() => Promise.resolve('prim')) }));
jest.mock('../../bot/shared/services/observe/observe2/capture-link', () => ({ linkRecording: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueTranscription: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({ markDone: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-who.service', () => ({ maybeAskObservedTeacher: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => Promise.resolve(
    ({ sihala: 'niete', tarnol: 'niete', 'gilgit-baltistan': 'moawin' })[String(region || '').toLowerCase()] || null,
  )),
}));

// app_settings rows by key; users rows by id; a users read can be made to fail.
let mockSettings = {};
let mockUsers = {};
let mockUsersFail = false;
const mockUserReads = [];
const mockWrites = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _t: table, _id: null, _keys: null, _cols: '' };
    q.select = (cols) => { q._cols = cols || ''; return q; };
    q.eq = (col, v) => { if (col === 'id') q._id = v; if (col === 'key') q._keys = [v]; return q; };
    q.in = (col, v) => { if (col === 'key') q._keys = v; return q; };
    q.insert = (row) => { mockWrites.push(['insert', table, row]); q._row = row; return q; };
    q.update = (patch) => { mockWrites.push(['update', table, patch]); return q; };
    q.single = () => Promise.resolve({ data: { id: 'sess-1', framework: null, ...(q._row || {}) }, error: null });
    q.maybeSingle = async () => {
      if (q._t !== 'users') return { data: null, error: null };
      mockUserReads.push([q._id, q._cols]);
      if (mockUsersFail) return { data: null, error: { message: 'users read failed' } };
      return { data: mockUsers[q._id] || null, error: null };
    };
    q.then = (res, rej) => {
      if (q._t === 'app_settings') {
        const rows = (q._keys || []).filter((k) => mockSettings[k] !== undefined).map((k) => ({ key: k, value: mockSettings[k] }));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    };
    return q;
  },
}));

const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const Obs612Switch = require('../../bot/shared/services/coaching/obs612-switch');

const { asMap, resolve, COACH_VALUES } = Switch;
const COACH = 'aaaaaaaa-0000-4000-8000-00000000c0ac';
const PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const GB_PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const TEACHER = 'cccccccc-0000-4000-8000-00000000000a';

beforeEach(() => {
  Switch._resetCache();
  Obs612Switch._resetCache();
  mockSettings = {};
  mockUsersFail = false;
  mockUserReads.length = 0;
  mockWrites.length = 0;
  mockUsers = {
    [COACH]: { id: COACH, role: 'coach', region: 'Sihala' },
    [PRINCIPAL]: { id: PRINCIPAL, role: 'principal', region: 'Sihala' },
    [GB_PRINCIPAL]: { id: GB_PRINCIPAL, role: 'principal', region: 'Gilgit-Baltistan' },
    [TEACHER]: { id: TEACHER, role: 'teacher', region: 'Sihala', teacher_level: ['PRIMARY'] },
    prim: { id: 'prim', teacher_level: ['PRIMARY'] },
    middle: { id: 'middle', teacher_level: ['MIDDLE'] },
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; });

describe('resolve (pure): role keys', () => {
  const C = (m, who) => resolve(asMap(m), who, COACH_VALUES, 'current');

  test('"role:principal" names every principal, and nobody else', () => {
    const m = { 'role:principal': 'v6' };
    expect(C(m, { userId: PRINCIPAL, role: 'principal', region: 'Sihala' })).toBe('v6');
    expect(C(m, { userId: COACH, role: 'coach', region: 'Sihala' })).toBe('current');
    expect(C(m, { userId: TEACHER, role: 'teacher', region: 'Sihala' })).toBe('current');
    expect(C(m, { userId: PRINCIPAL, region: 'Sihala' })).toBe('current'); // no role known → the role key cannot apply
  });

  test('the role is matched as registration stores it, case and spaces aside', () => {
    expect(C({ 'role:principal': 'v6' }, { role: ' Principal ' })).toBe('v6');
    expect(C({ 'ROLE:Principal': 'v6' }, { role: 'principal' })).toBe('v6');
  });

  test('"user:<id>" beats a role key; a role key beats region, organization and "*"', () => {
    const m = { [`user:${PRINCIPAL}`]: 'current', 'role:principal': 'v6', sihala: 'current', ict: 'current', '*': 'current' };
    expect(C(m, { userId: PRINCIPAL, role: 'principal', region: 'Sihala', organization: 'niete' })).toBe('current');
    expect(C(m, { userId: 'other-principal', role: 'principal', region: 'Sihala', organization: 'niete' })).toBe('v6');
  });

  test('a scoped role key reaches only its region or organization; the region scope beats the organization scope', () => {
    const m = { 'role:principal@ict': 'v6', 'role:principal@tarnol': 'current' };
    expect(C(m, { role: 'principal', region: 'Sihala', organization: 'niete' })).toBe('v6');
    expect(C(m, { role: 'principal', region: 'Tarnol', organization: 'niete' })).toBe('current');
    expect(C(m, { role: 'principal', region: 'Gilgit-Baltistan', organization: 'moawin' })).toBe('current');
    expect(C({ 'role:principal@gb': 'v6' }, { role: 'principal', region: 'Gilgit-Baltistan', organization: 'moawin' })).toBe('v6');
  });

  test('a scoped role key beats the bare role key', () => {
    const m = { 'role:principal': 'v6', 'role:principal@gb': 'current' };
    expect(C(m, { role: 'principal', region: 'Gilgit-Baltistan', organization: 'moawin' })).toBe('current');
    expect(C(m, { role: 'principal', region: 'Sihala', organization: 'niete' })).toBe('v6');
  });

  test('an unknown value on a role key is off, as on any key', () => {
    expect(C({ 'role:principal': 'v5' }, { role: 'principal' })).toBe('current');
  });
});

describe('coachRubric: the role is read from users only when a role key exists', () => {
  test('today\'s map (explicit coach ids only): a principal stays current and no role is read', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${COACH}`]: 'v6' });
    await expect(Switch.coachRubric({ userId: COACH, region: 'Sihala' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'Sihala' })).resolves.toBe('current');
    // Queue #191: a coach is v6 whatever the rows say, so an account the rows do not put on v6 has its role read once
    // (to know it is not a coach); an account whose own row already says v6 is never read.
    expect(mockUserReads).toEqual([[PRINCIPAL, 'role']]);
  });

  test('with "role:principal": a principal is v6 (role read from users), a teacher is not, a coach keeps their own key', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${COACH}`]: 'v6', 'role:principal': 'v6' });
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'Sihala' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: TEACHER, region: 'Sihala' })).resolves.toBe('current');
    await expect(Switch.coachRubric({ userId: COACH, region: 'Sihala' })).resolves.toBe('v6');
    // the coach's own key decided without a role read
    expect(mockUserReads.map(([id]) => id)).toEqual([PRINCIPAL, TEACHER]);
  });

  test('a role the caller passes is used as is, with no read', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal': 'v6' });
    await expect(Switch.coachRubric({ userId: PRINCIPAL, role: 'principal', region: 'Sihala' })).resolves.toBe('v6');
    expect(mockUserReads).toEqual([]);
  });

  test('"role:coach" puts every coach on, so a new coach joins without a new id', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:coach': 'v6', 'role:principal': 'v6' });
    await expect(Switch.coachRubric({ userId: COACH, region: 'Sihala' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'Sihala' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: TEACHER, region: 'Sihala' })).resolves.toBe('current');
  });

  test('a failed role read is off, even with "*" set (never guess past the key that could decide)', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal': 'current', '*': 'v6' });
    mockUsersFail = true;
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'Sihala' })).resolves.toBe('current');
  });

  test('"role:principal@ict" reaches an ICT principal and not a GB one', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal@ict': 'v6' });
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'Sihala' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: GB_PRINCIPAL, region: 'Gilgit-Baltistan' })).resolves.toBe('current');
  });
});

describe('obs612_coach (FDE grades 6-12) takes the same role key', () => {
  test('{"role:principal": "on"}: on for a principal, off for a teacher', async () => {
    mockSettings.obs612_coach = JSON.stringify({ 'role:principal': 'on' });
    await expect(Obs612Switch.isOn({ userId: PRINCIPAL })).resolves.toBe(true);
    await expect(Obs612Switch.isOn({ userId: TEACHER })).resolves.toBe(false);
  });

  test('the class question is asked of a principal (the user row in hand carries the role)', async () => {
    mockSettings.obs612_coach = JSON.stringify({ 'role:principal': 'on' });
    const Visit = require('../../bot/shared/services/observe/obs612/visit');
    await expect(Visit.asksClass({ id: PRINCIPAL, role: 'principal', region: 'Sihala' })).resolves.toBe(true);
    await expect(Visit.asksClass({ id: TEACHER, role: 'teacher', region: 'Sihala' })).resolves.toBe(false);
  });
});

describe('the real chain: a principal\'s /observe visit to their teacher is stamped like a coach\'s', () => {
  const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

  test('decideVisitFramework: grades 1-5 teacher → fico17_v6; grades 6-8 teacher → today\'s V3 (no stamp)', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal': 'v6' });
    await expect(O6.decideVisitFramework({ userId: PRINCIPAL, region: 'Sihala', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
    await expect(O6.decideVisitFramework({ userId: PRINCIPAL, region: 'Sihala', teacherUserId: 'middle' })).resolves.toBeNull();
  });

  test('without the role key a principal is V3, exactly as before', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${COACH}`]: 'v6' });
    await expect(O6.decideVisitFramework({ userId: PRINCIPAL, region: 'Sihala', teacherUserId: 'prim' })).resolves.toBeNull();
    await expect(O6.decideVisitFramework({ userId: COACH, region: 'Sihala', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
  });

  test('/observe2 visitRubric: a principal\'s grades 1-5 visit is v6', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal': 'v6' });
    // rubricForNewVisit: on every branch (sandbox and staging also have visitRubric, which it wraps there)
    const { rubricForNewVisit } = require('../../bot/shared/services/observe/observe2/rubric');
    await expect(rubricForNewVisit({ observerUserId: PRINCIPAL, region: 'Sihala', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
  });
});

describe('the capture: a principal\'s recording for their bound teacher is stamped fico17_v6 on coaching_sessions', () => {
  const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');
  const BOUND = { user_id: 'prim', teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia' };
  const PRINCIPAL_ROW = () => ({ id: PRINCIPAL, role: 'principal', region: 'Sihala', preferred_language: 'en' });

  test('role key on: the row is stamped fico17_v6 by the coach rubric switch', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ 'role:principal': 'v6' });
    mockState.value = { state: 'awaiting_audio', origin: 'observe', boundTeacher: BOUND };
    const session = await startFromAudio(PRINCIPAL_ROW(), '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework).toBe('fico17_v6');
    const stamp = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
    expect(stamp[2]).toEqual({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
    // the switch read the principal's role itself (the capture passes the id and region, as for a coach)
    expect(mockUserReads.filter(([id, cols]) => id === PRINCIPAL && cols === 'role')).toHaveLength(1);
  });

  test('role key off (today\'s prod map): no stamp, V3 as before', async () => {
    mockSettings.fico_coach_rubric = JSON.stringify({ [`user:${COACH}`]: 'v6' });
    mockState.value = { state: 'awaiting_audio', origin: 'observe', boundTeacher: BOUND };
    const session = await startFromAudio(PRINCIPAL_ROW(), '9230', 'audio-1', 'chat-1', 1800);
    expect(session.framework || null).toBeNull();
    expect(mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework)).toBeUndefined();
  });
});
