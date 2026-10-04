'use strict';

/**
 * Child test v2 — the end-of-visit review (bd-s1oo0.46.4, CONTRACT §19 "L28 → L26", design §3.1 "End of visit").
 *
 * The coach gives the test and never scores it. At the end of the visit the coach is asked only what the
 * recording did not settle: question verdicts and oral maths items whose confidence is under their bar
 * (scoring/thresholds.js), across every child of the visit, at most 15. Story and fallback counts are never
 * asked (the AI already agrees with the enumerator more often than a second human does, L23).
 *
 *   visitSummary(lang, visitKey)          one line per child, from ai_marks
 *   doubtfulItems(sessionIds)             { items, aiOnly } — what the form asks, and what stays AI-only past the cap
 *   sendReview(coachUserId, visitKey)     one Flow message; with 0 doubtful items no message, and every block is
 *                                         settled at once as 'ai_unreviewed'
 *   handleReviewCompletion(...)           the nfm_reply: every block of the visit's sessions gets coach_marks
 *                                         (= ai_marks with the reviewed verdicts replaced), coach_edits and
 *                                         checked_at, once (store.saveCoachMarks); a second submit is refused politely
 *
 * The Flow opens in NAVIGATE mode with every item in the message (no endpoint): a coach on weak classroom
 * data waits for no INIT round trip, and the submit travels as an ordinary message that WhatsApp queues and
 * retries, so nothing depends on a 10-second endpoint window. ai_marks are write-once, so the snapshot in the
 * message cannot go stale. Token: <coachUserId>:child-test-check:rv_<base64url(visitKey)> — the check's own
 * marker, so the existing completion detector routes it and completion.js hands it here.
 *
 * Names go to the coach's WhatsApp only, never into a log line or a model prompt. Rolls are never shown (v2).
 *
 * Battery v3 (CONTRACT §21.6, bd-s1oo0.50.5): a visit whose rows are tasks (block = task id) goes to the v3 path,
 * same entry points. Its results are sent as text first (split per child under 4096 code points), then the review
 * comes in pages of whole tasks, one Flow message each on the same REVIEW screen; page p+1 is sent when page p is
 * saved, and saving page p settles that page's task rows. The ref carries the page: rv_<base64url(visitKey#p<n>)>.
 */

const WhatsAppService = require('../../whatsapp.service');
const { logError, logToFile } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const CoreStore = require('../store');
const Store = require('./check-store');
const { formItems } = require('./items');
const { t } = require('../conversation/copy');
const {
  BLOCKS, VERDICTS, MAX_ITEMS, langOf, questionsSkipped, reachedOf, askedOf, reviewTime, selectDoubtful, publicItem, summaryText, reviewScreenData, reviewMessage,
} = require('./review-view');
const { MARKER, enabled } = require('./token');
const V3 = require('./review-v3');
const itemBank = require('../item-bank');

const REF_PREFIX = 'rv_';
const POLL_MS = 3000;

/** CHILD_TEST_CHECK_MODE: 'end_review' (v2, the default) or 'per_child' (v1, the per-child check). */
function checkMode(env = process.env) {
  return String((env && env.CHILD_TEST_CHECK_MODE) || '').trim().toLowerCase() === 'per_child' ? 'per_child' : 'end_review';
}

// ── token ─────────────────────────────────────────────────────────────────────────────────────

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

// v3 pages: '#p<n>' after the visit key (a visit key or a field form id never holds '#').
const PAGE_RX = /#p(\d+)$/;
const reviewRef = (visitKey, page = null) => `${REF_PREFIX}${b64(page ? `${visitKey}#p${page}` : visitKey)}`;
const isReviewRef = (ref) => typeof ref === 'string' && ref.startsWith(REF_PREFIX) && ref.length > REF_PREFIX.length;
const decodedRef = (ref) => (isReviewRef(ref) ? unb64(ref.slice(REF_PREFIX.length)) : null);
const visitOfRef = (ref) => { const v = decodedRef(ref); return v == null ? null : v.replace(PAGE_RX, ''); };
const pageOfRef = (ref) => { const m = PAGE_RX.exec(decodedRef(ref) || ''); return m ? Number(m[1]) : null; };
const buildReviewToken = (coachUserId, visitKey, page = null) => `${coachUserId}:${MARKER}:${reviewRef(visitKey, page)}`;

/** The v3 task's spec from the item bank (L35's getTaskSpec), or null until the bank has it. */
function specFor(entry, task) {
  if (typeof itemBank.getTaskSpec !== 'function') return null;
  try {
    return itemBank.getTaskSpec({ grade: entry.session.grade, set: entry.session.form, task }) || null;
  } catch (err) {
    return null;
  }
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────

/** One child of the visit: the session, its blocks by name, the child (no roll: v2 never shows it), the form's items. */
async function loadEntry(session) {
  const [blocks, child] = await Promise.all([Store.getBlocks(session.id), Store.getChild(session)]);
  if (!blocks.ok) return null;
  return { session, blocks: blocks.blocks, child: { ...child, rollNumber: null }, items: formItems(session.grade, session.form) };
}

async function loadEntries(sessions) {
  const out = [];
  for (const s of sessions) {
    const e = await loadEntry(s);
    if (!e) return { ok: false };
    out.push(e);
  }
  return { ok: true, entries: out };
}

/** The coach's sessions of a visit, in the order they were tested. */
async function loadVisit(visitKey, coachUserId) {
  const r = await CoreStore.listSessionsForVisit(visitKey);
  if (!r.ok) return { ok: false };
  const sessions = (r.sessions || []).filter((s) => !coachUserId || s.coach_user_id === coachUserId);
  return loadEntries(sessions);
}

async function loadSessions(sessionIds) {
  const sessions = [];
  for (const id of sessionIds || []) {
    const got = await Store.getSession(id);
    if (!got.ok) return { ok: false };
    if (got.session) sessions.push(got.session);
  }
  return loadEntries(sessions);
}

/** Settled = marked, or finally failed (ai_reason 'final:…', CONTRACT §17), or never recorded. */
function pendingBlocks(entries) {
  let n = 0;
  for (const e of entries) {
    for (const b of (V3.isV3Entry(e) ? Object.keys(e.blocks) : BLOCKS)) {
      const row = e.blocks[b];
      if (row && !row.ai_marks && !String(row.ai_reason || '').startsWith('final:')) n += 1;
    }
  }
  return n;
}

/** @returns {Promise<{ok: boolean, items: object[], aiOnly: object[]}>} */
async function doubtfulItems(sessionIds) {
  const loaded = await loadSessions(sessionIds);
  if (!loaded.ok) return { ok: false, items: [], aiOnly: [] };
  const sel = selectDoubtful(loaded.entries);
  return { ok: true, items: sel.items.map(publicItem), aiOnly: sel.aiOnly.map(publicItem) };
}

/** One line per child of the visit, from the AI's marks. */
async function visitSummary(lang, visitKey, { coachUserId = null } = {}) {
  const loaded = await loadVisit(visitKey, coachUserId);
  if (!loaded.ok) return null;
  if (loaded.entries.some(V3.isV3Entry)) return V3.summaryText(langOf(lang), loaded.entries, specFor);
  return summaryText(langOf(lang), loaded.entries);
}

/** v3: the results as text messages, each ≤ 4096 code points, split between children. v2: one message. */
async function visitSummaryMessages(lang, visitKey, { coachUserId = null } = {}) {
  const loaded = await loadVisit(visitKey, coachUserId);
  if (!loaded.ok) return null;
  if (loaded.entries.some(V3.isV3Entry)) return V3.summaryMessages(langOf(lang), loaded.entries, specFor);
  return [summaryText(langOf(lang), loaded.entries)];
}

// ── writes ────────────────────────────────────────────────────────────────────────────────────

/** Find the mark a path names inside a copy of ai_marks. */
function markAt(marks, c) {
  const list = c.field === 'questions' ? marks.questions : marks.maths && marks.maths.oral && marks.maths.oral[c.group];
  if (!Array.isArray(list)) return null;
  return list.find((x, i) => (x.id || `#${i + 1}`) === c.itemId) || null;
}

/**
 * coach_marks for one block: ai_marks with the reviewed verdicts replaced. meta.source is 'review' when the
 * coach was asked about this block, 'ai_unreviewed' otherwise; meta.ai_only lists doubtful items past the cap.
 */
function coachMarksFor(block, row, asked, aiOnly) {
  const ai = (row && row.ai_marks) || null;
  if (!ai) {
    return {
      coachMarks: {
        version: 'coach-marks-v2', block,
        meta: { source: 'ai_unreviewed', no_ai_marks: true, ai_status: (row && row.ai_status) || 'missing', reviewed: [], ai_only: [] },
      },
      edits: [],
    };
  }
  const marks = JSON.parse(JSON.stringify(ai));
  // A non-reader's questions were skipped by design: 'not_asked', never wrong (L31). Not a coach edit.
  const notAsked = [];
  if (questionsSkipped(ai) && Array.isArray(marks.questions)) {
    marks.questions.forEach((q, i) => {
      notAsked.push(`questions[${q.id || `#${i + 1}`}].verdict`);
      q.verdict = 'not_asked';
    });
  }
  // §20: a reached-or-not question the coach did not ask is 'not_asked'; one asked beyond the child's reading
  // keeps the AI's verdict, is listed, and stays out of the score.
  const beyondReach = [];
  if (!questionsSkipped(ai) && Array.isArray(marks.questions)) {
    marks.questions.forEach((q, i) => {
      const path = `questions[${q.id || `#${i + 1}`}].verdict`;
      if (!askedOf(q)) { notAsked.push(path); q.verdict = 'not_asked'; } else if (!reachedOf(q)) beyondReach.push(path);
    });
  }
  const edits = [];
  const reviewed = [];
  const unanswered = [];
  for (const { c, verdict } of asked) {
    const m = markAt(marks, c);
    if (!m) continue;
    if (!VERDICTS.includes(verdict)) { unanswered.push(c.path); continue; }
    reviewed.push(c.path);
    if (m.verdict !== verdict) edits.push({ path: c.path, ai: m.verdict == null ? null : m.verdict, coach: verdict });
    m.verdict = verdict;
    m.reviewed = true;
  }
  marks.version = 'coach-marks-v2';
  marks.meta = {
    source: asked.length ? 'review' : 'ai_unreviewed',
    reviewed,
    ai_only: aiOnly.map((c) => c.path),
    ...(unanswered.length ? { unanswered } : {}),
    ...(notAsked.length ? { not_asked: notAsked } : {}),
    ...(beyondReach.length ? { beyond_reach: beyondReach } : {}),
  };
  return { coachMarks: marks, edits };
}

/** Write every block of every session once. @returns {{saved, already, failed}} */
async function settle(entries, asked, aiOnly) {
  const out = { saved: 0, already: 0, failed: 0 };
  for (const e of entries) {
    const sid = e.session.id;
    for (const block of BLOCKS) {
      const row = e.blocks[block] || null;
      const mine = asked.filter((a) => a.c.sessionId === sid && a.c.block === block);
      const extra = aiOnly.filter((c) => c.sessionId === sid && c.block === block);
      const { coachMarks, edits } = coachMarksFor(block, row, mine, extra);
      let r;
      try {
        r = await Store.saveCoachBlock(sid, block, { coachMarks, coachEdits: edits, rowExists: Boolean(row) });
      } catch (err) {
        r = { ok: false, error: err.message };
      }
      if (r.ok) out.saved += 1;
      else if (r.alreadyChecked) out.already += 1;
      else {
        out.failed += 1;
        logError('[child_test] review: a block was not saved', { sessionId: sid, block, error: r.error || r.reason || null });
      }
    }
    await Store.stamp(sid, 'review.submitted');
  }
  return out;
}

// ── send ──────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * @param {string} coachUserId
 * @param {string} visitKey   observe2 field form id or visit key (draw/visit-key.js)
 * @param {{intro?: string, waitMs?: number}} [o]  intro: a line above the results (L26's "All 5 done…");
 *   waitMs: how long to wait for scoring still running before answering 'scoring_pending'
 * @returns {Promise<{ok: true, items: number, aiOnly?: number, summary?: string} | {ok: false, reason: string, pending?: number}>}
 */
async function sendReview(coachUserId, visitKey, { intro = null, waitMs = 0 } = {}) {
  if (!enabled()) return { ok: false, reason: 'disabled' };
  if (checkMode() === 'per_child') return { ok: false, reason: 'per_child_mode' };
  let loaded = await loadVisit(visitKey, coachUserId);
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (loaded.ok && pendingBlocks(loaded.entries) && Date.now() < deadline) {
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
    loaded = await loadVisit(visitKey, coachUserId);
  }
  if (!loaded.ok) {
    logError('[child_test] review not sent: the visit could not be read', { coachUserId });
    return { ok: false, reason: 'read_failed' };
  }
  const { entries } = loaded;
  const pending = pendingBlocks(entries);
  if (pending) return { ok: false, reason: 'scoring_pending', pending };

  const coach = await Store.getCoach(coachUserId);
  const lang = langOf(coach && coach.preferred_language);
  if (entries.some(V3.isV3Entry)) return sendReviewV3(coachUserId, visitKey, coach, lang, entries, intro);
  const sel = selectDoubtful(entries);
  const summary = summaryText(lang, entries);

  if (!sel.items.length) {
    const r = await settle(entries, [], sel.aiOnly);
    logEvent('child_test.review_settled', { sessions: entries.length, items: 0, saved: r.saved, already: r.already, failed: r.failed });
    if (r.failed) return { ok: false, reason: 'save_failed' };
    return { ok: true, items: 0, summary };
  }

  const flowId = process.env.CHILD_TEST_REVIEW_FLOW_ID;
  if (!flowId) {
    logError('[child_test] review not sent: CHILD_TEST_REVIEW_FLOW_ID is not set', { coachUserId, items: sel.items.length });
    return { ok: false, reason: 'flow_not_configured' };
  }
  if (!coach || !coach.phone_number) {
    logError('[child_test] review not sent: the coach has no phone number', { coachUserId });
    return { ok: false, reason: 'no_coach' };
  }
  const n = sel.items.length;
  const { header, body } = reviewMessage(lang, n, summary, intro);
  const sent = await WhatsAppService.sendFlow(coach.phone_number, {
    flowId,
    header,
    body,
    buttonText: t(lang, 'childTestReviewCta'),
    flowToken: buildReviewToken(coachUserId, visitKey),
    screen: 'REVIEW',
    screenData: reviewScreenData(lang, sel.items, reviewRef(visitKey)),
  });
  if (!sent) {
    logError('[child_test] review not sent: WhatsApp refused the Flow message', { coachUserId, items: n });
    return { ok: false, reason: 'send_failed' };
  }
  for (const e of entries) await Store.stamp(e.session.id, 'review.sent');
  logEvent('child_test.review_sent', { sessions: entries.length, items: n, aiOnly: sel.aiOnly.length });
  return { ok: true, items: n, aiOnly: sel.aiOnly.length, summary };
}

// ── completion ────────────────────────────────────────────────────────────────────────────────

/**
 * The review's nfm_reply. completion.js has already checked the token is this coach's.
 * Slots whose key is not an item of this coach's visit are ignored (the AI's verdict stands).
 */
async function handleReviewCompletion(responseJson = {}, from, user, ref) {
  const visitKey = visitOfRef(ref);
  if (!enabled() || !visitKey || !user) return { ok: false, review: true };
  const lang = langOf(user.preferred_language);
  const loaded = await loadVisit(visitKey, user.id);
  if (loaded.ok && loaded.entries.some(V3.isV3Entry)) return completeV3(responseJson, from, user, lang, visitKey, pageOfRef(ref) || 1, loaded.entries);
  if (!loaded.ok || !loaded.entries.length) {
    logToFile('[child_test] review completion for a visit this coach has no sessions in', {}, 'warn');
    if (!loaded.ok) {
      logError('[child_test] review completion: the visit could not be read', { userId: user.id });
      await WhatsAppService.sendMessage(from, t(lang, 'childTestReviewNotSaved'));
    }
    return { ok: false, review: true };
  }
  const sel = selectDoubtful(loaded.entries);
  const byKey = new Map(sel.all.map((c) => [c.key, c]));
  const asked = [];
  const seen = new Set();
  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const c = byKey.get(String(responseJson[`k${i}`] || ''));
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    asked.push({ c, verdict: String(responseJson[`r${i}`] || '') });
  }
  const r = await settle(loaded.entries, asked, sel.aiOnly);
  logEvent('child_test.review_submitted', { sessions: loaded.entries.length, asked: asked.length, saved: r.saved, already: r.already, failed: r.failed });
  let msg = 'childTestReviewSaved';
  if (r.failed) msg = 'childTestReviewNotSaved';
  else if (!r.saved && r.already) msg = 'childTestReviewAlready';
  await WhatsAppService.sendMessage(from, t(lang, msg));
  return { ok: !r.failed, review: true, ...r };
}

// ── battery v3 ────────────────────────────────────────────────────────────────────────────────

/** Settle v3 task rows once. rows: [{entry, task}]; asked: [{c, verdict}]. @returns {{saved, already, failed}} */
async function settleTasks(rows, asked, aiOnly) {
  const out = { saved: 0, already: 0, failed: 0 };
  for (const { entry, task } of rows) {
    const sid = entry.session.id;
    const row = entry.blocks[task] || null;
    const mine = asked.filter((a) => a.c.sessionId === sid && a.c.task === task);
    const extra = aiOnly.filter((c) => c.sessionId === sid && c.task === task);
    const { coachMarks, edits } = V3.coachMarksForTask(task, row, mine, extra);
    let r;
    try {
      r = await Store.saveCoachBlock(sid, task, { coachMarks, coachEdits: edits, rowExists: Boolean(row) });
    } catch (err) {
      r = { ok: false, error: err.message };
    }
    if (r.ok) out.saved += 1;
    else if (r.alreadyChecked) out.already += 1;
    else {
      out.failed += 1;
      logError('[child_test] review: a task row was not saved', { sessionId: sid, task, error: r.error || r.reason || null });
    }
  }
  return out;
}

/** Every v3 row of the visit, and which of them a review page holds. */
function v3Rows(entries, pages) {
  const onPage = new Map();
  pages.forEach((page, p) => page.forEach((c) => onPage.set(`${c.sessionId}|${c.task}`, p + 1)));
  const rows = [];
  for (const entry of entries) {
    for (const task of Object.keys(entry.blocks)) {
      if (V3.isV3Row(entry.blocks[task])) rows.push({ entry, task, page: onPage.get(`${entry.session.id}|${task}`) || 0 });
    }
  }
  return rows;
}

async function sendPage(coachUserId, coach, lang, visitKey, pages, page, intro = null) {
  const items = pages[page - 1];
  const n = items.length;
  const total = pages.length;
  const header = clipHeader(total > 1 ? t(lang, 'childTestL39ReviewHeader', { n, p: page, pages: total }) : (n === 1 ? t(lang, 'childTestReviewHeaderOne') : t(lang, 'childTestReviewHeader', { n })));
  const body = [
    intro,
    page === 1 ? t(lang, 'childTestL39ReviewResultsAbove') : null,
    t(lang, 'childTestReviewAsk', { n, time: reviewTime(lang, n) }),
    total > 1 ? t(lang, 'childTestL39ReviewPart', { p: page, pages: total }) : null,
  ].filter(Boolean).join('\n\n');
  return WhatsAppService.sendFlow(coach.phone_number, {
    flowId: process.env.CHILD_TEST_REVIEW_FLOW_ID,
    header,
    body,
    buttonText: t(lang, 'childTestReviewCta'),
    flowToken: buildReviewToken(coachUserId, visitKey, page),
    screen: 'REVIEW',
    screenData: V3.pageScreenData(lang, items, reviewRef(visitKey, page), page, total),
  });
}

const clipHeader = (s) => ([...s].length <= 60 ? s : `${[...s].slice(0, 59).join('')}…`);

/**
 * v3: the results as text, then page 1 of the review. Rows with nothing to review are settled now
 * ('ai_unreviewed'); the others when their page is saved.
 * @returns {Promise<{ok: true, items: number, pages: number, aiOnly: number, summarySent: true} | {ok: false, reason: string}>}
 */
async function sendReviewV3(coachUserId, visitKey, coach, lang, entries, intro) {
  const { pages, all, aiOnly } = V3.paginate(entries, specFor);
  if (all.length && !process.env.CHILD_TEST_REVIEW_FLOW_ID) {
    logError('[child_test] review not sent: CHILD_TEST_REVIEW_FLOW_ID is not set', { coachUserId, items: all.length });
    return { ok: false, reason: 'flow_not_configured' };
  }
  if (!coach || !coach.phone_number) {
    logError('[child_test] review not sent: the coach has no phone number', { coachUserId });
    return { ok: false, reason: 'no_coach' };
  }
  const texts = V3.summaryMessages(lang, entries, specFor);
  for (let i = 0; i < texts.length; i += 1) {
    const body = i === 0 && intro ? `${intro}\n\n${texts[i]}` : texts[i];
    const ok = await WhatsAppService.sendMessage(coach.phone_number, [...body].length > V3.TEXT_CAP ? texts[i] : body);
    if (!ok) {
      logError('[child_test] results not sent: WhatsApp refused the text', { coachUserId, part: i + 1, of: texts.length });
      return { ok: false, reason: 'send_failed' };
    }
  }
  const rows = v3Rows(entries, pages);
  const r = await settleTasks(rows.filter((x) => !x.page), [], aiOnly);
  if (!all.length) {
    for (const e of entries) await Store.stamp(e.session.id, 'review.submitted');
    logEvent('child_test.review_settled', { battery: 'v3', sessions: entries.length, items: 0, saved: r.saved, already: r.already, failed: r.failed });
    if (r.failed) return { ok: false, reason: 'save_failed' };
    return { ok: true, items: 0, pages: 0, aiOnly: aiOnly.length, summarySent: true };
  }
  const sent = await sendPage(coachUserId, coach, lang, visitKey, pages, 1);
  if (!sent) {
    logError('[child_test] review not sent: WhatsApp refused the Flow message', { coachUserId, items: all.length, page: 1 });
    return { ok: false, reason: 'send_failed' };
  }
  for (const e of entries) await Store.stamp(e.session.id, 'review.sent');
  logEvent('child_test.review_sent', { battery: 'v3', sessions: entries.length, items: all.length, pages: pages.length, aiOnly: aiOnly.length });
  return { ok: true, items: all.length, pages: pages.length, aiOnly: aiOnly.length, summarySent: true };
}

/** v3: one page saved → its task rows get coach_marks; the next page follows, or "saved" after the last. */
async function completeV3(responseJson, from, user, lang, visitKey, page, entries) {
  const { pages, aiOnly } = V3.paginate(entries, specFor);
  const items = pages[page - 1] || [];
  const byKey = new Map(items.map((c) => [c.key, c]));
  const asked = [];
  const seen = new Set();
  for (let i = 1; i <= V3.PAGE_SLOTS; i += 1) {
    const c = byKey.get(String(responseJson[`k${i}`] || ''));
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    asked.push({ c, verdict: String(responseJson[`r${i}`] || '') });
  }
  const rows = v3Rows(entries, pages);
  const r = await settleTasks(rows.filter((x) => x.page === page), asked, aiOnly);
  const last = page >= pages.length;
  if (last) {
    // Rows sendReview settled up front: once more, in case that write failed then.
    const late = await settleTasks(rows.filter((x) => !x.page), [], aiOnly);
    r.failed += late.failed;
    for (const e of entries) await Store.stamp(e.session.id, 'review.submitted');
  }
  logEvent('child_test.review_submitted', { battery: 'v3', page, pages: pages.length, asked: asked.length, saved: r.saved, already: r.already, failed: r.failed });
  if (r.failed) {
    await WhatsAppService.sendMessage(from, t(lang, 'childTestReviewNotSaved'));
    return { ok: false, review: true, page, pages: pages.length, ...r };
  }
  if (!r.saved && r.already) {
    await WhatsAppService.sendMessage(from, t(lang, 'childTestReviewAlready'));
    return { ok: true, review: true, page, pages: pages.length, ...r };
  }
  if (!last) {
    const coach = { phone_number: from };
    const sent = await sendPage(user.id, coach, lang, visitKey, pages, page + 1);
    if (!sent) {
      logError('[child_test] review: the next page was not sent', { userId: user.id, page: page + 1 });
      await WhatsAppService.sendMessage(from, t(lang, 'childTestReviewNotSaved'));
      return { ok: false, review: true, page, pages: pages.length, ...r };
    }
    return { ok: true, review: true, page, pages: pages.length, ...r };
  }
  await WhatsAppService.sendMessage(from, t(lang, 'childTestReviewSaved'));
  return { ok: true, review: true, page, pages: pages.length, ...r };
}

module.exports = {
  checkMode,
  visitSummary,
  visitSummaryMessages,
  pageOfRef,
  doubtfulItems,
  sendReview,
  handleReviewCompletion,
  buildReviewToken,
  reviewRef,
  isReviewRef,
  visitOfRef,
  // pure parts, for the Flow generator and tests
  selectDoubtful,
  reviewScreenData,
  reviewMessage,
  reviewTime,
  summaryText,
  coachMarksFor,
  MAX_ITEMS,
};
