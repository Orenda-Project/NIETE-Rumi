'use strict';
/**
 * Web quiz publish step: read-aloud clips.
 *
 * For one quiz, records one clip per question text, per option text and per
 * "why" line, in the quiz's language, through the bot's own voice gateway
 * (services/tts — the same voices as the teacher voice notes; no new provider).
 * Each clip is stored once in R2 at
 *
 *   web-quiz/audio/<quiz_id>/<question_id>/<part>.ogg     part = q | a | b | c | d | why
 *
 * and the keys are written into quizzes.meta.web.audio as
 *
 *   { <question_id>: { q, opts: [a, b, c, d], why } }      (null where there is no clip)
 *
 * merged into the existing meta, so nothing else in meta is touched.
 *
 * - Idempotent: a clip already in R2 is not recorded again.
 * - Capped per quiz (maxClips), so a bad quiz cannot spend without limit.
 * - Fails soft: a clip that cannot be made is counted and skipped; the page
 *   falls back to the phone's own voice for it. Never throws.
 *
 * Read-aloud keys live in quizzes.meta, NOT quiz_questions.media: the WhatsApp
 * phase renderer reads media and sends what it finds there.
 */

const tts = require('../tts');
const r2 = require('../../storage/r2');
const { logEvent } = require('../../utils/structured-logger');
const { logError } = require('../../utils/logger');

const PREFIX = 'web-quiz/audio';
const PARTS_OPTS = ['a', 'b', 'c', 'd'];
const DEFAULT_MAX_CLIPS = 60;
// Spend estimate for the log line, by the provider that actually spoke:
// ElevenLabs bills per character, Soniox per second of audio (tts/index.js).
const USD_PER_CHAR = 0.10 / 1000;
const SONIOX_USD_PER_AUDIO_SECOND = 0.722 / 3600;

function clipCostUsd(res, text) {
  if (res.provider === 'soniox') return (res.durationSec || 0) * SONIOX_USD_PER_AUDIO_SECOND;
  if (res.provider === 'elevenlabs') return text.length * USD_PER_CHAR;
  return 0;
}

function audioKey(quizId, questionId, part) {
  return `${PREFIX}/${quizId}/${questionId}/${part}.ogg`;
}

/** Text as it should be spoken: no Markdown markers, no stored option letters. */
function spoken(text) {
  if (text == null) return '';
  let out = String(text);
  // "A) Roots drink water" -> "Roots drink water"; the page shuffles options, so
  // a stored letter can name a different option than the one the child sees.
  out = out.replace(/(^|\s)\(?[A-D]\)\s*/g, '$1');
  out = out.replace(/\b(answer\s+is\s+)[A-D]\b\.?/gi, '$1');
  out = out.replace(/[*_`#]+/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function whyText(q) {
  const fb = q.option_feedback && typeof q.option_feedback === 'object' ? q.option_feedback : {};
  return spoken(fb.correct) || spoken(q.explanation);
}

// Something a voice can say. A picture option is stored as an emoji (no letter,
// no digit): the voices strip it to nothing and the gateway would fall through
// to a different voice, so it gets no clip — the page shows the picture.
const SAYABLE = /[\p{L}\p{N}]/u;

/** The clips one question needs, in order: [{ part, text }]. */
function partsFor(q) {
  const parts = [];
  const add = (part, text) => { if (text && SAYABLE.test(text)) parts.push({ part, text }); };
  add('q', spoken(q.question_text));
  PARTS_OPTS.forEach((p) => add(p, spoken(q[`option_${p}`])));
  add('why', whyText(q));
  return parts;
}

async function exists(key) {
  try {
    return (await r2.headObject(key)).exists;
  } catch (_) {
    return false; // cannot tell: record it (an overwrite of the same words is harmless)
  }
}

/**
 * @param {string} quizId
 * @param {object} [opts]
 * @param {object} [opts.db]        Supabase client (defaults to the bot's)
 * @param {number} [opts.maxClips]  most clips recorded in one run
 * @returns {Promise<{ok:boolean, reason?:string, synthesized:number, skipped:number, failed:number,
 *   capped:boolean, chars:number, bytes:number, estimatedCostUsd:number}>}
 */
async function publishQuizAudio(quizId, { db, maxClips = DEFAULT_MAX_CLIPS } = {}) {
  const client = db || require('../../config/supabase');
  const stats = { synthesized: 0, skipped: 0, failed: 0, capped: false, chars: 0, bytes: 0, audioSec: 0, providers: {} };
  let costUsd = 0;
  const started = Date.now();
  const done = (extra) => {
    const out = { ...stats, audioSec: Math.round(stats.audioSec * 10) / 10, estimatedCostUsd: Math.round(costUsd * 1e4) / 1e4, ...extra };
    logEvent('web_quiz.publish_audio', { quizId, ...out, durationMs: Date.now() - started });
    return out;
  };

  try {
    const { data: quiz, error: qErr } = await client.from('quizzes')
      .select('id, language, meta').eq('id', quizId).maybeSingle();
    if (qErr) throw qErr;
    if (!quiz) return done({ ok: false, reason: 'quiz_not_found' });

    const { data: questions, error: qsErr } = await client.from('quiz_questions')
      .select('id, question_text, option_a, option_b, option_c, option_d, correct_option, option_feedback, explanation, sort_order')
      .eq('quiz_id', quizId).order('sort_order', { ascending: true });
    if (qsErr) throw qsErr;

    const language = quiz.language || undefined;
    const audio = {};
    for (const q of questions || []) {
      const entry = { q: null, opts: [null, null, null, null], why: null };
      for (const { part, text } of partsFor(q)) {
        const key = audioKey(quizId, q.id, part);
        let have = await exists(key);
        if (have) {
          stats.skipped += 1;
        } else if (stats.synthesized + stats.failed >= maxClips) {
          stats.capped = true;
        } else {
          try {
            const res = await tts.synthesize({ text, language, useCase: 'reading', site: 'web_quiz_read_aloud' });
            await r2.uploadBuffer(res.audio, key, 'audio/ogg');
            stats.synthesized += 1;
            stats.chars += text.length;
            stats.bytes += res.audio.length;
            stats.audioSec += res.durationSec || 0;
            stats.providers[res.provider] = (stats.providers[res.provider] || 0) + 1;
            costUsd += clipCostUsd(res, text);
            have = true;
          } catch (error) {
            stats.failed += 1;
            logError('web_quiz.publish_audio.clip_failed', {
              event: 'web_quiz.publish_audio.clip_failed', quizId, questionId: q.id, part,
              error: String(error.message || error).slice(0, 200),
            });
          }
        }
        if (!have) continue;
        if (part === 'q') entry.q = key;
        else if (part === 'why') entry.why = key;
        else entry.opts[PARTS_OPTS.indexOf(part)] = key;
      }
      if (entry.q || entry.why || entry.opts.some(Boolean)) audio[q.id] = entry;
    }

    // Merge into the freshest meta, so a concurrent write to another key survives.
    const { data: fresh } = await client.from('quizzes').select('meta').eq('id', quizId).maybeSingle();
    const meta = (fresh && fresh.meta) || quiz.meta || {};
    const web = meta.web && typeof meta.web === 'object' ? meta.web : {};
    const nextMeta = { ...meta, web: { ...web, audio: { ...(web.audio || {}), ...audio } } };
    const { error: uErr } = await client.from('quizzes').update({ meta: nextMeta }).eq('id', quizId);
    if (uErr) throw uErr;

    return done({ ok: true, questions: (questions || []).length });
  } catch (error) {
    logError('web_quiz.publish_audio.failed', {
      event: 'web_quiz.publish_audio.failed', quizId, error: String(error.message || error).slice(0, 300),
    });
    return done({ ok: false, reason: 'error' });
  }
}

module.exports = { publishQuizAudio, audioKey, partsFor, spoken };
