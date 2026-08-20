/**
 * bd-43478 — teacher-selected training bands + the 48-hour change cooldown.
 *
 * ICT sheet Row 6: a teacher teaching primary AND middle saw only the 4 NIETE
 * levels, no Oxbridge and no Beacon House.
 *
 * Nothing was wrong with the visibility code. She registered with
 * grades_taught=["grade_4"], which correctly derives to PRIMARY -> niete_primary,
 * and that program scopes to the NIETE vendor alone. Oxbridge and Beacon House
 * exist only under niete_middle_high. The real gap: her access was frozen at a
 * one-time signup answer and no surface let her — or her coach — correct it.
 *
 * This is the pure-logic half of the fix: which bands map to which programs,
 * and when a change is allowed. No DB, no side effects.
 *
 * Cooldown rules (operator, 2026-08-20):
 *   - First-ever selection is ALWAYS allowed (no cooldown to serve).
 *   - After a change, the teacher cannot change again for 48 hours.
 *   - Inside the window, they are told they changed it less than 48h ago and
 *     to contact NIETE Support.
 */

// CI runs the root suite BEFORE `bot/ npm ci`, so bot-only deps must be mocked
// virtually or this pure-logic suite cannot even load the service module.
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }), { virtual: true });

const {
  bandsToPrograms,
  canChangeBands,
  COOLDOWN_HOURS,
  BANDS,
} = require('../../bot/shared/services/training/band-selection.service');

const HOUR = 3_600_000;
// Fixed clock — Date.now() is never called directly by the assertions.
const NOW = new Date('2026-08-20T12:00:00.000Z');

describe('bandsToPrograms — the band -> program mapping', () => {
  test('PRIMARY alone yields niete_primary', () => {
    expect(bandsToPrograms(['PRIMARY'])).toEqual(['niete_primary']);
  });

  test('MIDDLE alone yields niete_middle_high', () => {
    expect(bandsToPrograms(['MIDDLE'])).toEqual(['niete_middle_high']);
  });

  test('HIGH alone yields niete_middle_high', () => {
    expect(bandsToPrograms(['HIGH'])).toEqual(['niete_middle_high']);
  });

  test('MIDDLE + HIGH collapse to one niete_middle_high row', () => {
    expect(bandsToPrograms(['MIDDLE', 'HIGH'])).toEqual(['niete_middle_high']);
  });

  test('the Row 6 case: PRIMARY + MIDDLE yields BOTH programs', () => {
    // This is the whole point of the feature — niete_middle_high is what
    // carries the Oxbridge and Beacon House vendor scopes.
    const got = bandsToPrograms(['PRIMARY', 'MIDDLE']);
    expect(got.sort()).toEqual(['niete_middle_high', 'niete_primary']);
    expect(got).toContain('niete_middle_high');
  });

  test('order of the selection does not change the result', () => {
    expect(bandsToPrograms(['MIDDLE', 'PRIMARY']).sort())
      .toEqual(bandsToPrograms(['PRIMARY', 'MIDDLE']).sort());
  });

  test('duplicates in the selection do not duplicate programs', () => {
    expect(bandsToPrograms(['PRIMARY', 'PRIMARY'])).toEqual(['niete_primary']);
  });

  test('an empty selection yields no programs — never a default', () => {
    // Mirrors the bd-2672 rule: no signal means no access, not a guess.
    expect(bandsToPrograms([])).toEqual([]);
    expect(bandsToPrograms(null)).toEqual([]);
  });

  test('unknown band tokens are ignored, not mapped to a default', () => {
    expect(bandsToPrograms(['BANANA'])).toEqual([]);
    expect(bandsToPrograms(['PRIMARY', 'BANANA'])).toEqual(['niete_primary']);
  });

  test('band tokens are case-insensitive', () => {
    expect(bandsToPrograms(['primary'])).toEqual(['niete_primary']);
  });

  test('niete_standard is never handed out', () => {
    for (const sel of [['PRIMARY'], ['MIDDLE'], ['HIGH'], ['PRIMARY', 'HIGH']]) {
      expect(bandsToPrograms(sel)).not.toContain('niete_standard');
    }
  });

  test('BANDS is the offered vocabulary, exactly three', () => {
    expect(BANDS.map(b => b.key)).toEqual(['PRIMARY', 'MIDDLE', 'HIGH']);
  });
});

describe('canChangeBands — the 48h cooldown', () => {
  test('the cooldown is 48 hours', () => {
    expect(COOLDOWN_HOURS).toBe(48);
  });

  test('a teacher who never selected can always choose', () => {
    const r = canChangeBands({ training_bands_updated_at: null }, NOW);
    expect(r.allowed).toBe(true);
    expect(r.isFirstSelection).toBe(true);
  });

  test('an imported band with no self-edit is still a first selection', () => {
    // The migration seeds training_bands from levels but deliberately leaves
    // training_bands_updated_at NULL, so an imported teacher is not born into
    // a cooldown.
    const user = { training_bands: ['PRIMARY'], training_bands_updated_at: null };
    const r = canChangeBands(user, NOW);
    expect(r.allowed).toBe(true);
    expect(r.isFirstSelection).toBe(true);
  });

  test('a change 1 hour ago is blocked', () => {
    const user = { training_bands_updated_at: new Date(NOW - 1 * HOUR).toISOString() };
    const r = canChangeBands(user, NOW);
    expect(r.allowed).toBe(false);
    expect(r.isFirstSelection).toBe(false);
  });

  test('a change 47.9 hours ago is still blocked', () => {
    const user = { training_bands_updated_at: new Date(NOW - 47.9 * HOUR).toISOString() };
    expect(canChangeBands(user, NOW).allowed).toBe(false);
  });

  test('a change exactly 48 hours ago is allowed — the boundary opens', () => {
    const user = { training_bands_updated_at: new Date(NOW - 48 * HOUR).toISOString() };
    expect(canChangeBands(user, NOW).allowed).toBe(true);
  });

  test('a change 49 hours ago is allowed', () => {
    const user = { training_bands_updated_at: new Date(NOW - 49 * HOUR).toISOString() };
    expect(canChangeBands(user, NOW).allowed).toBe(true);
  });

  test('a blocked result reports hours remaining, rounded up, never zero', () => {
    const user = { training_bands_updated_at: new Date(NOW - 47.2 * HOUR).toISOString() };
    const r = canChangeBands(user, NOW);
    expect(r.allowed).toBe(false);
    expect(r.hoursRemaining).toBe(1);
  });

  test('hours remaining is 48 immediately after a change', () => {
    const user = { training_bands_updated_at: new Date(NOW).toISOString() };
    expect(canChangeBands(user, NOW).hoursRemaining).toBe(48);
  });

  test('a future timestamp (clock skew) is treated as just-changed, not as allowed', () => {
    const user = { training_bands_updated_at: new Date(NOW.getTime() + 5 * HOUR).toISOString() };
    const r = canChangeBands(user, NOW);
    expect(r.allowed).toBe(false);
  });

  test('a malformed timestamp fails OPEN — a bad value must not lock a teacher out', () => {
    const r = canChangeBands({ training_bands_updated_at: 'not-a-date' }, NOW);
    expect(r.allowed).toBe(true);
  });

  test('the blocked message names the 48h rule and points at NIETE Support', () => {
    const user = { training_bands_updated_at: new Date(NOW - 2 * HOUR).toISOString() };
    const { message } = canChangeBands(user, NOW);
    expect(message).toMatch(/48/);
    expect(message).toMatch(/NIETE Support/i);
  });

  test('the first-selection result carries no blocked message', () => {
    expect(canChangeBands({ training_bands_updated_at: null }, NOW).message).toBeNull();
  });
});

describe('bd-43478 — training_bands outranks every other signal', () => {
  const { deriveBands, programsForUser } =
    require('../../scripts/lib/training-band-derivation');

  test('training_bands wins over users.levels', () => {
    const u = { training_bands: ['MIDDLE'], levels: ['PRIMARY'], grades_taught: '["grade_1"]' };
    expect(deriveBands(u)).toEqual(['MIDDLE']);
  });

  test('training_bands wins over grades_taught — the Row 6 correction', () => {
    // Her registration says grade_4 (PRIMARY). Her own choice says both.
    const u = { training_bands: ['PRIMARY', 'MIDDLE'], levels: null, grades_taught: '["grade_4"]' };
    expect(deriveBands(u)).toEqual(['MIDDLE', 'PRIMARY']);
    expect(programsForUser(u).sort()).toEqual(['niete_middle_high', 'niete_primary']);
  });

  test('an empty training_bands falls through to the older signals', () => {
    const u = { training_bands: [], levels: ['HIGH'], grades_taught: null };
    expect(deriveBands(u)).toEqual(['HIGH']);
  });

  test('levels still works untouched when training_bands is absent', () => {
    // The no-downtime guarantee: nothing that read levels before behaves
    // differently now.
    expect(deriveBands({ levels: ['PRIMARY'] })).toEqual(['PRIMARY']);
  });

  test('invalid tokens in training_bands fall through rather than yielding nothing', () => {
    const u = { training_bands: ['BANANA'], levels: ['MIDDLE'] };
    expect(deriveBands(u)).toEqual(['MIDDLE']);
  });
});

describe('bd-43478 — the backfill must never overwrite a teacher choice', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '../../scripts/backfill-training-assignments.js'), 'utf8');

  test('the backfill only targets teachers with NO active assignment', () => {
    // A self-selecting teacher always has an active row, so this filter is what
    // keeps their choice safe. If someone widens it to re-derive already-assigned
    // teachers, this test fails and they must special-case teacher_self_select.
    expect(src).toMatch(/orphans\s*=\s*users\.filter\(\(u\)\s*=>\s*!activeUsers\.has\(u\.id\)\)/);
  });

  test('the backfill does not write users.levels or training_bands', () => {
    expect(src).not.toMatch(/update\(\{[^}]*\blevels\b/);
    expect(src).not.toMatch(/update\(\{[^}]*training_bands/);
  });
});
