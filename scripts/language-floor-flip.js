#!/usr/bin/env node
/**
 * language-floor-flip — flip `preferred_language` from 'en' to 'ur' for NIETE teachers who
 * never chose a language.
 *
 *   node scripts/language-floor-flip.js --env staging              # dry run
 *   node scripts/language-floor-flip.js --env staging --live
 *   node scripts/language-floor-flip.js --env prod                 # dry run
 *   node scripts/language-floor-flip.js --env prod --live --yes
 *   node scripts/language-floor-flip.js --env prod --rollback <snapshot.json> --live
 *
 * WHY THIS IS A SCRIPT AND NOT A SQL UPDATE
 *
 * Three properties a raw `UPDATE` cannot give us:
 *
 *   1. The Redis cache. `user:language:{id}` and `user:language_locked:{id}` carry
 *      a 24-HOUR TTL. A SQL update invalidates neither, so teachers would keep
 *      being served English for up to a day — and raggedly, some flipped and some
 *      not. `setUserLanguage()` writes through to both keys. It is also the ONE
 *      WRITER the language protocol requires; a direct column write is the exact
 *      invariant violation that made a previous language fix a silent no-op.
 *   2. `isOffered()` validation, inside the writer.
 *   3. Per-row success/failure accounting, so a partial run is visible and
 *      resumable rather than assumed complete.
 *
 * WHAT MUST NOT HAPPEN
 *
 * `language_locked` is the ONLY thing distinguishing "she chose English" from "we
 * defaulted her to English". This migration therefore:
 *
 *   - touches ONLY rows with language_locked != true, and
 *   - passes lockLanguage = false EXPLICITLY (the writer defaults it to TRUE).
 *
 * If it set the lock, a backfilled 'ur' would be indistinguishable from a chosen
 * 'ur' forever, no future default change could move those rows, and rollback
 * would be impossible. That is the one irreversible mistake available here.
 *
 * SIDE EFFECT, ACCEPTED KNOWINGLY
 *
 * `setUserLanguage()` also writes `updated_at`. This run therefore bumps
 * `updated_at` on every affected row. Anything reading that column as "recent
 * teacher activity" will see a spike on the migration date.
 */
const fs = require('fs');
const path = require('path');

// ── pure logic (unit-tested; no I/O) ─────────────────────────────────────────
const TARGET_LANGUAGE = 'ur';
const FROM_LANGUAGE = 'en';

/**
 * Rows this migration may touch.
 *
 * `language_locked !== true` rather than `=== false` so that a NULL — which means
 * "never decided", same as false — is not silently skipped. Prod has zero nulls
 * today; the predicate does not depend on that staying true.
 *
 * Off-offer languages are deliberately excluded: invariant 7 says grandfather
 * them, never rewrite them. Only an exact `en` is in scope.
 */
function selectCandidates(rows) {
  return (rows || []).filter(
    (r) => r && r.id && r.language_locked !== true && r.preferred_language === FROM_LANGUAGE
  );
}

/** Abort before opening any connection if the env points at the wrong project. */
function assertProjectRef(supabaseUrl, expectedRef) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(supabaseUrl || ''));
  if (!m) {
    throw new Error(`ABORT: could not parse a project ref out of SUPABASE_URL (${supabaseUrl})`);
  }
  if (m[1] !== expectedRef) {
    throw new Error(
      `ABORT: SUPABASE_URL points at project '${m[1]}', which does not match the ` +
        `expected '${expectedRef}'. Refusing to write to an unintended database.`
    );
  }
  return m[1];
}

function planBatches(ids, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error('batch size must be an integer >= 1');
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** The pre-change state, so a rollback restores values rather than guessing them. */
function buildSnapshot(rows, env, iso) {
  return {
    migration: 'language-floor-flip',
    env,
    createdAt: iso,
    from: FROM_LANGUAGE,
    to: TARGET_LANGUAGE,
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      preferred_language: r.preferred_language,
      language_locked: r.language_locked === true,
    })),
  };
}

/**
 * Rows a rollback may revert.
 *
 * A teacher who CHOSE a language after the migration has language_locked = true.
 * Reverting her would overwrite an explicit human decision, so her lock excludes
 * her. Rows already back on the original value are no-ops.
 */
function selectRollbackTargets(snapshot, liveRows) {
  const live = new Map((liveRows || []).map((r) => [r.id, r]));
  return (snapshot.rows || [])
    .map((s) => ({ snap: s, now: live.get(s.id) }))
    .filter(
      ({ now }) => now && now.language_locked !== true && now.preferred_language === TARGET_LANGUAGE
    )
    .map(({ snap }) => ({ id: snap.id, restoreTo: snap.preferred_language }));
}

/** Counts that make an unexpected change visible rather than invisible. */
function summarise(rows) {
  const locked = rows.filter((r) => r.language_locked === true);
  return {
    total: rows.length,
    candidates: selectCandidates(rows).length,
    locked: locked.length,
    lockedEn: locked.filter((r) => r.preferred_language === 'en').length,
    lockedUr: locked.filter((r) => r.preferred_language === 'ur').length,
    unlockedOther: rows.filter(
      (r) => r.language_locked !== true && !['en', 'ur'].includes(r.preferred_language)
    ).length,
    nullLocked: rows.filter((r) => r.language_locked === null).length,
  };
}

/**
 * Apply one language change through the one writer.
 *
 * This exists as its own injectable function for ONE reason: the third argument.
 * `setUserLanguage(userId, languageCode, lockLanguage = true)` DEFAULTS THE LOCK
 * TO TRUE, so omitting it here would mark 9,000+ teachers as having personally
 * chosen Urdu. That erases "she chose" vs "we defaulted" permanently — no future
 * default change could move those rows and no rollback could tell them apart.
 *
 * It was verified by mutation that dropping the `false` left the entire suite
 * green, so the argument is now asserted directly rather than trusted.
 */
async function flipOne(writer, id, language) {
  return writer(id, language, false);
}

/**
 * Decide what to do about the cache, in exactly three states and no others.
 *
 * `redis.railway.internal` is on Railway's PRIVATE network. Verified 2026-08-19
 * that `railway run` injects the variables but does NOT join that network, so
 * from any machine outside Railway `REDIS_URL` reads as "present" while being
 * unreachable — the variable looks healthy and the connection is not.
 *
 * With Redis down, `redisService.set()` returns false SILENTLY and
 * `setUserLanguage()` does not check that return value, so it reports SUCCESS
 * while the cache is never written. Defaulting to "carry on" would therefore
 * produce a clean-looking run that quietly left teachers on the old language.
 *
 * Hence: refuse by default, and require an explicit opt-in that is recorded as a
 * DIFFERENT mode so a decayed run is never mistaken for a correct one.
 */
function resolveCacheStrategy({ redisReady, acceptDecay }) {
  if (redisReady) {
    // A healthy cache is always written through. The flag must not be able to
    // downgrade a correct run into a worse one.
    return { proceed: true, mode: 'write-through', reason: 'redis ready — cache written through' };
  }
  if (acceptDecay) {
    return {
      proceed: true,
      mode: 'decay',
      reason:
        'redis unreachable; --accept-cache-decay given. DB is authoritative; ' +
        'cached teachers keep the old language until their 24h entry expires.',
    };
  }
  return {
    proceed: false,
    mode: 'refused',
    reason:
      'redis unreachable and --accept-cache-decay NOT given. Refusing: the cache ' +
      'write would silently no-op. Pass --accept-cache-decay to proceed knowingly.',
  };
}

/**
 * How many teachers in scope could actually hold a stale entry.
 *
 * The cache is populated LAZILY ON READ (getUserLanguage sets it after a DB
 * miss), so only teachers whose language was read inside the TTL have an entry.
 * Exposure is therefore the INTERSECTION of the rows being changed with the
 * recently-active set — not the count of active teachers, and not the row count.
 *
 * Throws on an unknown active set: reporting "0 exposed" because we failed to
 * measure would be the most misleading output this script could produce.
 */
function computeExposure(candidates, recentlyActiveIds) {
  if (!Array.isArray(recentlyActiveIds)) {
    throw new Error('computeExposure: recently-active set is unknown — cannot claim zero exposure');
  }
  const active = new Set(recentlyActiveIds);
  return (candidates || []).filter((c) => active.has(c.id)).length;
}

module.exports = {
  selectCandidates,
  assertProjectRef,
  planBatches,
  buildSnapshot,
  selectRollbackTargets,
  summarise,
  flipOne,
  resolveCacheStrategy,
  computeExposure,
  TARGET_LANGUAGE,
  FROM_LANGUAGE,
};

// ── CLI ───────────────────────────────────────────────────────────────────────
/**
 * The CLI lives inside a function rather than behind a top-level
 * `if (require.main !== module) return;`.
 *
 * Node permits a top-level return inside the CommonJS module wrapper, but Babel —
 * which jest uses to transform this file when the unit tests require it — rejects
 * it as "'return' outside of function". The guard therefore parsed fine under
 * `node` and made the whole test suite unable to load the module.
 */
function main() {

  const ENVS = {
    staging: { file: '.env.staging', ref: 'rpqkekcfvumypldbejhp' },
    prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
  };

  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(`--${n}`);
  const val = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };

  const envName = val('env');
  const live = flag('live');
  const rollbackFile = val('rollback');
  const batchSize = parseInt(val('batch', '100'), 10);

  function die(msg) {
    console.error(`\n  ${msg}\n`);
    process.exit(2);
  }

  if (!envName || !ENVS[envName]) {
    die(`--env is REQUIRED and must be one of: ${Object.keys(ENVS).join(', ')}\n  (no default — an implicit prod target is how the wrong database gets written)`);
  }
  const target = ENVS[envName];

  // Load the chosen env file into process.env BEFORE requiring anything from the
  // bot: config/supabase.js reads process.env at require time and calls
  // dotenv.config(), which does NOT override already-set values.
  const envPath = path.resolve(__dirname, '..', target.file);
  if (!fs.existsSync(envPath)) die(`missing ${target.file} — cannot resolve credentials for '${envName}'`);
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }

  // Guard the target BEFORE any client is constructed.
  let ref;
  try {
    ref = assertProjectRef(process.env.SUPABASE_URL, target.ref);
  } catch (e) {
    die(e.message);
  }

  const acceptDecay = flag('accept-cache-decay');

  const supabase = require('../bot/shared/config/supabase');
  const { setUserLanguage } = require('../bot/shared/utils/language-cache');
  const redisService = require('../bot/shared/services/cache/railway-redis.service');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchAllUsers() {
    const out = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from('users')
        .select('id,preferred_language,language_locked')
        .range(from, from + page - 1);
      if (error) throw new Error(`fetch failed: ${error.message}`);
      out.push(...data);
      if (data.length < page) break;
    }
    return out;
  }

  /**
   * Prove Redis is actually reachable — not merely configured.
   *
   * This matters more than it looks. `redisService.set()` returns `false` SILENTLY
   * when the client is not in the `ready` state, and `setUserLanguage()` does not
   * check that return value — so with Redis unavailable the writer still reports
   * SUCCESS while the cache is never written. Every affected teacher would then keep
   * being served her old language from a 24-hour cache entry, and nothing in the
   * migration output would say so.
   *
   * ioredis also connects ASYNCHRONOUSLY, so a probe fired immediately after
   * require() fails against a perfectly healthy server. Wait for `ready` first —
   * that false negative aborted the first staging run.
   */
  async function probeRedis(timeoutMs = 15000) {
    if (!process.env.REDIS_URL) return { ready: false, detail: 'REDIS_URL not set' };
    const started = Date.now();
    while (!redisService.isAvailable()) {
      if (Date.now() - started > timeoutMs) {
        return { ready: false, detail: `never reached 'ready' within ${timeoutMs}ms (private network?)` };
      }
      await sleep(250);
    }
    const probe = `language-floor-flip:probe:${ref}`;
    const wrote = await redisService.set(probe, 'ok', 60);
    const got = await redisService.get(probe);
    if (wrote !== true || got !== 'ok') {
      return { ready: false, detail: `ready but round-trip failed (set=${wrote} get=${got})` };
    }
    return { ready: true, detail: `round-trip ok after ${Date.now() - started}ms` };
  }

  /** Teachers whose language was read inside the TTL — i.e. who hold a cache entry. */
  async function fetchRecentlyActiveIds(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const ids = new Set();
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from('conversations')
        .select('user_id')
        .gte('created_at', since)
        .range(from, from + page - 1);
      if (error) throw new Error(`activity query failed: ${error.message}`);
      for (const r of data) if (r.user_id) ids.add(r.user_id);
      if (data.length < page) break;
    }
    return [...ids];
  }

  async function applyLanguage(ids, language, labelFor) {
    const okIds = [];
    const failed = [];
    const batches = planBatches(ids, batchSize);
    for (let b = 0; b < batches.length; b += 1) {
      for (const id of batches[b]) {
        // lockLanguage = false EXPLICITLY. The writer defaults it to true, and a
        // lock here would permanently erase "chose" vs "defaulted".
        let ok = false;
        try {
          ok = await flipOne(setUserLanguage, id, language);
        } catch (e) {
          ok = false;
        }
        (ok ? okIds : failed).push(id);
      }
      const done = okIds.length + failed.length;
      process.stdout.write(
        `\r  ${labelFor} ${done}/${ids.length}  ok=${okIds.length} failed=${failed.length}   `
      );
      await sleep(120); // gentle on the DB and on Redis
    }
    process.stdout.write('\n');
    return { okIds, failed };
  }

  (async () => {
    console.log(`\n  language-floor-flip — env=${envName} project=${ref} mode=${live ? 'LIVE' : 'DRY RUN'}`);
    if (rollbackFile) console.log(`  ROLLBACK from ${rollbackFile}`);
    console.log();

    const rp = await probeRedis();
    const strat = resolveCacheStrategy({ redisReady: rp.ready, acceptDecay });
    console.log(`  redis: ${rp.ready ? 'READY' : 'UNREACHABLE'} — ${rp.detail}`);
    console.log(`  cache mode: ${strat.mode.toUpperCase()}`);
    console.log(`  ${strat.reason}`);
    if (!strat.proceed) die(`ABORT: ${strat.reason}`);

    const before = await fetchAllUsers();
    const s = summarise(before);
    console.log(`\n  users            ${s.total}`);
    console.log(`  candidates       ${s.candidates}   (unlocked + '${FROM_LANGUAGE}')`);
    console.log(`  locked           ${s.locked}   (${s.lockedUr} ur, ${s.lockedEn} en) — NEVER touched`);
    console.log(`  unlocked, other  ${s.unlockedOther}   (off-offer, grandfathered — NEVER touched)`);
    console.log(`  language_locked null ${s.nullLocked}`);

    // ── rollback path ──
    if (rollbackFile) {
      const snap = JSON.parse(fs.readFileSync(rollbackFile, 'utf8'));
      if (snap.env !== envName) die(`snapshot env '${snap.env}' != --env '${envName}'`);
      const targets = selectRollbackTargets(snap, before);
      const skipped = snap.rows.length - targets.length;
      console.log(`\n  snapshot rows ${snap.rows.length} -> revertable ${targets.length}, skipped ${skipped}`);
      console.log('  skipped = teacher chose a language since (locked), or already reverted');
      if (!live) {
        console.log('\n  DRY RUN — nothing written. Re-run with --live to revert.\n');
        process.exit(0);
      }
      const byLang = new Map();
      for (const t of targets) {
        if (!byLang.has(t.restoreTo)) byLang.set(t.restoreTo, []);
        byLang.get(t.restoreTo).push(t.id);
      }
      let failedAll = [];
      for (const [lang, ids] of byLang) {
        const r = await applyLanguage(ids, lang, `revert->${lang}`);
        failedAll = failedAll.concat(r.failed);
      }
      console.log(`\n  reverted with ${failedAll.length} failures\n`);
      process.exit(failedAll.length ? 1 : 0);
    }

    // ── forward path ──
    if (s.candidates === 0) {
      console.log('\n  Nothing to do — no unlocked English rows. (Idempotent: a second run is a no-op.)\n');
      process.exit(0);
    }

    const candidates = selectCandidates(before);

    // In decay mode, measure the ACTUAL exposure for this environment rather than
    // quoting a number from a previous investigation. Only teachers whose language
    // was read inside the TTL hold a cache entry, so exposure is the intersection
    // of the rows being changed with the recently-active set.
    let exposure = null;
    if (strat.mode === 'decay') {
      const activeIds = await fetchRecentlyActiveIds(24);
      exposure = computeExposure(candidates, activeIds);
      const pct = candidates.length ? ((exposure / candidates.length) * 100).toFixed(2) : '0.00';
      console.log(`\n  CACHE DECAY EXPOSURE (measured now, this environment)`);
      console.log(`    teachers active in last 24h        ${activeIds.length}`);
      console.log(`    of those, in scope for this flip    ${exposure}  (${pct}% of ${candidates.length})`);
      console.log(`    -> they keep '${FROM_LANGUAGE}' until their entry expires (<=24h), then '${TARGET_LANGUAGE}'`);
      console.log(`    -> the other ${candidates.length - exposure} have NO cache entry and change immediately`);
      console.log(`    -> no errors and no failed sends; this is a DELAYED improvement, not a regression`);
    }

    const iso = new Date().toISOString();
    const snapDir = path.resolve(__dirname, '..', '.migration-snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    const snapPath = path.join(snapDir, `language-floor-flip-${envName}-${iso.replace(/[:.]/g, '-')}.json`);
    const snapshot = buildSnapshot(candidates, envName, iso);
    snapshot.cacheMode = strat.mode;
    snapshot.cacheExposure = exposure;
    fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
    console.log(`\n  snapshot written: ${path.relative(process.cwd(), snapPath)}`);
    console.log(`  (rollback with: --env ${envName} --rollback '${path.relative(process.cwd(), snapPath)}' --live)`);

    if (!live) {
      console.log(`\n  DRY RUN — nothing written.`);
      console.log(`  Would set preferred_language='${TARGET_LANGUAGE}', language_locked=false on ${s.candidates} rows.`);
      console.log(`  Re-run with --live to apply.\n`);
      process.exit(0);
    }

    if (envName === 'prod' && !flag('yes')) {
      die(`Refusing to write to PROD without --yes. This would change ${s.candidates} real teachers.`);
    }

    const { okIds, failed } = await applyLanguage(
      candidates.map((r) => r.id),
      TARGET_LANGUAGE,
      'flip'
    );

    // ── verification against the DB, not against our own bookkeeping ──
    const after = await fetchAllUsers();
    const a = summarise(after);
    console.log('\n  VERIFY (re-read from the database)');
    console.log(`    remaining candidates   ${a.candidates}   expect 0 (plus any registered mid-run)`);
    console.log(`    locked total           ${a.locked}   expect ${s.locked} (unchanged)`);
    console.log(`    locked en / ur         ${a.lockedEn} / ${a.lockedUr}   expect ${s.lockedEn} / ${s.lockedUr}`);
    console.log(`    off-offer untouched    ${a.unlockedOther}   expect ${s.unlockedOther}`);
    console.log(`    applied ok / failed    ${okIds.length} / ${failed.length}`);

    const problems = [];
    if (a.locked !== s.locked) problems.push(`locked count moved ${s.locked} -> ${a.locked}`);
    if (a.lockedEn !== s.lockedEn) problems.push(`locked-en moved ${s.lockedEn} -> ${a.lockedEn}`);
    if (a.lockedUr !== s.lockedUr) problems.push(`locked-ur moved ${s.lockedUr} -> ${a.lockedUr}`);
    if (a.unlockedOther !== s.unlockedOther) problems.push('an off-offer row changed');
    if (failed.length) problems.push(`${failed.length} rows failed — re-run to resume (idempotent)`);

    if (problems.length) {
      console.error('\n  PROBLEMS:');
      for (const p of problems) console.error(`    - ${p}`);
      console.error('');
      process.exit(1);
    }
    console.log('\n  OK — flip complete, locked teachers untouched.\n');
    process.exit(0);
  })().catch((e) => {
    console.error(`\n  FAILED: ${e.message}\n`);
    process.exit(2);
  });
}

if (require.main === module) main();
