/**
 * bd-i2jt0 — the 📘 Lesson Plans browse card's CTA button reads "Pick a class".
 *
 * Operator request (2026-09-09): the button said "Pick Class" — a truncated,
 * label-ish phrase where the rest of the card speaks in full sentences
 * ("Pick your class, subject and chapter…"). "Pick a class" is the same
 * instruction in the same register as the body it sits under.
 *
 * Pinned here because the string is teacher-facing and sits in a WhatsApp
 * button — the tightest field on the channel (20 CODE POINTS, measured as
 * [...s].length, never s.length). A copy edit that pushes it over the cap makes
 * Meta reject the whole message, and the Flow silently never opens
 * (see ux-strings-whatsapp-limits.test.js for the outage this class caused).
 */

const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const BUTTON_CAP = 20;
const len = (s) => [...s].length;

describe('bd-i2jt0 — lpBrowseButton copy', () => {
  it('reads "Pick a class" in English', () => {
    expect(UX_STRINGS.lpBrowseButton.en).toBe('Pick a class');
  });

  it('keeps the Urdu button unchanged', () => {
    expect(UX_STRINGS.lpBrowseButton.ur).toBe('جماعت چنیں');
  });

  it('fits the 20-code-point WhatsApp button cap in every language, with headroom', () => {
    for (const [lang, value] of Object.entries(UX_STRINGS.lpBrowseButton)) {
      expect({ lang, len: len(value) }).toEqual({ lang, len: expect.any(Number) });
      expect(len(value)).toBeLessThanOrEqual(BUTTON_CAP - 5);
    }
  });
});
