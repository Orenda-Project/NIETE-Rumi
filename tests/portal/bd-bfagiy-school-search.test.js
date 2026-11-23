/**
 * bd-bfagiy — school search ignores spaces, punctuation and capitals (queue #232).
 *
 * The operator, 23 Nov: "on school search the schools are something like I-10/3 etc. It has punctuations and spaces.
 * It is hard to search. The search should be better. at the very least, ignore spaces and punctuations and
 * capitalization."
 *
 * Every school search behind the portal uses one rule, bot/shared/utils/school-search.js:
 *   · the query and the school's name / EMIS are compared with case, spaces and punctuation dropped
 *     ("i103", "I 10 3", "i-10/3" all find "IMSG (I-V) I-10/3");
 *   · each word of the query may sit anywhere in the name, in any order ("IMSG I10");
 *   · the EMIS code matches too;
 *   · best first: the whole thing exactly, then a start, then inside, then the words apart.
 *
 * The portal page's copy of the rule (portal/src/portal/lib/schoolSearch.ts) runs the SAME case table
 * (tests/fixtures/school-search-cases.json), so the two cannot drift.
 *
 * Servers covered here: the bot's /observe school search (the coach app's "Add a school" asks it, and so does the
 * WhatsApp visit Flow), the portal server's re-ranking of those hits, and the coach's report search (teacher or school).
 */

const CASES = require('../fixtures/school-search-cases.json');

const OPERATOR_QUERIES = ['i103', 'I 10 3', 'i-10/3', 'IMSG I10'];

describe('the shared rule, over the case table', () => {
  // eslint-disable-next-line global-require
  const S = (() => { try { return require('../../bot/shared/utils/school-search'); } catch (e) { return {}; } })();
  const fieldsOf = (s) => ({ names: [s.name], codes: [s.emis] });

  it.each(CASES.cases.map((c) => [c.q, c.ids, c.why]))('%j finds %j (%s)', (q, ids) => {
    expect(S.searchSchools(CASES.schools, q, fieldsOf).map((s) => s.id)).toEqual(ids);
  });

  it('the text a search compares: lower case, no spaces, no punctuation, Urdu letters kept', () => {
    expect(S.searchText('IMSG (I-V) I-10/3')).toBe('imsgivi103');
    expect(S.searchText(' No.2, G-10/2 ')).toBe('no2g102');
    expect(S.searchText(null)).toBe('');
    expect(S.searchText('ماڈل اسکول')).toBe('ماڈلاسکول');
  });

  it('rank: exact 0, start 1, inside 2, words apart 3, no match null', () => {
    const f = { names: ['IMSG (I-V) I-10/3'], codes: ['612'] };
    expect(S.schoolMatchRank(f, 'imsg (i-v) i-10/3')).toBe(0);
    expect(S.schoolMatchRank(f, '612')).toBe(0);
    expect(S.schoolMatchRank(f, 'IMSG')).toBe(1);
    expect(S.schoolMatchRank(f, 'I-10/3')).toBe(2);
    expect(S.schoolMatchRank(f, 'i10 imsg')).toBe(3);
    expect(S.schoolMatchRank(f, 'g-10')).toBeNull();
    expect(S.schoolMatchRank({}, 'x')).toBeNull();
  });
});

describe('the bot: /observe school search (Add a school, and the WhatsApp visit Flow)', () => {
  const { matchSchool } = require('../../bot/shared/services/observe/observe-school-admin.service');
  const school = { school_ext_id: 'niete:612', school_name: 'IMSG (I-V) I-10/3', emis: '612' };

  it.each(OPERATOR_QUERIES)('matchSchool finds IMSG (I-V) I-10/3 for %j', (q) => {
    expect(matchSchool(school, q)).toBe(true);
  });

  it('still by EMIS and by the full ext id; not by something it does not hold', () => {
    expect(matchSchool(school, '612')).toBe(true);
    expect(matchSchool(school, 'niete:612')).toBe(true);
    expect(matchSchool(school, 'G-10/3')).toBe(false);
  });
});

describe('the portal server: Add a school ranks the bot\'s hits', () => {
  const Admin = require('../../dashboard/services/coach-school-admin.service');
  const hit = (id, name, emis) => ({ schoolExtId: `niete:${id}`, name, emis, alreadyMine: false });
  const hits = [
    hit('612', 'IMSG (I-V) I-10/3', '612'),
    hit('613', 'IMCG (VI-XII) I-10/4', '613'),
    hit('700', 'I-10/3 Model School', '700'),
  ];
  const client = { searchSchools: jest.fn(async () => ({ status: 200, data: { success: true, schools: hits } })) };

  it.each([
    ['i103', ['niete:700', 'niete:612', 'niete:613']],
    ['I 10 3', ['niete:700', 'niete:612', 'niete:613']],
    ['i-10/3', ['niete:700', 'niete:612', 'niete:613']],
    // the two that do not match keep the old tie-break: by name
    ['IMSG I10', ['niete:612', 'niete:700', 'niete:613']],
  ])('%j: the right school first', async (q, order) => {
    const out = await Admin.searchSchools(client, 'coach-me', q);
    expect(out.data.schools.map((s) => s.schoolExtId)).toEqual(order);
  });
});

describe('the coach\'s report search: a teacher or a school, typed any way', () => {
  const { filterReports } = require('../../dashboard/services/coach-v2.service');
  const row = { id: 'r1', teacherName: 'Tahira Manzoor', schoolName: 'IMSG (I-V) I-10/3', teacherPhone: '923001234567' };
  const ids = (rows, q) => filterReports(rows, q).map((r) => r.id);

  it.each([...OPERATOR_QUERIES, 'tahira i-10/3', 'MANZOOR'])('%j finds the report', (q) => {
    expect(ids([row], q)).toEqual(['r1']);
  });

  it('a phone still matches by its digits, and a stranger does not', () => {
    expect(ids([row], '0300 1234567')).toEqual(['r1']);
    expect(ids([row], 'G-10/3')).toEqual([]);
  });

  it('a school name with four or more digits in it is still a school search, not only a phone', () => {
    expect(ids([{ ...row, schoolName: 'IMS(I-V) No.2 G-10/2' }], 'no2 g-10/2')).toEqual(['r1']);
  });

  it('keeps the reports in their own order (newest first), and words found apart only when nothing closer', () => {
    const rows = [
      { ...row, id: 'new', schoolName: 'IMCB G-10/3' },
      row,
      { ...row, id: 'old', teacherName: 'Sana Riaz' },
    ];
    expect(ids(rows, 'I 10 3')).toEqual(['r1', 'old']);
    expect(ids(rows, 'tahira')).toEqual(['new', 'r1']);
  });
});
