'use strict';
/**
 * The class round's term sampler: once a term, ~40 classes (DRAW_K) drawn at random, stratified by sector × grade
 * band, from the classes that have an active roster (class_enrollments). One draw per term, never topped up or
 * replaced; a class drawn in either term of an academic year is out of the frame for the whole year (the table's
 * unique index on (class_id, left(term_code, 7)) backs it).
 *
 *   drawClasses(candidates, {k, rng})   pure: proportional allocation per stratum (largest remainder), then a
 *                                       uniform draw without replacement inside each stratum
 *   runTermDraw({now, seed, planSha256, window, k})
 *                                       the job: reads the classes, writes class_round_draws, emits
 *                                       class_round_drawn{round, cls, term, stratum, roster_k}. Runs only with
 *                                       web_quiz_class_round on. NOT scheduled anywhere: an operator runs it.
 *   inviteTeacher(draw)                 the teacher's one invitation per term: a stub until its template is approved
 *                                       (bot.round.invite); the card on the teacher's report is the way in.
 *
 * Sector = schools.region (as web-quiz-schools.js reads it); grade band from classes.grade_code: grades 2–3 → G23,
 * 4–5 → G45 (the Challenge's forms). Grade 1 and 6+ classes, test schools and rosters under MIN_ROSTER are never drawn.
 * Cost when the invitation is built: 40 × US$0.015 = US$0.60 per term.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { clampLanguage, UX_STRINGS } = require('../../config/ux-strings');
const Flags = require('./web-quiz-class-round-flags');
const Events = require('./web-quiz-class-round-events');

const DRAW_K = 40;
const MIN_ROSTER = 5; // a round of fewer children is a near-singleton class line (L11)
const PAGE = 1000;
const PKT_MS = 5 * 3600 * 1000;

/** '2026-27b' for 1 Oct 2026–31 Mar 2027, '2027-28a' for 1 Apr–30 Sep 2027 (PKT). */
function termCode(now = Date.now()) {
  const d = new Date(now + PKT_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const half = m >= 4 && m <= 9 ? 'a' : 'b';
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}${half}`;
}

/** The grade band of a stratum '<sector>|G23' / '<sector>|G45' (null for anything else). */
function bandOf(stratum) {
  const b = String(stratum || '').split('|').pop();
  return b === 'G23' || b === 'G45' ? b : null;
}

function gradeBand(gradeCode) {
  const g = Number(String(gradeCode || '').replace(/^grade_/, ''));
  if (g === 2 || g === 3) return 'G23';
  if (g === 4 || g === 5) return 'G45';
  return null;
}

/** A crypto-backed generator in [0, 1). */
function cryptoRng() {
  return crypto.randomInt(0, 2 ** 32) / 2 ** 32;
}

/** Fisher–Yates with the given generator; never mutates its input. */
function shuffle(list, rng = cryptoRng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pure: k classes, allocated to strata in proportion to their size (largest remainder), drawn uniformly inside each. */
function drawClasses(candidates, { k = DRAW_K, rng = cryptoRng } = {}) {
  const by = new Map();
  [...candidates].sort((a, b) => String(a.class_id).localeCompare(String(b.class_id))).forEach((c) => {
    if (!by.has(c.stratum)) by.set(c.stratum, []);
    by.get(c.stratum).push(c);
  });
  const total = candidates.length;
  const want = Math.min(k, total);
  if (!want) return [];
  const strata = [...by.keys()].sort();
  const alloc = strata.map((s) => {
    const exact = (want * by.get(s).length) / total;
    return { s, n: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = want - alloc.reduce((a, x) => a + x.n, 0);
  [...alloc].sort((a, b) => b.rem - a.rem || a.s.localeCompare(b.s)).forEach((x) => {
    if (left > 0 && x.n < by.get(x.s).length) { x.n += 1; left -= 1; }
  });
  return alloc.flatMap((x) => shuffle(by.get(x.s), rng).slice(0, x.n));
}

async function readAll(table, cols, filter = (q) => q) {
  const out = [];
  let last = null;
  for (;;) {
    let q = filter(supabase.from(table).select(cols)).order('id', { ascending: true }).limit(PAGE);
    if (last) q = q.gt('id', last);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
    last = data[data.length - 1].id;
  }
}

/** The eligible classes: { class_id, stratum, roster_k }, less any class already drawn this academic year. */
async function candidates(term) {
  const classes = await readAll('classes', 'id, school_id, grade_code, is_active', (q) => q.eq('is_active', true));
  const enr = await readAll('class_enrollments', 'id, class_id, is_active', (q) => q.eq('is_active', true));
  const schoolIds = [...new Set(classes.map((c) => c.school_id).filter(Boolean))];
  const schools = new Map();
  for (let i = 0; i < schoolIds.length; i += 200) {
    const { data, error } = await supabase.from('schools').select('id, region, is_active, is_probable_test').in('id', schoolIds.slice(i, i + 200));
    if (error) throw new Error(`schools: ${error.message}`);
    (data || []).forEach((s) => schools.set(s.id, s));
  }
  // a class at most once an academic year: '2027-28a' and '2027-28b' share left(term_code, 7)
  const year = String(term).slice(0, 7);
  const { data: drawnThisYear, error: yErr } = await supabase.from('class_round_draws').select('id, class_id, term_code').in('term_code', [`${year}a`, `${year}b`]);
  if (yErr) throw new Error(`class_round_draws: ${yErr.message}`);
  const out = new Set((drawnThisYear || []).map((d) => d.class_id));
  const roster = new Map();
  enr.forEach((e) => roster.set(e.class_id, (roster.get(e.class_id) || 0) + 1));
  return classes.flatMap((c) => {
    const band = gradeBand(c.grade_code);
    const school = schools.get(c.school_id);
    const k = roster.get(c.id) || 0;
    if (!band || !school || school.is_active === false || school.is_probable_test || k < MIN_ROSTER || out.has(c.id)) return [];
    return [{ class_id: c.id, stratum: `${school.region || 'none'}|${band}`, roster_k: k }];
  });
}

const DAY_MS = 86400000;
const K_COUNTED = 10;
const WEEK_DAYS = 7;
const GAP_DAYS = 21;
// The signed analysis plan's weights version (its §4.1); the plan's sha256 is passed in and stored on every row.
const WEIGHTS_VERSION = 'cr-2026-27b.1';
const SHA256_RX = /^[0-9a-f]{64}$/;
// Template category rates (US$ per message), passed to the ledger as usd_each when the invitation is built.
const RATE = Object.freeze({ utility: 0.015, marketing: 0.0473 });

/** A seeded generator (mulberry32): the stored seed reproduces the draw. */
function seededRng(seed) {
  let s = Number(seed) | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The term's bounds in ms (PKT): a = 1 Apr–1 Oct, b = 1 Oct–1 Apr. */
function termBounds(term) {
  const m = /^(\d{4})-\d{2}([ab])$/.exec(String(term || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const at = (yy, mo) => Date.UTC(yy, mo, 1) - PKT_MS;
  return m[2] === 'a' ? { start: at(y, 3), end: at(y, 9) } : { start: at(y, 9), end: at(y + 1, 3) };
}

/** A window [start, end) is inside one term and ends before the term's last two weeks (so never across 1 April). */
function windowOk(start, end, term) {
  const b = termBounds(term);
  return !!b && Number.isFinite(start) && Number.isFinite(end) && start < end && start >= b.start && end <= b.end - 14 * DAY_MS;
}

/** No 1st of a month (PKT) inside [start, end): the class week never straddles the Trail's monthly reopen. */
function noMonthStart(start, end) {
  for (let t = start; t < end; t += DAY_MS) {
    if (new Date(t + PKT_MS).getUTCDate() === 1 && t > start) return false;
  }
  return true;
}

/** The class week for an order arm: ≥ 21 days after the round's window, or ending ≥ 21 days before it. */
function weekFor(arm, ws, we, term) {
  const s = arm === 'round_first' ? we + GAP_DAYS * DAY_MS : ws - GAP_DAYS * DAY_MS - WEEK_DAYS * DAY_MS;
  const e = s + WEEK_DAYS * DAY_MS;
  return windowOk(s, e, term) && noMonthStart(s, e) ? { start: s, end: e } : null;
}

/**
 * The term's draw: one stored, seeded, frozen object made before any window opens (one frame, one draw; no
 * replacement draws). Off → { drawn: 0, skipped: 'off' }; no signed analysis plan hash (64 lower-case hex) →
 * 'no_plan'; a bad round window → 'bad_window'; any draw already in the term → 'already_drawn'; a draw whose
 * earliest window (the round's, or a class week placed before it) has already opened → 'window_open', nothing
 * written. Each row: stratum, N_h, n_h, p_incl = n_h / N_h, the stored seed, the plan's weights_version and
 * plan_sha256, the round's window, k_counted, order_arm (randomised by class) and the class week's window.
 * `rng` replaces the seeded generator in tests only; the seed is stored either way.
 */
async function runTermDraw({ now = Date.now(), seed = null, rng = null, k = DRAW_K, window = null, planSha256 = null } = {}) {
  if (!(await Flags.roundOn())) return { drawn: 0, skipped: 'off' };
  if (!SHA256_RX.test(String(planSha256 || ''))) return { drawn: 0, skipped: 'no_plan' };
  const term = termCode(now);
  const ws = window ? Date.parse(window.start) : NaN;
  const we = window ? Date.parse(window.end) : NaN;
  if (!windowOk(ws, we, term)) return { drawn: 0, skipped: 'bad_window' };
  const { data: already, error } = await supabase.from('class_round_draws').select('id, class_id').eq('term_code', term).limit(1);
  if (error) throw new Error(`class_round_draws: ${error.message}`);
  if (already && already.length) return { drawn: 0, skipped: 'already_drawn' };
  const theSeed = seed != null && Number.isSafeInteger(Number(seed)) ? Number(seed) : crypto.randomInt(0, 2 ** 31);
  const gen = rng || seededRng(theSeed);
  const all = await candidates(term);
  const N = all.reduce((m, c) => ({ ...m, [c.stratum]: (m[c.stratum] || 0) + 1 }), {});
  const drawnSet = drawClasses(all, { k, rng: gen });
  const n = drawnSet.reduce((m, c) => ({ ...m, [c.stratum]: (m[c.stratum] || 0) + 1 }), {});
  const drawnAt = new Date(now).toISOString();
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  const rows = [];
  for (const c of drawnSet) {
    let arm = gen() < 0.5 ? 'round_first' : 'week_first';
    let week = weekFor(arm, ws, we, term);
    if (!week) {
      const other = arm === 'round_first' ? 'week_first' : 'round_first';
      const w2 = weekFor(other, ws, we, term);
      if (w2) { arm = other; week = w2; }
    }
    const row = { id: crypto.randomUUID(), round: crypto.randomBytes(8).toString('hex'), term_code: term, class_id: c.class_id, stratum: c.stratum,
      N_h: N[c.stratum], n_h: n[c.stratum], p_incl: n[c.stratum] / N[c.stratum], seed: theSeed, weights_version: WEIGHTS_VERSION, plan_sha256: planSha256,
      window_start: iso(ws), window_end: iso(we), k_counted: K_COUNTED, order_arm: arm, week_start: iso(week && week.start), week_end: iso(week && week.end),
      roster_k: c.roster_k, drawn_at: drawnAt, accepted_at: null, declined_at: null, started_at: null, ran_at: null, finished_at: null,
      children_present: null, children_played: null, state: null };
    rows.push(row);
  }
  // too late: a draw is made before any of its windows opens, or not at all
  if (rows.some((r) => Math.min(ws, r.week_start ? Date.parse(r.week_start) : Infinity) <= now)) return { drawn: 0, skipped: 'window_open' };
  let drawn = 0;
  for (const row of rows) {
    const { error: insErr } = await supabase.from('class_round_draws').insert(row);
    if (insErr) { logToFile('⚠️ class round: draw row not written', { term, error: insErr.message }, 'warn'); continue; }
    drawn += 1;
    await Events.emit('class_round_drawn', { round: row.round, term, stratum: row.stratum, roster_k: row.roster_k }, { classId: row.class_id });
  }
  logToFile('class round: term draw', { term, drawn });
  return { drawn };
}

/**
 * The teacher's invitation (one per drawn class per term): the approved template jugnu_round_invite_{en,ur}, its
 * category rate passed to the ledger as usd_each, trigger class_round. A stub: nothing goes to WhatsApp and nothing
 * to the ledger until the template exists.
 */
async function inviteTeacher(draw, { lang = 'en', category = 'utility' } = {}) {
  const l = clampLanguage(lang);
  const template = `jugnu_round_invite_${l}`;
  const usdEach = category === 'marketing' ? RATE.marketing : RATE.utility;
  logToFile('class round: invitation not sent — template not yet approved', { template, round: draw && draw.round });
  // the template's body (bot.round.invite), read raw: what Meta reviews; nothing is sent from here yet
  return { sent: false, reason: 'stub', template, body: UX_STRINGS.roundInvite[l], trigger: 'class_round', usd_each: usdEach };
}

module.exports = { termCode, termBounds, windowOk, gradeBand, bandOf, drawClasses, WEIGHTS_VERSION, runTermDraw, inviteTeacher, shuffle, cryptoRng, seededRng, DRAW_K, MIN_ROSTER, K_COUNTED, RATE };
