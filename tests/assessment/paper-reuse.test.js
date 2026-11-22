/**
 * Re-serving a board-pattern paper (bd-2oi189). A paper written for the exact same generator inputs
 * is handed to the next teacher who asks, instead of paying the writer again. A teacher who asks
 * again gets a paper she has not had (Amena, 6 Nov): her own papers, and the donors they came from,
 * are never handed back to her. Edited, unfinished and old papers are never donors.
 */
const Reuse = require('../../bot/shared/services/assessment/paper-reuse');

const BASE = {
  grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null, readerPass: {}, splitRetry: {}, stemCheck: {},
};

describe('reuseKey', () => {
  test('is a stable hex digest, independent of key order', () => {
    const a = Reuse.reuseKey(BASE);
    const b = Reuse.reuseKey({ ...BASE, scope: { pages: null, chapters: null, kind: 'fde' } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  test.each([
    ['grade', { grade: 4 }],
    ['subject', { subject: 'english' }],
    ['pattern', { pattern: 'other' }],
    ['scope kind', { scope: { kind: 'chapters', chapters: null, pages: null } }],
    ['scope chapters', { scope: { kind: 'chapters', chapters: [1, 2], pages: null } }],
    ['page ranges', { pageRanges: '1-20' }],
    ['chapter', { chapterNumber: 3 }],
    ['reader pass', { readerPass: { readerPass: true } }],
    ['split retry', { splitRetry: { splitRetry: true } }],
    ['stem check', { stemCheck: { stemCheck: true } }],
  ])('changes with the %s', (_name, change) => {
    expect(Reuse.reuseKey({ ...BASE, ...change })).not.toBe(Reuse.reuseKey(BASE));
  });
});

describe('stamp', () => {
  test('adds _reuse without touching the rest of the paper', () => {
    const exam = { seen: [1], _layout: { profile: 'board' } };
    const out = Reuse.stamp(exam, { key: 'k', from: 'p0', pageReference: '1-40' });
    expect(out).toEqual({ seen: [1], _layout: { profile: 'board' }, _reuse: { key: 'k', from: 'p0', page_reference: '1-40' } });
    expect(exam._reuse).toBeUndefined();
  });

  test('an original has no from', () => {
    expect(Reuse.stamp({}, { key: 'k', pageReference: null })._reuse).toEqual({ key: 'k', page_reference: null });
  });
});

/** A fake supabase that answers the user's-own query and the donor query from two row lists. */
function fakeDb({ own = [], donors = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, select: null, filters: [], order: null, limit: null };
      calls.push(q);
      const b = {
        select: (s) => { q.select = s; return b; },
        eq: (k, v) => { q.filters.push(['eq', k, v]); return b; },
        is: (k, v) => { q.filters.push(['is', k, v]); return b; },
        gte: (k, v) => { q.filters.push(['gte', k, v]); return b; },
        order: (k, o) => { q.order = [k, o]; return b; },
        limit: (n) => { q.limit = n; return b; },
        then: (ok, ko) => {
          if (fail) return Promise.reject(new Error('db down')).then(ok, ko);
          const mine = q.filters.some(([, k]) => k === 'assessment_requests.user_id');
          return Promise.resolve({ data: mine ? own : donors, error: null }).then(ok, ko);
        },
      };
      return b;
    },
  };
}

const donor = (id, extra = {}) => ({
  id, exam_json: { seen: [id], _layout: { profile: 'board', pages: { paper: 4 }, frame_pages: 2 }, _reuse: { key: 'K', page_reference: '1-40' } },
  question_count: 48, model: 'anthropic-direct/claude-sonnet-5-5', ...extra,
});

describe('findDonor', () => {
  test('hands back the newest original she has not had, its stamp and layout pages stripped', async () => {
    const db = fakeDb({ donors: [donor('p3'), donor('p2')] });
    const got = await Reuse.findDonor({ db, key: 'K', userId: 'u1' });
    expect(got).toEqual({
      id: 'p3', questionCount: 48, model: 'anthropic-direct/claude-sonnet-5-5', pageReference: '1-40',
      examJson: { seen: ['p3'], _layout: { profile: 'board' } },
    });
  });

  test('skips papers she already has, by id and by the donor they came from', async () => {
    const own = [{ id: 'p3', _reuse: { key: 'K' } }, { id: 'p9', _reuse: { key: 'K', from: 'p2' } }];
    const db = fakeDb({ own, donors: [donor('p3'), donor('p2'), donor('p1')] });
    expect((await Reuse.findDonor({ db, key: 'K', userId: 'u1' })).id).toBe('p1');
  });

  test('null when she has had every donor', async () => {
    const db = fakeDb({ own: [{ id: 'p1', _reuse: { key: 'K' } }], donors: [donor('p1')] });
    expect(await Reuse.findDonor({ db, key: 'K', userId: 'u1' })).toBeNull();
  });

  test('null when there is no donor', async () => {
    expect(await Reuse.findDonor({ db: fakeDb(), key: 'K', userId: 'u1' })).toBeNull();
  });

  test('null without a key, with no read', async () => {
    const db = fakeDb({ donors: [donor('p1')] });
    expect(await Reuse.findDonor({ db, key: null, userId: 'u1' })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  test('fails open: a read error gives null', async () => {
    expect(await Reuse.findDonor({ db: fakeDb({ fail: true }), key: 'K', userId: 'u1' })).toBeNull();
  });

  test('donors are ready, unedited, originals, recent, on this key, newest first', async () => {
    const db = fakeDb({ donors: [donor('p1')] });
    const now = new Date('2026-11-22T00:00:00Z');
    await Reuse.findDonor({ db, key: 'K', userId: 'u1', now });
    const q = db.calls.find((c) => !c.filters.some(([, k]) => k === 'assessment_requests.user_id'));
    expect(q.table).toBe('assessment_papers');
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'exam_json->_reuse->>key', 'K'],
      ['is', 'exam_json->_reuse->>from', null],
      ['eq', 'status', 'ready'],
      ['is', 'edited_from', null],
      ['gte', 'created_at', '2026-10-23T00:00:00.000Z'],
    ]));
    expect(q.order).toEqual(['created_at', { ascending: false }]);
    expect(q.limit).toBeGreaterThan(0);
  });

  test('her own papers are read on this key through her requests', async () => {
    const db = fakeDb();
    await Reuse.findDonor({ db, key: 'K', userId: 'u1' });
    const q = db.calls.find((c) => c.filters.some(([, k]) => k === 'assessment_requests.user_id'));
    expect(q.select).toMatch(/assessment_requests!inner\(user_id\)/);
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'exam_json->_reuse->>key', 'K'],
      ['eq', 'assessment_requests.user_id', 'u1'],
    ]));
  });
});
