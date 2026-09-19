/**
 * bd-60123 — attendance shaped the way a principal reads it.
 *
 * Settled on the design canvas with the operator (2026-09-17). Three views,
 * two of them built here:
 *
 *   · G3 (summarizeGroups) — every GROUP merged across its people AND its
 *     days. One row per grade, one bar each, all on one scale. Her default.
 *   · day-wise (summarizeByDay) — the same groups split back out per day, for
 *     the detail page.
 *   · D1 — one person, one cell per day. That is a render of the per-day rows
 *     and needs no aggregation of its own.
 *
 * THE UNIT IS A PERSON-DAY. A group's denominator is people x school days —
 * "chances to show up" — which is the whole point: an unmarked day becomes a
 * visible block instead of disappearing from the numerator. The live panel
 * today divides 58 by 61 and prints 94.7%, computed from 46% of the data.
 *
 * TWO PROD FACTS DECIDE HOW ROSTER SIZE IS OBTAINED (measured on
 * ihzciabopbttygxxgrkm, 2026-09-17); both of these were found by getting it
 * wrong first and seeing the output:
 *
 *   1. `student_lists.student_count` is 0 on 437 of 1,587 rows, and the
 *      `students` table is empty for most lists. Using either produced
 *      NEGATIVE unmarked counts — a real class came out at -213 — because the
 *      register recorded more children than the roster claimed existed. So the
 *      roster size is the LARGEST `attendance_sessions.total_students` ever
 *      recorded for that group: the register itself, at marking time.
 *
 *   2. `student_lists.class_name` ALREADY carries the section ("Grade 2 - A").
 *      Appending `section` yields "Grade 2 - A-A". The caller passes
 *      class_name through untouched.
 *
 * Pure: rows in, shapes out, no DB round-trip — same contract as the other
 * summarisers on this page.
 */

/**
 * @typedef {{group: string, date: string, total: number, present: number}} Session
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}


/**
 * bd-60124 — the reading order of a group list (operator, 2026-09-17).
 *
 * Grades run G1 → G2 → G3, teachers run alphabetically, and one comparator
 * does both because a row is only ever a grade or a person.
 *
 * A plain `localeCompare` is wrong for grades and the data proves it: on prod
 * there are 75 distinct `class_name` values and a string sort puts
 * "Grade 10 - A" between "Grade 1 - D" and "Grade 2", because it compares "1"
 * against "2" character by character. So the leading number is pulled out and
 * compared numerically; everything after it (section, "(evening)") falls back
 * to a locale compare, which orders A → B → C correctly.
 *
 * A name with no leading number — "Early Years", or a teacher — sorts before
 * the numbered grades and alphabetically among its own kind. That puts Early
 * Years at the top of a class list, which is where it belongs, and leaves a
 * staff list in plain alphabetical order.
 *
 * This deliberately replaces the earlier least-known-first order. Coverage
 * still drives the eye through colour — the dashed block is loud on its own —
 * but a list a principal scans should be in the order she already knows.
 */
function gradeNumber(name) {
  const m = /(\d+)/.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

function compareGroupNames(a, b) {
  const an = gradeNumber(a.name);
  const bn = gradeNumber(b.name);
  if (an == null && bn != null) return -1;   // Early Years before Grade 1
  if (an != null && bn == null) return 1;
  if (an != null && bn != null && an !== bn) return an - bn;
  return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
}

/**
 * G3 — one fully merged row per group.
 *
 * @param {Session[]} sessions        registers in the window
 * @param {string[]} days             every school day in the window
 * @param {Array<{name: string, people: number}>} [known]
 *   groups that exist but may have no register at all. Without these a class
 *   nobody has ever marked simply vanishes, which is the opposite of what she
 *   needs to see.
 */
function summarizeGroups(sessions, days, known = []) {
  const list = Array.isArray(sessions) ? sessions : [];
  const window = Array.isArray(days) ? days : [];
  const dayCount = window.length;

  const acc = new Map();
  const touch = (name, people) => {
    if (!acc.has(name)) {
      acc.set(name, { name, people: 0, present: 0, absent: 0, marked: new Set() });
    }
    const g = acc.get(name);
    // Largest register ever seen wins — see note 1 above.
    if (people > g.people) g.people = people;
    return g;
  };

  for (const s of list) {
    if (!s || !s.group) continue;
    const total = num(s.total);
    const present = num(s.present);
    const g = touch(s.group, total);
    g.present += present;
    g.absent += Math.max(0, total - present);
    if (s.date) g.marked.add(s.date);
  }

  for (const k of Array.isArray(known) ? known : []) {
    if (!k || !k.name) continue;
    touch(k.name, num(k.people));
  }

  const rows = [...acc.values()].map((g) => {
    const chances = g.people * dayCount;
    return {
      name: g.name,
      people: g.people,
      days: dayCount,
      chances,
      present: g.present,
      absent: g.absent,
      // Clamped at zero. A roster smaller than a day's register, or a group
      // marked more often than the window has days, must never render as a
      // negative block — it would invert the bar.
      neverMarked: Math.max(0, chances - g.present - g.absent),
      markedDays: g.marked.size,
    };
  });

  rows.sort(compareGroupNames);
  return rows;
}

/**
 * The day-wise detail: one row per group, one cell per day in the window.
 *
 * @param {Session[]} sessions
 * @param {string[]} days   every school day, oldest first
 */
function summarizeByDay(sessions, days) {
  const list = Array.isArray(sessions) ? sessions : [];
  const window = (Array.isArray(days) ? days : []).slice().sort();

  const groups = new Map();
  for (const s of list) {
    if (!s || !s.group) continue;
    if (!groups.has(s.group)) groups.set(s.group, new Map());
    const total = num(s.total);
    const present = num(s.present);
    const byDate = groups.get(s.group);
    const prev = byDate.get(s.date);
    // Two registers for one class on one day: sum them rather than pick one.
    byDate.set(s.date, prev
      ? { total: prev.total + total, present: prev.present + present }
      : { total, present });
  }

  // Same order as the summary — the two views are the same list, and a row
  // that moves when she flips between them is a row she has to re-find.
  return [...groups.entries()].map(([name, byDate]) => ({
    name,
    days: window.map((date) => {
      const hit = byDate.get(date);
      if (!hit) {
        // null, never 0 — "nobody marked" is not "nobody came", and rendering
        // it as zero is the single most misleading thing this page could do.
        return { date, marked: false, total: null, present: null, absent: null };
      }
      return {
        date,
        marked: true,
        total: hit.total,
        present: hit.present,
        absent: Math.max(0, hit.total - hit.present),
      };
    }),
  })).sort(compareGroupNames);
}

module.exports = { summarizeGroups, summarizeByDay, compareGroupNames };
