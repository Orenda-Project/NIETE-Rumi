'use strict';

/**
 * bd-slknzt (queue #203) — a principal's WhatsApp /observe menu offers observation actions only.
 *
 * The operator, 20 Nov (demo prep): "on WhatsApp for the principal, the /observe is showing some buttons that dont make
 * sense for principal e.g. Add or Remove school. Only coaches can do that. The principal can just conduct observations."
 *
 * Since bd-31ziu8 (18 Nov) a principal schedules "the same as coach", so the menu was the coach's whole menu, roster
 * admin included: "Add or remove a school" always, "Manage teachers" whenever she held a leader_schools row. For a
 * principal those two rows go, and the steps behind them answer with the menu (a Flow left open on an old menu screen
 * must not reach the coach's roster writes). A coach's menu is unchanged.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: async () => {}, getState: async () => null, clearState: async () => {},
}));
const mockDebrief = { form: [], debrief: [], send: [] };
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  listUnfinished: async () => mockDebrief.form,
  listPendingDebriefs: async () => mockDebrief.debrief,
  listUnsentReports: async () => mockDebrief.send,
}));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({ countUpcoming: async () => 1 }));
const mockAdmin = {
  listMySchools: jest.fn(),
  addSchoolForCoach: jest.fn(),
  removeSchoolForCoach: jest.fn(),
};
jest.mock('../../bot/shared/services/observe/observe-school-admin.service', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/observe-school-admin.service'),
  listMySchools: (...a) => mockAdmin.listMySchools(...a),
  addSchoolForCoach: (...a) => mockAdmin.addSchoolForCoach(...a),
  removeSchoolForCoach: (...a) => mockAdmin.removeSchoolForCoach(...a),
}));
const mockProfile = { row: null };
jest.mock('../../bot/shared/services/observe/assignment/leader-source', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/assignment/leader-source'),
  leaderProfile: async () => mockProfile.row,
}));

const H = require('../../bot/shared/handlers/observe-visit-flow.handler');

const SCHOOL = { school_ext_id: 'niete:701', school_name: 'Example School', emis: '701' };
const PRINCIPAL = { id: 'p-1', role: 'principal', school_id: 's-701', preferred_language: 'en' };
const PRINCIPAL_UR = { ...PRINCIPAL, preferred_language: 'ur' };
const COACH = { id: 'c-1', role: 'coach', school_id: null, preferred_language: 'en' };

const COACH_ONLY = ['manage', 'manage_teachers'];
const ids = (r) => r.data.items.map((i) => i.id);
const titles = (r) => r.data.items.map((i) => i['main-content'].title);

beforeEach(() => {
  jest.clearAllMocks();
  mockDebrief.form = []; mockDebrief.debrief = []; mockDebrief.send = [];
  mockAdmin.listMySchools.mockResolvedValue([SCHOOL]);
  mockAdmin.addSchoolForCoach.mockResolvedValue({ ok: true, schoolName: 'X', teachersMapped: 1, teacherCount: 1 });
  mockAdmin.removeSchoolForCoach.mockResolvedValue({ ok: true, schoolName: 'X' });
  mockProfile.row = null;
});

describe('a principal: /observe menu rows are observation actions only', () => {
  it.each([
    ['holding a leader_schools row', [SCHOOL]],
    ['own school only (users.school_id, no holdings)', []],
  ])('%s: no "Add or remove a school", no "Manage teachers"', async (_, holdings) => {
    mockAdmin.listMySchools.mockResolvedValue(holdings);
    const r = await H.menuScreen(PRINCIPAL.id, { user: PRINCIPAL });
    expect(r.screen).toBe('MENU');
    for (const id of COACH_ONLY) expect(ids(r)).not.toContain(id);
    expect(titles(r)).not.toContain('Add or remove a school');
    expect(titles(r)).not.toContain('Manage teachers');
    expect(ids(r)).toEqual(['schedule', 'new', 'self_dc']);
  });

  it('with work waiting: the work rows first, then the observation rows', async () => {
    mockDebrief.form = [{}]; mockDebrief.debrief = [{}, {}]; mockDebrief.send = [{}];
    const r = await H.menuScreen(PRINCIPAL.id, { user: PRINCIPAL });
    expect(ids(r)).toEqual(['work_form', 'debriefs', 'work_send', 'schedule', 'new', 'self_dc']);
  });

  it('Urdu: the same rows ("My own lesson" in Urdu, the list chrome in Latin as for every leader)', async () => {
    const r = await H.menuScreen(PRINCIPAL_UR.id, { user: PRINCIPAL_UR });
    expect(ids(r)).toEqual(['schedule', 'new', 'self_dc']);
    expect(titles(r)).toEqual(['My schedule', 'Schedule new observation', 'میرا اپنا سبق']);
  });

  it('no school at all: never "add your first school" — her own lesson only', async () => {
    mockAdmin.listMySchools.mockResolvedValue([]);
    const noSchool = { ...PRINCIPAL, school_id: null };
    const r = await H.menuScreen(noSchool.id, { user: noSchool });
    expect(ids(r)).toEqual(['self_dc']);
  });

  it('the Flow endpoint (no users row passed): the profile is read and the rows are the same', async () => {
    mockProfile.row = PRINCIPAL;
    const was = process.env.OBSERVE_SCHEDULING_UI;
    process.env.OBSERVE_SCHEDULING_UI = 'true';   // the v2 Flow (MENU), as live on NIETE
    try {
      const r = await H.handle(PRINCIPAL.id, 'INIT', '', {}, PRINCIPAL.id);
      expect(ids(r)).toEqual(['schedule', 'new', 'self_dc']);
    } finally {
      if (was === undefined) delete process.env.OBSERVE_SCHEDULING_UI; else process.env.OBSERVE_SCHEDULING_UI = was;
    }
  });
});

describe('a principal: the roster-admin steps answer with the menu (no write)', () => {
  it.each([
    'add_search_open', 'add_search', 'add_school', 'manage_search', 'manage', 'remove_school',
    'teacher_school_open', 'teacher_action_open', 'teacher_add_commit', 'teacher_remove_commit',
    'teacher_edit_name_commit', 'teacher_edit_phone_commit',
  ])('%s → MENU', async (step) => {
    mockProfile.row = PRINCIPAL;
    const r = await H.handle(PRINCIPAL.id, 'data_exchange', 'ANY', { step, picked: 'niete:701', term: 'x' }, PRINCIPAL.id);
    expect(r.screen).toBe('MENU');
    expect(mockAdmin.addSchoolForCoach).not.toHaveBeenCalled();
    expect(mockAdmin.removeSchoolForCoach).not.toHaveBeenCalled();
  });
});

describe('a coach: unchanged', () => {
  it('the coach menu keeps roster admin', async () => {
    const r = await H.menuScreen(COACH.id, { user: COACH });
    expect(ids(r)).toEqual(['schedule', 'new', 'manage', 'manage_teachers']);
  });

  it('a coach with no school still gets "Start here — add your first school"', async () => {
    mockAdmin.listMySchools.mockResolvedValue([]);
    const r = await H.menuScreen(COACH.id, { user: COACH });
    expect(ids(r)).toEqual(['manage']);
  });

  it('a coach can still open Add or remove a school and add one', async () => {
    mockProfile.row = COACH;
    expect((await H.handle(COACH.id, 'data_exchange', 'MENU', { step: 'add_search_open' }, COACH.id)).screen).toBe('ADD_SEARCH');
    const r = await H.handle(COACH.id, 'data_exchange', 'ADD_RESULTS', { step: 'add_school', picked: 'niete:701' }, COACH.id);
    expect(r.screen).toBe('ACTION_DONE');
    expect(mockAdmin.addSchoolForCoach).toHaveBeenCalledWith(COACH.id, 'niete:701');
  });
});
