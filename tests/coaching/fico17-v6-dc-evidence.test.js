'use strict';
/**
 * The DC v6 self-recording report (operator 11 Nov ~17:50; Ahwaz 15:06 "show evidence but do not grade"): the 11
 * levels the Digital Coach sets, then the six combined indicators (C3 C5 C7 D2 D3 D4) by name with what the recording
 * showed — timestamps and quotes, D2 as student turns per half — and NEVER a level for them.
 * Still behind fico_dc_rubric: nothing sends this report while the DC switch is off.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const LEVELS = {
  C1: { result: 3 }, C2: { result: 2 }, C4: { result: 2 }, C6: { result: 3 }, C8: { result: 'NA' },
  D1: { result: 2 }, D5: { result: 1 }, F1: { result: 3 }, F2: { result: 'IE' }, F3: { result: 2 }, F4: { result: 2 },
};
const EVIDENCE = {
  C3: { result: null, items: [{ time: '05:10', quote: 'Ali, what do you think?', kind: 'name_called' }, { time: '12:02', quote: 'Tell your partner your answer.', kind: 'pair_talk' }] },
  C5: { result: null, items: [{ time: '14:02', quote: 'Pens down, now turn to page 20.', kind: 'signal', starts: '14:40' }] },
  C7: { result: null, items: [] },
  D3: { result: 'NA', items: [] },
  D4: { result: 'IE', items: [] },
  D2: { student_turns_first_half: 38, student_turns_second_half: 22 },
};

describe('the six combined indicators: evidence, never a level', () => {
  const r = buildTeacherReport(LEVELS, { language: 'en', combinedEvidence: EVIDENCE });

  test('each of the six is named, with what the recording showed', () => {
    for (const code of V6.COMBINED_CODES) expect(r.text).toContain(V6.indicator(code).name);
    expect(r.text).toContain('05:10 "Ali, what do you think?"');
    expect(r.text).toContain('12:02 "Tell your partner your answer."');
    expect(r.text).toContain('14:02 "Pens down, now turn to page 20."');
    expect(r.text).toMatch(/38 student turns in the first half, 22 in the second/);
  });

  test('no level, title or level text for any of the six', () => {
    expect(r.evidence_rows.map((x) => x.code)).toEqual(V6.COMBINED_CODES);
    for (const row of r.evidence_rows) {
      expect(row.result).toBeUndefined();
      expect(row.title).toBeUndefined();
      expect(row.level_text).toBeUndefined();
    }
    // The six's section only: short titles such as '2+ times' also occur inside DC titles above it.
    const six = r.text.slice(r.text.indexOf('Combined indicators: what the recording showed'));
    expect(six.length).toBeGreaterThan(0);
    for (const code of V6.COMBINED_CODES) {
      for (const t of V6.TITLES[code]) expect(six).not.toContain(t);
      expect(six).not.toMatch(new RegExp(`${V6.indicator(code).name}: Level \\d`));
    }
    expect(r.rows.map((x) => x.code).filter((c) => V6.isCombined(c))).toEqual([]);
  });

  test("nothing found, couldn't tell, and D3's no child-to-child talk each read as a plain line", () => {
    const line = (code) => r.evidence_rows.find((x) => x.code === code).line;
    expect(line('C7')).toMatch(/nothing in the recording/i);
    expect(line('D4')).toMatch(/didn't cover/i);
    expect(line('D3')).toMatch(/no child-to-child talk/i);
  });

  test('the old option-A line is gone; the coach still sets the combined indicators', () => {
    expect(r.text).not.toContain('These six are scored when your coach visits');
    expect(r.text).toMatch(/your coach sets these levels in the room/i);
  });

  test('the 11 levels stay as they were: NA left out, IE one line', () => {
    expect(r.rows.map((x) => x.code)).toEqual(['C1', 'C2', 'C4', 'C6', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4']);
    expect(r.rows.find((x) => x.code === 'F2').result).toBe('IE');
  });

  test('Urdu frames the same evidence (draft)', () => {
    const ur = buildTeacherReport(LEVELS, { language: 'ur', combinedEvidence: EVIDENCE });
    expect(ur.text).toContain('05:10 "Ali, what do you think?"');
    expect(ur.text).toMatch(/[؀-ۿ]/);
    expect(ur.draft).toBe(true);
  });

  test('a broken recording gives no evidence rows either, only its one line', () => {
    const b = buildTeacherReport(LEVELS, { language: 'en', combinedEvidence: EVIDENCE, transcriptQuality: { status: 'broken' } });
    expect(b.evidence_rows).toEqual([]);
    expect(b.text).not.toContain('05:10');
  });

  test('no combined evidence passed: the six are still named, each as nothing found', () => {
    const n = buildTeacherReport(LEVELS, { language: 'en' });
    expect(n.evidence_rows).toHaveLength(6);
    for (const code of V6.COMBINED_CODES) expect(n.text).toContain(V6.indicator(code).name);
  });
});
