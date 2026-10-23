/**
 * Every FDE pattern paper fits the database's question_count cap.
 *
 * A pattern request stores the sum of its slots' generate counts in
 * assessment_requests.question_count. V1.2.6 capped that column at 60, sized for
 * teacher-typed papers (the app's own MAX_QUESTIONS is 50). G1 English asks for
 * 72, so the insert was refused and the portal said only "Assessment lookup
 * failed" — Amena, 23 Oct 2026 on sandbox (bd-5jmnfj.4.7).
 *
 * The cap is read from the migrations, latest version wins, so a later migration
 * that lowers it again fails here before it fails a teacher.
 */
const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const DIR = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');
const versionOf = (f) => f.match(/^V(\d+)\.(\d+)\.(\d+)__/).slice(1).map(Number);
const byVersion = (a, b) => {
  const [x, y] = [versionOf(a), versionOf(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** The upper bound of the question_count check in the latest migration that sets one. */
function databaseCap() {
  const files = fs.readdirSync(DIR).filter((f) => /^V\d+\.\d+\.\d+__.*\.sql$/.test(f)).sort(byVersion);
  let cap = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--.*$/gm, '');
    const m = [...sql.matchAll(/CHECK\s*\(\s*question_count\s+BETWEEN\s+1\s+AND\s+(\d+)\s*\)/gi)];
    if (m.length) cap = Number(m[m.length - 1][1]);
  }
  return cap;
}

const papers = Patterns.list().flatMap((id) =>
  Object.keys(Patterns.get(id).subjects).map((subject) => [id, subject,
    Patterns.expandTypes(id, subject).reduce((sum, t) => sum + t.count, 0)]));

test('the migrations set a question_count cap', () => {
  expect(databaseCap()).toEqual(expect.any(Number));
});

test.each(papers)('%s %s asks for %i questions, within the database cap', (_id, _subject, total) => {
  expect(total).toBeLessThanOrEqual(databaseCap());
});
