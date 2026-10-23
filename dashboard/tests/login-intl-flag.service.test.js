'use strict';
/**
 * portal_login_intl_numbers — whether the teacher sign-in page takes a non-PK number. One switch for everyone (it is
 * read before anyone is signed in), fail-closed like every app_settings flag: only a real true turns it on.
 */
const { PORTAL_LOGIN_INTL_NUMBERS_KEY, isLoginIntlNumbersEnabled } = require('../lib/feature-flags');

function fakeDb(row, { error = null } = {}) {
  const asked = [];
  return {
    asked,
    from(table) {
      const chain = {
        select: () => chain,
        eq: (col, val) => { asked.push([table, col, val]); return chain; },
        maybeSingle: async () => ({ data: row, error }),
      };
      return chain;
    },
  };
}

describe('portal_login_intl_numbers', () => {
  it('reads its own app_settings key', async () => {
    const db = fakeDb({ value: true });
    expect(await isLoginIntlNumbersEnabled(db)).toBe(true);
    expect(db.asked).toEqual([['app_settings', 'key', PORTAL_LOGIN_INTL_NUMBERS_KEY]]);
    expect(PORTAL_LOGIN_INTL_NUMBERS_KEY).toBe('portal_login_intl_numbers');
  });

  it.each([[null], [{ value: false }], [{ value: 'yes' }], [{ value: 1 }]])('is off for %p', async (row) => {
    expect(await isLoginIntlNumbersEnabled(fakeDb(row))).toBe(false);
  });

  it('is off when the read fails', async () => {
    expect(await isLoginIntlNumbersEnabled(fakeDb(null, { error: { message: 'down' } }))).toBe(false);
  });
});
