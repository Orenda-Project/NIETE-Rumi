/**
 * Which books a teacher's Grade 1-5 menu holds (bd-97daxo.4, book-first).
 *
 * A region may name its books in region_features.book_keys (V1.9.2). A teacher whose region names
 * none — every sector teacher, a teacher with no region, the deployment-wide 'niete' row — gets
 * null, which every catalog read takes as "today's ICT list". Any read error is null too: a
 * teacher must always get a menu, and the ICT one is the one everybody had before.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { createMemorySupabase } = require('../fixtures/memory-supabase');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');

const GB_KEYS = ['gb_g1_english', 'grade_1_general_knowledge_en', 'grade_1_islamiat'];

const seed = () => ({
  users: [
    { id: 'gb', region: 'Gilgit-Baltistan' },
    { id: 'gb-lower', region: 'gilgit-baltistan' },
    { id: 'sector', region: 'Sihala' },
    { id: 'none', region: null },
  ],
  region_features: [
    { region: 'niete', organization: null, display_name: null, book_keys: null },
    { region: 'sihala', organization: 'niete', display_name: 'Sihala', book_keys: null },
    { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', book_keys: GB_KEYS },
  ],
});

beforeEach(() => TeacherBooks._clearCache());

it("a GB teacher gets her region's book list, whichever spelling users.region holds", async () => {
  const client = createMemorySupabase(seed());
  expect(await TeacherBooks.bookKeysForUser('gb', { client })).toEqual(GB_KEYS);
  expect(await TeacherBooks.bookKeysForUser('gb-lower', { client })).toEqual(GB_KEYS);
  expect(await TeacherBooks.bookKeysForRegion('Gilgit-Baltistan', { client })).toEqual(GB_KEYS);
});

it('a sector teacher, a teacher with no region, an unknown user and no user all get null (the ICT list)', async () => {
  const client = createMemorySupabase(seed());
  for (const id of ['sector', 'none', 'nobody', null, undefined, '']) {
    expect(await TeacherBooks.bookKeysForUser(id, { client })).toBeNull();
  }
  expect(await TeacherBooks.bookKeysForRegion('niete', { client })).toBeNull();
});

it('an empty book_keys array is an empty shelf, not the ICT list', async () => {
  const s = seed();
  s.region_features[2].book_keys = [];
  const client = createMemorySupabase(s);
  expect(await TeacherBooks.bookKeysForUser('gb', { client })).toEqual([]);
});

it('a registry that cannot be read is null, never a throw', async () => {
  const broken = { from: () => { throw new Error('column region_features.book_keys does not exist'); } };
  expect(await TeacherBooks.bookKeysForUser('gb', { client: broken })).toBeNull();
  expect(await TeacherBooks.bookKeysForRegion('Gilgit-Baltistan', { client: broken })).toBeNull();
});

it('while no region names books, a teacher is not looked up at all', async () => {
  const s = seed();
  s.region_features[2].book_keys = null;
  const client = createMemorySupabase(s);
  const from = jest.spyOn(client, 'from');
  expect(await TeacherBooks.bookKeysForUser('gb', { client })).toBeNull();
  expect(from.mock.calls.map((c) => c[0])).not.toContain('users');
});

// bd-6nskfq.1 — GB's own books are loaded as textbooks under her curriculum (nbf_snc, bd-6nskfq). A G1-5 subject
// is offered when her list names her own book for it (gb_g5_maths) AND her curriculum holds that textbook; the
// generator then reads her book (book-curriculum). A key with no loaded book offers nothing, so she is never handed
// ICT's book under her own book's name.
describe('assessmentOfferedFor — her own curriculum\'s book', () => {
  const GB = ['gb_g5_maths', 'gb_g5_science', 'gb_g5_urdu', 'grade_5_islamiat'];
  const books = (rows) => createMemorySupabase({ textbooks: rows });
  const nbf = (grade, subject) => ({ id: `nbf-${grade}-${subject}`, curriculum: 'nbf_snc', grade, subject });

  it('offers G5 Maths and Science when her list has gb_g5_<subject> and an nbf_snc textbook is loaded', async () => {
    const client = books([nbf(5, 'maths'), nbf(5, 'science')]);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'maths', GB, 'nbf_snc', { client })).toBe(true);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'science', GB, 'nbf_snc', { client })).toBe(true);
  });

  it('does not offer a subject whose book is on her list but not loaded (no nbf_snc row)', async () => {
    const client = books([nbf(5, 'maths')]);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'urdu', GB, 'nbf_snc', { client })).toBe(false);
  });

  it('does not offer a loaded book that is not on her list', async () => {
    const client = books([nbf(5, 'english')]);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'english', GB, 'nbf_snc', { client })).toBe(false);
  });

  it('an ICT teacher (no list, or curriculum ict) is the rule she had, with no textbook read', async () => {
    const client = books([nbf(5, 'maths')]);
    const from = jest.spyOn(client, 'from');
    expect(await TeacherBooks.assessmentOfferedFor(5, 'maths', null, 'ict', { client })).toBe(true);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'maths', GB, 'ict', { client })).toBe(false);
    expect(await TeacherBooks.assessmentOfferedFor(5, 'islamiat', GB, 'nbf_snc', { client })).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('a textbook read that fails offers nothing (never ICT\'s book under her book\'s name)', async () => {
    const broken = { from: () => { throw new Error('boom'); } };
    expect(await TeacherBooks.assessmentOfferedFor(5, 'maths', GB, 'nbf_snc', { client: broken })).toBe(false);
  });

  it('maps the subject spellings the generator uses onto the book key', () => {
    expect(TeacherBooks.ownBookListed(5, 'math', GB)).toBe(true);
    expect(TeacherBooks.ownBookListed(5, 'general_science', GB)).toBe(true);
    expect(TeacherBooks.ownBookListed(4, 'maths', GB)).toBe(false);
    expect(TeacherBooks.ownBookListed(5, 'islamiat', GB)).toBe(false);
  });
});
