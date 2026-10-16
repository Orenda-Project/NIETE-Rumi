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
 *   sent / capped
 *       From message_ledger over the week's PKT days: value = Σ capped (replies the per-phone daily cap refused),
 *       n = Σ count (the sends, as the ledger counts them: one per reply that went out; count/usd never include a
 *       refusal). The red signal is any value > 0: it is looked at, beside reply_cap_hits. The ledger names no child, so
 *       no test child can be left out here (the same as the sends lines). The writer (message-ledger.js countCapped)
 *       reads the day's row then updates it, so two refusals in the same instant can lose one increment: this line
 *       can only undercount, never overcount.
 *   bind_funnel / codes, bind_funnel / bound
 *       Identity (b) on codes: the save codes minted in the week (child_bind_codes.minted_at), a test child's codes
 *       left out (web-quiz-fixture.js, on the code's child). codes: value = those used (used_at set, any outcome,
 *       as of the run); bound: value = those whose binding (child_phone_bindings.code_id) is active at the week's
 *       cut (bound before it, not revoked before it, not expired by it: the replies-per-bound-child rule). n = the
 *       codes minted on both: the denominator is codes, never events. A binding made before code_id was written
 *       names no code, and a renewal moves code_id to the renewing code, so `bound` can undercount a code whose
 *       binding was later renewed by another.
 *   implausible / <lang>, implausible / <lang>|<reason>
 *       The quality floor's watch line: of the week's scored check reads (exercise 'read', mode 'check', status
 *       'scored', any record: a marked row has its record cleared, so keying on record would leave every one out),
 *       test children left out (web-quiz-fixture.js), those the scorer marked meta.quality = 'implausible'; n = those
 *       reads, per language. Per reason (meta.flags, in the scorer's order: no_speech, low_stt_support,
 *       no_aligned_words, low_story_confidence; a row with several counts under each), every reason printed for a
 *       language, 0 included; `not_given` only when a marked row names none. Red above 5 % in a language.
 *   cold_clips (not measured: no store)
 *       The clip warm's last run (missing_listen / missing_story) is an event and a log line only: no table holds it,
 *       so the strip cannot read it. No row is written; the line is named in `skipped` with its note, every week.
 */
const supabase = require('../../config/supabase');
const { fixtureStudentIds, isFixtureRow } = require('./web-quiz-fixture');

const TABLE = 'web_quiz_challenge_runs';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 200;
const LOOKBACK_DAYS = 35;
const KEPT_DAYS = 90;
const PAGE = 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const LEDGER_ORDER = ['day', 'trigger', 'class_id', 'initiated', 'recipient'];   // the ledger's unique key: a stable order
const REASONS = ['no_speech', 'low_stt_support', 'no_aligned_words', 'low_story_confidence'];
const READ_COLS = 'id, student_id, canonical_id, class_id, lang, meta, created_at';
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

const pktDay = (iso) => new Date(Date.parse(iso) + PKT_MS).toISOString().slice(0, 10);

/** Every row of a query by offset, a page at a time, in the given stable order: { rows } or { error }; never throws. */
async function rangedRows(build, order) {
  const rows = [];
  try {
    for (let from = 0; ; from += PAGE) {
      let q = build();
      for (const c of order) q = q.order(c, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return { error };
      rows.push(...(data || []));
      if (!data || data.length < PAGE) return { rows };
    }
  } catch (err) {
    return { error: err };
  }
}

/** Σ capped over Σ count. Pure. */
function sentCapped(ledgerRows) {
  let value = 0; let n = 0;
  for (const r of ledgerRows) { value += Number(r.capped) || 0; n += Number(r.count) || 0; }
  return { value, n };
}

async function sentCappedLine({ start, end, put, skipped }) {
  const got = await rangedRows(() => supabase.from('message_ledger').select('day, trigger, class_id, initiated, recipient, count, capped')
    .gte('day', pktDay(start)).lt('day', pktDay(end)), LEDGER_ORDER);
  if (got.error) { skipped.push('sent'); return; }
  const c = sentCapped(got.rows);
  put('sent', 'capped', c.value, c.n);
}

/** A binding active at the cut (bound before it, not revoked before it, not expired by it). Pure. */
const activeAt = (r, cut) => Date.parse(r.bound_at) < cut && (r.revoked_at == null || Date.parse(r.revoked_at) >= cut)
  && Date.parse(r.expires_at) > cut;

async function bindFunnelLines({ start, end, put, skipped, notes, allRows }) {
  const got = await allRows(() => supabase.from('child_bind_codes').select('code, canonical_id, minted_at, used_at')
    .gte('minted_at', start).lt('minted_at', end), 'bind_codes', 'minted_at', (r) => r.code);
  if (got.error) { skipped.push('bind_funnel'); return; }
  const fixtures = await fixtureStudentIds({ ids: [...new Set(got.rows.map((r) => r.canonical_id).filter(Boolean))] });
  if (fixtures.unreadable.length) notes.bind_funnel = `${fixtures.unreadable.join(', ')} unreadable: the rules reading it left nothing out`;
  const codes = got.rows.filter((r) => !fixtures.has(r.canonical_id));
  put('bind_funnel', 'codes', codes.filter((r) => r.used_at != null).length, codes.length);

  const used = codes.filter((r) => r.used_at != null).map((r) => r.code);
  const made = new Set();
  const cut = Date.parse(end);
  for (let i = 0; i < used.length; i += CHUNK) {
    const b = await allRows(() => supabase.from('child_phone_bindings').select('id, code_id, bound_at, expires_at, revoked_at')
      .in('code_id', used.slice(i, i + CHUNK)), 'bind_codes_bound', 'bound_at');
    if (b.error) { skipped.push('bind_funnel_bound'); return; }
    b.rows.filter((r) => activeAt(r, cut)).forEach((r) => made.add(r.code_id));
  }
  put('bind_funnel', 'bound', made.size, codes.length);
}

const isImplausible = (r) => !!(r.meta && typeof r.meta === 'object' && r.meta.quality === 'implausible');

/** Per language: { n, value, reasons: Map(reason → count) } over scored check reads. Pure. */
function implausibleByLang(reads) {
  const out = new Map();
  for (const r of reads) {
    const lang = r.lang || 'unknown';
    if (!out.has(lang)) out.set(lang, { n: 0, value: 0, reasons: new Map([...REASONS, 'not_given'].map((k) => [k, 0])) });
    const c = out.get(lang);
    c.n += 1;
    if (!isImplausible(r)) continue;
    c.value += 1;
    const flags = Array.isArray(r.meta.flags) ? r.meta.flags : [];
    const named = REASONS.filter((k) => flags.includes(k));
    (named.length ? named : ['not_given']).forEach((k) => c.reasons.set(k, c.reasons.get(k) + 1));
  }
  return out;
}

async function implausibleLines({ start, end, put, skipped, notes, allRows }) {
  const got = await allRows(() => supabase.from(TABLE).select(READ_COLS)
    .eq('exercise', 'read').eq('mode', 'check').eq('status', 'scored').gte('created_at', start).lt('created_at', end), 'implausible');
  if (got.error) { skipped.push('implausible'); return; }
  const fixtures = await fixtureStudentIds({ ids: [], rows: got.rows });
  if (fixtures.unreadable.length) notes.implausible = `${fixtures.unreadable.join(', ')} unreadable: the rules reading it left nothing out`;
  const byLang = implausibleByLang(got.rows.filter((r) => !isFixtureRow(r, fixtures)));
  for (const [lang, c] of [...byLang].sort(([a], [b]) => a.localeCompare(b))) {
    put('implausible', lang, c.value, c.n);
    for (const [k, v] of c.reasons) if (k !== 'not_given' || v > 0) put('implausible', `${lang}|${k}`, v, c.n);
  }
}

const COLD_CLIPS_NOTE = 'not measured: no store (the clip warm run is an event and a log line only; no table holds missing_listen / missing_story)';

/** Cold clips at the last warm: nothing the strip can read, so it is named, never guessed. */
function coldClipsLine({ skipped, notes }) {
  skipped.push('cold_clips');
  notes.cold_clips = COLD_CLIPS_NOTE;
}

/** Every line set above, each on its own reads. `allRows` is the strip's pager (web-quiz-strip.js). */
async function moreLines(ctx) {
  await recognisedLines(ctx);
  await keptAllLine(ctx);
  await sentCappedLine(ctx);
  await bindFunnelLines(ctx);
  await implausibleLines(ctx);
  coldClipsLine(ctx);
}

module.exports = {
  moreLines, recognisedBuckets, keptAll, sentCapped, activeAt, implausibleByLang, bucketOf, RECOGNISED, REASONS, COLD_CLIPS_NOTE, CHUNK, LOOKBACK_DAYS,
};
