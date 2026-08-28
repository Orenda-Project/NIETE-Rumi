/**
 * `leader_teachers` is deprecated. This is the ratchet that keeps it that way
 * until someone deletes it.
 *
 * The table used to answer two questions: "who does this coach coach?" and,
 * because no school→teacher roster table was ever built, "who teaches at this
 * school?". Both are now derived from `leader_schools × users.school_id`, so
 * nothing consults it to resolve a patch. What remains is the school add/remove
 * path, which still writes rows that only that same path reads back — a table
 * maintained for its own sake.
 *
 * A deprecated table that quietly acquires a new reader stops being deprecated
 * and nobody notices, which is the failure this file exists to prevent. The
 * allowed set below may SHRINK freely. It may not grow.
 *
 * DELETE THE TABLE, AND THIS TEST, WHEN ALL OF THESE HOLD:
 *
 *   1. Coach observation has run on production against the derived patch for
 *      long enough to trust it — coaches finding their teachers, booking and
 *      completing visits, no "where did my list go" reports.
 *   2. `leader_roster_audit` carries real coach-driven rows, proving the new
 *      write path is the one in use.
 *   3. The 7 teachers who are held by a coach but have no `users.school_id`
 *      have been given one. Until then the old table is the only record that
 *      they belong to anybody.
 *   4. The two writers below have stopped writing it.
 *
 * Then: drop the table, delete this file, and delete `extIdIsAmbiguous()` with
 * the niete:607 / niete:628 guards — those exist only because the old text
 * `'niete:' || emis` join could not tell two schools apart, and the foreign key
 * can.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DASH = path.join(__dirname, '../../../dashboard');

/** Files permitted to touch the table AT ALL. May shrink, never grow. */
const ALLOWED = [
  // The school add/remove path. Writes rows only it reads back; the last thing
  // to unpick before the table can go.
  'bot/shared/services/observe/observe-school-admin.service.js',
  'dashboard/services/leader-assignment.service.js',
];

/** Every real query, as opposed to a comment mentioning the name. */
const QUERY = /(from\('leader_teachers'\)|FROM\s+leader_teachers|INTO\s+leader_teachers|DELETE\s+FROM\s+leader_teachers)/;

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'tests') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe('leader_teachers is deprecated and may not grow new callers', () => {
  const files = [
    ...sourceFiles(path.join(ROOT, 'shared')),
    ...(fs.existsSync(DASH) ? sourceFiles(DASH) : []),
  ];

  it('only the school add/remove path still queries it', () => {
    const offenders = files
      .filter((f) => QUERY.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(path.join(ROOT, '../..'), f).replace(/^.*?NIETE-Rumi\//, ''))
      .map((f) => f.replace(/^\.\.\//, ''))
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a.split('/').pop())));
    expect(offenders).toEqual([]);
  });

  it('nothing reads it to answer who a coach coaches', () => {
    // The derived patch is the only source for that question. A query filtered
    // by leader_user_id outside the allowed files means the old model came back.
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (!QUERY.test(src)) continue;
      if (ALLOWED.some((a) => f.endsWith(a.split('/').pop()))) continue;
      if (/leader_user_id/.test(src)) offenders.push(path.basename(f));
    }
    expect(offenders).toEqual([]);
  });

  it('the deprecation is stated where someone would actually look', () => {
    for (const rel of ALLOWED) {
      const p = path.join(ROOT, '../..', rel.startsWith('bot/') ? rel.slice(4) : `../${rel}`);
      const guess = rel.startsWith('bot/')
        ? path.join(ROOT, rel.slice(4))
        : path.join(DASH, rel.replace('dashboard/', ''));
      const src = fs.readFileSync(fs.existsSync(guess) ? guess : p, 'utf8');
      expect(src).toMatch(/DEPRECATED/);
    }
  });
});
