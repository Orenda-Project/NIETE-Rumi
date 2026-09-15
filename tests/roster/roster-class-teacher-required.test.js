/**
 * The class-teacher field on the /roster CLASS screen is REQUIRED.
 *
 * WhatsApp prints "(Optional)" beside any `required: false` field and offers no
 * "blank but not optional" setting, so with the field optional the one choice
 * that decides whether anyone can ever mark these children's attendance read as
 * the one choice a coach could skip. Field report (region thread, 15 Sep): the
 * coaches read it exactly that way. Required means the coach must SAY something —
 * and the thing she can say when the teacher has no account is the explicit
 * escape, 'Not listed — no attendance', which the endpoint already maps to a null
 * class teacher. Nothing about the save changes; only the form stops calling the
 * decision optional.
 *
 * Two halves, both asserted against the live artefacts:
 *   1. the Flow ASSET declares the field required (this is what Meta renders);
 *   2. the ENDPOINT still saves a class whose coach chose 'none', with
 *      classTeacherUserId null — driven through the real CLASS data_exchange and
 *      saveRoster, Supabase mocked at the network boundary.
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
let mockImport;
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: (...a) => mockImport(...a),
  applyRosterEdits: jest.fn(),
  normalizeSection: (s) => (s ? String(s).trim().toUpperCase() : null),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: jest.fn(() => 'run-fixed'),
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn(async () => ({ data: Buffer.from('x'), fileName: 'p.jpg' })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'flows', 'roster-flow-v1.json'), 'utf8'));

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const TEACHER = 'teacher-1';
const KIDS = [
  { roll_number: '1', student_name: 'M. Ayyan', father_name: null, parent_phone: null },
  { roll_number: '2', student_name: 'Fiza Khan', father_name: null, parent_phone: null },
];
const CHUNK = KIDS.map((k, i) => `${i + 1}. ${k.student_name}`).join('\n');

function findField(screenId, name) {
  const screen = FLOW.screens.find((s) => s.id === screenId);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.name === name && node.type) return node;
    for (const child of (node.children || [])) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(screen.layout);
}

describe('roster Flow asset — the class-teacher field is required', () => {
  it('CLASS.teacher_user_id is a Dropdown declared required:true (no "(Optional)" from Meta)', () => {
    const field = findField('CLASS', 'teacher_user_id');
    expect(field).toBeTruthy();
    expect(field.type).toBe('Dropdown');
    expect(field.required).toBe(true);
  });

  it('the escape option is still documented on the asset — a required field needs a sayable "no"', () => {
    const screen = FLOW.screens.find((s) => s.id === 'CLASS');
    const example = screen.data.teachers.__example__;
    expect(example.some((o) => o.id === 'none')).toBe(true);
  });
});

describe('roster endpoint — "Not listed" still saves with no class teacher', () => {
  let endpoint;

  function boot() {
    jest.resetModules();
    // eslint-disable-next-line global-require
    endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
    endpoint._pending.set('u1', {
      user: { id: COACH, role: 'coach' },
      schools: [{ id: SCHOOL, title: 'Test School' }],
      schoolId: SCHOOL,
      schoolName: 'Test School',
      runId: 'run-fixed',
      stored: [],
      extraction: { model: 'test', raw: [], problems: [], students: KIDS },
    });
    return endpoint._pending.get('u1');
  }

  beforeEach(() => {
    mockDb = createFakeSupabase({
      schools: [{ id: SCHOOL, name: 'Test School' }],
      grade_levels: [{ code: 'grade_3', ordinal: 3, band: 'primary', is_active: true }],
      sections: [{ code: 'A', sort_order: 1, is_active: true }],
      shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
      users: [{ id: TEACHER, name: 'Test Teacher', role: 'teacher', school_id: SCHOOL }],
      leader_teachers: [],
      classes: [],
      class_enrollments: [],
    });
    mockImport = jest.fn().mockResolvedValue({ classId: 'c1', added: 2, skipped: 0, classTeacherAssigned: false });
  });

  it('the CLASS screen still offers "none" as the last option, so the required field can be completed', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'PHOTOS', { pages: [{ id: 'p1' }] });
    expect(res.screen).toBe('CLASS');
    const last = res.data.teachers[res.data.teachers.length - 1];
    expect(last.id).toBe('none');
    // 30 code points is Meta's Dropdown title cap.
    expect([...last.title].length).toBeLessThanOrEqual(30);
  });

  it('a submit with teacher_user_id = "none" saves the class with classTeacherUserId null', async () => {
    const state = boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_3', section: 'A', shift_code: 'morning', teacher_user_id: 'none',
    });
    expect(res.screen).toBe('REVIEW');
    const saved = await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(saved.screen).toBe('SAVED');
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport.mock.calls[0][0].classTeacherUserId).toBeNull();
    // And the coach is told the cost, on the screen she is looking at.
    expect(saved.data.body).toMatch(/No class teacher was named/);
  });

  it('a named teacher still reaches the writer as the class teacher', async () => {
    const state = boot();
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_3', section: 'A', shift_code: 'morning', teacher_user_id: TEACHER,
    });
    await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(mockImport.mock.calls[0][0].classTeacherUserId).toBe(TEACHER);
  });
});
