'use strict';
/**
 * Queue #184 — the Digital Coach's FICO 6-12 (FICO-S v1.1) scorer: "all HITL go to DC" (operator 19 Nov). Built from
 * the rubric registry (fico-s/fico_s_v1_1.rubric.json): every indicator's own words, levels and examples. STARRED
 * indicators (E3) are never sent to the DC: not in the prompt, refused by the validator, dropped by the scorer.
 * It speaks the standard framework interface, so analyzePedagogy runs it with the same model and settings as v6.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logEvent: jest.fn() }));

const S = require('../../bot/shared/services/coaching/frameworks/fico-s');
const fw = require('../../bot/shared/services/coaching/frameworks/fico-s-framework');
const { getFramework } = require('../../bot/shared/services/coaching/frameworks/framework-registry');

const T = [
  '[00:10] Teacher (en): Today we will learn why things float. Write the objective in your notebook.',
  '[01:05] Teacher (en): Why does a heavy steel ship float, but a small nail sinks?',
  '[01:20] Student (en): Because the ship is big.',
  '[02:40] Teacher (en): Good guess. Sana, what do you think?',
  '[30:00] Student (en): I agree with Ali.',
].join('\n');

function reply(over = {}) {
  const levels = {};
  for (const c of S.DC_CODES) levels[c] = { result: 3, because: `Heard ${c}`, evidence: [{ time: '01:05', quote: 'Why does a heavy steel ship float' }] };
  return { rubric: 'fico_s_v1_1', levels: { ...levels, ...over } };
}

describe('the prompt is the rubric registry, starred indicators left out', () => {
  const sys = fw.getSystemPrompt();
  test('every DC indicator with its own words: what to look for, how, the four levels', () => {
    for (const c of S.DC_CODES) {
      const ind = S.indicator(c);
      expect(sys).toContain(`### Indicator: ${c} ${ind.name}`);
      expect(sys).toContain(ind.look_for);
      for (const l of ind.levels) expect(sys).toContain(`Level ${l.n} (${S.LEVEL_LABELS[l.n]}): ${l.text}`);
    }
  });
  test('no starred indicator is in the prompt at all: not its code, name, words or levels', () => {
    for (const c of S.STARRED_CODES) {
      const ind = S.indicator(c);
      expect(sys).not.toContain(`Indicator: ${c} `);
      expect(sys).not.toContain(`"${c}"`);
      expect(sys).not.toContain(ind.look_for);
      for (const l of ind.levels) expect(sys).not.toContain(l.text);
    }
    expect(sys).not.toContain('E3');
  });
  test('N/A is offered only where the rubric allows it (v1.2: C2 and C3, each its own rule)', () => {
    for (const c of S.NA_CODES) expect(sys).toContain(`N/A when: ${S.naDcRule(c)}`);
    const naLines = sys.split('\n').filter((l) => /^N\/A when: /.test(l));
    expect(naLines).toHaveLength(S.NA_CODES.length);
  });
  test('the prompt version names the rubric data and a version of the prompt', () => {
    // 3: starred = E3 only, 22 asked (19 Nov ~17:00). 4: FICO-S v1.2, a Couldn't tell line each, N/A on C2 + C3 (queue #218).
    expect(fw.promptVersion).toMatch(/^fico-s-dc-4\+[0-9a-f]{8}$/);
    expect(fw.name).toBe('fico_s_v1_2');
  });
});

describe('the per-lesson prompt', () => {
  test('grade, subject, the transcript; the photos\' reading and the plan when the visit has them', () => {
    const p = fw.buildAnalysisPrompt(T, {
      grade: 7, subject: 'science', duration: 2400,
      photo: { mode: 'both', text: 'Board: "SLO: explain why objects float"' },
    }, { topic: 'Floating and sinking', objectives: ['Explain why objects float'] });
    expect(p).toContain('Grade: 7');
    expect(p).toContain('Subject: science');
    expect(p).toContain('Recording length: 40 minutes');
    expect(p).toContain(T);
    expect(p).toContain('Board: "SLO: explain why objects float"');
    expect(p).toContain('Floating and sinking');
    expect(p).toContain('Explain why objects float');
  });
  test('no photo text in note/off mode; no plan block without a plan; retry adds the note', () => {
    const p = fw.buildAnalysisPrompt(T, { photo: { mode: 'note', text: 'hidden' } }, null);
    expect(p).not.toContain('hidden');
    expect(p).not.toMatch(/LESSON PLAN/);
    expect(fw.buildAnalysisPrompt(T, { retry: true })).toContain(fw.RETRY_NOTE);
  });
});

describe('the validator and the scorer', () => {
  test('a good reply passes; evidence not in the transcript is dropped', () => {
    const r = reply({ A1: { result: 2, because: 'x', evidence: [{ time: '00:10', quote: 'Write the objective in your notebook' }, { time: '05:00', quote: 'never said' }] } });
    const v = fw.validate(r, T);
    expect(v.ok).toBe(true);
    expect(r.levels.A1.evidence).toHaveLength(1);
    expect(v.dropped).toBeGreaterThanOrEqual(1);
  });
  test('a reply that scores a starred indicator is refused; NA outside C2 is refused; a missing indicator is refused', () => {
    expect(fw.validate(reply({ E3: { result: 2, because: 'x', evidence: [] } }), T).errors.join('\n')).toMatch(/E3: a starred indicator/);
    // 19 Nov ~17:00: C3 is not starred; the Digital Coach must score it.
    const noC3 = reply(); delete noC3.levels.C3;
    expect(fw.validate(noC3, T).errors.join('\n')).toMatch(/C3: missing/);
    expect(fw.validate(reply({ A2: { result: 'NA', because: 'x', evidence: [] } }), T).ok).toBe(false);
    const r = reply(); delete r.levels.B1;
    expect(fw.validate(r, T).errors.join('\n')).toMatch(/B1: missing/);
    expect(fw.validate(reply({ C2: { result: 'NA', because: 'no wrong answer', evidence: [] } }), T).ok).toBe(true);
  });
  test('the scorer stamps the rubric, never keeps a starred level, and adds up the DC levels as FICO-S does', () => {
    const a = fw.computeScores(reply({ E3: { result: 4, because: 'by mistake', evidence: [] }, C2: { result: 'NA', because: '', evidence: [] }, D1: { result: 'IE', because: 'garbled', evidence: [] } }), false);
    expect(a.levels.E3).toBeUndefined();
    expect(a.rubric).toBe('fico_s_v1_2');
    expect(a.prompt_version).toBe(fw.promptVersion);
    expect(a.dc_scores.counted).toBe(S.DC_CODES.length - 2);
    expect(a.dc_scores.pct).toBe(75);
  });
  test('the pre-fill text for one indicator: why, then the moments, capped', () => {
    const t = fw.prefillEvidence({ result: 3, because: 'She asked why twice.', evidence: [{ time: '01:05', quote: 'Why does a heavy steel ship float' }] });
    expect(t).toBe('She asked why twice. [01:05] "Why does a heavy steel ship float"');
    expect(fw.prefillEvidence({ result: 'IE', because: '', evidence: [] })).toBe('');
    expect(Array.from(fw.prefillEvidence({ because: 'x'.repeat(2000), evidence: [] })).length).toBeLessThanOrEqual(fw.PREFILL_CAP);
  });
});

test('registered beside v6 under its rubric id', () => {
  expect(getFramework('fico_s_v1_1')).toBe(fw);
});
