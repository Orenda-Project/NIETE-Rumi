/**
 * Reflective-conversation language: no GLOBAL preference write.
 *
 * Locks the fix for the language-corruption bug: when a teacher answers a
 * reflective question in a different language (or code-switches — very common
 * in PK classrooms), the flow must NOT persist that to her global
 * `preferred_language`. Doing so silently flipped every future coaching
 * question + report to the answer's language. Global language changes only on
 * an explicit /settings action. (Mirrors the main-bot fix bd-1745.)
 *
 * Source-level guard: the live flow depends on supabase, elevenlabs, whatsapp
 * and audio-cache — too many real deps to unit-test end-to-end — so we lock the
 * call-site shape the same way the v12-wiring test does.
 */

const fs = require('fs');
const path = require('path');

const SERVICE = path.join(
  __dirname,
  '../../bot/shared/services/coaching/reflective-conversation.service.js'
);

describe('Reflective-conversation — no global preferred_language write', () => {
  const src = fs.readFileSync(SERVICE, 'utf8');

  it('does NOT call setUserLanguage anywhere (no global preference corruption)', () => {
    expect(src).not.toMatch(/setUserLanguage\s*\(/);
  });

  it('does NOT import setUserLanguage from language-cache', () => {
    // getUserLanguage (read) is fine and expected; setUserLanguage (write) is not.
    const importLine = (src.match(/require\(['"]\.\.\/\.\.\/utils\/language-cache['"]\)/) && src
      .split('\n')
      .find((l) => l.includes('language-cache'))) || '';
    expect(importLine).not.toMatch(/setUserLanguage/);
    expect(importLine).toMatch(/getUserLanguage/);
  });

  it('still resolves the teacher language via getUserLanguage (questions stay in her language)', () => {
    expect(src).toMatch(/getUserLanguage\s*\(/);
  });
});
