'use strict';
/**
 * Queue #282 / bd-ra8xu.64.2 — the teacher-activity journey (coach view) when her self-recordings are scored on FICO17 v6
 * (the 11): levels 1-4 under their own codes, an overall % out of up to 44 marks. V3 and v6 never share a band or a
 * trend comparison:
 *   - the trend compares two reports on the SAME rubric only, each indicator banded on its own rubric's scale (V3 0-2,
 *     v6 1-4); the v6 key was misspelt ('fico17-v6'), so v6 reports were dropped and the trend kept comparing two old V3
 *     reports (and emptied once six v6 reports filled the window);
 *   - a v6 report step in the journey gets no band: its % is not on the V3 bands' scale.
 * Pure: plain objects in, the stored value out.
 */
const J = require('../../bot/shared/services/teacher-activity/teacher-journey.service');
const C = require('../../bot/shared/config/teacher-activity-contract');

const NOW = Date.parse('2026-11-19T09:30:00.000Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const UID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const tiles = () => ({
  plans_opened: { now: 0, prev: 0 }, taught: { now: 0, prev: 0 }, coached: { now: 3, prev: 0 },
  quizzes: { now: 0, prev: 0 }, exams: { now: 0, prev: 0 },
});
const ind = (id, score) => ({ id, name: `Indicator ${id}`, score });
const report = (sid, days, indicators, framework) => ({ session_id: sid, at: ago(days), framework, indicators });
const shape = (over) => J.shapeTeacher({ user_id: UID, tiles: tiles(), journey: [], reports: [], latest: null, ...over }, { now: NOW, slot: 'day', teacher: { level: ['PRIMARY'] } });

describe('queue #282 / bd-ra8xu.64.2: V3 and v6 never share a band or a trend comparison', () => {
  test('two v6 reports: the trend compares them on the v6 scale (1-4), level 4 included', () => {
    const v = shape({ reports: [
      report('s3', 1, [ind('C1', 3), ind('D5', 4)], 'fico17_v6'),
      report('s2', 5, [ind('C1', 2), ind('D5', 2)], 'fico17_v6'),
      report('s1', 9, [ind('C1', 1), ind('D5', 1)], 'fico'),
    ] });
    expect(C.checkTeacherActivity(v, NOW)).toEqual(v);
    expect(v.trend.length).toBeGreaterThan(0);
    for (const t of v.trend) {
      expect(t.framework).toBe('fico17_v6');
      expect(t.points.map((p) => p.session_id)).toEqual(['s2', 's3']);
    }
    const d5 = v.trend.find((t) => t.indicator_id === 'D5');
    expect(d5.points.map((p) => p.band)).toEqual(['average', 'excellent']); // 2 of 4, 4 of 4
  });

  test('a v6 report after a V3 one: no comparison across the two rubrics', () => {
    const v = shape({ reports: [report('s2', 1, [ind('C1', 3)], 'fico17_v6'), report('s1', 5, [ind('C1', 1)], 'fico')] });
    expect(v.trend).toEqual([]);
  });

  test('V3 reports still compare on the V3 scale (0-2)', () => {
    const v = shape({ reports: [report('s2', 1, [ind('C1', 2)], 'fico'), report('s1', 5, [ind('C1', 1)], 'fico')] });
    expect(v.trend).toEqual([{ indicator_id: 'C1', indicator_name: 'Indicator C1', framework: 'fico',
      points: [{ session_id: 's1', at: ago(5), band: 'average' }, { session_id: 's2', at: ago(1), band: 'excellent' }] }]);
  });

  test('a v6 report step carries no band (its % is not on the V3 bands); a V3 one keeps its band', () => {
    const v = shape({
      reports: [report('s2', 1, [ind('C1', 3)], 'fico17_v6'), report('s1', 5, [ind('C1', 1)], 'fico')],
      journey: [
        { kind: 'report', at: ago(1), ref_id: 's2', meta: { topic: 'Shapes', pct: 60.7 } },
        { kind: 'report', at: ago(5), ref_id: 's1', meta: { topic: 'Fractions', pct: 72.4 } },
      ],
    });
    expect(v.journey[0].meta).toEqual({ topic: 'Shapes' });
    expect(v.journey[1].meta).toEqual({ topic: 'Fractions', band: 'good' });
    expect(JSON.stringify(v)).not.toContain('pct');
  });

  test('a report step stamped with its own rubric (meta.rubric) carries no band either, and the stamp is not stored', () => {
    const v = shape({ journey: [{ kind: 'report', at: ago(1), ref_id: 's9', meta: { topic: 'Shapes', pct: 60.7, rubric: 'fico17_v6' } }] });
    expect(v.journey[0].meta).toEqual({ topic: 'Shapes' });
  });
});
