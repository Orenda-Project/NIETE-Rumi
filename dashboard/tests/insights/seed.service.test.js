'use strict';
/** The lookup seed (INSIGHTS_SCHEMA §6): coachip_weaknesses parent-first at any depth, interventions, primary signals. */
const seed = require('../../lib/insights/seed');
const library = require('../../data/coachip/INTERVENTIONS.json');
const crosswalk = require('../../data/coachip/crosswalk.json');

describe('buildSeedRows', () => {
  const rows = seed.buildSeedRows(library, crosswalk);

  test('30 weaknesses, 77 interventions, crosswalk rows only for seeded Ws', () => {
    expect(rows.weaknesses).toHaveLength(30);
    expect(rows.interventions).toHaveLength(77);
    const seeded = new Set(rows.weaknesses.map((w) => w.w_id));
    expect(rows.signals.every((s) => seeded.has(s.w_id))).toBe(true);
    expect(rows.signals.some((s) => s.w_id === 'W-VOICE')).toBe(false);
  });

  test('every parent precedes its children at any depth (W-IP → W-IP-NOPLAN → W-IP-HOME)', () => {
    const pos = new Map(rows.weaknesses.map((w, i) => [w.w_id, i]));
    for (const w of rows.weaknesses) if (w.parent_w_id) expect(pos.get(w.parent_w_id)).toBeLessThan(pos.get(w.w_id));
    expect(pos.get('W-IP')).toBeLessThan(pos.get('W-IP-NOPLAN'));
    expect(pos.get('W-IP-NOPLAN')).toBeLessThan(pos.get('W-IP-HOME'));
  });

  test('row columns match the SQL, weights from the library (W-NUM 0.70)', () => {
    const num = rows.weaknesses.find((w) => w.w_id === 'W-NUM');
    expect(Number(num.pedagogical_weight)).toBeCloseTo(0.7);
    expect(Object.keys(num).sort()).toEqual(['is_cause_line', 'is_s1_eligible', 'is_s7', 'library_version', 'parent_w_id',
      'pedagogical_weight', 'primary_source', 'short_name_en', 'short_name_ur', 'w_id'].sort());
    expect(rows.weaknesses.find((w) => w.w_id === 'W-EXIT-TIME').is_cause_line).toBe(true);
  });

  test('every W has one primary signal whose source equals its primary_source', () => {
    for (const w of rows.weaknesses) {
      const prim = rows.signals.filter((s) => s.w_id === w.w_id && s.role === 'primary' && s.source === w.primary_source);
      expect(prim.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('applySeed upserts in order through the store, keyed on the natural ids', async () => {
    const calls = [];
    const store = { upsert: async (table, list, onConflict) => { calls.push([table, list.length, onConflict]); } };
    await seed.applySeed(store, rows);
    expect(calls.map((c) => c[0])).toEqual(['coachip_weaknesses', 'coachip_interventions', 'coachip_weakness_signals']);
    expect(calls[0][2]).toBe('w_id');
    expect(calls[2][2]).toBe('w_id,source,indicator_id');
  });
});
