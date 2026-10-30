/**
 * book-curriculum — which curriculum's book a teacher gets (bd-97daxo.4).
 *
 * A teacher gets her REGION's curriculum book where that curriculum has one for the grade and
 * subject, and ICT's book otherwise. "Her region's curriculum" is read ONLY from a registry region
 * (a region_features row with an organization): the deployment-wide 'niete' row carries
 * curriculum_key 'punjab_snc_2020' and no organization, and reading it would move every teacher
 * whose users.region is null (~4.7k) onto the Punjab SNC book. Every failure falls open to ICT —
 * a teacher must always get a book.
 */

const REGISTRY = [
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true, curriculum_key: null },
  { region: 'tarnol', organization: 'niete', display_name: 'Tarnol', sort_order: 6, is_active: true, curriculum_key: 'ict' },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true, curriculum_key: 'nbf_snc' },
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true, curriculum_key: 'punjab_snc_2020' },
];

/** A supabase-shaped client serving region_features and users, counting reads per table. */
function client({ registry = REGISTRY, users = [], textbooks = [], fail = null } = {}) {
  const reads = { region_features: 0, users: 0, textbooks: 0 };
  const from = (table) => {
    reads[table] = (reads[table] || 0) + 1;
    if (fail === table) throw new Error(`${table} unreachable`);
    const filters = [];
    const rowsOf = () => ({ region_features: registry, users, textbooks }[table] || [])
      .filter((r) => filters.every(([c, v]) => r[c] === v));
    const b = {
      select: () => b,
      eq: (c, v) => { filters.push([c, v]); return b; },
      limit: () => b,
      maybeSingle: async () => ({ data: rowsOf()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rowsOf(), error: null }).then(res, rej),
    };
    return b;
  };
  return { from, reads };
}

function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('use the injected client'); } }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  require('../../bot/shared/services/region-registry')._clearCache();
  return require('../../bot/shared/services/book-curriculum.service');
}

describe('curriculumFor', () => {
  it("gives a GB teacher GB's book where GB has one for the grade and subject", async () => {
    const BC = load();
    const asked = [];
    const has = async (curriculum, grade, subject) => { asked.push([curriculum, grade, subject]); return curriculum === 'nbf_snc'; };
    const got = await BC.curriculumFor({ region: 'Gilgit-Baltistan', grade: 3, subject: 'english', has, client: client() });
    expect(got).toBe('nbf_snc');
    expect(asked).toEqual([['nbf_snc', 3, 'english']]);
  });

  it("gives a GB teacher ICT's book where GB has none (today: every grade and subject)", async () => {
    const BC = load();
    const has = async () => false;
    expect(await BC.curriculumFor({ region: 'gilgit-baltistan', grade: 3, subject: 'english', has, client: client() })).toBe('ict');
  });

  it('gives a sector teacher ICT without asking any store (null key and an explicit ict key alike)', async () => {
    const BC = load();
    const has = jest.fn(async () => true);
    expect(await BC.curriculumFor({ region: 'Sihala', grade: 3, subject: 'english', has, client: client() })).toBe('ict');
    expect(await BC.curriculumFor({ region: 'tarnol', grade: 3, subject: 'english', has, client: client() })).toBe('ict');
    expect(has).not.toHaveBeenCalled();
  });

  it('gives a teacher with no region ICT, and reads nothing to decide it', async () => {
    const BC = load();
    const c = client();
    const has = jest.fn(async () => true);
    expect(await BC.curriculumFor({ region: null, grade: 3, subject: 'english', has, client: c })).toBe('ict');
    expect(await BC.curriculumFor({ region: '', grade: 3, subject: 'english', has, client: c })).toBe('ict');
    expect(c.reads.region_features).toBe(0);
    expect(has).not.toHaveBeenCalled();
  });

  it("never reads the deployment 'niete' row's punjab_snc_2020 key — it is not a region", async () => {
    const BC = load();
    const has = jest.fn(async () => true); // even if a Punjab SNC book exists for this grade and subject
    expect(await BC.curriculumFor({ region: 'niete', grade: 3, subject: 'english', has, client: client() })).toBe('ict');
    expect(has).not.toHaveBeenCalled();
  });

  it('an unknown or junk region value (ICT, Barakahu, federal) is ICT', async () => {
    const BC = load();
    const has = jest.fn(async () => true);
    for (const region of ['ICT', 'ict', 'Barakahu', 'federal']) {
      expect(await BC.curriculumFor({ region, grade: 3, subject: 'english', has, client: client() })).toBe('ict');
    }
    expect(has).not.toHaveBeenCalled();
  });

  it('fails OPEN to ICT when the registry cannot be read', async () => {
    const BC = load();
    const has = jest.fn(async () => true);
    expect(await BC.curriculumFor({
      region: 'Gilgit-Baltistan', grade: 3, subject: 'english', has, client: client({ fail: 'region_features' }),
    })).toBe('ict');
    expect(has).not.toHaveBeenCalled();
  });

  it('fails OPEN to ICT when the book store cannot be read', async () => {
    const BC = load();
    const has = async () => { throw new Error('textbooks unreachable'); };
    expect(await BC.curriculumFor({ region: 'Gilgit-Baltistan', grade: 3, subject: 'english', has, client: client() })).toBe('ict');
  });
});

describe('curriculumForRegion / curriculumForUser — the teacher curriculum the services take', () => {
  it("is the registry region's key, else ict", async () => {
    const BC = load();
    const c = client();
    expect(await BC.curriculumForRegion('Gilgit-Baltistan', { client: c })).toBe('nbf_snc');
    expect(await BC.curriculumForRegion('Sihala', { client: c })).toBe('ict');
    expect(await BC.curriculumForRegion('niete', { client: c })).toBe('ict');
    expect(await BC.curriculumForRegion(null, { client: c })).toBe('ict');
  });

  it("reads users.region for a user id; a user with no region, no row or no id is ict", async () => {
    const BC = load();
    const c = client({ users: [{ id: 'nbf-1', region: 'Gilgit-Baltistan' }, { id: 'sec-1', region: 'Sihala' }, { id: 'none', region: null }] });
    expect(await BC.curriculumForUser('nbf-1', { client: c })).toBe('nbf_snc');
    expect(await BC.curriculumForUser('sec-1', { client: c })).toBe('ict');
    expect(await BC.curriculumForUser('none', { client: c })).toBe('ict');
    expect(await BC.curriculumForUser('missing', { client: c })).toBe('ict');
    const before = c.reads.users;
    expect(await BC.curriculumForUser(null, { client: c })).toBe('ict');
    expect(c.reads.users).toBe(before);
  });

  it('fails OPEN to ict when users cannot be read', async () => {
    const BC = load();
    expect(await BC.curriculumForUser('nbf-1', { client: client({ fail: 'users' }) })).toBe('ict');
  });
});

describe('chooseCurriculum and preferPerKey — the same rule for a teacher curriculum already known', () => {
  it('chooseCurriculum: ict never asks; another key is used only where the store has it', async () => {
    const BC = load();
    const has = jest.fn(async (k) => k === 'nbf_snc');
    expect(await BC.chooseCurriculum('ict', has)).toBe('ict');
    expect(await BC.chooseCurriculum(undefined, has)).toBe('ict');
    expect(has).not.toHaveBeenCalled();
    expect(await BC.chooseCurriculum('nbf_snc', has)).toBe('nbf_snc');
    expect(await BC.chooseCurriculum('nbf_snc', async () => false)).toBe('ict');
    expect(await BC.chooseCurriculum('nbf_snc', async () => { throw new Error('x'); })).toBe('ict');
  });

  it('preferPerKey keeps, per key, the teacher curriculum rows where they exist and ICT rows elsewhere', () => {
    const BC = load();
    const rows = [
      { subject: 'english', curriculum: 'ict', n: 1 },
      { subject: 'english', curriculum: 'nbf_snc', n: 2 },
      { subject: 'maths', curriculum: 'ict', n: 3 },
      { subject: 'maths', curriculum: 'punjab_snc_2020', n: 4 },
      { subject: 'art', curriculum: 'nbf_snc', n: 5 },
    ];
    expect(BC.preferPerKey(rows, (r) => r.subject, 'nbf_snc').map((r) => r.n)).toEqual([2, 3, 5]);
    expect(BC.preferPerKey(rows, (r) => r.subject, 'ict').map((r) => r.n)).toEqual([1, 3]);
  });
});

describe('region-registry exposes a region curriculum without changing its other answers', () => {
  it('curriculumKeyForRegion: a registry region key or null; never the deployment row', async () => {
    jest.resetModules();
    const reg = require('../../bot/shared/services/region-registry');
    reg._clearCache();
    const c = client();
    expect(await reg.curriculumKeyForRegion(c, 'Gilgit-Baltistan')).toBe('nbf_snc');
    expect(await reg.curriculumKeyForRegion(c, 'sihala')).toBeNull();
    expect(await reg.curriculumKeyForRegion(c, 'niete')).toBeNull();
    expect(await reg.curriculumKeyForRegion(c, '')).toBeNull();
    expect(await reg.regionsForOrganization(c, 'moawin')).toEqual(['Gilgit-Baltistan']);
  });
});

describe("Gilgit-Baltistan's NBF books (operator, 2026-10-30): the loaded books decide, not a list", () => {
  // GB uses National Book Foundation books for G1-5 Maths, English, Urdu and G4-5 Science; ICT's for the rest.
  // Here two of those NBF books are loaded; nothing else is, and nothing in code names the pairs.
  const TEXTBOOKS = [
    { id: 'ict-3-maths', curriculum: 'ict', grade: 3, subject: 'maths' },
    { id: 'nbf-3-maths', curriculum: 'nbf_snc', grade: 3, subject: 'maths' },
    { id: 'ict-3-islamiat', curriculum: 'ict', grade: 3, subject: 'islamiat' },
    { id: 'ict-4-science', curriculum: 'ict', grade: 4, subject: 'science' },
    { id: 'nbf-4-science', curriculum: 'nbf_snc', grade: 4, subject: 'science' },
    { id: 'ict-6-english', curriculum: 'ict', grade: 6, subject: 'english' },
    { id: 'ict-6-maths', curriculum: 'ict', grade: 6, subject: 'maths' },
  ];
  const resolve = (BC, c, region, grade, subject) => BC.curriculumFor({
    region, grade, subject, client: c, has: (k, g, sub) => BC.hasTextbook(k, g, sub, { client: c }),
  });

  it('GB G3 maths with an nbf_snc book -> nbf_snc; G3 islamiat -> ict; G4 science -> nbf_snc; G6 anything -> ict', async () => {
    const BC = load();
    const c = client({ textbooks: TEXTBOOKS });
    expect(await resolve(BC, c, 'Gilgit-Baltistan', 3, 'maths')).toBe('nbf_snc');
    expect(await resolve(BC, c, 'Gilgit-Baltistan', 3, 'islamiat')).toBe('ict');
    expect(await resolve(BC, c, 'Gilgit-Baltistan', 4, 'science')).toBe('nbf_snc');
    expect(await resolve(BC, c, 'Gilgit-Baltistan', 6, 'english')).toBe('ict');
    expect(await resolve(BC, c, 'Gilgit-Baltistan', 6, 'maths')).toBe('ict');
  });

  it('a sector teacher gets ICT for every one of them, and no book is even looked up', async () => {
    const BC = load();
    const c = client({ textbooks: TEXTBOOKS });
    for (const [g, sub] of [[3, 'maths'], [3, 'islamiat'], [4, 'science'], [6, 'english']]) {
      expect(await resolve(BC, c, 'Sihala', g, sub)).toBe('ict');
    }
    expect(c.reads.textbooks).toBe(0);
  });
});
