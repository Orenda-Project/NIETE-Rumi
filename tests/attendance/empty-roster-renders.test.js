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
jest.mock('../../bot/shared/config/supabase', () =>
  // The real ConversationState runs against a fake `users` row — see the fixture
  // for why stubbing the service itself would prove nothing (bd-2733).
  require('../fixtures/conversation-state-fake').withConversationState(mockSupabase));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

/** PostgREST builders are both awaitable and chainable; the mock must be both. */
function thenable(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => thenable(rows);
  p.in = () => thenable(rows);
  p.order = () => thenable(rows);
  p.limit = (n) => thenable(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

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
          // The CLASS screen counts every class at once (bd-2728). Reached whenever
          // a register falls back to the picker, so the harness has to answer it.
          in: (col, ids) => thenable(col === 'list_id'
            ? ids.flatMap((lid) => (studentsByList[lid] || []).map((r) => ({ ...r, list_id: lid })))
            : []),
        }),
      };
    }
    if (table === 'class_enrollments') {
      return { select: () => ({ in: () => thenable([]), eq: () => thenable([]) }) };
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

/**
 * bd-2733 — the register survives a hop to another process.
 *
 * These would all have passed against the old in-memory Map too; that is the point.
 * The Map only ever failed ACROSS processes, which a single-process test cannot
 * reproduce — so what is pinned here is the observable contract that makes the
 * shared store correct: the state is written where another replica can read it, the
 * roster is re-read rather than carried, and the voice path does not lose its
 * pre-ticks to the state write that replaces its stash.
 */
describe('bd-2733 — in-flight state lives outside the process', () => {
  it('keeps the register in conversation_state, not in module memory', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:c1' });

    // The fake `users` row is the only place it could have gone.
    const supa = require('../../bot/shared/config/supabase');
    const row = supa._stateStore.get('t1');

    expect(row).toBeDefined();
    expect(row.conversation_state.flow).toBe('attendance_marking');
    expect(row.conversation_state.payload.targetId).toBe('c1');
    expect(row.conversation_state_expires_at).toBeTruthy();
  });

  it('never stores the roster — it is re-read per screen', async () => {
    db({
      user: { id: 't9', role: 'teacher' },
      classes: [{ id: 'c9', class_name: '5th' }],
      studentsByList: { c9: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 1 }] },
    });
    await toMark('t9', 'c9');

    const supa = require('../../bot/shared/config/supabase');
    const payload = supa._stateStore.get('t9').conversation_state.payload;

    // A 225-child class would otherwise be rewritten on every hop.
    expect(payload.people).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('Aleeha');
  });

  it('picks up a register written by "another process"', async () => {
    db({
      user: { id: 't8', role: 'teacher' },
      classes: [{ id: 'c8', class_name: '5th' }],
      studentsByList: { c8: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 1 }] },
    });

    // Written as if by the replica that served CLASS and DATE.
    const supa = require('../../bot/shared/config/supabase');
    supa._stateStore.set('t8', {
      conversation_state: {
        flow: 'attendance_marking',
        step: null,
        payload: { userId: 't8', subject: 'student', targetId: 'c8', date: '2026-08-14', absentIds: [], leaveIds: [], voiceLeaveIds: [] },
        stack: [],
        version: 1,
      },
      conversation_state_expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    // This "replica" has never seen the flow before — under the old Map it answered
    // CLASS here, which is the bounce the teacher reported.
    const res = await marking.handleMarkingDataExchange('t8', 'MARK', { absent: ['s1'] });

    expect(res.screen).toBe('LEAVE');
    expect(res.data.heading).toMatch(/1 marked absent/i);
  });

  it('a register belonging to a different flow is not mistaken for one', async () => {
    db({ user: TEACHER, classes: CLASS, studentsByList: { c1: [] } });
    const supa = require('../../bot/shared/config/supabase');
    supa._stateStore.set('t1', {
      conversation_state: { flow: 'quiz', step: 'q1', payload: { targetId: 'nope' }, stack: [], version: 1 },
      conversation_state_expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    // Scoped read: a teacher parked in a quiz is not half-way through a register.
    const res = await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '2026-08-14' });
    expect(res.screen).toBe('CLASS');
  });
});
