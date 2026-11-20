'use strict';
/**
 * Per-indicator N/A — FICO17 v6: N/A only where it can happen, in its own words (plan approved 19 Nov).
 *
 * The operator, 13 Nov: N/A "does not make sense into all the indicators… D2… is always applicable, because no children
 * speaking is already the first level… C2… What if no child was wrong at all… it should be… specific to this indicator".
 * Approved table: N/A on C2, C3, C5 and D4 only, each with its own label (coach wording "lesson", Digital Coach wording
 * "transcript"), English and an Urdu draft; D3 drops its N/A (option A). The table is data: fico17_v6.na.json.
 *
 *   coach      the four offer N/A (plus 1-4); the other 13 offer 1-4 only. C2 arrives on N/A when Rumi heard no wrong
 *              answer; C3 and D4 arrive on N/A when the coach set C1 to 1. N/A needs no "why this level".
 *   DC         N/A only on C2 (Part 1) and C5 (Part 2 evidence). An N/A anywhere else is refused: kept as no level.
 *   reports    an N/A indicator stays in its place with its label and no score, outside the total.
 */
process.env.OBSERVE_FRAMEWORK = 'fico';
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const NA = require('../../bot/shared/services/coaching/frameworks/fico17-v6/fico17_v6.na.json');
const { transformFICO17V6ToReportData } = require('../../bot/shared/services/coaching/report-transformers/fico17-v6-report-transformer');
const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');

const cp = (s) => Array.from(String(s)).length;
const APPROVED = ['C2', 'C3', 'C5', 'D4'];

describe('the approved table is data (fico17_v6.na.json)', () => {
  test('N/A on C2, C3, C5 and D4 only; D3 and the other 12 have none', () => {
    expect(v6.NA_CODES).toEqual(APPROVED);
    for (const code of v6.CODES) expect(v6.naAllowed(code)).toBe(APPROVED.includes(code));
    expect(v6.naAllowed('D3')).toBe(false);
    expect(v6.naAllowed('D2')).toBe(false);
  });

  test('the Urdu is a draft; every allowed row has coach + DC words in English and Urdu', () => {
    expect(NA.ur_status).toBe('draft');
    for (const code of APPROVED) {
      const row = NA.indicators[code];
      for (const lang of ['en', 'ur']) {
        expect(row.coach[lang].title).toBeTruthy();
        expect(row.coach[lang].sentence).toBeTruthy();
        expect(row.coach[lang].description).toBeTruthy();
        expect(row.dc[lang]).toBeTruthy();
      }
    }
  });

  test('the approved words: coach says "lesson", the DC says "transcript"', () => {
    expect(v6.naOption('C2', 'en')).toEqual({ id: 'NA', title: 'N/A · No child was wrong', description: expect.stringMatching(/^No child was wrong in this lesson/) });
    expect(v6.naSentence('C2', 'en')).toBe('No child was wrong in this lesson.');
    expect(v6.naSentence('C2', 'en', { by: 'dc' })).toBe('No child was wrong in this transcript.');
    expect(v6.naOption('C3', 'en').title).toBe('N/A · No question asked');
    expect(v6.naOption('D4', 'en').title).toBe('N/A · No question asked');
    expect(v6.naOption('C5', 'en').title).toBe('N/A · Class never switched');
    expect(v6.naSentence('C5', 'en', { by: 'dc' })).toBe('No change of activity in this transcript.');
    expect(v6.naOption('C2', 'ur').title).toBe('لاگو نہیں · کوئی غلط جواب نہیں');
    expect(v6.naOption('D2', 'en')).toBeNull();
  });

  test.each(APPROVED.flatMap((c) => [[c, 'en'], [c, 'ur']]))('%s (%s) fits WhatsApp: title ≤ 30, description ≤ 300', (code, lang) => {
    const o = v6.naOption(code, lang);
    expect(cp(o.title)).toBeLessThanOrEqual(30);
    expect(cp(o.description)).toBeLessThanOrEqual(300);
  });

  test('the old labels are gone: no generic "Did not come up", no NA_OPTIONS', () => {
    expect(v6.NA_OPTIONS).toBeUndefined();
    expect(O6.DC_NA_OPTION).toBeUndefined();
  });

  test('the coach stamp moves to coach-3 and the DC prompt to dc-2', () => {
    expect(v6.COACH_PROMPT_VERSION).toMatch(/^fico17-v6-coach-3\+/);
    expect(v6.DC_PROMPT_VERSION).toMatch(/^fico17-v6-dc-2\+/);
  });
});

describe('the coach options: N/A only on the four, with its own label', () => {
  test.each(v6.CODES)('%s: 1-4, plus N/A only when the table allows it', (code) => {
    for (const lang of ['en', 'ur']) {
      const ids = v6.coachLevelOptions(code, lang).map((o) => o.id);
      expect(ids).toEqual(APPROVED.includes(code) ? ['1', '2', '3', '4', 'NA'] : ['1', '2', '3', '4']);
      expect(O6.optionsFor(code, { lang }).map((o) => o.id)).toEqual(ids);
    }
  });

  test('the N/A option on C2 is the approved one, in the coach\'s language', () => {
    const na = v6.coachLevelOptions('C2', 'ur').find((o) => o.id === 'NA');
    expect(na).toEqual(v6.naOption('C2', 'ur'));
  });

  test('/observe2 (retired, its Flows published) keeps exactly its old lists: levelOptions and its coach copy', () => {
    expect(v6.CODES.filter((c) => v6.levelOptions(c).some((o) => o.id === 'NA'))).toEqual(['C5', 'C7', 'D3']);
    for (const code of v6.CODES) expect(v6.coachLevelOptions(code, 'en', { na: false }).map((o) => o.id)).toEqual(['1', '2', '3', '4']);
  });

  test('an old review that saved N/A on an indicator that no longer has one still shows it', () => {
    expect(O6.optionsFor('C7', { keep: 'NA' }).map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA']);
    expect(O6.optionsFor('D3', { keep: 'NA' }).map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA']);
    // C2 already offers N/A: never twice.
    expect(O6.optionsFor('C2', { keep: 'NA' }).filter((o) => o.id === 'NA')).toHaveLength(1);
    expect(O6.optionsFor('C1', { keep: 'IE' }).map((o) => o.id)).toEqual(['1', '2', '3', '4', 'IE']);
  });
});

// A v6 analysis as the DC leaves it: Rumi 2 everywhere, N/A on C2 (no wrong answer heard).
function analysis({ c2 = 'NA', c1 = 2 } = {}) {
  const levels = {};
  v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `Rumi heard ${c}`, evidence: [] }; });
  levels.C1 = { result: c1, because: 'Rumi heard C1', evidence: [] };
  levels.C2 = { result: c2, because: 'No student answer is clearly wrong.', evidence: [] };
  const domains = {};
  Object.values(v6.SECTIONS).forEach((s) => {
    domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, result: v6.isDc(c) ? levels[c].result : null })) };
  });
  return { framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains, combined_evidence: { C5: { result: 'NA', items: [] } } };
}

describe('the coach Flow (one indicator per screen)', () => {
  test('C2: Rumi heard no wrong answer, so N/A arrives chosen, with the Rumi note', () => {
    const d = O6.screenData(analysis(), 'IND_C_TWO', { lang: 'en' });
    expect(d.init.r_C2).toBe('NA');
    expect(d.opts.map((o) => o.id)).toContain('NA');
    expect(d.rumi_note).toMatch(/no child was wrong/i);
    expect(d.rumi_note).toMatch(/N\/A/);
  });

  test('C2 in Urdu: the Urdu note and the Urdu N/A option', () => {
    const d = O6.screenData(analysis(), 'IND_C_TWO', { lang: 'ur' });
    expect(d.init.r_C2).toBe('NA');
    expect(d.rumi_note).toMatch(/لاگو نہیں/);
    expect(d.opts.find((o) => o.id === 'NA').title).toBe('لاگو نہیں · کوئی غلط جواب نہیں');
  });

  test('C2: Rumi chose a level, so N/A is offered but not chosen', () => {
    const d = O6.screenData(analysis({ c2: 3 }), 'IND_C_TWO', { lang: 'en' });
    expect(d.init.r_C2).toBe('3');
    expect(d.opts.map((o) => o.id)).toContain('NA');
  });

  test('C3 and D4 arrive on N/A when the coach set C1 to 1, with a note naming C1', () => {
    for (const [code, screen] of [['C3', 'IND_C_THREE'], ['D4', 'IND_D_FOUR']]) {
      const d = O6.screenData(analysis(), screen, { lang: 'en', edits: { r_C1: '1' } });
      expect(d.init[`r_${code}`]).toBe('NA');
      expect(d.definition).toMatch(/C1/);
    }
  });

  test('C3 stays blank when C1 is above 1, and follows Rumi\'s C1 when the coach left it', () => {
    expect(O6.screenData(analysis(), 'IND_C_THREE', { lang: 'en', edits: { r_C1: '2' } }).init.r_C3).toBeUndefined();
    expect(O6.screenData(analysis({ c1: 1 }), 'IND_C_THREE', { lang: 'en', edits: {} }).init.r_C3).toBe('NA');
  });

  test('a coach\'s own choice on C3 wins over the C1 pre-pick', () => {
    const d = O6.screenData(analysis(), 'IND_C_THREE', { lang: 'en', edits: { r_C1: '1', r_C3: '2', why_C3: 'Named two children to answer.' } });
    expect(d.init.r_C3).toBe('2');
  });

  test('C5: N/A is offered but never pre-chosen from the recording (the coach sets the six)', () => {
    const d = O6.screenData(analysis(), 'IND_C_FIVE', { lang: 'en' });
    expect(d.opts.map((o) => o.id)).toContain('NA');
    expect(d.init.r_C5).toBeUndefined();
    expect(d.evidence).toBe('No change of activity in this transcript.');
  });

  test('N/A on a room indicator needs no 20-character reason; a level still does', () => {
    expect(O6.validateScreen('IND_C_FIVE', { r_C5: 'NA', why_C5: 'one' }, analysis())).toEqual({});
    expect(O6.validateScreen('IND_C_FIVE', { r_C5: 'NA', why_C5: '' }, analysis())).toEqual({});
    expect(Object.keys(O6.validateScreen('IND_C_FIVE', { r_C5: '2', why_C5: 'short' }, analysis()))).toEqual(['why_C5']);
  });

  test('N/A is refused where the table has none (D2, D3)', () => {
    expect(O6.validateScreen('IND_D_TWO', { r_D2: 'NA', why_D2: 'Nobody spoke at all in this lesson.' }, analysis())).toHaveProperty('r_D2');
    expect(O6.validateScreen('IND_D_THREE', { r_D3: 'NA', why_D3: 'No child spoke to another child.' }, analysis())).toHaveProperty('r_D3');
  });

  test('keeping Rumi\'s N/A on C2 needs no reason; changing it needs the 20-character reason', () => {
    expect(O6.validateScreen('IND_C_TWO', { r_C2: 'NA' }, analysis())).toEqual({});
    expect(O6.validateScreen('IND_C_TWO', { r_C2: '3' }, analysis())).toHaveProperty('chg_C2');
    expect(O6.validateScreen('IND_C_TWO', { r_C2: '3', chg_C2: 'Two children were wrong; she explained why.' }, analysis())).toEqual({});
  });

  test('choosing N/A where Rumi set a level is a change, so it needs a reason', () => {
    expect(O6.validateScreen('IND_C_TWO', { r_C2: 'NA' }, analysis({ c2: 2 }))).toHaveProperty('chg_C2');
  });

  test('the saved review: C2 N/A kept from Rumi; C5 N/A from the coach; both outside the total', () => {
    const edits = {};
    for (const code of v6.CODES) {
      edits[`r_${code}`] = v6.isCombined(code) ? '3' : '2';
      if (v6.isCombined(code)) edits[`why_${code}`] = `What I saw in the room for ${code}.`;
    }
    edits.r_C2 = 'NA';
    edits.r_C5 = 'NA';
    edits.why_C5 = 'one activity';
    const review = O6.buildReview(analysis(), edits);
    expect(review.levels.C2).toMatchObject({ level: 'NA', set_by: 'rumi', rumi_level: 'NA' });
    expect(review.levels.C5).toMatchObject({ level: 'NA', set_by: 'coach', because: 'one activity' });
    expect(review.coach_prompt_version).toMatch(/^fico17-v6-coach-3\+/);
    expect(review.totals.counted).toBe(15);
  });
});

describe('the Digital Coach: N/A only on C2 (and C5\'s evidence)', () => {
  const prompt = fw.getSystemPrompt();

  test('the prompt gives C2 its N/A line and tells the DC N/A is only for an indicator that has one', () => {
    expect(prompt).toMatch(/Return "NA" only for an indicator that has an N\/A line/);
    expect(prompt).toContain('N/A: no child gives a wrong or incomplete answer anywhere in the transcript.');
    expect(prompt).not.toContain("If the indicator's N/A condition applies");
  });

  test('Part 2: C5 carries an N/A rule; D3 no longer does (option A)', () => {
    expect(prompt).toContain('N/A rule: the class stays on one activity for the whole transcript.');
    expect(prompt).not.toContain(v6.indicator('D3').na_rule);
    const blocks = prompt.split('### ');
    const d3 = blocks.find((b) => b.startsWith('Evidence: D3'));
    expect(d3).not.toMatch(/N\/A/);
  });

  const reply = () => {
    const levels = {};
    v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: 'x', evidence: [] }; });
    return {
      levels,
      combined_evidence: { C3: { result: null, items: [] }, C5: { result: null, items: [] }, C7: { result: null, items: [] }, D3: { result: null, items: [] }, D4: { result: null, items: [] } },
    };
  };

  test('N/A on C2 is kept', () => {
    const a = reply();
    a.levels.C2.result = 'NA';
    const chk = fw.validate(a, '');
    expect(chk.ok).toBe(true);
    expect(a.levels.C2.result).toBe('NA');
  });

  test('N/A outside C2 is refused: the reply stands, that indicator keeps no level, a warning says so', () => {
    const a = reply();
    a.levels.D1.result = 'NA';
    a.levels.F1.result = 'NA';
    const chk = fw.validate(a, '');
    expect(chk.ok).toBe(true);
    expect(a.levels.D1.result).toBeNull();
    expect(a.levels.F1.result).toBeNull();
    expect(chk.warnings.join('\n')).toMatch(/D1: N\/A is not allowed/);
    const scored = fw.computeScores(a);
    const row = scored.domains.v6_children.indicators.find((i) => i.id === 'D1');
    expect(row.result).toBeNull();
    expect(row.score).toBeNull();
    expect(scored.scores.counted).toBe(9);
  });

  test('an N/A on a combined indicator\'s evidence is refused except on C5', () => {
    const a = reply();
    a.combined_evidence.D3.result = 'NA';
    a.combined_evidence.C5.result = 'NA';
    const chk = fw.validate(a, '');
    expect(chk.ok).toBe(true);
    expect(a.combined_evidence.D3.result).toBeNull();
    expect(a.combined_evidence.C5.result).toBe('NA');
  });

  test('computeScores refuses a stray N/A on its own (a reply that skipped the validator)', () => {
    const a = reply();
    a.levels.C4.result = 'NA';
    const scored = fw.computeScores(a);
    expect(scored.domains.v6_teacher.indicators.find((i) => i.id === 'C4').result).toBeNull();
  });
});

describe('reports: an N/A row keeps its place, shows its label, no score, outside the total', () => {
  function reviewed() {
    const domains = {};
    for (const s of Object.values(v6.SECTIONS)) {
      domains[s.domain] = {
        indicators: s.codes.map((code) => {
          const lv = code === 'C2' ? 'NA' : 2;
          return { id: code, result: lv, score: typeof lv === 'number' ? lv : null, set_by: 'rumi', evidence: `seen ${code}` };
        }),
      };
    }
    return { framework: 'fico17_v6', domains, scores: { overall_marks: 32, overall_max_marks: 64 } };
  }

  test('the teacher report (PDF / report record) shows C2 as "N/A: No child was wrong in this lesson."', () => {
    const r = transformFICO17V6ToReportData({ created_at: '2026-11-19T10:00:00Z' }, 'T', reviewed());
    const c = r.goals.find((g) => g.criteria.some((x) => x.name.startsWith('C2 ')));
    const row = c.criteria.find((x) => x.name.startsWith('C2 '));
    expect(row.score).toBeNull();
    expect(row.na).toBe(true);
    expect(row.evidence).toBe('N/A: No child was wrong in this lesson.');
    expect(c.criteria.map((x) => x.name.slice(0, 2))).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    expect(c.score).toBe(14);
    expect(c.maxScore).toBe(28);
    expect(r.totalScore).toBe(32);
    expect(r.maxScore).toBe(64);
  });

  test('an old N/A on an indicator with no label still shows, plainly, with no score', () => {
    const a = reviewed();
    a.domains.v6_teacher.indicators.find((i) => i.id === 'C7').result = 'NA';
    const r = transformFICO17V6ToReportData({}, 'T', a);
    const row = r.goals[0].criteria.find((x) => x.name.startsWith('C7 '));
    expect(row.score).toBeNull();
    expect(row.evidence).toMatch(/^N\/A/);
  });

  test('the Digital Coach\'s own report says N/A in transcript words, in the teacher\'s language', () => {
    const levels = {};
    v6.DC_CODES.forEach((c) => { levels[c] = { result: 2 }; });
    levels.C2 = { result: 'NA' };
    const en = buildTeacherReport(levels, { language: 'en', combinedEvidence: { C5: { result: 'NA', items: [] } } });
    const c2 = en.rows.find((r) => r.code === 'C2');
    expect(c2.result).toBe('NA');
    expect(c2.line).toContain('No child was wrong in this transcript.');
    expect(en.evidence_rows.find((r) => r.code === 'C5').line).toContain('No change of activity in this transcript.');
    const ur = buildTeacherReport(levels, { language: 'ur' });
    expect(ur.rows.find((r) => r.code === 'C2').line).toContain('اس ٹرانسکرپٹ میں کوئی بچہ غلط نہیں تھا۔');
  });
});
