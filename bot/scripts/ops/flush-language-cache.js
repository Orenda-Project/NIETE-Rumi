#!/usr/bin/env node
/**
 * One-shot flush of the cached language preferences. Step 1.8 of the language
 * unification.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * Hardening the writer fixes every FUTURE write: it now invalidates both Redis
 * keys as it stores. But it cannot retroactively fix what is already cached.
 * Values written by the OLD Settings path went straight to Postgres and never
 * touched Redis, so for up to the 24-hour TTL a read still returns the stale
 * language. Without this flush, the first day after cutover serves the old
 * language to exactly the teachers whose preference we just fixed — which reads
 * as "the fix did not work" rather than "the cache has not expired yet".
 *
 * WHY IT IS SAFE
 *
 * Postgres is the source of truth. These keys are a read-through cache: deleting
 * one costs a single DB round-trip on the next read, which then repopulates it.
 * No teacher data is written, changed or lost. Running it twice is a no-op.
 *
 * WHY SCAN AND NOT KEYS
 *
 * KEYS is O(n) over the whole keyspace and blocks the server for the duration —
 * on a shared instance also carrying sessions, rate limits and webhook dedup
 * markers, that is a latency spike for live traffic. SCAN is cursor-based and
 * yields between batches. UNLINK reclaims memory on a background thread where
 * available, so a large batch does not stall the event loop either.
 *
 *   node bot/scripts/ops/flush-language-cache.js --dry-run   # count only
 *   node bot/scripts/ops/flush-language-cache.js             # delete
 *
 * Run from the repo root: dotenv resolves relative to the working directory, so
 * invoking it from inside bot/ silently finds no REDIS_URL.
 */

require('dotenv').config();

/**
 * The only keys this script may touch, both written by language-cache.js.
 *
 * Deliberately narrow and asserted in tests/cache/flush-language-cache.test.js:
 * this Redis also holds `session:*`, `ratelimit:*`, `dedup:*` and `lock:*`, so a
 * broader glob — or a reach for the service's flushAll() — would clear live
 * traffic state and present as an unrelated outage.
 */
const PATTERNS = ['user:language:*', 'user:language_locked:*'];

const SCAN_BATCH = 500;

async function flushPattern(client, pattern, { dryRun }) {
  let scanned = 0;
  let deleted = 0;
  let cursor = '0';

  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH);
    cursor = next;
    scanned += keys.length;

    if (keys.length && !dryRun) {
      // UNLINK frees memory off the main thread; not every Redis build has it.
      try {
        deleted += await client.unlink(...keys);
      } catch {
        deleted += await client.del(...keys);
      }
    }
  } while (cursor !== '0');

  return { scanned, deleted };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set. Run from the repo root so dotenv finds .env.');
    process.exit(1);
  }

  // Name the target before touching it. The staging and production instances are
  // different hosts and the only visible difference is this string, so an
  // operator running the wrong one should be able to see that in the output.
  console.log(`Redis: ${process.env.REDIS_URL.replace(/:[^:@]*@/, ':***@')}`);
  console.log(dryRun ? 'Mode:  DRY RUN — counting only\n' : 'Mode:  DELETE\n');

  const redisService = require('../../shared/services/cache/railway-redis.service');
  const client = redisService.redis;

  if (!client) {
    console.error('Redis service is disabled (no client). Nothing to do.');
    process.exit(1);
  }

  let totalScanned = 0;
  let totalDeleted = 0;

  try {
    for (const pattern of PATTERNS) {
      const { scanned, deleted } = await flushPattern(client, pattern, { dryRun });
      totalScanned += scanned;
      totalDeleted += deleted;
      console.log(`  ${pattern.padEnd(28)} found ${String(scanned).padStart(6)}  deleted ${String(deleted).padStart(6)}`);
    }

    console.log(`\nTotal: found ${totalScanned}, deleted ${totalDeleted}`);
    if (dryRun && totalScanned > 0) {
      console.log('Dry run — re-run without --dry-run to delete.');
    }
    if (!dryRun) {
      console.log('Reads repopulate from Postgres on next access. Safe to re-run.');
    }
  } finally {
    await redisService.close();
  }
}

// Only run when invoked directly, so the test can require the patterns without
// opening a Redis connection.
if (require.main === module) {
  main().catch((err) => {
    console.error('Flush failed:', err.message);
    process.exit(1);
  });
}

module.exports = { PATTERNS, flushPattern };
