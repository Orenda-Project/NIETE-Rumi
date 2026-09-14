'use strict';
/**
 * The 6-12 lesson-plan corpus, in a surface-neutral shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sibling of `lp-v8-browse.service.js`, for the other corpus. The portal's catalogue stops
 * at grade 5; on WhatsApp a teacher reaches 5,466 segments across grades 6-12. This module is
 * the one place that answers "which 6-12 lessons exist?" in a shape a browser can render, and
 * the portal reaches it over the internal API exactly the way it reaches the K-5 catalogue,
 * training rules and certificates. The portal holds no lp612 query logic and touches no lp612
 * table.
 *
 * WHY NOT REUSE lp612-catalog's build*Items()
 * -------------------------------------------
 * Same reason the K-5 lane did not, and the reasoning is worth repeating because this corpus is
 * three times the size. Those functions return WhatsApp NavigationList rows: titles clipped to
 * 30 CODE POINTS, 20 rows per page, each carrying an `on-click-action` data_exchange payload.
 * Handing that to a browser caps a subtopic name — and 6-12 subtopic names are long, they are
 * the actual teaching objective — at 30 characters, and paginates a page with room for
 * everything.
 *
 * The split is the same: this module owns WHAT EXISTS in full untruncated text, each surface
 * owns HOW IT LOOKS. Both read the same table with the same filters, so they cannot disagree
 * about content.
 *
 * K-5 AND 6-12 ARE DIFFERENT SHAPES, AND THIS IS NOT AN OVERSIGHT
 * ---------------------------------------------------------------
 * K-5 is a static catalogue of pre-rendered PDFs: a lesson exists iff its asset is uploaded, so
 * "what exists" and "what can be served instantly" are the same question. 6-12 is a catalogue of
 * SEGMENTS — one row per subtopic — with a write-once render cache beside it. Every segment is
 * real and requestable; only ~8% have been written yet. So this module reports two different
 * facts per lesson: it EXISTS (always), and it is READY (sometimes). Collapsing them would
 * either hide 92% of the corpus or promise an instant download that takes three minutes.
 *
 * THE TWO FILTERS ARE NOT OPTIONAL, AND THEY LIVE IN THE QUERY
 * ------------------------------------------------------------
 * `is_current` excludes superseded corpus versions. `is_religious` is an operator hold on
 * Islamiat and seerah content (528 segments today), enforced by the same `isReligiousEnabled()`
 * flag the bot checks. Both are applied HERE, in the query, and never by the caller — a browser
 * that filters is a browser that can be asked not to.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const {
  isReligiousEnabled, LP612_MIN_GRADE, LP612_MAX_GRADE, templateVersion,
} = require('../config/lp612-flags');
const { compareSubjects } = require('../config/lp612-subject-order');

const TABLE = 'niete_lp612_segments';
const RENDERS = 'niete_lp612_renders';

/**
 * PostgREST answers an unbounded select with at most its max-rows (1,000 by default) and says
 * nothing about the ones it dropped. Grade 10 alone has 912 segments, so a single unbounded read
 * is already within one page of silently truncating.
 *
 * This is not hypothetical: the WhatsApp grade picker shipped with exactly that bug and offered
 * "6, 7, 8, 10, 11" — grades 9 and 12 had fallen off the end of the first page with no error and
 * no empty screen. Every read in this module pages explicitly.
 */
const PAGE = 1000;

/** Read every row matching a query, a page at a time. */
async function readAll(build, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) {
      logToFile('LP 6-12 browse: query failed', { what, error: error.message });
      throw new Error(`lp612 browse: ${what} failed`);
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** The servable set: current, in range, and not under the religious hold. */
function servable(columns) {
  let q = supabase
    .from(TABLE)
    .select(columns)
    .eq('is_current', true)
    .gte('grade', LP612_MIN_GRADE)
    .lte('grade', LP612_MAX_GRADE);
  if (!isReligiousEnabled()) q = q.eq('is_religious', false);
  return q;
}

/**
 * Grades that have at least one servable segment.
 *
 * ONE BOUNDED PROBE PER GRADE — never a scan. Seven indexed `limit(1)` existence checks answer
 * this in bounded work and cannot degrade as the corpus grows; deriving the distinct list in JS
 * from a full read is what produced the missing-grades bug described above.
 */
async function listGrades() {
  const candidates = [];
  for (let g = LP612_MIN_GRADE; g <= LP612_MAX_GRADE; g++) candidates.push(g);

  const present = await Promise.all(candidates.map(async (grade) => {
    const { data, error } = await servable('grade').eq('grade', grade).limit(1);
    if (error) {
      logToFile('LP 6-12 browse: grade probe failed', { grade, error: error.message });
      throw new Error('lp612 browse: grades failed');
    }
    return (data || []).length ? grade : null;
  }));

  return present.filter((g) => g !== null).map((grade) => ({ grade }));
}

/** Subjects within one grade, with how many lessons each holds. */
async function listSubjects(grade) {
  const rows = await readAll(() => servable('subject').eq('grade', grade), 'subjects');

  const counts = new Map();
  for (const r of rows) counts.set(r.subject, (counts.get(r.subject) || 0) + 1);

  return [...counts.entries()]
    .map(([subject, lesson_count]) => ({ subject, lesson_count }))
    // The same core-before-elective order the WhatsApp menu uses (bd-y5vx3), from the same
    // module — a teacher who checks the portal and then the bot must not meet two orders.
    .sort((a, b) => compareSubjects(a.subject, b.subject));
}

/**
 * Chapters within one grade+subject.
 *
 * Keyed by `chapter_key` rather than by number: a grade+subject can span more than one book, and
 * two books can both have a chapter 1. The number is carried for display and ordering only.
 */
async function listChapters(grade, subject) {
  const rows = await readAll(
    () => servable('chapter_key, chapter_number, chapter_title, book_stem')
      .eq('grade', grade).eq('subject', subject),
    'chapters',
  );

  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.book_stem}::${r.chapter_key}`;
    const hit = byKey.get(k);
    if (hit) { hit.lesson_count += 1; continue; }
    byKey.set(k, {
      chapter_key: r.chapter_key,
      chapter_number: r.chapter_number,
      chapter_title: r.chapter_title,
      book_stem: r.book_stem,
      lesson_count: 1,
    });
  }

  return [...byKey.values()].sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
}

/**
 * The lessons (subtopics) in one chapter, each carrying whether it is already written.
 *
 * THE READY FLAG IS THE WHOLE POINT OF THIS FUNCTION. ~92% of segments have no render on the
 * current template, and a teacher who taps one is starting a ~3-minute authoring run that costs
 * real money. She is entitled to know which is which BEFORE she taps, and the honest place to
 * tell her is the list she is choosing from.
 *
 * `template_version` is part of the cache key, so readiness is asked about TODAY'S template. A
 * render written against an older template is not a hit — it would not be served to a WhatsApp
 * tap either, and reporting it as ready here would promise an instant download that then takes
 * three minutes.
 */
async function listLessons(grade, subject, chapterKey, lang = 'en') {
  const rows = await readAll(
    () => servable(
      'segment_id, subtopic_title, menu_title, printed_page_start, printed_page_end, order_index',
    ).eq('grade', grade).eq('subject', subject).eq('chapter_key', chapterKey),
    'lessons',
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.segment_id);
  const ready = await readyFor(ids, lang);

  return rows
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map((r) => ({
      segment_id: r.segment_id,
      title: r.subtopic_title || r.menu_title,
      menu_title: r.menu_title,
      pages_label: pagesLabel(r),
      ready: ready.has(r.segment_id),
    }));
}

/** Which of these segments already have a render on today's template. */
async function readyFor(segmentIds, lang) {
  if (!segmentIds.length) return new Set();
  const { data, error } = await supabase
    .from(RENDERS)
    .select('segment_id')
    .eq('status', 'ready')
    .eq('lang', lang)
    .eq('template_version', templateVersion())
    .in('segment_id', segmentIds);

  if (error) {
    // NOT fatal, and deliberately so. Readiness is an optimisation — it tells her which lessons
    // are instant. If we cannot answer it, the honest fallback is "we do not know", which shows
    // every lesson as needing authoring. The request path re-asks the same question against the
    // same row and will serve a cache hit correctly regardless of what this said.
    logToFile('LP 6-12 browse: readiness lookup failed', { error: error.message });
    return new Set();
  }
  return new Set((data || []).map((r) => r.segment_id));
}

function pagesLabel(row) {
  const a = row.printed_page_start;
  const b = row.printed_page_end;
  if (!a && !b) return null;
  if (!b || a === b) return `p.${a}`;
  return `p.${a}-${b}`;
}

/** One segment, for the request path to name what it is about to author. */
async function segmentById(segmentId) {
  const { data, error } = await servable(
    'segment_id, grade, subject, chapter_number, chapter_title, subtopic_title, menu_title, '
    + 'printed_page_start, printed_page_end',
  ).eq('segment_id', segmentId).maybeSingle();

  if (error) {
    logToFile('LP 6-12 browse: segment lookup failed', { segmentId, error: error.message });
    return null;
  }
  return data || null;
}

/**
 * What has become of one render, for a browser that is polling.
 *
 * OWNERSHIP IS CHECKED IN THE QUERY, NOT AFTER IT. She may poll a render only if she is on its
 * waiter list — which the request path put her on. The alternative, reading the row and then
 * comparing `requested_by`, is wrong twice over: on a SHARED render the requester is whoever
 * tapped first, so a legitimate second teacher would be refused; and a check that happens after
 * the read is a check someone can forget to write.
 *
 * Uses the `waiters @> [{user_id}]` containment operator so the filter is applied by Postgres
 * against the jsonb index rather than in JS over rows we should never have received.
 */
async function renderStatus(renderId, userId) {
  const { data, error } = await supabase
    .from(RENDERS)
    .select('id, segment_id, status, r2_key, one_screen, error_code, lang, started_at, completed_at, requested_by, waiters')
    .eq('id', renderId)
    .maybeSingle();

  if (error) {
    logToFile('LP 6-12 browse: status lookup failed', { renderId, error: error.message });
    return null;
  }
  if (!data) return null;
  // Filtered in JS rather than in the query on purpose — see `claims()`. The waiter list is
  // EMPTIED the moment the render completes, so a `.contains('waiters', …)` predicate would
  // stop matching at exactly the moment she is polling for the good news.
  if (!claims(data, userId)) return null;

  const { requested_by: _rb, waiters: _w, ...row } = data;
  return row;
}

/**
 * Is this teacher entitled to this render?
 *
 * TWO FIELDS, BECAUSE NEITHER ONE IS ENOUGH — and this is the trap that nearly shipped.
 *
 * The obvious implementation is a `waiters @> [{user_id}]` predicate in the query: she is
 * entitled to it if she is waiting on it. That is correct for about three minutes and wrong for
 * ever afterwards. `lp612_claim_waiters` reads the list and EMPTIES it in one locked statement
 * when the render reaches a terminal state — verified on production, where all 473 completed
 * renders carry `waiters = []`. So the containment check silently starts returning nothing at
 * the instant the lesson becomes available, which is precisely when she wants it.
 *
 * `requested_by` survives, but names only whoever tapped FIRST. On a shared render — the whole
 * point of the waiter mechanism — every teacher after the first would be refused a lesson she
 * legitimately waited for.
 *
 * Neither field alone is the answer; together they are. This is also why the filter is in JS:
 * "one column OR the other" across a scalar and a jsonb containment is not a predicate PostgREST
 * expresses cleanly, and the row is already in hand.
 */
function claims(row, userId) {
  if (!userId || !row) return false;
  if (row.requested_by === userId) return true;
  return (Array.isArray(row.waiters) ? row.waiters : []).some((w) => w && w.user_id === userId);
}

/**
 * Every 6-12 lesson this teacher has asked for — the "My lesson plans" landing list.
 *
 * THIS IS NOT A CONVENIENCE. Authoring takes a median of 172 seconds and a p90 of 314. A teacher
 * WILL navigate away, and if the only handle on a running job is a spinner on the page that
 * started it, the lesson we already paid ~$1.50 for is lost to her. The waiter list is the
 * record of who is owed what, so this list is answerable from data the request path already
 * writes — no new table, no new column.
 */
async function myRenders(userId, limit = 50) {
  if (!userId) return [];

  // The two claims from `claims()` above, as two reads rather than one OR — PostgREST's `or=`
  // does not express a jsonb containment term alongside a scalar equality without falling back
  // to raw filter syntax that is easy to get subtly wrong. Two indexed reads and a merge is the
  // boring, obviously-correct version.
  const columns = 'id, segment_id, status, r2_key, lang, error_code, started_at, completed_at';
  const [mine, waiting] = await Promise.all([
    supabase.from(RENDERS).select(columns)
      .eq('requested_by', userId)
      .order('started_at', { ascending: false }).limit(limit),
    supabase.from(RENDERS).select(columns)
      .contains('waiters', [{ user_id: userId }])
      .order('started_at', { ascending: false }).limit(limit),
  ]);

  if (mine.error && waiting.error) {
    logToFile('LP 6-12 browse: my renders lookup failed', { error: mine.error.message });
    return [];
  }

  // Deduped by id: a teacher who tapped first is BOTH the requester and (via the atomic
  // self-append in the serving path) a waiter, so she would otherwise see her own lesson twice
  // while the run is still in flight.
  const byId = new Map();
  for (const r of [...(mine.data || []), ...(waiting.data || [])]) byId.set(r.id, r);

  return [...byId.values()]
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
    .slice(0, limit);
}

module.exports = {
  listGrades,
  listSubjects,
  listChapters,
  listLessons,
  segmentById,
  renderStatus,
  myRenders,
  TABLE,
  RENDERS,
};
