/**
 * bd-5jmnfj.38.31 — every written item of a G6-12 free paper carries a holistic band (2-3 levels,
 * full / partial / none), an accept line and a do-not-accept line (A7c on the a4 G8 Urdu paper:
 * 10 of 10 written items had points only).
 */
const S = require('../../bot/shared/services/assessment/free-secondary-scheme');
const C = require('../../bot/shared/services/assessment/free-secondary-checks');

const BANDS = [{ marks: '3', descriptor: 'full' }, { marks: '1-2', descriptor: 'partial' }, { marks: '0', descriptor: 'none' }];
const written = (extra) => ({ question: 'Why?', answer: 'Because.', marks: 3,
  marking_points: [{ point: 'p', marks: 3 }], ...extra });
const entry = (item, isMcq = false) => ({ n: 1, item, isMcq });

describe('schemeIssue', () => {
  it('passes a written item with 2-3 bands, an accept and a do-not-accept line', () => {
    expect(S.schemeIssue(entry(written({ mark_bands: BANDS, accept: 'x', reject: 'y' })))).toBeNull();
    expect(S.schemeIssue(entry(written({ mark_bands: BANDS.slice(0, 2), accept: 'x', reject: 'y' })))).toBeNull();
  });
  it('names each missing part: the band, the accept line, the do-not-accept line', () => {
    const text = S.schemeIssue(entry(written({})));
    expect(text).toMatch(/band/);
    expect(text).toMatch(/accept/);
    expect(text).toMatch(/do-not-accept/);
    expect(S.schemeIssue(entry(written({ mark_bands: BANDS, accept: 'x' })))).toMatch(/do-not-accept/);
    expect(S.schemeIssue(entry(written({ mark_bands: BANDS, reject: 'y' })))).not.toMatch(/do-not-accept/);
  });
  it('wants 2 or 3 band levels, each with a descriptor', () => {
    const one = written({ mark_bands: [BANDS[0]], accept: 'x', reject: 'y' });
    const four = written({ mark_bands: [...BANDS, { marks: '0', descriptor: 'blank' }], accept: 'x', reject: 'y' });
    const empty = written({ mark_bands: [BANDS[0], { marks: '0', descriptor: ' ' }], accept: 'x', reject: 'y' });
    [one, four, empty].forEach((i) => expect(S.schemeIssue(entry(i))).toMatch(/band/));
  });
  it('leaves MCQs and one-mark items alone', () => {
    expect(S.schemeIssue(entry({ question: 'q', options: ['a) 1', 'b) 2', 'c) 3', 'd) 4'], answer: 'a', marks: 1 }, true))).toBeNull();
    expect(S.schemeIssue(entry({ question: 'q', answer: 'a', marks: 1 }))).toBeNull();
  });
});

describe('paperIssues reports a missing scheme as "scheme"', () => {
  it('flags a scenario part without a band', () => {
    const exam = { unseen: { subjective: { Other: [{ passage: 'p', questions: [written({ accept: 'x', reject: 'y' })] }] } } };
    const issues = C.paperIssues(exam, { grade: 7 });
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ n: 1, check: 'scheme' })]));
  });
});
