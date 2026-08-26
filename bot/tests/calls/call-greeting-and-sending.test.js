/**
 * bd-1hae7.19 — two defects heard on a live call.
 *
 * 1. She introduced herself two or three times in the opening breath
 *    ("Neeyat… میں نیت… NIETE's assistant Neeyat"). The pronunciation section
 *    added in bd-1hae7.18 names her EIGHT times, which primes exactly that.
 *    The rule "greet her once" was never the same rule as "say your name once".
 *
 * 2. She offered a teacher a lesson plan. She cannot send anything on a call —
 *    there is no channel out of a phone call except her voice. The prompt
 *    forbade RECEIVING files and said nothing about SENDING, so offering to
 *    deliver one read as allowed. Operator: she should offer to walk someone
 *    through something out loud, never to send it.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');

const flat = (p) => p.replace(/\s+/g, ' ');

describe('bd-1hae7.19 — she introduces herself ONCE', () => {
  test('the prompt does not drown her in her own name', () => {
    const p = buildCallPrompt({ language: 'ur' });
    // Count only the body the model reads, not the JSDoc header.
    const mentions = (p.match(/Neeyat|نیت/g) || []).length;
    expect(mentions).toBeLessThanOrEqual(6);
  });

  test('saying the name once is stated as its own rule, separate from greeting once', () => {
    const f = flat(buildCallPrompt({ language: 'ur' }));
    expect(f).toMatch(/say your name ONCE/i);
    expect(f).toMatch(/never twice in the same turn|not again unless she asks/i);
  });

  test('the pronunciation guidance survives the trim', () => {
    const f = flat(buildCallPrompt({ language: 'ur' }));
    expect(f).toMatch(/نیت/);
    expect(f).toMatch(/nee-yat/i);
    expect(f).toMatch(/letter by letter/i);
  });
});

describe('bd-1hae7.19 — a call is voice only: she guides, she never sends', () => {
  const p = buildCallPrompt({ language: 'ur' });
  const f = flat(p);

  test('sending anything from a call is explicitly forbidden', () => {
    expect(f).toMatch(/cannot send|can NOT send|never send/i);
    // The specific offer that was made on a real call.
    expect(f).toMatch(/lesson plan/i);
  });

  test('the allowed alternative is named — talk her through it out loud', () => {
    expect(f).toMatch(/talk (her|it) through|walk her through/i);
    expect(f).toMatch(/out loud|aloud/i);
  });

  test('WhatsApp is named as where documents actually come from', () => {
    expect(f).toMatch(/WhatsApp/);
  });

  test('the existing cannot-RECEIVE rule is still there', () => {
    expect(f).toMatch(/CANNOT receive anything on a call/);
  });
});
