/**
 * A fixed, checked set of whole-book papers per subject. A full-book request on a pattern that has a
 * set is served from it: a paper from the set she has not had, else null (a fresh paper). The
 * set is the rows stamped `_reuse.set = '<set>/<subject>'`; her copies point at them through `_reuse.from`.
 */
const FixedSet = require('../../bot/shared/services/assessment/paper-fixed-set');

const FULL = { kind: 'fde', chapters: null, pages: null };

describe('setFor', () => {
  test('a full-book G5 FDE request has a set per subject', () => {
    expect(FixedSet.setFor({ pattern: 'fde_g5_2027', scope: FULL, subject: 'maths' })).toBe('fde_g5_2027-v1/maths');
    expect(FixedSet.setFor({ pattern: 'fde_g5_2027', scope: FULL, subject: 'social_studies' })).toBe('fde_g5_2027-v1/social_studies');
  });

  test.each([
    ['chosen chapters', { pattern: 'fde_g5_2027', scope: { kind: 'chapters', chapters: [1, 2], pages: null }, subject: 'maths' }],
    ['chosen pages', { pattern: 'fde_g5_2027', scope: { kind: 'pages', chapters: null, pages: '1-20' }, subject: 'maths' }],
    ['no scope', { pattern: 'fde_g5_2027', scope: null, subject: 'maths' }],
    ['a pattern with no set', { pattern: 'fbise_g9_2027', scope: FULL, subject: 'maths' }],
    ['no subject', { pattern: 'fde_g5_2027', scope: FULL, subject: null }],
  ])('none for %s', (_name, req) => {
    expect(FixedSet.setFor(req)).toBeNull();
  });
});

/** A fake supabase: the set query and her-papers query answer from two row lists. */
function fakeDb({ set = [], own = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, select: null, filters: [], order: null };
      calls.push(q);
      const b = {
        select: (s) => { q.select = s; return b; },
        eq: (k, v) => { q.filters.push(['eq', k, v]); return b; },
        is: (k, v) => { q.filters.push(['is', k, v]); return b; },
        order: (k, o) => { q.order = [k, o]; return b; },
        then: (ok, ko) => {
          if (fail) return Promise.reject(new Error('db down')).then(ok, ko);
          const mine = q.filters.some(([, k]) => k === 'assessment_requests.user_id');
          return Promise.resolve({ data: mine ? own : set, error: null }).then(ok, ko);
        },
      };
      return b;
    },
  };
}

const paper = (id) => ({
  id, exam_json: { seen: [id], _layout: { profile: 'fde', pages: { paper: 4 } }, _reuse: { key: 'K', set: 'S', page_reference: '1-40' } },
  question_count: 48, model: 'sonnet',
});
const SET = [paper('s1'), paper('s2'), paper('s3')];
const copy = (id, from, createdAt) => ({ id, created_at: createdAt, _reuse: { key: 'K2', from } });

describe('findSetPaper', () => {
  test('the first set paper she has not had, its stamp and page counts stripped', async () => {
    const got = await FixedSet.findSetPaper({ db: fakeDb({ set: SET }), set: 'S', subject: 'maths', userId: 'u1' });
    expect(got).toEqual({
      id: 's1', questionCount: 48, model: 'sonnet', pageReference: '1-40',
      examJson: { seen: ['s1'], _layout: { profile: 'fde' } },
    });
  });

  test('skips set papers she was served, and a set paper first written for her', async () => {
    const own = [copy('c1', 's1', '2026-11-20T00:00:00Z'), { id: 's2', created_at: '2026-11-01T00:00:00Z', _reuse: { key: 'K', set: 'S' } }];
    const got = await FixedSet.findSetPaper({ db: fakeDb({ set: SET, own }), set: 'S', subject: 'maths', userId: 'u1' });
    expect(got.id).toBe('s3');
  });

  test('when she has had all of them, null: she gets a fresh paper, not a repeat', async () => {
    const own = [
      copy('c1', 's1', '2026-11-20T00:00:00Z'),
      copy('c2', 's2', '2026-11-05T00:00:00Z'),
      copy('c3', 's3', '2026-11-12T00:00:00Z'),
      copy('c4', 's2', '2026-11-25T00:00:00Z'),
    ];
    const got = await FixedSet.findSetPaper({ db: fakeDb({ set: SET, own }), set: 'S', subject: 'maths', userId: 'u1' });
    expect(got).toBeNull();
  });

  test('null when the set is empty', async () => {
    expect(await FixedSet.findSetPaper({ db: fakeDb(), set: 'S', subject: 'maths', userId: 'u1' })).toBeNull();
  });

  test('null without a set, with no read', async () => {
    const db = fakeDb({ set: SET });
    expect(await FixedSet.findSetPaper({ db, set: null, subject: 'maths', userId: 'u1' })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  test('fails open: a read error gives null', async () => {
    expect(await FixedSet.findSetPaper({ db: fakeDb({ fail: true }), set: 'S', subject: 'maths', userId: 'u1' })).toBeNull();
  });

  test('the set is ready, unedited rows stamped with the set, in a fixed order', async () => {
    const db = fakeDb({ set: SET });
    await FixedSet.findSetPaper({ db, set: 'S', subject: 'maths', userId: 'u1' });
    const q = db.calls.find((c) => !c.filters.some(([, k]) => k === 'assessment_requests.user_id'));
    expect(q.table).toBe('assessment_papers');
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'exam_json->_reuse->>set', 'S'],
      ['eq', 'status', 'ready'],
      ['is', 'edited_from', null],
      ['is', 'edited_at', null],
    ]));
    expect(q.order).toEqual(['created_at', { ascending: true }]);
  });

  test('her papers are read for this subject through her requests', async () => {
    const db = fakeDb({ set: SET });
    await FixedSet.findSetPaper({ db, set: 'S', subject: 'maths', userId: 'u1' });
    const q = db.calls.find((c) => c.filters.some(([, k]) => k === 'assessment_requests.user_id'));
    expect(q.select).toMatch(/assessment_requests!inner\(user_id, subject_code\)/);
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'assessment_requests.user_id', 'u1'],
      ['eq', 'assessment_requests.subject_code', 'maths'],
    ]));
  });
});
