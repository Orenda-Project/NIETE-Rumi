/**
 * Pins the organization value every new NIETE registration gets: `niete`.
 * The data team asked for one organization value across the six ICT sectors (doc "NIETE data
 * fixes", 2026-10-27), and scripts/set-organization.py backfills existing rows to this same value.
 * A different constant here would split the column again. Change both together, never one.
 */
const fs = require('fs');
const path = require('path');

test("new registrations get organization 'niete'", () => {
  const src = fs.readFileSync(path.join(__dirname, '../../shared/routes/registration-endpoint.js'), 'utf8');
  expect(src).toMatch(/const NIETE_ORGANIZATION = 'niete';/);
});
