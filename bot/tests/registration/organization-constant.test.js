/**
 * Pins the organization value every new NIETE registration gets: `niete`.
 * The data team asked for one organization value across the six ICT sectors (doc "NIETE data
 * fixes", 2026-10-27), and scripts/set-organization.py backfills existing rows to this same value.
 * A different constant here would split the column again. Change both together, never one.
 *
 * The value is declared once, in config/registration-data.js, because two writers need it:
 * registration and the coach's add-teacher flow. Each takes it from there; neither re-declares it.
 */
const fs = require('fs');
const path = require('path');

test("new registrations get organization 'niete'", () => {
  const { NIETE_ORGANIZATION } = require('../../shared/config/registration-data');
  expect(NIETE_ORGANIZATION).toBe('niete');
});

test.each([
  'shared/routes/registration-endpoint.js',
  'shared/services/observe/observe-teacher-admin.service.js',
])('%s takes the value from config, never its own copy', (file) => {
  const src = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  expect(src).toMatch(/\bNIETE_ORGANIZATION\b[\s\S]*?require\(['"][./]+config\/registration-data['"]\)/);
  expect(src).not.toMatch(/const NIETE_ORGANIZATION\s*=/);
});
