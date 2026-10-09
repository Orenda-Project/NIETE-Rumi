'use strict';
/**
 * The WhatsApp fallback for a finished paper or grades 6-12 lesson plan she did not see (bd-fmf24g.15).
 *
 * WHAT IT IS. In the teacher app a ready item is announced by a banner for 10 seconds, then waits on Home. If she
 * never saw it — the app was closed, the phone was down — one WhatsApp message follows: a UTILITY template with the PDF
 * in a document header and an "Open in app" button that lands on the item. It is decided HERE, on the server, by a
 * sweep, because the app may be closed and so cannot be the thing that sends.
 *
 * BUILT SWITCHED OFF. `app_settings.portal_ready_whatsapp_enabled` (absent, false or unreadable = off) and the
 * allow-list `portal_ready_whatsapp_teachers` ("all" or a list holding her user id). Fail closed, like every web link
 * (portal-web-link.js). Turning it ON needs the two templates approved on that environment's WABA and the operator's
 * go (infrastructure/templates/drafts/README.md): until then nothing is ever sent.
 *
 * WHO GETS A MESSAGE. An item that became ready at least 30 seconds ago (the 10-second banner + the app's polling gap +
 * slack) and is NEITHER seen (she closed the banner with its X) NOR opened (any way: the banner, Home, a list, a link,
 * or — for a lesson plan — a niete_lp_opens row) NOR already messaged. Portal requests only; a paper asked for on
 * WhatsApp already reached her there. A plan is "made for her" only if she WAITED for it (delivered within two minutes
 * of the render completing); one that was already written when she asked she opened at once.
 * A FAILURE is never sent: nothing was made, so there is nothing to deliver — the app shows it, and keeps the row until
 * she taps it.
 *
 * AT MOST ONE MESSAGE PER ITEM. Everything the message needs is built first; then ONE conditional UPDATE
 * (`notice_whatsapp_at` set where it, `notice_opened_at` and `notice_seen_at` are all null, RETURNING the row) claims
 * the item; only the sweep that gets the row back sends. Two replicas ticking in the same second send one message. A
 * refused send is logged at ERROR and is NOT retried (a missed message beats a duplicate).
 *
 * PRE-MERGE CLASSES. G: a UTILITY template only, never free text (she may be outside the 24-hour window). M: every
 * template field is inside its cap, held by a test against the drafts. N: every failure is logged at error. P: the
 * interval's first run is 90 s after boot (a redeploy cannot reset it for ever), owned by the worker that owns the
 * `main` queue (the video worker registers nothing). R: bounded per tick (LIMIT), narrow columns, partial-indexed
 * filters (V1.6.3), no fat JSONB; OFF costs one cached app_settings read per 30 seconds.
 *
 * NOTHING HERE THROWS. A sweep that can throw takes the worker's interval with it.
 */

const supabase = require('../config/supabase');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { signPortalLink } = require('./portal-link-token');
const Deliveries = require('./lp612-deliveries.store');
const { subjectLabel } = require('./assessment/assessment-vocabulary');
const { buildSend } = require('./portal-ready-templates');
const { isTrue, parse, teacherAllowed, TEMPLATE_LANGUAGES } = require('./portal-web-link');

const SETTING_ENABLED = 'portal_ready_whatsapp_enabled';
const SETTING_TEACHERS = 'portal_ready_whatsapp_teachers';
const SETTINGS_TTL_MS = 30 * 1000;

/** Banner 10 s + the app's polling gap (<= 15 s) + slack. */
const READY_AFTER_MS = 30 * 1000;
/** How far back an item is still chased. A message long after the fact is not a reminder. */
const LOOKBACK_MS = 60 * 60 * 1000;
/** A delivery within this of the render completing is one she WAITED for. */
const WAITED_MS = 120 * 1000;
const PER_TICK = 10;
/** Lessons are over-read: cache-hit rows she opened at once stay candidates until they age out. */
const LESSON_OVERREAD = 5;

const FIRST_RUN_MS = 90 * 1000;
const SWEEP_EVERY_MS = 20 * 1000;

const errorLog = (message, data) => logToFile(`❌ portal_ready_whatsapp: ${message}`, data, 'error');

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */

let cache = null; // { at, enabled, teachers }

async function readSwitch(nowMs = Date.now()) {
  if (cache && nowMs - cache.at < SETTINGS_TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SETTING_ENABLED, SETTING_TEACHERS]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: nowMs, enabled: isTrue(byKey[SETTING_ENABLED]), teachers: parse(byKey[SETTING_TEACHERS]) };
    return cache;
  } catch (err) {
    // Fail closed, and do not cache the failure: the next tick asks again.
    logToFile('portal_ready_whatsapp: settings lookup failed — the fallback stays off this tick', { error: err.message }, 'warn');
    return { enabled: false, teachers: null };
  }
}

/* ── candidates ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** The languages the templates are approved in; English is the floor (language-protocol: NIETE is flat en/ur). */
const templateLang = (code) => (TEMPLATE_LANGUAGES.includes(code) ? code : TEMPLATE_LANGUAGES[0]);

/** PostgREST embeds a one-to-many as an array and a many-to-one as an OBJECT (verified against the live sandbox). */
const first = (embedded) => (Array.isArray(embedded) ? embedded[0] : embedded) || null;
const gradeOf = (code) => Number(String(code || '').replace(/^grade_/, '')) || null;
const iso = (ms) => new Date(ms).toISOString();

/** Ready portal papers nobody has seen, opened or been messaged about. */
async function findPapers({ sinceIso, dueIso, limit }) {
  const { data, error } = await supabase.from('assessment_requests')
    .select('id, user_id, grade_code, subject_code, chapter_number, question_count, created_at, '
      + 'assessment_papers!inner(id, status, ready_at, edited_from, file_r2_key, question_count)')
    .eq('surface', 'portal')
    .is('notice_seen_at', null)
    .is('notice_opened_at', null)
    .is('notice_whatsapp_at', null)
    .gte('created_at', sinceIso)
    .eq('assessment_papers.status', 'ready')
    .is('assessment_papers.edited_from', null)
    .lte('assessment_papers.ready_at', dueIso)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message || 'papers read failed');
  return (data || []).map((r) => {
    const p = first(r.assessment_papers) || {};
    return {
      kind: 'paper',
      id: r.id,
      userId: r.user_id,
      readyAt: p.ready_at,
      itemRef: `paper:${r.id}`,
      r2Key: p.file_r2_key || null,
      grade: gradeOf(r.grade_code),
      subjectKey: r.subject_code,
      chapterNumber: r.chapter_number,
      questions: p.question_count ?? r.question_count ?? null,
    };
  });
}

/** Ready portal lesson plans she waited for and did not open. */
async function findLessons({ sinceIso, dueIso, limit }) {
  const { data, error } = await supabase.from('niete_lp612_deliveries')
    .select('id, user_id, render_id, segment_id, lang, delivered_at, '
      + 'niete_lp612_renders!inner(status, r2_key, completed_at, template_version)')
    .eq('surface', 'portal')
    .is('notice_seen_at', null)
    .is('notice_opened_at', null)
    .is('notice_whatsapp_at', null)
    .gte('delivered_at', sinceIso)
    .lte('delivered_at', dueIso)
    .eq('niete_lp612_renders.status', 'ready')
    .order('delivered_at', { ascending: false })
    .limit(limit * LESSON_OVERREAD);
  if (error) throw new Error(error.message || 'lessons read failed');
  const waited = (data || []).filter((d) => {
    const r = first(d.niete_lp612_renders);
    return r && r.completed_at && Math.abs(new Date(d.delivered_at).getTime() - new Date(r.completed_at).getTime()) < WAITED_MS;
  });
  if (!waited.length) return [];

  // Opened by ANY way is opened: niete_lp_opens already records every open of a plan in the portal.
  const users = [...new Set(waited.map((d) => d.user_id))];
  const segments = [...new Set(waited.map((d) => d.segment_id))];
  const since = waited.map((d) => d.delivered_at).sort()[0];
  const opens = await supabase.from('niete_lp_opens').select('user_id, plan_ref, lang, opened_at')
    .in('user_id', users).eq('plan_kind', 'g612').in('plan_ref', segments).gte('opened_at', since).limit(200);
  if (opens.error) throw new Error(opens.error.message || 'opens read failed');
  const opened = (d) => (opens.data || []).some((o) => o.user_id === d.user_id && o.plan_ref === d.segment_id
    && (o.lang == null || o.lang === d.lang) && o.opened_at >= d.delivered_at);

  const meta = await supabase.from('niete_lp612_segments').select('segment_id, subtopic_title, menu_title, grade, subject').in('segment_id', segments);
  if (meta.error) throw new Error(meta.error.message || 'segments read failed');
  const byId = new Map((meta.data || []).map((s) => [s.segment_id, s]));

  return waited.filter((d) => !opened(d)).slice(0, limit).map((d) => {
    const r = first(d.niete_lp612_renders);
    const s = byId.get(d.segment_id) || {};
    return {
      kind: 'lesson',
      id: d.id,
      userId: d.user_id,
      readyAt: d.delivered_at,
      itemRef: `lesson:${d.segment_id}:${templateLang(d.lang)}`,
      r2Key: r.r2_key || null,
      renderId: d.render_id,
      segmentId: d.segment_id,
      lang: templateLang(d.lang),
      templateVersion: r.template_version,
      title: s.subtopic_title || s.menu_title || null,
      grade: s.grade == null ? null : Number(s.grade),
      subject: s.subject || null,
    };
  });
}

/* ── one item ───────────────────────────────────────────────────────────────────────────────────────────────── */

async function paperTitle(c) {
  try {
    if (c.grade && c.subjectKey && c.chapterNumber != null) {
      const Browse = require('./assessment/assessment-browse.service');
      const chapters = await Browse.listChapters(c.grade, c.subjectKey);
      const hit = (chapters || []).find((x) => Number(x.chapter_number) === Number(c.chapterNumber));
      if (hit && hit.chapter_title) return hit.chapter_title;
    }
  } catch (err) {
    logToFile('portal_ready_whatsapp: chapter title lookup failed — naming the paper by its chapter number', { error: err.message }, 'warn');
  }
  return c.chapterNumber != null ? `Chapter ${c.chapterNumber}` : `${subjectLabel(c.subjectKey)} paper`;
}

/** Everything the send needs, built BEFORE the claim so a failure to build costs her nothing. Null = skip. */
async function prepare(c, user) {
  const token = signPortalLink(c.userId, 'ready', { i: c.itemRef });
  if (!token) {
    errorLog('no signing secret on this deployment — cannot make the Open in app link', { kind: c.kind, userId: c.userId });
    return null;
  }
  if (!c.r2Key) {
    errorLog('a ready item has no file — nothing to attach', { kind: c.kind, id: c.id });
    return null;
  }
  const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
  const pdfUrl = await getPresignedUrl(buildR2PublicUrl(c.r2Key));
  const lang = templateLang(user.preferred_language);
  if (c.kind === 'paper') {
    return buildSend({
      kind: 'paper', lang, token, pdfUrl, title: await paperTitle(c), grade: c.grade, subject: subjectLabel(c.subjectKey), questions: c.questions,
    });
  }
  return buildSend({ kind: 'lesson', lang, token, pdfUrl, title: c.title, grade: c.grade, subject: c.subject });
}

/** The ONE conditional UPDATE that decides who sends: it returns the row only to the sweep that wins. */
async function claim(c) {
  const table = c.kind === 'paper' ? 'assessment_requests' : 'niete_lp612_deliveries';
  const { data, error } = await supabase.from(table)
    .update({ notice_whatsapp_at: new Date().toISOString() })
    .eq('id', c.id)
    .is('notice_whatsapp_at', null)
    .is('notice_opened_at', null)
    .is('notice_seen_at', null)
    .select('id');
  if (error) throw new Error(error.message || 'claim failed');
  return Array.isArray(data) && data.length === 1;
}

async function handle(c, sw, users, counts) {
  if (!teacherAllowed(sw.teachers, c.userId)) { counts.skipped += 1; return; }
  const user = users.get(c.userId);
  if (!user || !user.phone_number) { counts.skipped += 1; return; }

  let message;
  try {
    message = await prepare(c, user);
  } catch (err) {
    errorLog('could not prepare the message', { kind: c.kind, id: c.id, error: err.message });
    counts.failed += 1;
    return;
  }
  if (!message) { counts.skipped += 1; return; }

  let won;
  try {
    won = await claim(c);
  } catch (err) {
    errorLog('could not claim the item', { kind: c.kind, id: c.id, error: err.message });
    counts.failed += 1;
    return;
  }
  if (!won) return; // another sweep, or she opened it a moment ago: not ours to send
  counts.claimed += 1;

  let sent = false;
  try {
    sent = (await WhatsAppService.sendTemplate(user.phone_number, message.name, message.language, message.components)) === true;
  } catch (err) {
    errorLog('the template send threw', { kind: c.kind, id: c.id, template: message.name, error: err.message });
  }
  if (!sent) {
    // Not retried: the claim stays, so the next tick does not try again. A missed message beats a duplicate.
    errorLog('Meta refused the template — not retried', { kind: c.kind, id: c.id, template: message.name, lang: message.language });
    counts.failed += 1;
    return;
  }
  counts.sent += 1;
  try { logEvent('portal_ready_whatsapp.sent', { kind: c.kind, userId: c.userId, template: message.name, lang: message.language }); } catch (_) { /* logging never decides */ }
  if (c.kind === 'lesson') {
    // It reached her WhatsApp, so it is a normal delivery: it will appear where /quiz lists what she received.
    await Deliveries.record({
      userId: c.userId, renderId: c.renderId, segmentId: c.segmentId, lang: c.lang, templateVersion: c.templateVersion, surface: 'whatsapp',
    });
  }
}

/* ── the sweep ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One tick. Returns what it did; never throws.
 * @param {{ now?: number, limit?: number }} [opts]
 */
async function runSweep({ now = Date.now(), limit = PER_TICK } = {}) {
  const counts = { enabled: false, candidates: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    const sw = await readSwitch();
    if (!sw.enabled) return counts;
    counts.enabled = true;

    const window = { sinceIso: iso(now - LOOKBACK_MS), dueIso: iso(now - READY_AFTER_MS), limit };
    const lists = await Promise.all([findPapers(window), findLessons(window)].map((p) => p.catch((err) => {
      errorLog('could not read the ready items', { error: err.message });
      return [];
    })));
    const all = lists.flat().sort((a, b) => String(a.readyAt).localeCompare(String(b.readyAt))).slice(0, limit);
    counts.candidates = all.length;
    if (all.length) {
      const ids = [...new Set(all.map((c) => c.userId))];
      const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language').in('id', ids);
      if (error) throw new Error(error.message || 'users read failed');
      const users = new Map((data || []).map((u) => [u.id, u]));
      for (const c of all) {
        try { await handle(c, sw, users, counts); } catch (err) {
          errorLog('an item failed', { kind: c.kind, id: c.id, error: err.message });
          counts.failed += 1;
        }
      }
    }
  } catch (err) {
    errorLog('sweep failed', { error: err.message });
  }
  if (counts.candidates) {
    try { logEvent('portal_ready_whatsapp.sweep', { ...counts }); } catch (_) { /* logging never decides */ }
  }
  return counts;
}

/**
 * Register the sweep on the always-on worker. Only the worker that owns the `main` queue registers it (two services run
 * the same file; one owner, so no tick runs twice). The first run is 90 s after boot, THEN the interval starts: a
 * service that redeploys faster than the interval must still get its ticks (pre-merge Class P).
 */
function scheduleSweep({ worker, queues, runSweep: run = runSweep } = {}) {
  if (!queues || typeof queues.has !== 'function' || !queues.has('main')) return { enabled: false, reason: 'main queue not owned' };
  const tick = async () => {
    if (worker && worker.isShuttingDown) return;
    try { await run({}); } catch (err) { errorLog('tick failed', { error: err.message }); }
  };
  let every = null;
  const first = setTimeout(() => {
    tick();
    every = setInterval(tick, SWEEP_EVERY_MS);
  }, FIRST_RUN_MS);
  logToFile('Portal ready WhatsApp fallback sweep registered (OFF unless app_settings.portal_ready_whatsapp_enabled is true)', {
    firstRunSeconds: FIRST_RUN_MS / 1000, everySeconds: SWEEP_EVERY_MS / 1000,
  });
  return {
    enabled: true,
    stop() { clearTimeout(first); if (every) clearInterval(every); },
  };
}

module.exports = {
  runSweep, scheduleSweep, readSwitch,
  READY_AFTER_MS, LOOKBACK_MS, PER_TICK, FIRST_RUN_MS, SWEEP_EVERY_MS,
  SETTING_ENABLED, SETTING_TEACHERS,
  _resetCache: () => { cache = null; },
};
