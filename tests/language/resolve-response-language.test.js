/**
 * Which language do we answer a teacher in?
 *
 * A script-only detector was being used to override a STORED language preference.
 * `detectLanguage()` counts Perso-Arabic characters and returns 'en' for
 * everything else — including Roman Urdu, which is Latin-script Urdu and
 * extremely common in this market. So a teacher whose stored preference is Urdu,
 * writing Roman Urdu, resolved to English on every message.
 *
 * Measured on prod before this fix: 94% of `language_drift` events were
 * "expected en -> detected ur" — we asked the model for English, it answered in
 * Urdu, and the teacher (correctly) got Urdu. 59 of 60 sampled drifting users had
 * preferred_language='ur' with language_locked=false; 48 of 60 were still
 * mid-registration.
 *
 * THE RULE: only override a stored preference on UNAMBIGUOUS evidence.
 * Perso-Arabic script is unambiguous. Latin script is not evidence of English.
 *
 * This deliberately resolves a tension the codebase had settled BOTH ways in
 * different subsystems: one made per-turn detected language outrank a locked
 * preference, another required the lock be respected. The asymmetry keeps the
 * defensible half of each.
 */
// No mocks needed: the resolver imports only the dependency-free config module.
// If this ever needs a mock again, that is a signal the resolver has picked up an
// I/O dependency it should not have.
const { resolveResponseLanguage, SCRIPT_UNAMBIGUOUS } = require('../../bot/shared/utils/resolve-response-language');

const U = (preferred, locked) => ({ id: 'u1', preferred_language: preferred, language_locked: locked });

describe('resolveResponseLanguage', () => {
  it('keeps Urdu for an UNLOCKED ur teacher who writes Latin script (Roman Urdu)', () => {
    expect(resolveResponseLanguage({ user: U('ur', false), stored: 'ur', detected: 'en' }).language).toBe('ur');
  });

  it('reports WHY it kept the stored language, so the log is diagnostic', () => {
    const r = resolveResponseLanguage({ user: U('ur', false), stored: 'ur', detected: 'en' });
    expect(r.source).toBe('stored');
    expect(r.autoAdapted).toBe(false);
  });

  it('DOES adapt to Urdu when she writes Urdu script but is stored en', () => {
    const r = resolveResponseLanguage({ user: U('en', false), stored: 'en', detected: 'ur' });
    expect(r.language).toBe('ur');
    expect(r.autoAdapted).toBe(true);
    expect(r.source).toBe('detected');
  });

  it('never adapts TO English off Latin script, whatever the stored value', () => {
    for (const stored of ['ur', 'en']) {
      const r = resolveResponseLanguage({ user: U(stored, false), stored, detected: 'en' });
      expect(r.language).toBe(stored);
      expect(r.autoAdapted).toBe(false);
    }
  });

  it('a LOCKED teacher gets her choice even when the script disagrees', () => {
    expect(resolveResponseLanguage({ user: U('en', true), stored: 'en', detected: 'ur' }).language).toBe('en');
    expect(resolveResponseLanguage({ user: U('ur', true), stored: 'ur', detected: 'en' }).language).toBe('ur');
  });

  it('marks a locked resolution as such, and never as auto-adapted', () => {
    const r = resolveResponseLanguage({ user: U('en', true), stored: 'en', detected: 'ur' });
    expect(r.source).toBe('locked');
    expect(r.autoAdapted).toBe(false);
  });

  it('clamps an off-offer STORED value rather than emitting it', () => {
    const r = resolveResponseLanguage({ user: U('ar', true), stored: 'ar', detected: 'ur' });
    expect(['en', 'ur']).toContain(r.language);
  });

  it('clamps an off-offer DETECTED language rather than adapting to it', () => {
    const r = resolveResponseLanguage({ user: U('ur', false), stored: 'ur', detected: 'ar' });
    expect(r.language).toBe('ur');
    expect(r.autoAdapted).toBe(false);
  });

  it('falls back to the stored value when detection is missing', () => {
    expect(resolveResponseLanguage({ user: U('ur', false), stored: 'ur', detected: null }).language).toBe('ur');
  });

  it('an unregistered teacher with a stored preference still gets it', () => {
    const u = { ...U('ur', false), registration_completed: false };
    expect(resolveResponseLanguage({ user: u, stored: 'ur', detected: 'en' }).language).toBe('ur');
  });

  it('uses the emergency floor ONLY when there is no user and nothing stored', () => {
    const r = resolveResponseLanguage({ user: null, stored: null, detected: null });
    expect(r.language).toBe('en');
    expect(r.source).toBe('floor');
  });

  it('an Urdu-script message from an unknown user still adapts', () => {
    const r = resolveResponseLanguage({ user: null, stored: null, detected: 'ur' });
    expect(r.language).toBe('ur');
  });

  it('returns an offered language and a known source for EVERY input combination', () => {
    for (const stored of ['en', 'ur', 'ar', null, undefined, '']) {
      for (const detected of ['en', 'ur', 'ar', null, undefined, '']) {
        for (const locked of [true, false, null, undefined]) {
          const r = resolveResponseLanguage({ user: stored == null ? null : U(stored, locked), stored, detected });
          expect(['en', 'ur']).toContain(r.language);
          expect(['locked', 'stored', 'detected', 'floor']).toContain(r.source);
          expect(typeof r.autoAdapted).toBe('boolean');
        }
      }
    }
  });

  it('will not adapt to a script-unambiguous language this deployment does not OFFER', () => {
    // Today SCRIPT_UNAMBIGUOUS holds only 'ur', which is always offered, so the
    // isOffered(detected) guard is dead weight — a mutation removing it survived.
    // It exists for the next person who adds a script here without adding it to
    // LANGUAGE_OFFER. This exercises that future directly rather than trusting it.
    SCRIPT_UNAMBIGUOUS.add('ar');
    try {
      const r = resolveResponseLanguage({ user: { id: 'u', preferred_language: 'ur', language_locked: false }, stored: 'ur', detected: 'ar' });
      expect(r.language).toBe('ur');       // NOT 'ar' — it is not offered
      expect(r.autoAdapted).toBe(false);
    } finally {
      SCRIPT_UNAMBIGUOUS.delete('ar');
    }
  });

  it('is pure — calling it twice with the same input gives the same answer', () => {
    const args = { user: U('ur', false), stored: 'ur', detected: 'en' };
    expect(resolveResponseLanguage(args)).toEqual(resolveResponseLanguage(args));
  });
});
