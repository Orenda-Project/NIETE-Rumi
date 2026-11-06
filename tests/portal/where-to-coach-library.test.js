/**
 * Where to coach — the content library (dashboard/data/where-to-coach/library.json) and its lookups
 * (dashboard/services/where-to-coach.library.js), bd-17v39c.4.14.2.
 *
 * Rifat's spec: suggestions come "from a reviewed content library, keyed by indicator code and language". Her 14 tips
 * are placed on live practice ids; the rest are drafted (her review pick 3A). Pinned here: every live practice has a
 * tip in English and Urdu, her own words are kept word for word, and every step link points at a practice that exists.
 */
const Lib = require('../../dashboard/services/where-to-coach.library');
const SETTINGS = require('../../dashboard/data/where-to-coach/settings.json');
const { getScoringConstants } = require('../../bot/shared/services/coaching/frameworks/fico-framework');

// FICO v3 (production, origin/main fico-framework.js): C1-C12, D1-D7, F1-F8.
const range = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const V3 = [...range('C', 12), ...range('D', 7), ...range('F', 8)];
// FICO v4 (sandbox): read from the deployed framework, sections C, D and F (B is the plan steps).
const V4 = Object.entries(getScoringConstants().domains)
  .filter(([k]) => k !== 'lesson_plan_fidelity')
  .flatMap(([, d]) => d.indicators.map((i) => i.id));

const words = (x) => typeof x === 'string' && x.trim().length > 0;

describe.each([['fico_v3', V3], ['fico_v4', V4]])('%s', (fw, ids) => {
  test.each(ids)('%s has Look for and Try this in English and Urdu', (id) => {
    const t = Lib.suggestionsFor(fw, id);
    expect(t).not.toBeNull();
    for (const lang of ['en', 'ur']) {
      expect(words(t[lang].lookFor)).toBe(true);
      expect(words(t[lang].tryThis)).toBe(true);
    }
    expect(t.source === 'draft' || /^rifat:[BCDF]\d$/.test(t.source)).toBe(true);
  });
  test('every step link points at a practice the library has', () => {
    for (const linked of Object.values(SETTINGS.stepLinks[fw])) for (const id of linked) expect(ids).toContain(id);
  });
});

test('her own words are kept: v3 D3 is her D2 tip, v4 D3 is her D3 tip, both languages', () => {
  expect(Lib.suggestionsFor('fico_v3', 'D3')).toMatchObject({
    source: 'rifat:D2',
    en: { lookFor: 'Do students talk to each other about the task?', tryThis: 'Give 2 minutes of pair talk on the question before taking answers.' },
    ur: { tryThis: 'جواب لینے سے پہلے 2 منٹ جوڑیوں میں سوال پر بات کرنے دیں۔' },
  });
  expect(Lib.suggestionsFor('fico_v4', 'D3').en.tryThis).toBe('Pause once in the lesson and ask the class what questions they have.');
});

test('13 of her 14 tips are used (her C1 learning-goal tip has no live practice), none twice on one framework', () => {
  const used = new Set();
  for (const fw of ['fico_v3', 'fico_v4']) {
    const sources = [...V3, ...V4].map((id) => (Lib.suggestionsFor(fw, id) || {}).source).filter((s) => s && s !== 'draft');
    for (const s of sources) used.add(s);
  }
  for (const step of Lib.STEPS) used.add(Lib.stepTipFor(step).source);
  used.delete('draft');
  expect([...used].sort()).toEqual(['rifat:B1', 'rifat:B2', 'rifat:B3', 'rifat:B4', 'rifat:C2', 'rifat:C4', 'rifat:C5', 'rifat:D1', 'rifat:D2', 'rifat:D3', 'rifat:F1', 'rifat:F2', 'rifat:F3']);
});

test('each of the five plan steps has a tip', () => {
  expect(Lib.STEPS).toEqual(['Opening', 'Explanation', 'We Do', 'You Do', 'Check']);
  for (const s of Lib.STEPS) expect(words(Lib.stepTipFor(s).en.tryThis) && words(Lib.stepTipFor(s).ur.tryThis)).toBe(true);
});

test('the check-in: four features, 2 questions each, the same blockers in English and Urdu', () => {
  for (const f of ['dc', 'lp', 'training', 'papers']) {
    const c = Lib.checkinFor(f);
    expect(c.en.questions).toHaveLength(2);
    expect(c.ur.questions).toHaveLength(2);
    expect(c.ur.blockers).toHaveLength(c.en.blockers.length);
    expect(c.en.blockers.length).toBeGreaterThanOrEqual(4);
  }
  expect(Lib.checkinFor('nope')).toBeNull();
});

test('an unknown practice or framework is null, never another practice\'s tip', () => {
  expect(Lib.suggestionsFor('fico_v3', 'Z9')).toBeNull();
  expect(Lib.suggestionsFor(null, 'C1')).toBeNull();
});

test('Urdu: no Arabic-Indic digits (٠–٩), never "HITL"', () => {
  const all = JSON.stringify(require('../../dashboard/data/where-to-coach/library.json'));
  expect(all).not.toMatch(/[٠-٩]/);
  expect(all).not.toMatch(/HITL/);
});
