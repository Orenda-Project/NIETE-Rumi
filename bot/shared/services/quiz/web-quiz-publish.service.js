'use strict';
/**
 * Web quiz publish step: read-aloud clips.
 *
 * For one quiz, records one clip per question text, per option text and per
 * "why" line, in the quiz's language, through the bot's own voice gateway
 * (services/tts — the same voices as the teacher voice notes; no new provider).
 * Every clip is spoken in the quiz's ONE voice (web-quiz-voice.js), the voice the
 * shared feedback lines were recorded in, with no fallback provider: a clip the
 * voice cannot make stays missing and is retried, never recorded in another voice.
 * Each clip is stored once in R2 (bucket and key: web-quiz-audio-store.js) at
 *
 *   quiz-audio/<env>/<quiz_id>/<lang>/<question_id>/<part>-<voice>-<hash8>.ogg
 *     part = q | a | b | c | d | why | xa | xb | xc | xd | hint
 *
 * (xa..xd = the feedback said after a WRONG pick of that option; hint = the item's hint).
 *
 * where <hash8> is taken from the language, the voice and the exact words, so a
 * question whose words change, or a new voice, gets a new clip on the next publish
 * instead of keeping the old one.
 *
 * What is said: a question with a SCHEMA_v2 web item (media.web) is voiced from
 * its read.stem / read.opts (plain words written for the voice; each option on
 * its own slot). A row with no web item falls back to mathToText of the row's
 * text. Neither path ever hands TeX ("$\frac{1}{2}$") to the voice.
 *
 * and the keys are written into quizzes.meta.web.audio as
 *
 *   { <question_id>: { q, opts: [a, b, c, d], why, fbs: [xa, xb, xc, xd], hint? } }      (null where there is no clip)
 *
 * plus meta.web.audio_v = AUDIO_VERSION once every clip of the quiz is there, so
 * ensureQuizAudio() (called when the page is opened) publishes each quiz once;
 * meta.web.audio_bucket (where the keys are), audio_voice (the voice tag) and
 * audio_day (the day clips were last recorded, counted by the daily cap).
 *
 * merged into the existing meta, so nothing else in meta is touched.
 *
 * - Idempotent: a clip already in R2 is not recorded again.
 * - Records only what is missing: a question or option the bank already voices (its own recorded
 *   clip, web-quiz-sound recordedParts) is not recorded — the page plays the recorded one.
 * - Capped per quiz (maxClips), so a bad quiz cannot spend without limit.
 * - Fails soft: a clip that cannot be made is counted and skipped; the page
 *   falls back to the phone's own voice for it. Never throws.
 *
 * Read-aloud keys live in quizzes.meta, NOT quiz_questions.media: the WhatsApp
 * phase renderer reads media and sends what it finds there.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const tts = require('../tts');
const { mathToText } = require('./quiz-math');
const { cleanWrongFeedback } = require('./web-quiz-feedback');
const r2 = require('../../storage/r2');
const Voice = require('./web-quiz-voice');
const Store = require('./web-quiz-audio-store');
const { logEvent } = require('../../utils/structured-logger');
const { logError } = require('../../utils/logger');
const { resolveUx } = require('../../config/ux-strings');

const PARTS_OPTS = ['a', 'b', 'c', 'd'];
const DEFAULT_MAX_CLIPS = 120;
const CLIP_WORKERS = 4;
// Bumped when the clips of every quiz change (2: the why is the reason, wrong-option feedback
// recorded; 3: stored small; 4: one voice per language, new key scheme, configurable bucket; 5: maths
// operators said as words, keys from the words the voice is given; 6: an open "= ?" said "= what?"), so
// already-published quizzes are brought up to date on their next open.
const AUDIO_VERSION = 6;
const PARTS_FB = ['xa', 'xb', 'xc', 'xd'];
// Spend estimate for the log line, by the provider that actually spoke:
// ElevenLabs bills per character, Soniox per second of audio (tts/index.js).
const USD_PER_CHAR = 0.10 / 1000;
const SONIOX_USD_PER_AUDIO_SECOND = 0.722 / 3600;

function clipCostUsd(res, text) {
  if (res.provider === 'soniox') return (res.durationSec || 0) * SONIOX_USD_PER_AUDIO_SECOND;
  if (res.provider === 'elevenlabs') return text.length * USD_PER_CHAR;
  return 0;
}

// Clips are stored as mono Opus at 24 kbps: a child pays for every byte, and at this rate the
// bot's own speech-to-text hears exactly the words it hears in the vendor's ~57 kbps clip
// (bake-off, 24 clips Urdu + English). The format is part of each clip's key, so a quiz recorded
// in another format gets new clips on its next publish.
const CLIP_KBPS = 24;
const CLIP_FORMAT = `opus${CLIP_KBPS}m`;

/** A clip's key (web-quiz-audio-store.js), in the quiz voice of `language`, for this deployment. */
function audioKey(quizId, questionId, part, text, language, { env } = {}) {
  return clipKey({ env, quizId, lang: language, qid: questionId, part, voice: Voice.voiceTag(language), text });
}

function clipKey(args) {
  return Store.clipKey({ format: CLIP_FORMAT, ...args });
}

/** Text as it should be spoken: no TeX, no Markdown markers, no stored option letters, a blank as a pause. */
function spoken(text) {
  if (text == null) return '';
  let out = mathToText(String(text)).replace(/[\\$]/g, ' ');
  // "The rabbit was eating _." — a fill-in blank is a pause, never "underscore" or "dash".
  out = out.replace(/_{1,}/g, ' … ');
  // "A) Roots drink water" -> "Roots drink water"; the page shuffles options, so
  // a stored letter can name a different option than the one the child sees.
  out = out.replace(/(^|\s)\(?[A-D]\)\s*/g, '$1');
  out = out.replace(/\b(answer\s+is\s+)[A-D]\b\.?/gi, '$1');
  out = out.replace(/[*_`#]+/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

// Praise at the start of a feedback line ("Well done!", «شاباش!»). The why clip is played after a
// WRONG answer too, so it carries the reason only; praise is the page's own line. A word counts as
// praise only when punctuation follows it: "Right angles…" and «صحیح جواب…» are kept.
const PRAISE_LEAD = /^\s*(?:(?:well done|very good|good job|great job|great work|great|excellent work|excellent|amazing|fantastic|super|good|nice|brilliant|awesome|correct|that's right|you got it|perfect|nice work|شاباش|بہت خوب|بہت اچھے|بہت اچھا|زبردست|بالکل درست|بالکل ٹھیک|درست|صحیح|جی ہاں|واہ)\s*[!.،,۔:]+\s*)+/i;

function withoutPraise(text) {
  const t = spoken(text);
  const cut = t.replace(PRAISE_LEAD, '').trim();
  return SAYABLE.test(cut) ? cut : '';
}

/** The reason the right answer is right: the explanation, else the correct-answer feedback minus its praise. */
function whyText(q) {
  const fb = q.option_feedback && typeof q.option_feedback === 'object' ? q.option_feedback : {};
  return spoken(q.explanation) || withoutPraise(fb.correct);
}

// A single letter is said by its NAME, the way a teacher reads it off the board (the voice would
// otherwise guess a sound, or skip it): an English letter as "letter s", an Urdu letter by its Urdu
// name ("عین"). The page still shows the letter; only what the voice reads changes.
const URDU_LETTER_NAMES = Object.freeze({
  'ا': 'الف', 'آ': 'الف مد', 'ب': 'بے', 'پ': 'پے', 'ت': 'تے', 'ٹ': 'ٹے', 'ث': 'ثے', 'ج': 'جیم', 'چ': 'چے', 'ح': 'بڑی حے',
  'خ': 'خے', 'د': 'دال', 'ڈ': 'ڈال', 'ذ': 'ذال', 'ر': 'رے', 'ڑ': 'ڑے', 'ز': 'زے', 'ژ': 'ژے', 'س': 'سین', 'ش': 'شین',
  'ص': 'صاد', 'ض': 'ضاد', 'ط': 'طوئے', 'ظ': 'ظوئے', 'ع': 'عین', 'غ': 'غین', 'ف': 'فے', 'ق': 'قاف', 'ک': 'کاف', 'گ': 'گاف',
  'ل': 'لام', 'م': 'میم', 'ن': 'نون', 'ں': 'نون غنہ', 'و': 'واؤ', 'ہ': 'چھوٹی ہے', 'ھ': 'دو چشمی ہے', 'ء': 'ہمزہ',
  'ی': 'چھوٹی یے', 'ے': 'بڑی یے',
});

/** An option as the voice should say it (spoken(), plus a lone letter by its name). */
function spokenOption(text) {
  const t = spoken(text);
  if (/^[A-Za-z]$/.test(t)) return `letter ${t}`;
  if (URDU_LETTER_NAMES[t]) return URDU_LETTER_NAMES[t];
  return t;
}

// Maths brackets are said as round ones. The voice's text step (services/tts, soniox-text mapTags) treats
// any [..] that is not a voice direction as a stage direction and removes it, so an option written
// "[ 4 × { 18 − 8 } ]" left nothing to say and its clip failed. Only brackets holding numbers and operators
// (no letters) change, innermost first; a [direction] or a [placeholder] keeps the voice's own rules. Inside
// a group it changes, a spaced hyphen between two operands is the minus sign it was written as.
const MATHS_INNER = /^[\s\d.,+\-−×÷*/=<>()%^:]*\d[\s\d.,+\-−×÷*/=<>()%^:]*$/u;
function speakableMaths(text) {
  let out = String(text == null ? '' : text);
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/\[([^[\]{}]*)\]|\{([^[\]{}]*)\}/g, (whole, sq, cu) => {
      const inner = sq !== undefined ? sq : cu;
      return MATHS_INNER.test(inner) ? `(${inner.replace(/([\d)])\s+-\s+(?=[\d(])/g, '$1 − ')})` : whole;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

// Maths operators are said as words in the quiz's language (the catalog's wqSay* strings). The voice's text
// step reads a hyphen between digits as a range ("18 - 8" -> "18 to 8") and mathToText writes every
// subtraction with one, and × ÷ reached the voice as bare symbols. A minus is told from a range the way the
// quiz text writes them: "−" or a hyphen with spaces round it is a minus, and so is a hyphen in a run of
// numbers that ends in "=" ("14-5=9"); an en dash or a bare "30-39" is a range and is left to the text step.
const BIDI_MARKS = /[\u200e\u200f\u2066-\u2069]/g;
const NUM = String.raw`\p{N}[\p{N},.]*(?:\/\p{N}+)?`;
const TIGHT_RUN = new RegExp(String.raw`(?<![\p{L}\p{N}-])${NUM}(?:-${NUM})+(?=\s*=)`, 'gu');
const MINUS_SIGN = /(?<=[\p{L}\p{N})\]])\s*−\s*(?=[\p{L}\p{N}(\[])/gu;
const SPACED_HYPHEN = /(?<=[\p{N})\]])\s+-\s+(?=[\p{N}(\[])/gu;
const operatorWord = (key, language) => ` ${resolveUx(key, { language }).replace(BIDI_MARKS, '').trim()} `;
function spokenOperators(text, language) {
  const minus = operatorWord('wqSayMinus', language);
  return String(text == null ? '' : text)
    .replace(TIGHT_RUN, (run) => run.replace(/-/g, ' − '))
    .replace(MINUS_SIGN, minus)
    .replace(SPACED_HYPHEN, minus)
    .replace(/\s*×\s*/g, operatorWord('wqSayTimes', language))
    .replace(/\s*÷\s*/g, operatorWord('wqSayDividedBy', language))
    .replace(/\s+/g, ' ')
    .trim();
}

// An "=" with only a blank or a question mark after it ("720 ÷ 6 = ?", "15 + 27 = ___") left the
// voice on "… equals" with no word to say, and it sometimes made one up ("equals questions Z"; 11 of 60 takes, 0 of 60
// with a word there). The blank is said as the catalog's words (wqSayEqualsBlank: "what?" / «کتنے؟»). An "=" with
// its value, a blank before the "=" ("12 + … = 20"), or a bare "=" ("Equal sign =", which the voice ends cleanly) is
// left as written.
const EQUALS_BLANK = /=\s*(?:(?:…|\.{3})\s*[?؟]?|[?؟])(?:\s*[.!۔](?=\s|$))?(?=\s*(?:$|[\p{L}"'(]))/gu;
function sayEqualsBlank(text, language) {
  const word = resolveUx('wqSayEqualsBlank', { language }).replace(BIDI_MARKS, '').trim();
  return String(text == null ? '' : text).replace(EQUALS_BLANK, `= ${word}`);
}

/** The words a clip's voice is given (and its key is made from): maths brackets round, operators as words, an open "=" closed with a word. */
function voiceText(text, language) {
  return sayEqualsBlank(spokenOperators(speakableMaths(text), language), language);
}

// Something a voice can say. A picture option is stored as an emoji (no letter,
// no digit): the voices strip it to nothing and the gateway would fall through
// to a different voice, so it gets no clip — the page shows the picture.
const SAYABLE = /[\p{L}\p{N}]/u;

function webItemOf(q) {
  const w = q && q.media && q.media.web;
  return w && w.v === 2 && Array.isArray(w.options) ? w : null;
}

/** The parts a question's own recorded voices already say (web-quiz-sound): never recorded again. */
function recordedParts(q) {
  try { return require('./web-quiz-sound').recordedParts(q); } catch (_) { return new Set(); }
}

/** The clips one question needs, in order: [{ part, text }]. A part the bank already has a recorded clip for is not one. */
function partsFor(q) {
  const parts = [];
  const have = recordedParts(q || {});
  const add = (part, text) => { if (text && SAYABLE.test(text) && !have.has(part)) parts.push({ part, text }); };
  const w = webItemOf(q);
  if (w) {
    const read = w.read && typeof w.read === 'object' ? w.read : {};
    const readOpts = Array.isArray(read.opts) ? read.opts : [];
    add('q', spoken(read.stem) || spoken(w.stem));
    // read.opts[i] belongs to options[i]; the clip goes on that option's slot (the page looks it up by slot).
    w.options.forEach((o, i) => {
      const p = PARTS_OPTS['ABCD'.indexOf(String((o && o.slot) || '').charAt(0))];
      if (p) add(p, spoken(readOpts[i]) || spoken(o.name) || spoken(o.text));
    });
    add('why', spoken(w.why) || whyText(q) || withoutPraise(w.fb_right));
    w.options.forEach((o) => {
      const x = PARTS_FB['ABCD'.indexOf(String((o && o.slot) || '').charAt(0))];
      if (x) add(x, spoken(cleanWrongFeedback(o && o.fb)));
    });
    const hint = w.hint && typeof w.hint === 'object' ? w.hint : null;
    if (hint) add('hint', spoken(hint.read) || spoken(hint.text));
    return parts;
  }
  add('q', spoken(q.question_text));
  PARTS_OPTS.forEach((p) => add(p, spokenOption(q[`option_${p}`])));
  add('why', whyText(q));
  const wrong = (q.option_feedback && typeof q.option_feedback === 'object' && q.option_feedback.wrong) || {};
  PARTS_FB.forEach((x, i) => add(x, spoken(cleanWrongFeedback(wrong[String(i)]))));
  return parts;
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; }
}

/** The vendor's clip re-encoded to mono Opus at CLIP_KBPS; the original when ffmpeg fails or it would not be smaller. */
function compactClip(audio) {
  const base = path.join(os.tmpdir(), `wq-clip-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const src = `${base}.in.ogg`;
  const out = `${base}.ogg`;
  const cleanup = () => { [src, out].forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }); };
  return new Promise((resolve) => {
    try { fs.writeFileSync(src, audio); } catch (_) { resolve(audio); return; }
    execFile(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-c:a', 'libopus', '-b:a', `${CLIP_KBPS}k`,
      '-application', 'voip', '-f', 'ogg', out], { timeout: 20000 }, (err) => {
      let small = null;
      if (!err) { try { small = fs.readFileSync(out); } catch (_) { small = null; } }
      cleanup();
      resolve(small && small.length > 0 && small.length < audio.length && small.slice(0, 4).toString() === 'OggS' ? small : audio);
    });
  });
}

async function exists(key, bucket) {
  try {
    return (await r2.headObject(key, { bucket })).exists;
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
      .select('id, question_text, option_a, option_b, option_c, option_d, correct_option, option_feedback, explanation, media, sort_order')
      .eq('quiz_id', quizId).order('sort_order', { ascending: true });
    if (qsErr) throw qsErr;

    const language = quizLanguage(quiz, questions);
    const allowed = await Store.recordingAllowed({ db: client, quizId, logEvent, logError });
    if (!allowed.ok) return done({ ok: false, reason: allowed.reason });
    const voice = Voice.quizVoice(language);
    // Never a clip in no quiz voice: it would be a second voice beside the shared lines.
    if (!voice) return done({ ok: false, reason: 'no_voice', language: language || null });
    const voiceTag = Voice.voiceTag(language);
    const bucket = Store.quizAudioBucket();
    const env = Store.deployEnv();
    // Every clip of the quiz is one task; CLIP_WORKERS run at once (the vendor caps a process's calls
    // itself), so a 5-question quiz is recorded in a fraction of the one-after-another time.
    const entries = new Map();
    const tasks = [];
    for (const q of questions || []) {
      entries.set(q.id, { q: null, opts: [null, null, null, null], why: null, fbs: [null, null, null, null], hint: null });
      for (const { part, text } of partsFor(q)) {
        // The key is made from the words the voice is given: a clip recorded with other words is recorded again.
        const say = voiceText(text, language);
        tasks.push({ q, part, text: say, key: clipKey({ env, quizId, lang: language, qid: q.id, part, voice: voiceTag, text: say }) });
      }
    }
    // The quiz's clips in meta.web: the map of every entry so far, merged into the freshest meta so a
    // concurrent write to another key survives; stamped audio_v only when the whole quiz is done.
    const writeAudio = async ({ final }) => {
      const audio = {};
      for (const [qid, entry] of entries) {
        const { hint, ...rest } = entry;
        const copy = { ...rest, opts: [...entry.opts], fbs: [...entry.fbs] };   // a snapshot: recording goes on
        if (entry.q || entry.why || hint || entry.opts.some(Boolean) || entry.fbs.some(Boolean)) audio[qid] = hint ? { ...copy, hint } : copy;
      }
      const { data: fresh } = await client.from('quizzes').select('meta').eq('id', quizId).maybeSingle();
      const meta = (fresh && fresh.meta) || quiz.meta || {};
      const web = meta.web && typeof meta.web === 'object' ? meta.web : {};
      const complete = final && stats.failed === 0 && !stats.capped;
      const nextMeta = { ...meta, web: {
        ...web, audio: { ...(web.audio || {}), ...audio }, audio_bucket: bucket, audio_voice: voiceTag,
        ...(stats.synthesized ? { audio_day: allowed.day } : {}), ...(complete ? { audio_v: AUDIO_VERSION } : {}),
      } };
      const { error: uErr } = await client.from('quizzes').update({ meta: nextMeta }).eq('id', quizId);
      if (uErr) throw uErr;
    };
    // A quiz is often recorded while its first child is already on question 1 (the page asks for the
    // clips and takes them as they land): question 1's clips are written the moment they all exist,
    // not a minute later with the rest. Its tasks are first in the queue.
    const firstQid = (questions || []).length > 1 ? questions[0].id : null;
    let firstLeft = firstQid ? tasks.filter((t) => t.q.id === firstQid).length : 0;
    let early = Promise.resolve();
    let started = 0;
    const recordOne = async ({ q, part, text, key }) => {
      let have = await exists(key, bucket);
      if (have) {
        stats.skipped += 1;
      } else if (started >= maxClips) {
        stats.capped = true;
      } else {
        started += 1;
        try {
          const res = await tts.synthesize({
            text, language, useCase: 'reading', site: 'web_quiz_read_aloud', ...(voice ? { provider: voice.provider, voice: voice.voice } : {}),
          });
          const clip = await compactClip(res.audio);
          await r2.uploadBuffer(clip, key, 'audio/ogg', { bucket });
          stats.synthesized += 1;
          stats.chars += text.length;
          stats.bytes += clip.length;
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
      if (!have) return;
      const entry = entries.get(q.id);
      if (part === 'q') entry.q = key;
      else if (part === 'why') entry.why = key;
      else if (part === 'hint') entry.hint = key;
      else if (PARTS_FB.includes(part)) entry.fbs[PARTS_FB.indexOf(part)] = key;
      else entry.opts[PARTS_OPTS.indexOf(part)] = key;
    };
    const record = async (task) => {
      await recordOne(task);
      if (firstQid && task.q.id === firstQid && (firstLeft -= 1) === 0) {
        early = writeAudio({ final: false }).catch((error) => logError('web_quiz.publish_audio.early_write_failed', {
          event: 'web_quiz.publish_audio.early_write_failed', quizId, error: String(error.message || error).slice(0, 200),
        }));
      }
    };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CLIP_WORKERS, tasks.length) }, async () => {
      while (next < tasks.length) await record(tasks[next++]);
    }));
    await early;
    await writeAudio({ final: true });

    return done({ ok: true, questions: (questions || []).length });
  } catch (error) {
    logError('web_quiz.publish_audio.failed', {
      event: 'web_quiz.publish_audio.failed', quizId, error: String(error.message || error).slice(0, 300),
    });
    return done({ ok: false, reason: 'error' });
  }
}

// ─── publish on first open ──────────────────────────────────────────────────

const inflight = new Map();   // quizId -> promise: one publish per quiz per process at a time
const lastFail = new Map();   // quizId -> ms: a failing quiz is not retried on every page open
const RETRY_AFTER_MS = 15 * 60 * 1000;

/**
 * Make sure a quiz has its read-aloud clips: called (not awaited) when its page is opened.
 * A quiz already at AUDIO_VERSION is left alone; one being published is not started twice;
 * a failure waits RETRY_AFTER_MS before the next try. Never throws.
 * @param {string} quizId
 * @param {object} opts
 * @param {object} [opts.meta]     quizzes.meta as the caller already read it
 * @param {Function} [opts.publish] publishQuizAudio (tests pass a fake)
 */
/**
 * The quiz's language for its voice: the row's, else the questions' own script (a video-bank
 * quiz has none — every bank quiz's language is NULL — and recorded as voice "default").
 */
function quizLanguage(quiz, questions) {
  if (quiz && quiz.language) return quiz.language;
  const text = (questions || []).map((q) => `${q.question_text || ''} ${q.option_a || ''}`).join(' ');
  return /[\u0600-\u06FF]/.test(text) ? 'ur' : 'en';
}

/** Recorded at this version, in a real quiz voice (a "default" voice is a quiz to record again). */
function isCurrent(web) {
  return Number(web && web.audio_v) >= AUDIO_VERSION && (web.audio_voice || '') !== 'default';
}

function ensureQuizAudio(quizId, { meta, db, publish = module.exports.publishQuizAudio } = {}) {
  const web = (meta && meta.web) || {};
  if (!quizId || isCurrent(web)) return Promise.resolve({ skipped: 'current' });
  if (inflight.has(quizId)) return inflight.get(quizId);
  const failedAt = lastFail.get(quizId);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve({ skipped: 'cooldown' });
  const run = Promise.resolve()
    .then(() => publish(quizId, { db }))
    .then((out) => { if (!out || !out.ok) lastFail.set(quizId, Date.now()); else lastFail.delete(quizId); return out || {}; })
    .catch((error) => {
      lastFail.set(quizId, Date.now());
      logError('web_quiz.publish_audio.ensure_failed', { event: 'web_quiz.publish_audio.ensure_failed', quizId, error: String(error.message || error).slice(0, 200) });
      return { ok: false, reason: 'error' };
    })
    .finally(() => inflight.delete(quizId));
  inflight.set(quizId, run);
  return run;
}

// ─── record on the worker ────────────────────────────────────────────────────

const JOB = 'quiz_web_audio';
const requested = new Map(); // quizId -> ms: one request per quiz per process every REQUEST_AGAIN_MS
const REQUEST_AGAIN_MS = 10 * 60 * 1000;

/**
 * Ask the worker to record a quiz's clips (job quiz_web_audio on the quiz queue): called when a
 * teacher is handed the quiz's web link, and when its page is opened. A quiz already at
 * AUDIO_VERSION is not queued. If the queue cannot take the job, the clips are made here instead
 * (ensureQuizAudio), so a child is never left without them. Never throws.
 */
async function requestQuizAudio(quizId, { meta, queue, publish, db } = {}) {
  const web = (meta && meta.web) || {};
  if (!quizId || isCurrent(web)) return { skipped: 'current' };
  const at = requested.get(quizId);
  if (at && Date.now() - at < REQUEST_AGAIN_MS) return { skipped: 'requested' };
  requested.set(quizId, Date.now());
  try {
    const q = queue || require('../queue');
    await q.queueJob(quizId, JOB, { quizId }, { deduplicationId: `${quizId}-${JOB}-v${AUDIO_VERSION}` });
    return { queued: true };
  } catch (error) {
    logError('web_quiz.publish_audio.queue_failed', { event: 'web_quiz.publish_audio.queue_failed', quizId, error: String(error.message || error).slice(0, 200) });
    return ensureQuizAudio(quizId, { meta, db, ...(publish ? { publish } : {}) });
  }
}

// A job whose clips failed (the vendor rate-limits, or every voice in the chain failed) comes
// back later with a growing wait; after the last try the quiz stays unstamped, so its page keeps
// asking for it (and shows the words big where there is no voice).
const RETRY_DELAYS_S = [120, 240, 480, 900];

/** The worker's job: record the quiz's clips unless they are already current. */
async function runQuizAudioJob(payload, { db, publish = module.exports.publishQuizAudio, queue } = {}) {
  const quizId = payload && payload.quizId;
  if (!quizId) return { ok: false, reason: 'no_quiz' };
  const attempt = Number(payload.attempt) || 0;
  const client = db || require('../../config/supabase');
  const { data } = await client.from('quizzes').select('meta').eq('id', quizId).maybeSingle();
  const web = (data && data.meta && data.meta.web) || {};
  if (isCurrent(web)) return { skipped: 'current' };
  const out = (await publish(quizId, { db: client })) || {};
  if (out.ok && !out.failed) return out;
  // Switched off or over today's cap: a retry would only be refused again (the next page open asks anew).
  if (out.reason === 'disabled' || out.reason === 'capped' || out.reason === 'no_voice') return out;
  if (attempt >= RETRY_DELAYS_S.length) {
    logError('web_quiz.publish_audio.gave_up', { event: 'web_quiz.publish_audio.gave_up', quizId, attempt, failed: out.failed, reason: out.reason });
    return out;
  }
  const q = queue || require('../queue');
  await q.queueJob(quizId, JOB, { quizId, attempt: attempt + 1 }, {
    delaySeconds: RETRY_DELAYS_S[attempt], deduplicationId: `${quizId}-${JOB}-retry-${attempt + 1}-${Date.now()}`,
  });
  return { ...out, retry: attempt + 1 };
}

module.exports = {
  quizLanguage, isCurrent, publishQuizAudio, ensureQuizAudio, requestQuizAudio, runQuizAudioJob, audioKey, clipKey, partsFor, spoken, spokenOption, speakableMaths, spokenOperators, voiceText, whyText, withoutPraise, AUDIO_VERSION,
};
