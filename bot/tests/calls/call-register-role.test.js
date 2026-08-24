/**
 * From Dr. Riffat's real 5-minute call (coach, 2026-08-24, 23 turns). Four
 * defects, every one visible in the transcript:
 *
 *  A. **Masculine self-reference in Urdu** — "میں اب اردو میں بات کروں گا",
 *     "سنوں گا", "لکھوں گا". Her `preferred_language` is 'en', so the prompt
 *     shipped ONLY the English register block; when she spoke Urdu there were no
 *     Urdu gender/register rules in context at all. The bd-z5olm bug through a
 *     new door: a caller's stored preference does not decide what she SPEAKS.
 *  B. **Stayed in English for five turns** while she spoke Urdu, until she asked
 *     "تم مجھ سے انگلش میں کیوں بات کر رہے ہو؟"
 *  C. **Treated a coach as a teacher** — opened "let's dive into a teaching
 *     moment you'd like to reflect on"; she corrected it twice: "میں کوچ ہوں،
 *     میں ٹیچر نہیں ہوں".
 *  D. **Filler and overclaim** — "Got it, let me think…" (the phrasing OpenAI's
 *     guidance explicitly discourages), and "you can send it over, I can
 *     transcribe it" — which she cannot do on a phone call.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');

describe('A — BOTH register blocks ship, whatever the stored language', () => {
  test('an English-preference caller still gets the Urdu register rules', () => {
    const p = buildCallPrompt({ language: 'en' });
    expect(p).toMatch(/کریں/);
    expect(p).toMatch(/دیکھیں/);
    expect(p).toMatch(/feminine/i);
  });

  test('an Urdu-preference caller still gets the English register rules', () => {
    expect(buildCallPrompt({ language: 'ur' })).toMatch(/REGISTER — ENGLISH/);
  });

  test('the Urdu feminine rule is present for BOTH stored languages', () => {
    ['en', 'ur'].forEach((language) => {
      const p = buildCallPrompt({ language });
      expect(p).toMatch(/کر رہی ہوں|کروں گی/);
    });
  });

  test('the masculine forms Riffat heard are named as forbidden', () => {
    ['en', 'ur'].forEach((language) => {
      const p = buildCallPrompt({ language });
      expect(p).toMatch(/کروں گا/);   // named, so the model can avoid it
      expect(p).toMatch(/never|not|forbidden/i);
    });
  });
});

describe('B — she follows the caller\'s spoken language', () => {
  test('the stored preference is stated as a STARTING point, not a constraint', () => {
    const p = buildCallPrompt({ language: 'en' });
    expect(p).toMatch(/start in|begin in/i);
    expect(p).toMatch(/switch|follow her/i);
  });

  test('switching is instructed to happen immediately, not after she complains', () => {
    const p = buildCallPrompt({ language: 'en' });
    expect(p).toMatch(/immediately|straight away|at once|from that turn/i);
  });

  test('mixed Urdu/English input is handled without asking her to pick', () => {
    expect(buildCallPrompt({ language: 'ur' })).toMatch(/mix|both/i);
  });
});

describe('C — a coach is not a teacher', () => {
  test('a coach caller gets coach framing, not "your teaching"', () => {
    const p = buildCallPrompt({ language: 'ur', role: 'coach' });
    expect(p).toMatch(/coach|observer/i);
    expect(p).toMatch(/teachers she (observes|supports)|the teachers she/i);
  });

  test('the opening for a coach does not assume she teaches a class', () => {
    const p = buildCallPrompt({ language: 'ur', role: 'coach' });
    expect(p).toMatch(/do not assume she teaches|not assume she is a classroom teacher/i);
  });

  test('a teacher caller is unaffected', () => {
    const p = buildCallPrompt({ language: 'ur', role: 'teacher' });
    expect(p).toMatch(/teaching assistant/i);
  });

  test('an unknown role still yields a usable prompt', () => {
    expect(() => buildCallPrompt({ language: 'ur' })).not.toThrow();
  });
});

describe('D — no filler, no promises she cannot keep', () => {
  test('"let me think" is explicitly ruled out', () => {
    expect(buildCallPrompt({ language: 'ur' })).toMatch(/let me think/i);
  });

  test('she must not promise to receive files or recordings on a call', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/cannot (receive|listen to|open)|can't (receive|listen)/i);
    expect(p).toMatch(/recording|voice note|file/i);
  });

  test('she is told what to offer instead — WhatsApp', () => {
    expect(buildCallPrompt({ language: 'ur' })).toMatch(/on WhatsApp/i);
  });
});
