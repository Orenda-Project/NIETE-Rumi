/**
 * An empty roster must RENDER, not merely be well-formed. (bd-2732)
 *
 * bd-2713 read the "something went wrong" overlay as two faults — opening on a screen
 * with incoming edges, and an ABSENT data-source — and fixed both. The second
 * diagnosis was half the story. A CheckboxGroup cannot render `data-source: []` any
 * more than it can render a missing one, so the graceful branch went on producing an
 * unrenderable screen, and `empty-roster-dead-end.test.js` pinned it there by
 * asserting `roster` was present and had length 0.
 *
 * Reported again 2026-08-28: a teacher picked an empty class from the register's
 * CLASS screen and got the overlay at DATE → MARK. The trace ends exactly there:
 *
 *   07:03:25  INIT
 *   07:03:31  data_exchange CLASS  [class_dropdown]
 *   07:03:37  data_exchange DATE   [register_date]   ← nothing after
 *
 * Same shape as the /class ROSTER failure fixed in bd-2731, one flow over. The screen
 * now carries `has_roster`, the Flow hides the group when it is false, and the array
 * keeps one inert placeholder so the data-source stays well-formed while hidden.
 *
 * THREE screens bind a roster, so all three are covered here:
 *   MARK    — an empty class, the reported case.
 *   LEAVE   — offered the roster MINUS the absentees, so a class where EVERYONE is
 *             absent empties it. Latent, never reported, identical failure.
 *   REVIEW  — the voice path's roster.
 *
 * And an empty register must not be writable: MARK's footer submits like any other,
 * so without a guard a teacher could walk an empty class through to a saved register
 * of nobody. The endpoint comment already claimed submitting "re-renders this rather
 * than writing a register against nobody"; it did not, and now it does.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

/** Same stub surface as empty-roster-dead-end.test.js — the four tables in play. */
function db({ user = {}, classes = [], studentsByList = {}, schools = [], staff = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: user, error: null }),
            eq: () => ({ order: () => Promise.resolve({ data: staff, error: null }) }),
          }),
        }),
      };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({ order: () => Promise.resolve({ data: classes, error: null }) }),
            maybeSingle: () => Promise.resolve({
              data: classes.find((c) => c.id === val) || null, error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({
          eq: (col, val) => {
            const rows = studentsByList[col === 'list_id' ? val : null] || [];
            const tail = {
              order: () => Promise.resolve({ data: rows, error: null }),
              limit: (n) => Promise.resolve({ data: rows.slice(0, n), error: null }),
            };
            return { eq: () => tail, ...tail };
          },
        }),
      };
    }
    if (table === 'schools') {
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: () => Promise.resolve({
              data: schools.find((s) => s.id === val) || null, error: null,
            }),
          }),
        }),
      };
    }
    return {};
  });
}

const TEACHER = { id: 't1', role: 'teacher' };
const CLASS = [{ id: 'c1', class_name: '5th', section: 'A' }];

beforeEach(() => jest.clearAllMocks());

/** Walk to MARK the way the teacher does: pick the class, then the date. */
async function toMark(token = 't1', listId = 'c1') {
  await marking.handleMarkingDataExchange(token, 'CLASS', { class_id: `student:${listId}` });
  return marking.handleMarkingDataExchange(token, 'DATE', { register_date: '2026-08-14' });
}

describe('MARK — the reported failure', () => {
  it('never sends an empty data-source for a class with nobody in it', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    const res = await toMark();

    expect(res.screen).toBe('MARK');
    // The defect: `[]` is exactly as unrenderable as a missing key.
    expect(res.data.roster.length).toBeGreaterThan(0);
    expect(res.data.has_roster).toBe(false);
    // The empty-state copy still has to survive.
    expect(JSON.stringify(res.data)).toMatch(/no students/i);
  });

  it('leaves a populated roster alone and flags it as present', async () => {
    db({
      user: { id: 't2', role: 'teacher' },
      classes: [{ id: 'c2', class_name: '4th', section: 'B' }],
      studentsByList: { c2: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 4 }] },
    });
    const res = await toMark('t2', 'c2');

    expect(res.data.has_roster).toBe(true);
    expect(res.data.roster).toHaveLength(1);
    expect(res.data.roster[0].title).toContain('Aleeha');
  });

  it('says the same for an empty STAFF roster', async () => {
    db({
      user: { id: 'p1', role: 'principal', school_id: 'sch1' },
      schools: [{ id: 'sch1', name: 'Green Valley School' }],
      staff: [],
    });

    await marking.handleMarkingInit('p1:teacher:sch1');
    const res = await marking.handleMarkingDataExchange(
      'p1:teacher:sch1', 'STAFF_DATE', { register_date: '2026-08-14' },
    );

    expect(res.screen).toBe('MARK');
    expect(res.data.has_roster).toBe(false);
    expect(res.data.roster.length).toBeGreaterThan(0);
  });
});

describe('an empty register cannot be written', () => {
  it('submitting the empty MARK re-renders it instead of walking on to CONFIRM', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    await toMark();

    const res = await marking.handleMarkingDataExchange('t1', 'MARK', { absent: [] });

    // Never LEAVE — that road ends at a saved register of nobody.
    expect(res.screen).toBe('MARK');
    expect(res.data.has_roster).toBe(false);
  });

  it('ignores the placeholder if a stale handset ticks it', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    await toMark();

    const res = await marking.handleMarkingDataExchange('t1', 'MARK', {
      absent: [marking.NO_ROSTER_OPTION.id],
    });

    expect(res.screen).toBe('MARK');
  });
});

describe('LEAVE — every student absent empties the roster it offers', () => {
  it('still renders when nobody is left to consider', async () => {
    db({
      user: { id: 't3', role: 'teacher' },
      classes: [{ id: 'c3', class_name: '6th' }],
      studentsByList: { c3: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 1 }] },
    });
    await toMark('t3', 'c3');

    // The one child is absent, so LEAVE is offered an empty remainder.
    const res = await marking.handleMarkingDataExchange('t3', 'MARK', { absent: ['s1'] });

    expect(res.screen).toBe('LEAVE');
    expect(res.data.has_roster).toBe(false);
    expect(res.data.roster.length).toBeGreaterThan(0);
    // This one MUST still be able to proceed — it is a real register, not an empty one.
    expect(res.data.heading).toMatch(/1 marked absent/i);
  });

  it('flags the roster as present when somebody is left', async () => {
    db({
      user: { id: 't4', role: 'teacher' },
      classes: [{ id: 'c4', class_name: '6th' }],
      studentsByList: {
        c4: [
          { id: 's1', student_name: 'Aleeha Noor', roll_number: 1 },
          { id: 's2', student_name: 'Bilal Hussain', roll_number: 2 },
        ],
      },
    });
    await toMark('t4', 'c4');

    const res = await marking.handleMarkingDataExchange('t4', 'MARK', { absent: ['s1'] });

    expect(res.data.has_roster).toBe(true);
    expect(res.data.roster).toHaveLength(1);
  });
});

describe('the Flow asset has to agree', () => {
  const bound = ['MARK', 'LEAVE', 'REVIEW'];

  it.each(bound)('%s declares has_roster', (id) => {
    const screen = flow.screens.find((s) => s.id === id);
    expect(screen.data.has_roster).toBeDefined();
    expect(screen.data.has_roster.type).toBe('boolean');
  });

  it.each(bound)('%s guards its roster CheckboxGroup with it', (id) => {
    const screen = flow.screens.find((s) => s.id === id);
    const find = (n) => {
      if (Array.isArray(n)) return n.map(find).find(Boolean);
      if (n && typeof n === 'object') {
        if (n.type === 'CheckboxGroup' && n['data-source'] === '${data.roster}') return n;
        return Object.values(n).map(find).find(Boolean);
      }
      return undefined;
    };
    const group = find(screen.layout);

    expect(group).toBeDefined();
    expect(group.visible).toBe('${data.has_roster}');
  });

  it('leaves every screen still declaring the keys the endpoint sends', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    const res = await toMark();
    const declared = Object.keys(flow.screens.find((s) => s.id === 'MARK').data);
    Object.keys(res.data).forEach((k) => expect(declared).toContain(k));
  });
});
