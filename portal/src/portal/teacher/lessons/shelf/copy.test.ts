import { describe, it, expect } from 'vitest';
import { collectCopy, copyProblem } from '../../../newui/checks/rules';
import { untranslated } from '../../i18n';
import { SHELF, SHELF_COPY, SHELF_COPY_ENTRY } from './copy';
import { COPY_ENTRIES } from '../copy';

/** bd-snkn32.42 — the "Made by a teacher" words, checked as the copy registry checks every module. */
describe('Made by a teacher copy', () => {
  it('Urdu is complete', () => {
    expect(untranslated(SHELF, SHELF_COPY_ENTRY.same ?? [])).toEqual([]);
  });

  it('every Urdu value is a label, or listed as a sentence', () => {
    const bad = collectCopy(SHELF.ur)
      .filter((c) => copyProblem(c.text))
      .filter((c) => !(SHELF_COPY_ENTRY.longOk ?? []).some((p) => c.path.startsWith(p)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it('the shelf is named as asked, and registered for the copy checks', () => {
    expect(SHELF_COPY.shelfTitle).toBe('Made by a teacher');
    expect(SHELF.ur.shelfTitle).toBe('ٹیچر کا بنایا ہوا');
    expect(COPY_ENTRIES).toContain(SHELF_COPY_ENTRY);
  });

  /* bd-snkn32.46 — reviewed with the language-protocol skill: the AI reviewer, not "our team", lists a plan; grade
     ranges are written «1 تا 5» (a hyphen range after an Urdu word paints reversed, «5–1»); no literal «جانچیں» noun. */
  it('says the plan met the standard, not that our team checked it', () => {
    expect(SHELF_COPY.shelfHint).not.toMatch(/our team/i);
    expect(SHELF.ur.shelfHint).not.toMatch(/ٹیم/);
    expect(SHELF.ur.shelfHint).toMatch(/معیار/);
  });

  it('writes grade ranges with تا, never a hyphen or dash after Urdu', () => {
    expect(SHELF.ur.bands).toEqual({ k5: 'جماعت 1 تا 5', g612: 'جماعت 6 تا 12' });
  });

  it('uses the house words: ٹیچر not استاد or اساتذہ, and no bare «جانچیں» as a noun', () => {
    const all = collectCopy(SHELF.ur).map((c) => c.text).join(' | ');
    expect(all).not.toMatch(/استاد|اساتذہ/);
    expect(SHELF.ur.below).not.toMatch(/جانچیں/);
  });
});
