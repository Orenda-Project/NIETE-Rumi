/**
 * bd-60130 — say nothing when a level has no exam.
 *
 * The level screen rendered "🎓 No level exam — finish all sessions to complete
 * this level." That is internal plumbing spoken out loud: I-SAPS assesses per
 * MODULE (bd-60119), so the absence of a LEVEL exam is not news a teacher needs
 * — it reads as something missing or broken.
 *
 * Operator, 2026-09-18: "just dont show anything instead of saying no level
 * exam. user dont need to know."
 *
 * The three fields are blanked rather than removed, because the published Flow
 * declares them: a screen whose data keys are absent fails to render at all.
 * A single space is what this Flow already uses elsewhere for "no caption".
 */

const {
  levelExamSlotHidden,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('bd-60130 — the hidden level-exam slot', () => {
  test('all three fields are blank, so the screen shows nothing', () => {
    const slot = levelExamSlotHidden();
    expect(slot.body.trim()).toBe('');
    expect(slot.caption.trim()).toBe('');
    expect(slot.cta.trim()).toBe('');
  });

  test('the fields still EXIST — the Flow declares them and needs them present', () => {
    const slot = levelExamSlotHidden();
    for (const k of ['body', 'caption', 'cta']) {
      expect(Object.prototype.hasOwnProperty.call(slot, k)).toBe(true);
      expect(typeof slot[k]).toBe('string');
      // Never empty-string: an empty Flow text field can render as a gap or
      // fail validation. The convention in this screen is a single space.
      expect(slot[k].length).toBeGreaterThan(0);
    }
  });

  test('it never mentions an exam, a level, or sessions', () => {
    const all = Object.values(levelExamSlotHidden()).join(' ').toLowerCase();
    expect(all).not.toMatch(/exam/);
    expect(all).not.toMatch(/level/);
    expect(all).not.toMatch(/session/);
  });
});
