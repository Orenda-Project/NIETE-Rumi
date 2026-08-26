/**
 * bd-1hae7.19 (second pass) — the opening turn, from two real recordings.
 *
 * Heard 26 Aug, BEFORE the first fix:
 *   «میں نیت ہوں، نیت نیئیت، NIETE کی AI assistant»   ← three tries at one name
 * Heard 26 Aug, AFTER it:
 *   «میں Neeyat، NIETE کی AI assistant، آپ سے خوشگوار گفتگو میں جلدی شامل ہو رہی ہوں»
 *
 * Two root causes, neither of which the first fix touched:
 *
 * 1. PRONUNCIATION. The name was written in the prompt in LATIN script, so the
 *    model spoke the Latin token with English phonetics. "Do not spell N-I-E-T-E
 *    out" only banned letter-spelling — it never banned saying the Latin word.
 *    The model says what it is given: give it نیت.
 * 2. THE OPENING. "then a short, warm opening" is not an instruction, it is an
 *    invitation to improvise, and it improvised
 *    "I am quickly joining you in a pleasant conversation". The opening turn now
 *    has a fixed shape and a literal exemplar.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');
const flat = (p) => p.replace(/\s+/g, ' ');

describe('bd-1hae7.19 — she must SAY نیت, never the Latin spelling', () => {
  const f = flat(buildCallPrompt({ language: 'ur' }));

  test('the spoken name is given in Urdu script', () => {
    expect(f).toMatch(/نیت/);
  });

  test('saying the Latin forms aloud is explicitly forbidden', () => {
    expect(f).toMatch(/never say .{0,40}(NIETE|Neeyat).{0,40}(out loud|aloud)/i);
  });

  test('the rule covers English turns too, not just Urdu ones', () => {
    expect(f).toMatch(/in any language|whichever language|even .{0,20}English/i);
  });

  // Deliberately DESCRIBED, not quoted: the verbatim «میں نیت ہوں، نیت نیئیت…»
  // repeats the name three more times, which is exactly the priming that caused
  // the defect. Naming the failure must not re-create it.
  test('the three-tries-at-one-name failure is described so it cannot return', () => {
    expect(f).toMatch(/three times in a single breath/i);
    expect(f).not.toMatch(/نیت نیئیت/);
  });
});

describe('bd-1hae7.19 — the opening turn has a fixed shape', () => {
  const f = flat(buildCallPrompt({ language: 'ur' }));

  test('the opening is capped at one sentence plus one question', () => {
    expect(f).toMatch(/ONE short sentence/i);
    expect(f).toMatch(/one short question|then ONE question/i);
  });

  test('a literal Urdu exemplar is supplied, not just a description', () => {
    expect(f).toMatch(/السلام علیکم، میں نیت ہوں/);
  });

  test('the invented welcome-speech register is banned by name', () => {
    expect(f).toMatch(/خوش آمدید/);      // the "welcome!" it kept adding
    expect(f).toMatch(/خوشگوار گفتگو/);   // the actual phrase a caller heard
  });

  test('she stops after the opening instead of narrating what is about to happen', () => {
    expect(f).toMatch(/STOP and let her/i);
  });
});
