'use strict';
/**
 * The English letter-names task (en.letters: Jugnu says a letter's NAME, the child taps it). Every `say` is one character
 * and the v4 voice was handed that bare character, so several takes said a sound or another letter: lowercase i "bee",
 * y "ee", t a bare /t/, a "ah", m "mmm", n "nuh", and capital R "eye", F "es". A letter's name is the same in either case,
 * so a lowercase key whose own take is not its name serves its capital's take (same voice, same loudness). A capital whose
 * take failed, and j/w/y/z's lowercase keys that have no capital, serve a new take in the same voice (folds in #5311's t).
 * Same keys, so the new bytes reach a phone only with a new SESSION and a rewritten clips lock.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session, LOCK } = require('../../dashboard/scripts/sa-clips-lock');

const REPO = path.join(__dirname, '..', '..');
const keyOf = (text) => `dashboard/sa/v4/en/${crypto.createHash('sha1').update(`en|${text}`).digest('hex').slice(0, 12)}.mp3`;
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO, p))).digest('hex');

// The takes that did not say the letter's name (sha1 of the bytes served before this change).
const RETIRED = {
  B: '858e45efc6c3f3e134ab26412ba1567df126a712', F: '0fa2710c62935e4bf1b77adf609b9a7c01832948',
  G: 'a1cbf7abdede05e3bf1bd1a5e7b1c0521e110bec', L: 'b333c99e0f4feff22794514ca17618e09c9affff',
  R: 'b152de5998b2bcd4cbf7419dcdea99972312574a', X: 'dd84ecf1fb56439ed09fd33de45180348a26301f',
  a: 'a9cb8ec3c14070bfa059a3826e46062f64a4806b', d: '0316421b24c62524649bea817c7f5e88494b1f12',
  e: '8832d8987570661d4357e8bc7d98cab351f39466', f: 'b41088a127db7fab88e7fddf2e018d3d4688cfb0',
  g: 'be9cf4eb64e14eeaca0855e6c4063a4761ddcb23', h: 'f0cb77b9434e53f9cf64a73f2b8d8a6cf4ca090d',
  i: '615ad38e9cd75b7407ee543b1f91716d08cdda37', m: 'f5196ca493d07a668acb9e0eec4d4dda864f98bb',
  n: '994924e97b33f9b4cfc43e2502d80f3e58e2a935', o: '2f31bdc12f6e0a564fdc2e3cf6a4c5ced5830b13',
  r: 'f47996de77c8c914a1407d57d8e976535f9d733c', s: '7c288b9e19310ed299e7f1462505da0c8b13fb60',
  t: '14cae2ea3a6a1297d3aae823d6bdcf4c405d845d', u: 'f997e8341b365d33e56db8f0e9edb7f8447d876b',
  w: '717a7be1f2111c8819c4fea6ed59ed0e55145325', y: '859bd11e85d4c2cb51a8bd7085e5d7160adba141',
  z: 'fea53e72cf370309e34c9080fcc8e5688a314ba0',
};
// The lowercase keys that now serve their capital's take, and B, which serves the lowercase b's take.
const SAME_AS = { a: 'A', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H', i: 'I', m: 'M', n: 'N', o: 'O', r: 'R', s: 'S', t: 'T', u: 'U', B: 'b' };

const letters = JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/data/child-test/sa/sa.coach.G1.A.en.json'), 'utf8'))
  .tasks.find((t) => t.id === 'en.letters');

describe('the English letter-names prompts say the letter\'s name', () => {
  it('each changed letter is prompted by its own key in the battery', () => {
    const says = new Set(letters.items.map((it) => it.say));
    for (const L of Object.keys(RETIRED)) {
      expect(says.has(L)).toBe(true);
      for (const it of letters.items.filter((x) => x.say === L)) expect(`dashboard/${it.prompt_audio.replace('sa/v1/', 'sa/v4/')}`).toBe(keyOf(L));
    }
  });

  it('no key serves a retired take', () => {
    for (const [L, old] of Object.entries(RETIRED)) expect([L, sha1(keyOf(L))]).not.toEqual([L, old]);
  });

  it('a lowercase key serves its capital\'s take (and B the lowercase b\'s)', () => {
    for (const [L, from] of Object.entries(SAME_AS)) expect([L, sha1(keyOf(L))]).toEqual([L, sha1(keyOf(from))]);
  });

  it('the lock records the served bytes under a SESSION after sa-session-v32', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    for (const L of Object.keys(RETIRED)) expect([L, lock.files[keyOf(L)]]).toEqual([L, sha1(keyOf(L))]);
    expect(Number(session().replace('sa-session-v', ''))).toBeGreaterThan(32);
  });
});
