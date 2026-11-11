'use strict';
/**
 * bd-ra8xu.38 — the v6 teacher report, option A: the 11 DC levels + one line naming the six the coach scores.
 * Built, not wired: nothing sends it until the operator switches the DC.
 */

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');

function levels() {
  const out = {};
  for (const c of v6.DC_CODES) out[c] = { result: 3, because: 'x', evidence: [] };
  out.C2 = { result: 'NA' };
  out.F1 = { result: 'IE' };
  out.C1 = { result: 4 };
  return out;
}

describe('v6 teacher report (option A)', () => {
  test('lists the DC levels with v6 name, title and level text; NA left out; IE one line', () => {
    const r = buildTeacherReport(levels());
    expect(r.rubric).toBe('fico17_v6');
    expect(r.rows.map((x) => x.code)).toEqual(['C1', 'C4', 'C6', 'C8', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4']);
    expect(r.text).toContain('Quality of Questions Asked by the Teacher: Level 4 of 4 (Highly Effective)');
    expect(r.text).toContain(v6.levelText('C1', 4));
    expect(r.text).not.toContain('Helping when a child is wrong');
    expect(r.text).toContain("Accuracy of content: The recording didn't cover this part of the lesson.");
    expect(r.rows.find((x) => x.code === 'F1').title).toBeUndefined();
  });

  // Operator 11 Nov ~17:50 replaced option A's one line with the six by name + evidence (fico17-v6-dc-evidence.test.js).
  test('the six the coach scores are named under their own heading, and no combined level appears', () => {
    const r = buildTeacherReport(levels());
    expect(r.text).toContain('your coach sets these six in the room; no level here');
    for (const c of v6.COMBINED_CODES) expect(r.text).toContain(v6.indicator(c).name);
    for (const c of v6.COMBINED_CODES) expect(r.rows.find((x) => x.code === c)).toBeUndefined();
  });

  test('Urdu frames in Urdu, keeps the rubric text in English, and is marked draft', () => {
    const r = buildTeacherReport(levels(), { language: 'ur' });
    expect(r.draft).toBe(true);
    expect(r.text).toMatch(/[؀-ۿ]/);
    expect(r.text).toContain('یہ چھ درجے کوچ کلاس میں دیتے ہیں');
    expect(r.text).toContain('Quality of Questions Asked by the Teacher');
    expect(buildTeacherReport(levels()).draft).toBe(false);
  });

  test('a broken transcript → no level rows and no evidence rows, only the one line (spec §6.3, §9.3)', () => {
    const r = buildTeacherReport(levels(), { transcriptQuality: { status: 'broken', coverage: 0.2, issues: [] } });
    expect(r.rows).toEqual([]);
    expect(r.evidence_rows).toEqual([]);
    expect(r.text).toContain("The recording couldn't be used, so this report has no levels from it.");
    expect(r.text).not.toContain('Level 4 of 4');
  });

  test('nothing scored → one plain line, and the six still named with what the recording showed', () => {
    const r = buildTeacherReport({});
    expect(r.rows).toEqual([]);
    expect(r.text).toContain('could not set any level');
    expect(r.evidence_rows).toHaveLength(6);
  });
});
