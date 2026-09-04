/**
 * bd-17mht — the figure uploader may only ever write under `lp612/`.
 *
 * The R2 bucket is shared with PK production, byte-identical credentials. The
 * prefix is the only isolation this lane has, so the ref -> key mapping is
 * pinned here: a ref that could escape the prefix must throw, not upload.
 */
const path = require('path');

const { assertKeyInPrefix, R2_KEY_PREFIX } = require('../../bot/shared/services/lp612-serving.service');

// Same mapping the uploader and build_plan.py use.
function keyForRef(ref) {
  const i = ref.indexOf('/');
  if (i < 1) throw new Error(`malformed ref: ${ref}`);
  return `lp612/page-truth/${ref.slice(0, i)}/figures/${ref.slice(i + 1)}.jpg`;
}

describe('lp612 figure upload keys', () => {
  test('a normal ref maps under the guarded prefix', () => {
    const k = keyForRef('grade_10_biology/pg_008_f0');
    expect(k).toBe('lp612/page-truth/grade_10_biology/figures/pg_008_f0.jpg');
    expect(assertKeyInPrefix(k)).toBe(k);
    expect(k.startsWith(R2_KEY_PREFIX)).toBe(true);
  });

  test('the key matches what the plan recorded', () => {
    // build_plan.py's r2_key() must not drift from the uploader's.
    expect(keyForRef('grade_6_geography/pg_047_f0')).toBe(
      'lp612/page-truth/grade_6_geography/figures/pg_047_f0.jpg'
    );
  });

  test('a traversing ref cannot escape lp612/', () => {
    // `..` segments would otherwise resolve out of the prefix at the S3 layer.
    const k = keyForRef('../../pre_gen_lps/x/pg_001_f0');
    expect(() => assertKeyInPrefix(k)).toThrow();
  });

  test('a ref with no book segment is refused before a key is built', () => {
    expect(() => keyForRef('pg_008_f0')).toThrow(/malformed ref/);
  });

  test('PK production prefixes are rejected outright', () => {
    for (const bad of [
      'pre_gen_lps/x.pdf',
      'lesson_plans/y.pdf',
      'lp-cache/v8/z.pdf',
      'lp612x/sneaky.jpg',
    ]) {
      expect(() => assertKeyInPrefix(bad)).toThrow();
    }
  });
});
