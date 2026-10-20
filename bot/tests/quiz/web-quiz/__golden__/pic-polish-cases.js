'use strict';
/**
 * The cases the share-picture polish switch's "off" hashes cover (web-quiz-art-pic-polish.test.js), shared by the test and
 * by the one-off recorder that wrote web-quiz-art-pic-polish-off.json on the base. Every kind, size, language, a short,
 * a long Urdu and a long Latin name, the switch sets the share runs with, the friend's door, and the class table with
 * 3, 6 and 10 rows with the child first, in the middle and last.
 */
const crypto = require('crypto');

const LONG = 'محمدعبدالرحمان';
const LATIN = 'Muhammad Abdurrahman Testwala';
const NAMES = ['Iqra Testwala', LONG, LATIN];
const LIVE = { ur2: true, ink: true, ud: true, nf: true };
const UIS = { none: undefined, live: LIVE, ink: { ink: true }, stack: { ...LIVE, us: true } };
const ANI = ['cat', 'turtle', 'parrot', 'owl', 'dog', 'fish', 'lion', 'bee', 'horse', 'rabbit'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function rowsOf(n, at, first) {
  return Array.from({ length: n }, (_, i) => ({ place: i + 1, animal: ANI[i % 10], correct: 7 - Math.min(6, Math.floor(i / 2)), total: 7, ...(i === at ? { me: true, first } : {}) }));
}
function dOf(kind, lang, first, rows) {
  if (kind === 'school') return { rows: [{ rank: 1, name: 'School Alpha', sector: 'Sector One', points: 1234, kids: 15, move: 1, you: true }] };
  const ur = lang === 'ur';
  return { first, animal: 'cat', correct: ur ? 4 : 3, total: ur ? 7 : 8, topic: ur ? 'تفہیم - مکالمے کو سمجھنا' : 'Rocket and Space Vocabulary', cls: 'Grade 3', school: 'School Alpha', added: 18,
    played: 18, avgPct: 43, top: { correct: 7, total: 7 }, rows };
}
/** Every case: { key, kind, size, lang, d, ui, door }. */
function cases() {
  const out = [];
  for (const kind of ['card', 'invite', 'class', 'school']) for (const size of ['og', 'sq']) for (const lang of ['en', 'ur']) for (const first of NAMES) for (const [u, ui] of Object.entries(UIS)) {
    const rowSets = kind === 'class'
      ? [['none', []], ...[3, 6, 10].flatMap((n) => [['first', 0], ['middle', Math.floor(n / 2)], ['last', n - 1]].map(([p, at]) => [`${n}${p}`, rowsOf(n, at, first)]))]
      : [['-', rowsOf(2, 1, first)]];
    for (const [rk, rows] of rowSets) for (const door of kind === 'invite' ? [false, true] : [false]) {
      out.push({ key: `${kind}|${size}|${lang}|${first}|${u}|${rk}|${door ? 'door' : ''}`, kind, size, lang, d: dOf(kind, lang, first, rows), ui, door });
    }
  }
  return out;
}
module.exports = { cases, sha, LIVE, LONG, LATIN };
