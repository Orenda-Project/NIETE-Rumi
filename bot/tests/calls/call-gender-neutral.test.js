/**
 * bd-1hae7.19 — she assumed the caller was a woman.
 *
 * Heard on a real call, addressed TO the caller:
 *   «کیا آپ ... بات کرنا چاہ رہی ہیں؟»   ← feminine 2nd person
 *   «آپ کچھ آسان steps آزما سکتی ہیں»    ← feminine 2nd person
 *
 * NIETE's teachers and coaches are mixed-gender, and we do not know who is on
 * the line. This is the bd-2453 rule, which every written surface in this repo
 * already carries and the call prompt did not.
 *
 * The rule is ASYMMETRIC and that is the part a model gets wrong:
 *   - about HERSELF        → feminine (she is a female assistant)
 *   - about/TO the CALLER  → never gendered
 *
 * The prompt also calls the caller "she" throughout in its English prose, which
 * is itself a prior toward feminine Urdu. That has to be defused explicitly,
 * because the model cannot tell a writing convention from a fact.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');
const { GENDER_NEUTRAL_ADDRESS } = require('../../shared/config/gender-neutral-address');
const flat = (p) => p.replace(/\s+/g, ' ');

describe('bd-1hae7.19 — the caller is never assumed to be a woman', () => {
  const p = buildCallPrompt({ language: 'ur' });
  const f = flat(p);

  test('the shared rule ships in the call prompt', () => {
    expect(p).toContain(GENDER_NEUTRAL_ADDRESS.trim());
  });

  test('the caller may be a man or a woman, said plainly', () => {
    expect(f).toMatch(/مرد بھی ہو سکتے ہیں اور خاتون بھی/);
  });

  test('the feminine 2nd-person stems heard on the call are banned by name', () => {
    expect(f).toMatch(/کرتی ہیں/);
    expect(f).toMatch(/سکتی ہیں/);
    expect(f).toMatch(/چاہ رہی ہیں|چاہتی ہیں/);
  });

  test('the neutral constructions are named, not just the banned ones', () => {
    expect(f).toMatch(/کرتے ہیں/);         // respectful plural
    expect(f).toMatch(/آپ نے/);            // past with نے
    expect(f).toMatch(/کریں|بتائیں/);      // آپ-imperative
  });

  test('she still speaks about HERSELF in the feminine — the rule is asymmetric', () => {
    expect(f).toMatch(/کر رہی ہوں|کروں گی/);
    expect(f).toMatch(/about yourself|YOURSELF/i);
  });

  test('the prompt defuses its own "she" convention as a prior', () => {
    expect(f).toMatch(/calls the caller "she" for brevity only/i);
    expect(f).toMatch(/NOT a fact about who is calling/i);
    expect(f).toMatch(/do not let it decide your Urdu/i);
  });
});
