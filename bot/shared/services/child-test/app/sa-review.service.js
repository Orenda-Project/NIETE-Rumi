'use strict';

/**
 * The visit review — one self-administered session, item by item, for the people who judge whether the app scored it
 * right (the portal's review page, switch sa_review_page):
 *
 *   saReview      per task: its time, its recordings (1-hour R2 GET links), the phone's or the scorer's count, and per
 *                 spoken item the app's mark, the scoring agents' marks (child_test_sa_item_reviews.agents), a
 *                 "suspect" flag (an app "correct" on a clip with no speech, or an answer under 1 s), the reviewer's
 *                 own ear (correct | wrong | unclear) and the app's right / wrong / unclear derived from it; per task,
 *                 whether it was scored before or after the scorer fix (app_settings.sa_scorer_fix_at)
 *   saReviewMark  the reviewer's mark and note on one item (a note ≤ 500 code points, never the child's roster name)
 *
 * IDENTITY. The coach's own session; a results admin (asAdmin: true, set by the portal from sa_results_admins for its
 * session user, never the browser's) any. PRIVACY. Never what the child said ("heard"), a transcript, a name, a
 * student id or a draw. NEVER THROWS — the status vocabulary of app-api.service.js.
 */

const { __internals: { guarded } } = require('./app-api.service');

const SA_MARK = 'sa-battery';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;
const MARKS = ['correct', 'wrong', 'unclear'];
const NOTE_MAX = 500;
const CLIP_TTL_S = 60 * 60;
const SHORT_ANSWER_MS = 1000;

const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const resultOf = (r) => (Array.isArray(r.responses) && r.responses.find((x) => x && x.kind === 'result')) || {};
const byWhen = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.block).localeCompare(String(b.block));

function withReviewDeps(deps = {}) {
  return {
    ...deps,
    reviewStore: deps.reviewStore || require('../sa/review-store'), // eslint-disable-line global-require
    settings: deps.settings || { fixAt: () => settingValue('sa_scorer_fix_at') },
  };
}

async function settingValue(key) {
  const supabase = require('../../../config/supabase'); // eslint-disable-line global-require
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return typeof data.value === 'string' ? data.value : null;
}

/** The session, when this user may see it: their own, or any for an admin; else null. */
async function visibleSession(d, userId, sessionId, asAdmin) {
  if (!UUID_RE.test(String(sessionId || ''))) return null;
  const got = await d.store.getSession(sessionId);
  if (!got || !got.ok) throw new Error((got && got.error) || 'getSession failed');
  const s = got.session;
  if (!s || s.item_bank_version !== SA_MARK) return null;
  return asAdmin === true || s.coach_user_id === userId ? s : null;
}

async function taskRows(d, sessionId) {
  const got = await d.store.listBlocks(sessionId);
  if (!got || !got.ok) throw new Error((got && got.error) || 'listBlocks failed');
  return (got.blocks || []).filter((r) => TASK_RE.test(String(r.block || ''))).sort(byWhen);
}

const appItems = (r) => ((r.ai_marks && r.ai_marks.detail && Array.isArray(r.ai_marks.detail.items)) ? r.ai_marks.detail.items : []);

function clipLabel(key, taskId) {
  const base = String(key).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const q = base.match(/_(q[0-9]+)$/);
  return q ? q[1] : (base || taskId);
}

// A recording is a key string, or { i, key } per question on a comprehension row ('ur.story_w3.q1' or 1 as i).
const clipOf = (k) => (k && typeof k === 'object' ? { key: k.key || null, i: k.i == null ? null : k.i } : { key: k || null, i: null });
function labelOf(k, taskId) {
  const q = k.i == null ? null : String(k.i).match(/(?:^|[._])q?([0-9]+)$/);
  return q ? `q${q[1]}` : clipLabel(k.key, taskId);
}

/** The agents' marks as the page reads them: marks and numbers only. */
function agentsOut(a) {
  if (!a || typeof a !== 'object') return null;
  const v = (x) => (typeof x === 'string' && /^[cwns]$/.test(x) ? x : null);
  return {
    consensus: v(a.consensus), flash: v(a.flash), pro: v(a.pro), stt: v(a.stt),
    confidence: num(a.confidence), noSpeech: a.no_speech === true, disputed: a.disputed === true, lowTrust: a.low_trust === true,
  };
}

const AGENT_TO_APP = { c: 'correct', w: 'wrong', n: 'wrong', s: 'wrong' };

function appRightOf(appVerdict, ear) {
  if (!ear || !ear.mark) return null;
  if (ear.mark === 'unclear') return 'unclear';
  if (appVerdict !== 'correct' && appVerdict !== 'wrong') return null;
  return ear.mark === appVerdict ? 'right' : 'wrong';
}

function shapeTask(r, reviews, userId, fixAt, clips) {
  const res = resultOf(r);
  const m = r.ai_marks || {};
  const mode = r.response_mode || (typeof res.mode === 'string' ? res.mode : null);
  const spoken = mode === 'record' || mode === 'oral';
  const answerMs = new Map((r.responses || []).filter((x) => x && x.kind === 'answer' && x.item_id).map((x) => [x.item_id, num(x.ms)]));
  const mine = reviews.filter((x) => x.task_id === r.block);
  const reviewOf = new Map(mine.map((x) => [String(x.item_key), x]));
  const keys = spoken ? [...new Set([...appItems(r).map((x) => String(x.i)), ...mine.map((x) => String(x.item_key))])]
    .filter((k) => /^[0-9]{1,3}$/.test(k)).sort((a, b) => Number(a) - Number(b)) : [];
  const appOf = new Map(appItems(r).map((x) => [String(x.i), x]));
  const items = keys.map((key) => {
    const a = appOf.get(key) || {};
    const rv = reviewOf.get(key) || null;
    const agents = agentsOut(rv && rv.agents);
    const verdict = typeof a.verdict === 'string' ? a.verdict : null;
    const ms = a.id ? answerMs.get(a.id) : null;
    const ear = rv && (rv.mark || rv.note) ? { mark: rv.mark || null, note: rv.note || null, at: rv.reviewed_at || null, mine: rv.reviewed_by === userId } : null;
    return {
      key,
      ref: typeof a.ref === 'string' ? a.ref : (typeof a.id === 'string' ? a.id : null),
      app: { verdict, conf: num(a.conf), noSpeech: a.no_speech === true, secondVoice: a.second_voice === true },
      agents,
      suspect: verdict === 'correct' && (a.no_speech === true || Boolean(agents && agents.noSpeech) || (ms !== null && ms !== undefined && ms < SHORT_ANSWER_MS)),
      ear,
      appRight: appRightOf(verdict, ear),
    };
  });
  const reviewed = items.filter((x) => x.ear && x.ear.mark);
  const withAgents = items.filter((x) => x.agents && x.agents.consensus && x.app.verdict);
  const scoredAt = r.ai_scored_at || null;
  return {
    taskId: r.block,
    mode,
    timeUsedS: num(res.time_used_ms) !== null ? Math.round(res.time_used_ms / 100) / 10 : null,
    app: {
      correct: num(m.correct) ?? num(m.keypad_correct) ?? num(m.tap_correct) ?? num(res.correct),
      attempted: num(m.attempted) ?? num(m.keypad_attempted) ?? num(m.tap_attempted) ?? num(res.attempted),
      of: num(m.of),
      perMinute: num(m.per_minute),
    },
    scoredAt,
    scoredAfterFix: fixAt && scoredAt ? Date.parse(scoredAt) >= Date.parse(fixAt) : null,
    clips,
    items,
    // the scorer heard another person in the recording (CHILD_TEST_SA_SECOND_VOICE)
    secondVoice: Boolean(m.detail && m.detail.second_voice === true),
    agreement: {
      reviewed: reviewed.length,
      earAgreesWithApp: reviewed.filter((x) => x.ear.mark === x.app.verdict).length,
      agentsAgreeWithApp: withAgents.filter((x) => AGENT_TO_APP[x.agents.consensus] === x.app.verdict).length,
      withAgents: withAgents.length,
    },
  };
}

function saReview(args = {}, deps = {}) {
  const rd = withReviewDeps(deps);
  return guarded('sa_review', async ({ userId, sessionId, asAdmin }, d) => {
    const session = await visibleSession(d, userId, sessionId, asAdmin);
    if (!session) return { status: 'not_found' };
    const rows = await taskRows(d, session.id);
    const got = await rd.reviewStore.listItemReviews(session.id);
    if (!got || !got.ok) throw new Error((got && got.error) || 'listItemReviews failed');
    const fixAt = (await rd.settings.fixAt()) || null;
    const tasks = [];
    for (const r of rows) {
      const keys = [r.audio_r2_key, ...(Array.isArray(r.audio_r2_keys) ? r.audio_r2_keys : [])].map(clipOf).filter((k) => k.key);
      // eslint-disable-next-line no-await-in-loop
      const clips = await Promise.all(keys.map(async (k) => ({ label: labelOf(k, r.block), url: await d.r2.presignKey(k.key, CLIP_TTL_S) })));
      tasks.push(shapeTask(r, got.reviews || [], userId, fixAt, clips));
    }
    const start = Date.parse(session.started_at || '');
    const end = Date.parse(session.finished_at || session.client_finished_at || '');
    d.log('child_test.sa.review_read', { userId, sessionId: session.id, admin: asAdmin === true });
    return {
      status: 'ok',
      session: {
        id: session.id,
        grade: session.grade,
        block: (session.device && session.device.block) || null,
        status: session.status,
        startedAt: session.started_at || null,
        endedAt: session.finished_at || session.client_finished_at || null,
        minutes: Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : null,
      },
      fixAt,
      tasks,
    };
  })(args, rd);
}

const fold = (s) => String(s || '').normalize('NFC').toLowerCase();

/** The child's first name in each script, from the roster; a note holding one is refused. */
async function nameInNote(d, session, note) {
  if (!note || !session.student_id) return false;
  const got = await d.store.listStudents([session.student_id]);
  if (!got || !got.ok) throw new Error((got && got.error) || 'listStudents failed');
  const st = (got.students || [])[0];
  if (!st) return false;
  const names = [st.student_name, st.student_name_urdu].map((n) => fold(n).trim().split(/\s+/)[0]).filter((n) => n && [...n].length >= 2);
  const text = fold(note);
  return names.some((n) => text.includes(n));
}

function saReviewMark(args = {}, deps = {}) {
  const rd = withReviewDeps(deps);
  return guarded('sa_review_mark', async ({ userId, sessionId, taskId, itemKey, mark = null, note = null, asAdmin }, d) => {
    if (mark !== null && !MARKS.includes(mark)) return { status: 'invalid', reason: 'bad_mark' };
    const text = note === null || note === undefined ? null : String(note).trim() || null;
    if (text && [...text].length > NOTE_MAX) return { status: 'invalid', reason: 'note_too_long' };
    const session = await visibleSession(d, userId, sessionId, asAdmin);
    if (!session) return { status: 'not_found' };
    const key = String(itemKey || '');
    const row = (await taskRows(d, session.id)).find((r) => r.block === taskId);
    const spoken = row && (row.response_mode === 'record' || row.response_mode === 'oral');
    if (!spoken || !appItems(row).some((x) => String(x.i) === key)) return { status: 'invalid', reason: 'no_such_item' };
    if (await nameInNote(d, session, text)) return { status: 'invalid', reason: 'name_in_note' };
    const saved = await rd.reviewStore.saveItemReview({
      sessionId: session.id, taskId, itemKey: key, mark, note: text, reviewedBy: userId, reviewedAt: d.now().toISOString(),
    });
    if (!saved || !saved.ok) throw new Error((saved && saved.error) || 'saveItemReview failed');
    d.log('child_test.sa.review_marked', { userId, sessionId: session.id, taskId, itemKey: key, mark });
    return { status: 'ok' };
  })(args, rd);
}

module.exports = { saReview, saReviewMark, NOTE_MAX };
