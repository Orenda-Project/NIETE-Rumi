/**
 * Known real numbers never sit in a tracked file, tests included (bd-xk8lp).
 *
 * The repo is public. A real teammate's mobile was used as a test caller in ~20 test files; the
 * phone-shaped-fixtures ratchet counts per directory, so swapping a placeholder for a real number passes it.
 * This check knows each real number only by the SHA-256 of its 92… form, so the file names no number.
 * It catches every spelling: +92…, 92…, 03…, with a space or dash after the network code.
 * Add a hash: `printf '92XXXXXXXXXX' | shasum -a 256`.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KNOWN_REAL_SHA256 = new Set([
  '685a0ad3b31f320aa80afe28ffae507123b608575794aeaefc7d62c4d18e017c', // bd-xk8lp
]);

const CANDIDATE_RX = /(?<!\d)(?:\+?92[ -]?|0)3\d{2}[ -]?\d{7}(?!\d)/g;

/** Every Pakistani-mobile-shaped string in a text, as 92XXXXXXXXXX. */
function normalisedMobiles(text) {
  return (String(text || '').match(CANDIDATE_RX) || []).map((m) => {
    const d = m.replace(/\D/g, '');
    return d.startsWith('0') ? `92${d.slice(1)}` : d;
  });
}

function knownRealCount(text) {
  return normalisedMobiles(text)
    .filter((n) => KNOWN_REAL_SHA256.has(crypto.createHash('sha256').update(n).digest('hex'))).length;
}

describe('known real numbers (bd-xk8lp)', () => {
  test('every spelling normalises to the 92 form', () => {
    const p = ['3', '00', '1234567'];
    const local = `0${p[0]}${p[1]} ${p[2]}`;
    const intl = `+92-${p.join('')}`;
    expect(normalisedMobiles(`a ${local} b ${intl} c 1${p.join('')}9`))
      .toEqual([`92${p.join('')}`, `92${p.join('')}`]);
  });

  test('no tracked file holds a known real number', () => {
    const root = path.resolve(__dirname, '../..');
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\0').filter(Boolean);
    const hits = [];
    for (const rel of files) {
      let buf;
      try {
        buf = fs.readFileSync(path.join(root, rel));
      } catch (_) {
        continue;
      }
      if (buf.length > 20 << 20 || buf.includes(0)) continue;
      const n = knownRealCount(buf.toString('utf8'));
      if (n) hits.push(`${rel} (${n})`);
    }
    expect(hits).toEqual([]);
  });
});
