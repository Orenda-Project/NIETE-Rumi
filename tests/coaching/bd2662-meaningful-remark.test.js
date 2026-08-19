/**
 * bd-2662 (NIETE + global) — the reflective closing remark must be a MEANINGFUL
 * coaching remark, not an echo.
 *
 * Reported by U0AUR8Y16F4 (12 Aug): "in response to the reply of the teacher on
 * reflection question, remarks were not useful, only repeating what the user said."
 * The old prompt literally instructed an echo ("reflects HER answer back to her").
 * The fix: validate the specific thing she realised, THEN affirm why it matters for
 * her students' learning — without advice, a to-do, or a new question.
 */

const {
  buildAcknowledgementPrompt,
} = require('../../bot/shared/services/coaching/reflective-acknowledgement');

describe('bd-2662 — reflective remark is meaningful, not an echo', () => {
  const p = buildAcknowledgementPrompt('I waited longer after asking', 'What were you noticing?', 'Urdu', 'ur');

  it('no longer instructs a pure echo of her words', () => {
    expect(p).not.toMatch(/reflects HER answer back to her/);
    expect(p.toLowerCase()).toMatch(/not.*(simply repeat|echo)/);
  });
  it('instructs the "why it matters for students" coaching insight', () => {
    expect(p.toLowerCase()).toMatch(/why.*matters/);
    expect(p.toLowerCase()).toMatch(/students'? learning/);
  });
  it('still forbids advice/next-step and a new question', () => {
    expect(p.toLowerCase()).toMatch(/not ask a new question/);
    expect(p.toLowerCase()).toMatch(/not give advice|do not add advice|advice, a to-do/);
  });
  it('still gender-neutral and keeps English terms in Latin', () => {
    expect(p.toLowerCase()).toMatch(/gender-neutral/);
    expect(p).toMatch(/English \(Latin/);
  });
  it('still carries the voice rules for the Urdu (spoken) path (bd-2651 preserved)', () => {
    expect(p).toMatch(/Nastaliq/);
  });
});
