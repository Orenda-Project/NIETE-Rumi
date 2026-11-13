'use strict';
/**
 * bd-snkn32.46 — the own-plan reviewer calibrated to the production gate: the model sees each check's rubric v3
 * requirement and 1-4 descriptors (not just its name), the ICT rules the production plans were built to (25-40 min
 * period, choral warm-ups, no peer talk in the warm-up or You Do, one framed neighbour turn allowed in We Do), and the
 * subject's own checks (criterion 8 + research 9). Science also needs 9B >= 3, as production gate v2 does. The bar is
 * unchanged: judge >= 85, no 1s, 7B and 5D >= 3.
 */
const R = require('../../bot/shared/services/lp612-own-review');
const { subjectOf, checksFor } = require('../../bot/shared/services/lp612-own-rubric');

const k5 = (subject) => JSON.stringify({ meta: { grade: 4, subject, minutes: 35 }, hook: {}, iDo: {}, weDo: {}, youDo: {}, wrap: {} });
const g612 = (subject) => JSON.stringify({ provenance: { grade: 9, subject }, slo: 'x', period_minutes: 40, sections: [] });
const system = (args) => R.reviewMessages(args)[0].content;

describe('subject of a plan', () => {
  test.each([
    [k5('general_science'), 'SCIENCE'], [g612('Physics'), 'SCIENCE'], [g612('Biology'), 'SCIENCE'],
    [k5('math'), 'MATHS'], [g612('Mathematics'), 'MATHS'], [k5('english'), 'ENGLISH'], [k5('urdu'), 'URDU'],
    [k5('social_studies'), 'SST'], [g612('History'), 'SST'], [g612('Geography'), 'SST'], [k5('islamiat'), 'ISLAMIAT'],
    [k5('general knowledge'), 'GK'], [g612('Computer Science'), null], ['not json', null],
  ])('%s → %s', (plan, want) => expect(subjectOf(plan)).toBe(want));
});

describe('the prompt carries the rubric, not only names', () => {
  test('every universal check comes with its 1-4 descriptors', () => {
    const s = system({ plan: k5('english'), band: 'k5' });
    for (const c of checksFor(null)) for (const d of c.d) expect(s).toContain(d);
    expect(s).not.toMatch(/Be strict/i);
  });

  test('the ICT period is 25-40 minutes for 0F and 3A, never 35-45', () => {
    const s = system({ plan: g612('History'), band: 'g612' });
    expect(s).toMatch(/total adds up to 25–40 minutes/);
    expect(s).not.toMatch(/35[–-]45/);
  });

  test('the ICT peer-talk rules are stated for 5B and 2L', () => {
    const s = system({ plan: k5('english'), band: 'k5' });
    expect(s).toMatch(/choral/i);
    expect(s).toMatch(/one framed neighbour turn in We Do/i);
    expect(s).toMatch(/no peer talk in the warm-up or You Do/i);
  });

  test("a subject's own checks are added: Science gets 9B the bilingual glossary, GK gets 8A-8D only", () => {
    const sci = system({ plan: g612('Chemistry'), band: 'g612' });
    expect(sci).toMatch(/9B Bilingual Concept Glossary/);
    expect(sci).toMatch(/8B Hands-On/);
    const gk = system({ plan: k5('general knowledge'), band: 'k5' });
    expect(gk).toMatch(/8A /);
    expect(gk).not.toMatch(/9B /);
    expect(checksFor('SCIENCE').map((c) => c.id)).toEqual(expect.arrayContaining(['7B', '5D', '8A', '9A', '9B']));
  });
});

describe('ratings the plan cannot show are left out', () => {
  test('1D (no book text given) is null in both bands; 2I only for grades 1-5', () => {
    const items = { '1D': 2, '2I': 2, '7B': 4 };
    expect(R.applyBand(items, 'g612', g612('History'))).toEqual({ '1D': null, '2I': 2, '7B': 4 });
    expect(R.applyBand(items, 'k5', k5('english'))).toEqual({ '1D': null, '2I': null, '7B': 4 });
  });

  test('9E and 9F (scripted pair exchanges) are null: ICT allows at most one framed neighbour turn', () => {
    const out = R.applyBand({ '9E': 1, '9F': 2, '9A': 3 }, 'k5', k5('urdu'));
    expect(out).toEqual({ '9E': null, '9F': null, '9A': 3 });
  });

  test("parseReview keeps the subject's ids", () => {
    const got = R.parseReview(JSON.stringify({ checks: [{ id: '9B', rating: 3 }, { id: 'ZZ', rating: 4 }] }));
    expect(got).toEqual({ '9B': 3 });
  });
});

describe('gate v2 with the subject must-check (production SUBJECT_MUST)', () => {
  const good = { '7B': 4, '5D': 3, '0A': 4, '0B': 4 };
  test('Science needs 9B >= 3; a null 9B (no new terms) is not a fail', () => {
    const must = R.mustFor({ plan: g612('Physics') });
    expect(must).toEqual(['9B']);
    expect(R.gateV2({ ...good, '9B': 2 }, null, must).reasons).toEqual(expect.arrayContaining([expect.stringMatching(/9B/)]));
    expect(R.gateV2({ ...good, '9B': 4 }, null, must).pass).toBe(true);
    expect(R.gateV2({ ...good, '9B': null }, null, must).pass).toBe(true);
  });

  test('other subjects add nothing, and the bar is unchanged', () => {
    expect(R.mustFor({ plan: k5('english') })).toEqual([]);
    expect(R.BAR).toBe(85);
    expect(R.KEY_CHECKS).toEqual(['7B', '5D']);
    expect(R.gateV2({ ...good, '7B': null }).pass).toBe(false);
    expect(R.gateV2({ '7B': 3, '5D': 3, '0A': 3, '0B': 3 }).pass).toBe(false);
  });
});

describe('the reply', () => {
  test('a short "why" comes before each rating, and a fenced or wrapped reply still parses', () => {
    expect(system({ plan: k5('english'), band: 'k5' })).toMatch(/"why"/);
    const body = JSON.stringify({ checks: [{ id: '7B', why: 'facts right', rating: 4 }] });
    expect(R.parseReview('```json\n' + body + '\n```')).toEqual({ '7B': 4 });
    expect(R.parseReview('Here it is:\n' + body + '\nDone.')).toEqual({ '7B': 4 });
    expect(R.parseReview('no json')).toBeNull();
  });
});
