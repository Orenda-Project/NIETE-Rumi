/**
 * A NAMELESS TEACHER MUST BE TAPPABLE IN THE ADD/REMOVE/EDIT PICKERS (bd-60109).
 *
 * Reported twice from the field on the ICT sheet — Aleeha ("no option to add
 * teacher name") and Mubasher Irfan ("it gets added without a name", IMSB Thanda
 * Pani 720). Both land on the same place.
 *
 * `displayNameOf` and the `displayName` field already exist and are covered by
 * tests/observe/nameless-teacher-is-findable.test.js — but that suite proves the
 * label reaches the "who did you observe?" list ONLY. The wiring stopped one
 * surface short: `teacher_remove_open` and `teacher_edit_open` build their rows
 * with `p.name`, and `_opt` does `clip(title || '', 30)`, so a person whose
 * `name` is null becomes a row with an EMPTY TITLE — unreadable, indistinguishable
 * from any other blank row, and not safely tappable. She is exactly the person a
 * coach opens Edit to fix, so the blank row also closes the only self-serve way
 * out of the nameless state.
 *
 * Measured on production 2026-09-16: 74 of 213 moves onto a school landed a
 * person with no name; 58 currently hold a school with `name` null.
 *
 * `name` is deliberately NOT the thing to change here — `call-tools.repo.findRoster`
 * reads it aloud on a voice call, so digits must never reach it. The fix is to
 * render the label the resolver already computes.
 *
 * The fixture below is what `listPatchViaSupabase` really returns for such a
 * person: `name: null` AND a non-empty `displayName`.
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
    { school_ext_id: 'niete:720', school_name: 'IMSB(I-X) THANDA PANI', emis: '720' },
  ])),
}));

// Her real shape: no name, but the resolver always supplies a label.
const NAMELESS = {
  userId: 'u-nameless',
  name: null,
  displayName: 'Teacher …0145',
  phone: '923369870145',
  isPrincipal: false, roleLabel: '', band: 'primary',
  schoolName: 'IMSB(I-X) THANDA PANI', emis: '720',
};
const NAMED = {
  userId: 'u-named',
  name: 'Ruqaiya Abbas',
  displayName: 'Ruqaiya Abbas',
  phone: '923473153423',
  isPrincipal: false, roleLabel: '', band: 'primary',
  schoolName: 'IMSB(I-X) THANDA PANI', emis: '720',
};

jest.mock('../../shared/services/observe/patch-resolver.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/patch-resolver.service');
  return { ...actual, listPatchViaSupabase: jest.fn(async () => ([NAMELESS, NAMED])) };
});

const handler = require('../../shared/handlers/observe-visit-flow.handler');

const UID = 'coach-a';
const SCHOOL = 'niete:720';
const step = (s, data = {}) => handler.handle(UID, 'data_exchange', '', { step: s, ...data }, UID, { id: UID });
const rowFor = (res, id) => res.data.options.find((o) => o.id === id);

describe.each([
  ['teacher_remove_open', 'TEACHER_PICK'],
  ['teacher_edit_open', 'TEACHER_EDIT_PICK'],
])('%s — every row is readable', (stepName, screen) => {
  it('renders the nameless teacher with a non-empty title', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    expect(res.screen).toBe(screen);

    const her = rowFor(res, 'u-nameless');
    expect(her).toBeDefined();
    // The defect: `p.name` is null, `_opt` clips it to '', and the coach sees
    // a blank line she cannot tell apart or tap with any confidence.
    expect(her.title.trim()).not.toBe('');
  });

  it('uses the phone-tail label, so the row identifies WHICH person', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    const her = rowFor(res, 'u-nameless');
    expect(her.title).toContain('0145');
    expect(her.title).toMatch(/teacher/i);
  });

  it('never leaks the whole number into the title', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    const her = rowFor(res, 'u-nameless');
    expect(her.title).not.toContain('923369870145');
    expect(her.title).not.toContain('92336987');
  });

  it('leaves a teacher who HAS a name exactly as she was', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    expect(rowFor(res, 'u-named').title).toBe('Ruqaiya Abbas');
  });

  it('keys the row on the user id — the commit needs the id, not the phone', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    expect(rowFor(res, 'u-nameless').id).toBe('u-nameless');
    expect(res.data.school_ext_id).toBe(SCHOOL);
  });

  it('no row anywhere in the list is blank', async () => {
    const res = await step(stepName, { school_ext_id: SCHOOL });
    for (const o of res.data.options) {
      expect(String(o.title || '').trim()).not.toBe('');
    }
  });
});
