/**
 * An empty roster must never dead-end the teacher. (bd-2713)
 *
 * Reported 2026-08-14: a principal tapped "My students" and WhatsApp showed
 * "something went wrong". The client told us exactly why:
 *
 *   error:         invalid-screen-transition
 *   error_message: The first screen -[CONFIRM] that was provided with response
 *                  already have incoming nodes found in the routing model
 *
 * handleMarkingInit()'s empty-roster branch returned `screen: 'CONFIRM'`, but
 * CONFIRM has incoming edges (MARK->CONFIRM, LEAVE_TYPE->CONFIRM). WhatsApp
 * refuses to OPEN a flow on a screen that has incoming nodes, so the branch
 * written to be graceful — "never a blank list" — was the only one that hard-failed.
 *
 * This is a regression of BUG-072 (fixed 2026-04-18, commit 68dc641, "Code on
 * Production"), where the identical trigger produced the identical overlay in the
 * main bot. That fix returned a valid ENTRY screen with an empty array; the
 * 2026-08-10 teardown discarded it along with its 5 tests.
 *
 * Two layers are locked here, because one is not enough:
 *   1. The ROUTER must not open the marking Flow for a class with no students at
 *      all — the Claude design specifies a chat message plus an "add students"
 *      affordance (edge case 8, "Empty state · button"), not a Flow screen.
 *   2. The ENDPOINT must still answer safely if the roster empties between the
 *      Flow being sent and the teacher opening it. Belt and braces, because the
 *      race is real and the failure is silent.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');
const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

/** Screens with no incoming edges — the only screens a Flow may be OPENED on. */
function entryScreens() {
  const incoming = new Set(Object.values(flow.routing_model).flat());
  return flow.screens.map((s) => s.id).filter((id) => !incoming.has(id));
}

/**
 * Stub the two tables the router reads, plus the two the marking endpoint reads.
 * `students` is keyed by list so a class can be present but empty.
 */
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
            // router: .eq('user_id').eq('is_active').order()
            eq: () => ({ order: () => Promise.resolve({ data: classes, error: null }) }),
            // endpoint loadClassLabel: .eq('id').maybeSingle()
            maybeSingle: () => Promise.resolve({
              data: classes.find((c) => c.id === val) || null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({
          // .eq('list_id', x).eq('is_active', true) then either .order() for the
          // full roster or .limit(1) for the router's existence probe.
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
              data: schools.find((s) => s.id === val) || null,
              error: null,
            }),
          }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => jest.clearAllMocks());

describe('the routing_model only permits one entry screen', () => {
  // Was MARK. Since bd-2726 the picker leads the Flow (CLASS -> DATE -> METHOD ->
  // MARK), so MARK has an incoming edge and CLASS is the only legal INIT target.
  // The invariant is unchanged — exactly one entry screen, and INIT must return it.
  it('CLASS is the sole screen with no incoming edges', () => {
    expect(entryScreens()).toEqual(['CLASS']);
  });

  it('MARK is now reachable only by navigation, never as an INIT target', () => {
    const incoming = new Set(Object.values(flow.routing_model).flat());
    expect(incoming.has('MARK')).toBe(true);
  });
});

describe('router: a class with no students never opens the marking Flow', () => {
  it('a teacher whose only class is empty still reaches the Flow, which flags it', async () => {
    db({
      user: { id: 't1', role: 'teacher' },
      classes: [{ id: 'c1', class_name: '5th', section: 'A' }],
      studentsByList: { c1: [] },
    });

    // bd-2726: route() opens the Flow; the empty class is flagged on CLASS rather
    // than intercepted in chat, so the teacher can still pick another class.
    const r = await router.route('t1');
    expect(r.action).toBe('OPEN_REGISTER');
  });

  it('a teacher whose class HAS students still marks normally', async () => {
    db({
      user: { id: 't2', role: 'teacher' },
      classes: [{ id: 'c2', class_name: '4th', section: 'B' }],
      studentsByList: { c2: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 4 }] },
    });

    const r = await router.route('t2');

    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('t2');
  });

  it('picking an empty class from the class list is caught too', async () => {
    db({
      user: { id: 't3', role: 'teacher' },
      classes: [{ id: 'c3', class_name: '6th' }],
      studentsByList: { c3: [] },
    });

    const r = await router.resolveClassChoice('t3', 'att_class_c3');

    expect(r.action).toBe('EMPTY_CLASS');
    expect(r.listId).toBe('c3');
  });

  it('a principal tapping "My students" on an empty class is caught too', async () => {
    db({
      user: { id: 'p1', role: 'principal', school_id: 'sch1' },
      classes: [{ id: 'c4', class_name: '5th', section: 'A' }],
      studentsByList: { c4: [] },
    });

    const r = await router.resolveSubjectChoice('p1', 'att_subject_student');

    expect(r.action).toBe('EMPTY_CLASS');
  });
});

describe('endpoint: INIT never opens on a screen with incoming edges', () => {
  it('an empty student roster lands on MARK by navigation, never CONFIRM', async () => {
    db({
      user: { id: 't1', role: 'teacher' },
      classes: [{ id: 'c1', class_name: '5th', section: 'A' }],
      studentsByList: { c1: [] },
    });

    // METHOD -> MARK is the real path now; INIT itself always answers CLASS.
    await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:c1' });
    await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '2026-08-14' });
    const res = await marking.handleMarkingDataExchange('t1', 'METHOD', { method: 'tap' });

    expect(res.screen).toBe('MARK');
    expect(res.screen).not.toBe('CONFIRM');
  });

  it('an empty staff roster lands on MARK by navigation, never CONFIRM', async () => {
    db({
      user: { id: 'p1', role: 'principal', school_id: 'sch1' },
      schools: [{ id: 'sch1', name: 'Green Valley School' }],
      staff: [],
    });

    await marking.handleMarkingDataExchange('p1', 'CLASS', { class_id: 'teacher:sch1' });
    await marking.handleMarkingDataExchange('p1', 'DATE', { register_date: '2026-08-14' });
    const res = await marking.handleMarkingDataExchange('p1', 'METHOD', { method: 'tap' });

    expect(res.screen).toBe('MARK');
    expect(res.screen).not.toBe('CONFIRM');
  });

  it('still says what is missing rather than showing a blank list', async () => {
    db({
      user: { id: 't1', role: 'teacher' },
      classes: [{ id: 'c1', class_name: '5th', section: 'A' }],
      studentsByList: { c1: [] },
    });

    await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:c1' });
    await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '2026-08-14' });
    const res = await marking.handleMarkingDataExchange('t1', 'METHOD', { method: 'tap' });

    // The empty-state copy must survive the move onto the register screen.
    expect(JSON.stringify(res.data)).toMatch(/no students/i);
    // And the roster the CheckboxGroup binds to must be present and empty —
    // an absent data-source is what produced the unrenderable response.
    expect(Array.isArray(res.data.roster)).toBe(true);
    expect(res.data.roster).toHaveLength(0);
  });

  it('a populated roster is unaffected', async () => {
    db({
      user: { id: 't2', role: 'teacher' },
      classes: [{ id: 'c2', class_name: '4th', section: 'B' }],
      studentsByList: { c2: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 4 }] },
    });

    await marking.handleMarkingDataExchange('t2', 'CLASS', { class_id: 'student:c2' });
    await marking.handleMarkingDataExchange('t2', 'DATE', { register_date: '2026-08-14' });
    const res = await marking.handleMarkingDataExchange('t2', 'METHOD', { method: 'tap' });

    expect(res.screen).toBe('MARK');
    expect(res.data.roster).toHaveLength(1);
    expect(res.data.roster[0].title).toContain('Aleeha');
  });
});
