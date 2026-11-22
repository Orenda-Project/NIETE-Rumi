#!/usr/bin/env node
'use strict';
/**
 * bd-dp9ipc — put back the grades 1-5 survey answers lost on lp_feedback_lp612_segment_id_fkey.
 *
 * Live 16-21 Nov 2026: a grades 1-5 plan opened in the app was recorded as a 6-12 open, the 6-12 survey was sent,
 * and her thumbs tap tried to store a grades 1-5 lesson id in lp_feedback.lp612_segment_id; the foreign key refused
 * it (121 taps, 84 teachers). The survey side was fixed by bd-h7nsmx. Each lost tap is in niete-logs
 * (`lp612.feedback.insert_failed`: userId, segmentId = catalogue lesson id, useful, time), exported one per line:
 *   {"at":"<iso>","userId":"<uuid>","lessonId":"grade_3_urdu_ch12_seg4","useful":true}
 *
 * Stored the way a grades 1-5 answer is stored today (lp-app-open-survey → lp-feedback.service): a lesson_plans row
 * for her and that lesson (lp-v8-delivery.recordLessonPlanRow, surface 'app'), then lp_feedback by lesson_plan_id,
 * dated at her original tap. Her last tap per lesson wins. A teacher who already has an answer for that lesson is
 * left alone, so a second run writes nothing.
 *
 *   node bot/scripts/recover-lost-lp-feedback.js <answers.jsonl>            # dry run: counts only
 *   node bot/scripts/recover-lost-lp-feedback.js <answers.jsonl> --apply    # writes (staging first; live needs a go)
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LP_VARIANT = 'niete_v8_segment'; // lp-v8-delivery LP_VARIANT: what a grades 1-5 app-open survey row carries

/** Last tap per (teacher, lesson); anything that cannot be stored truthfully is set aside with its reason. */
function planRecovery(rows, lessonById) {
  const skipped = [];
  const last = new Map();
  for (const r of rows || []) {
    const why = !r || typeof r.userId !== 'string' || !UUID.test(r.userId) ? 'bad_user'
      : typeof r.useful !== 'boolean' ? 'no_answer'
        : !lessonById(String(r.lessonId || '')) ? 'unknown_lesson' : null;
    if (why) { skipped.push({ ...r, why }); continue; }
    const key = `${r.userId}|${r.lessonId}`;
    const prev = last.get(key);
    if (!prev || String(r.at) >= String(prev.at)) last.set(key, r);
  }
  return { answers: [...last.values()], skipped };
}

/** Does she already have an answer for this lesson (any grades 1-5 lesson_plans row of hers for it)? */
async function alreadyAnswered(supabase, { userId, lessonId }) {
  const { data: plans, error } = await supabase.from('lesson_plans').select('id')
    .eq('user_id', userId).eq('content->v8->>lesson_id', lessonId);
  if (error) throw new Error(`lesson_plans lookup failed: ${error.message}`);
  if (!plans || !plans.length) return false;
  const { data: fb, error: e2 } = await supabase.from('lp_feedback').select('id')
    .eq('user_id', userId).in('lesson_plan_id', plans.map((p) => p.id)).limit(1);
  if (e2) throw new Error(`lp_feedback lookup failed: ${e2.message}`);
  return Boolean(fb && fb.length);
}

async function recover({ answers, supabase, recordLessonPlanRow, lessonById, apply = false, log = () => {} }) {
  const out = { would: 0, written: 0, already: 0, failed: 0 };
  for (const a of answers) {
    if (await alreadyAnswered(supabase, a)) { out.already += 1; continue; }
    if (!apply) { out.would += 1; continue; }
    const hit = lessonById(a.lessonId);
    const { lesson, chapter, book } = hit;
    const lessonPlanId = await recordLessonPlanRow({ userId: a.userId, lessonId: a.lessonId, hit, surface: 'app' });
    if (!lessonPlanId) { out.failed += 1; log('no lesson_plans row', a.lessonId); continue; }
    const { error } = await supabase.from('lp_feedback').insert({
      user_id: a.userId,
      lesson_plan_id: lessonPlanId,
      useful: a.useful,
      lp_variant: LP_VARIANT,
      grade: book.grade,
      subject: book.subject_key,
      chapter_number: chapter.number,
      segment_number: lesson.segment_index,
      topic: lesson.topic_short || lesson.topic || null,
      trigger_mode: 'after_pdf_only',
      created_at: a.at,
    }).select('id').single();
    if (error) { out.failed += 1; log('lp_feedback insert failed', a.lessonId, error.message); continue; }
    out.written += 1;
  }
  return out;
}

async function main(argv) {
  const file = argv.find((x) => !x.startsWith('--'));
  if (!file) { console.error('usage: recover-lost-lp-feedback.js <answers.jsonl> [--apply]'); process.exit(2); }
  const apply = argv.includes('--apply');
  const rows = require('fs').readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const { lessonById } = require('../shared/services/lp-v8-catalog.service');
  const { answers, skipped } = planRecovery(rows, lessonById);
  const out = await recover({
    answers,
    supabase: require('../shared/config/supabase'),
    recordLessonPlanRow: require('../shared/services/lp-v8-delivery.service').recordLessonPlanRow,
    lessonById,
    apply,
    log: (...a) => console.error(...a),
  });
  const teachers = new Set(answers.map((a) => a.userId)).size;
  console.log(JSON.stringify({ apply, taps: rows.length, answers: answers.length, teachers, skipped: skipped.length, ...out }));
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { planRecovery, recover };
