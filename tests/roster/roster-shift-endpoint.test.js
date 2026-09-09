/**
 * bd-ff2e9 — /roster cannot express a SHIFT, so an evening class is scanned into a
 * second, morning class row and the teacher's own class stays empty.
 *
 * A class's identity is (school, grade, section, shift, session): createClass is
 * idempotent on exactly that tuple (class.service.js:137-155). `/class` lets the
 * teacher pick her shift (class-manager-endpoint.js:462-463). `/roster` collects
 * grade, section and class teacher and nothing else — the word "shift" does not
 * occur once in roster-flow-endpoint.js — so saveRoster calls importRoster with no
 * shiftCode and it takes the parameter default 'morning' (class.service.js:1074).
 *
 * Measured on prod (ihzciabopbttygxxgrkm, 8 Sep 2026, read-only): 11,647 children
 * were created by a scan and 11,356 active enrolments of those children are in a
 * morning class — 100% of them. Not one scanned child sits in any of the 22 evening
 * classes. 13 teachers are standing on an empty twin of their own class today,
 * 374 children on the other side.
 *
 * These tests drive the REAL endpoint path — the CLASS data_exchange that reads the
 * screen payload, and saveRoster which hands it to the one writer. Supabase is mocked
 * at the network boundary; nothing inside roster-flow-endpoint.js is stubbed.
 */

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

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const TEACHER = 'teacher-1';
const SESSION = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
})();

const KIDS = [
  { roll_number: '1', student_name: 'M. Ayyan', father_name: null, parent_phone: null },
  { roll_number: '2', student_name: 'Fiza Khan', father_name: null, parent_phone: null },
  { roll_number: '3', student_name: 'Hooria', father_name: null, parent_phone: null },
];
const CHUNK = KIDS.map((k, i) => `${i + 1}. ${k.student_name}`).join('\n');

function seed() {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'Test School' }],
    grade_levels: [{ code: 'grade_5', ordinal: 5, band: 'primary', aliases: ['grade_5'], is_active: true }],
    academic_sessions: [{
      code: SESSION, kind: 'annual', starts_on: `${SESSION.slice(0, 4)}-04-01`, ends_on: `${SESSION.slice(5)}-03-31`, is_active: true,
    }],
    sections: [
      { code: 'A', sort_order: 1, is_active: true },
      { code: 'B', sort_order: 2, is_active: true },
    ],
    // Both shifts are seeded in prod: shifts = [morning(1), evening(2)], both active.
    shifts: [
      { code: 'morning', sort_order: 1, is_active: true },
      { code: 'evening', sort_order: 2, is_active: true },
    ],
    users: [
      { id: TEACHER, first_name: 'Test', last_name: 'Teacher', role: 'teacher', school_id: SCHOOL },
    ],
    leader_teachers: [],
    subjects: [],
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    students: [],
    student_lists: [],
  });
}

// ---------------------------------------------------------------------------
// A. THE WIRING — the CLASS payload reaches the one writer
// ---------------------------------------------------------------------------

describe('the shift the coach picks reaches importRoster', () => {
  let endpoint;

  function boot(extra = {}) {
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
      ...extra,
    });
    return endpoint._pending.get('u1');
  }

  beforeEach(() => {
    mockDb = seed();
    mockImport = jest.fn().mockResolvedValue({ classId: 'c1', added: 3, skipped: 0, classTeacherAssigned: true });
  });

  it('an EVENING class is saved as an evening class', async () => {
    const state = boot();
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', shift_code: 'evening', teacher_user_id: TEACHER,
    });
    await endpoint.saveRoster(state, { chunk1: CHUNK });

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport.mock.calls[0][0].shiftCode).toBe('evening');
  });

  it('the CLASS screen offers the shifts the database actually has', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'PHOTOS', { pages: [{ id: 'p1' }] });
    expect(res.screen).toBe('CLASS');
    expect(res.data.shifts).toEqual([
      { id: 'morning', title: 'Morning' },
      { id: 'evening', title: 'Evening' },
    ]);
  });

  it('the audit manifest records the shift beside the grade and the section', async () => {
    const state = boot();
    // Same module registry as the endpoint — boot() resets it, so require AFTER.
    // eslint-disable-next-line global-require
    const storage = require('../../bot/shared/services/roster/roster-storage');
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', shift_code: 'evening', teacher_user_id: TEACHER,
    });
    await endpoint.saveRoster(state, { chunk1: CHUNK });

    const manifest = storage.putManifest.mock.calls.at(-1)[0].manifest;
    expect(manifest.shift_code).toBe('evening');
    expect(manifest.shift_source).toBe('coach');
  });

  it('"No section" is a real answer, not a blank — it saves the un-sectioned class', async () => {
    const state = boot();
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'none', shift_code: 'morning', teacher_user_id: TEACHER,
    });
    await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(mockImport.mock.calls[0][0].section).toBeNull();
  });

  // BACK-COMPAT. A session opened before the new Flow was published, or the old
  // published Flow still serving, posts a CLASS payload with no shift_code at all.
  // It must not crash and it must not pretend the coach chose morning.
  it('a payload with NO shift_code still saves, as morning, and says so in the manifest', async () => {
    const state = boot();
    // Same module registry as the endpoint — boot() resets it, so require AFTER.
    // eslint-disable-next-line global-require
    const storage = require('../../bot/shared/services/roster/roster-storage');
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', teacher_user_id: TEACHER,
    });
    expect(res.screen).toBe('REVIEW');

    await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(mockImport.mock.calls[0][0].shiftCode).toBe('morning');

    const manifest = storage.putManifest.mock.calls.at(-1)[0].manifest;
    expect(manifest.shift_code).toBe('morning');
    // The residual has to be COUNTABLE. 'default' is the flag that says nobody chose.
    expect(manifest.shift_source).toBe('default');
  });

  it('a shift the database does not have gets honest copy, not the catch-all', async () => {
    const state = boot();
    mockImport.mockResolvedValue({ error: 'unknown_shift', shift: 'afternoon' });
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', shift_code: 'afternoon', teacher_user_id: TEACHER,
    });
    const res = await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(JSON.stringify(res)).toMatch(/shift/i);
    expect(JSON.stringify(res)).not.toMatch(/The roster could not be saved/);
  });
});


// ---------------------------------------------------------------------------
// C. bd-dz6qb.5 — skipping the class teacher must not be silent
// ---------------------------------------------------------------------------

describe('the cost of skipping the class teacher is stated where the coach chooses', () => {
  let endpoint;

  beforeEach(() => {
    mockDb = seed();
    mockImport = jest.fn().mockResolvedValue({
      classId: 'c1', added: 3, skipped: 0, classTeacherAssigned: false,
    });
    jest.resetModules();
    // eslint-disable-next-line global-require
    endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
    endpoint._pending.set('u1', {
      user: { id: COACH, role: 'coach' },
      schools: [{ id: SCHOOL, title: 'Test School' }],
      schoolId: SCHOOL,
      schoolName: 'Test School',
      stored: [],
    });
  });

  it('the skip option names what is lost, and the screen carries the warning', async () => {
    const res = await endpoint.handleRosterDataExchange('u1', 'PHOTOS', { pages: [{ id: 'p1' }] });
    expect(res.screen).toBe('CLASS');

    const skip = res.data.teachers.find((t) => t.id === 'none');
    expect(skip.title).not.toBe('Not listed / skip');
    expect(skip.title.toLowerCase()).toMatch(/attendance/);
    expect([...skip.title].length).toBeLessThanOrEqual(30);

    // The consequence, in full, on the screen the coach is looking at.
    expect(res.data.teacher_help).toMatch(/attendance/i);
    expect([...res.data.teacher_help].length).toBeLessThanOrEqual(80);
  });

  it('the copy is gender-neutral — no teacher is called "she" or "her"', async () => {
    const res = await endpoint.handleRosterDataExchange('u1', 'PHOTOS', { pages: [{ id: 'p1' }] });
    const copy = [res.data.teacher_help, ...res.data.teachers.map((t) => t.title)].join(' ');
    expect(copy).not.toMatch(/\b(she|her|hers|he|him|his)\b/i);
  });

  it('a save with no class teacher says so, instead of saying nothing', async () => {
    const state = endpoint._pending.get('u1');
    Object.assign(state, {
      runId: 'run-fixed',
      gradeCode: 'grade_5',
      section: 'A',
      shiftCode: 'morning',
      classTeacherUserId: null,
      extraction: { model: 'test', raw: [], problems: [], students: KIDS },
      rendered: KIDS.map((k, i) => ({ id: `new-${i}`, ...k })),
    });
    const res = await endpoint.saveRoster(state, { chunk1: CHUNK });
    expect(res.data.body).toMatch(/no class teacher/i);
    expect(res.data.body).toMatch(/attendance/i);
    expect([...res.data.body].length).toBeLessThanOrEqual(1024);
  });
});

// ---------------------------------------------------------------------------
// D. The Flow asset's half of the same contract.
//
// This is a SUPPLEMENT to the wiring tests above, never a substitute: a screen can
// declare every field and still be wired to nothing, which is exactly the shape of
// the bug this file exists for. What it does catch is the other direction — an edit
// to the asset that drops shift_code from the submit, which would put the endpoint
// straight back on the parameter default with nothing failing.
// ---------------------------------------------------------------------------

describe('the CLASS screen asset carries the whole class identity', () => {
  // eslint-disable-next-line global-require
  const flow = require('../../docs/flows/roster-flow-v1.json');
  const screen = flow.screens.find((s) => s.id === 'CLASS');
  const fields = screen.layout.children[0].children;
  const byName = (n) => fields.find((c) => c.name === n);

  it('asks for grade, section and shift, and every one of them is required', () => {
    for (const name of ['grade_code', 'section', 'shift_code']) {
      expect(byName(name)).toBeDefined();
      expect(byName(name).required).toBe(true);
    }
  });

  it('submits all three, so the endpoint never has to guess one', () => {
    const payload = fields.find((c) => c.type === 'Footer').on_click_action
      || fields.find((c) => c.type === 'Footer')['on-click-action'];
    expect(Object.keys(payload.payload)).toEqual(
      expect.arrayContaining(['grade_code', 'section', 'shift_code', 'teacher_user_id']),
    );
  });

  it('the class teacher stays OPTIONAL, and the consequence is on the screen', () => {
    expect(byName('teacher_user_id').required).toBe(false);
    // Meta refuses `helper-text` on a Dropdown (INVALID_PROPERTY_KEY, from its own
    // validator), so the warning is a caption immediately beneath the field.
    expect(byName('teacher_user_id')['helper-text']).toBeUndefined();
    const i = fields.indexOf(byName('teacher_user_id'));
    expect(fields[i + 1]).toEqual({ type: 'TextCaption', text: '${data.teacher_help}' });
  });

  it('every ${data.x} the screen binds is declared in its data block', () => {
    const bound = [...JSON.stringify(screen.layout).matchAll(/\$\{data\.(\w+)\}/g)].map((m) => m[1]);
    expect([...new Set(bound)].sort()).toEqual(
      expect.arrayContaining(['caption', 'grades', 'sections', 'shifts', 'teacher_help', 'teachers']),
    );
    for (const key of new Set(bound)) expect(screen.data[key]).toBeDefined();
  });
});
