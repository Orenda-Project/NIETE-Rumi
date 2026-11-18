'use strict';
/**
 * Every result row the child-result stage can write has its seed: coachip_result_cells.w_id REFERENCES
 * coachip_weaknesses (w_id), so a W in results.js WS without a seeded weakness would fail the insert. Round 28 adds the
 * tapped forms' own series (W-LS-T, W-RC-T): seeded as mirrors of W-LS / W-RC, never pooled with them.
 */
const { RESULT_WS } = require('../../lib/insights/results');
const seed = require('../../lib/insights/seed');
const library = require('../../data/coachip/INTERVENTIONS.json');
const crosswalk = require('../../data/coachip/crosswalk.json');
const copy = require('../../data/coachip/copy.json');

describe('result-cell W ids have seed rows (the FK target set)', () => {
  const rows = seed.buildSeedRows(library, crosswalk);
  const seeded = new Set(rows.weaknesses.map((w) => w.w_id));

  test('results.js names its W ids, the round-28 ones among them', () => {
    expect(RESULT_WS).toEqual(expect.arrayContaining(['W-LS', 'W-LS-T', 'W-RC', 'W-RC-T']));
  });

  test('every W the stage writes is in the seeded weaknesses, with an egra primary signal and copy', () => {
    for (const w of RESULT_WS) {
      expect([w, seeded.has(w)]).toEqual([w, true]);
      expect(rows.signals.some((s) => s.w_id === w && s.role === 'primary' && s.source === 'egra')).toBe(true);
      expect(copy.w[w] && copy.w[w].short_name.en).toBeTruthy();
    }
  });

  test('W-LS-T / W-RC-T mirror W-LS / W-RC except the title and the note', () => {
    const lib = (id) => library.weaknesses.find((w) => w.id === id);
    const pairs = [['W-LS-T', 'W-LS', 'Letter sounds (listen and tap)', 'حروف کی آوازیں (سن کر چُنیں)', 'E4T'],
      ['W-RC-T', 'W-RC', 'Story questions (listen and tap)', 'کہانی کے سوال (سن کر چُنیں)', 'E11T']];
    for (const [id, old, en, ur, code] of pairs) {
      const a = lib(id); const b = lib(old);
      expect(a.short_name_en).toBe(en);
      expect(a.short_name_ur).toBe(ur);
      expect(copy.w[id].short_name).toEqual({ en, ur });
      expect(a.notes).toContain('round 28: the tapped form\'s own series, never pooled with W-LS / W-RC');
      const strip = (w) => { const { id: _i, name_en: _a, name_ur: _b, short_name_en: _c, short_name_ur: _d, notes: _e, ...rest } = w; return rest; };
      expect(strip(a)).toEqual(strip(b));
      const sig = rows.signals.find((s) => s.w_id === id && s.role === 'primary');
      const oldSig = rows.signals.find((s) => s.w_id === old && s.role === 'primary');
      // the same rule, read on the tapped form's own code
      expect({ ...sig, w_id: old, indicator_id: oldSig.indicator_id, hit_rule: sig.hit_rule.split(code).join(oldSig.indicator_id) }).toEqual(oldSig);
      expect(sig.indicator_id).toBe(code);
      // the interventions: the old rows' content under their own ids (i_id is the interventions' primary key)
      const mine = library.interventions.filter((i) => i.weakness_id === id);
      const theirs = library.interventions.filter((i) => i.weakness_id === old);
      expect(mine.map((i) => ({ ...i, id: null, weakness_id: null, mirror_of: undefined })))
        .toEqual(theirs.map((i) => ({ ...i, id: null, weakness_id: null, mirror_of: undefined })));
      expect(mine.map((i) => i.mirror_of)).toEqual(theirs.map((i) => i.id));
    }
  });
});
