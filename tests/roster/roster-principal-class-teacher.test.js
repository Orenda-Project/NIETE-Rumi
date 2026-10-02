/**
 * bd-37lyd — a principal CAN be named the class teacher of a class, and a person
 * with no name on file is still offered.
 *
 * `teachersFor` skipped every role in `LEADER_ROLES`, which includes `principal`.
 * `/observe` — the other screen that picks a person at a school — deliberately
 * does the opposite: `PATCH_ROLES = {teacher, principal}`, and it LABELS the
 * principals it offers ("an unlabelled principal in a teacher picker is how the
 * wrong person gets observed"). So the same person was observable and not
 * nameable, on the same deployment, from two screens the same coach uses.
 *
 * Measured on prod: 262 principals and 21 blank-name users across 229 schools
 * were hidden from /roster while /observe offered them. In a small NIETE school
 * the principal often teaches a class; refusing to name them means nobody can
 * mark that class's attendance at all.
 *
 * Two more things this pins, both of which were silently wrong:
 *   · the Dropdown title cap is 30 CODE POINTS, so the "(Principal)" suffix has
 *     to survive truncation of the name — not be truncated off the end of it;
 *   · a blank name degrades to /observe's own label (role + last four digits of
 *     the phone) rather than being dropped from the list.
 *
 * Supabase is mocked at the NETWORK boundary — the real `teachersFor` runs.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: jest.fn(),
  applyRosterEdits: jest.fn(),
  handOverClass: jest.fn(),
  normalizeSection: (s) => (s ? String(s).trim().toUpperCase() : null),
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

const endpoint = require('../../bot/shared/routes/roster-flow-endpoint');

const cp = (s) => [...String(s == null ? '' : s)].length;

const SCHOOL = 'school-1';
const COACH = { id: 'coach-1', role: 'coach', school_id: SCHOOL, name: 'Coach Ali' };

/** 12 code points, so name + ' (Principal)' = 24 and nothing is clipped. */
const PRINCIPAL = {
  id: 'p1', role: 'principal', school_id: SCHOOL,
  name: 'Zulfiqar Ali', phone_number: '923001112233',
};
const TEACHER = {
  id: 't1', role: 'teacher', school_id: SCHOOL,
  name: 'Fiza Khan', phone_number: '923004445566',
};
const OTHER_COACH = {
  id: 'c2', role: 'coach', school_id: SCHOOL,
  name: 'Another Coach', phone_number: '923007778899',
};
const SUPERVISOR = {
  id: 's1', role: 'supervisor', school_id: SCHOOL,
  name: 'A Supervisor', phone_number: '923001010101',
};
const AEO = {
  id: 'a1', role: 'aeo', school_id: SCHOOL,
  name: 'An AEO', phone_number: '923002020202',
};
const LEADER = {
  id: 'l1', role: 'school_leader', school_id: SCHOOL,
  name: 'A School Leader', phone_number: '923003030303',
};
/** 21 of these on prod. `name` is empty, and the phone is all we can show. */
const NAMELESS = {
  id: 'b1', role: 'teacher', school_id: SCHOOL,
  name: '   ', phone_number: '923009998877',
};
/** A principal whose name alone is longer than the whole Dropdown title cap. */
const LONG_PRINCIPAL = {
  id: 'p2', role: 'principal', school_id: SCHOOL,
  name: 'Muhammad Abdul Rehman Khan Niazi Sahib', phone_number: '923005050505',
};

function seed(users) {
  mockDb = createFakeSupabase({
    users: [COACH, ...users],
    leader_teachers: [],
    leader_schools: [{ leader_user_id: COACH.id, school_id: SCHOOL, school_name: 'Test School' }],
    schools: [{ id: SCHOOL, name: 'Test School' }],
  });
}

beforeEach(() => jest.clearAllMocks());

describe('teachersFor — who a coach may name as the class teacher', () => {
  it('OFFERS the principal, and still refuses the roles that genuinely cannot teach a class', async () => {
    seed([PRINCIPAL, TEACHER, OTHER_COACH, SUPERVISOR, AEO, LEADER]);

    const ids = (await endpoint.teachersFor(COACH, SCHOOL)).map((o) => o.id);

    // The whole point: /observe offers this person, so /roster must too.
    expect(ids).toContain(PRINCIPAL.id);
    expect(ids).toContain(TEACHER.id);
    // A coach, a supervisor, an AEO and a school leader are at the school but are
    // not its class teachers. LEADER_ROLES minus `principal`.
    expect(ids).not.toContain(OTHER_COACH.id);
    expect(ids).not.toContain(SUPERVISOR.id);
    expect(ids).not.toContain(AEO.id);
    expect(ids).not.toContain(LEADER.id);
    // The sayable "no" is still last.
    expect(ids[ids.length - 1]).toBe('none');
  });

  it('LABELS the principal, the way /observe does — an unlabelled one is indistinguishable from a teacher', async () => {
    seed([PRINCIPAL, TEACHER]);

    const list = await endpoint.teachersFor(COACH, SCHOOL);
    const principal = list.find((o) => o.id === PRINCIPAL.id);
    const teacher = list.find((o) => o.id === TEACHER.id);

    expect(principal.title).toBe('Zulfiqar Ali (Principal)');
    // A teacher is NOT labelled — the label has to mean something.
    expect(teacher.title).toBe('Fiza Khan');
  });

  it('clips the NAME, not the label, on the live 19-code-point case', async () => {
    // Sheikh Zulfiqar Ali is the principal this bead was found on. His name plus
    // the label is 31 code points against a 30 cap, so one character of the name
    // goes. That is the right trade — a school has one principal, so the label is
    // most of the identification — but it is pinned here so it is a decision
    // rather than a surprise the next time somebody reads the picker.
    seed([{ ...PRINCIPAL, name: 'Sheikh Zulfiqar Ali' }]);

    const option = (await endpoint.teachersFor(COACH, SCHOOL)).find((o) => o.id === PRINCIPAL.id);

    expect(option.title).toBe('Sheikh Zulfiqar Al (Principal)');
    expect(cp(option.title)).toBe(30);
  });

  it('truncates the NAME so the label survives, measured in code points', async () => {
    seed([LONG_PRINCIPAL]);

    const option = (await endpoint.teachersFor(COACH, SCHOOL))
      .find((o) => o.id === LONG_PRINCIPAL.id);

    expect(cp(option.title)).toBeLessThanOrEqual(30);
    // The suffix is the part that must never be the bit that gets cut.
    expect(option.title.endsWith('(Principal)')).toBe(true);
    // And something of the name is still there to read.
    expect(option.title).toMatch(/^Muhammad/);
  });

  it('counts CODE POINTS, not UTF-16 units — an astral character must not buy a longer title', async () => {
    // Four astral code points (8 UTF-16 units). A `.slice(0, 30)` on units would
    // let this through at 30 units / 26 code points, or split a surrogate pair.
    const astral = { ...LONG_PRINCIPAL, name: `𝐌𝐮𝐡𝐚mmad Abdul Rehman Khan Niazi` };
    seed([astral]);

    const option = (await endpoint.teachersFor(COACH, SCHOOL))
      .find((o) => o.id === astral.id);

    expect(cp(option.title)).toBeLessThanOrEqual(30);
    expect(option.title.endsWith('(Principal)')).toBe(true);
    // No lone surrogate: a round trip through code points is lossless.
    expect([...option.title].join('')).toBe(option.title);
  });

  it('keeps a person with NO name on file, labelled the way /observe labels them', async () => {
    seed([NAMELESS, TEACHER]);

    const list = await endpoint.teachersFor(COACH, SCHOOL);
    const option = list.find((o) => o.id === NAMELESS.id);

    expect(option).toBeTruthy();
    expect(option.title.trim()).not.toBe('');
    // displayNameOf's degradation: role plus the last four digits of the phone.
    expect(option.title).toMatch(/8877/);
    expect(cp(option.title)).toBeLessThanOrEqual(30);
  });

  it('labels a NAMELESS principal as a principal, not as a teacher', async () => {
    const namelessPrincipal = {
      id: 'p3', role: 'principal', school_id: SCHOOL, name: null, phone_number: '923004321000',
    };
    seed([namelessPrincipal]);

    const option = (await endpoint.teachersFor(COACH, SCHOOL))
      .find((o) => o.id === namelessPrincipal.id);

    expect(option).toBeTruthy();
    expect(option.title).toMatch(/Principal/);
    expect(cp(option.title)).toBeLessThanOrEqual(30);
  });

  it('does not narrow LEADER_ROLES — four other consumers read it', () => {
    // The fix is a roster-local list. If someone "simplifies" it by editing the
    // shared one, observe-gate, dashboard/lib/leader-role, config/role-features
    // and isSchoolLeader below all change meaning with it.
    // eslint-disable-next-line global-require
    const { LEADER_ROLES } = require('../../bot/shared/services/observe/observe-gate');
    expect([...LEADER_ROLES].sort())
      .toEqual(['aeo', 'coach', 'principal', 'school_leader', 'supervisor']);
  });
});

describe('the mapped patch is subject to the same two rules', () => {
  it('a mapped teacher with a blank roster name falls back to a readable label', async () => {
    mockDb = createFakeSupabase({
      users: [COACH, { ...NAMELESS, school_id: 'elsewhere' }],
      leader_teachers: [{
        leader_user_id: COACH.id,
        school_id: SCHOOL,
        teacher_name: '  ',
        teacher_phone_e164: NAMELESS.phone_number,
      }],
      leader_schools: [{ leader_user_id: COACH.id, school_id: SCHOOL, school_name: 'Test School' }],
      schools: [{ id: SCHOOL, name: 'Test School' }],
    });

    const option = (await endpoint.teachersFor(COACH, SCHOOL))
      .find((o) => o.id === NAMELESS.id);

    expect(option).toBeTruthy();
    expect(option.title).toMatch(/8877/);
  });
});
