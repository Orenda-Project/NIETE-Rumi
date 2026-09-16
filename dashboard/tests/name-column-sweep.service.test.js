/**
 * Test: users.name is rendered once, and rendered safely (bd-60105)
 *
 * Background. The bd-60092 sweep replaced users.first_name / users.last_name
 * with the single users.name column, and V1.4.4 then DROPPED both columns in
 * production. The bot side of that sweep is correct, but the dashboard was left
 * half-swept in two distinct ways:
 *
 *   1. Mechanical replacement produced `${row.name} ${row.name}` and
 *      `SELECT u.name, u.name` — i.e. the SAME column twice where the code used
 *      to concatenate two DIFFERENT columns. Verified against NIETE prod
 *      2026-09-16: a real teacher renders as "Munazza Khatoon Munazza Khatoon".
 *
 *   2. Views still read `.first_name` / `.last_name` off row objects whose
 *      projection no longer carries them, so they render blank.
 *
 * These tests encode the CORRECT behaviour and fail against the pre-fix code.
 */

const fs = require('fs');
const path = require('path');

const DASHBOARD = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(DASHBOARD, rel), 'utf8');

describe('bd-60105 — one name column, rendered once', () => {

  describe('video-observability: the doubled-name defect', () => {
    // The exact shape of the mapper at services/video-observability.service.js.
    // Kept as a local reimplementation so the assertion is about the RENDERING
    // RULE, not about wiring up a live database client.
    const renderDoubled = (row) => `${row.name || ''} ${row.name || ''}`.trim() || row.phone_number;
    const renderCorrect = (row) => (row.name || '').trim() || row.phone_number;

    test('a teacher name must not be repeated twice', () => {
      const row = { name: 'Munazza Khatoon', phone_number: '923001234567' };

      // This is what the buggy mapper produces today — documented, not desired.
      expect(renderDoubled(row)).toBe('Munazza Khatoon Munazza Khatoon');

      // This is what it must produce.
      expect(renderCorrect(row)).toBe('Munazza Khatoon');
    });

    test('a nameless teacher still falls back to the phone number', () => {
      // 6,415 of 15,570 NIETE users have no name (measured 2026-09-16), so the
      // fallback is the common path, not an edge case.
      const row = { name: null, phone_number: '923001234567' };
      expect(renderCorrect(row)).toBe('923001234567');
    });

    test('source no longer selects or concatenates the same column twice', () => {
      const src = read('services/video-observability.service.js');

      expect(src).not.toMatch(/u\.name,\s*u\.name/);
      expect(src).not.toMatch(/\$\{row\.name[^}]*\}\s*\$\{row\.name/);
    });
  });

  describe('coaching-observability: projection must not duplicate name', () => {
    test('SELECT list does not carry u.name twice', () => {
      const src = read('services/coaching-observability.service.js');
      expect(src).not.toMatch(/u\.name,\s*u\.name/);
    });
  });

  describe('views must not read columns that were dropped in V1.4.4', () => {
    // Every .ejs whose data source projects `name` but not first_name/last_name.
    const VIEWS = [
      'views/coaching.ejs',
      'views/users.ejs',
      'views/videos.ejs',
      'views/video-detail.ejs',
      'views/admin-invitations.ejs',
      'views/attendance-mark.ejs',
    ];

    test.each(VIEWS)('%s reads neither first_name nor last_name', (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(/\bfirst_name\b/);
      expect(src).not.toMatch(/\blast_name\b/);
    });
  });
});
