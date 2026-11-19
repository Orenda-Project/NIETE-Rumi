'use strict';
/**
 * The letter-names practice example ث is said by its name «ثے» ("say", [seː]). The v4 take under its key said [siː],
 * a different name, so the child was taught the wrong name for the example letter. The re-voiced take is served under
 * the same key (sa/v4/ur/<sha1('ur|ثے')[:12]>.mp3, every battery names it), so it reaches a phone only with a new
 * SESSION and a rewritten clips lock.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session, LOCK } = require('../scripts/sa-clips-lock');

const KEY = `dashboard/sa/v4/ur/${crypto.createHash('sha1').update('ur|ثے').digest('hex').slice(0, 12)}.mp3`;
const REPO = path.join(__dirname, '..', '..');
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO, p))).digest('hex');

describe('the ث name clip in the letter-names practice', () => {
  it('serves the [seː] take under its key', () => {
    expect(sha1(KEY)).toBe('7669fabe27eebacc12ba249b7a6f7b3d872dbcce');
  });

  it('the lock records that take under a SESSION after sa-session-v29', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    expect(lock.files[KEY]).toBe('7669fabe27eebacc12ba249b7a6f7b3d872dbcce');
    expect(Number(session().replace('sa-session-v', ''))).toBeGreaterThan(29);
  });
});
