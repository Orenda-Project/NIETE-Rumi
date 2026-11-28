import { describe, it, expect } from 'vitest';
import { failureLabel } from './failure';
import { ASSESSMENT } from './copy';

/** bd-qyi45h.5: a board paper held back for too many flawed questions says so, not "Came out wrong". */
describe('failureLabel', () => {
  it('TOO_MANY_FLAWS has its own label in both languages', () => {
    expect(failureLabel('TOO_MANY_FLAWS', ASSESSMENT.en)).toBe(ASSESSMENT.en.failures.TOO_MANY_FLAWS);
    expect(failureLabel('TOO_MANY_FLAWS', ASSESSMENT.ur as never)).toBe(ASSESSMENT.ur.failures.TOO_MANY_FLAWS);
    expect(ASSESSMENT.en.failures.TOO_MANY_FLAWS).not.toBe(ASSESSMENT.en.failures.BAD_JSON);
    expect(ASSESSMENT.ur.failures.TOO_MANY_FLAWS).toBeTruthy();
  });
  it('a short slot still reads as "came out wrong"', () => {
    expect(failureLabel('PATTERN_SHORT_SLOT', ASSESSMENT.en)).toBe(ASSESSMENT.en.failures.BAD_JSON);
  });
  it('busy (MODEL_UNAVAILABLE) tells her to try again in a minute, in both languages (bd-nr8mrm.10)', () => {
    expect(ASSESSMENT.en.failureHints.MODEL_UNAVAILABLE).toBe('Try again in a minute');
    expect(ASSESSMENT.ur.failureHints.MODEL_UNAVAILABLE).toMatch(/[\u0600-\u06FF]/);
    expect(ASSESSMENT.ur.failureHints.MODEL_UNAVAILABLE).not.toMatch(/[A-Za-z0-9]/);
  });
});
