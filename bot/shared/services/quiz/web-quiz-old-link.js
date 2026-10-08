'use strict';
/**
 * AN OLD WHATSAPP QUIZ LINK OPENS THE WEB QUIZ.
 *
 * Switching the web quiz on changed only the links handed out from then on. Every
 * `wa.me/<bot>?text=QUIZ-<code>` a teacher had already forwarded still lands here as
 * a text and used to start the chat quiz: ~46 billed messages a child, against one
 * for the web page. This module answers that text with ONE cta_url message — a
 * button that opens the same code's web page — and starts nothing in chat.
 *
 * Gates, each keeping today's chat path when it fails (never a dead end):
 *   - app_settings `web_quiz_old_link_redirect` is true (30 s cache, fail closed;
 *     OFF unless the row says so);
 *   - the web quiz is on for the code's teacher (web-quiz-link webQuizOn: the same
 *     test the new links pass, so a teacher whose children get wa.me links keeps chat);
 *   - no chat quiz is running on this phone (a child part-way through finishes in chat;
 *     this text is only ever a (re)start);
 *   - the send is accepted by Meta.
 * The teacher's own link opens the signed preview (`?p=`), recorded on the web as a
 * self-test exactly as beginFromCode records it in chat. A child's link carries the
 * one-shot handset link (`#x=`, web-quiz-handset.js) when that switch is on. The body carries the teacher
 * and the topic in the quiz's language, never a URL, a token or a child's name — the
 * link lives in the button, which a forward does not carry.
 *
 * The read-aloud clips get a head start: an old chat quiz was never opened on the web, so its
 * clips do not exist yet and take about a minute to record, while children start 20-160 s after
 * the button. The redirect asks for them (web-quiz-publish requestQuizAudio: skips a quiz whose
 * clips are current, one request per quiz per process) the moment it decides to redirect, before
 * the send, not awaited; nothing on a kept path asks.
 *
 * Telemetry (ids only): `web_quiz.old_link_redirect` once per redirect attempt
 * ({sent} says whether Meta took it, {wamid} the id Meta gave the message, so its delivered/read
 * statuses can be joined to it), `web_quiz.old_link_kept` with the reason when a gate kept the
 * chat path.
 *
 * ONE RE-OFFER. Some children read the button and type instead — a name or a greeting, the old chat
 * quiz's next step — and that text went to the AI chat. So for ten minutes after a child's redirect
 * (Redis, PENDING_KEY, the button exactly as sent), the phone's next plain text is answered once with
 * the same button (tryReoffer, called by the text handler after the quiz intercepts), unless the flag
 * is off, a chat quiz is running, or the page was opened on that code since the button (noteOpen,
 * fed by the page's own page_open event). One per redirect: the entry is claimed, then dropped; any
 * later text goes to the AI chat as before. Logged as `web_quiz.old_link_reoffer` {sent, wamid} or
 * `web_quiz.old_link_reoffer_skipped` {reason}. The teacher's own self-test is never re-offered.
 *
 * A LEAF MODULE: it requires none of the quiz engine (video-quiz.service,
 * video-quiz-share, video-quiz-invite form a cycle this must not join). The two
 * things it needs from the engine — "is a chat quiz running on this phone?" and
 * "clear the chat join state" — are passed in by beginFromCode, which owns both.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { isolateIfMixed } = require('./transcript-quiz-rows');

const FLAG_KEY = 'web_quiz_old_link_redirect';
const REOFFER_S = 10 * 60;
const PENDING_KEY = (phone) => `wq:oldlink:pending:${phone}`;
const CLAIM_KEY = (phone, at) => `wq:oldlink:reoffered:${phone}:${at}`;
const OPENED_KEY = (code) => `wq:oldlink:opened:${String(code || '').toUpperCase()}`;
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** The flag, read like web-quiz-link.js: cached 30 s, false on any read error (never cached). */
async function redirectOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    cache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ old quiz link: settings lookup failed — keeping the chat quiz', { error: err.message });
    return false;
  }
}

/** Ask the worker to record the quiz's clips now (see the header). Not awaited; never throws. */
function clipsHeadStart(quizId) {
  if (!quizId) return;
  Promise.resolve()
    .then(async () => {
      const { data } = await supabase.from('quizzes')
        .select('id, audio_v:meta->web->>audio_v, audio_voice:meta->web->>audio_voice').eq('id', quizId).maybeSingle();
      const web = { audio_v: data && data.audio_v, audio_voice: data && data.audio_voice };
      return require('./web-quiz-publish.service').requestQuizAudio(quizId, { meta: { web } });
    })
    .catch((err) => logToFile('⚠️ old quiz link: could not ask for the read-aloud clips', { quizId, error: err.message }));
}

/**
 * Answer an old link with the web page, or return false so the caller runs today's
 * chat join. `sc` is the resolved share code (resolveInvite's shape: `shareCodeId` is
 * the class code, `teacher_user_id` its teacher). `hooks.isChatQuizRunning()` and
 * `hooks.clearJoin()` come from the caller (see the header). Never throws.
 */
async function tryRedirect(phone, code, sc, hooks = {}) {
  const isChatQuizRunning = typeof hooks.isChatQuizRunning === 'function' ? hooks.isChatQuizRunning : async () => false;
  const clearJoin = typeof hooks.clearJoin === 'function' ? hooks.clearJoin : async () => {};
  const shareCodeId = sc && (sc.shareCodeId || sc.id);
  const quizId = sc && sc.quiz_id;
  // The last four digits of the phone, as the join/answer events already carry them (never the phone):
  // lets a redirect be set against the chat joins and web starts of the same code.
  const phoneTail = String(phone || '').slice(-4);
  const kept = (reason) => { logEvent('web_quiz.old_link_kept', { shareCodeId, quizId, code, reason, phoneTail }); return false; };
  try {
    if (!(await redirectOn())) return kept('flag_off');
    const Link = require('./web-quiz-link');
    const teacherUserId = sc.teacher_user_id || null;
    if (!(await Link.webQuizOn(teacherUserId))) return kept('web_off');
    if (await isChatQuizRunning()) return kept('chat_quiz_running');

    const lang = clampLanguage(sc.language);
    const TeacherSelfTest = require('./teacher-self-test');
    const selfTest = await TeacherSelfTest.resolveSelfTest({ phone, teacherUserId });
    let url;
    let body;
    if (selfTest) {
      url = await Link.previewLink(code, { shareCodeId, teacherUserId });
      if (!url) return kept('no_preview');
      body = resolveUx('vqOldLinkSelfTestBody', { language: lang });
    } else {
      // The one-shot handset link (web-quiz-handset.js): with app_settings web_quiz_handset_link on, the
      // button's URL carries, in its fragment, a one-hour single-use nonce the server keeps THIS phone's
      // known children under — so the page opens as the child this phone already is. The ids come from
      // the caller (the chat join already looks them up); off, or nobody known: the bare page URL, as
      // before. The body never carries a URL either way.
      const knownIds = typeof hooks.knownIds === 'function' ? await hooks.knownIds() : [];
      url = await require('./web-quiz-handset').withLink(`${Link.webBaseUrl()}/q/${code}`, knownIds, shareCodeId);
      const teacher = isolateIfMixed(sc.teacher_name || resolveUx('tqYourTeacher', { language: lang }), lang);
      const topic = sc.topic || resolveUx('tqTodaysLesson', { language: lang });
      const button = resolveUx('vqOldLinkBtn', { language: lang });
      body = resolveUx('vqOldLinkBody', { language: lang, params: { teacher, topic, button } });
    }

    clipsHeadStart(quizId);

    // The chat join must not be waiting for a name: the child's next text is theirs.
    await clearJoin();

    const WhatsAppService = require('../whatsapp.service');
    const buttonText = resolveUx('vqOldLinkBtn', { language: lang });   // ≤ 20 code points, asserted in tests
    let wamid = null;
    const sent = await WhatsAppService.sendCtaUrl(phone, { body, buttonText, url }, { onMessageId: (id) => { wamid = id; } });
    logEvent('web_quiz.old_link_redirect', {
      shareCodeId, quizId, code, kind: selfTest ? 'self_test' : 'child', language: lang, sent: Boolean(sent), phoneTail, wamid,
    });
    if (!sent) logToFile('⚠️ old quiz link: web link not delivered — running the chat join instead', { code }, 'error');
    else if (!selfTest) await remember(phone, { at: Date.now(), code, shareCodeId, quizId, language: lang, body, buttonText, url });
    return Boolean(sent);
  } catch (err) {
    logToFile('⚠️ old quiz link: redirect failed — running the chat join instead', { code, error: err.message }, 'error');
    return false;
  }
}

function redisStore() {
  const redis = require('../cache/railway-redis.service');
  return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
}

/** Keep the button just sent, for one re-offer within REOFFER_S. Never throws: no Redis = no re-offer. */
async function remember(phone, entry) {
  try {
    const redis = redisStore();
    if (redis) await redis.set(PENDING_KEY(phone), entry, REOFFER_S);
  } catch (err) {
    logToFile('⚠️ old quiz link: could not keep the button for a re-offer', { code: entry.code, error: err.message });
  }
}

/**
 * The page logged page_open on this code (web-quiz.service events). The re-offer only needs to know
 * that the page opened after a button was sent, so this keeps the time, per code, for REOFFER_S. Any
 * child's open counts (a page_open carries no phone): a classmate's open in those minutes means no
 * re-offer, which is today's path. Not awaited; never throws.
 */
function noteOpen(code) {
  if (!/^[A-Z0-9]{4,12}$/i.test(String(code || ''))) return;
  Promise.resolve()
    .then(() => { const redis = redisStore(); return redis && redis.set(OPENED_KEY(code), Date.now(), REOFFER_S); })
    .catch(() => { /* no marker: at worst one extra button */ });
}

/**
 * A plain text from a phone that got a child's redirect in the last REOFFER_S: answer it ONCE with the
 * same button, instead of the AI chat. Returns true only when the button was sent (the caller stops);
 * false sends the text on as before. `hooks.isChatQuizRunning()` as in tryRedirect. Never throws.
 */
async function tryReoffer(phone, hooks = {}) {
  try {
    const redis = redisStore();
    if (!redis) return false;
    const entry = await redis.get(PENDING_KEY(phone));
    if (!entry || !entry.at || !entry.url) return false;
    const afterS = Math.round((Date.now() - entry.at) / 1000);
    if (afterS < 0 || afterS > REOFFER_S) return false;
    const ids = { shareCodeId: entry.shareCodeId, quizId: entry.quizId, code: entry.code, phoneTail: String(phone || '').slice(-4) };
    const skipped = async (reason) => {
      await redis.delete(PENDING_KEY(phone));
      logEvent('web_quiz.old_link_reoffer_skipped', { ...ids, reason, afterS });
      return false;
    };
    if (!(await redirectOn())) return skipped('flag_off');
    const isChatQuizRunning = typeof hooks.isChatQuizRunning === 'function' ? hooks.isChatQuizRunning : async () => false;
    if (await isChatQuizRunning()) return skipped('chat_quiz_running');
    const opened = Number(await redis.get(OPENED_KEY(entry.code)));
    if (opened && opened >= entry.at) return skipped('opened');
    // One per redirect, even for two texts in the same instant: claim, read back (a Redis error can
    // answer "claimed" to everyone), then drop the entry.
    const me = `${process.pid}:${Math.random().toString(36).slice(2)}`;
    await redis.setNX(CLAIM_KEY(phone, entry.at), me, REOFFER_S);
    if ((await redis.get(CLAIM_KEY(phone, entry.at))) !== me) return false;
    await redis.delete(PENDING_KEY(phone));

    const WhatsAppService = require('../whatsapp.service');
    let wamid = null;
    const sent = await WhatsAppService.sendCtaUrl(phone, { body: entry.body, buttonText: entry.buttonText, url: entry.url },
      { onMessageId: (id) => { wamid = id; } });
    logEvent('web_quiz.old_link_reoffer', { ...ids, language: entry.language, sent: Boolean(sent), wamid, afterS });
    if (!sent) logToFile('⚠️ old quiz link: re-offer not delivered — the text goes on as usual', { code: entry.code }, 'error');
    return Boolean(sent);
  } catch (err) {
    logToFile('⚠️ old quiz link: re-offer failed — the text goes on as usual', { error: err.message }, 'error');
    return false;
  }
}

module.exports = { tryRedirect, tryReoffer, noteOpen, redirectOn, FLAG_KEY, REOFFER_S, _resetCache: () => { cache = null; } };
