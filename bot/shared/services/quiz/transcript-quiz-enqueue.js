'use strict';
/**
 * Queue a recorded lesson's quiz_generate job — split out of
 * transcript-lesson-provider (300-line rule); the provider re-exports it.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { resolveUx } = require('../../config/ux-strings');
const { TRANSCRIPT, failureCopyKey } = require('./quiz-sources');
const Funnel = require('./quiz-funnel');

/**
 * Queue a claimed (`generating`) quiz. The row is claimed first, so a queue that
 * throws must not leave it `generating` for ever — every later /quiz tap would
 * answer "still making" (bd-n3n2d). It is marked failed (meta merged, as
 * queueLpQuiz does), the teacher is told, and /quiz can make it again.
 *
 * @returns {Promise<boolean>} true when the job was queued
 */
async function enqueueGenerate(quizId, phone, lang, source = 'list', quizSource = TRANSCRIPT) {
  try {
    const SQSQueueService = require('../queue');
    await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: lang, source }, { delaySeconds: 0 });
  } catch (err) {
    logToFile('❌ transcript quiz: quiz_generate could not be queued', { quizId, error: err.message }, 'error');
    const { data: current } = await supabase.from('quizzes').select('meta').eq('id', quizId).maybeSingle();
    const meta = (current && current.meta) || {};
    const { error } = await supabase.from('quizzes')
      .update({
        status: 'failed',
        meta: {
          ...meta, step: 'failed', error: 'queue_failed', error_detail: `queue: ${err.message}`,
          previous_error: meta.error || null, failed_at: new Date().toISOString(),
        },
      })
      .eq('id', quizId);
    if (error) logToFile('❌ transcript quiz: could not mark the quiz failed', { quizId, error: error.message }, 'error');
    Funnel.emit('generation_failed', {
      quiz_id: quizId, source: quizSource, channel: Funnel.channelOf(source), reason: 'queue_failed',
    });
    await WhatsAppService.sendMessage(phone, resolveUx(failureCopyKey('queue_failed', quizSource), { language: lang }));
    return false;
  }
  // Every /quiz path that makes a quiz queues it here — the list, the Flow, a retry.
  Funnel.emit('accepted', { quiz_id: quizId, source: quizSource, channel: Funnel.channelOf(source) });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: lang }));
  return true;
}

module.exports = { enqueueGenerate };
