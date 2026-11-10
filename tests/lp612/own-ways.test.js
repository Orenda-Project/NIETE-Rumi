/**
 * bd-snkn32.13 — "Make my own" for grades 6–12: teaching ways by grade band, what the lesson is for, and the SLO focus.
 *
 * The primary ways (sounds first, things → pictures → numbers, teach at the right level) do not fit a Grade 10
 * Chemistry lesson. Grades 6–8 and 9–12 each get their own set; the bot refuses a way that is not in her band's set.
 */

const {
  bandOf, gradeOfSegment, waysOfBand, purposesOfBand, SECONDARY_WAYS, PURPOSES,
} = require('../../bot/shared/services/lp612-own-ways');
const { sloMix, sloCodes } = require('../../bot/shared/services/lp612-own-slo');
const { parseOwnAnswers, buildOwnInstruction, WAYS } = require('../../bot/shared/services/lp612-own-instruction');

const MAP = {
  'grade_10_chemistry.c01.p001-003': [
    { code: 'C-10-A-01', status: 'Summative' }, { code: 'C-10-A-02', status: 'Formative' }, { code: 'C-10-A-03', status: null },
  ],
  'grade_10_biology.c01.p007-009': [{ code: 'B-10-R-01', status: 'Summative' }, { code: 'B-10-R-02', status: 'Summative' }],
};
const MIXED = 'grade_10_chemistry.c01.p001-003';
const PLAIN = 'grade_10_biology.c01.p007-009';
const MIDDLE = 'grade_7_science.c02.p010-012';

const base = { size: '51_70', resources: ['board'], level: 'on_track', note: '' };

describe('bands', () => {
  it('1–5 primary, 6–8 middle, 9–12 senior, anything else none', () => {
    expect([1, 5, 6, 8, 9, 12].map(bandOf)).toEqual(['primary', 'primary', 'middle', 'middle', 'senior', 'senior']);
    expect(bandOf(0)).toBeNull();
    expect(bandOf(13)).toBeNull();
    expect(bandOf('x')).toBeNull();
  });
  it('reads the grade from a segment id', () => {
    expect(gradeOfSegment(MIXED)).toBe(10);
    expect(gradeOfSegment('grade_7_zari_taleem.c01.p001')).toBe(7);
    expect(gradeOfSegment('nope')).toBeNull();
    expect(gradeOfSegment(undefined)).toBeNull();
  });
  it('6–12 sets hold none of the primary ways; board-exam practice is 9–12 only', () => {
    for (const band of ['middle', 'senior']) {
      const ways = waysOfBand(band);
      expect(ways.length).toBeGreaterThanOrEqual(5);
      expect(ways.some((w) => Object.prototype.hasOwnProperty.call(WAYS, w))).toBe(false);
      ways.forEach((w) => expect(SECONDARY_WAYS[w]).toEqual(expect.any(String)));
    }
    expect(waysOfBand('middle')).not.toContain('past_paper');
    expect(waysOfBand('senior')).toContain('past_paper');
    expect(waysOfBand('senior')).toEqual(expect.arrayContaining(['worked', 'numericals', 'practical', 'concept_map', 'discussion', 'reading']));
  });
  it('lesson purposes: board exam only for 9–12, none for primary', () => {
    expect(purposesOfBand('middle')).toEqual(['new', 'revise', 'reteach']);
    expect(purposesOfBand('senior')).toEqual(['new', 'revise', 'board', 'reteach']);
    expect(purposesOfBand('primary')).toEqual([]);
    expect(Object.keys(PURPOSES)).toEqual(['new', 'revise', 'board', 'reteach']);
  });
});

describe('SLO mix', () => {
  it('a segment with both Summative and Formative SLOs is mixed', () => {
    expect(sloMix(MIXED, MAP)).toEqual({ summative: ['C-10-A-01'], formative: ['C-10-A-02'] });
  });
  it('an all-Summative segment, an unknown one, or nothing at all is not', () => {
    expect(sloMix(PLAIN, MAP)).toBeNull();
    expect(sloMix('grade_9_x.c01', MAP)).toBeNull();
    expect(sloMix(undefined, MAP)).toBeNull();
  });
  it('codes are every SLO of the segment, in order', () => {
    expect(sloCodes(MIXED, MAP)).toEqual(['C-10-A-01', 'C-10-A-02', 'C-10-A-03']);
    expect(sloCodes('nope', MAP)).toEqual([]);
  });
  it('the real map has mixed Grade 9–12 segments', () => {
    const real = require('../../bot/shared/data/lp612-fbise-slo-tags.json');
    const mixed = Object.keys(real).filter((k) => sloMix(k));
    expect(mixed.length).toBeGreaterThan(100);
  });
});

describe('parseOwnAnswers for 6–12', () => {
  const ctx = { segmentId: MIXED, sloMap: MAP };
  it('accepts a senior way, a purpose and a focus on a mixed segment', () => {
    const out = parseOwnAnswers({ ...base, way: 'numericals', purpose: 'board', focus: 'summative' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.answers).toMatchObject({ way: 'numericals', purpose: 'board', focus: 'summative' });
  });
  it('refuses a primary way for Grade 10 and a senior-only way for Grade 7', () => {
    expect(parseOwnAnswers({ ...base, way: 'phonics' }, ctx).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'past_paper' }, { segmentId: MIDDLE }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'worked' }, { segmentId: MIDDLE }).ok).toBe(true);
  });
  it('refuses board-exam practice for Grade 7 and an unknown purpose', () => {
    expect(parseOwnAnswers({ ...base, way: 'worked', purpose: 'board' }, { segmentId: MIDDLE }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'worked', purpose: 'fun' }, ctx).ok).toBe(false);
  });
  it('drops a focus on a segment that is not mixed; refuses an unknown focus', () => {
    const out = parseOwnAnswers({ ...base, way: 'worked', focus: 'formative' }, { segmentId: PLAIN, sloMap: MAP });
    expect(out.ok).toBe(true);
    expect(out.answers.focus).toBeUndefined();
    expect(parseOwnAnswers({ ...base, way: 'worked', focus: 'both' }, ctx).ok).toBe(false);
  });
  it('primary (no context or a grade 1–5) keeps the old ways and refuses 6–12 ones', () => {
    expect(parseOwnAnswers({ ...base, way: 'tarl' }).ok).toBe(true);
    expect(parseOwnAnswers({ ...base, way: 'worked' }, { grade: 3 }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, way: 'tarl', purpose: 'revise' }, { grade: 3 }).answers.purpose).toBeUndefined();
  });
});

describe('buildOwnInstruction for 6–12', () => {
  const build = (answers, ctx = { segmentId: MIXED, sloMap: MAP }) => buildOwnInstruction(parseOwnAnswers(answers, ctx).answers, ctx);
  it('uses the senior way text, not a primary one', () => {
    const text = build({ ...base, way: 'numericals', purpose: 'new' });
    expect(text).toMatch(/Teaching way: Numericals step by step/);
    expect(text).not.toMatch(/Sounds first|objects first|right level/);
  });
  it('board-exam practice asks for FBISE past-paper questions, Bloom levels and the SLO codes', () => {
    const text = build({ ...base, way: 'past_paper', purpose: 'board' });
    expect(text).toMatch(/FBISE/);
    expect(text).toMatch(/Bloom/);
    expect(text).toMatch(/C-10-A-01, C-10-A-02, C-10-A-03/);
  });
  it.each([['revise', /revision/i], ['reteach', /did not understand/i], ['new', /first time/i]])('purpose %s shapes the text', (purpose, re) => {
    expect(build({ ...base, way: 'worked', purpose })).toMatch(re);
  });
  it('the focus names which SLOs come first', () => {
    expect(build({ ...base, way: 'worked', focus: 'summative' })).toMatch(/Focus first on C-10-A-01 \(Summative/);
    expect(build({ ...base, way: 'worked', focus: 'formative' })).toMatch(/Focus first on C-10-A-02 \(Formative/);
  });
  it('grades 6–12 get room to adapt the activities', () => {
    expect(build({ ...base, way: 'discussion' })).toMatch(/may reorder or replace activities/);
  });
  it('a primary instruction is unchanged by all this', () => {
    const text = buildOwnInstruction(parseOwnAnswers({ ...base, way: 'tarl' }).answers);
    expect(text).not.toMatch(/purpose|Focus first|reorder/i);
  });
  it('an older 6–12 row with a primary way still builds', () => {
    expect(() => buildOwnInstruction({ ...base, resources: ['textbook'], way: 'story' }, { segmentId: MIXED })).not.toThrow();
  });
});
