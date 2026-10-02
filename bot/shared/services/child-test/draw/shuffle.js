'use strict';

/**
 * Child test — the seeded shuffle. One order per class per cycle:
 *
 *   seed   = HMAC-SHA256(CHILD_TEST_DRAW_SECRET, `${cycleId}|${classId}`)
 *   stream = SHA-256(seed || uint32be(0)), SHA-256(seed || uint32be(1)), ... read as uint32s
 *   order  = Fisher-Yates over the class's canonical list, j drawn uniformly by rejection sampling
 *
 * The secret stops anyone predicting the order; with it, anyone auditing can replay every rank.
 * Only SHA-256(seed) is stored (seed_digest), so the stored rows reveal neither secret nor seed.
 * Changing anything here changes every future order: bump ALGO_VERSION.
 */

const crypto = require('crypto');

const ALGO_VERSION = 'ctd-v1-hmac-sha256-fisher-yates';
const TWO_32 = 2 ** 32;

function seedFor(secret, cycleId, classId) {
  return crypto.createHmac('sha256', String(secret)).update(`${cycleId}|${classId}`).digest();
}

function seedDigest(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function stream(seed) {
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;
  return function nextUint32() {
    if (offset + 4 > block.length) {
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter++);
      block = crypto.createHash('sha256').update(Buffer.concat([seed, c])).digest();
      offset = 0;
    }
    const v = block.readUInt32BE(offset);
    offset += 4;
    return v;
  };
}

// Uniform integer in [0, n) without modulo bias.
function uniform(next, n) {
  const limit = Math.floor(TWO_32 / n) * n;
  let v;
  do { v = next(); } while (v >= limit);
  return v % n;
}

/** @returns {Array} a new array: `items` in the seed's order. `items` is not changed. */
function shuffle(items, seed) {
  const out = items.slice();
  const next = stream(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = uniform(next, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = { ALGO_VERSION, seedFor, seedDigest, shuffle };
