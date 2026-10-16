'use strict';
/**
 * More lines for the weekly health numbers (web-quiz-strip.js weeklyStrip): pure computations over the week's rows
 * plus their own reads. Counts only, never a child. Each line set reads on its own, so an unreadable input skips only
 * its lines (named in `skipped`) and every other line is written as before.
 *
 *   recognised_without_typing / <first|le7|gt7>
 *       Children (distinct canonical id, else student id) with a scored check run in the week, bucketed by the days
 *       from their previous run of any mode (any status) to their latest scored check run of the week: ≤ 7 → le7,
 *       > 7 → gt7, none → first. value = the bucket's children whose latest scored check run was recognised without
 *       typing (id_src roster_pick, remembered, hub_chip or phone_bound); n = the bucket's children.
 *       Bound: the earlier run is looked for in the week's own rows, then in the LOOKBACK_DAYS (35) before the week,
 *       for the week's children only, in chunks of at most CHUNK (200) ids. A child whose last run is older than
 *       that is counted as first.
 *   kept_audio_all
 *       The kept readings when every reading is kept (web_quiz_challenge_keep_audio): of the scored check and practice
 *       readings created in the last 90 days that had a recording, those whose row still names a kept object
 *       (meta.audio_key). A reading had a recording when the finish wrote its audio trace, which happens only after
 *       the upload was found in the store (web-quiz-challenge.js finish: meta.audio_key for a kept key, else
 *       meta.audio_kept = false with the switch on), or the purge has since cleared the key (meta.audio_purged_on).
 *       With the switch off a reading leaves no trace, so this line counts the readings made with it on.
 */
const supabase = require('../../config/supabase');

const TABLE = 'web_quiz_challenge_runs';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 200;
const LOOKBACK_DAYS = 35;
const KEPT_DAYS = 90;
const RECOGNISED = new Set(['roster_pick', 'remembered', 'hub_chip', 'phone_bound']);
const BUCKETS = ['first', 'le7', 'gt7'];

const childOf = (r) => r.canonical_id || r.student_id || null;

/** The bucket of a gap in days (null: no earlier run). Pure. */
const bucketOf = (days) => (days == null ? 'first' : (days <= 7 ? 'le7' : 'gt7'));

/**
 * The recognised-without-typing counts per bucket from the week's rows and the earlier runs (any rows, any mode,
 * created before the week). Pure. Returns Map(bucket → { value, n }).
 */
function recognisedBuckets(weekRows, earlierRows) {
  const latest = new Map();
  for (const r of weekRows) {
    if (r.mode !== 'check' || r.status !== 'scored') continue;
    const k = childOf(r);
    if (!k) continue;
    const cur = latest.get(k);
    if (!cur || String(r.created_at) > String(cur.created_at)) latest.set(k, r);
  }
  const prev = new Map();
  for (const r of [...weekRows, ...earlierRows]) {
    const k = childOf(r);
    const last = k && latest.get(k);
    if (!last || r.id === last.id || !(String(r.created_at) < String(last.created_at))) continue;
    if (!prev.has(k) || String(r.created_at) > prev.get(k)) prev.set(k, String(r.created_at));
  }
  const out = new Map(BUCKETS.map((b) => [b, { value: 0, n: 0 }]));
  for (const [k, r] of latest) {
    const p = prev.get(k);
    const b = out.get(bucketOf(p ? (Date.parse(r.created_at) - Date.parse(p)) / DAY_MS : null));
    b.n += 1;
    if (RECOGNISED.has(r.id_src)) b.value += 1;
  }
  return out;
}

/** The week's children's runs in the look-back before the week: { rows } or { error }. */
async function earlierRuns(children, start, allRows) {
  const from = new Date(Date.parse(start) - LOOKBACK_DAYS * DAY_MS).toISOString();
  const ids = [...children];
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (const col of ['canonical_id', 'student_id']) {
      const got = await allRows(() => supabase.from(TABLE).select('id, student_id, canonical_id, created_at')
        .in(col, chunk).gte('created_at', from).lt('created_at', start), 'earlier_runs');
      if (got.error) return { error: got.error };
      rows.push(...got.rows);
    }
  }
  return { rows };
}

async function recognisedLines({ rows, start, put, skipped, allRows }) {
  const children = new Set(rows.filter((r) => r.mode === 'check' && r.status === 'scored').map(childOf).filter(Boolean));
  const earlier = children.size ? await earlierRuns(children, start, allRows) : { rows: [] };
  if (earlier.error) { skipped.push('recognised_without_typing'); return; }
  for (const [b, c] of recognisedBuckets(rows, earlier.rows)) put('recognised_without_typing', b, c.value, c.n);
}

/** Of readings with a recording, those naming a kept object. Pure. */
function keptAll(readings) {
  const had = readings.filter((r) => {
    const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
    return m.audio_key != null || m.audio_kept === false || m.audio_purged_on != null;
  });
  return { value: had.filter((r) => r.meta.audio_key != null).length, n: had.length };
}

async function keptAllLine({ now, put, skipped, allRows }) {
  const from = new Date(now - KEPT_DAYS * DAY_MS).toISOString();
  const got = await allRows(() => supabase.from(TABLE).select('id, created_at, mode, meta')
    .eq('exercise', 'read').eq('status', 'scored').in('mode', ['check', 'practice']).gte('created_at', from), 'kept_all');
  if (got.error) { skipped.push('kept_audio_all'); return; }
  const k = keptAll(got.rows);
  put('kept_audio_all', '', k.value, k.n);
}

/** Every line set above, each on its own reads. `allRows` is the strip's pager (web-quiz-strip.js). */
async function moreLines(ctx) {
  await recognisedLines(ctx);
  await keptAllLine(ctx);
}

module.exports = { moreLines, recognisedBuckets, keptAll, bucketOf, RECOGNISED, CHUNK, LOOKBACK_DAYS };
