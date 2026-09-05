'use strict';
/**
 * The class report a teacher gets after sharing a video quiz.
 *
 * Fires the NEXT MORNING, or early once every child who started has finished —
 * whichever comes first. Same promise as the /quiz report, and deliberately the
 * same shape, because a teacher should not have to learn two report formats for
 * the same question ("how did my class do?").
 *
 * WHAT IT ANSWERS, in this order:
 *   1. how many started, how many finished
 *   2. the class average
 *   3. which questions the class found hardest — the actual teaching signal
 *   4. who has not done it yet
 *
 * Scheduling uses the existing SQS job queue rather than a new mechanism: the
 * parent quiz already cascades a `quiz_report` job and advances it when all
 * sessions reach a terminal state. This registers a sibling job type so the two
 * cannot dedupe against each other.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { stripEmphasis, classLabel } = require('../../utils/text-format');
const { clampLanguage, resolveUx } = require('../../config/ux-strings');
const { formatLessonDate } = require('./transcript-quiz-language');

/**
 * The job-type prefix is load-bearing, not cosmetic.
 *
 * queueJob routes by it: only `quiz_*` reaches SQS_QUIZ_QUEUE_URL, a STANDARD
 * queue that honours per-message DelaySeconds. Everything else lands on
 * SQS_QUEUE_URL, which is FIFO — and queueJob deliberately drops delaySeconds
 * there, because FIFO rejects it per-message. Under the old name
 * ('video_quiz_report') the delay was silently discarded and the "next morning"
 * report was delivered within seconds of the first child joining.
 *
 * Still distinct from the parent quiz's `quiz_report`, so the two can never
 * dedupe against each other.
 */
const JOB_TYPE = 'quiz_video_report';

/** The name this job shipped under before the rename. Still consumed so any
 *  message already sitting in the queue is not dropped on deploy. */
const LEGACY_JOB_TYPE = 'video_quiz_report';

/**
 * RTL (Perso-Arabic-script) quiz languages this report localises for.
 * NIETE is flat en/ur (root CLAUDE.md language-protocol) — no pa-PK/sd-PK
 * concept here, unlike the main bot's 5-market region-keyed offer. Ported
 * from the main bot. See the PlayWriteReports skill.
 */
const RTL_LANGS = new Set(['ur']);

const PKT_OFFSET_MIN = 5 * 60;

/** Nothing new may start for this long before an early send is allowed. */
const QUIET_PERIOD_MS = 2 * 60 * 60 * 1000;

/** Scheduled fallback: this far after the first child joins. */
const REPORT_DELAY_MS = 12 * 60 * 60 * 1000;

/**
 * When the scheduled report should land: 12 hours after the first child joins
 * (operator call). Was "07:00 PKT next morning", which for a 9am share meant
 * a 22-hour wait — the teacher had already taught the follow-up lesson.
 *
 * CIVIL-HOURS GUARD: a plain +12h from an afternoon share lands at 2-4am. A
 * report that buzzes at 3am is worse than one that waits, so anything landing
 * between 22:00 and 07:00 PKT is pushed to 07:00 PKT. This is the one piece the
 * operator did not specify; it is deliberately a floor, never a delay past the
 * following morning.
 */
function reportTargetUtc(now = new Date()) {
  const t = new Date(now.getTime() + REPORT_DELAY_MS);
  const pkt = new Date(t.getTime() + PKT_OFFSET_MIN * 60 * 1000);
  const h = pkt.getUTCHours();
  if (h >= 22 || h < 7) {
    const bump = new Date(Date.UTC(
      pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() + (h >= 22 ? 1 : 0), 7, 0, 0
    ));
    return new Date(bump.getTime() - PKT_OFFSET_MIN * 60 * 1000);
  }
  return t;
}

/**
 * Is this share code finished enough to report on NOW?
 *
 * Pure so it can be asserted directly — routing it through maybeSendEarly()
 * would let a stubbed share-code lookup produce a green that never touched the
 * rule.
 *
 * TWO conditions, and the second is the one that was missing:
 *   1. every session is terminal, AND
 *   2. nothing new has started for QUIET_PERIOD_MS.
 *
 * Without (2) a forwarded link fires on its first finisher: at 2:10pm the only
 * session in existence is terminal, the report goes out reading "1 of 1", and
 * because there is one report per code the other 29 children are never reported.
 */
const TERMINAL_STATUSES = ['completed', 'incomplete', 'expired', 'cancelled'];

function shouldSendEarly(sessions, now = Date.now()) {
  if (!Array.isArray(sessions) || !sessions.length) return false;
  if (!sessions.every((s) => TERMINAL_STATUSES.includes(s.status))) return false;
  const newest = Math.max(...sessions.map((s) => new Date(s.created_at || 0).getTime()));
  return (now - newest) >= QUIET_PERIOD_MS;
}

/**
 * Schedule the report for a share code. Idempotent per code — a second call
 * (another child joining) must not queue a second report.
 */
async function scheduleForShareCode(shareCodeId) {
  try {
    const SQSQueueService = require('../queue/sqs-queue.service');
    const when = reportTargetUtc();
    const delaySeconds = Math.max(60, Math.floor((when - Date.now()) / 1000));
    await SQSQueueService.queueJob(shareCodeId, JOB_TYPE, {
      shareCodeId,
      // targetAt MUST live in the payload. queueJob builds its message
      // body from {groupId, jobType, payload, ...} and drops the options object,
      // so an options-only targetAt never reached the worker — the "not morning
      // yet, re-queue" cascade read undefined and generated the report on the
      // very first delivery.
      targetAt: when.toISOString(),
    }, {
      // SQS DelaySeconds caps at 900s; the handler re-queues until the target
      // time, the same cascade the parent quiz report uses.
      delaySeconds: Math.min(900, delaySeconds),
      deduplicationId: `${shareCodeId}-${JOB_TYPE}-morning`,
    });
    logEvent('video_quiz.report_scheduled', { shareCodeId, targetAt: when.toISOString() });
  } catch (err) {
    logToFile('⚠️ video-quiz report scheduling failed (non-fatal)', {
      shareCodeId, error: err.message,
    });
  }
}

/**
 * Every child who started has finished → send now rather than wait for morning.
 * Idempotent: only fires when at least one session exists and none is still
 * in flight.
 */
async function maybeSendEarly(shareCodeId) {
  if (!shareCodeId) return false;
  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('status, created_at')
    .eq('share_code_id', shareCodeId)
    .is('invited_by_student_id', null);   // a friend's session is not this teacher's class
  if (!shouldSendEarly(sessions || [])) return false;
  return generate(shareCodeId, { reason: 'all_finished' });
}

/**
 * Build and send the report. Safe to call twice — genuinely guarded on
 * `report_sent_at` (the previous version of this comment claimed a
 * guard that was never implemented and no column that existed).
 */
async function generate(shareCodeId, { reason = 'scheduled', force = false } = {}) {
  const { data: sc } = await supabase
    .from('quiz_share_codes')
    .select('id, code, quiz_id, teacher_user_id, teacher_name, topic, language, '
            + 'created_at, report_sent_at')
    .eq('id', shareCodeId)
    .maybeSingle();
  if (!sc) return false;

  // ONE report per share code. A teacher who has already been told how her
  // class did should never be told again — and both trigger paths (the morning
  // job and the all-finished early send) can legitimately fire for the same code.
  // `force` is the one exception: she asked for it herself from /quiz.
  if (sc.report_sent_at && !force) {
    logEvent('video_quiz.report_suppressed', {
      shareCodeId, reason, why: 'already_sent', sentAt: sc.report_sent_at,
    });
    return false;
  }

  const { data: teacher } = await supabase
    .from('users').select('phone_number, preferred_language')
    .eq('id', sc.teacher_user_id).maybeSingle();
  if (!teacher?.phone_number) {
    logToFile('⚠️ video-quiz report: no teacher phone', { shareCodeId });
    return false;
  }

  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('id, student_name, student_class, status, total_questions_answered, '
            + 'correct_answers, mastery_percentage')
    .eq('share_code_id', shareCodeId)
    .is('invited_by_student_id', null);   // a friend's session is not this teacher's class

  const all = sessions || [];
  const done = all.filter((s) => s.status === 'completed');

  // Never send a results message with no results in it.
  //
  // The operator received "0 of 1 students finished" seconds after the first
  // child opened the link. An EARLY trigger only earns a send once somebody has
  // actually finished; before that there is nothing to say, and saying it
  // spends the teacher's attention on noise.
  //
  // The SCHEDULED morning run is different: that is the moment she was promised
  // a report, so she hears from us even if the class never finished. Silence
  // there would read as the feature being broken.
  if (reason !== 'scheduled' && !done.length) {
    logEvent('video_quiz.report_suppressed', {
      shareCodeId, reason, why: 'nothing_completed_yet', started: all.length,
    });
    return false;
  }

  // Transcript quizzes carry the lesson digest on the quiz row; the SLO each
  // question checks is stored in the question's external_id ("tq:<quizId>:S2:5";
  // older rows are "tq:S2:5" — the SLO is the second-to-last segment either way).
  //
  // The FULL digest — not just the SLO-statement map — now also reaches the
  // guidance generator (PLAN_R4 D6): topic_as_taught, every SLO with its
  // taught_level, the misconceptions that surfaced in the lesson, and
  // lesson_summary once lane B/D's PLAN D4 lands it (it may sit at either
  // meta.digest.lesson_summary or meta.lesson_summary — read both
  // defensively, never throw when neither exists). A non-transcript quiz
  // (the PK bot's video-quiz lane shares this service on NIETE) keeps
  // digest === null and behaves exactly as it did before this change.
  let sloOf = () => null;
  let digest = null;
  try {
    const { data: quizRow } = await supabase.from('quizzes')
      .select('quiz_source, meta').eq('id', sc.quiz_id).maybeSingle();
    const rawDigest = quizRow?.quiz_source === 'transcript' ? (quizRow?.meta?.digest || null) : null;
    if (rawDigest) {
      const slos = Array.isArray(rawDigest.slos) ? rawDigest.slos : [];
      const byId = new Map(slos.map((s) => [s.id, s.statement]));
      sloOf = (externalId) => {
        const parts = String(externalId || '').split(':');
        return byId.get(parts[parts.length - 2]) || null;
      };
      digest = {
        topic_as_taught: rawDigest.topic_as_taught || null,
        slos: slos.map((s) => ({ id: s.id, statement: s.statement, taught_level: s.taught_level })),
        misconceptions_surfaced: Array.isArray(rawDigest.misconceptions_surfaced)
          ? rawDigest.misconceptions_surfaced : [],
        lesson_summary: rawDigest.lesson_summary || quizRow?.meta?.lesson_summary || null,
      };
    }
  } catch (e) {
    logToFile('⚠️ video-quiz report: could not read quiz digest (non-fatal)', { error: e.message });
  }

  if (!all.length) {
    await WhatsAppService.sendMessage(teacher.phone_number,
      resolveUx('vqReportNoOne', { language: clampLanguage(teacher.preferred_language), params: { topic: sc.topic } }));
    await markReportSent(shareCodeId, sc.quiz_id);
    return true;
  }

  const avg = done.length
    ? Math.round(done.reduce((s, x) => s + (x.mastery_percentage || 0), 0) / done.length)
    : 0;

  const hardest = (await hardestQuestions(shareCodeId))
    .map((h) => ({ ...h, slo: sloOf(h.external_id) }));
  const unfinished = all.filter((s) => s.status !== 'completed');

  // The WhatsApp text fallback (only used when the PDF render fails) is the
  // same small chrome-string lookup the PDF template uses (see
  // PlayWriteReports skill), scoped down to what this plain-text path needs.
  // ── the two languages (PLAN_R4 D1 — the document is now single-language) ──
  // The DOCUMENT — the PDF, and the plain-text report that substitutes for it
  // when the render fails — now renders ENTIRELY in the quiz's CONTENT
  // language: labels, the roster chrome, the "for tomorrow" reteach block,
  // all of it, because a report mixing "if it is in English why does it have
  // Urdu in it" reads as broken (operator, round 4). Only the WhatsApp
  // CAPTION that carries the PDF stays in her own preference — a caption is
  // an interstitial, not part of the document (Tariq's rule, unchanged).
  // This reverses the round-2 chrome/content split for documents only; the
  // language/contentLanguage plumbing itself stays (both are still passed
  // through to the template), so nothing else moves.
  const chromeLang = clampLanguage(teacher.preferred_language);   // the CAPTION — hers
  const contentLang = clampLanguage(sc.language);                 // the DOCUMENT — the quiz's

  const TX = RTL_LANGS.has(contentLang) ? {
    results: (t) => `📊 *کوئز کے نتائج — ${t || 'آپ کا ویڈیو کوئز'}*`,
    finished: (d, a) => `${a} میں سے ${d} طلبہ نے مکمل کیا۔`,
    average: (n) => `کلاس اوسط: *${n}%*`,
    howEach: 'ہر طالب علم کی کارکردگی',
    reteach: 'دوبارہ پڑھانے کے قابل — سب سے زیادہ غلط:',
    gotWrong: (n, t) => `${t} میں سے ${n} نے غلط جواب دیا`,
    notFinished: (names) => `ابھی مکمل نہیں کیا: ${names}`,
    forTomorrow: '💡 *کل کے لیے*',
    // Word-for-word the template's CHROME.ur guidance labels — the PDF and
    // the text fallback are the same document on two surfaces, and a teacher
    // who gets the fallback one week and the PDF the next must not have to
    // learn two vocabularies for the same three parts.
    muddledLabel: 'کیا الجھن ہوئی', boardLabel: 'بورڈ پر', checkLabel: 'جانچ کا سوال',
    secureLabel: 'یہ پکا ہو گیا', stretchLabel: 'ایک اور آگے کا سوال',
  } : {
    results: (t) => `📊 *Quiz results — ${t || 'your video quiz'}*`,
    finished: (d, a) => `${d} of ${a} students finished.`,
    average: (n) => `Class average: *${n}%*`,
    howEach: 'How each student did',
    reteach: '*Worth reteaching* — most missed:',
    gotWrong: (n, t) => `${n} of ${t} got this wrong`,
    notFinished: (names) => `*Not finished yet:* ${names}`,
    forTomorrow: '💡 *For tomorrow*',
    muddledLabel: 'What they muddled', boardLabel: 'On the board', checkLabel: 'Check question',
    secureLabel: 'Secure', stretchLabel: 'One to stretch them',
  };

  // The caption is chrome, so it comes from HER preference, never the
  // document's content language — she may not read the quiz's language at
  // all, and the caption is the one part of this send she must understand.
  const CAPTION = RTL_LANGS.has(chromeLang) ? {
    caption: (t, d, a, n) => `📊 کلاس کے نتائج — *${t}*\n\n`
      + `${a} میں سے ${d} نے مکمل کیا${n ? ` · دوبارہ پڑھانے کے قابل ${n} سوال — اندر` : ''}`,
  } : {
    caption: (t, d, a, n) => `📊 Class results — *${t}*\n\n`
      + `${d} of ${a} finished${n ? ` · ${n} question${n > 1 ? 's' : ''} worth reteaching — inside` : ''}`,
  };

  const lines = [
    TX.results(sc.topic),
    '',
    TX.finished(done.length, all.length),
    done.length ? TX.average(avg) : '',
    '',
  ];

  if (done.length) {
    const sorted = [...done].sort((a, b) => (b.mastery_percentage || 0) - (a.mastery_percentage || 0));
    lines.push(`*${TX.howEach}*`);
    sorted.forEach((s) => {
      lines.push(`• ${s.student_name || 'Unnamed'}${s.student_class ? ` (${s.student_class})` : ''}`
        + ` — ${s.correct_answers}/${s.total_questions_answered} (${s.mastery_percentage || 0}%)`);
    });
    lines.push('');
  }

  if (hardest.length) {
    // The part that actually changes tomorrow's lesson.
    lines.push(TX.reteach);
    hardest.forEach((h) => {
      lines.push(`• ${h.question_text}`);
      lines.push(`   ${TX.gotWrong(h.wrong, h.total)}`);
    });
    lines.push('');
  }

  if (unfinished.length) {
    lines.push(TX.notFinished(unfinished.map((s) => s.student_name || 'Unnamed').join(', ')));
  }

  // The reteach block, grounded in what this class actually got wrong (and,
  // for a class that missed nothing, in the digest's learning goals instead).
  // Generated once and used in both the PDF and the chat message. Language is
  // threaded through as the DOCUMENT's language (PLAN_R4 D1) — a teacher who
  // ran an Urdu quiz gets Urdu guidance inside her Urdu document, not an
  // English paragraph glued onto it.
  const guidanceMode = hardest.length ? 'reteach' : 'secure';
  const guidance = done.length
    ? await generateGuidance({
      topic: sc.topic, grade: sc.grade, average: avg,
      finished: done.length, started: all.length, hardest, digest,
      language: contentLang, mode: guidanceMode,
    })
    : null;

  const summary = lines.filter((l) => l !== null && l !== undefined).join('\n');

  // A designed report is worth it once there are results in it. On the morning
  // run for a class where nobody finished, a PDF of an empty table is worse
  // than a sentence — so that case stays a plain message.
  const sentAsPdf = done.length > 0 && await sendAsPdf({
    phone: teacher.phone_number, shareCode: sc, students: done, hardest,
    guidance, started: all.length, finished: done.length, average: avg,
    unfinished: unfinished.map((s) => s.student_name || 'Unnamed'),
    language: contentLang, contentLanguage: contentLang, caption: CAPTION.caption,
  });

  if (!sentAsPdf) {
    // The PDF is the nicer artefact, not the report itself. If rendering fails
    // she still gets every number — losing her results because a font did not
    // load would be the wrong trade.
    await WhatsAppService.sendMessage(teacher.phone_number, summary);
    if (guidance) {
      await WhatsAppService.sendMessage(teacher.phone_number,
        `${TX.forTomorrow}\n\n${formatGuidanceText(guidance, TX)}`);
    }
  }

  await markReportSent(shareCodeId, sc.quiz_id);

  logEvent('video_quiz.report_sent', {
    shareCodeId, quizId: sc.quiz_id, started: all.length,
    completed: done.length, average: avg, reason,
    format: sentAsPdf ? 'pdf' : 'text', hadGuidance: Boolean(guidance),
  });
  return true;
}

/**
 * Render and send the designed report. Returns false on any failure so the
 * caller falls back to the text summary rather than the teacher getting nothing.
 */
async function sendAsPdf({ phone, shareCode, students, hardest, guidance,
                           started, finished, average, unfinished,
                           language, contentLanguage, caption: captionFor }) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let tempPath = null;
  try {
    const { htmlToPdf } = require('../../utils/html-to-pdf');
    const renderHtml = require('../../templates/video-quiz-report.template');

    const html = renderHtml({
      topic: shareCode.topic || 'Video quiz',
      teacherName: shareCode.teacher_name,
      started, finished, average,
      students, hardest, guidance, unfinished, language, contentLanguage,
      // D1 — the footer stamp is part of the DOCUMENT, so it is written in the
      // document's language. `toLocaleDateString('en-GB')` printed "5 Sep 2026"
      // into an otherwise all-Urdu report; formatLessonDate is the same helper
      // the teacher PDF and the offer interstitial already use, and it is
      // PKT-anchored rather than container-local.
      generatedAt: formatLessonDate(new Date().toISOString(), language, { year: true }),
    });

    const buffer = await htmlToPdf(html, {
      timeout: 30000,
      pdfOptions: {
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      },
    });
    if (!buffer || !buffer.length) return false;

    const safeTopic = String(shareCode.topic || 'quiz')
      .replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    tempPath = path.join(os.tmpdir(), `class-quiz-${shareCode.id}.pdf`);
    fs.writeFileSync(tempPath, buffer);

    // The caption is chrome, so it comes from the caller's teacher-language
    // table rather than being written inline in English.
    const caption = captionFor
      ? captionFor(shareCode.topic, finished, started, hardest.length)
      : `📊 Class results — *${shareCode.topic}*`;

    const ok = await WhatsAppService.sendDocument(
      phone, tempPath, `Class_results_${safeTopic}.pdf`, caption);
    return Boolean(ok);
  } catch (err) {
    logToFile('⚠️ video-quiz: report PDF failed, falling back to text', {
      error: err.message,
    });
    return false;
  } finally {
    // sendDocument reads the file synchronously before returning, so it is safe
    // to clear here; leaving these behind fills the worker's disk over weeks.
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); }
    catch { /* a stray temp file is not worth failing the report over */ }
  }
}

/**
 * Pull a JSON object out of the model's reply, fence and all.
 *
 * gpt-5.4-mini reliably wraps JSON in a ```json fence even when asked not to,
 * and occasionally adds a leading/trailing sentence around it. Defensive on
 * both: strip a fence if present, then fall back to the outermost {...} span.
 */
function parseGuidanceJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  try {
    const obj = JSON.parse(s);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Turn the evidence into the object the teacher reads under "For tomorrow".
 *
 * Best-effort by design: if the model is slow, down, or returns something
 * unusable, she still gets her results, just without the reteach box. Losing
 * the whole report because this optional block failed would be the wrong
 * trade — so ANY required key missing or empty (after stripEmphasis) fails
 * the whole call, not just that key.
 */
async function generateGuidance(context) {
  const prompt = buildGuidancePrompt(context);
  if (!prompt) return null;
  const missed = Array.isArray(context && context.hardest) ? context.hardest : [];
  const mode = (context && context.mode) || (missed.length ? 'reteach' : 'secure');
  const keys = mode === 'reteach' ? ['muddled', 'board', 'check'] : ['secure', 'stretch'];
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      // This box is the one part of the report a teacher acts on, so it gets
      // the better model. gpt-4o-mini produced textbook prose here — "focus
      // on clarifying the misconception that…" — and reached for "categorise
      // various foods" instead of the dal and rice in the questions.
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,               // lower than the parent quiz: this is advice
      // gpt-5 family renamed this. Passing max_tokens is not an error you can
      // see — the call just rejects and the teacher silently loses the box.
      max_completion_tokens: 260,
    });
    const parsed = parseGuidanceJson(res.choices?.[0]?.message?.content?.trim());
    if (!parsed) return null;
    const out = {};
    for (const key of keys) {
      // Strip markdown here, at the single point guidance is created, so BOTH
      // surfaces are covered: the PDF and the WhatsApp text fallback. (In the
      // fallback "**the**" is not even bold — WhatsApp bold is one asterisk —
      // so the teacher just saw the asterisks.)
      const cleaned = stripEmphasis(String(parsed[key] || '').trim());
      if (!cleaned) return null;
      out[key] = cleaned;
    }
    return out;
  } catch (err) {
    logToFile('⚠️ video-quiz: guidance generation failed (report still sends)', {
      error: err.message,
    });
    return null;
  }
}

/**
 * The WhatsApp-text-fallback rendering of the guidance object — three (or
 * two) labelled parts, single-asterisk bold (WhatsApp bold is ONE asterisk,
 * never two). `labels` is the doc-language TX table already built by
 * generate(); it carries `{muddledLabel, boardLabel, checkLabel, secureLabel,
 * stretchLabel}` in the document's own language.
 */
function formatGuidanceText(guidance, labels) {
  if (!guidance) return '';
  if (Object.prototype.hasOwnProperty.call(guidance, 'muddled')) {
    return [
      `*${labels.muddledLabel}:* ${guidance.muddled}`,
      `*${labels.boardLabel}:* ${guidance.board}`,
      `*${labels.checkLabel}:* ${guidance.check}`,
    ].join('\n\n');
  }
  return [
    `*${labels.secureLabel}:* ${guidance.secure}`,
    `*${labels.stretchLabel}:* ${guidance.stretch}`,
  ].join('\n\n');
}

/**
 * Stamp the share code as reported.
 *
 * Deliberately AFTER the send, not before: if WhatsApp throws, the teacher got
 * nothing and the morning job should still get its turn. The cost of that
 * ordering is a possible double-send if the stamp itself fails, which is the
 * better failure — a teacher seeing one report twice beats her seeing none.
 */
async function markReportSent(shareCodeId, quizId = null) {
  try {
    await supabase.from('quiz_share_codes')
      .update({ report_sent_at: new Date().toISOString() })
      .eq('id', shareCodeId);
    // A transcript quiz's /quiz row reads quizzes.status; "Report sent" is a
    // state of the quiz, not only of its share code.
    if (quizId) {
      await supabase.from('quizzes')
        .update({ status: 'report_sent' })
        .eq('id', quizId).eq('quiz_source', 'transcript');
    }
  } catch (err) {
    logToFile('⚠️ video-quiz: could not stamp report_sent_at', {
      shareCodeId, error: err.message,
    });
  }
}

/** A wrong answer only counts as a shared misunderstanding at this share. */
const CLUSTER_THRESHOLD = 0.5;

const LETTERS = ['A', 'B', 'C', 'D'];
const optionText = (q, letter) => q[`option_${String(letter).toLowerCase()}`] || null;

/**
 * The three questions this class got wrong most often — and, where the class
 * agreed on a wrong answer, WHICH one and why that mistake happens.
 *
 * "16 of 22 missed this" tells a teacher to reteach something. "16 of
 * 22 chose Dicot, because they flipped the vein rule" tells her what to say. The
 * second sentence is available because these questions ship with an explanation
 * authored per wrong option — 9,150 of them do.
 *
 * The cluster threshold matters. One child picking A and another picking B is a
 * coin toss, not a misconception, and reporting it as one would send her to
 * reteach the wrong thing. So a distractor is only named when at least half the
 * wrong answers landed on it.
 */
/**
 * Turn authored CHILD feedback into something a teacher can read.
 *
 * The wrong-option copy is written to the child who just got it wrong:
 *   "A) Nice effort! Milk and meat are products, not groups. Keep learning!"
 * Pasted verbatim into a class report that consoles the teacher for a question
 * she never answered. Of 18,300 authored strings, 11,799 open with a child
 * opener and 9,876 close with one, so this is the common case, not the edge.
 *
 * Strips the option-letter prefix, the opener and the closer; keeps the
 * substance untouched. Returns null when nothing but scaffolding remains, so
 * the caller omits the block rather than rendering an empty one.
 */
const CHILD_OPENER = /^(good try|nice effort|not quite|almost|good effort|nice try|well tried)[!.,]*\s*/i;
const CHILD_CLOSER = /\s*(keep going|keep learning|keep it up|keep practising|keep practicing|well done|you can do it)[!.]*\s*$/i;

function teacherFacing(raw) {
  if (!raw) return null;
  let t = String(raw).replace(/^\s*[A-D]\)\s*/, '').trim();
  t = t.replace(CHILD_OPENER, '').trim();
  t = t.replace(CHILD_CLOSER, '').trim();
  return t || null;
}

async function hardestQuestions(shareCodeId, limit = 3) {
  const { data: sessions } = await supabase
    .from('quiz_sessions').select('id').eq('share_code_id', shareCodeId)
    .is('invited_by_student_id', null);   // a friend's session is not this teacher's class
  const ids = (sessions || []).map((s) => s.id);
  if (!ids.length) return [];

  const { data: answers } = await supabase
    .from('quiz_answers')
    .select('question_id, is_correct, selected_option')
    .in('session_id', ids);
  if (!answers || !answers.length) return [];

  const tally = new Map();
  answers.forEach((a) => {
    const t = tally.get(a.question_id)
      || { total: 0, wrong: 0, picks: new Map() };
    t.total += 1;
    if (!a.is_correct) {
      t.wrong += 1;
      if (a.selected_option) {
        t.picks.set(a.selected_option, (t.picks.get(a.selected_option) || 0) + 1);
      }
    }
    tally.set(a.question_id, t);
  });

  const ranked = [...tally.entries()]
    // Needs at least two attempts before "the class found this hard" means
    // anything — one child's slip is not a teaching signal.
    .filter(([, t]) => t.wrong > 0 && t.total >= 2)
    .sort((a, b) => (b[1].wrong / b[1].total) - (a[1].wrong / a[1].total))
    .slice(0, limit);
  if (!ranked.length) return [];

  const { data: qs } = await supabase
    .from('quiz_questions')
    .select('id, external_id, question_text, option_a, option_b, option_c, option_d, '
            + 'correct_option, option_feedback, explanation')
    .in('id', ranked.map(([id]) => id));
  const byId = new Map((qs || []).map((q) => [q.id, q]));

  return ranked.map(([id, t]) => {
    const q = byId.get(id) || {};
    let topWrong = null;
    let topCount = 0;
    let runnerUp = 0;
    t.picks.forEach((n, letter) => {
      if (n > topCount) { runnerUp = topCount; topCount = n; topWrong = letter; }
      else if (n > runnerUp) { runnerUp = n; }
    });

    // Two conditions, and the second is the one that matters. Half the wrong
    // answers landing on an option is necessary but not sufficient: with two
    // children picking A and B, A holds half the wrong answers and is still
    // just a tie. A cluster means one distractor genuinely dominates.
    const clustered = Boolean(topWrong) && t.wrong > 0
      && (topCount / t.wrong) >= CLUSTER_THRESHOLD
      && topCount > runnerUp;

    let misconception = null;
    if (clustered && q.option_feedback && q.option_feedback.wrong) {
      // Feedback is keyed by the option INDEX, not its letter.
      const idx = LETTERS.indexOf(topWrong);
      const raw = q.option_feedback.wrong[String(idx)]
        ?? q.option_feedback.wrong[idx];
      if (raw) {
        misconception = teacherFacing(raw);
      }
    }

    return {
      question_text: q.question_text || '(question unavailable)',
      external_id: q.external_id || null,
      wrong: t.wrong,
      total: t.total,
      top_wrong_option: clustered ? topWrong : null,
      top_wrong_text: clustered ? optionText(q, topWrong) : null,
      top_wrong_count: clustered ? topCount : 0,
      correct_option: q.correct_option || null,
      correct_text: q.correct_option ? optionText(q, q.correct_option) : null,
      misconception,
      // "Why this is the right answer" — authored per question, independent
      // of which distractor the class clustered on (that is `misconception`,
      // and stays exactly as it was).
      explanation: teacherFacing(q.explanation) || null,
    };
  });
}

/** The taught-level word each language uses when naming an SLO's level in a prompt. */
const TAUGHT_LEVEL_EN = { recall: 'recall', understand: 'understand', apply: 'apply' };
const TAUGHT_LEVEL_UR = { recall: 'یاد', understand: 'سمجھ', apply: 'اطلاق' };

/**
 * Render the lesson digest as a block the prompt can append. Empty/absent
 * fields are simply omitted — a digest with only a topic still contributes
 * that much grounding rather than nothing at all.
 */
function digestBlockEn(digest) {
  if (!digest) return '';
  const lines = [];
  if (digest.topic_as_taught) lines.push(`Topic as taught: ${digest.topic_as_taught}`);
  const slos = (Array.isArray(digest.slos) ? digest.slos : []).filter((s) => s && s.statement);
  if (slos.length) {
    lines.push('Learning goals taught (with the level she pitched each at):');
    slos.forEach((s) => lines.push(
      `  ${s.id || ''} [${TAUGHT_LEVEL_EN[s.taught_level] || s.taught_level || 'understand'}]: ${s.statement}`,
    ));
  }
  if (Array.isArray(digest.misconceptions_surfaced) && digest.misconceptions_surfaced.length) {
    lines.push(`Misconceptions that surfaced in the lesson itself: ${digest.misconceptions_surfaced.join('; ')}`);
  }
  if (digest.lesson_summary) lines.push(`What she taught, in the order she taught it: ${digest.lesson_summary}`);
  return lines.length ? `\nLESSON DIGEST\n${lines.join('\n')}\n` : '';
}

function digestBlockUr(digest) {
  if (!digest) return '';
  const lines = [];
  if (digest.topic_as_taught) lines.push(`جیسا پڑھایا گیا موضوع: ${digest.topic_as_taught}`);
  const slos = (Array.isArray(digest.slos) ? digest.slos : []).filter((s) => s && s.statement);
  if (slos.length) {
    lines.push('پڑھائے گئے اہداف (جس سطح پر پڑھائے گئے اس کے ساتھ):');
    slos.forEach((s) => lines.push(
      `  ${s.id || ''} [${TAUGHT_LEVEL_UR[s.taught_level] || s.taught_level || 'سمجھ'}]: ${s.statement}`,
    ));
  }
  if (Array.isArray(digest.misconceptions_surfaced) && digest.misconceptions_surfaced.length) {
    lines.push(`سبق میں سامنے آنے والی غلط فہمیاں: ${digest.misconceptions_surfaced.join('، ')}`);
  }
  if (digest.lesson_summary) lines.push(`اس نے جس ترتیب میں پڑھایا: ${digest.lesson_summary}`);
  return lines.length ? `\nسبق کی تفصیل\n${lines.join('\n')}\n` : '';
}

function buildReteachPromptEn({ grade, topic, evidence, digest }) {
  return `You are helping a Grade ${grade || 'primary'} teacher in Pakistan plan `
    + `tomorrow's ten minutes. Her class just took a quiz on "${topic}".\n\n`
    + `Here is what they got wrong, and the wrong answer they agreed on:\n\n`
    + `${evidence}\n`
    + digestBlockEn(digest)
    + `\nReturn ONLY a JSON object with exactly these three keys, each value a `
    + `short line of PLAIN TEXT — no markdown, no leading label, no numbering:\n`
    + `{"muddled": "", "board": "", "check": ""}\n\n`
    + `"muddled" — name the ONE thing most of them have muddled, as a plain `
    + `statement of what they believe: "They think X is Y." Pick the single `
    + `biggest confusion, not a list of all of them. Do not use the words `
    + `"misconception", "students", "concept" or "understanding".\n`
    + `"board" — one activity she can run on the board in ten minutes with `
    + `nothing but chalk. Use the REAL everyday things named in the questions `
    + `above, and in the lesson digest above — the specific foods, objects, `
    + `words or numbers those questions and that lesson talk about. Never `
    + `"various examples" or "different items". Do not use a whole answer `
    + `sentence as a label; use the thing itself.\n`
    + `"check" — the one question she asks at the end to check it landed, `
    + `pitched at the level she taught the learning goal the class missed (see `
    + `the taught level next to each learning goal above). It must NOT be a `
    + `copy of any quiz question above; the children have already seen those. `
    + `Ask the same idea a different way.\n\n`
    + `Never begin any value with "In tomorrow's lesson", "To address this", `
    + `"Focus on" or "Start by". Begin with the children. Do not repeat any `
    + `score or count back to her — she has just read them. Do not praise her `
    + `or the class. Write the way a colleague leans over at break, not the way `
    + `a textbook explains.`;
}

function buildSecurePromptEn({ grade, topic, digest }) {
  return `You are helping a Grade ${grade || 'primary'} teacher in Pakistan plan `
    + `tomorrow's ten minutes. Her whole class just took a quiz on "${topic}" `
    + `and got every question right.\n`
    + digestBlockEn(digest)
    + `\nReturn ONLY a JSON object with exactly these two keys, each value a `
    + `short line of PLAIN TEXT — no markdown, no leading label, no numbering:\n`
    + `{"secure": "", "stretch": ""}\n\n`
    + `"secure" — one line naming the real skill the class now has solid, `
    + `grounded in the learning goals above. Not "they did well" — name the `
    + `actual thing they can now do.\n`
    + `"stretch" — ONE question, pitched one level above the highest level she `
    + `taught (see the taught levels above), that goes a step further than `
    + `anything the quiz asked. It must not be a copy of any quiz question.\n\n`
    + `Never begin with "In tomorrow's lesson", "To address this", "Focus on" `
    + `or "Start by". Do not repeat any score. Do not praise her or the class. `
    + `Write the way a colleague leans over at break, not the way a textbook `
    + `explains.`;
}

function buildReteachPromptUr({ grade, topic, evidence, digest }) {
  // Gender-neutral throughout (root CLAUDE.md's Urdu broadcast rule) — the
  // teacher's gender is unknown, so this never asks for a 2nd/3rd-person
  // gendered verb about her. Children are referred to as "بچے", a
  // gender-neutral plural. Same structure + banned-opener list as the
  // English prompt, translated in spirit, not word-for-word.
  return `آپ ایک پاکستانی گریڈ ${grade || 'ابتدائی'} استاد کی کل کے دس منٹ کی `
    + `منصوبہ بندی میں مدد کر رہے ہیں۔ ان کی کلاس نے ابھی "${topic}" پر ایک کوئز دیا ہے۔\n\n`
    + `یہاں وہ چیزیں ہیں جو انہوں نے غلط کیں، اور جس غلط جواب پر اکثریت نے اتفاق کیا:\n\n`
    + `${evidence}\n`
    + digestBlockUr(digest)
    + `\nصرف ایک JSON آبجیکٹ واپس کریں، بالکل ان تین کلیدوں کے ساتھ، ہر ایک کی `
    + `قدر سادہ متن کی ایک مختصر سطر ہو — کوئی مارک ڈاؤن، کوئی نمبر شمار نہیں:\n`
    + `{"muddled": "", "board": "", "check": ""}\n\n`
    + `"muddled" — وہ ایک چیز بتائیں جس میں زیادہ تر بچے الجھے ہوئے ہیں، ایک `
    + `سادہ بیان کے طور پر کہ وہ کیا سمجھتے ہیں: "بچے سمجھتے ہیں X، Y ہے۔" سب `
    + `سے بڑی الجھن چنیں، فہرست نہ بنائیں۔ الفاظ "غلط فہمی"، "طلبہ"، "تصور" یا `
    + `"سمجھ" استعمال نہ کریں۔\n`
    + `"board" — ایک سرگرمی جو بورڈ پر دس منٹ میں صرف چاک کے ساتھ کروائی جا `
    + `سکے۔ اوپر دیے گئے سوالوں اور سبق کی تفصیل میں موجود حقیقی روزمرہ چیزیں `
    + `استعمال کریں — وہی مخصوص الفاظ، اشیاء یا آوازیں۔ کبھی "مختلف مثالیں" نہ `
    + `لکھیں؛ خود وہ چیز نام لیں۔\n`
    + `"check" — وہ ایک سوال جو آخر میں پوچھا جائے تاکہ معلوم ہو کہ بات سمجھ `
    + `آئی، اسی سطح پر جس پر یہ ہدف پڑھایا گیا (اوپر ہر ہدف کے ساتھ دی گئی سطح `
    + `دیکھیں)۔ یہ اوپر کے کسی کوئز سوال کی نقل نہیں ہونی چاہیے؛ بچے وہ پہلے `
    + `دیکھ چکے ہیں۔ وہی خیال دوسرے انداز میں پوچھیں۔\n`
    + `جو سوال بچوں سے پوچھا جائے وہ انہی الفاظ میں لکھیں جن میں کوئز لکھا گیا `
    + `ہے: بچوں کو "آپ" کہہ کر، جمع کے احترامی افعال کے ساتھ (کریں، دیکھیں، `
    + `سوچیں) — "کرو"، "بتاؤ" یا کوئی مؤنث/مذکر واحد صیغہ ہرگز نہیں۔\n`
    + `\n`
    + `"کل کے سبق میں"، "اس کو حل کرنے کے لیے"، "پر توجہ دیں" یا "شروع کریں" سے `
    + `شروع نہ کریں۔ بچوں سے شروع کریں۔ کوئی سکور یا گنتی دوبارہ نہ بتائیں — وہ `
    + `ابھی پڑھ چکے ہیں۔ تعریف نہ کریں۔ اس انداز میں لکھیں جیسے ایک ساتھی وقفے `
    + `میں جھک کر بات کرتا ہے، نہ کہ جیسے کوئی نصابی کتاب سمجھاتی ہے۔ مکمل طور `
    + `پر اردو رسم الخط میں لکھیں، رومن اردو میں ہرگز نہیں۔ صرف وہ انگریزی الفاظ `
    + `لاطینی رسم الخط میں رہنے دیں جن کا کوئی فطری اردو متبادل نہ ہو (جیسے `
    + `مضمون کے مخصوص نام)۔ بچوں یا استاد کی جنس کے بارے میں کوئی قیاس نہ کریں، `
    + `ہمیشہ غیر جانبدار زبان استعمال کریں۔`;
}

function buildSecurePromptUr({ grade, topic, digest }) {
  return `آپ ایک پاکستانی گریڈ ${grade || 'ابتدائی'} استاد کی کل کے دس منٹ کی `
    + `منصوبہ بندی میں مدد کر رہے ہیں۔ ان کی پوری کلاس نے ابھی "${topic}" پر `
    + `ایک کوئز دیا اور ہر سوال درست کیا۔\n`
    + digestBlockUr(digest)
    + `\nصرف ایک JSON آبجیکٹ واپس کریں، بالکل ان دو کلیدوں کے ساتھ، ہر ایک کی `
    + `قدر سادہ متن کی ایک مختصر سطر ہو — کوئی مارک ڈاؤن، کوئی نمبر شمار نہیں:\n`
    + `{"secure": "", "stretch": ""}\n\n`
    + `"secure" — ایک سطر میں وہ اصل مہارت بتائیں جو کلاس نے اب پکی کر لی ہے، `
    + `اوپر دیے گئے اہداف کی بنیاد پر — "انہوں نے اچھا کیا" نہ لکھیں، اصل چیز کا `
    + `نام لیں۔\n`
    + `"stretch" — ایک سوال، جو سب سے اونچی پڑھائی گئی سطح سے ایک درجہ اوپر ہو `
    + `(اوپر دی گئی سطحیں دیکھیں)، جو کوئز کے کسی بھی سوال سے آگے جائے۔ یہ کسی `
    + `کوئز سوال کی نقل نہیں ہونی چاہیے۔\n`
    + `جو سوال بچوں سے پوچھا جائے وہ انہی الفاظ میں لکھیں جن میں کوئز لکھا گیا `
    + `ہے: بچوں کو "آپ" کہہ کر، جمع کے احترامی افعال کے ساتھ (کریں، دیکھیں، `
    + `سوچیں) — "کرو"، "بتاؤ" یا کوئی مؤنث/مذکر واحد صیغہ ہرگز نہیں۔\n`
    + `\n`
    + `"کل کے سبق میں"، "اس کو حل کرنے کے لیے"، "پر توجہ دیں" یا "شروع کریں" سے `
    + `شروع نہ کریں۔ کوئی سکور دوبارہ نہ بتائیں۔ تعریف نہ کریں۔ اس انداز میں `
    + `لکھیں جیسے ایک ساتھی وقفے میں جھک کر بات کرتا ہے۔ مکمل طور پر اردو رسم `
    + `الخط میں لکھیں، رومن اردو میں ہرگز نہیں۔ بچوں یا استاد کی جنس کے بارے `
    + `میں کوئی قیاس نہ کریں، ہمیشہ غیر جانبدار زبان استعمال کریں۔`;
}

/**
 * The prompt behind the "for tomorrow" reteach box.
 *
 * Deliberately built from the class's OWN answers — the questions they
 * missed, the wrong option they agreed on, the authored reason that mistake
 * happens, AND the lesson digest (topic_as_taught, SLOs with taught_level,
 * misconceptions_surfaced, lesson_summary — PLAN_R4 D6). A prompt that knows
 * only the average can only return advice that would fit any class on any
 * topic, which a teacher correctly ignores.
 *
 * TWO modes:
 *   - 'reteach' (hardest.length > 0): asks for {muddled, board, check}.
 *   - 'secure' (hardest.length === 0): a class that missed nothing — asks
 *     for {secure, stretch} instead, grounded in the digest alone.
 * `mode` may be passed explicitly; otherwise it is inferred from `hardest`.
 *
 * Returns null when there is nothing to ground guidance in at all: no missed
 * questions AND no usable digest. Inventing advice from an average alone
 * would train her to skip this section.
 *
 * `language` picks the prompt AND the requested output language. The
 * evidence itself needs no translation — question_text/top_wrong_text/
 * correct_text/misconception/digest fields already come from the quiz's own
 * data, authored in whatever script the quiz was taught in (Urdu quizzes
 * carry Urdu evidence). Only the instructions-to-the-model change language.
 */
function buildGuidancePrompt({
  topic, grade, average, finished, started, hardest, language = 'en', digest = null, mode,
} = {}) {
  const missed = Array.isArray(hardest) ? hardest : [];
  const resolvedMode = mode || (missed.length ? 'reteach' : 'secure');

  const hasDigestGrounding = Boolean(digest && (
    (Array.isArray(digest.slos) && digest.slos.some((s) => s && s.statement))
    || digest.topic_as_taught
    || (Array.isArray(digest.misconceptions_surfaced) && digest.misconceptions_surfaced.length)
    || digest.lesson_summary
  ));
  if (!missed.length && !hasDigestGrounding) return null;

  const ur = RTL_LANGS.has(language);

  if (resolvedMode === 'secure') {
    return ur ? buildSecurePromptUr({ grade, topic, digest })
      : buildSecurePromptEn({ grade, topic, digest });
  }

  const evidence = missed.map((h, i) => {
    const lines = [
      `${i + 1}. "${h.question_text}"`,
      `   ${h.wrong} of ${h.total} answered this wrongly.`,
    ];
    if (h.top_wrong_text) {
      lines.push(`   Most of them chose "${h.top_wrong_text}". `
        + `The right answer was "${h.correct_text}".`);
    }
    if (h.misconception) {
      lines.push(`   Explanation: ${h.misconception}`);
    }
    if (h.slo) {
      lines.push(`   Learning goal this checks: ${h.slo}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  return ur ? buildReteachPromptUr({ grade, topic, evidence, digest })
    : buildReteachPromptEn({ grade, topic, evidence, digest });
}

module.exports = {
  JOB_TYPE, LEGACY_JOB_TYPE, scheduleForShareCode, maybeSendEarly, generate,
  hardestQuestions, reportTargetUtc, shouldSendEarly, teacherFacing,
  buildGuidancePrompt, generateGuidance, formatGuidanceText, stripEmphasis, classLabel,
  CLUSTER_THRESHOLD,
};
