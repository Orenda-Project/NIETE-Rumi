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
 *                                       web_quiz_class_round on, both order arms' class weeks placeable and the
 *                                       school breaks (app_settings web_quiz_term_breaks) clear of the round window
 *                                       and both weeks. NOT scheduled anywhere: an operator runs it.
 *   inviteTeacher(draw, {now, send})    the teacher's one invitation per term: only on the operator's dated go
 *                                       (app_settings web_quiz_class_round_go); a stub until a sender is injected
 *                                       (bot.round.invite); the card on the teacher's report is the way in.
 *
 * Sector = schools.region (as web-quiz-schools.js reads it); grade band from classes.grade_code: grades 2–3 → G23,
 * 4–5 → G45 (the Challenge's forms). Grade 1 and 6+ classes, test schools and rosters under MIN_ROSTER are never drawn.
 * Cost when the invitation is built: 40 × US$0.015 = US$0.60 per term.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage, UX_STRINGS } = require('../../config/ux-strings');
const Flags = require('./web-quiz-class-round-flags');
const Events = require('./web-quiz-class-round-events');
const Ledger = require('./message-ledger');

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
// The school calendar's breaks (SPEC §1): [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }] in PKT dates, `to` INCLUSIVE (a
// break's last day off; a one-day break has from === to).
const BREAKS_KEY = 'web_quiz_term_breaks';
// The operator's dated go for the invitation: { by: 'operator', date, term, template, category, max_sends[, consent_v] }.
const GO_KEY = 'web_quiz_class_round_go';
const INVITE_TEMPLATE = 'jugnu_round_invite';
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A PKT calendar date 'YYYY-MM-DD' → the ms of its PKT midnight; null for anything else (2026-02-30 included). */
function pktDateMs(s) {
  const m = DATE_RX.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Date.UTC(y, mo - 1, d) - PKT_MS;
}

const pktDay = (t) => new Date(t + PKT_MS).toISOString().slice(0, 10);

/** One app_settings value (read like the flags: key, value; JSON text parsed). { ok, value } | { ok: false }. Never throws. */
async function settingValue(key) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [key]);
    if (error) return { ok: false };
    const row = (data || []).find((r) => r.key === key);
    if (!row || row.value === null || row.value === undefined || row.value === '') return { ok: true, value: null };
    let v = row.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return { ok: true, value: undefined }; } }
    return { ok: true, value: v };
  } catch (_) {
    return { ok: false };
  }
}

/** The stored break list → [{ from, to, s, e }] (ms; e = the PKT midnight after `to`), or null when absent, unreadable or malformed. */
async function termBreaks() {
  const r = await settingValue(BREAKS_KEY);
  if (!r.ok || !Array.isArray(r.value)) return null;
  const out = [];
  for (const b of r.value) {
    const s = b && pktDateMs(b.from);
    const last = b && pktDateMs(b.to);
    if (s == null || last == null || s > last) return null;
    out.push({ from: b.from, to: b.to, s, e: last + DAY_MS });
  }
  return out;
}

/**
 * A draw refused on the calendar (arm_unplaceable, no_breaks, window_in_break, week_in_break): one log line with
 * the dates, and counted as web_quiz.sample_drawn{arm:'class_round', unit:'class', term, seed_version, drawn:0,
 * skipped} (codes only; written with the events switch on, like the class_round_* events). Nothing else written.
 */
async function refuseDraw(term, skipped, message, detail) {
  logToFile(`⚠️ class round: draw refused — ${message}`, { term, skipped, ...detail });
  try {
    if ((await Flags.flags()).events) {
      logEvent('web_quiz.sample_drawn', { w: 's', ev_v: 2, arm: 'class_round', unit: 'class', term, seed_version: WEIGHTS_VERSION, drawn: 0, skipped });
    }
  } catch (_) { /* the log line above still counts it */ }
  return { drawn: 0, skipped };
}

const overlaps = (s, e, breaks) => breaks.find((b) => s < b.e && b.s < e) || null;

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
  // both order arms need a class week, or the crossover loses a cell: never switch a class to the other arm
  const weeks = { round_first: weekFor('round_first', ws, we, term), week_first: weekFor('week_first', ws, we, term) };
  if (!weeks.round_first || !weeks.week_first) {
    return refuseDraw(term, 'arm_unplaceable', 'an order arm\'s class week cannot be placed', { window: [pktDay(ws), pktDay(we)],
      round_first: weeks.round_first && [pktDay(weeks.round_first.start), pktDay(weeks.round_first.end)],
      week_first: weeks.week_first && [pktDay(weeks.week_first.start), pktDay(weeks.week_first.end)] });
  }
  // the school calendar: a draw is once a term and cannot be undone, so no break list → no draw
  const breaks = await termBreaks();
  if (!breaks) return refuseDraw(term, 'no_breaks', 'no readable school break list', { key: BREAKS_KEY });
  const hit = overlaps(ws, we, breaks) ? ['window', ws, we, overlaps(ws, we, breaks)]
    : ['round_first', 'week_first'].map((a) => [a, weeks[a].start, weeks[a].end, overlaps(weeks[a].start, weeks[a].end, breaks)]).find((x) => x[3]);
  if (hit) {
    return refuseDraw(term, hit[0] === 'window' ? 'window_in_break' : 'week_in_break', 'a window falls in a school break',
      { which: hit[0], dates: [pktDay(hit[1]), pktDay(hit[2])], break: [hit[3].from, hit[3].to] });
  }
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
    const arm = gen() < 0.5 ? 'round_first' : 'week_first';
    const week = weeks[arm];
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
 * The operator's dated go for the draw's invitations → { ok: true, go } | { ok: false, reason }. Valid only when
 * by 'operator', a real date no later than today (PKT) and inside the current term, term = the draw's term and the
 * current one, template jugnu_round_invite (or jugnu_round_invite_<lang>), category utility|marketing, max_sends an
 * integer 1..DRAW_K and consent_v (when present) ≥ 1. Never throws.
 */
async function readGo(draw, template, now) {
  const r = await settingValue(GO_KEY);
  if (!r.ok) return { ok: false, reason: 'read_failed' };
  if (r.value === null) return { ok: false, reason: 'no_go' };
  const g = r.value;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, reason: 'go_bad' };
  const day = pktDateMs(g.date);
  const fieldsOk = g.by === 'operator' && day !== null && typeof g.term === 'string' && typeof g.template === 'string'
    && Object.prototype.hasOwnProperty.call(RATE, g.category)
    && Number.isInteger(g.max_sends) && g.max_sends >= 1 && g.max_sends <= DRAW_K
    && (g.consent_v === undefined || (Number.isInteger(g.consent_v) && g.consent_v >= 1));
  if (!fieldsOk) return { ok: false, reason: 'go_bad' };
  if (g.template !== INVITE_TEMPLATE && g.template !== template) return { ok: false, reason: 'wrong_template' };
  if (!draw || g.term !== draw.term_code) return { ok: false, reason: 'wrong_term' };
  const b = termBounds(g.term);
  if (g.term !== termCode(now) || !b || day < b.start || day >= b.end) return { ok: false, reason: 'stale_go' };
  if (g.date > pktDay(now)) return { ok: false, reason: 'go_future' };
  return { ok: true, go: g };
}

/** This term's class_round invitations so far (the ledger's bot → teacher class_round counts), or null on a failed read. */
async function invitesThisTerm(term) {
  const b = termBounds(term);
  try {
    const { data, error } = await supabase.from('message_ledger').select('count').eq('trigger', 'class_round').eq('initiated', 'bot')
      .eq('recipient', 'teacher').gte('day', pktDay(b.start)).lt('day', pktDay(b.end));
    if (error) return null;
    return (data || []).reduce((n, r) => n + (Number(r.count) || 0), 0);
  } catch (_) {
    return null;
  }
}

/**
 * The teacher's invitation (one per drawn class per term): the approved template jugnu_round_invite_{en,ur}, its
 * category rate passed to the ledger as usd_each, trigger class_round. Refused ({ sent: false, reason }, nothing
 * written, nothing sent) without the operator's valid dated go. With a go and no injected `send` (production
 * today) → the stub result: nothing goes to WhatsApp and nothing to the ledger. With both: refused once the term
 * has max_sends invitations; else the send is counted on the ledger's strict phone-less path (the return value is
 * the write) and goes only when that write held.
 */
async function inviteTeacher(draw, { lang = 'en', category = 'utility', now = Date.now(), send = null } = {}) {
  const l = clampLanguage(lang);
  const template = `jugnu_round_invite_${l}`;
  const g = await readGo(draw, template, now);
  if (!g.ok) {
    logToFile('class round: invitation refused', { reason: g.reason, round: draw && draw.round });
    return { sent: false, reason: g.reason, template, trigger: 'class_round' };
  }
  if (typeof send === 'function') {
    const { go } = g;
    const usd = RATE[go.category];
    const used = await invitesThisTerm(go.term);
    if (used === null || used >= go.max_sends) {
      const reason = used === null ? 'ledger_unreadable' : 'term_cap';
      logToFile('class round: invitation refused', { reason, round: draw.round, used, max_sends: go.max_sends });
      return { sent: false, reason, template, trigger: 'class_round', usd_each: usd };
    }
    const counted = await Ledger.record({ trigger: 'class_round', classId: draw.class_id, initiated: 'bot', recipient: 'teacher', usdEach: usd, now: new Date(now) });
    if (counted !== true) {
      logToFile('class round: invitation refused', { reason: 'ledger_refused', round: draw.round });
      return { sent: false, reason: 'ledger_refused', template, trigger: 'class_round', usd_each: usd };
    }
    let delivered = false;
    try { delivered = Boolean(await send({ template, lang: l, round: draw.round, class_id: draw.class_id })); } catch (_) { delivered = false; }
    return { sent: delivered, ...(delivered ? {} : { reason: 'send_failed' }), template, trigger: 'class_round', usd_each: usd };
  }
  const usdEach = category === 'marketing' ? RATE.marketing : RATE.utility;
  logToFile('class round: invitation not sent — template not yet approved', { template, round: draw && draw.round });
  // the template's body (bot.round.invite), read raw: what Meta reviews; nothing is sent from here yet
  return { sent: false, reason: 'stub', template, body: UX_STRINGS.roundInvite[l], trigger: 'class_round', usd_each: usdEach };
}

module.exports = { termCode, termBounds, windowOk, gradeBand, bandOf, drawClasses, WEIGHTS_VERSION, runTermDraw, inviteTeacher, shuffle, cryptoRng, seededRng, DRAW_K, MIN_ROSTER, K_COUNTED, RATE, BREAKS_KEY, GO_KEY };
