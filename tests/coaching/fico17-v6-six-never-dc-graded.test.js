'use strict';
/**
 * bd-ra8xu.44 — DESIGN RULE (FICO17 v6, all grades, every surface): the six combined indicators C3 C5 C7 D2 D3 D4 never
 * carry a Digital Coach level. The DC gives evidence only; their levels come from the coach (HITL). The coaches'
 * levels are collected beside Rumi's evidence so the DC can be calibrated on them before any DC level for the combined indicators
 * is introduced. See bot/shared/services/coaching/frameworks/fico17-v6/index.js.
 *
 * This suite fails if ANY DC path emits or renders a level for one of the six: the prompt, the validator, the scorer
 * (what is stored), the self-recording report, and Rumi's pre-fill on the coach's review screens.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

const SIX = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];
const TRANSCRIPT = '[00:10] Teacher (en): Ali, what do you think?\n[00:15] Student (en): Five.\n[30:00] Student (en): I agree.';

function reply({ gradeTheSix = false } = {}) {
  const levels = {};
  for (const c of V6.DC_CODES) levels[c] = { result: 2, because: 'x', evidence: [{ time: '00:10', quote: 'Ali, what do you think?' }] };
  if (gradeTheSix) for (const c of SIX) levels[c] = { result: 4, because: 'graded by mistake', evidence: [] };
  const ce = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) ce[c] = { result: null, items: [] };
  ce.D2 = { student_turns_first_half: 1, student_turns_second_half: 1 };
  return { levels, combined_evidence: ce };
}

test('the set is exactly the rubric\'s combined indicators', () => {
  expect(V6.COMBINED_CODES).toEqual(SIX);
});

test('the DC prompt asks a level only for the 11; the six are evidence blocks with no level lines', () => {
  const p = `${fw.getSystemPrompt()}\n${fw.buildAnalysisPrompt(TRANSCRIPT, { language: 'en' })}`;
  for (const c of SIX) {
    expect(p).not.toContain(`### Indicator: ${c} `);
    const i = p.indexOf(`### Evidence: ${c} `);
    if (c === 'D2' && i < 0) continue; // D2 is counted in code, not asked
    expect(i).toBeGreaterThan(-1);
    const block = p.slice(i, p.indexOf('###', i + 5) > 0 ? p.indexOf('###', i + 5) : undefined);
    expect(block).not.toMatch(/Level [1-4] \(/);
  }
});

test('the validator refuses a reply that grades one of the six (never stored)', () => {
  const bad = reply({ gradeTheSix: true });
  const check = fw.validate(bad, TRANSCRIPT);
  expect(check.ok).toBe(false);
  for (const c of SIX) expect(check.errors.join('\n')).toContain(`${c}: a combined indicator has a DC level`);
  const num = reply();
  num.combined_evidence.C3.result = 3;
  expect(fw.validate(num, TRANSCRIPT).ok).toBe(false);
});

test('the scorer stores no level for the six, whatever the reply held, and never counts them', () => {
  const a = fw.computeScores(reply({ gradeTheSix: true }), false, TRANSCRIPT);
  for (const c of SIX) expect(a.levels[c]).toBeUndefined();
  for (const sec of Object.values(V6.SECTIONS)) {
    for (const row of a.domains[sec.domain].indicators.filter((r) => SIX.includes(r.id))) {
      expect(row.score).toBeNull();
      expect(row.result).toBeNull();
      expect(row.applicable).toBe(false);
    }
  }
  expect(a.scores.counted).toBe(V6.DC_CODES.length);
});

test('the self-recording report shows the six with evidence only, never a level', () => {
  const r = buildTeacherReport(reply({ gradeTheSix: true }).levels, { language: 'en', combinedEvidence: reply().combined_evidence });
  expect(r.rows.map((x) => x.code).filter((c) => SIX.includes(c))).toEqual([]);
  for (const row of r.evidence_rows) { expect(row.result).toBeUndefined(); expect(row.title).toBeUndefined(); }
});

test("Rumi's pre-fill on the coach's review never has a level for the six", () => {
  const a = reply({ gradeTheSix: true }); // even if an analysis somehow carried one
  for (const c of SIX) {
    expect(O6.rumiLevel(a, c)).toBeNull();
  }
});
