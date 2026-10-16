'use strict';
/**
 * A synthetic phone for tests whose code under test needs digits (it normalises, validates or hashes the phone).
 *
 * The repo holds no phone-shaped digit literal (tests/setup/phone-shaped-fixtures.test.js), so the digit form is
 * built at runtime from parts: fixturePhone(7) → 92 000 0000007, a normalised 12-digit number in the 920000… range
 * synthetic phones use (never a real mobile prefix). A test whose code
 * only carries the phone as an opaque value uses the letters form '+92300FIXTURE<n>' instead.
 *
 * maskFixturePhones(value) rewrites every fixturePhone digit run inside a value (deep: strings, arrays, plain
 * objects) to its letters form '92300FIXTURE<n>', so a snapshot taken of that value stores no digit phone.
 */
const fixturePhone = (n) => '92' + '000' + String(n).padStart(7, '0');

const FIXTURE_DIGITS_RX = new RegExp('92' + '000' + '(\\d{7})', 'g');

function maskFixturePhones(value) {
  if (typeof value === 'string') return value.replace(FIXTURE_DIGITS_RX, (_, n) => `92300FIXTURE${Number(n)}`);
  if (Array.isArray(value)) return value.map(maskFixturePhones);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskFixturePhones(v)]));
  }
  return value;
}

module.exports = { fixturePhone, maskFixturePhones };
