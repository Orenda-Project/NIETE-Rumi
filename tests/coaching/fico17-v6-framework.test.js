'use strict';
/**
 * bd-ra8xu.38 — the FICO17 v6 Digital Coach framework (spec §5): prompt from the rubric data, validator, scores.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const { getFramework, listFrameworks } = require('../../bot/shared/services/coaching/frameworks/framework-registry');

const TRANSCRIPT = [
  '[00:10] Teacher (ur): Today we learn fractions. Ali, what is half of ten?',
  '[00:15] Student (ur): Five.',
  '[00:20] Teacher (ur): Why is it five? How do you know?',
  '[00:28] Student (ur): Because ten split in two is five.',
  '[05:00] Teacher (ur): Pens down, now turn to page 20.',
  '[20:00] Student (ur): Is it group work now?',
  '[38:30] Teacher (ur): Tell your partner your answer.',
  '[39:00] Student (ur): I agree with her.',
].join('\n');

function goodReply() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 2, because: 'seen', evidence: [{ time: '00:15', quote: 'Five.' }] };
  levels.C1 = { result: 4, because: 'why + follow-up', evidence: [{ time: '00:20', quote: 'Why is it five? How do you know?' }] };
  levels.C2 = { result: 'NA', because: 'no wrong answers', evidence: [] };
  levels.F1 = { result: 'IE', because: 'garbled', evidence: [] };
  const combined = {
    C3: { result: null, items: [{ time: '00:10', quote: 'Ali, what is half of ten?', kind: 'name_called' }] },
    C5: { result: null, items: [{ time: '05:00', quote: 'Pens down, now turn to page 20.', kind: 'signal' }] },
    C7: { result: null, items: [] },
    D3: { result: 'NA', items: [] },
    D4: { result: 'IE', items: [] },
  };
  return { rubric: 'fico17_v6', prompt_version: v6.DC_PROMPT_VERSION, levels, combined_evidence: combined };
}

describe('the v6 DC prompt (spec §5.3)', () => {
  const sys = fw.getSystemPrompt();
  const user = fw.buildAnalysisPrompt(TRANSCRIPT, { grade: 3, subject: 'math', duration: 2400 });
  const all = `${sys}\n${user}`;

  test('Part 1 renders each of the 11 DC indicators in level form, with its Definition line', () => {
    for (const code of v6.DC_CODES) {
      const ind = v6.indicator(code);
      expect(all).toContain(`### Indicator: ${code} ${ind.name}\nDefinition: ${ind.definition}`);
      expect(all).toContain(`Level 1 (Not Observed): ${ind.levels[0].text}`);
      expect(all).toContain(`Level 4 (Highly Effective): ${ind.levels[3].text}`);
    }
    expect(all).toContain('Example (not from this lesson): Teacher: "What is the capital of Pakistan? Islamabad. Write it down."');
  });

  test('Part 2 is evidence only for C3 C5 C7 D3 D4, with kinds; D2 is never asked of the model', () => {
    for (const code of ['C3', 'C5', 'C7', 'D3', 'D4']) {
      expect(all).toContain(`### Evidence: ${code} ${v6.indicator(code).name}`);
      expect(all).not.toContain(`### Indicator: ${code} `);
    }
    expect(all).toContain('name_called');
    expect(all).toContain('child_agrees_or_adds');
    expect(all).toContain(`N/A rule: ${v6.indicator('D3').na_rule}`);
    expect(all).not.toContain('### Indicator: D2');
    expect(all).not.toContain('### Evidence: D2');
  });

  test('never asks for a level on a combined indicator (Q1: evidence only) and leaves out Was / na_link', () => {
    expect(all).not.toMatch(/the level the transcript alone supports/);
    expect(all).not.toMatch(/\bWas:/);
    expect(all).not.toContain('N/A link');
    expect(all).not.toContain('C3 and D4 are N/A when C1 is scored 1.');
  });

  test('the transcript is in the user prompt, and the prompt is cached per version', () => {
    expect(user).toContain('[00:15] Student (ur): Five.');
    expect(fw.getSystemPrompt()).toBe(sys);
  });
});

describe('bd-qix9oh.2 — the per-lesson part of the prompt (spec §5.3 TRANSCRIPT GAPS, §5.5 step 1)', () => {
  const gate = require('../../bot/shared/services/observe/transcript-quality');
  const partial = { status: 'partial', coverage: 0.6, issues: [{ type: 'short', from: '24:00' }], period_minutes: 40 };

  test("a 'partial' transcript puts the gate's TRANSCRIPT GAPS block in the user prompt, once", () => {
    const user = fw.buildAnalysisPrompt(TRANSCRIPT, { duration: 2400, transcriptQuality: partial });
    const block = gate.promptGaps(partial);
    expect(block).toMatch(/^TRANSCRIPT GAPS:/);
    expect(user).toContain(block);
    expect(user.split('TRANSCRIPT GAPS:')).toHaveLength(2);
    expect(user.split('return "IE" instead of a level.')).toHaveLength(2);
  });

  test("an 'ok' transcript, or none assessed, adds no gaps block: the prompt is byte-for-byte the one before the gate", () => {
    const ok = { status: 'ok', coverage: 1, issues: [] };
    const before = `Grade: 3\nSubject: math\nRecording length: 40 minutes\n\nTRANSCRIPT:\n${TRANSCRIPT}\n\nScore Part 1 and report Part 2 for this lesson. Return only the JSON.`;
    expect(fw.buildAnalysisPrompt(TRANSCRIPT, { grade: 3, subject: 'math', duration: 2400, transcriptQuality: ok })).toBe(before);
    expect(fw.buildAnalysisPrompt(TRANSCRIPT, { grade: 3, subject: 'math', duration: 2400 })).toBe(before);
  });

  test('the one retry appends the §5.5 line; the first call does not', () => {
    const line = 'Your last reply was not valid JSON. Return only the JSON.';
    expect(fw.RETRY_NOTE).toBe(line);
    expect(fw.buildAnalysisPrompt(TRANSCRIPT, {})).not.toContain(line);
    const again = fw.buildAnalysisPrompt(TRANSCRIPT, { retry: true });
    expect(again.endsWith(line)).toBe(true);
    expect(again.startsWith(fw.buildAnalysisPrompt(TRANSCRIPT, {}))).toBe(true);
  });

  test('prompt_version is the sha of the rubric JSON bytes, and per-lesson gaps never change it or the system prompt', () => {
    const crypto = require('crypto');
    const fs = require('fs');
    const sha8 = crypto.createHash('sha256').update(fs.readFileSync(v6.RUBRIC_FILE)).digest('hex').slice(0, 8);
    expect(v6.DC_PROMPT_VERSION).toBe(`fico17-v6-dc-1+${sha8}`);
    const before = fw.getSystemPrompt();
    fw.buildAnalysisPrompt(TRANSCRIPT, { transcriptQuality: partial, retry: true });
    expect(fw.getSystemPrompt()).toBe(before);
    expect(fw.computeScores({ levels: {}, combined_evidence: {} }).prompt_version).toBe(v6.DC_PROMPT_VERSION);
    // A fresh load of the same JSON bytes gives the same version (it is not time or process dependent).
    jest.isolateModules(() => {
      expect(require('../../bot/shared/services/coaching/frameworks/fico17-v6').DC_PROMPT_VERSION).toBe(v6.DC_PROMPT_VERSION);
    });
  });
});

describe('validate (spec §5.5)', () => {
  test('a good reply passes', () => {
    const r = fw.validate(goodReply(), TRANSCRIPT);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('a missing DC code fails', () => {
    const a = goodReply(); delete a.levels.F4;
    const r = fw.validate(a, TRANSCRIPT);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/F4/);
  });

  test('an invalid level value fails', () => {
    const a = goodReply(); a.levels.C4.result = 5;
    expect(fw.validate(a, TRANSCRIPT).ok).toBe(false);
  });

  test('bd-qix9oh.2 (RULINGS R10): "3" as a string, 0 and 5 are rejected; 3, NA and IE pass', () => {
    for (const bad of ['3', 0, 5, 'ie', null]) {
      const a = goodReply(); a.levels.C4.result = bad;
      const r = fw.validate(a, TRANSCRIPT);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/C4: invalid result/);
    }
    for (const good of [3, 'NA', 'IE']) {
      const a = goodReply(); a.levels.C4.result = good;
      expect(fw.validate(a, TRANSCRIPT).ok).toBe(true);
    }
  });

  test('a numeric result on a combined indicator fails', () => {
    const a = goodReply(); a.combined_evidence.C3.result = 3;
    const r = fw.validate(a, TRANSCRIPT);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/C3/);
  });

  test('a missing combined code fails', () => {
    const a = goodReply(); delete a.combined_evidence.D4;
    expect(fw.validate(a, TRANSCRIPT).ok).toBe(false);
  });

  test('a malformed time or a time outside the lesson fails', () => {
    const a = goodReply(); a.levels.C6.evidence = [{ time: 'twelve', quote: 'Five.' }];
    expect(fw.validate(a, TRANSCRIPT).ok).toBe(false);
    const b = goodReply(); b.levels.C6.evidence = [{ time: '99:00', quote: 'Five.' }];
    expect(fw.validate(b, TRANSCRIPT).ok).toBe(false);
  });

  test('evidence whose quote is not in the transcript near its time is dropped, and counted', () => {
    const a = goodReply();
    a.levels.C6.evidence = [{ time: '00:15', quote: 'Five.' }, { time: '00:15', quote: 'Something nobody said.' }];
    a.combined_evidence.C3.items.push({ time: '38:30', quote: 'Ali, what is half of ten?', kind: 'name_called' });
    const r = fw.validate(a, TRANSCRIPT);
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(2);
    expect(a.levels.C6.evidence).toHaveLength(1);
    expect(a.combined_evidence.C3.items).toHaveLength(1);
  });
});

describe('countD2 (spec §5.6) — deterministic, never the model', () => {
  test('Student lines split at the midpoint of first and last timestamp', () => {
    expect(fw.countD2(TRANSCRIPT)).toEqual({ student_turns_first_half: 2, student_turns_second_half: 2 });
  });
  test('no timestamps → null', () => {
    expect(fw.countD2('Teacher: hello\nStudent: hi')).toBeNull();
  });
});

describe('computeScores — v6 totals never mix with V3, combined or NA/IE', () => {
  test('stamps rubric + prompt version and keeps levels and evidence as returned', () => {
    const a = fw.computeScores(goodReply());
    expect(a.rubric).toBe('fico17_v6');
    expect(a.prompt_version).toBe(v6.DC_PROMPT_VERSION);
    expect(a.levels.C1.result).toBe(4);
    expect(a.combined_evidence.C3.items).toHaveLength(1);
  });

  test('totals count only numeric DC levels: NA and IE leave both sides, combined never enter', () => {
    const a = fw.computeScores(goodReply());
    // 11 DC: C1=4, C2=NA, F1=IE, the other 8 = 2 → 4 + 16 = 20 over 9 × 4 = 36
    expect(a.scores.overall_marks).toBe(20);
    expect(a.scores.overall_max_marks).toBe(36);
    expect(a.scores.overall_percentage).toBe(55.6);
  });

  test('domains live under the v6 keys only, never a V3 key', () => {
    const a = fw.computeScores(goodReply());
    expect(Object.keys(a.domains).sort()).toEqual(['v6_children', 'v6_subject', 'v6_teacher']);
    for (const k of ['lesson_plan_fidelity', 'high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']) {
      expect(a.domains[k]).toBeUndefined();
    }
    const c = a.domains.v6_teacher.indicators;
    expect(c.map((i) => i.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    const c3 = c.find((i) => i.id === 'C3');
    expect(c3.score).toBeNull();
    expect(c3.set_by).toBe('coach');
    expect(c3.applicable).toBe(false);
    const c2 = c.find((i) => i.id === 'C2');
    expect(c2.applicable).toBe(false);
    expect(c2.result).toBe('NA');
    const c1 = c.find((i) => i.id === 'C1');
    expect(c1.score).toBe(4);
    expect(c1.name).toBe('Quality of Questions Asked by the Teacher');
    expect(c1.evidence_summary).toBeTruthy();
    const sum = Object.values(a.domains).reduce((s, d) => s + d.domain_score, 0);
    expect(sum).toBe(a.scores.overall_marks);
  });

  test('D2 counts are added from the transcript when given', () => {
    const a = fw.computeScores(goodReply(), false, TRANSCRIPT);
    expect(a.combined_evidence.D2).toEqual({ student_turns_first_half: 2, student_turns_second_half: 2 });
  });
});

describe('registry', () => {
  test('fico17_v6 is registered beside V3 fico, which is unchanged', () => {
    expect(listFrameworks()).toEqual(expect.arrayContaining(['fico', 'fico17_v6']));
    expect(getFramework('fico17_v6').name).toBe('fico17_v6');
    expect(getFramework('fico').name).toBe('fico');
    expect(getFramework('fico').version).toBe('3.0');
    expect(fw.maxMarks).toBe(44);
  });
});
