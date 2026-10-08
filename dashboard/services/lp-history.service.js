'use strict';
/**
 * bd-fmf24g.3 — "All lesson plans" (teacher app v2): her lesson-plan history for a date range, the
 * four numbers above it, and the same numbers for the period before (for the ▲▼ pills).
 *
 * WHAT IS COUNTED, EXACTLY
 * ------------------------
 * Every number is counted from her USE rows — lp-activity's ACTIVITY_CTE, the union of the three
 * ledgers the Home's "Lesson plans used" already reads (opened in the portal: niete_lp_opens;
 * received on WhatsApp: niete_lp_downloads 'sent', niete_lp612_deliveries). No new table and no
 * stored total. A plan is `<kind>:<ref>`; a day is a Pakistan day.
 *
 *   lessonPlans     distinct plans used in the window (the Home tile's `used`)
 *   classesCovered  distinct grade·subject of those plans, as the bot names them
 *   sentOnWhatsapp  distinct plans that reached her on WhatsApp in the window (the Home's `received`)
 *   daysActive      distinct Pakistan days with any use (the Home's `days`)
 *
 * WHY IT COUNTS IN JS, NOT IN SQL LIKE THE HOME
 * ---------------------------------------------
 * The class filter ("Grade 4 · General Science") needs each plan's grade and subject, and those
 * come from the bot (`describe`) — the portal holds no catalogue. So the filter, and every number
 * under it, can only be applied after naming. The read is still one per-teacher index scan per
 * window, bounded at USES_LIMIT rows; past the cap the answer says `truncated`.
 *
 * THE PERIOD BEFORE is the same stretch one step back — the DateRangeBar rule (COMPONENTS.md §9):
 * this month 1–8 Oct → 1–8 Sep, this week → last week, this year → last year, n days → the n days
 * just before, All time → none. The client may send its own (prevFrom/prevTo), so the numbers
 * always match the "vs …" label it shows.
 */

const LpActivity = require('./lp-activity.service');
const { pkToday } = require('../lib/pk-range');
const { subjectKey, gradeOf } = require('./subject-vocabulary.service');

/** Most use rows read per window; more is `truncated`. */
const USES_LIMIT = 2000;
/** The bot names at most this many plans a call (POST /api/internal/lp/describe). */
const DESCRIBE_BATCH = 200;

const USES_SQL = `
  WITH ${LpActivity.ACTIVITY_CTE}
  SELECT kind, ref, lang, at, via FROM lp_activity
   ORDER BY at DESC
   LIMIT $4`;

/* ── calendar ──────────────────────────────────────────────────────────── */

const ymd = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T00:00:00Z`);
function addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

/** Same day, `months` away; the day clamped to the month's length (31 Mar → 28 Feb). */
function addMonths(s, months) {
  const [y, m, d] = s.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return ymd(first);
}

/** The same stretch one step back, or null for All time. */
function previousRange(range) {
  if (!range || !range.from || !range.to) return null;
  const { key, from, to } = range;
  if (key === 'this_week') return { from: addDays(from, -7), to: addDays(to, -7) };
  if (key === 'this_month') return { from: addMonths(from, -1), to: addMonths(to, -1) };
  if (key === 'this_year') return { from: addMonths(from, -12), to: addMonths(to, -12) };
  const n = daysBetween(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Sparkline buckets: a day each up to 14 days, a week each up to 120, else 30 days. */
function bucketDaysFor(days) {
  if (days <= 14) return 1;
  if (days <= 120) return 7;
  return 30;
}

/* ── reading and naming ────────────────────────────────────────────────── */

const pkDay = (at) => pkToday(new Date(at));
const planKeyOf = (u) => `${u.kind}:${u.ref}`;

async function readUses(query, userId, from, to) {
  const { rows } = await query(USES_SQL, [userId, from, to, USES_LIMIT]);
  return (rows || []).map((r) => ({ ...r, key: planKeyOf(r), day: pkDay(r.at) }));
}

/** Name every plan once, in batches the bot accepts. Throws when the bot cannot. */
async function namePlans(uses, describe) {
  const asked = new Map();
  for (const u of uses) if (!asked.has(u.key)) asked.set(u.key, { kind: u.kind, ref: u.ref, lang: u.lang || null });
  const list = [...asked.values()];
  const names = new Map();
  for (let i = 0; i < list.length; i += DESCRIBE_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    const named = await describe(list.slice(i, i + DESCRIBE_BATCH));
    for (const n of named || []) names.set(`${n.kind}:${n.ref}`, n);
  }
  return names;
}

/** grade + subjectKey of a named plan, or null when the bot did not find it. */
function classOf(name) {
  if (!name || name.found !== true) return null;
  const g = gradeOf(name.grade);
  const key = subjectKey(name.subject);
  return g && g.grade != null && key ? { grade: g.grade, subjectKey: key } : null;
}

function cleanFilter(filter) {
  if (!filter) return null;
  const grade = filter.grade == null ? null : Number(filter.grade);
  const key = subjectKey(filter.subject);
  if (grade == null && !key) return null;
  return { grade, subjectKey: key };
}

function matches(filter, cls) {
  if (!filter) return true;
  if (!cls) return false;
  return (filter.grade == null || cls.grade === filter.grade)
    && (!filter.subjectKey || cls.subjectKey === filter.subjectKey);
}

function kpisOf(uses, names) {
  const plans = new Set(); const whatsapp = new Set(); const days = new Set(); const classes = new Set();
  for (const u of uses) {
    plans.add(u.key);
    days.add(u.day);
    if (u.via === 'whatsapp') whatsapp.add(u.key);
    const cls = classOf(names.get(u.key));
    if (cls) classes.add(`${cls.grade}:${cls.subjectKey}`);
  }
  return { lessonPlans: plans.size, classesCovered: classes.size, sentOnWhatsapp: whatsapp.size, daysActive: days.size };
}

function trendOf(uses, range) {
  const from = range.from || (uses.length ? uses.reduce((m, u) => (u.day < m ? u.day : m), uses[0].day) : null);
  const to = range.to || (from ? pkToday() : null);
  if (!from || !to) return { bucketDays: 1, points: [] };
  const span = daysBetween(from, to) + 1;
  const size = bucketDaysFor(span);
  const buckets = Array.from({ length: Math.ceil(span / size) }, () => new Set());
  for (const u of uses) {
    const i = Math.floor(daysBetween(from, u.day) / size);
    if (i >= 0 && i < buckets.length) buckets[i].add(u.key);
  }
  return { bucketDays: size, points: buckets.map((b) => b.size) };
}

function itemsOf(uses, names) {
  const latest = new Map(); // uses arrive newest first: the first seen is the last use
  for (const u of uses) if (!latest.has(u.key)) latest.set(u.key, u);
  return [...latest.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((u) => {
      const n = names.get(u.key) || {};
      const k5 = u.kind === 'k5';
      return {
        planKey: u.key,
        kind: u.kind,
        found: n.found === true,
        title: n.title || null,
        grade: n.grade ?? null,
        subject: n.subject || null,
        subjectKey: subjectKey(n.subject),
        chapterNumber: n.chapterNumber ?? null,
        chapterTitle: n.chapterTitle || null,
        dayLabel: n.dayLabel || null,
        pagesLabel: n.pagesLabel || null,
        lastUsedAt: new Date(u.at).toISOString(),
        day: u.day,
        via: u.via,
        open: k5 ? { lane: 'k5', lessonId: u.ref } : { lane: 'g612', segmentId: u.ref, lang: u.lang || 'en' },
      };
    });
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 * @param {string} userId the SESSION's teacher
 * @param {{ range: {key, from, to}, previous?: {from, to}|null, filter?: {grade?, subject?},
 *           describe: Function }} opts  describe = LpCatalogue.describePlans
 */
async function lpHistory(query, userId, { range, previous, filter, describe }) {
  const prev = previous === undefined ? previousRange(range) : previous;
  const [cur, before] = await Promise.all([
    readUses(query, userId, range.from, range.to),
    prev ? readUses(query, userId, prev.from, prev.to) : Promise.resolve(null),
  ]);
  const names = await namePlans(before ? [...cur, ...before] : cur, describe);

  const f = cleanFilter(filter);
  const keep = (u) => matches(f, classOf(names.get(u.key)));
  const curIn = cur.filter(keep);
  const beforeIn = before ? before.filter(keep) : null;

  const now = kpisOf(curIn, names);
  const then = beforeIn ? kpisOf(beforeIn, names) : null;
  const kpis = {};
  for (const k of Object.keys(now)) kpis[k] = { value: now[k], previous: then ? then[k] : null };

  const items = itemsOf(curIn, names);
  return {
    previous: prev ? { from: prev.from, to: prev.to } : null,
    filter: f,
    kpis,
    trend: trendOf(curIn, range),
    items,
    total: items.length,
    truncated: cur.length >= USES_LIMIT || Boolean(before && before.length >= USES_LIMIT),
  };
}

module.exports = {
  USES_LIMIT,
  DESCRIBE_BATCH,
  USES_SQL,
  previousRange,
  bucketDaysFor,
  lpHistory,
};
