'use strict';
/**
 * bd-2313..2316 — share a video quiz with a class, and record what they score.
 *
 * WHY A LINK AND NOT THE QUESTIONS THEMSELVES
 * The obvious design — the teacher forwards the quiz messages into their
 * class WhatsApp group — cannot work, and the reason is platform law, not
 * our gap:
 *   1. Forwarding STRIPS interactivity. A forwarded button/list/Flow arrives as
 *      dead text; taps never reach our webhook, so nothing can be recorded.
 *   2. The bot cannot sit in an ordinary group. The Groups API caps membership
 *      at 8 and prohibits interactive messages even there.
 * What forwards perfectly is a LINK. So the teacher forwards ONE message
 * carrying a wa.me link with a code; each child taps it, lands in their own 1:1
 * chat with Rumi, gives a name and class, and takes the full quiz — media,
 * feedback and all — with every answer stored and attributed to them.
 *
 * A child arriving this way sees who sent it and what it is about before
 * anything else: "Your teacher <name> sent you a quiz on <topic>."
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const StudentIdentity = require('./student-identity.service');
const TeacherSelfTest = require('./teacher-self-test');

const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { isolateIfMixed } = require('./transcript-quiz-rows');

const JOIN_TTL_SECS = 60 * 60;
const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);
const JOIN_KEY = (phone) => `videoquiz:${stripPlus(phone)}:join`;
// Ack-first join lock: one join per phone+code at a time (see beginFromCodeLocked).
const JOIN_LOCK_KEY = (phone, code) => `videoquiz:${stripPlus(phone)}:joinlock:${code}`;
const JOIN_LOCK_SECS = 60;

// Chrome a CHILD reads, in the quiz language.
const ux = (key, language, params) => resolveUx(key, { language, params });

/**
 * The {who} of the greeting: the child's name, and their class when they gave
 * one, joined the way the quiz language joins them (vqWhoNameClass — Urdu's
 * comma is `،`, and each typed value is a bidi isolate).
 */
function whoLabel(name, className, language) {
  const cls = String(className || '').trim();
  return cls ? ux('vqWhoNameClass', language, { name, cls }) : name;
}

// bd-2477 #3: offerShare()'s send used to fire-and-forget — a WhatsApp
// per-recipient rate limit (confirmed via Axiom, same session as bd-2477 #1)
// silently dropped the "send to your class again?" offer with no retry and
// no log line. One retry after a short backoff covers the transient case;
// if it still fails, at least the failure is visible.
const OFFER_RETRY_BACKOFF_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHARE_YES = 'vq_share_yes';
const SHARE_NO = 'vq_share_no';
// bd-2338 — the flow token that marks a name-and-class submission as ours.
const JOIN_FLOW_PREFIX = 'vqjoin:';

// Unambiguous alphabet: no O/0, I/1, S/5 — a child may retype this by hand off
// a relative's screen, and a misread character means a dead link.
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const CODE_RX = /\bQUIZ-([A-Z0-9]{6})\b/i;

function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i += 1) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function botNumber() {
  // The number a child's wa.me link must open. PHONE_NUMBER_ID is Meta's
  // internal id, not a dialable number, so it cannot be used here.
  //
  // Falls back to REFERRAL_BOT_NUMBER, which already exists on every service
  // and already holds that environment's dialable number (staging = Shams
  // 923268338870). A brand-new variable would have needed setting on each
  // service and, if missed, would have silently sent a class of children to the
  // PRODUCTION bot from a staging link — a wrong number here is invisible until
  // a child taps it.
  // NIETE port (bd-2482): no PK-number fallback here — an unset var must fail
  // loud (empty link), never silently point a NIETE child at PK's bot.
  const n = process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER;
  if (!n) {
    logToFile('⚠️ share: no bot number configured — wa.me link will be wrong', {});
  }
  return String(n || '').replace(/\D/g, '');
}

// ─── Minting ────────────────────────────────────────────────────────────────

async function mintCode({ quizId, userId, videoId, language = 'en' }) {
  const { data: user } = await supabase
    .from('users').select('name').eq('id', userId).maybeSingle();
  // The fallback is read by CHILDREN in the quiz language ("*your teacher* نے…" was
  // what an Urdu child got when a teacher had no stored name).
  const teacherName = user?.name
    || resolveUx('tqYourTeacher', { language });
  const { data: quiz } = await supabase
    .from('quizzes').select('topic').eq('id', quizId).maybeSingle();

  // Retry on the unique-code collision rather than trusting one draw.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const { data, error } = await supabase.from('quiz_share_codes').insert({
      code, quiz_id: quizId, teacher_user_id: userId, video_id: videoId,
      teacher_name: teacherName, topic: quiz?.topic || null, language,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id, code').single();
    if (!error && data) return { ...data, teacherName, topic: quiz?.topic };
    if (error && error.code !== '23505') {
      logToFile('❌ share: could not mint code', { error: error.message });
      return null;
    }
  }
  return null;
}

/** After a solo run, offer to send it to the class. */
async function offerShare({ phone, userId, quizId, videoId, language = 'en', sessionId = null }) {
  await redisService.set(`videoquiz:${stripPlus(phone)}:share`, {
    quizId, videoId, userId, language, sessionId,
  }, JOIN_TTL_SECS);

  // The same language the rest of this video-quiz run spoke in.
  const lang = clampLanguage(language);
  const body = {
    body: ux('vqShareOffer', lang),
    buttons: [
      { id: SHARE_YES, title: ux('vqShareYes', lang) },
      { id: SHARE_NO, title: ux('vqShareNo', lang) },
    ],
  };

  // This offer lands on a phone that has just received a whole quiz, so it is
  // spent out of the SAME per-recipient window those questions filled. It was
  // sending outside the throttle entirely, which meant the limiter's window
  // never learned about it — the same "side door" gap already closed for the
  // two direct sends in video-quiz.service, still open here.
  const rateLimiter = require('./video-quiz-rate-limiter.service');
  await rateLimiter.throttle(phone);
  let ok = await WhatsAppService.sendInteractiveButtons(phone, body);
  if (!ok) {
    await sleep(OFFER_RETRY_BACKOFF_MS);
    await rateLimiter.throttle(phone);
    ok = await WhatsAppService.sendInteractiveButtons(phone, body);
  }
  if (!ok) {
    logToFile('⚠️ video-quiz: share offer not delivered after retry', {
      phone: phone.slice(-4), quizId,
    });
  }
  // The share offer is only ever made after a video_solo run.
  // `sent` carries the retry's verdict: an offer that never reached the phone
  // still belongs in the funnel, but it is not a shown offer the teacher ignored.
  logEvent('video_quiz.offer_shown', {
    kind: 'share', sessionId, quizId, source: 'video_solo', language, sent: Boolean(ok),
  });
}

async function handleShareButton(buttonId, phone) {
  if (buttonId !== SHARE_YES && buttonId !== SHARE_NO) return false;
  const key = `videoquiz:${stripPlus(phone)}:share`;
  const ctx = await redisService.get(key);
  await redisService.delete(key);
  if (buttonId === SHARE_NO || !ctx) {
    if (buttonId === SHARE_NO) {
      logEvent('video_quiz.offer_answered', {
        kind: 'share', choice: 'no', quizId: ctx?.quizId ?? null, sessionId: ctx?.sessionId ?? null,
      });
      await WhatsAppService.sendMessage(phone, ux('vqShareDeclined', clampLanguage(ctx && ctx.language)));
    }
    return true;
  }

  logEvent('video_quiz.offer_answered', {
    kind: 'share', choice: 'yes', quizId: ctx.quizId ?? null, sessionId: ctx.sessionId ?? null,
  });
  return module.exports.deliverClassLink(ctx, phone);
}

/**
 * Mint a code and hand the teacher the message they forward.
 *
 * bd-2336 — extracted so BOTH entry points share one implementation: the
 * post-solo-run offer, and the "send to my class" choice the teacher can now
 * make at the quiz offer itself without taking the quiz first. Two copies of
 * this would drift, and the copy the teacher sees is the copy thirty children
 * read.
 */
async function deliverClassLink(ctx, phone) {
  // The forwarded message is read by every child in the class, so it is in the
  // quiz's language; the lines around it follow the same language.
  const lang = clampLanguage(ctx && ctx.language);
  const minted = await mintCode(ctx);
  if (!minted) {
    await WhatsAppService.sendMessage(phone, ux('vqShareLinkFailed', lang));
    return true;
  }

  const link = `https://wa.me/${botNumber()}?text=QUIZ-${minted.code}`;
  await WhatsAppService.sendMessage(phone, ux('vqShareForwardThis', lang));
  // Sent as its own message so forwarding it carries nothing else.
  await WhatsAppService.sendMessage(phone, ux('vqClassMessage', lang, {
    teacher: minted.teacherName,
    topic: minted.topic || ux('vqTodaysVideo', lang),
    link,
  }));
  await WhatsAppService.sendMessage(phone, ux('vqShareReportPromise', lang));

  logEvent('video_quiz.share_code_minted', {
    userId: ctx.userId, quizId: ctx.quizId, code: minted.code,
  });
  return true;
}

// ─── The child's side ───────────────────────────────────────────────────────

// The join Flow comes in two published assets.
//   STUDENT_JOIN_LOCALIZED_FLOW_ID — docs/flows/student-join-flow-v2.json. Every
//     word on its screen is a ${data.*} binding, filled below from the catalog in
//     the quiz language, so one asset serves a child in either language.
//   STUDENT_JOIN_FLOW_ID — docs/flows/student-join-flow.json, the first version.
//     Its words are hardcoded English and it declares only {teacher, topic}.
// A published Flow cannot be re-rendered per child, and a new asset has to be
// published on each WABA before it can be sent, so the localized one is opt-in
// by its own id and the legacy one keeps working until then — for the only
// language it can speak. Unsetting the localized id is the rollback lever.
const LEGACY_JOIN_FLOW_LANGUAGE = 'en';
// Meta's TextHeading cap, in code points.
const JOIN_HEADING_MAX = 80;

/**
 * The join Flow to open for a child reading `lang`, or null to ask in chat.
 *
 * An Urdu child with only the legacy asset configured is asked in chat: the chat
 * questions are in Urdu, and the legacy screen would ask them "Your name" /
 * "Your class" in English.
 */
function joinFlowFor(lang) {
  const localized = process.env.STUDENT_JOIN_LOCALIZED_FLOW_ID;
  if (localized) return { flowId: localized, localized: true };
  const legacy = process.env.STUDENT_JOIN_FLOW_ID;
  if (legacy && lang === LEGACY_JOIN_FLOW_LANGUAGE) return { flowId: legacy, localized: false };
  return null;
}

/**
 * "<teacher> has sent you a quiz", within the heading's cap. A name long enough
 * to overflow it is not cut mid-word — the heading says "your teacher" instead,
 * and the greeting on the message that opens the Flow still carries the full
 * name. A name in the other script is isolated so it cannot flip the direction
 * of the line it sits in.
 */
function joinHeading(lang, teacher) {
  const named = ux('vqJoinHeading', lang, { teacher: isolateIfMixed(teacher, lang) });
  if ([...named].length <= JOIN_HEADING_MAX) return named;
  return ux('vqJoinHeading', lang, { teacher: resolveUx('tqYourTeacher', { language: lang }) });
}

/** Screen WHO's data for the localized asset: exactly the keys it declares. */
function joinScreenData(lang, { teacher, topic }) {
  return {
    title: ux('vqJoinTitle', lang),
    heading: joinHeading(lang, teacher),
    topic,
    name_label: ux('vqJoinNameLabel', lang),
    name_help: ux('vqJoinNameHelp', lang),
    class_label: ux('vqJoinClassLabel', lang),
    class_help: ux('vqJoinClassHelp', lang),
    cta: ux('vqJoinSubmit', lang),
  };
}

/** Does this inbound text carry a share code? */
function parseShareCode(text) {
  const m = CODE_RX.exec(text || '');
  return m ? m[1].toUpperCase() : null;
}

/**
 * A child tapped the link. Greet them by naming the teacher and the topic —
 * they may have no idea what this message is — then collect name and class
 * BEFORE question 1, so the teacher's report has someone to name.
 */
/**
 * Ack-first entry point. The text handler calls this AFTER it has returned
 * (setImmediate), so the webhook answers Meta in milliseconds however many
 * children tap the forwarded link at once. The lock makes a Meta retry of the
 * same message — or a child double-tapping — a no-op rather than a second
 * session: one join per phone+code per minute.
 */
async function beginFromCodeLocked(phone, code) {
  const claimed = await redisService.setNX(JOIN_LOCK_KEY(phone, code), { at: Date.now() }, JOIN_LOCK_SECS);
  if (!claimed) {
    logEvent('video_quiz.join_deduped', { code, phone: String(phone || '').slice(-4) });
    return false;
  }
  return module.exports.beginFromCode(phone, code);
}

async function beginFromCode(phone, code) {
  // bd-2339: this may be a teacher's code OR a child's invite. resolveInvite
  // collapses both to "which teacher code does this belong to, and who sent
  // them" — so everything downstream, including the class report, is unchanged.
  const Invite = require('./video-quiz-invite.service');
  const sc = await Invite.resolveInvite(code);

  if (!sc || !sc.active || (sc.expires_at && new Date(sc.expires_at) < new Date())) {
    await WhatsAppService.sendMessage(phone, ux('vqExpired', clampLanguage(sc && sc.language)));
    return true;
  }

  const ctx = {
    // The PARENT code when this was an invite — the child counts toward the
    // teacher's report exactly like anyone they sent it to directly.
    shareCodeId: sc.shareCodeId,
    quizId: sc.quiz_id, videoId: sc.video_id,
    language: clampLanguage(sc.language), topic: sc.topic, teacherName: sc.teacher_name,
    invitedByStudentId: sc.invitedByStudentId,
    // bd-2340: whose quiz this is, so a new child is filed under them.
    teacherUserId: sc.teacher_user_id || null,
  };
  const lang = ctx.language;

  // PLAN_R5 §1 D8 — is this the teacher testing their own class link? A
  // self-test is never asked for a name/class and never written into
  // `students`; the marker is `quiz_sessions.user_id`, no schema change
  // (see teacher-self-test.js).
  const selfTest = await TeacherSelfTest.resolveSelfTest({ phone, teacherUserId: ctx.teacherUserId });
  if (selfTest) {
    await redisService.delete(JOIN_KEY(phone));
    await WhatsAppService.sendMessage(phone, ux('vqSelfTestStart', lang));
    // `id: null` explicitly: startForStudent reads `student.id` for the
    // `students` FK, and an undefined there is one JSON round-trip away from
    // becoming a silent surprise. The teacher has no students row, by design.
    await startForStudent(phone, ctx, { id: null, student_name: selfTest.name || null },
      { selfTestUserId: selfTest.userId });
    // The event carries ids only — never the phone and never the name.
    logEvent('video_quiz.teacher_self_test', {
      shareCodeId: ctx.shareCodeId, quizId: ctx.quizId, userId: selfTest.userId,
    });
    return true;
  }

  // One pair of names for the greeting and the Flow, with fallbacks the child
  // reads in the quiz language.
  const who = {
    teacher: sc.teacher_name || resolveUx('tqYourTeacher', { language: lang }),
    topic: sc.topic || resolveUx('tqTodaysLesson', { language: lang }),
  };
  // The greeting's second paragraph opens with the teacher's name, and a phone
  // picks each paragraph's direction from its first strong character — so a
  // name in the other script (a Latin name on an Urdu quiz) would turn the whole
  // line around. Isolated, the name is skipped when the direction is chosen.
  const greeting = ux('vqGreeting', lang, { ...who, teacher: isolateIfMixed(who.teacher, lang) });

  // bd-2337 — do we already know who is on this handset?
  const known = await StudentIdentity.findByPhone(phone);

  if (known.length === 1) {
    // Straight in. A child who told us their name last week should not be asked
    // again just because their teacher shared a new quiz.
    const s = known[0];
    await redisService.delete(JOIN_KEY(phone));
    await WhatsAppService.sendMessage(phone,
      `${greeting}\n\n${ux('vqWelcomeBack', lang, { name: s.student_name })}`);
    await startForStudent(phone, ctx, s);
    logEvent('video_quiz.share_code_opened', {
      code, quizId: sc.quiz_id, recognised: true,
    });
    return true;
  }

  if (known.length > 1) {
    // Siblings share a handset. Ask — never assume the first one, or a child's
    // score is filed under their brother's name and nobody can tell.
    await redisService.set(JOIN_KEY(phone), {
      ...ctx, step: 'whoami', candidates: known.map((s) => ({
        id: s.id, name: s.student_name, className: s.self_reported_class,
      })),
    }, JOIN_TTL_SECS);
    const names = known.map((s, i) => `${i + 1}. ${s.student_name}`).join('\n');
    await WhatsAppService.sendMessage(phone,
      `${greeting}\n\n${ux('vqWhoIsTaking', lang, { names, n: known.length + 1 })}`);
    logEvent('video_quiz.share_code_opened', {
      code, quizId: sc.quiz_id, recognised: true, siblings: known.length,
    });
    return true;
  }

  // bd-2338 — a child we have never met. One Flow screen collects name and
  // class together, instead of three round trips before question 1.
  await redisService.set(JOIN_KEY(phone), { ...ctx, step: 'name' }, JOIN_TTL_SECS);

  const joinFlow = joinFlowFor(lang);
  if (joinFlow) {
    const sent = await WhatsAppService.sendFlow(phone, {
      flowId: joinFlow.flowId,
      buttonText: ux('vqJoinFlowButton', lang),
      body: greeting,
      screen: 'WHO',
      // Routed on OUR token, never inferred from the payload shape — a generic
      // {student_name, student_class} body is exactly what another form would
      // also send. Both assets complete with the same two fields.
      flowToken: `${JOIN_FLOW_PREFIX}${sc.id}`,
      // Each asset gets exactly the data its screen declares.
      navigateData: joinFlow.localized ? joinScreenData(lang, who) : who,
    });
    if (sent) {
      logEvent('video_quiz.share_code_opened', {
        code, quizId: sc.quiz_id, recognised: false, via: 'flow',
        flow: joinFlow.localized ? 'localized' : 'legacy', language: lang,
      });
      return true;
    }
    logToFile('⚠️ student join Flow failed — asking in chat instead', { code });
  }

  // No Flow configured, or it failed to send. Asking in chat is slower but a
  // child must never reach a dead end because a Meta asset is missing.
  await WhatsAppService.sendMessage(phone, `${greeting}\n\n${ux('vqAskName', lang)}`);
  logEvent('video_quiz.share_code_opened', {
    code, quizId: sc.quiz_id, recognised: false, via: 'chat', language: lang,
  });
  return true;
}

/**
 * bd-2338 — a child submitted the name-and-class Flow.
 *
 * Returns false when the token is not ours, so the caller keeps routing. The
 * submission arrives via nfm_reply, which only fires because the Flow footer is
 * `complete`; a data_exchange footer would render the same screen and deliver
 * nothing here.
 */
async function handleJoinFlowReply(phone, flowToken, payload = {}) {
  if (typeof flowToken !== 'string' || !flowToken.startsWith(JOIN_FLOW_PREFIX)) {
    return false;
  }
  const shareCodeId = flowToken.slice(JOIN_FLOW_PREFIX.length);
  const name = String(payload.student_name || '').trim();
  const className = String(payload.student_class || '').trim();

  if (!name) {
    // Ours, so we consume it — but there is nothing to store. Ask rather than
    // writing a blank child into the teacher's report.
    const pending = await redisService.get(JOIN_KEY(phone));
    await WhatsAppService.sendMessage(phone, ux('vqAskNameMissed', clampLanguage(pending && pending.language)));
    await redisService.set(JOIN_KEY(phone), { ...(pending || {}), shareCodeId, step: 'name' }, JOIN_TTL_SECS);
    return true;
  }

  const { data: sc } = await supabase
    .from('quiz_share_codes')
    // teacher_user_id is load-bearing (bd-2340): without it the Flow join path
    // files the child under nobody, and only the chat fallback would work.
    .select('id, quiz_id, video_id, teacher_user_id, teacher_name, topic, language')
    .eq('id', shareCodeId)
    .maybeSingle();
  if (!sc) {
    await WhatsAppService.sendMessage(phone, ux('vqExpired', clampLanguage(null)));
    return true;
  }
  const lang = clampLanguage(sc.language);

  await redisService.delete(JOIN_KEY(phone));
  const student = await StudentIdentity.remember({
    phone, name, className, enrolledByUserId: sc.teacher_user_id || null,
  });

  await WhatsAppService.sendMessage(phone,
    ux('vqLetsBegin', lang, { who: whoLabel(name, className, lang) }));

  await startForStudent(phone, {
    shareCodeId: sc.id, quizId: sc.quiz_id, videoId: sc.video_id,
    language: sc.language || 'en',
  }, {
    id: student?.id || null, student_name: name, self_reported_class: className,
  });

  logEvent('video_quiz.join_flow_completed', {
    shareCodeId: sc.id, quizId: sc.quiz_id, studentId: student?.id || null,
  });
  return true;
}

/**
 * Begin the quiz for a child we can name, linking the session to them.
 *
 * `opts.selfTestUserId` is the one exception: set only by the teacher
 * self-test path above, it names the SESSION as theirs (`user_id`) instead of
 * a `students` row. The two other call sites (`handleJoinFlowReply`,
 * `consumeJoinReply`) never pass it, so they are unchanged — `userId` stays
 * `null` for every child, exactly as before.
 */
async function startForStudent(phone, ctx, student, opts = {}) {
  const VideoQuizService = require('./video-quiz.service');
  await VideoQuizService.startSession({
    phone, userId: opts.selfTestUserId || null, quizId: ctx.quizId, videoId: ctx.videoId,
    language: ctx.language, source: 'share_link',
    studentName: student.student_name || student.name,
    studentClass: student.self_reported_class || student.className,
    studentId: student.id,
    shareCodeId: ctx.shareCodeId,
    invitedByStudentId: ctx.invitedByStudentId || null,
  });
  const report = require('./video-quiz-report.service');
  await report.scheduleForShareCode(ctx.shareCodeId)
    .catch(() => { /* scheduling is best-effort; the quiz still runs */ });
}

/**
 * Consume the next inbound text as name, then class. Returns true when the
 * message was consumed by this flow so the caller stops routing it.
 */
async function consumeJoinReply(phone, text) {
  const st = await redisService.get(JOIN_KEY(phone));
  if (!st) return false;
  const value = (text || '').trim();
  if (!value) return false;
  const lang = clampLanguage(st.language);

  // bd-2337 — siblings on one handset picked which of them is playing.
  if (st.step === 'whoami') {
    const pick = parseInt(value, 10);
    const list = st.candidates || [];
    if (!Number.isInteger(pick) || pick < 1 || pick > list.length + 1) {
      await WhatsAppService.sendMessage(phone, ux('vqReplyNumber', lang, { n: list.length + 1 }));
      return true;
    }
    if (pick === list.length + 1) {
      // "Someone else" — a child we have not met. Fall through to asking.
      st.step = 'name';
      delete st.candidates;
      await redisService.set(JOIN_KEY(phone), st, JOIN_TTL_SECS);
      await WhatsAppService.sendMessage(phone, ux('vqAskNameAgain', lang));
      return true;
    }
    const chosen = list[pick - 1];
    await redisService.delete(JOIN_KEY(phone));
    await WhatsAppService.sendMessage(phone, ux('vqLetsBeginName', lang, { name: chosen.name }));
    await StudentIdentity.touch(chosen.id);
    await startForStudent(phone, st, {
      id: chosen.id, student_name: chosen.name, self_reported_class: chosen.className,
    });
    return true;
  }

  if (st.step === 'name') {
    st.studentName = value.slice(0, 60);
    st.step = 'class';
    await redisService.set(JOIN_KEY(phone), st, JOIN_TTL_SECS);
    await WhatsAppService.sendMessage(phone, ux('vqAskClass', lang, { name: st.studentName }));
    return true;
  }

  if (st.step === 'class') {
    st.studentClass = value.slice(0, 40);
    await redisService.delete(JOIN_KEY(phone));
    await WhatsAppService.sendMessage(phone,
      ux('vqLetsBegin', lang, { who: whoLabel(st.studentName, st.studentClass, lang) }));

    // bd-2337 — remember them, so the next quiz their teacher shares opens
    // straight at question 1. Best-effort: if this fails the quiz still runs,
    // they are just asked again next time (the old behaviour).
    const student = await StudentIdentity.remember({
      phone, name: st.studentName, className: st.studentClass,
      enrolledByUserId: st.teacherUserId || null,
    });

    const VideoQuizService = require('./video-quiz.service');
    await VideoQuizService.startSession({
      phone, userId: null, quizId: st.quizId, videoId: st.videoId,
      language: st.language, source: 'share_link',
      studentName: st.studentName, studentClass: st.studentClass,
      studentId: student?.id || null,
      shareCodeId: st.shareCodeId,
      invitedByStudentId: st.invitedByStudentId || null,
    });
    // bd-2317: schedule the teacher's morning report the first time anyone
    // joins. Idempotent on the SQS deduplication id, so later joiners do not
    // queue a second one.
    const report = require('./video-quiz-report.service');
    await report.scheduleForShareCode(st.shareCodeId)
      .catch((e) => logToFile('⚠️ could not schedule class report', { error: e.message }));

    // bd-2397: uses_count is incremented inside startSession, where every
    // join route funnels. The increment that lived here covered one route and
    // its .catch() never fired (supabase .rpc() resolves with {error}).
    return true;
  }
  return false;
}

module.exports = {
  mintCode, offerShare, handleShareButton, deliverClassLink, startForStudent,
  parseShareCode, beginFromCode, beginFromCodeLocked, consumeJoinReply, handleJoinFlowReply,
  SHARE_YES, SHARE_NO, JOIN_KEY, JOIN_LOCK_KEY, JOIN_LOCK_SECS, JOIN_FLOW_PREFIX, CODE_RX, randomCode, botNumber,
};
