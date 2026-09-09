/**
 * /class ROSTER: the coach must be able to proof-read EVERY child. (bd-as5e4)
 *
 * Field report, Coach Mubashar Zia, 2026-09-08: the edit screen listed children
 * 32-40 and then a bare `… +4`. Four children were invisible, with nothing on the
 * screen saying why. The agreement is that coaches see all students, because
 * proof-reading the names IS the job on this screen.
 *
 * The cause was a FIXED count, not a budget: `students.slice(0, 40)`. Meta's
 * TextBody cap is 4096 characters; against ICT production on 2026-09-09 the whole
 * roster of the LARGEST class in the deployment renders to 1,109 code points. So
 * the four children were dropped with roughly 3,000 code points of room to spare.
 *
 * Two DIFFERENT truncations live on this screen and must never read as one:
 *   - the roster TEXT (TextBody) — no longer capped by count, only by the budget;
 *   - the removal CheckboxGroup — genuinely capped at 20 options by Meta.
 * The coach saw the removal-cap sentence while the display was the thing that had
 * silently cut her list.
 *
 * These tests drive the real endpoint through the real data path (fake Supabase at
 * the network boundary), so they execute rosterText()/buildRosterScreen().
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';

// Meta's documented cap on a Flow TextBody, in characters.
// https://developers.facebook.com/docs/whatsapp/flows/reference/components
const TEXT_BODY_CAP = 4096;

const cp = (s) => [...String(s)].length;

const REF = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
  subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
  academic_sessions: [
    { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
  ],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
};

let ep;
function boot({ students = [], enrollments = [], language = 'en' } = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: language }],
    ...REF,
    classes: [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }],
    class_teachers: [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER,
      is_class_teacher: true, is_active: true, ended_on: null,
    }],
    class_teacher_subjects: [],
    class_enrollments: enrollments,
    student_lists: [],
    students,
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

/** A class of `n` children, each with a distinct name and a roll number. */
function classOf(n, nameFor) {
  const students = [];
  const enrollments = [];
  for (let i = 1; i <= n; i += 1) {
    students.push({ id: `s${i}`, student_name: nameFor(i), roll_number: i, is_active: true });
    enrollments.push({ id: `e${i}`, class_id: CLASS_ID, student_id: `s${i}`, roll_number: i, is_active: true });
  }
  return { students, enrollments };
}

const openRoster = () => ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

// ---------------------------------------------------------------------------

describe('a 44-child class — the reported screen', () => {
  // 44 children with ordinary names is ~700 code points: a sixth of the budget.
  const NAMES = [
    'Aleeha Noor', 'Bilal Ahmed', 'Zainab Fatima', 'Hamza Tariq', 'Ayesha Khan',
    'Usman Raza', 'Maryam Bibi', 'Ibrahim Ali', 'Hafsa Iqbal', 'Danish Malik',
  ];
  const nameFor = (i) => `${NAMES[(i - 1) % NAMES.length]} ${i}`;

  beforeEach(() => boot(classOf(44, nameFor)));

  it('lists ALL 44 children, because proof-reading is the job on this screen', async () => {
    const res = await openRoster();
    expect(res.screen).toBe('ROSTER');

    const missing = [];
    for (let i = 1; i <= 44; i += 1) if (!res.data.roster.includes(nameFor(i))) missing.push(nameFor(i));
    expect(missing).toEqual([]);
    expect(res.data.roster.split('\n')).toHaveLength(44);
  });

  it('shows no truncation marker at all — nothing was truncated', async () => {
    const res = await openRoster();
    expect(res.data.roster).not.toMatch(/\+\s*\d/);
    expect(res.data.roster).not.toMatch(/more/i);
  });

  it('still fits inside Meta’s TextBody cap', async () => {
    const res = await openRoster();
    expect(cp(res.data.roster)).toBeLessThanOrEqual(TEXT_BODY_CAP);
  });

  it('the removal hint is about the CHECKBOX cap only, and the list is complete', async () => {
    const res = await openRoster();
    // 44 > 20, so the removal group is genuinely capped and says so...
    expect(res.data.remove_options).toHaveLength(20);
    expect(res.data.hint).toMatch(/first 20/i);
    // ...but that sentence must not be the only explanation on a screen whose list
    // is complete. Nothing here is hidden from view.
    expect(res.data.roster).toContain(nameFor(44));
  });
});

describe('a class that genuinely does not fit', () => {
  // Long Nastaliq names. 200 children x ~45 code points overruns 4096 outright.
  const nameFor = (i) => `محمد عبد الرحمٰن بن عبد اللہ صدیقی ${i}`;

  it('(en) tells the coach how many are not shown, and why', async () => {
    boot({ ...classOf(200, nameFor), language: 'en' });
    const res = await openRoster();

    expect(cp(res.data.roster)).toBeLessThanOrEqual(TEXT_BODY_CAP);
    // A bare "… +N" is what the coach complained about. The screen must say the
    // number AND the reason, in a sentence.
    expect(res.data.roster).toMatch(/\bnot shown\b/i);
    expect(res.data.roster).toMatch(/too long/i);

    const listed = res.data.roster.split('\n').filter((l) => /^\d+\. /.test(l)).length;
    expect(listed).toBeGreaterThan(80);          // packed to the budget, not to 40
    expect(res.data.roster).toContain(String(200 - listed));
  });

  it('(ur) says it in Urdu, and never in the removal-cap words', async () => {
    boot({ ...classOf(200, nameFor), language: 'ur' });
    const res = await openRoster();

    expect(cp(res.data.roster)).toBeLessThanOrEqual(TEXT_BODY_CAP);
    expect(res.data.roster).toMatch(/نہیں دکھائے/);
    // The removal-cap sentence explains a DIFFERENT truncation. If the same words
    // appear in both places the coach cannot tell which children she is missing.
    expect(res.data.roster).not.toMatch(/نکالنے کے لیے/);
    expect(res.data.hint).toMatch(/نکالنے کے لیے/);
  });

  it('packs to the budget rather than to a fixed count', async () => {
    boot({ ...classOf(200, nameFor), language: 'en' });
    const res = await openRoster();
    // Within one line of the cap: the last line that fit is genuinely the last
    // line that fits.
    expect(cp(res.data.roster)).toBeGreaterThan(TEXT_BODY_CAP - 120);
  });
});

describe('the largest class actually in ICT production (81 children)', () => {
  const nameFor = (i) => `طالب علم نمبر ${i}`;

  it('is shown in full — it renders to about a quarter of the budget', async () => {
    boot({ ...classOf(81, nameFor), language: 'ur' });
    const res = await openRoster();
    expect(res.data.roster.split('\n')).toHaveLength(81);
    expect(res.data.roster).toContain(nameFor(81));
    expect(cp(res.data.roster)).toBeLessThan(TEXT_BODY_CAP);
  });
});
