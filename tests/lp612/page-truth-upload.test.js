/**
 * Getting the printed-page text to where the author can read it.
 *
 * The author needs `_book.json`, `_toc.json` and one `pg_NNN.json` per printed
 * page. In production those come from R2, so something has to put them there.
 *
 * The whole corpus is about a gigabyte, and roughly 994 MB of that is `figures/`
 * — scanned crops the renderer degrades gracefully without. So the default is
 * text only, and taking the figures is an explicit flag. That default is the
 * thing most worth a test: getting it backwards means a routine upload moves a
 * gigabyte.
 */

const path = require('path');
const Upload = require('../../bot/scripts/upload-lp612-page-truth');

const { planUpload, r2KeyFor } = Upload;

const FILES = [
  '_book.json',
  '_toc.json',
  'pg_007.json',
  'pg_008.json',
  'figures/fig_1.png',
  'figures/fig_2.png',
  'notes.txt',
  'pg_009.json.bak',
];

describe('the key layout matches what the author reads', () => {
  test('keys are lp612/page-truth/<book_stem>/<file>', () => {
    expect(r2KeyFor('grade_9_chemistry', '_book.json'))
      .toBe('lp612/page-truth/grade_9_chemistry/_book.json');
    expect(r2KeyFor('grade_9_chemistry', 'pg_007.json'))
      .toBe('lp612/page-truth/grade_9_chemistry/pg_007.json');
  });
});

describe('what gets uploaded', () => {
  test('text page-truth only, by default', () => {
    const plan = planUpload({ bookStem: 'grade_9_chemistry', files: FILES });
    expect(plan.map((p) => p.file).sort())
      .toEqual(['_book.json', '_toc.json', 'pg_007.json', 'pg_008.json']);
  });

  test('figures are excluded unless explicitly asked for', () => {
    // ~994 MB of the ~1 GB corpus. The renderer degrades to a "book reference"
    // card without them, so this is a real choice, not an oversight.
    const without = planUpload({ bookStem: 'b', files: FILES });
    expect(without.some((p) => p.file.startsWith('figures/'))).toBe(false);

    const with_ = planUpload({ bookStem: 'b', files: FILES, includeFigures: true });
    expect(with_.map((p) => p.file)).toEqual(expect.arrayContaining([
      'figures/fig_1.png', 'figures/fig_2.png',
    ]));
  });

  test('non-page-truth clutter is left behind', () => {
    const plan = planUpload({ bookStem: 'b', files: FILES });
    const names = plan.map((p) => p.file);
    expect(names).not.toContain('notes.txt');
    expect(names).not.toContain('pg_009.json.bak');
  });

  test('a book with no _book.json is reported rather than half-uploaded', () => {
    // The author throws PAGE_TRUTH_MISSING on a book whose _book.json is absent,
    // so uploading its pages would produce a book that looks present and is not.
    const plan = planUpload({ bookStem: 'b', files: ['pg_007.json', '_toc.json'] });
    expect(plan).toEqual([]);
  });

  test('each planned entry carries its content type', () => {
    const plan = planUpload({ bookStem: 'b', files: FILES, includeFigures: true });
    const byFile = Object.fromEntries(plan.map((p) => [p.file, p.contentType]));
    expect(byFile['_book.json']).toBe('application/json');
    expect(byFile['figures/fig_1.png']).toBe('image/png');
  });

  test('the plan is stable — same input, same order', () => {
    const a = planUpload({ bookStem: 'b', files: FILES });
    const b = planUpload({ bookStem: 'b', files: [...FILES].reverse() });
    expect(a.map((p) => p.key)).toEqual(b.map((p) => p.key));
  });
});

describe('the prefix guard — the only isolation this bucket has', () => {
  // NIETE and the main PK bot share ONE R2 bucket with byte-identical
  // credentials. There is no storage isolation between the two deployments,
  // only prefix discipline, so a script with a wrong key prefix lands on top of
  // PK production assets. The K-5 v8 uploader refuses to write outside its own
  // prefix for exactly this reason; this is the same guard.
  const { assertKeyInPrefix, KEY_PREFIX } = Upload;

  test('the prefix is the namespace this feature owns', () => {
    expect(KEY_PREFIX).toBe('lp612/page-truth/');
  });

  test('a key inside the prefix is allowed', () => {
    expect(() => assertKeyInPrefix('lp612/page-truth/grade_9_chemistry/_book.json')).not.toThrow();
  });

  test.each([
    ['a PK production LP cache prefix', 'pre_gen_lps/foo.json'],
    ['the other LP prefix', 'lesson_plans/foo.json'],
    ['the K-5 v8 corpus prefix', 'lp-cache/v8/foo.pdf'],
    ['session audio', 'audio/whatever.ogg'],
    ['the bucket root', 'foo.json'],
    ['a near-miss on our own prefix', 'lp612/page-truthX/foo.json'],
  ])('refuses to write to %s', (_label, key) => {
    expect(() => assertKeyInPrefix(key)).toThrow(/refus|prefix/i);
  });

  test('refuses a traversal that would climb out of the prefix', () => {
    expect(() => assertKeyInPrefix('lp612/page-truth/../../pre_gen_lps/x.json')).toThrow();
  });

  test('a book stem that would escape the prefix cannot be planned', () => {
    // Book stems come from directory names on disk, so they are input.
    expect(() => planUpload({ bookStem: '../../..', files: ['_book.json'] })).toThrow();
  });

  test('every key the planner emits passes its own guard', () => {
    const plan = planUpload({ bookStem: 'grade_9_chemistry', files: FILES, includeFigures: true });
    expect(plan.length).toBeGreaterThan(0);
    for (const item of plan) expect(() => assertKeyInPrefix(item.key)).not.toThrow();
  });
});

describe('the upload pool', () => {
  // Sequential PUTs to APAC measured ~1.7s each, which is ~5 hours for the
  // 11,261-file corpus. A bounded pool makes the run feasible; bounded rather
  // than unbounded because 11k simultaneous sockets is its own failure.
  const { runPool } = Upload;

  test('every item is processed exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen = [];
    await runPool(items, async (n) => { seen.push(n); }, 8);
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 40 }, (_, i) => i), async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    }, 5);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  test('a failure propagates rather than being silently dropped', async () => {
    // A partially-uploaded book that reports success is worse than a loud
    // failure: the author would find _book.json and fail on a missing page.
    await expect(runPool([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('R2 503');
    }, 2)).rejects.toThrow('R2 503');
  });

  test('an empty list is fine', async () => {
    await expect(runPool([], async () => {}, 4)).resolves.toBeUndefined();
  });
});

describe('discovery', () => {
  test('walks a real page-truth tree and finds its books', () => {
    // Runs against the fixture in this repo rather than the corpus, so it works
    // on a fresh clone.
    const root = path.join(__dirname, '__fixtures__', 'page-truth');
    const books = Upload.findBooks(root);
    expect(books).toContain('grade_9_chemistry');
  });
});
