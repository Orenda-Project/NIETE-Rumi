import { describe, it, expect } from 'vitest';
import { collectCopy, copyProblem } from '../../../newui/checks/rules';
import { untranslated } from '../../i18n';
import { OWN, OWN_COPY, OWN_COPY_ENTRY } from './copy';

/**
 * bd-snkn32.19 — the Make my own words, checked here as the copy registry checks every module (Urdu complete, every
 * Urdu value a label unless listed), so this folder's run catches a new string before the registry does.
 */
describe('Make my own copy', () => {
  it('Urdu is complete', () => {
    expect(untranslated(OWN, OWN_COPY_ENTRY.same ?? [])).toEqual([]);
  });

  it('every Urdu value is a label, or listed as a sentence', () => {
    const bad = collectCopy(OWN.ur)
      .filter((c) => copyProblem(c.text))
      .filter((c) => !(OWN_COPY_ENTRY.longOk ?? []).some((p) => c.path.startsWith(p)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it('the guardrails are named: phonics and CPA in brackets, GRR as a fixed line, no rote way, no whole-plan part', () => {
    expect(OWN_COPY.ways.phonics).toMatch(/\(phonics\)/);
    expect(OWN_COPY.ways.cpa).toMatch(/\(CPA\)/);
    expect(OWN_COPY.grrLine).toBe('I do → We do → You do stays in every plan. No rote drill.');
    expect(Object.values(OWN_COPY.ways).join(' ')).not.toMatch(/rote|repeat|memor|drill/i);
    expect(OWN_COPY.partNames).not.toHaveProperty('whole');
    expect(OWN_COPY.refusals.rote).toMatch(/rote drill/);
    expect(OWN_COPY.refusals.grr).toMatch(/I do, We do and You do/);
  });

  it('Grade 8 exam practice is labelled for the FDE exam', () => {
    expect(OWN_COPY.purposeBoardFde).toBe('Exam practice (FDE)');
    expect(OWN_COPY.ways.exam_fde).toBe(OWN_COPY.purposeBoardFde);
    expect(OWN.ur.ways.exam_fde).toBe(OWN.ur.purposeBoardFde);
  });
});
