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

describe('discovery', () => {
  test('walks a real page-truth tree and finds its books', () => {
    // Runs against the fixture in this repo rather than the corpus, so it works
    // on a fresh clone.
    const root = path.join(__dirname, '__fixtures__', 'page-truth');
    const books = Upload.findBooks(root);
    expect(books).toContain('grade_9_chemistry');
  });
});
