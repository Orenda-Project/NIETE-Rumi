/**
 * The mock lane's database can answer the book-curriculum reads (bd-rj6w0n.14.14).
 *
 * The lane builds its local database from supabase/baseline/schema.sql (a sandbox dump) and does NOT run the
 * migrations. V1.8.6 added niete_lp612_segments.curriculum and V1.9.0 widened its grade check to 1-12 after the dump,
 * so on the lane:
 *   - the 6-12 catalog's `.eq('curriculum','ict')` (lp612-catalog menuQuery/servable) answered 42703, and lesson-plan
 *     L03 / OBS29 / CT09 failed there although sandbox was fine;
 *   - a Gilgit-Baltistan grades 1-5 (nbf_snc) segment could not be inserted, so no GB scenario could run.
 *
 * Pinned statically (no database needed, so CI runs it):
 *   1. niete_lp612_segments.curriculum is in the dump with V1.8.6's type, NOT NULL and default;
 *   2. the dump's grade check is V1.9.0's 1-12, not the old 6-12;
 *   3. schema.objects.txt (what `local-db.sh drift` compares) lists the column.
 * assessment_topics (V1.8.6's other column) is not in the dump at all, so there is nothing to patch for it.
 */
const fs = require('fs');
const path = require('path');
const { REPO } = require('./test-seam-gates-lib');

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const BASELINE = 'supabase/baseline/schema.sql';
const OBJECTS = 'supabase/baseline/schema.objects.txt';
const V186 = 'infrastructure/supabase/migrations/V1.8.6__book_curriculum.sql';
const V190 = 'infrastructure/supabase/migrations/V1.9.0__lp612_segments_grade_1_12.sql';

function segmentsBody() {
  const m = /CREATE TABLE public\.niete_lp612_segments \(\n([\s\S]*?)\n\);/.exec(read(BASELINE));
  if (!m) throw new Error(`${BASELINE} has no CREATE TABLE public.niete_lp612_segments`);
  return m[1];
}

describe('the mock lane database answers the book-curriculum reads', () => {
  test("niete_lp612_segments.curriculum is in the dump with V1.8.6's type, NOT NULL and default", () => {
    expect(read(V186)).toMatch(/ALTER TABLE niete_lp612_segments ADD COLUMN IF NOT EXISTS curriculum TEXT NOT NULL DEFAULT 'ict';/);
    const line = segmentsBody().split('\n').find((l) => /^\s+curriculum /.test(l));
    expect(line && line.trim().replace(/,$/, '')).toBe("curriculum text DEFAULT 'ict'::text NOT NULL");
  });

  test("the dump's grade check is V1.9.0's 1-12", () => {
    expect(read(V190)).toMatch(/CHECK \(grade BETWEEN 1 AND 12\)/);
    const check = segmentsBody().split('\n').find((l) => /niete_lp612_segments_grade_check/.test(l));
    expect(check).toMatch(/CHECK \(\(\(grade >= 1\) AND \(grade <= 12\)\)\)/);
  });

  test('schema.objects.txt lists the column, so local-db.sh drift does not report it', () => {
    expect(read(OBJECTS).split('\n')).toContain('niete_lp612_segments.curriculum:text');
  });
});
