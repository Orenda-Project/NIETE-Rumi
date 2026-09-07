/**
 * The pager itself (bd-oak77.27).
 *
 * `pagedRows` is the one place in the codebase that knows how to read a whole
 * result set out of PostgREST. Everything above it — the 6-12 subject, chapter
 * and lesson menus, both endpoint fallback corpora, and the K-5 availability
 * set — is correct only if this is, so its edges are pinned here rather than
 * inferred from the callers.
 *
 * The property that matters: **a short page is the ONLY proof of the end of a
 * set.** A full page is indistinguishable from a server-truncated one, which is
 * the entire reason the loop exists.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { logToFile } = require('../../bot/shared/utils/logger');
const { pagedRows, PAGE, MAX_PAGES } = require('../../bot/shared/utils/postgrest-paged');

/**
 * A fake table of `n` rows served through `.range()`, capping every window at
 * the server's max-rows exactly as PostgREST does — silently, with no error.
 */
function server(n, { failOnPage = null } = {}) {
  const windows = [];
  const build = () => ({
    range: (from, to) => {
      windows.push([from, to]);
      const page = Math.floor(from / PAGE);
      if (failOnPage === page) {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
      const end = Math.min(to, from + PAGE - 1, n - 1);
      const data = [];
      for (let i = from; i <= end; i += 1) data.push({ i });
      return Promise.resolve({ data, error: null });
    },
  });
  return { build, windows };
}

beforeEach(() => jest.clearAllMocks());

describe('pagedRows', () => {
  test('a set smaller than one page costs exactly one round trip', async () => {
    const s = server(12);
    expect(await pagedRows('t', s.build)).toHaveLength(12);
    expect(s.windows).toEqual([[0, PAGE - 1]]);
  });

  test('an empty set is one round trip and no rows', async () => {
    const s = server(0);
    expect(await pagedRows('t', s.build)).toEqual([]);
    expect(s.windows).toHaveLength(1);
  });

  test('a set larger than the cap comes back WHOLE, in order', async () => {
    const s = server(PAGE + 263);
    const rows = await pagedRows('t', s.build);
    expect(rows).toHaveLength(PAGE + 263);
    expect(rows[0].i).toBe(0);
    expect(rows[rows.length - 1].i).toBe(PAGE + 262);
  });

  test('a set that is an EXACT multiple of the page still terminates', async () => {
    // The dangerous edge: page 1 is full, so only the empty page 2 proves the end.
    const s = server(PAGE * 2);
    expect(await pagedRows('t', s.build)).toHaveLength(PAGE * 2);
    expect(s.windows).toHaveLength(3);
  });

  test('the window is never wider than the server cap', async () => {
    const s = server(PAGE * 2 + 1);
    await pagedRows('t', s.build);
    for (const [from, to] of s.windows) expect(to - from + 1).toBe(PAGE);
  });

  test('an error on the first page yields [] and is logged', async () => {
    const s = server(50, { failOnPage: 0 });
    expect(await pagedRows('subjects', s.build)).toEqual([]);
    expect(logToFile).toHaveBeenCalledWith(
      'postgrest-paged: read failed', expect.objectContaining({ label: 'subjects', page: 0 }),
    );
  });

  test('an error PART WAY through returns what it has and says so', async () => {
    // Better a short menu with a log line than a thrown request: the caller's
    // contract is "[] on failure", and a half-read set is still tappable.
    const s = server(PAGE * 3, { failOnPage: 1 });
    expect(await pagedRows('chapters', s.build)).toHaveLength(PAGE);
    expect(logToFile).toHaveBeenCalledWith(
      'postgrest-paged: read failed', expect.objectContaining({ page: 1 }),
    );
  });

  test('the page ceiling SHOUTS rather than truncating quietly', async () => {
    const s = server(PAGE * (MAX_PAGES + 5));
    const rows = await pagedRows('runaway', s.build);
    expect(rows).toHaveLength(PAGE * MAX_PAGES);
    expect(logToFile).toHaveBeenCalledWith(
      'postgrest-paged: hit the page ceiling — the set may be incomplete',
      expect.objectContaining({ label: 'runaway', pages: MAX_PAGES }),
    );
  });

  test('the page size EQUALS the measured server cap — a bigger window is silently trimmed', () => {
    // MEASURED 2026-09-07 on ihzciabopbttygxxgrkm (prod) and rpqkekcfvumypldbejhp
    // (staging): an unbounded select on niete_lp612_segments returns exactly 1000
    // rows, content-range 0-999/6618. A window above the cap would come back short
    // on every page and end the loop after one, which is the bug wearing a fix.
    expect(PAGE).toBe(1000);
  });
});
