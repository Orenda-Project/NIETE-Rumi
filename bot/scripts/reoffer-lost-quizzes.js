'use strict';
/**
 * bd-ja1r3g — offer again the 26 quizzes (25 teachers) lost when NIETE prod's OpenRouter key hit its total cap
 * on 25 Nov 2026, 05:05-05:44Z (bd-t74k6s, bd-6pakkv). Only the existing paths are used:
 *
 *   18 recording offers skipped `model_failed` (the teacher never saw them) → the row is put in the held state
 *      the offer job already revives (closed-window-offer reviveHeld), then the normal `quiz_offer` job is queued:
 *      the live worker digests and sends the usual Yes / Not now offer, inside the teacher's 24 h window.
 *   6 plan quizzes (lp_v8 / lp612) failed `model_failed` after the yes → remakeLpQuiz, the /quiz "make it again"
 *      step: back to generating, `quiz_generate` queued, "making your quiz" sent.
 *   2 recording quizzes failed `model_failed` after the yes → the same three steps by hand (no remake helper exists
 *      for recording quizzes): back to generating, `quiz_generate` queued, `tqMaking` sent.
 *
 * A teacher whose 24 h window is closed is not messaged. THE AI TEST: the first offer goes alone; the rest go
 * only once its digest (a live model call on the worker's own key) came back. If it fails, that teacher saw
 * nothing and nothing else is sent. Then it waits for every quiz and prints counts only, never names or numbers.
 *
 *   node bot/scripts/reoffer-lost-quizzes.js --env-file .env.prod            # dry run: the plan, no writes
 *   node bot/scripts/reoffer-lost-quizzes.js --env-file .env.prod --apply    # PROD WRITE + MESSAGES TEACHERS
 *
 * --apply writes to the production database and messages teachers: the operator's go (root CLAUDE.md Rule 7).
 */

const QUIZ_IDS = [
  // recording offers skipped model_failed
  '005c9819-1311-4555-9d92-c59e9d9bd0cc', 'a37b4a8e-0b9c-4fcb-962f-a35b5351484b', '17008d55-fa38-4234-acc8-f58e66e91bd4',
  '6cf1bf30-3225-41d0-915a-0cb51a9c3305', '2f443bd4-071a-4420-a218-c36d23dadf87', '96ea5844-6b50-45dc-91bf-9e74f278f4a3',
  '26ab23dd-f2d7-4288-98da-88839b21a1e2', '8165e06b-97d4-4315-8237-f0fd24e1f44a', 'e8474ec8-7d2a-474f-a512-a90ba5fbb101',
  '640cfce7-7677-4447-9c6b-9c1b318bf4b6', 'b75eea7e-31d9-4c72-a553-9bdf0c5a55e6', '31a9ae03-c8dc-43bc-aa88-a3649c91121b',
  'e771e317-5d94-4658-8883-08d934e5e029', '7fa6aae4-419c-402a-8c1d-a0499fd6fb2b', 'e066d207-bd0a-4021-ae43-850a9dbe7f1a',
  '3b4021d9-af96-4649-b831-6cb0f928d260', '4850ad0a-55c9-4866-9574-ea106404508c', 'cc6b8c06-2a4e-4f63-b1f1-06ccc8cc7d16',
  // failed model_failed after the teacher said yes
  '5e9f6757-860f-496c-b946-eb65b2c08bcb', '446451f0-3f77-406f-9216-81ccfdbcf36b', '80e7223b-0274-4ad1-8d45-977326a39fde',
  'f13d268a-cb57-4229-8692-ff660bfca429', '19ce0587-f443-4fcf-9cac-b8521f745924', 'f4d96fef-e429-47ab-b5ea-6fdf1c0ed742',
  'd3ea410b-f181-407a-a5b4-170db929e2c5', '4b5cc269-e555-40d1-a9b1-240ecf6f00ed',
];
const PLAN_SOURCES = new Set(['lp_v8', 'lp612']);
const LOST = 'model_failed';
const HELD = 'window_closed';

/** What to do with one lost quiz row, or why it is left alone (it moved on since the outage). */
function actionFor(row) {
  if (!row) return { skip: 'missing' };
  const m = row.meta || {};
  if (row.quiz_source === 'transcript' && row.status === 'skipped' && m.skip_reason === LOST && row.coaching_session_id) {
    return { action: 'offer' };
  }
  if (row.status === 'failed' && m.error === LOST) {
    if (PLAN_SOURCES.has(row.quiz_source)) return { action: 'remake_plan' };
    if (row.quiz_source === 'transcript') return { action: 'remake_recording' };
  }
  return { skip: `now_${row.status}` };
}

/** @param {(row:object)=>boolean} windowOpen whether the row's teacher can be messaged free-form now */
function planReoffer(rows, windowOpen) {
  const p = { offer: [], remakePlan: [], remakeRecording: [], skipped: [], canary: null };
  const bucket = { offer: p.offer, remake_plan: p.remakePlan, remake_recording: p.remakeRecording };
  for (const r of rows) {
    const a = actionFor(r);
    if (a.skip) { p.skipped.push({ id: r ? r.id : null, reason: a.skip }); continue; }
    if (!windowOpen(r)) { p.skipped.push({ id: r.id, reason: 'window_closed' }); continue; }
    bucket[a.action].push(r);
  }
  p.canary = p.offer[0] || null;
  return p;
}

/** The held state reviveHeld takes back, with the real reason kept beside it. */
function heldMeta(meta, nowIso) {
  return { ...(meta || {}), skip_reason: HELD, held_path: 'none', reoffer_of: LOST, reoffered_at: nowIso };
}

/** remakeLpQuiz's row change, for a recording quiz. */
function recordingRemakeMeta(meta, nowIso) {
  const { error: _e, error_detail: _d, ...kept } = meta || {};
  return {
    ...kept,
    step: kept.digest ? 'author' : 'digest',
    remakes: (Number(kept.remakes) || 0) + 1,
    previous_error: (meta && meta.error) || null,
    remade_at: nowIso,
    accepted_at: nowIso,
    remake_source: 'reoffer',
  };
}

/** @param {'offer'|'remake'} kind */
function outcomeOf(kind, row) {
  const s = row.status;
  const m = row.meta || {};
  if (kind === 'offer') {
    // Past `offered` = the offer went out (what the teacher did with it after is theirs).
    if (['offered', 'declined', 'ready', 'sent', 'report_sent', 'failed'].includes(s)) return 'sent';
    if (s === 'generating') return 'pending';
    if (s === 'skipped' && m.skip_reason === LOST) return 'failed';
    if (s === 'skipped' && m.skip_reason === HELD) return m.reoffer_of ? 'pending' : 'not_sent_window';
    return 'not_sent_other';
  }
  if (s === 'sent' || s === 'report_sent') return 'sent';
  if (s === 'failed') return 'failed';
  return 'pending';
}

function tally(outcomes) {
  return outcomes.reduce((acc, o) => ({ ...acc, [o]: (acc[o] || 0) + 1 }), {});
}

/** Every cost_usd in a quiz's meta, nested ones included. */
function costOf(meta) {
  if (!meta || typeof meta !== 'object') return 0;
  return Object.entries(meta).reduce((sum, [k, v]) => {
    if (k === 'cost_usd' && typeof v === 'number') return sum + v;
    if (v && typeof v === 'object') return sum + costOf(v);
    return sum;
  }, 0);
}

/* istanbul ignore next — CLI wiring over the functions above */
async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const apply = argv.includes('--apply');
  require('dotenv').config({ path: arg('--env-file') || '.env' });
  const supabase = require('../shared/config/supabase');
  const SQS = require('../shared/services/queue');
  const WhatsApp = require('../shared/services/whatsapp.service');
  const Offer = require('../shared/services/quiz/transcript-quiz-offer.service');
  const QuizDelivery = require('../shared/services/quiz/quiz-delivery.service');
  const { teacherLanguageFor } = require('../shared/services/quiz/transcript-quiz-language');
  const { resolveUx } = require('../shared/config/ux-strings');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SELECT = 'id, teacher_id, quiz_source, status, coaching_session_id, language, subject, topic, meta';
  const load = async () => {
    const { data, error } = await supabase.from('quizzes').select(SELECT).in('id', QUIZ_IDS);
    if (error) throw new Error(error.message);
    return data;
  };

  const rows = await load();
  const { data: users, error: uErr } = await supabase.from('users')
    .select('id, phone_number, preferred_language').in('id', [...new Set(rows.map((r) => r.teacher_id))]);
  if (uErr) throw new Error(uErr.message);
  const userOf = new Map(users.map((u) => [u.id, u]));
  const phoneOf = (r) => (userOf.get(r.teacher_id) || {}).phone_number;
  const langOf = (r) => teacherLanguageFor({ preferredLanguage: (userOf.get(r.teacher_id) || {}).preferred_language });
  const open = new Map();
  for (const r of rows) {
    const ph = phoneOf(r);
    open.set(r.id, Boolean(ph) && await QuizDelivery._hasOpenMessageWindow(ph));
  }
  const plan = planReoffer(rows, (r) => open.get(r.id));
  const costBefore = rows.reduce((s, r) => s + costOf(r.meta), 0);
  console.log(`quizzes found ${rows.length}/${QUIZ_IDS.length} · teachers ${users.length}`);
  console.log(`plan: offer again ${plan.offer.length} · make again (lesson plan) ${plan.remakePlan.length}`
    + ` · make again (recording) ${plan.remakeRecording.length} · left alone ${plan.skipped.length}`
    + ` ${JSON.stringify(tally(plan.skipped.map((s) => s.reason)))}`);
  if (!apply) { console.log('dry run: nothing written, nothing sent'); return; }

  const now = () => new Date().toISOString();
  const offerOne = async (r) => {
    const { data: moved, error } = await supabase.from('quizzes')
      .update({ meta: heldMeta(r.meta, now()) })
      .eq('id', r.id).eq('status', 'skipped').eq('meta->>skip_reason', LOST).select('id');
    if (error || !moved || !moved.length) return false;
    await SQS.queueJob(r.coaching_session_id, 'quiz_offer',
      { coachingSessionId: r.coaching_session_id, phone: phoneOf(r), force: true, source: 'offer' }, { delaySeconds: 0 });
    return true;
  };

  // 1. The AI test: one offer, alone, and wait for its digest.
  if (plan.canary) {
    await offerOne(plan.canary);
    let out = 'pending';
    for (let i = 0; i < 20 && out === 'pending'; i += 1) {
      await sleep(15000);
      const { data } = await supabase.from('quizzes').select('status, meta').eq('id', plan.canary.id).single();
      out = outcomeOf('offer', data);
    }
    if (out === 'failed' || out === 'pending') {
      console.log(`AI TEST FAILED (${out}): stopped. The test teacher saw nothing; nothing else was sent.`);
      process.exitCode = 2;
      return;
    }
    console.log('AI test passed: the first offer was written by the live AI.');
  }

  // 2. The rest.
  for (const r of plan.offer.slice(1)) await offerOne(r);
  for (const r of plan.remakePlan) {
    await Offer.remakeLpQuiz({ quiz: r, phone: phoneOf(r), teacherLang: langOf(r), source: 'reoffer' });
  }
  for (const r of plan.remakeRecording) {
    const { data: moved } = await supabase.from('quizzes')
      .update({ status: 'generating', meta: recordingRemakeMeta(r.meta, now()) })
      .eq('id', r.id).eq('status', 'failed').select('id');
    if (!moved || !moved.length) continue;
    await SQS.queueJob(r.id, 'quiz_generate', { quizId: r.id, phone: phoneOf(r), language: langOf(r) }, { delaySeconds: 0 });
    await WhatsApp.sendMessage(phoneOf(r), resolveUx('tqMaking', { language: langOf(r) }));
  }

  // 3. Read back: wait up to 20 minutes for every quiz to land.
  const kindOf = new Map([...plan.offer.map((r) => [r.id, 'offer']),
    ...[...plan.remakePlan, ...plan.remakeRecording].map((r) => [r.id, 'remake'])]);
  let counts = {};
  let after = [];
  for (let i = 0; i < 40; i += 1) {
    await sleep(30000);
    after = (await load()).filter((r) => kindOf.has(r.id));
    const offers = tally(after.filter((r) => kindOf.get(r.id) === 'offer').map((r) => outcomeOf('offer', r)));
    const remakes = tally(after.filter((r) => kindOf.get(r.id) === 'remake').map((r) => outcomeOf('remake', r)));
    counts = { offers, quizzes: remakes };
    if (!offers.pending && !remakes.pending) break;
  }
  const costAfter = (await load()).reduce((s, r) => s + costOf(r.meta), 0);
  console.log(`RESULT offers ${JSON.stringify(counts.offers)} · quizzes made and sent ${JSON.stringify(counts.quizzes)}`
    + ` · not messaged (window closed or moved on) ${plan.skipped.length}`);
  console.log(`AI cost of this run: $${(costAfter - costBefore).toFixed(2)} (WhatsApp messages inside the 24 h window are free)`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(process.exitCode || 0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { QUIZ_IDS, actionFor, planReoffer, heldMeta, recordingRemakeMeta, outcomeOf, tally, costOf };
