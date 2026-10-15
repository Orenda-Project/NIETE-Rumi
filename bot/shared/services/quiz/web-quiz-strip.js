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
 *   anchor_retest_gap / band|lang|ex|block  (mean anchor score of returners − first-timers) ÷ pooled SD, the month
 *   no_class_first_finishes                 scored first exposures with no class
 *   kept_audio_keys                         value = runs naming a kept reading; n = kept_ok runs inside their 90 days
 *   kept_audio_match                        1 when the two are equal, else 0
 *   kept_audio_oldest_d                     days since the oldest kept reading was scored (reported only: the
 *                                           operator keeps every kept reading for now, so age is no red line)
 *   sends / <trigger>, sends_total, sends_usd, bot_to_family, door_mix_numerator   from message_ledger
 * A table that is not there yet (child_rungs, message_ledger) skips its lines, logged.
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');

const TABLE = 'web_quiz_challenge_runs';
const STRIP_TABLE = 'web_quiz_strip_weekly';
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const WEEK_RX = /^(\d{4})-W(\d{2})$/;
const COLS = 'id, student_id, canonical_id, exercise, grade, lang, status, created_at, scored_at, meta, score, mode, form, band, record, '
  + 'class_id, helped, exposure_no, bank_version, period_id, id_src, id_confidence, homonym_in_list, anchor_exposure_no, anchor_block, audio_consent, audio_keep_until';
const PROVENANCE = ['bank_version', 'form', 'period_id', 'exposure_no', 'band', 'canonical_id', 'id_src', 'id_confidence', 'homonym_in_list', 'helped', 'record'];
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
const childOf = (r) => r.canonical_id || r.student_id || null;
const cellOf = (r, ...more) => [fixedBand(r), r.lang || 'unknown', ...more].join('|');
const share = (a, b) => (b ? a / b : null);

/** Every row a query gives, a page at a time on created_at (no silent cap). `build()` returns a fresh query. */
async function allRows(build, what) {
  const out = [];
  const seen = new Set();
  let cursor = null;
  for (;;) {
    let q = build();
    if (cursor) q = q.gte('created_at', cursor);
    const { data, error } = await q.order('created_at', { ascending: true }).limit(PAGE);
    if (error) {
      if (!isMissingTable(error)) logError('web_quiz.strip_read_failed', { what, code: error.code || null, error: String(error.message || error).slice(0, 120) });
      return { rows: out, error };
    }
    const fresh = (data || []).filter((r) => !seen.has(r.id));
    fresh.forEach((r) => { seen.add(r.id); out.push(r); });
    if (!data || data.length < PAGE || !fresh.length) return { rows: out, error: null };
    cursor = data[data.length - 1].created_at;
  }
}

function count(map, key, by = 1) { map.set(key, (map.get(key) || 0) + by); }

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

  // ── this month's scored check runs (the month of the week's last day): cells at n = 30, the anchor retest gap ──
  const month = pktDay(new Date(Date.parse(end) - 1).toISOString()).slice(0, 7);
  const mo = await allRows(() => supabase.from(TABLE).select(COLS).eq('period_id', month).eq('mode', 'check').eq('status', 'scored'), 'month_runs');
  // children, not rows: a child with usable self-run, high-confidence, record first exposures (or anchor rows) counts once
  const usable = new Map();
  mo.rows.filter((r) => r.helped === 'self' && r.id_confidence === 'high' && r.record === true
    && (Number(r.exposure_no) === 1 || r.anchor_block != null))
    .forEach((r) => {
      const c = cellOf(r, r.exercise === 'read' ? 'reading' : 'numbers');
      if (!usable.has(c)) usable.set(c, new Set());
      usable.get(c).add(childOf(r));
    });
  for (const [c, kids] of usable) put('cells_n30', c, kids.size, kids.size);
  const anchors = new Map();
  mo.rows.filter((r) => r.anchor_exposure_no != null && r.anchor_block && okOf(r) != null).forEach((r) => {
    const c = cellOf(r, r.exercise, r.anchor_block);
    if (!anchors.has(c)) anchors.set(c, { first: [], back: [] });
    anchors.get(c)[Number(r.anchor_exposure_no) === 1 ? 'first' : 'back'].push(okOf(r));
  });
  for (const [c, g] of anchors) put('anchor_retest_gap', c, gap(g.first, g.back), g.first.length + g.back.length);

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
    put('sends_total', '', total, total);
    put('sends_usd', '', Math.round(usd * 1e6) / 1e6, total);
    put('bot_to_family', '', botFamily, total);
    const door = (by.get('home_reply') || 0) + (by.get('guest_reply') || 0);
    put('door_mix_numerator', '', door, door);
  }

  await writeLines(lines, now);
  if (skipped.length) logToFile('Challenge weekly numbers: lines skipped (table not there yet or unreadable)', { week, skipped });
  return { week, lines: lines.length, skipped };
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

module.exports = { weeklyStrip, weekBounds, isoWeekOf, fixedBand, STRIP_TABLE };
