/**
 * bd-s3qsc — getUserLanguage(from) passed a PHONE NUMBER into the users.id
 * uuid lookup at six text-message.handler call sites. The query errors on
 * every call (~880 errors in 5h on Aug 21 morning) and the helper answers
 * with the emergency English floor — so Urdu teachers were served English
 * on every text path (menu intro, quiz follow-up, training, assessment-gen,
 * quiz command, pakistan-lp).
 *
 * getUserLanguage's contract is explicit (`@param userId - User ID from
 * users table`; `.eq('id', userId)`). Every handler call site must pass
 * user.id — all six sit behind a `!user` guard, so it is always in scope.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js');

function strippedSource() {
  return fs.readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('bd-s3qsc — language lookups pass the uuid, never the phone', () => {
  it('no call site passes the raw phone (`from`) into getUserLanguage', () => {
    const bad = strippedSource().match(/getUserLanguage\(\s*from\s*\)/g) || [];
    expect(bad).toHaveLength(0);
  });

  it('the six sites all resolve via user.id', () => {
    const good = strippedSource().match(/getUserLanguage\(\s*user\.id\s*\)/g) || [];
    expect(good.length).toBeGreaterThanOrEqual(6);
  });
});
