'use strict';
/**
 * The weekly health numbers of the web quiz Challenge: the lines computable from the tables, one row each in
 * web_quiz_strip_weekly(week, line, cell, value, n) so the trend outlives the event store's retention. Counts and
 * shares only, never a child. Read-side: run on Mondays by the daily job under web_quiz_challenge_sweeper
 * (web-quiz-challenge-sweeper.js), for the ISO week (PKT) just ended. Writing a week again replaces its rows.
 *
 * A cell is fixed grade band × language (× exercise / ladder / anchor block where the line says). Only 'check' rows
 * enter a cell: a practice or class-round row never does. The lines (line / cell):
 *   plays / <mode|legacy>                   scored runs, by mode ('legacy' = a row written before the mode column)
 *   provenance_incomplete                   v2 rows (mode set) with any provenance column empty; n = v2 rows
 *   roster_bound_pct                        of children with a scored check run, the share on a class (class_id)
 *   helped_pct / band|lang|exercise         scored check rows answered 'helped'
 *   lost_readings / band|lang               failed (swept included) ÷ ATTEMPTED (scored + failed) check readings
 *   lost_readings_swept / band|lang         the swept part of the same numerator, same denominator
 *   lost_readings_draw / b<draw band>|lang  lost readings by the draw band, beside the fixed band
 *   b3_bottom_share / band|lang             attempted check readings by children on reading rung ≤ 1 at serve
 *                                           (child_rungs; a child with no reading lamp yet is on the bottom)
 *   cells_n30 / band|lang|ladder            this month's CHILDREN (distinct canonical id) with a usable check row:
 *                                           scored, self, high confidence, record, first exposure or an anchor row
 *   anchor_retest_gap / band|lang|ladder|block  (returners' mean − first-timers' mean) ÷ pooled SD of score.correct, month
 *                                           to date (period_id of the week's Monday), self-run, high confidence,
 *                                           finished blocks (score.reached, else score.n, ≥ 10) only
 *                                           High confidence on these two is PROVEN from the student row (on a roster
 *                                           list, or merged into a roster row; web-quiz-provenance.js provenHigh),
 *                                           not read from id_confidence: a hub-route row is written 'high' even for
 *                                           a child on no list. Unreadable `students` proves nothing (no cell counts)
 *   provenance_drift / high_unproven        the week's v2 rows (id_src set) written 'high' whose child is on no list
 *                                           and not merged; n = those v2 rows. Should read 0
 *   provenance_drift / homonym_missed       the week's v2 rows written homonym_in_list = false whose child's list holds
 *                                           ANOTHER active child with the same canonical first name (canonFirst, the
 *                                           page's rule); n = the same v2 rows. Should read 0
 *   no_class_first_finishes                 scored first exposures with no class
 *   classes_link_eligible                   D5's denominator (a state, not a week): active classes with an active
 *                                           class_teachers row and an active class_enrollments row, the class-link
 *                                           mint's own rule (web-quiz-class-link.js teachesEnrolled); n = active classes
 *   kept_audio_keys                         value = runs naming a kept reading; n = kept_ok runs inside their 90 days
 *   kept_audio_match                        1 when the two are equal, else 0
 *   kept_audio_oldest_d                     days since the oldest kept reading was scored (reported only: the
 *                                           operator keeps every kept reading for now, so age is no red line)
 *   sends / <trigger>, sends_total, sends_usd, bot_to_family, door_mix_numerator   from message_ledger
 *                                           (LINE_NOTES.sends: the switched replies only, not the bill)
 *   replies_per_bound_child                 (home_reply + bind_reply sends) ÷ children (distinct canonical id) with a
 *                                           phone binding active at the week's cut (child_phone_bindings: bound
 *                                           before it, not erased before it, not expired by it); n = those children
 *   reply_cap_phones / <bin>                phone-days of the week by replies counted that PKT day: 1, 2, 3-4, 5-8
 *                                           (9+ only when the cap is above 8) and capped (> the cap); n = phone-days
 *   reply_cap_hits                          phone-days over the cap (the red line: > 0 is investigated); n = phone-days
 *   reply_cap_days_covered                  the week's PKT days the two lines above cover; n = 7
 *   teacher_accepted_share / <tier>         the teacher-accepted share of the join queue's tier (its Wilson 95% lower
 *                                           bound; a teacher's tap is a judgement, not a label, so never "precision")
 *   teacher_accepted_held / <tier>          1 when the tier is auto-held on that share, else 0
 *   record_duplicates                       runs created in the week with meta.record_lost = 'duplicate' (a second
 *                                           record of the stop this period, stored as practice); n = the attempts at
 *                                           a record: the week's record rows plus those duplicates (above 0 every
 *                                           week is a double-open in the page, not a race)
 *   lamps_settled_unanswered                Reading lamps the daily settle lit in the week without answers: the sum
 *                                           of the week's `lamps_settled_day / <PKT day>` rows (settledSnapshot,
 *                                           value = settled, n = checked); n = the week's scored record readings.
 *                                           The settle runs only with the rung switch on: a week with it off has
 *                                           no daily rows (value 0)
 * A table that is not there yet (child_rungs, message_ledger, child_phone_bindings, students) skips its lines, logged.
 *
 * The reply cap counts in Redis, `wq:reply_cap:<PKT day>:<hash>` = the day's replies for one phone, 24-h TTL from
 * the day's first reply. Counts only: the keys never leave the Redis service (scanValues), and nothing here writes or
 * logs a key or a hash. Because the counters expire, the daily job keeps yesterday's histogram (replyCapSnapshot →
 * `reply_cap_day / <day>|<bin>`, n = phone-days) and the weekly run sums those, reading Redis live only for a day
 * whose counters can still be there (yesterday). The cap is app_settings `web_quiz_reply_cap_per_phone` (default 8).
 * The accepted share comes from the join queue (web-quiz-join-queue.js precisionByTier(), when present).
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { loadStudents, provenHigh, driftCounts } = require('./web-quiz-provenance');

const TABLE = 'web_quiz_challenge_runs';
const STRIP_TABLE = 'web_quiz_strip_weekly';
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
// The caveat a reader of a line must see beside it (returned with the week's result as `notes`).
const LINE_NOTES = {
  sends: "message_ledger counts the switched replies only; it is not the bill (Meta's billable count is the cost total)",
};
const WEEK_RX = /^(\d{4})-W(\d{2})$/;
const COLS = 'id, student_id, canonical_id, exercise, grade, lang, status, created_at, scored_at, meta, score, mode, form, band, record, '
  + 'class_id, helped, exposure_no, bank_version, period_id, id_src, id_confidence, homonym_in_list, anchor_exposure_no, anchor_block, audio_consent, audio_keep_until';
const PROVENANCE = ['bank_version', 'form', 'period_id', 'exposure_no', 'band', 'canonical_id', 'id_src', 'id_confidence', 'homonym_in_list', 'helped', 'record'];
const CAP_KEY = 'web_quiz_reply_cap_per_phone';
const CAP_DEFAULT = 8;
const CAP_PREFIX = 'wq:reply_cap:';
const CAP_BINS = ['1', '2', '3-4', '5-8', 'capped'];
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));

/** The ISO week (PKT) of an instant, e.g. 2026-W42. */
function isoWeekOf(ms) {
  const d = new Date(ms + PKT_MS);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);             // the week's Thursday decides its year
  const y = day.getUTCFullYear();
  const wk = Math.ceil(((day - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

/** The week's bounds in UTC: Monday 00:00 PKT to the next Monday 00:00 PKT. */
function weekBounds(week) {
  const m = WEEK_RX.exec(String(week || ''));
  if (!m) throw new Error(`week must look like 2026-W42, got ${String(week).slice(0, 20)}`);
  const y = Number(m[1]);
  const jan4 = Date.UTC(y, 0, 4);
  const mon1 = jan4 - (((new Date(jan4).getUTCDay() || 7) - 1) * DAY_MS);
  const startPkt = mon1 + (Number(m[2]) - 1) * 7 * DAY_MS;
  return { start: new Date(startPkt - PKT_MS).toISOString(), end: new Date(startPkt + 7 * DAY_MS - PKT_MS).toISOString() };
}

const pktDay = (iso) => new Date(Date.parse(iso) + PKT_MS).toISOString().slice(0, 10);

/** The fixed reporting band (the same rule as m_result's fixed_band): G1, G23 or G45. */
function fixedBand(row = {}) {
  if (row.form === 'G1') return 'G1';
  const g = Number(row.grade);
  if (g === 2 || g === 3) return 'G23';
  if (g === 4 || g === 5) return 'G45';
  if (row.form === 'G3') return 'G23';
  if (row.form === 'G5') return 'G45';
  return 'unknown';
}
// The ladder of an exercise (the statement's map): reading for read / listen, numbers for the rest.
const ladderOf = (ex) => (ex === 'read' || ex === 'listen' ? 'reading' : 'numbers');
const ANCHOR_ITEMS = 10;
// An anchor block the child finished: all ten items reached (score.reached, else score.n).
const finishedBlock = (r) => {
  const s = r.score && typeof r.score === 'object' ? r.score : {};
  return Number(s.reached != null ? s.reached : s.n) >= ANCHOR_ITEMS;
};
const childOf = (r) => r.canonical_id || r.student_id || null;
const cellOf = (r, ...more) => [fixedBand(r), r.lang || 'unknown', ...more].join('|');
const share = (a, b) => (b ? a / b : null);

/** Every row a query gives, a page at a time on `col` (created_at; no silent cap). `build()` returns a fresh query. */
async function allRows(build, what, col = 'created_at') {
  const out = [];
  const seen = new Set();
  let cursor = null;
  for (;;) {
    let q = build();
    if (cursor) q = q.gte(col, cursor);
    const { data, error } = await q.order(col, { ascending: true }).limit(PAGE);
    if (error) {
      if (!isMissingTable(error)) logError('web_quiz.strip_read_failed', { what, code: error.code || null, error: String(error.message || error).slice(0, 120) });
      return { rows: out, error };
    }
    const fresh = (data || []).filter((r) => !seen.has(r.id));
    fresh.forEach((r) => { seen.add(r.id); out.push(r); });
    if (!data || data.length < PAGE || !fresh.length) return { rows: out, error: null };
    cursor = data[data.length - 1][col];
  }
}

function count(map, key, by = 1) { map.set(key, (map.get(key) || 0) + by); }

/** The distinct values of `col` over a table's active rows, paged on `col` itself; null when it cannot be read. */
async function distinctActive(table, col) {
  const out = new Set();
  let cursor = null;
  for (;;) {
    let q = supabase.from(table).select(col).eq('is_active', true);
    if (cursor !== null) q = q.gt(col, cursor);
    const { data, error } = await q.order(col, { ascending: true }).limit(PAGE);
    if (error) {
      if (!isMissingTable(error)) logError('web_quiz.strip_read_failed', { what: table, code: error.code || null });
      return null;
    }
    (data || []).forEach((r) => { if (r[col] != null) out.add(r[col]); });
    if (!data || data.length < PAGE) return out;
    cursor = data[data.length - 1][col];
  }
}

/**
 * D5's denominator, defined here once: the classes a teacher can get a class link for. The mint's own rule
 * (web-quiz-class-link.js teachesEnrolled): the class is active, has an active class_teachers row, and has at least
 * one active class_enrollments row. { eligible, active } (active = active classes), or null when a table cannot be read.
 */
async function linkEligibleClasses() {
  const classes = await distinctActive('classes', 'id');
  const taught = classes && await distinctActive('class_teachers', 'class_id');
  const enrolled = taught && await distinctActive('class_enrollments', 'class_id');
  if (!classes || !taught || !enrolled) return null;
  let eligible = 0;
  for (const c of classes) if (taught.has(c) && enrolled.has(c)) eligible += 1;
  return { eligible, active: classes.size };
}

/** A module that may not be deployed yet (another change ships it): the module, or null. */
function optional(name) {
  try { return require(name); } catch (_) { return null; }
}

// ── reply cap: counts only ──
const redis = () => require('../cache/railway-redis.service');

/** The per-phone daily reply cap: app_settings web_quiz_reply_cap_per_phone, an integer ≥ 1; else 8. */
async function replyCap() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', CAP_KEY);
    if (error || !data || !data.length) return CAP_DEFAULT;
    let v = data[0].value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
    const k = Number(v);
    return Number.isInteger(k) && k >= 1 ? k : CAP_DEFAULT;
  } catch (_) { return CAP_DEFAULT; }
}
const binsFor = (cap) => (cap > 8 ? ['1', '2', '3-4', '5-8', '9+', 'capped'] : CAP_BINS);
const capBin = (c, cap) => {
  if (c > cap) return 'capped';
  if (c <= 1) return '1';
  if (c === 2) return '2';
  if (c <= 4) return '3-4';
  return c <= 8 ? '5-8' : '9+';
};

/** One PKT day's phone-days by bin from the live counters: { bins, phones }, or null when Redis is down. */
async function readCapDay(day, cap) {
  const vals = await redis().scanValues(`${CAP_PREFIX}${day}:*`);
  if (vals == null) return null;
  const bins = new Map(binsFor(cap).map((b) => [b, 0]));
  let phones = 0;
  for (const v of vals) {
    const c = Number(v);
    if (!Number.isFinite(c) || c < 1) continue;
    phones += 1;
    count(bins, capBin(c, cap));
  }
  return { bins, phones };
}

/**
 * The daily job's snapshot of yesterday's (PKT) reply counts, before the 24-h counters expire: one
 * `reply_cap_day / <day>|<bin>` row per bin (n = phone-days), in that day's week. Redis down → nothing, one log line.
 */
async function replyCapSnapshot({ now = Date.now() } = {}) {
  const day = pktDay(new Date(now - DAY_MS).toISOString());
  const got = await readCapDay(day, await replyCap());
  if (!got) {
    logToFile('Challenge daily numbers: reply-cap snapshot skipped (Redis unavailable)', { day });
    return { day, skipped: true };
  }
  const week = isoWeekOf(Date.parse(`${day}T07:00:00Z`));
  await writeLines([...got.bins].map(([b, k]) => ({ week, line: 'reply_cap_day', cell: `${day}|${b}`, value: k, n: got.phones })), now);
  return { day, phones: got.phones, hits: got.bins.get('capped') || 0 };
}

/**
 * The daily job's record of its rung settle (web-quiz-rungs.js settleDeferred, run only with the rung switch on):
 * one `lamps_settled_day / <PKT day>` row in that day's week, value = lamps lit without answers, n = readings checked.
 */
async function settledSnapshot({ day, settled, checked, now = Date.now() } = {}) {
  const week = isoWeekOf(Date.parse(`${day}T07:00:00Z`));
  await writeLines([{ week, line: 'lamps_settled_day', cell: day, value: Number(settled) || 0, n: Number(checked) || 0 }], now);
  return { day, settled: Number(settled) || 0 };
}

/** The week's reply-cap lines: the daily snapshots, plus a live read of a day still in Redis and not snapshotted. */
async function replyCapLines({ week, start, now, put }) {
  const days = Array.from({ length: 7 }, (_, i) => pktDay(new Date(Date.parse(start) + i * DAY_MS).toISOString()));
  const byDay = new Map();
  const { data: snap, error } = await supabase.from(STRIP_TABLE).select('cell, value, n').eq('week', week).eq('line', 'reply_cap_day');
  if (error && !isMissingTable(error)) logError('web_quiz.strip_read_failed', { what: 'reply_cap_day', code: error.code || null });
  for (const r of (error ? [] : snap || [])) {
    const [d, b] = String(r.cell).split('|');
    if (!days.includes(d) || !b) continue;
    if (!byDay.has(d)) byDay.set(d, { bins: new Map(), phones: Number(r.n) || 0 });
    count(byDay.get(d).bins, b, Number(r.value) || 0);
  }
  // a counter lives 24 h from its day's first reply: only yesterday's (and today's) can still be read
  const liveFrom = pktDay(new Date(now - DAY_MS).toISOString());
  let cap = null;
  for (const d of days) {
    if (byDay.has(d) || d < liveFrom) continue;
    if (cap == null) cap = await replyCap();
    const got = await readCapDay(d, cap);
    if (!got) {
      logToFile('Challenge weekly numbers: reply-cap live read skipped (Redis unavailable)', { week });
      break;
    }
    byDay.set(d, got);
  }
  if (!byDay.size) return false;
  const bins = new Map(CAP_BINS.map((b) => [b, 0]));
  let phones = 0;
  for (const g of byDay.values()) {
    phones += g.phones;
    for (const [b, k] of g.bins) count(bins, b, k);
  }
  for (const [b, k] of bins) put('reply_cap_phones', b, k, phones);
  put('reply_cap_hits', '', bins.get('capped') || 0, phones);
  put('reply_cap_days_covered', '', byDay.size, 7);
  return true;
}

/** The teacher-accepted share per identity tier (the join queue's precisionByTier(); never called precision here). */
async function acceptedShareLines({ put }) {
  const Q = optional('./web-quiz-join-queue');
  if (!Q || typeof Q.precisionByTier !== 'function') {
    logToFile('Challenge weekly numbers: teacher-accepted share skipped (join queue not available)');
    return false;
  }
  let tiers = null;
  try { tiers = await Q.precisionByTier(); } catch (_) { tiers = null; }
  // a failed read comes back as every tier held with error: true (fail closed) — not a measured share
  if (!Array.isArray(tiers) || tiers.some((t) => !t || t.error)) {
    logToFile('Challenge weekly numbers: teacher-accepted share skipped (queue read failed)');
    return false;
  }
  for (const t of tiers) {
    const n = Number.isFinite(Number(t.n)) ? Number(t.n) : null;
    put('teacher_accepted_share', t.tier, t.wilson_lower_95 == null ? null : Number(t.wilson_lower_95), n);
    put('teacher_accepted_held', t.tier, t.held ? 1 : 0, n);
  }
  return true;
}

/** Pooled-SD standardised gap (b − a); null when either group has fewer than 2. */
function gap(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ss = (xs, m) => xs.reduce((s, x) => s + (x - m) ** 2, 0);
  const ma = mean(a); const mb = mean(b);
  const sd = Math.sqrt((ss(a, ma) + ss(b, mb)) / (a.length + b.length - 2));
  return sd > 0 ? (mb - ma) / sd : null;
}
const okOf = (r) => {
  const v = r.score && typeof r.score === 'object' ? r.score.correct : null;
  return Number.isFinite(Number(v)) && v != null ? Number(v) : null;
};

async function rungsOf(children) {
  const by = new Map();
  const ids = [...children].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('child_rungs').select('canonical_id, ladder, rung, set_at')
      .eq('ladder', 'reading').in('canonical_id', ids.slice(i, i + 100));
    if (error) return { by: null, error };
    for (const r of data || []) { if (!by.has(r.canonical_id)) by.set(r.canonical_id, []); by.get(r.canonical_id).push(r); }
  }
  return { by, error: null };
}
// The child's reading rung when the run was served: the last lamp set at or before it; none yet is 0 (the bottom).
function rungAt(list, at) {
  let best = null;
  for (const r of list || []) if (String(r.set_at) <= String(at) && (!best || String(r.set_at) > String(best.set_at))) best = r;
  return best ? Number(best.rung) : 0;
}

/** Compute the week's lines and write them (replace per week × line × cell). Returns { week, lines }. */
async function weeklyStrip({ week, now = Date.now() } = {}) {
  const { start, end } = weekBounds(week);
  const lines = [];
  const put = (line, cell, value, n) => lines.push({ week, line, cell: cell || '', value: value == null ? null : value, n: n == null ? null : n });
  const skipped = [];
  const notes = {};

  // ── this week's runs ──
  const wk = await allRows(() => supabase.from(TABLE).select(COLS).gte('created_at', start).lt('created_at', end), 'week_runs');
  const rows = wk.rows;
  const check = rows.filter((r) => r.mode === 'check');

  const plays = new Map();
  rows.filter((r) => r.status === 'scored').forEach((r) => count(plays, r.mode || 'legacy'));
  for (const [mode, k] of plays) put('plays', mode, k, k);

  const v2 = rows.filter((r) => r.mode != null);
  put('provenance_incomplete', '', v2.filter((r) => PROVENANCE.some((c) => r[c] == null)).length, v2.length);

  const counted = check.filter((r) => r.status === 'scored');
  const kids = new Map();
  counted.forEach((r) => { const k = childOf(r); kids.set(k, kids.get(k) || r.class_id != null); });
  put('roster_bound_pct', '', share([...kids.values()].filter(Boolean).length, kids.size), kids.size);

  const helped = new Map(); const scoredN = new Map();
  counted.forEach((r) => { const c = cellOf(r, r.exercise); count(scoredN, c); if (r.helped === 'helped') count(helped, c); });
  for (const [c, k] of scoredN) put('helped_pct', c, share(helped.get(c) || 0, k), k);

  const firsts = counted.filter((r) => Number(r.exposure_no) === 1);
  put('no_class_first_finishes', '', share(firsts.filter((r) => r.class_id == null).length, firsts.length), firsts.length);

  // record duplicates: a second record of the stop this period, stored as practice; n = the attempts at a record
  const dups = rows.filter((r) => r.meta && r.meta.record_lost === 'duplicate').length;
  put('record_duplicates', '', dups, rows.filter((r) => r.record === true).length + dups);

  // lost readings: attempted = scored + failed (a swept run is a failed run with meta.swept_at)
  const attempted = check.filter((r) => r.exercise === 'read' && (r.status === 'scored' || r.status === 'failed'));
  const att = new Map(); const lost = new Map(); const swept = new Map(); const attD = new Map(); const lostD = new Map();
  for (const r of attempted) {
    const c = cellOf(r); const d = `b${r.band == null ? 'unknown' : r.band}|${r.lang || 'unknown'}`;
    count(att, c); count(attD, d);
    if (r.status === 'failed') {
      count(lost, c); count(lostD, d);
      if (r.meta && r.meta.swept_at) count(swept, c);
    }
  }
  for (const [c, k] of att) {
    put('lost_readings', c, share(lost.get(c) || 0, k), k);
    put('lost_readings_swept', c, share(swept.get(c) || 0, k), k);
  }
  for (const [d, k] of attD) put('lost_readings_draw', d, share(lostD.get(d) || 0, k), k);

  // B3: attempted check readings by bottom-rung children
  if (attempted.length) {
    const { by, error } = await rungsOf(new Set(attempted.map(childOf)));
    if (error) {
      skipped.push('b3_bottom_share');
      if (!isMissingTable(error)) logError('web_quiz.strip_read_failed', { what: 'child_rungs', code: error.code || null });
    } else {
      const bottom = new Map();
      attempted.forEach((r) => { if (rungAt(by.get(childOf(r)), r.created_at) <= 1) count(bottom, cellOf(r)); });
      for (const [c, k] of att) put('b3_bottom_share', c, share(bottom.get(c) || 0, k), k);
    }
  }

  // ── the month to date (period_id of the week's Monday, rows up to the week's end), scored check rows:
  //    cells at n = 30 and the anchor retest gap ──
  const month = pktDay(start).slice(0, 7);
  const mo = await allRows(() => supabase.from(TABLE).select(COLS).eq('period_id', month).eq('mode', 'check').eq('status', 'scored')
    .lt('created_at', end), 'month_runs');
  // high confidence is proven from the student row (on a list, or merged), not read from the column: one read
  const students = mo.rows.length ? await loadStudents(mo.rows.map(childOf)) : new Map();
  if (!students) skipped.push('cells_n30', 'anchor_retest_gap');
  // children, not rows: a child with usable self-run, high-confidence, record first exposures (or anchor rows) counts once
  const usable = new Map();
  mo.rows.filter((r) => r.helped === 'self' && provenHigh(r, students) && r.record === true
    && (Number(r.exposure_no) === 1 || r.anchor_block != null))
    .forEach((r) => {
      const c = cellOf(r, ladderOf(r.exercise));
      if (!usable.has(c)) usable.set(c, new Set());
      usable.get(c).add(childOf(r));
    });
  for (const [c, kids] of usable) put('cells_n30', c, kids.size, kids.size);
  // the statement's gate: self-run, high confidence, an anchor row, a finished block; first-timers (exposure 1) vs
  // returners (≥ 2), on score.correct
  const anchors = new Map();
  mo.rows.filter((r) => r.helped === 'self' && provenHigh(r, students) && r.anchor_block != null
    && Number(r.anchor_exposure_no) >= 1 && finishedBlock(r) && okOf(r) != null).forEach((r) => {
    const c = cellOf(r, ladderOf(r.exercise), r.anchor_block);
    if (!anchors.has(c)) anchors.set(c, { first: [], back: [] });
    anchors.get(c)[Number(r.anchor_exposure_no) === 1 ? 'first' : 'back'].push(okOf(r));
  });
  for (const [c, g] of anchors) put('anchor_retest_gap', c, gap(g.first, g.back), g.first.length + g.back.length);

  // ── provenance drift (the week's v2 rows; each should read 0). An unreadable students table was logged above ──
  const drift = students ? await driftCounts(rows) : null;
  if (drift) {
    put('provenance_drift', 'high_unproven', drift.high_unproven, drift.n);
    put('provenance_drift', 'homonym_missed', drift.homonym_missed, drift.n);
  } else skipped.push('provenance_drift');

  // ── D5's denominator (a state, not a week): the link-eligible classes ──
  const d5 = await linkEligibleClasses();
  if (d5) put('classes_link_eligible', '', d5.eligible, d5.active); else skipped.push('classes_link_eligible');

  // ── kept audio (a state, not a week): every run naming a kept reading vs every kept_ok run inside its 90 days ──
  const keyed = await allRows(() => supabase.from(TABLE).select('id, created_at, scored_at, meta').not('meta->>audio_key', 'is', null), 'kept_keys');
  const okd = await allRows(() => supabase.from(TABLE).select('id, created_at, audio_keep_until').eq('audio_consent', 'kept_ok'), 'kept_ok');
  if (!keyed.error && !okd.error) {
    const nowIso = new Date(now).toISOString();
    const inWindow = okd.rows.filter((r) => r.audio_keep_until == null || String(r.audio_keep_until) >= nowIso).length;
    put('kept_audio_keys', '', keyed.rows.length, inWindow);
    put('kept_audio_match', '', keyed.rows.length === inWindow ? 1 : 0, keyed.rows.length);
    const ages = keyed.rows.map((r) => Math.floor((now - Date.parse(r.scored_at || r.created_at)) / DAY_MS)).filter(Number.isFinite);
    put('kept_audio_oldest_d', '', ages.length ? Math.max(...ages) : null, ages.length);
  } else skipped.push('kept_audio');

  // ── sends (message_ledger, PKT days of the week) ──
  const { data: led, error: lErr } = await supabase.from('message_ledger').select('day, trigger, initiated, recipient, count, usd')
    .gte('day', pktDay(start)).lt('day', pktDay(end));
  if (lErr) {
    skipped.push('sends');
    if (!isMissingTable(lErr)) logError('web_quiz.strip_read_failed', { what: 'message_ledger', code: lErr.code || null });
  } else {
    const by = new Map(); let total = 0; let usd = 0; let botFamily = 0;
    for (const r of led || []) {
      const k = Number(r.count) || 0;
      count(by, r.trigger, k); total += k; usd += Number(r.usd) || 0;
      if (r.initiated === 'bot' && r.recipient === 'family') botFamily += k;
    }
    for (const [t, k] of by) put('sends', t, k, k);
    notes.sends = LINE_NOTES.sends;
    put('sends_total', '', total, total);
    put('sends_usd', '', Math.round(usd * 1e6) / 1e6, total);
    put('bot_to_family', '', botFamily, total);
    const door = (by.get('home_reply') || 0) + (by.get('guest_reply') || 0);
    put('door_mix_numerator', '', door, door);

    // D3 replies per bound child: home_reply + bind_reply sends ÷ children with a phone binding active at the cut
    // (bound before it, not erased before it, not expired by it). Counts only: no phone column is read.
    const bound = await allRows(() => supabase.from('child_phone_bindings').select('id, canonical_id, bound_at, expires_at, revoked_at')
      .lt('bound_at', end), 'child_phone_bindings', 'bound_at');
    if (bound.error) skipped.push('replies_per_bound_child');
    else {
      const cut = Date.parse(end);
      const kids = new Set(bound.rows.filter((r) => (r.revoked_at == null || Date.parse(r.revoked_at) >= cut) && Date.parse(r.expires_at) > cut)
        .map((r) => r.canonical_id));
      const replies = (by.get('home_reply') || 0) + (by.get('bind_reply') || 0);
      put('replies_per_bound_child', '', share(replies, kids.size), kids.size);
    }
  }

  // ── Reading lamps the daily settle lit without answers (the week's daily rows; none with the rung switch off) ──
  const recordReads = counted.filter((r) => r.exercise === 'read' && r.record === true).length;
  const { data: setl, error: sErr } = await supabase.from(STRIP_TABLE).select('cell, value').eq('week', week).eq('line', 'lamps_settled_day');
  if (sErr) {
    skipped.push('lamps_settled_unanswered');
    if (!isMissingTable(sErr)) logError('web_quiz.strip_read_failed', { what: 'lamps_settled_day', code: sErr.code || null });
  } else put('lamps_settled_unanswered', '', (setl || []).reduce((s, r) => s + (Number(r.value) || 0), 0), recordReads);

  // ── identity: the reply cap and the teacher-accepted share (each only when its input exists) ──
  if (!(await replyCapLines({ week, start, now, put }))) skipped.push('reply_cap');
  if (!(await acceptedShareLines({ put }))) skipped.push('teacher_accepted_share');

  await writeLines(lines, now);
  if (skipped.length) logToFile('Challenge weekly numbers: lines skipped (table not there yet or unreadable)', { week, skipped });
  return { week, lines: lines.length, skipped, notes };
}

/** Replace each (week, line, cell) row: update it, else insert it (a concurrent insert falls back to the update). */
async function writeLines(lines, now) {
  const at = new Date(now).toISOString();
  for (const l of lines) {
    const patch = { value: l.value, n: l.n, computed_at: at };
    const upd = () => supabase.from(STRIP_TABLE).update(patch).eq('week', l.week).eq('line', l.line).eq('cell', l.cell).select('week');
    const { data, error } = await upd();
    if (error) { logError('web_quiz.strip_write_failed', { line: l.line, code: error.code || null }); continue; }
    if (data && data.length) continue;
    const { error: iErr } = await supabase.from(STRIP_TABLE).insert({ ...l, computed_at: at });
    if (iErr && iErr.code === '23505') await upd();
    else if (iErr) logError('web_quiz.strip_write_failed', { line: l.line, code: iErr.code || null });
  }
}

module.exports = { weeklyStrip, replyCapSnapshot, settledSnapshot, linkEligibleClasses, weekBounds, isoWeekOf, fixedBand, STRIP_TABLE, CAP_KEY, LINE_NOTES };
