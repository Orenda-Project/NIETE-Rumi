/**
 * bd-60123 — the attendance views a principal actually gets.
 *
 * Three shapes, settled on the design canvas (operator, 2026-09-17):
 *   · G3  — every GROUP fully merged across its people AND its days. One row
 *           per grade (or the staff), one bar each on one scale. This is the
 *           default on her dashboard.
 *   · day-wise — the same groups split back out by day, for the detail page.
 *   · D1  — one person, one cell per day (P/A/L), for a single teacher.
 *
 * THE UNIT IS A PERSON-DAY. A group's denominator is people x school days —
 * "chances to show up" — so unmarked days are a visible block rather than
 * vanishing into the numerator. Today's live panel divides 58 by 61 and
 * reports 94.7% from 46% of the data; that is the bug this shape fixes.
 *
 * Two facts measured on prod (ihzciabopbttygxxgrkm, 2026-09-17) fix how the
 * roster size is obtained, and both cost a rewrite when I got them wrong:
 *
 *  1. `student_lists.student_count` is 0 on 437 of 1,587 rows, and the
 *     `students` table is empty for most lists. Using either as the
 *     denominator produced NEGATIVE unmarked counts (-213 on a real class).
 *     The roster size that is actually trustworthy is the largest
 *     `attendance_sessions.total_students` ever recorded for that class — the
 *     register itself, at marking time.
 *
 *  2. `student_lists.class_name` ALREADY contains the section ("Grade 2 - A"),
 *     so appending `section` yields "Grade 2 - A-A".
 */

const {
  summarizeGroups,
  summarizeByDay,
} = require('../services/attendance-detail.service');

// Two classes over 3 school days. Grade A marked all three, Grade B only once.
const SESSIONS = [
  { group: 'Grade 2 - A', date: '2026-09-01', total: 40, present: 38 },
  { group: 'Grade 2 - A', date: '2026-09-02', total: 40, present: 36 },
  { group: 'Grade 2 - A', date: '2026-09-03', total: 40, present: 39 },
  { group: 'Grade 2 - B', date: '2026-09-02', total: 30, present: 25 },
];
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03'];

describe('summarizeGroups — G3, merged across people AND days', () => {
  it('builds the denominator from people x days, not from marked days', () => {
    const [a] = summarizeGroups(SESSIONS, DAYS).filter((g) => g.name === 'Grade 2 - A');
    expect(a.people).toBe(40);
    expect(a.days).toBe(3);
    expect(a.chances).toBe(120);   // 40 x 3, NOT 40 x however many were marked
  });

  it('takes the roster size from the register, since student_count is unreliable', () => {
    // 437 of 1,587 lists carry student_count 0 on prod; the largest
    // total_students actually recorded is the honest roster.
    const rows = summarizeGroups([
      { group: 'G1', date: '2026-09-01', total: 20, present: 18 },
      { group: 'G1', date: '2026-09-02', total: 24, present: 22 },  // two joined
    ], ['2026-09-01', '2026-09-02']);
    expect(rows[0].people).toBe(24);
  });

  it('counts unmarked person-days as their own block', () => {
    const [b] = summarizeGroups(SESSIONS, DAYS).filter((g) => g.name === 'Grade 2 - B');
    expect(b.chances).toBe(90);          // 30 x 3
    expect(b.present).toBe(25);
    expect(b.absent).toBe(5);            // 30 - 25 on the one marked day
    expect(b.neverMarked).toBe(60);      // the two days nobody marked
  });

  it('never returns a negative unmarked count, whatever the roster says', () => {
    // The real failure: a stale roster smaller than a day's register.
    const rows = summarizeGroups([
      { group: 'G1', date: '2026-09-01', total: 10, present: 10 },
      { group: 'G1', date: '2026-09-02', total: 10, present: 10 },
    ], ['2026-09-01']);   // only ONE day in the window, two marked
    expect(rows[0].neverMarked).toBe(0);
    expect(rows[0].neverMarked).not.toBeLessThan(0);
  });

  it('reports how many of the window days the group was marked at all', () => {
    const [a] = summarizeGroups(SESSIONS, DAYS).filter((g) => g.name === 'Grade 2 - A');
    const [b] = summarizeGroups(SESSIONS, DAYS).filter((g) => g.name === 'Grade 2 - B');
    expect(a.markedDays).toBe(3);
    expect(b.markedDays).toBe(1);
  });

  it('keeps a group that was never marked, rather than dropping it', () => {
    const rows = summarizeGroups(SESSIONS, DAYS, [
      { name: 'Grade 5', people: 36 },
    ]);
    const g5 = rows.find((g) => g.name === 'Grade 5');
    expect(g5).toBeDefined();
    expect(g5.markedDays).toBe(0);
    expect(g5.present).toBe(0);
    // A never-marked class must not read as a class with zero attendance.
    expect(g5.neverMarked).toBe(108);
  });

  it('sorts the least-known groups first — they need her attention most', () => {
    const rows = summarizeGroups(SESSIONS, DAYS);
    expect(rows[0].name).toBe('Grade 2 - B');
  });

  it('returns nothing rather than a zero row when there is no data at all', () => {
    expect(summarizeGroups([], [])).toEqual([]);
  });
});

describe('summarizeByDay — the day-wise detail', () => {
  it('gives one entry per day per group, oldest first', () => {
    const out = summarizeByDay(SESSIONS, DAYS);
    const a = out.find((g) => g.name === 'Grade 2 - A');
    expect(a.days).toHaveLength(3);
    expect(a.days[0].date).toBe('2026-09-01');
    expect(a.days[0].present).toBe(38);
  });

  it('marks a day the group was not registered as unmarked, not as zero', () => {
    const out = summarizeByDay(SESSIONS, DAYS);
    const b = out.find((g) => g.name === 'Grade 2 - B');
    expect(b.days[0].marked).toBe(false);
    expect(b.days[0].present).toBeNull();   // null, never 0
    expect(b.days[1].marked).toBe(true);
    expect(b.days[1].present).toBe(25);
  });
});
