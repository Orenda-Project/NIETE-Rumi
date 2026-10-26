'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §2; ped/vetoes.json modules 11 and 80, ped-panel 04:45Z; scale-run 064539: still
 * recommendable on dfb1ed3884, ⛔7 ×4 in v9): the lesson-plan and assessment-format voice-overs enact nothing. Vetoed in
 * the shipped catalogue at chapter level (the ladder untouched, as modules 28 and 48).
 */
const CATALOG = require('../../../bot/shared/data/video-catalog.v1.json');

const seg = (id) => CATALOG.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);

test.each(['11-s1', '11-s2', '11-s3', '11-s4', '11-s5', '80-s2'])('%s is not recommendable, with the panel\'s reason', (id) => {
  expect(seg(id).recommendable).toBe(false);
  expect(String(seg(id).recommendable_reason)).toMatch(/^panel_veto: /);
});
test('the modules stay on the ladder (module-level flag untouched)', () => {
  for (const id of [11, 80]) expect(CATALOG.modules.find((m) => m.module_id === id).recommendable).not.toBe(false);
});
