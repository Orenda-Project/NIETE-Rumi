/**
 * The "already registered" gate predicate — tested against the SHIPPED helper, not a
 * copy of it.
 *
 * History. bd-2480 moved the name write to the Flow's FIRST screen, so `first_name`
 * alone stopped meaning "she finished" and the gate was keyed on
 * `registration_completed` instead. This file used to assert that with its own inline
 * copy of the predicate — which is how it stayed green while the real handler's
 * behaviour was wrong on production.
 *
 * What production said (NIETE prod, read-only, 2026-09-06): 7,685 users carry a
 * first_name and only 440 carry the flag; 7,245 have it false, 4,145 of them active in
 * the last 30 days. `registration_state` is unwritten there — 'unregistered' on 7,684 of
 * the 7,685 rows. So the gate is the UNION: a completed run, or a name we already know.
 *
 * bd-2480's own case is still safe, for a different reason than it used to be: a teacher
 * who abandons mid-Flow now reads as registered by name, and /register re-opens the Flow
 * for her regardless (that is the /register contract — a registered account re-opens the
 * Flow to CORRECT its details). She is never locked out; she is offered the update copy.
 * And the endpoint now marks the account complete at the screen that ends the Flow, so
 * "finished" and "has a name" stop drifting apart in the first place.
 */
const { isRegistered } = require('../../shared/utils/registration-status');

describe('the already-registered gate predicate', () => {
  it('a completed teacher is registered', () => {
    expect(isRegistered({ first_name: 'Mahnoor', registration_completed: true, registration_state: 'completed' })).toBe(true);
  });

  it('the flag alone is enough, with no name on the row', () => {
    expect(isRegistered({ first_name: null, registration_completed: true })).toBe(true);
  });

  it('a name alone is enough — the production case the flag-only gate broke', () => {
    expect(isRegistered({ first_name: 'Ayesha', registration_completed: false, registration_state: 'unregistered' })).toBe(true);
  });

  it('a legacy account with registration_state=completed and no boolean flag is registered', () => {
    expect(isRegistered({ first_name: null, registration_state: 'completed' })).toBe(true);
  });

  it('an empty-string first_name is not a name (212 prod rows carry one)', () => {
    expect(isRegistered({ first_name: '', registration_completed: false })).toBe(false);
    expect(isRegistered({ first_name: '   ' })).toBe(true); // whitespace IS a name to this check — the writers trim, this reader does not invent policy
  });

  it('a brand-new user is not registered', () => {
    expect(isRegistered({})).toBe(false);
    expect(isRegistered(null)).toBe(false);
    expect(isRegistered(undefined)).toBe(false);
  });
});
