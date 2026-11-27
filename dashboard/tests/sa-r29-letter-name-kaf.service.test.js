'use strict';
/**
 * The letter-names practice example is now ک, said by its name «کاف» (the content owner's 26 Nov review; it was ث). Its
 * clip key is sa/v4/ur/<sha1('ur|کاف')[:12]>.mp3, a key the 100-letter page already used, and the take there was heard
 * as «گاف» (the name of گ) on both machine listens, so a child would be taught the wrong name for the example letter.
 * The take the content owner picked (27 Nov, take C of three re-voiced takes) is served under the same key, so it reaches
 * a phone only with a new SESSION and a rewritten clips lock. The example is ک while sa_r28_letter_pick is ON (ث while
 * it is OFF: sa-r29-letter-names-practice-switch).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session, LOCK } = require('../scripts/sa-clips-lock');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const KEY = `dashboard/sa/v4/ur/${crypto.createHash('sha1').update('ur|کاف').digest('hex').slice(0, 12)}.mp3`;
const REPO = path.join(__dirname, '..', '..');
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO, p))).digest('hex');
const PICKED = 'b52cc0433f94e6dd1875e81d98925f940fdfbd20';

describe('the ک name clip in the letter-names practice', () => {
  it('the Urdu batteries, served with sa_r28_letter_pick ON, name it as the practice example\'s model', () => {
    const on = { ...Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, !/^r28/.test(k)])), r28LetterPick: true };
    for (const g of [1, 2, 3, 4, 5]) for (const l of ['ur', 'en']) {
      const b = applySwitches(JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/data/child-test/sa', `sa.coach.G${g}.A.${l}.json`), 'utf8')), on);
      const p = b.tasks.find((t) => t.id === 'ur.letter_names5').practice;
      expect(p.map((x) => [x.target, x.answer, x.model[1].audio])).toEqual([['ک', 'کاف', KEY.replace('dashboard/sa/v4/', 'sa/v1/')]]);
    }
  });

  it('serves the picked «کاف» take under its v4 key', () => {
    expect(sha1(KEY)).toBe(PICKED);
  });

  it('the lock records that take under a SESSION after sa-session-v34', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    expect(lock.files[KEY]).toBe(PICKED);
    expect(Number(session().replace('sa-session-v', ''))).toBeGreaterThan(34);
  });
});
