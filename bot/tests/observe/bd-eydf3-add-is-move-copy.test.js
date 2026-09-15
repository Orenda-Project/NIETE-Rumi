/**
 * "Add" is also "move", and nothing said so.
 *
 * A coach reported that there is no way to transfer a teacher between schools.
 * The capability works and is in daily use — the roster audit shows three moves
 * by two of the reporting coaches in the last fortnight. What is missing is the
 * words.
 *
 * The coach-facing copy for teacher admin lives in two places. The menu row was
 * renamed to name all three actions; the screen's own intro was not, so the
 * TEACHER_ACTION screen offers three radio options under a sentence that names
 * two, and the move is never named anywhere. At the point of commitment the old
 * school is shown, so the move is inferable, but the confirm heading still says
 * only "We found this teacher's account".
 *
 * Copy only. No behaviour changes, no Flow republish (both fields are composed
 * server-side), no schema change.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

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
  ])),
}));

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const TeacherAdmin = require('../../shared/services/observe/observe-teacher-admin.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const UID = 'coach-a';
const step = (s, data = {}) =>
  handler.handle(UID, 'data_exchange', '', { step: s, ...data }, UID, { id: UID, preferred_language: 'en' });

describe('the TEACHER_ACTION intro names every action it offers', () => {
  it('RED: it names add, remove AND edit', async () => {
    const res = await step('teacher_action_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_ACTION');
    const intro = String(res.data.intro).toLowerCase();
    for (const word of ['add', 'remove', 'edit']) expect(intro).toContain(word);
  });

  it('RED: it says that adding a teacher who is elsewhere moves them here', async () => {
    const res = await step('teacher_action_open', { school_ext_id: 'niete:916' });
    // \b-anchored: "remove" contains "move", and that is the whole confusion.
    expect(String(res.data.intro).toLowerCase()).toMatch(/\bmove[sd]?\b/);
  });

  it('still names the school in full, and never leaks a Flow reference', async () => {
    const res = await step('teacher_action_open', { school_ext_id: 'niete:916' });
    expect(res.data.intro).toContain('IMCG, G-10/2');
    expect(res.data.intro).not.toContain('${');
  });

  it('RED: the sentence is catalogue copy, present in both languages, gender-neutral', () => {
    for (const lang of ['en', 'ur']) {
      const S = observeStrings(lang);
      expect(typeof S.teacher_action_intro).toBe('string');
      expect(S.teacher_action_intro).toContain('{school}');
    }
    expect(/[؀-ۿ]/.test(observeStrings('ur').teacher_action_intro)).toBe(true);
    // Gender-neutral: never "her"/"she"/"his"/"he" about a teacher.
    expect(observeStrings('en').teacher_action_intro).not.toMatch(/\b(her|she|his|he)\b/i);
  });
});

describe('the confirm screen names the move before it happens', () => {
  const plan = {
    outcome: 'move',
    phone: '923001234567',
    person: { userId: 'u1', name: 'Tahira Manzoor', role: 'teacher', isPrincipal: false },
    fromSchoolName: 'IMS(I-V) No.2 G-10/2',
    toSchoolName: 'IMCG, G-10/2',
  };

  it('RED: a move gets its own heading, not the generic "we found an account"', () => {
    const en = TeacherAdmin.foundAccountScreen('en', plan, 'niete:916');
    expect(en.found_heading).not.toBe("We found this teacher's account");
    expect(en.found_heading.toLowerCase()).toMatch(/another school|\bmove[sd]?\b/);
  });

  it('RED: the move heading exists in Urdu too', () => {
    const ur = TeacherAdmin.foundAccountScreen('ur', plan, 'niete:916');
    expect(/[؀-ۿ]/.test(ur.found_heading)).toBe(true);
    expect(ur.found_heading).not.toBe('یہ اکاؤنٹ مل گیا');
  });

  it('the old school and the destination are both still shown', () => {
    const en = TeacherAdmin.foundAccountScreen('en', plan, 'niete:916');
    expect(en.found_details).toContain('IMS(I-V) No.2 G-10/2');
    expect(en.plan).toContain('IMCG, G-10/2');
  });

  it('a brand-new account keeps its own heading', () => {
    const en = TeacherAdmin.foundAccountScreen('en', { ...plan, outcome: 'new', fromSchoolName: null }, 'niete:916');
    expect(en.found_heading).toBe('No account on this number yet');
  });

  it('someone already at this school keeps the found heading and the nothing-to-change line', () => {
    const en = TeacherAdmin.foundAccountScreen('en', { ...plan, outcome: 'already_here' }, 'niete:916');
    expect(en.found_heading).toBe("We found this teacher's account");
    expect(en.plan).toMatch(/already/i);
  });
});

describe('the menu row names the move', () => {
  it('RED: the Manage teachers row says a move is possible, inside the metadata cap', async () => {
    const res = await handler.menuScreen(UID);
    const row = (res.data.items || []).find((i) => i.id === 'manage_teachers');
    expect(row).toBeTruthy();
    const meta = row['main-content'].metadata;
    expect(meta.toLowerCase()).toMatch(/\bmove[sd]?\b/);
    expect([...meta].length).toBeLessThanOrEqual(80);
  });
});
