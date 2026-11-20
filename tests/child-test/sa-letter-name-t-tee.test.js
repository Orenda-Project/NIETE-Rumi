'use strict';
/**
 * The English letter-names task (en.letters: Jugnu says a letter's NAME, the child taps it) names a lowercase t by its
 * name, "tee", like the capital T. The v4 take under the lowercase key (sa/v4/en/<sha1('en|t')[:12]>.mp3) said a bare
 * /t/ (no vowel at all), the letter's sound, so the child heard a sound where the task gives names. The capital's take
 * (sa/v4/en/<sha1('en|T')[:12]>.mp3) says "tee" in the same voice and loudness, and a letter's name is the same in either
 * case, so the lowercase key now serves that take. Same key, so it reaches a phone only with a new SESSION and a
 * rewritten clips lock.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session, LOCK } = require('../../dashboard/scripts/sa-clips-lock');

const REPO = path.join(__dirname, '..', '..');
const keyOf = (text) => `dashboard/sa/v4/en/${crypto.createHash('sha1').update(`en|${text}`).digest('hex').slice(0, 12)}.mp3`;
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO, p))).digest('hex');
const LOWER = keyOf('t');
const CAPITAL = keyOf('T');
// The capital T take, unchanged by this fix: the one already served as the letter-names practice example's name.
const TEE = '362db6675aabf9881e083730530371ba454bbfbe';

describe('the lowercase t in the English letter-names task', () => {
  it('is prompted by the lowercase key in the battery files (the clip this fix changes)', () => {
    const battery = JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/data/child-test/sa/sa.coach.G1.A.en.json'), 'utf8'));
    const letters = battery.tasks.find((t) => t.id === 'en.letters');
    const t = letters.items.filter((it) => it.say === 't');
    expect(t.length).toBeGreaterThan(0);
    for (const it of t) expect(`dashboard/${it.prompt_audio.replace('sa/v1/', 'sa/v4/')}`).toBe(LOWER);
  });

  it('serves the "tee" take under the lowercase key, the same bytes as the capital T', () => {
    expect(sha1(CAPITAL)).toBe(TEE);
    expect(sha1(LOWER)).toBe(TEE);
  });

  it('the lock records that take under a SESSION after sa-session-v32', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    expect(lock.files[LOWER]).toBe(TEE);
    expect(Number(session().replace('sa-session-v', ''))).toBeGreaterThan(32);
  });
});
