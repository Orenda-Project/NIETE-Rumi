/**
 * V1.4.7 and V1.4.9 are in this folder, and the reference schema agrees with them.
 *
 * Both reached staging and main without passing through this branch, so a database built
 * from here (or audited against this folder) could not see them: a leader_roster_audit
 * CHECK that refuses the edit actions, and a users.phone_number too narrow for the 43-char
 * merge tombstone ('merged:' + a uuid). The files are carried verbatim; this guard pins the
 * two facts a fresh install depends on.
 *
 * V1.4.5 (teacher_level) is deliberately NOT here: it renames users.training_bands, which
 * this branch's code still reads. It arrives with the code that reads teacher_level.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIG = path.join(ROOT, 'infrastructure', 'supabase', 'migrations');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql'), 'utf8');

const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');
const code = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
/** The quoted literals of the LAST action CHECK a text declares (ARRAY[...] or IN (...)). */
function actions(sql) {
  const all = [...code(sql).matchAll(/CHECK\s*\(\s*action\s*(?:=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]|IN\s*\(([^)]*)\))/gi)];
  if (!all.length) return null;
  const last = all[all.length - 1];
  return ((last[1] || last[2]).match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
}

describe('V1.4.7 / V1.4.9 — carried from the promotion branches', () => {
  test('both files are present', () => {
    expect(fs.existsSync(path.join(MIG, 'V1.4.7__roster_audit_edit_actions.sql'))).toBe(true);
    expect(fs.existsSync(path.join(MIG, 'V1.4.9__phone_number_fits_merge_tombstone.sql'))).toBe(true);
  });

  test('the reference leader_roster_audit CHECK admits exactly the actions V1.4.9 settles on', () => {
    const want = actions(read('V1.4.9__phone_number_fits_merge_tombstone.sql'));
    expect(want).toEqual(expect.arrayContaining(['edit_role', 'edit_phone_escalated']));
    const body = SCHEMA.slice(SCHEMA.search(/CREATE TABLE IF NOT EXISTS leader_roster_audit\s*\(/));
    expect(actions(body.slice(0, body.indexOf(');')))).toEqual(want);
  });

  test('the reference users.phone_number is as wide as V1.4.9 makes it', () => {
    const want = code(read('V1.4.9__phone_number_fits_merge_tombstone.sql'))
      .match(/ALTER COLUMN phone_number TYPE varchar\((\d+)\)/i)[1];
    const users = SCHEMA.slice(SCHEMA.search(/CREATE TABLE IF NOT EXISTS users\s*\(/));
    const got = users.match(/phone_number\s+VARCHAR\((\d+)\)/i)[1];
    expect(Number(got)).toBe(Number(want));
    expect(Number(got)).toBeGreaterThanOrEqual('merged:'.length + 36);
  });
});
