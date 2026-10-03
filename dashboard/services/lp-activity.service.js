'use strict';
/**
 * bd-5rz1v.15 — which lesson plans a teacher has used, and when.
 *
 * "Record when a teacher opens a lesson plan… so we can show 1. when they last opened it and
 * 2. when they do coaching, we can show them their recent lesson plans" (operator, 3 Oct 2026).
 *
 * THREE LEDGERS, ONE ANSWER
 * -------------------------
 * A plan reaches a NIETE teacher two ways, and each already had — or now has — its own record:
 *
 *   niete_lp_opens          she opened it in the PORTAL (written here; V1.6.1)
 *   niete_lp_downloads      a grades 1-5 plan reached her on WHATSAPP (status 'sent')
 *   niete_lp612_deliveries  a grades 6-12 plan reached her on WHATSAPP
 *
 * Every read below is the union of the three, keyed by the stable PLAN KEY `<kind>:<ref>`:
 * `k5:<catalogue lesson_id>` or `g612:<segment_id>`. That is the one definition of "a lesson
 * plan she used" — the recent list, "last opened" and the Home's count all read it. Counting a
 * WhatsApp delivery is deliberate: on NIETE most plans are taken on WhatsApp, and a Home that
 * showed 0 "lesson plans used" to a teacher who took 30 there would be wrong. Each row says which
 * way it came (`lastOpenedAt` portal, `lastReceivedAt` WhatsApp) so a surface can show either.
 *
 * WHY THE PORTAL WRITES niete_lp_opens ITSELF, AND NOTHING ELSE
 * -------------------------------------------------------------
 * The portal is the only surface that opens a plan in the portal, and the only one that knows the
 * open SUCCEEDED (the PDF went out). The two WhatsApp ledgers stay the bot's: they have eight
 * readers that treat a row as "reached her on WhatsApp", the 15:00 quiz offer among them, so a
 * portal open is never written there (see the V1.6.1 header). Counting her own rows is not owning
 * the lesson-plan domain — what a plan IS (title, chapter, day) still comes from the bot
 * (`describe`), exactly as the catalogue does.
 *
 * LOGGING NEVER COSTS HER THE PLAN
 * --------------------------------
 * `logOpen` is fire-and-forget: the route does not await it, it never throws, and a failure is
 * logged at error level (console.error → the error monitor), never swallowed silently.
 */

const KINDS = Object.freeze(['k5', 'g612']);
const SOURCES = Object.freeze(['viewer', 'external']);
const LANGS = Object.freeze(['en', 'ur']);

/** Same teacher + plan + language inside this many minutes is ONE open (a re-render, a double tap,
 *  the viewer falling back to another app). */
const DEDUPE_MINUTES = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One conditional INSERT: stored only if the same (user, kind, ref, lang) has no row in the last
 * DEDUPE_MINUTES. The probe range-scans idx_lp_opens_user_recent (user_id, opened_at DESC).
 * Not a UNIQUE: a later open is a new open, and the race between two concurrent first opens costs
 * at most one extra row, which no reader can see (every reader groups by plan).
 */
const INSERT_OPEN_SQL = `
  INSERT INTO niete_lp_opens (user_id, plan_kind, plan_ref, lang, source)
  SELECT $1::uuid, $2, $3, $4, $5
   WHERE NOT EXISTS (
     SELECT 1 FROM niete_lp_opens
      WHERE user_id = $1::uuid
        AND plan_kind = $2
        AND plan_ref = $3
        AND lang IS NOT DISTINCT FROM $4
        AND opened_at > now() - make_interval(mins => $6::int))
  RETURNING id`;

function cleanOpen({ userId, kind, ref, lang = null, source } = {}) {
  const r = typeof ref === 'string' ? ref.trim() : '';
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (!KINDS.includes(kind) || !SOURCES.includes(source)) return null;
  if (!r || r.length > 200) return null;
  // A K-5 plan has no document language; a 6-12 one without a known language is still an open.
  const l = kind === 'g612' && LANGS.includes(lang) ? lang : null;
  return { userId, kind, ref: r, lang: l, source };
}

/**
 * Record one open. Resolves { recorded: true } when stored, { recorded: false } when it was a
 * repeat inside the window, { recorded: false, reason: 'invalid' } when there is nothing valid to
 * record. Rejects on a database error — callers on the open path use logOpen instead.
 *
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 */
async function recordOpen(query, open) {
  const o = cleanOpen(open);
  if (!o) return { recorded: false, reason: 'invalid' };
  const { rows } = await query(INSERT_OPEN_SQL, [o.userId, o.kind, o.ref, o.lang, o.source, DEDUPE_MINUTES]);
  return { recorded: (rows || []).length > 0 };
}

/**
 * Fire-and-forget recordOpen for the open path: never throws (synchronously or not), and logs
 * a failure at error level. Returns the promise only so a test can wait on it — the routes do not.
 */
function logOpen(query, open) {
  let pending;
  try {
    pending = Promise.resolve(recordOpen(query, open));
  } catch (error) {
    pending = Promise.reject(error);
  }
  return pending.catch((error) => {
    console.error('❌ Lesson plan open not logged', {
      kind: open && open.kind,
      ref: open && open.ref,
      source: open && open.source,
      error: error && error.message,
    });
    return { recorded: false, reason: 'error' };
  });
}

// ─── reads ──────────────────────────────────────────────────────────────────

const { pkInstantWindow, pkDaySql } = require('../lib/pk-range');

/**
 * Every use of a plan by teacher $1 inside the Pakistan-day window [$2, $3] (either end open when
 * NULL): one row per open or delivery, `via` portal | whatsapp. Each branch is a per-teacher index
 * range scan — idx_lp_opens_user_recent, idx_lp_downloads_user_time, idx_lp612_deliveries_user_recent.
 */
const ACTIVITY_CTE = `
  lp_activity AS (
    SELECT o.plan_kind AS kind, o.plan_ref AS ref, o.lang, o.opened_at AS at, 'portal' AS via
      FROM niete_lp_opens o
     WHERE o.user_id = $1::uuid AND ${pkInstantWindow('o.opened_at', '$2', '$3')}
    UNION ALL
    SELECT 'k5', d.lesson_id, NULL, d.created_at, 'whatsapp'
      FROM niete_lp_downloads d
     WHERE d.user_id = $1::uuid AND d.status = 'sent' AND ${pkInstantWindow('d.created_at', '$2', '$3')}
    UNION ALL
    SELECT 'g612', g.segment_id, g.lang, g.delivered_at, 'whatsapp'
      FROM niete_lp612_deliveries g
     WHERE g.user_id = $1::uuid AND ${pkInstantWindow('g.delivered_at', '$2', '$3')}
  )`;

/** The count columns, over lp_activity — selected by the Home's single counts statement. */
const COUNT_COLUMNS = `
  (SELECT count(DISTINCT kind || ':' || ref) FROM lp_activity) AS lp_used,
  (SELECT count(DISTINCT kind || ':' || ref) FROM lp_activity WHERE via = 'portal') AS lp_opened,
  (SELECT count(DISTINCT kind || ':' || ref) FROM lp_activity WHERE via = 'whatsapp') AS lp_received,
  (SELECT count(DISTINCT ${pkDaySql('at')}) FROM lp_activity) AS lp_days`;

/** One row per plan, most recently used first. $4 = limit. */
const PLANS_SQL = `
  WITH ${ACTIVITY_CTE}
  SELECT kind, ref,
         (array_agg(lang ORDER BY at DESC) FILTER (WHERE lang IS NOT NULL))[1] AS lang,
         max(at) AS last_used_at,
         max(at) FILTER (WHERE via = 'portal') AS last_opened_at,
         max(at) FILTER (WHERE via = 'whatsapp') AS last_received_at
    FROM lp_activity
   GROUP BY kind, ref
   ORDER BY last_used_at DESC, kind, ref
   LIMIT $4`;

const iso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * Shape plan rows for a client, named by the bot. `describe` is LpCatalogue.describePlans; it
 * THROWS on a transport failure, and that is left to propagate (a list of unnamed plans is not
 * an answer — the route turns it into a 502 she can retry).
 */
async function namePlans(rows, describe) {
  if (!rows.length) return [];
  const asked = rows.map((r) => ({ kind: r.kind, ref: r.ref, lang: r.lang || null }));
  const named = await describe(asked);
  const byKey = new Map((named || []).map((n) => [`${n.kind}:${n.ref}:${n.lang || ''}`, n]));

  return rows.map((r) => {
    const lang = r.lang || null;
    const n = byKey.get(`${r.kind}:${r.ref}:${lang || ''}`) || {};
    const k5 = r.kind === 'k5';
    return {
      planKey: `${r.kind}:${r.ref}`,
      kind: r.kind,
      ...(k5 ? { lessonId: r.ref } : { segmentId: r.ref, lang }),
      found: n.found === true,
      title: n.title || null,
      grade: n.grade ?? null,
      subject: n.subject || null,
      chapterNumber: n.chapterNumber ?? null,
      chapterTitle: n.chapterTitle || null,
      dayLabel: n.dayLabel || null,
      pagesLabel: n.pagesLabel || null,
      lastUsedAt: iso(r.last_used_at),
      lastOpenedAt: iso(r.last_opened_at),
      lastReceivedAt: iso(r.last_received_at),
      // What the portal needs to open it again — and what Coaching's lesson-plan pick takes.
      open: k5 ? { lane: 'k5', lessonId: r.ref } : { lane: 'g612', segmentId: r.ref, lang: lang || 'en' },
    };
  });
}

/**
 * Plans used inside [from, to] (Pakistan dates; null = open), most recent first, named.
 * @param {{ from?: string|null, to?: string|null, limit: number, describe: Function }} opts
 */
async function plansUsed(query, userId, { from = null, to = null, limit, describe }) {
  const { rows } = await query(PLANS_SQL, [userId, from, to, limit]);
  return namePlans(rows || [], describe);
}

/** Her recent lesson plans, all time — "last opened" and Coaching's recent list. */
async function recentPlans(query, userId, { limit, describe }) {
  return plansUsed(query, userId, { from: null, to: null, limit, describe });
}

module.exports = {
  KINDS,
  SOURCES,
  DEDUPE_MINUTES,
  ACTIVITY_CTE,
  COUNT_COLUMNS,
  recordOpen,
  logOpen,
  plansUsed,
  recentPlans,
};
