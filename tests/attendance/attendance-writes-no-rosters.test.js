/**
 * Attendance is a TRANSACTION. It never writes the roster.
 *
 * Operator decision 2026-08-14: `/class` is the primary and only way to manage
 * classes; attendance hooks into it when a class has no students. That makes the
 * split explicit:
 *
 *   MASTER       who is in the class      owned by /class
 *   TRANSACTION  what happened on a date  owned by /attendance
 *
 * The reason this needs a guard rather than a convention is that the previous
 * arrangement grew the other way round. `attendance-setup` created classes AND
 * pasted rosters, purely because attendance needed a roster and no class flow
 * existed. That produced two writers of class membership, then a third was added
 * (`class_enrollments`), and the same fact — roll number, membership end, student
 * count — ended up stored in two incompatible places with no single query able to
 * answer "who is in this class".
 *
 * So: attendance code may READ roster tables. It may not INSERT, UPDATE, UPSERT or
 * DELETE them. The register tables are its own.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

/** Roster ownership belongs to /class — these are read-only for attendance. */
const ROSTER_TABLES = ['students', 'student_lists', 'class_enrollments', 'classes', 'class_teachers'];

/** Attendance's own tables — writing these is the whole point. */
const REGISTER_TABLES = ['attendance_sessions', 'attendance_records', 'teacher_attendance_records'];

const MUTATIONS = ['insert', 'update', 'upsert', 'delete'];

/** The attendance surface. Deliberately narrow — add here when it grows. */
const ATTENDANCE_SOURCES = [
  'bot/shared/services/attendance-router.service.js',
  'bot/shared/services/attendance-write.service.js',
  'bot/shared/routes/attendance-marking-endpoint.js',
];

describe('attendance never writes roster tables', () => {
  it('the file list is real (a typo here would make this vacuous)', () => {
    ATTENDANCE_SOURCES.forEach((rel) => {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    });
  });

  ATTENDANCE_SOURCES.forEach((rel) => {
    it(`${path.basename(rel)} mutates only register tables`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const offenders = [];

      // Walk each `.from('<table>')` and look at what follows it on the same
      // statement — the chain continues until the next `.from(` or a blank line.
      const re = /\.from\('([a-z_]+)'\)/g;
      let m;
      while ((m = re.exec(src))) {
        const table = m[1];
        if (!ROSTER_TABLES.includes(table)) continue;

        // Slice AFTER the .from(...) itself. Slicing from m.index means the
        // split delimiter sits at position 0, so [0] is the empty string and the
        // mutation regex never matches — a guard that passes for every input.
        // The anti-vacuity test below is what caught that.
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
        const chain = after.split(/\.from\('/)[0];

        MUTATIONS.forEach((op) => {
          if (new RegExp(`\\.${op}\\s*\\(`).test(chain)) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}:${line} — .from('${table}').${op}() — rosters belong to /class`);
          }
        });
      }

      expect(offenders).toEqual([]);
    });
  });

  it('still writes its own register tables (proves the guard is not just always-green)', () => {
    const writeSrc = fs.readFileSync(path.join(ROOT, 'bot/shared/services/attendance-write.service.js'), 'utf8');

    // Every occurrence, not just the first — the first `.from('attendance_sessions')`
    // is a SELECT (the "already marked today?" probe), so indexOf() would conclude
    // this service writes nothing and the guard would pass for the wrong reason.
    const mutated = new Set();
    const re = /\.from\('([a-z_]+)'\)/g;
    let m;
    while ((m = re.exec(writeSrc))) {
      const chain = writeSrc
        .slice(m.index + m[0].length, m.index + m[0].length + 400)
        .split(/\.from\('/)[0];
      if (MUTATIONS.some((op) => new RegExp(`\\.${op}\\s*\\(`).test(chain))) mutated.add(m[1]);
    }

    expect([...mutated].sort()).toEqual(
      expect.arrayContaining(['attendance_records', 'attendance_sessions']),
    );
    // And nothing it mutates may be a roster table.
    expect([...mutated].filter((t) => ROSTER_TABLES.includes(t))).toEqual([]);
  });
});
