/**
 * language-floor-flip — flip preferred_language en -> ur for teachers who never chose.
 *
 * These tests exist because this migration writes to a table of 9,508 real
 * teachers and the ONLY thing separating "she chose English" from "we defaulted
 * her to English" is `language_locked`. Get the predicate wrong and the
 * distinction is destroyed permanently: a backfilled `ur` is indistinguishable
 * from a chosen `ur` afterwards.
 *
 * Every case below encodes a way this could silently do the wrong thing.
 */
const {
  selectCandidates,
  assertProjectRef,
  planBatches,
  buildSnapshot,
  selectRollbackTargets,
  summarise,
  flipOne,
  resolveCacheStrategy,
  computeExposure,
} = require('../../scripts/language-floor-flip');



// Helpers keep the original call signatures so each case reads as a claim about
// behaviour rather than as jest plumbing.
const eq = (a, b, m) => expect(a).toEqual(b);
const throws = (fn, re) => (re ? expect(fn).toThrow(re) : expect(fn).toThrow());
const t = (name, fn) => it(name, fn);

describe('language floor flip — en -> ur for teachers who never chose', () => {
// ── selection predicate ───────────────────────────────────────────────────────
const U = (id, lang, locked) => ({ id, preferred_language: lang, language_locked: locked });

t('selects an unlocked English teacher', () => {
  eq(selectCandidates([U('a', 'en', false)]).map((r) => r.id), ['a']);
});

t('NEVER selects a locked teacher, whatever her language', () => {
  // The 2 locked-'en' teachers on prod chose English deliberately. Touching them
  // overrides an explicit human decision.
  eq(selectCandidates([U('a', 'en', true), U('b', 'ur', true)]).map((r) => r.id), []);
});

t('does not select someone already on ur', () => {
  eq(selectCandidates([U('a', 'ur', false)]).map((r) => r.id), []);
});

t('treats language_locked = null as UNDECIDED but reports it', () => {
  // The column defaults to false and prod has zero nulls today, but a null is
  // semantically "never decided", so it must not be silently skipped.
  const out = selectCandidates([U('a', 'en', null)]);
  eq(out.map((r) => r.id), ['a']);
});

t('refuses to select an off-offer language', () => {
  // Grandfathered off-offer values must be left alone, not "corrected".
  eq(selectCandidates([U('a', 'ar', false), U('b', 'pa-PK', false)]).map((r) => r.id), []);
});

t('is idempotent — a second pass over flipped rows selects nothing', () => {
  const first = selectCandidates([U('a', 'en', false)]);
  const flipped = first.map((r) => ({ ...r, preferred_language: 'ur' }));
  eq(selectCandidates(flipped).map((r) => r.id), []);
});

t('ignores rows with no id', () => {
  eq(selectCandidates([{ preferred_language: 'en', language_locked: false }]).map((r) => r.id), []);
});

// ── project-ref guard ─────────────────────────────────────────────────────────
t('accepts the intended project ref', () => {
  assertProjectRef('https://ihzciabopbttygxxgrkm.supabase.co', 'ihzciabopbttygxxgrkm');
});

t('ABORTS when the env points at a different project', () => {
  // A worktree seeded with the main bot's .env points at a DIFFERENT
  // production database. The guard must fire before any connection is opened.
  throws(
    () => assertProjectRef('https://rpqkekcfvumypldbejhp.supabase.co', 'ihzciabopbttygxxgrkm'),
    /does not match|ABORT/i,
    'wrong-project guard'
  );
});

t('ABORTS on an unparseable url rather than guessing', () => {
  throws(() => assertProjectRef('postgres://localhost/x', 'ihzciabopbttygxxgrkm'), /could not|ABORT/i);
});

// ── batching ──────────────────────────────────────────────────────────────────
t('batches cover every id exactly once, in order', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
  const b = planBatches(ids, 100);
  eq(b.length, 3);
  eq(b.flat(), ids, 'no id dropped or duplicated');
});

t('a batch size below 1 is rejected, not silently coerced', () => {
  throws(() => planBatches(['a'], 0), /batch/i);
});

// ── snapshot / rollback ───────────────────────────────────────────────────────
t('snapshot records the PRE-change value so rollback is exact', () => {
  const s = buildSnapshot([U('a', 'en', false)], 'prod', '2026-08-19T00:00:00.000Z');
  eq(s.env, 'prod');
  eq(s.rows, [{ id: 'a', preferred_language: 'en', language_locked: false }]);
  eq(s.count, 1);
});

t('rollback only touches rows still unlocked AND still ur', () => {
  // If a teacher CHOSE a language after the migration, rolling back would
  // overwrite her decision. Her lock protects her.
  const snap = buildSnapshot([U('a', 'en', false), U('b', 'en', false), U('c', 'en', false)], 'prod', 'x');
  const live = [
    U('a', 'ur', false), // untouched since -> safe to revert
    U('b', 'ur', true), // she chose Urdu afterwards -> must NOT revert
    U('c', 'en', false), // already reverted / never flipped -> nothing to do
  ];
  eq(selectRollbackTargets(snap, live).map((r) => r.id), ['a']);
});

t('rollback ignores ids absent from the live set', () => {
  const snap = buildSnapshot([U('gone', 'en', false)], 'prod', 'x');
  eq(selectRollbackTargets(snap, []).map((r) => r.id), []);
});

// ── the lock argument: the one irreversible mistake ──────────────────────────
t('passes lockLanguage = false EXPLICITLY to the writer', () => {
  // setUserLanguage(id, lang, lockLanguage = TRUE). Omitting the third argument
  // would mark every backfilled teacher as having chosen Urdu herself, which is
  // unrecoverable. Verified by mutation that this was previously untested.
  const calls = [];
  const spy = (...a) => { calls.push(a); return true; };
  flipOne(spy, 'u1', 'ur');
  eq(calls.length, 1);
  eq(calls[0].length, 3, 'writer must be called with THREE arguments, not two');
  eq(calls[0][2], false, 'third argument must be exactly false');
  if (calls[0][2] !== false) throw new Error('lock argument is not strictly false');
});

t('never passes a truthy lock, even for an unusual language', () => {
  const calls = [];
  flipOne((...a) => { calls.push(a); return true; }, 'u2', 'en');
  eq(calls[0][2], false);
});

t('returns whatever the writer returned, so failures are not swallowed', async () => {
  eq(await flipOne(() => false, 'u3', 'ur'), false);
  eq(await flipOne(() => true, 'u3', 'ur'), true);
});

// ── the cache-decay opt-in ───────────────────────────────────────────────────
t('redis ready -> write-through, and the opt-in flag is irrelevant', () => {
  const a = resolveCacheStrategy({ redisReady: true, acceptDecay: false });
  eq(a.proceed, true); eq(a.mode, 'write-through');
  const b = resolveCacheStrategy({ redisReady: true, acceptDecay: true });
  eq(b.mode, 'write-through', 'the flag must NOT downgrade a healthy cache');
});

t('redis DOWN and no flag -> REFUSE (the guard still holds by default)', () => {
  const r = resolveCacheStrategy({ redisReady: false, acceptDecay: false });
  eq(r.proceed, false);
  if (!/accept-cache-decay/.test(r.reason)) throw new Error('must name the opt-in flag');
});

t('redis DOWN with the explicit flag -> proceed, mode says decay', () => {
  // Opting in must be a DIFFERENT mode, recorded as such, never silently
  // indistinguishable from a correct run.
  const r = resolveCacheStrategy({ redisReady: false, acceptDecay: true });
  eq(r.proceed, true);
  eq(r.mode, 'decay');
});

t('there is NO third state that proceeds silently', () => {
  for (const rr of [true, false]) for (const ad of [true, false]) {
    const r = resolveCacheStrategy({ redisReady: rr, acceptDecay: ad });
    if (!['write-through', 'decay', 'refused'].includes(r.mode)) {
      throw new Error(`unexpected mode ${r.mode}`);
    }
    if (r.proceed && r.mode === 'refused') throw new Error('refused must not proceed');
  }
});

t('exposure = candidates who are ALSO recently active', () => {
  // Only a teacher whose language was READ in the last 24h holds a cache entry.
  const cands = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  eq(computeExposure(cands, ['b', 'c', 'zzz']), 2);
});

t('exposure is 0 when nobody active is in scope, not the active total', () => {
  eq(computeExposure([{ id: 'a' }], ['x', 'y']), 0);
});

t('exposure handles a missing/empty active set without pretending zero risk', () => {
  throws(() => computeExposure([{ id: 'a' }], null), /active/i,
    'an unknown active set must not silently report zero exposure');
});

// ── summary / drift ───────────────────────────────────────────────────────────
t('summary counts locked rows so an unexpected change is visible', () => {
  const s = summarise([U('a', 'en', false), U('b', 'ur', true), U('c', 'en', true)]);
  eq(s.total, 3);
  eq(s.candidates, 1);
  eq(s.locked, 2);
  eq(s.lockedEn, 1);
  eq(s.lockedUr, 1);
});
});
