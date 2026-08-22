/**
 * The pre-amble lives in the Flow: CLASS -> DATE -> METHOD -> MARK. (bd-2726)
 *
 * The picker used to be chat. WhatsApp allows 3 reply buttons, or 10 list rows in
 * TOTAL — whatsapp.service.js refuses more — so a teacher with 20 class-sections had
 * ten of them permanently unreachable, silently. A Flow Dropdown takes 200 options,
 * so the picker belongs on a screen.
 *
 * Moving it also forced the principal's "teachers or students?" question into the
 * Flow, because CLASS is the only screen with no incoming edges and therefore the
 * only legal INIT target (bd-2713). There is no second entry point to give the staff
 * path, so "My teachers" is simply the first option on the same screen.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

function db({ user = {}, lists = [], rosters = {}, staff = [], schools = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: () => Promise.resolve({ data: user, error: null }),
            // loadStaffRoster: .eq('school_id').eq('role').order()
            eq: () => ({ order: () => Promise.resolve({ data: staff, error: null }) }),
          }),
        }),
      };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({ order: () => Promise.resolve({ data: lists, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: lists.find((l) => l.id === val) || null, error: null }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({
          eq: (col, val) => builder(col === 'list_id' ? (rosters[val] || []) : []),
          // Bulk count (bd-2728): .in('list_id', [...]) — one row per student, so the
          // count is derived rather than queried per class.
          in: (col, ids) => builder(col === 'list_id'
            ? ids.flatMap((lid) => (rosters[lid] || []).map((r) => ({ ...r, list_id: lid })))
            : []),
        }),
      };
    }
    if (table === 'class_enrollments') {
      return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    }
    if (table === 'schools') {
      return {
        select: () => ({
          eq: (c, v) => ({ maybeSingle: () => Promise.resolve({ data: schools.find((s) => s.id === v) || null, error: null }) }),
        }),
      };
    }
    return {};
  });
}

const TEACHER = { id: 't1', role: 'teacher', school_id: 'sch1' };
const PRINCIPAL = { id: 'p1', role: 'principal', school_id: 'sch1' };

beforeEach(() => jest.clearAllMocks());

describe('the Flow graph', () => {
  it('runs CLASS -> DATE -> MARK for a teacher', () => {
    expect(flow.routing_model.CLASS).toEqual(['DATE']);
    expect(flow.routing_model.DATE).toEqual(['MARK']);
  });

  it('and STAFF_DATE -> MARK for a principal, with no class step at all', () => {
    // bd-43520: the tap-or-voice question left the Flow for chat, and the principal
    // got their own root so they never meet the class picker.
    expect(flow.routing_model.STAFF_DATE).toEqual(['MARK']);
    expect(flow.routing_model.METHOD).toBeUndefined();
  });

  it('carries BOTH pickers, and shows whichever suits the class count', () => {
    // Was a Dropdown alone. A Dropdown is a field that opens a picker sheet, which is
    // right for twenty class-sections and one tap too many for three — so radio
    // buttons show inline up to five and the Dropdown takes over past that. Meta caps
    // RadioButtonsGroup at 20 options and Dropdown at 200, so the fallback is what
    // keeps a 20-section teacher whole.
    const cls = flow.screens.find((s) => s.id === 'CLASS');
    const kids = cls.layout.children.find((c) => c.type === 'Form').children;
    expect(kids.find((c) => c.type === 'RadioButtonsGroup')).toBeDefined();
    expect(kids.find((c) => c.type === 'Dropdown')).toBeDefined();
  });

  it('uses CalendarPicker, which needs flow >= 6.1', () => {
    expect(parseFloat(flow.version)).toBeGreaterThanOrEqual(6.1);
    const date = flow.screens.find((s) => s.id === 'DATE');
    expect(JSON.stringify(date.layout)).toContain('"CalendarPicker"');
  });
});

describe('CLASS — the entry screen', () => {
  it('lists a teacher\'s classes with their student counts', async () => {
    db({
      user: TEACHER,
      lists: [{ id: 'l1', class_name: 'Grade 11', section: 'B', class_id: null }],
      rosters: { l1: [{ id: 's1', student_name: 'Amna' }, { id: 's2', student_name: 'Danish' }] },
    });

    const res = await marking.handleMarkingInit('t1');

    expect(res.screen).toBe('CLASS');
    expect(res.data.classes).toHaveLength(1);
    expect(res.data.classes[0]).toMatchObject({ id: 'student:l1', title: 'Grade 11 - B' });
    expect(res.data.classes[0].description).toMatch(/2 students/);
  });

  it('does not offer a principal their staff here — they never reach this screen', async () => {
    // Staff USED to be the first Dropdown option, because CLASS was the Flow's only
    // root and there was nowhere else to put it. STAFF_DATE is now a root of its own
    // (bd-43520), so this screen is classes and only classes.
    db({
      user: PRINCIPAL,
      staff: [{ id: 'x', first_name: 'Sana' }],
      lists: [{ id: 'l1', class_name: 'Grade 5', section: 'C', class_id: null }],
      rosters: { l1: [] },
    });

    const res = await marking.renderClassScreen('p1');

    expect(res.data.classes.map((o) => o.id)).toEqual(['student:l1']);
  });

  it('sends a principal to their own date screen, not to this one', async () => {
    db({ user: PRINCIPAL, staff: [{ id: 'x', first_name: 'Sana' }], schools: [{ id: 'sch1', name: 'GGPS' }] });
    const res = await marking.handleMarkingInit('p1:teacher:sch1');
    expect(res.screen).toBe('STAFF_DATE');
  });

  it('does not offer staff to a plain teacher', async () => {
    db({ user: TEACHER, lists: [], rosters: {} });
    const res = await marking.handleMarkingInit('t1');
    expect(res.data.classes.filter((c) => c.id.startsWith('teacher:'))).toEqual([]);
  });

  it('says so when there is nothing to mark, rather than opening a blank register', async () => {
    db({ user: TEACHER, lists: [] });
    const res = await marking.handleMarkingInit('t1');
    expect(res.screen).toBe('CLASS');
    expect(res.data.classes).toEqual([]);
    expect(res.data.heading).toMatch(/do not have any classes/i);
  });

  it('flags an empty class in its description instead of hiding it', async () => {
    db({
      user: TEACHER,
      lists: [{ id: 'l9', class_name: 'Grade 7 - E (evening)', section: 'E', class_id: null }],
      rosters: { l9: [] },
    });
    const res = await marking.handleMarkingInit('t1');
    expect(res.data.classes[0].description).toMatch(/no students/i);
  });
});

describe('the date screen leads straight into the register', () => {
  async function toDate() {
    db({
      user: TEACHER,
      lists: [{ id: 'l1', class_name: 'Grade 11', section: 'B', class_id: null }],
      rosters: { l1: [{ id: 's1', student_name: 'Amna' }] },
    });
    return marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:l1' });
  }

  it('asks for the day after the class', async () => {
    const res = await toDate();
    expect(res.screen).toBe('DATE');
    expect(res.data.max_date).toBe(marking.regionToday());
  });

  it('submitting the day opens the register — there is no method question left', async () => {
    await toDate();
    const res = await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '2026-08-14' });
    expect(res.screen).toBe('MARK');
    expect(res.data.roster).toHaveLength(1);
  });
});

describe('the register date is region-local, not UTC', () => {
  it('agrees with Asia/Karachi rather than the UTC calendar day', () => {
    const pkt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(marking.regionToday()).toBe(pkt);
  });

  it('never accepts a future register', async () => {
    db({
      user: TEACHER,
      lists: [{ id: 'l1', class_name: 'Grade 11', section: 'B', class_id: null }],
      rosters: { l1: [{ id: 's1', student_name: 'Amna' }] },
    });
    await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:l1' });
    const res = await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '2099-01-01' });

    // Clamped to today, so the heading cannot show a future day.
    expect(res.data.heading).not.toMatch(/2099/);
  });

  it('accepts the epoch-millis shape CalendarPicker sends on some clients', async () => {
    db({
      user: TEACHER,
      lists: [{ id: 'l1', class_name: 'Grade 11', section: 'B', class_id: null }],
      rosters: { l1: [{ id: 's1', student_name: 'Amna' }] },
    });
    await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:l1' });
    const res = await marking.handleMarkingDataExchange('t1', 'DATE', { register_date: '1786694544000' });
    expect(res.screen).toBe('MARK');
    // The register names the class AND the day it is for, so a mis-parsed date is
    // visible on the screen the teacher is about to fill in.
    expect(res.data.heading).toMatch(/·/);
  });
});
