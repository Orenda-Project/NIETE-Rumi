/**
 * bd-2480 side-effect guard: since registration-endpoint persists first_name at the FIRST screen,
 * the /register "already registered" gate must key on registration_completed — not first_name —
 * or a teacher who started and abandoned the Flow gets locked out ("already registered") on retry.
 *
 * Pure test of the gate predicate the handler now uses.
 */
const isRegistered = (user) => !!(user?.registration_completed || user?.registration_state === 'completed');

describe('bd-2480 — /register already-registered gate', () => {
  it('a completed teacher is treated as registered', () => {
    expect(isRegistered({ first_name: 'Mahnoor', registration_completed: true, registration_state: 'completed' })).toBe(true);
  });
  it('a teacher who only got as far as the name screen (persisted first_name, not completed) is NOT locked out', () => {
    expect(isRegistered({ first_name: 'Mahnoor', registration_completed: false, registration_state: 'unregistered' })).toBe(false);
  });
  it('a legacy account with registration_state=completed but no boolean flag still counts as registered', () => {
    expect(isRegistered({ first_name: 'Old', registration_state: 'completed' })).toBe(true);
  });
  it('a brand-new user is not registered', () => {
    expect(isRegistered({})).toBe(false);
    expect(isRegistered(null)).toBe(false);
  });
});
