'use strict';
/**
 * bd-pni007 — an obs612 (FDE grade 6-12) visit is never averaged with a FICO one.
 *
 * Every obs612 record is stamped with its rubric id (analysis_data.framework / .rubric / .scores.rubric =
 * 'obs612-<tool>-v1'). The same readers that keep FICO17 v6 apart (dashboard getOverall and the portal callers it
 * feeds, the coaching trend, the leader brief's overall, the coach-disagreement list, the visit-request ping, the
 * teacher-home order, the coaching report's trend line) ask one question, `isOwnRubric`: is this score on a rubric
 * of its own? A V3 row carries no stamp, so every V3 number is exactly what it was, and v6 stays apart as before.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const { getOverall, isOwnRubric: dashIsOwn, ownRubricOf: dashOwnOf } = require('../../dashboard/services/coaching-frameworks.service');
const { isOwnRubric, ownRubricOf } = require('../../bot/shared/services/coaching/frameworks/own-rubric');
const { pctFromRow } = require('../../bot/shared/services/coaching/coaching-trend.service');
const { overallScoreFromAnalysis } = require('../../bot/shared/services/observe/assignment/leader-source');
const { sessionPct } = require('../../dashboard/services/schools-analytics.service');

const V3_FICO = { framework: 'fico', scores: { overall_marks: 96, overall_max_marks: 148, overall_percentage: 64.9 } };
const V6_OBSERVE = { framework: 'fico17_v6', rubric: 'fico17_v6', scores: { overall_marks: 30, overall_max_marks: 44, overall_percentage: 68.2, rubric: 'fico17_v6' } };
// An English & Urdu visit: FDE's own % (out of 148) must never be read as a FICO % — even were it ever written where
// a FICO reader looks.
const OBS612_ENUR = {
  framework: 'obs612-enur-v1',
  rubric: 'obs612-enur-v1',
  scores: { rubric: 'obs612-enur-v1', overall_marks: 109, overall_max_marks: 148, overall_percentage: 73.6 },
  obs612: { rubric_id: 'obs612-enur-v1', tool: 'enur', sheet: 'en', total: 109, max: 148, pct: 73.6 },
  domains: { s2b: { score: 11, max: 12 } },
};
const OBS612_GEN = { framework: 'obs612-gen-v1', rubric: 'obs612-gen-v1', scores: { rubric: 'obs612-gen-v1' }, obs612: { tool: 'gen' } };
// An /observe2 visit keeps framework 'fico' on its session; the stamp rides on scores and observe2.
const OBS612_OBSERVE2 = { framework: 'fico', observe2: { rubric: 'obs612-msci-v1' }, scores: { rubric: 'obs612-msci-v1', overall_percentage: 80 } };

describe('the stamp', () => {
  test('obs612 and v6 analyses (and their scores alone) are on a rubric of their own; V3 is not', () => {
    for (const f of [isOwnRubric, dashIsOwn]) {
      expect(f(OBS612_ENUR)).toBe(true);
      expect(f(OBS612_ENUR.scores)).toBe(true);
      expect(f(OBS612_GEN)).toBe(true);
      expect(f(OBS612_OBSERVE2)).toBe(true);
      expect(f(V6_OBSERVE)).toBe(true);
      expect(f(V6_OBSERVE.scores)).toBe(true);
      expect(f(V3_FICO)).toBe(false);
      expect(f(V3_FICO.scores)).toBe(false);
      expect(f({ framework: 'obs612' })).toBe(false); // not a rubric id
      expect(f(null)).toBe(false);
      expect(f('obs612-gen-v1')).toBe(false);
    }
  });

  test('ownRubricOf names the rubric; null for V3', () => {
    for (const f of [ownRubricOf, dashOwnOf]) {
      expect(f(OBS612_ENUR)).toBe('obs612-enur-v1');
      expect(f(OBS612_OBSERVE2)).toBe('obs612-msci-v1');
      expect(f(V6_OBSERVE)).toBe('fico17_v6');
      expect(f(V3_FICO)).toBeNull();
    }
  });
});

describe('every averaging reader leaves an obs612 visit out', () => {
  test('dashboard getOverall: no percentage, no max, the rubric named', () => {
    for (const x of [OBS612_ENUR, { scores: OBS612_ENUR.scores }, OBS612_GEN, OBS612_OBSERVE2]) {
      const o = getOverall(x);
      expect(o.percentage).toBeNull();
      expect(o.maxPoints).toBe(0);
      expect(String(o.rubric)).toMatch(/^obs612-/);
    }
    expect(getOverall(V3_FICO)).toEqual({ points: 96, maxPoints: 148, percentage: 64.9 });
    expect(getOverall(V6_OBSERVE).rubric).toBe('fico17_v6');
  });

  test('schools analytics, the coaching trend and the leader brief skip obs612; V3 as before', () => {
    expect(sessionPct(OBS612_ENUR.scores)).toBeNull();
    expect(sessionPct(V3_FICO.scores)).toBe(64.9);
    expect(pctFromRow({ analysis_data: OBS612_ENUR })).toBeNull();
    expect(pctFromRow({ analysis_data: OBS612_OBSERVE2 })).toBeNull();
    expect(pctFromRow({ analysis_data: V3_FICO })).toBe(64.9);
    expect(overallScoreFromAnalysis(OBS612_ENUR)).toBeNull();
    expect(overallScoreFromAnalysis(OBS612_OBSERVE2)).toBeNull();
  });

  test('no reader still asks the v6-only question (every guard reads isOwnRubric)', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..');
    const readers = [
      'dashboard/routes/coaching-report.routes.js',
      'dashboard/services/teacher-home-order.service.js',
      'dashboard/services/coach-disagreements.service.js',
      'dashboard/services/coach-visit-request.js',
      'bot/shared/services/coaching/coaching-trend.service.js',
      'bot/shared/services/observe/assignment/leader-source.js',
    ];
    for (const f of readers) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect({ f, v6Only: /isV6Scored\(/.test(src) }).toEqual({ f, v6Only: false });
      expect({ f, own: /isOwnRubric\(/.test(src) }).toEqual({ f, own: true });
    }
  });
});
