/**
 * The Flow half: the steps behind the teacher screens (TDD, red-first).
 *
 * The highest-value assertion here is the LAST describe block, and it exists
 * because of a live outage class in this exact flow: a screen DECLARES its data
 * keys, and a payload that omits one fails the screen with no visible error —
 * the coach taps and nothing opens. Removing a school was invisibly broken on
 * production for exactly that reason. So every screen these steps return is
 * checked against the keys the published JSON declares.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const flow = require('../../../docs/flows/observe-visit-v2.json');

// The handler reaches for supabase and the schedule service on the way to any
// screen; with a localhost URL those become real fetches that time out one by
// one. Neutralise them — this suite is about the STEPS, not the data layer.
jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const q = {
      select: () => q, eq: () => q, in: () => q, is: () => q, not: () => q,
      order: () => q, limit: () => q, maybeSingle: async () => ({ data: null }),
      then: (r) => r({ data: [], error: null }),
    };
    return q;
  },
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  listUpcoming: jest.fn(async () => []),
  listPendingDebriefs: jest.fn(async () => []),
}));

jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  ...jest.requireActual('../../shared/services/observe/observe-school-admin.service'),
  listMySchools: jest.fn(async () => ([
    { school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2', emis: '916' },
    { school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273' },
  ])),
}));

jest.mock('../../shared/services/observe/observe-teacher-admin.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/observe-teacher-admin.service');
  return {
    ...actual,
    planAdd: jest.fn(async () => ({
      outcome: 'move', teacherName: 'Tahira Manzoor', phone: '923001234567',
      fromSchoolName: 'IMS(I-V) No.2 G-10/2', toSchoolName: 'IMCG, G-10/2',
      coachesLosingHer: 2,
    })),
    commitAdd: jest.fn(async () => ({
      outcome: 'move', wrote: true, teacherName: 'Tahira Manzoor',
      schoolName: 'IMCG, G-10/2', visitsCancelled: 1, coachesNotified: 2, notifyFailed: 0,
    })),
    listTeachersAtSchool: jest.fn(async () => ([
      { teacher_ext_id: '923001234567', teacher_name: 'Tahira Manzoor', teacher_phone_e164: '923001234567', level: 'PRIMARY' },
    ])),
    planRemoval: jest.fn(async () => ({
      ok: true, teacherName: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2',
      coachesAffected: 2, upcomingVisits: 1,
    })),
    commitRemoval: jest.fn(async () => ({
      ok: true, teacherName: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2',
      coachesAffected: 2, visitsCancelled: 1, coachesNotified: 1, notifyFailed: 0,
    })),
  };
});

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const TeacherAdmin = require('../../shared/services/observe/observe-teacher-admin.service');

const UID = 'coach-a';
const step = (s, data = {}) => handler.handle(UID, 'data_exchange', '', { step: s, ...data }, UID, { id: UID });

describe('the coach can reach teacher admin from the menu', () => {
  it('the menu offers it as its own action, not buried in the school one', async () => {
    const res = await handler.menuScreen(UID);
    const item = (res.data.items || []).find((i) => String(i.id).includes('teacher'));
    expect(item).toBeTruthy();
    expect(item['on-click-action'].payload.step).toBe('teacher_school_open');
  });
});

describe('adding', () => {
  it('teacher_school_open lists her own schools to choose from', async () => {
    const res = await step('teacher_school_open');
    expect(res.screen).toBe('TEACHER_SCHOOL');
    expect(res.data.options.map((o) => o.id)).toContain('niete:916');
  });

  it('teacher_add_open carries the school through, named', async () => {
    const res = await step('teacher_add_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_ADD');
    expect(res.data).toMatchObject({ school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2' });
  });

  it('teacher_add_lookup shows the plan and writes NOTHING yet', async () => {
    const res = await step('teacher_add_lookup', {
      school_ext_id: 'niete:916', phone: '03001234567', name: '',
    });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.plan).toContain('Tahira Manzoor');
    expect(TeacherAdmin.commitAdd).not.toHaveBeenCalled();
    // The confirm screen has to hand every field back, or the commit loses them.
    expect(res.data).toMatchObject({ school_ext_id: 'niete:916', phone: '923001234567' });
  });

  it('a bad number ends the flow with a reason, never a crash', async () => {
    TeacherAdmin.planAdd.mockResolvedValueOnce({ outcome: 'invalid_phone' });
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '12345' });
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toMatch(/number/i);
  });

  it('an ambiguous number refuses and says why', async () => {
    TeacherAdmin.planAdd.mockResolvedValueOnce({
      outcome: 'ambiguous',
      candidates: [{ teacherName: 'Ayesha Khan' }, { teacherName: 'Bilal Ahmed' }],
    });
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '03001234567' });
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toMatch(/more than one|two/i);
  });

  it('teacher_add_commit is what actually writes', async () => {
    const res = await step('teacher_add_commit', {
      school_ext_id: 'niete:916', phone: '923001234567', name: 'Tahira Manzoor',
    });
    expect(TeacherAdmin.commitAdd).toHaveBeenCalled();
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toContain('Tahira Manzoor');
  });
});

describe('removing', () => {
  it('teacher_remove_open lists her teachers at that school', async () => {
    const res = await step('teacher_remove_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_PICK');
    expect(res.data.options[0].id).toBe('923001234567');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('teacher_remove_check warns about the visits it will cancel', async () => {
    const res = await step('teacher_remove_check', {
      school_ext_id: 'niete:916', teacher_ext_id: '923001234567',
    });
    expect(res.screen).toBe('TEACHER_REMOVE_CONFIRM');
    expect(res.data.plan).toMatch(/visit/i);
    expect(TeacherAdmin.commitRemoval).not.toHaveBeenCalled();
  });

  it('teacher_remove_commit writes and reports what happened', async () => {
    const res = await step('teacher_remove_commit', {
      school_ext_id: 'niete:916', teacher_ext_id: '923001234567', reason: 'left',
    });
    expect(TeacherAdmin.commitRemoval).toHaveBeenCalled();
    expect(res.screen).toBe('TEACHER_DONE');
  });

  it('teacher_cancel backs out without writing', async () => {
    const res = await step('teacher_cancel');
    expect(res.screen).toBe('TEACHER_DONE');
    expect(TeacherAdmin.commitAdd).not.toHaveBeenCalled();
    expect(TeacherAdmin.commitRemoval).not.toHaveBeenCalled();
  });
});

// ── the outage class this flow already suffered ────────────────────────

describe('every screen these steps return satisfies the keys it declares', () => {
  const declared = (sid) => {
    const s = flow.screens.find((x) => x.id === sid);
    return Object.keys((s && s.data) || {});
  };

  const CASES = [
    ['teacher_school_open', {}],
    ['teacher_add_open', { school_ext_id: 'niete:916' }],
    ['teacher_add_lookup', { school_ext_id: 'niete:916', phone: '03001234567' }],
    ['teacher_add_commit', { school_ext_id: 'niete:916', phone: '923001234567', name: 'T' }],
    ['teacher_remove_open', { school_ext_id: 'niete:916' }],
    ['teacher_remove_check', { school_ext_id: 'niete:916', teacher_ext_id: '923001234567' }],
    ['teacher_remove_commit', { school_ext_id: 'niete:916', teacher_ext_id: '923001234567' }],
    ['teacher_cancel', {}],
  ];

  it.each(CASES)('%s returns every key its screen declares', async (s, data) => {
    const res = await step(s, data);
    const missing = declared(res.screen).filter((k) => !(k in (res.data || {})));
    expect({ screen: res.screen, missing }).toEqual({ screen: res.screen, missing: [] });
  });
});

// ── the loop back, which a terminal screen cannot do on its own ────────

describe('the "what next?" tap after a teacher change', () => {
  const { rosterTeacherNextTarget } = require('../../shared/services/observe/observe-teacher-admin.service');

  it('reopens rather than falling through to the capture prompt', () => {
    // The visit action this screen emits must have its OWN branch. An
    // unhandled action falls through to buildVisitCapturePrompt, which
    // answers a roster tap with "tell me about the lesson you observed".
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/handlers/flow-response.handler.js'), 'utf8');
    expect(src).toMatch(/visitAction === 'roster_teacher'/);
  });

  it('every option the screen offers has a target', () => {
    const screen = flow.screens.find((s) => s.id === 'TEACHER_DONE');
    const radio = screen.layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    for (const opt of radio['data-source']) {
      expect(rosterTeacherNextTarget(opt.id)).toBeTruthy();
    }
  });

  it('looping back goes through the endpoint, never a bare navigate', () => {
    // TEACHER_SCHOOL and TEACHER_PICK DECLARE `options`, and navigate mode has
    // no endpoint round trip to fill them — the screen would fail silently.
    // So a loop reopens at MENU in data_exchange mode: one extra tap, always live.
    for (const id of ['teacher_add', 'teacher_remove']) {
      const t = rosterTeacherNextTarget(id);
      expect(t.reopen).toBe(true);
      expect(t.screen).toBeNull();
    }
  });

  it('"I\'m done" closes instead of reopening', () => {
    expect(rosterTeacherNextTarget('done')).toMatchObject({ reopen: false });
    expect(rosterTeacherNextTarget('anything-stale')).toMatchObject({ reopen: false });
  });
});
