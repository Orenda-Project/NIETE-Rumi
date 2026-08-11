/**
 * The reading-assessment welcome stops being translated by a model at runtime.
 *
 * What it did: built a prompt — "Generate a brief, friendly message in language
 * code X that welcomes the teacher…" — and sent it to gpt-4o-mini at
 * temperature 0.3, per teacher, per session. So the first thing a teacher read
 * when starting a reading assessment was:
 *
 *   - non-deterministic (temperature 0.3 — a different message every time)
 *   - unreviewable (no fixed string existed for anyone to approve)
 *   - billed per teacher, per session, forever
 *   - and only *hopefully* in the requested language, since nothing checked
 *
 * That is interface text. Interface text belongs in a reviewed catalog.
 *
 * The audit scoped this as one string. Reading the code, the surrounding
 * language-selection LIST is hardcoded too — header and body as inline
 * ternaries, footer English-only — and those land in WhatsApp fields with hard
 * character caps, the same class that took /language down earlier in this
 * workstream. So they move to the catalog with the rest and inherit the
 * limits guard.
 *
 * The passage-language PICKER itself is untouched, deliberately: language is what
 * a reading assessment measures, so choosing it per session is correct.
 */

const {
  UX_STRINGS,
  resolveUx,
} = require('../../bot/shared/config/ux-strings');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

const KEYS = [
  'readingWelcome',
  'readingWelcomeNamed',
  'readingPickerHeader',
  'readingPickerBody',
  'readingPickerFooter',
];

describe('reading-assessment copy lives in the catalog', () => {
  it.each(KEYS)('%s exists in every offered language', (key) => {
    expect(UX_STRINGS[key]).toBeDefined();
    for (const lang of LANGUAGE_OFFER) {
      expect(typeof UX_STRINGS[key][lang]).toBe('string');
      expect(UX_STRINGS[key][lang].trim().length).toBeGreaterThan(0);
    }
  });

  it('the named variant carries the student identifier through', () => {
    // Concurrent sessions name the student. The old prompt asked the model to
    // "mention this is for X", which it might or might not do.
    const out = resolveUx('readingWelcomeNamed', {
      language: 'en',
      params: { student: 'Ayesha' },
    });
    expect(out).toContain('Ayesha');
    expect(out).not.toMatch(/\{|\}/);
  });

  it('the Urdu welcome is in Urdu script, not romanised', () => {
    expect(UX_STRINGS.readingWelcome.ur).toMatch(/[؀-ۿ]/);
    expect(UX_STRINGS.readingWelcomeNamed.ur).toMatch(/[؀-ۿ]/);
  });
});

describe('reading picker chrome fits its WhatsApp fields', () => {
  // Same caps that took /language down: header 60, body 1024, footer 60.
  // Measured in code points, and with headroom, for the same reasons.
  const CAPS = { readingPickerHeader: 60, readingPickerBody: 1024, readingPickerFooter: 60 };

  it.each(Object.entries(CAPS))('%s fits (max %i) in both languages', (key, max) => {
    for (const lang of LANGUAGE_OFFER) {
      expect([...UX_STRINGS[key][lang]].length).toBeLessThanOrEqual(max - 5);
    }
  });
});

describe('the service no longer asks a model to translate its own UI', () => {
  const src = require('fs')
    .readFileSync(
      require.resolve('../../bot/shared/services/reading-assessment.service.js'),
      'utf8'
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('has no runtime translation prompt', () => {
    expect(src).not.toMatch(/Generate a brief, friendly message in language code/);
  });

  it('does not spend a model call on the welcome message', () => {
    // The whole point: interface text should cost nothing per teacher.
    expect(src).not.toMatch(/welcomePrompt/);
    expect(src).not.toMatch(/welcomeResponse/);
  });

  it('resolves its copy from the catalog instead', () => {
    expect(src).toMatch(/resolveUx\(\s*'reading/);
  });

  it('keeps the per-session passage-language picker', () => {
    // Language is what the assessment MEASURES. This one stays per-session.
    expect(src).toMatch(/languageList|passage/i);
  });
});
