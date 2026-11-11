/**
 * /observe2 — v5 never changes (FICO17 v6 spec §0.3, §8.6, §10.1 "Legacy").
 *
 * Five synthetic sealed forms (FORM_VERSION 4, 5 and 6; incident none / tech / ridicule / error; think ticks)
 * with confirmed moments across the four groups and Rumi's summary counts. Their `addUp` and `heardLevels`
 * output was captured from origin/sandbox at afeab2a69b, before the v6 rules were added to rules.js, and is
 * asserted byte for byte: same values, same key order, so a v5 visit's stored `final_levels` and
 * `rumi_levels` cannot drift.
 *
 * Executes the real module; nothing is mocked (it is pure). No teacher data: every form is made up.
 */
const fs = require('fs');
const path = require('path');
const { addUp, heardLevels } = require('../../bot/shared/services/observe/observe2/rules');

const DIR = path.join(__dirname, 'fixtures', 'final-levels-v5');
const FIXTURES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const fresh = (x) => JSON.parse(JSON.stringify(x));

describe('v5 regression: forms sealed under FORM_VERSION 4, 5 and 6 add up exactly as before v6', () => {
  test('the fixture set covers the three form versions and the four incident answers', () => {
    expect(FIXTURES).toHaveLength(5);
    expect([...new Set(FIXTURES.map((f) => f.input.form.fv))].sort()).toEqual(['4', '5', '6']);
    expect([...new Set(FIXTURES.map((f) => f.input.form.incident))].sort()).toEqual(['error', 'none', 'ridicule', 'tech']);
    for (const f of FIXTURES) {
      expect(f.input.confirmed.length).toBeGreaterThanOrEqual(6);
      expect(f.input.confirmed.length).toBeLessThanOrEqual(10);
    }
  });

  describe.each(FIXTURES.map((f) => [f.name, f]))('%s', (name, f) => {
    test('addUp with no rubric: identical final levels, byte for byte', () => {
      const got = addUp(fresh(f.input));
      expect(got).toEqual(f.output);
      expect(JSON.stringify(got)).toBe(JSON.stringify(f.output));
    });
    test("addUp with rubric 'fico17': identical, byte for byte", () => {
      const got = addUp({ ...fresh(f.input), rubric: 'fico17' });
      expect(JSON.stringify(got)).toBe(JSON.stringify(f.output));
    });
    test('heardLevels (rumi_levels): identical, byte for byte, with and without the v5 rubric', () => {
      const { confirmed, heardCounts } = fresh(f.input);
      expect(JSON.stringify(heardLevels(confirmed, heardCounts))).toBe(JSON.stringify(f.heard));
      expect(JSON.stringify(heardLevels(confirmed, heardCounts, [], { rubric: 'fico17' }))).toBe(JSON.stringify(f.heard));
    });
  });
});
