'use strict';
/**
 * bd-qvevax.3 — the K-5 lesson plans a teacher READ IN THE TEACHER APP, shaped as the
 * WhatsApp-delivered plans (`niete_lp_downloads` rows) the 15:00 quiz offer already knows.
 *
 * WHY IT EXISTS. Since 12 Oct 2026 01:53 PKT every registered teacher who asks for a plan gets an
 * "Open in app" button; the app writes `niete_lp_opens` and NOT `niete_lp_downloads`. The 15:00
 * offer built its cohort from `niete_lp_downloads` (status 'sent') alone, so a plan read in the app
 * never earned its teacher an offer: lp_v8 quizzes fell from 34-64 a day to 9 and 6.
 *
 * WHAT COUNTS. Every `niete_lp_opens` row with plan_kind 'k5', whatever its source: the portal's
 * own viewer ('viewer') or a hand-off to another app ('external'). A hand-off only ever starts
 * inside the app, so it is a plan taken like any other (operator, 14 Oct 2026; bd-2wgr3d.22.1).
 * One open == one delivery. The function names still say "viewer" — they predate that rule.
 *
 * NO SWITCH. App opens always count: the fixes are part of the app-link feature, and the app link
 * (portal_teacher_v2 + app_redirect_*) is the only on/off. LP_QUIZ_COUNT_APP_OPENS is gone.
 *
 * WHAT IT RETURNS. Rows with the columns the offer reads from a download — lesson_id, asset_id,
 * version_stamp, content_hash, grade, subject, chapter_number, segment_index, created_at
 * (= opened_at) — so the offer's own rules (14:00 rule, assessment/answer-key exclusion, exact
 * slide-script check, grouping and de-duplication by lesson) run on them unchanged. grade/subject
 * come from the catalogue exactly as lp-v8-delivery writes them, so a plan delivered AND opened
 * falls in the same class. The version is the lesson asset the app's Open served her when she
 * opened it — never a later push: a quiz written from a script of a different version would ask
 * about a page she did not read. That is the asset current then (created <= opened_at, not yet
 * superseded), except for a teacher in A/B group A on an in-scope chapter while the A/B flag is on:
 * the app served her the August version (lp-v8-browse lessonPdfUrl → lp-ab-ch310), so the newest
 * August row that existed at the open (lp-ab-ch310 pickAsset, groupsForUsers + inScope).
 *
 * READERS. The 15:00 offer (viewerOpensAsDownloads, a time window over every teacher), the
 * /quiz "from my lesson plan" list (viewerOpensForTeacher / viewerOpenById, one teacher, on
 * idx_lp_opens_user_recent), the chat's lesson context (teacherViewerOpens, the same per-teacher
 * read), the coaching subject's
 * recent-plan tier (teacherViewerOpens) and the transcript quiz's lesson hint
 * (teacherViewerOpensBetween). All shape rows the same way; mergeByLesson joins them to the
 * WhatsApp deliveries, one entry per lesson.
 *
 * Grades 6-12 are not here: the 15:00 offer has never covered them (its WhatsApp side reads
 * niete_lp_downloads only).
 *
 * Load (Class R): the cohort build runs once a day on the worker; niete_lp_opens is a few thousand
 * rows, read in a bounded window (<= 4 days) in pages of 1000.
 */

const supabase = require('../../config/supabase');
const { pagedRows } = require('../../utils/postgrest-paged');
const { logToFile } = require('../../utils/logger');
const Catalog = require('../lp-v8-catalog.service');
const LpAb = require('../lp-ab-ch310.service');

const OPENS = 'niete_lp_opens';
const ASSETS = 'niete_lp_assets';
const IN_CHUNK = 200;

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function isMissingTable(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === '42P01'
    || /does not exist|schema cache/i.test(String((error && error.message) || ''));
}

/**
 * The asset a teacher was served when she opened `lessonId` at `at`: the newest lesson asset made
 * on or before the open that was not yet superseded; failing that, the current one.
 */
function servedAsset(assets, at) {
  const t = new Date(at).getTime();
  const live = assets
    .filter((a) => new Date(a.created_at).getTime() <= t
      && (!a.superseded_at || new Date(a.superseded_at).getTime() > t))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return live[0] || assets.find((a) => a.is_current) || null;
}

/** A split day-2 lesson (…seg4b) → its day 1 (…seg4), whose August plan group A is served. */
const day1Of = (lessonId) => String(lessonId).replace(/(seg\d+)b$/, '$1');

/** lesson_id -> its lesson assets (every version), IN-chunked. Throws on a read error. */
async function assetsByLesson(lessonIds) {
  const byLesson = new Map();
  for (const part of chunks([...new Set(lessonIds)])) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from(ASSETS)
      .select('id, lesson_id, asset_kind, version_stamp, content_hash, is_current, superseded_at, created_at')
      .eq('asset_kind', 'lesson')
      .in('lesson_id', part);
    if (error) throw new Error(`lp app opens: assets: ${error.message || error}`);
    for (const a of data || []) {
      if (!byLesson.has(a.lesson_id)) byLesson.set(a.lesson_id, []);
      byLesson.get(a.lesson_id).push(a);
    }
  }
  return byLesson;
}

/**
 * Viewer opens in [fromIso, toIso) as download-shaped rows. [] when off, when the table is not on
 * this database, or when there are none. Throws on any other read error: a cohort built without
 * its app-open teachers would never be rebuilt that day (alreadyBuilt), so the build fails and the
 * next tick retries.
 *
 * @param {string} fromIso inclusive
 * @param {string} toIso   exclusive
 * @returns {Promise<Array<object>>}
 */
async function viewerOpensAsDownloads(fromIso, toIso) {
  let opens;
  try {
    opens = await readOpens(fromIso, toIso);
  } catch (err) {
    if (err.missingTable) {
      logToFile('⚠️ lp app opens: niete_lp_opens is not on this database — app opens do not count', { error: err.message }, 'warn');
      return [];
    }
    throw err;
  }
  return shape(opens);
}

/**
 * Opens → download-shaped rows: catalogue fields + the asset the app served her at the open.
 * An unknown lesson, or one with nothing served, is left out (never a quiz source).
 */
async function shape(opens) {
  if (!opens.length) return [];
  const hits = new Map(opens.map((o) => [o.plan_ref, Catalog.lessonById(o.plan_ref)]));
  // A/B: the group per teacher (one flag read; nothing more when the flag is off), then the
  // per-lesson scope groupFor applies — only an in-scope group-A open differs from today's rule.
  const groups = await LpAb.groupsForUsers([...new Set(opens.map((o) => o.user_id))]);
  const groupOf = (o) => {
    const hit = hits.get(o.plan_ref);
    const inScope = hit && LpAb.inScope({ grade: Number(hit.book.grade), chapter: Number(hit.chapter.number) });
    return inScope ? groups.get(o.user_id) || null : null;
  };
  const lessonIds = new Set(opens.map((o) => o.plan_ref));
  opens.filter((o) => groupOf(o) === 'A').forEach((o) => lessonIds.add(day1Of(o.plan_ref)));
  const assets = await assetsByLesson([...lessonIds]);
  const out = [];
  for (const o of opens) {
    const hit = hits.get(o.plan_ref);
    const asset = groupOf(o) === 'A'
      ? LpAb.pickAsset({
        group: 'A', lessonId: o.plan_ref, at: o.opened_at,
        assets: [...(assets.get(o.plan_ref) || []), ...(assets.get(day1Of(o.plan_ref)) || [])],
      })
      : servedAsset(assets.get(o.plan_ref) || [], o.opened_at);
    if (!hit || !asset) continue;           // unknown lesson / nothing served: never a quiz source
    out.push({
      id: o.id,
      user_id: o.user_id,
      lesson_id: o.plan_ref,
      asset_id: asset.id,
      version_stamp: asset.version_stamp,
      content_hash: asset.content_hash,
      grade: String(hit.book.grade),
      subject: hit.book.subject_key,
      chapter_number: hit.chapter.number,
      segment_index: hit.lesson.segment_index,
      status: 'sent',
      created_at: o.opened_at,
      via: 'app',
    });
  }
  return out;
}

/**
 * One teacher's app opens since `sinceIso`, newest first, at most `limit` — the /quiz list.
 * Throws on a read error (the caller lists the WhatsApp lessons regardless).
 */
async function viewerOpensForTeacher(userId, sinceIso, limit = 200) {
  return teacherViewerOpens(userId, sinceIso, limit);
}

/**
 * The same read and shape, for the chat's lesson context, the coaching subject and the coaching
 * plan pick. Throws on a read error.
 */
async function teacherViewerOpens(userId, sinceIso, limit = 200) {
  if (!userId) return [];
  const { data, error } = await supabase.from(OPENS)
    .select('id, user_id, plan_ref, opened_at')
    .eq('user_id', userId)
    .eq('plan_kind', 'k5')
    .gte('opened_at', sinceIso)
    .order('opened_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`lp app opens: teacher opens: ${error.message || error}`);
  return shape(data || []);
}

/**
 * The same per-teacher read, bounded on both sides: opens in [fromIso, toIso], newest first, at
 * most `limit`. For a reader whose window sits around a past moment (the transcript quiz's lesson
 * hint, -36 h..+6 h around the recording) rather than reaching to now. Throws on a read error.
 */
async function teacherViewerOpensBetween(userId, fromIso, toIso, limit = 50) {
  if (!userId) return [];
  const { data, error } = await supabase.from(OPENS)
    .select('id, user_id, plan_ref, opened_at')
    .eq('user_id', userId)
    .eq('plan_kind', 'k5')
    .gte('opened_at', fromIso)
    .lte('opened_at', toIso)
    .order('opened_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`lp app opens: teacher opens: ${error.message || error}`);
  return shape(data || []);
}

/**
 * WhatsApp deliveries + app opens (download-shaped) → one row per lesson, newest first. A lesson on
 * both surfaces keeps the WhatsApp row (its version is what she was sent) at the newer of the two
 * times. A row with no lesson_id is never merged with another.
 */
function mergeByLesson(downloads, appRows) {
  const byLesson = new Map();
  let anon = 0;
  for (const row of [...(downloads || []), ...(appRows || [])]) {
    const key = row.lesson_id || `__no_lesson_${anon++}`;
    const cur = byLesson.get(key);
    if (!cur) { byLesson.set(key, { ...row }); continue; }
    const newer = new Date(row.created_at) > new Date(cur.created_at);
    if (cur.via !== 'app' && row.via === 'app') {
      if (newer) cur.created_at = row.created_at;
    } else if (newer) {
      byLesson.set(key, { ...row });
    }
  }
  return [...byLesson.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** One of her viewer opens by id, shaped — owner-filtered in the query. null when off or not hers. */
async function viewerOpenById(userId, openId) {
  if (!userId || !openId) return null;
  const { data, error } = await supabase.from(OPENS)
    .select('id, user_id, plan_ref, opened_at')
    .eq('id', openId)
    .eq('user_id', userId)
    .eq('plan_kind', 'k5')
    .maybeSingle();
  if (error) throw new Error(`lp app opens: open: ${error.message || error}`);
  if (!data) return null;
  const [row] = await shape([data]);
  return row || null;
}

async function readOpens(fromIso, toIso) {
  // pagedRows swallows an error into [] — a read that must not be mistaken for "no opens" is probed
  // first, so a missing table or a failing database is told apart from an empty window.
  const probe = await supabase.from(OPENS).select('id').limit(1);
  if (probe && probe.error) {
    const err = new Error(`lp app opens: ${probe.error.message || probe.error}`);
    err.missingTable = isMissingTable(probe.error);
    throw err;
  }
  return pagedRows('lp app opens: viewer opens', () => supabase.from(OPENS)
    .select('id, user_id, plan_ref, opened_at')
    .eq('plan_kind', 'k5')
    .gte('opened_at', fromIso)
    .lt('opened_at', toIso)
    .order('opened_at', { ascending: true })
    .order('id', { ascending: true }));
}

module.exports = {
  viewerOpensAsDownloads, viewerOpensForTeacher, teacherViewerOpens, teacherViewerOpensBetween,
  viewerOpenById, mergeByLesson, servedAsset,
};
