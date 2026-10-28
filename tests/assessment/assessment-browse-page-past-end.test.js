/**
 * A page past the end of her papers is an empty page, not an error.
 *
 * PostgREST answers a range that starts beyond the last row with 416 and the
 * body {code:'PGRST103', message:'Requested range not satisfiable'}; supabase-js
 * hands that back as `error`, with `count` null (it only reads Content-Range on
 * a 2xx). "My papers" reached it with 12 papers at 10 a page by asking for page
 * 3, and the teacher saw "Could not load your papers" four times.
 */

const mockSupabase = { from: jest.fn() };

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn(), buildR2PublicUrl: jest.fn() }));

const Browse = () => require('../../bot/shared/services/assessment/assessment-browse.service');

/** A chainable stub whose terminal await resolves to `result`; records select() options. */
function table(result, capture = {}) {
  const b = {};
  ['select', 'eq', 'in', 'order', 'limit', 'range', 'not'].forEach((m) => {
    b[m] = (...args) => { (capture[m] ||= []).push(args); return b; };
  });
  b.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return b;
}

// The body PostgREST really sends (prod, 28 Oct), as supabase-js returns it.
const RANGE_416 = {
  data: null,
  count: null,
  status: 416,
  error: {
    code: 'PGRST103',
    details: 'An offset of 20 was requested, but there are only 12 rows.',
    hint: null,
    message: 'Requested range not satisfiable',
  },
};

beforeEach(() => { jest.clearAllMocks(); mockSupabase.from.mockReset(); });

describe('listPapers — a page past the end', () => {
  it('returns an empty page with the real total instead of throwing', async () => {
    const page = {};
    const head = {};
    mockSupabase.from
      .mockReturnValueOnce(table(RANGE_416, page))
      .mockReturnValueOnce(table({ data: null, error: null, count: 12 }, head));

    const out = await Browse().listPapers('u1', { page: 3, pageSize: 10 });

    expect(out).toEqual({ page: 3, pageSize: 10, total: 12, papers: [] });
    expect(page.range).toEqual([[20, 29]]);
    // The total is read with the same filters, as a count with no rows.
    expect(head.select[0][1]).toMatchObject({ count: 'exact', head: true });
    expect(JSON.stringify(head.eq)).toContain('assessment_papers.status');
    expect(JSON.stringify(head.eq)).toContain('u1');
  });

  it('keeps the grade and subject filter on the total', async () => {
    const head = {};
    mockSupabase.from
      .mockReturnValueOnce(table(RANGE_416))
      .mockReturnValueOnce(table({ data: null, error: null, count: 2 }, head));

    const out = await Browse().listPapers('u1', { page: 2, pageSize: 10, grade: 4, subject: 'science' });

    expect(out.total).toBe(2);
    expect(out.papers).toEqual([]);
    expect(JSON.stringify(head.eq)).toContain('grade_4');
    expect(JSON.stringify(head.eq)).toContain('science');
  });

  it('still throws when the total cannot be read either', async () => {
    mockSupabase.from
      .mockReturnValueOnce(table(RANGE_416))
      .mockReturnValueOnce(table({ data: null, error: { message: 'boom' }, count: null }));

    await expect(Browse().listPapers('u1', { page: 3 })).rejects.toThrow('Could not list papers');
  });

  it('any other error still throws', async () => {
    mockSupabase.from.mockReturnValueOnce(table({
      data: null, count: null, status: 500, error: { code: '57014', message: 'canceling statement due to statement timeout' },
    }));

    await expect(Browse().listPapers('u1', { page: 1 })).rejects.toThrow('Could not list papers');
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });
});
