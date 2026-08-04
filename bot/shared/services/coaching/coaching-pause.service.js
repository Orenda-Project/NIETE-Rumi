/**
 * Coaching pause / resume — the third option bd-2508 was missing.
 *
 * Before this, a slash command during `conducting_conversation` set the session
 * to `abandoned` with no warning. Escaping the 269-hour trap and destroying the
 * reflection were the same action. This service adds the middle ground:
 *   * confirm  — tell the teacher what she is about to lose, and ask
 *   * pause    — suspend the session, keeping every answer and the question cursor
 *   * resume   — pick the questions back up where she left off
 *
 * `/menu` and `/help` never come through the confirmation path. They are the
 * documented escape hatch and must work on the first try — see `isAlwaysAllowed`
 * and the digit exemption in text-message.handler.js.
 */

const supabase = require('../../config/supabase');
const redis = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { getUserLanguage } = require('../../utils/language-cache');

// Imported, NEVER hardcoded. Verified live 2026-08-04: the value is currently 1
// (one reflection question per observation, was 3), and coaching-debrief.config.js
// is the single source that the loop bound, the meta-prompt "question X of N"
// string, and the few-shot arms all key off. A literal here would go stale the
// moment that constant changes.
const { NUM_REFLECTIVE_QUESTIONS } = require('../../config/coaching-debrief.config');

// How long we hold a pending confirmation before it lapses. Short on purpose: a
// stale "are you sure?" answered an hour later is worse than asking again.
const CONFIRM_TTL_SECONDS = 10 * 60;
const CONFIRM_KEY = (userId) => `coaching:confirm_switch:${userId}`;

// Evening nudge window, 20:00-21:59 Asia/Karachi (house timezone, matching
// attendance-bigquery-export.worker.js). End hour is exclusive.
const EVENING_WINDOW_START_HOUR = 20;
const EVENING_WINDOW_END_HOUR = 22;
const REMINDER_TZ = 'Asia/Karachi';

// Teacher-facing label per command. The prompt must name the service SHE asked
// for, never a hardcoded example.
const SERVICE_LABELS = {
  '/lessonplan': 'a lesson plan',
  '/lp': 'a lesson plan',
  '/video': 'a video',
  '/quiz': 'a quiz',
  '/readingtest': 'a reading assessment',
  '/assessment': 'an assessment',
  '/attendance': 'attendance',
  '/exam': 'an exam check',
};

/** Commands that must NEVER be gated — the escape hatch. */
const ALWAYS_ALLOWED = new Set(['/menu', '/help']);

/**
 * Menu selections that START a service and therefore need the same confirmation
 * a slash command gets. Keyed by BOTH surfaces the menu is answered on: the
 * interactive button ids (`menu_*`) and the legacy typed digits ("1".."4").
 *
 * `menu_other` / "4" is deliberately ABSENT: it opens general AI chat, starts no
 * service, and nagging a teacher who just wants to ask a question would be noise.
 * The reflection is left running for it, exactly like /help.
 *
 * `menu_coaching` / "1" IS included even though it is coaching: it asks for a NEW
 * lesson recording, so the reflection she is in the middle of must be paused (and
 * nudged this evening) rather than silently orphaned.
 */
const MENU_SERVICE_LABELS = {
  menu_coaching: 'a new coaching session',
  menu_lesson_plan: 'a lesson plan',
  menu_video: 'a video',
  menu_reading: 'a reading assessment',
  menu_training: 'training',
  1: 'a new coaching session',
  2: 'a lesson plan',
  3: 'a video',
};

// Deliberately EXCLUDES bare digits. During coaching a "1" is either a menu
// choice or a real answer — never a yes/no to this prompt. Treating it as YES
// would silently pause a session the teacher meant to keep.
const YES_WORDS = new Set(['yes', 'y', 'haan', 'han', 'ji', 'hanji']);
const NO_WORDS = new Set(['no', 'n', 'nahi', 'nahin', 'nai']);

function labelFor(command) {
  return SERVICE_LABELS[String(command || '').toLowerCase()] || 'that';
}

function isAlwaysAllowed(command) {
  return ALWAYS_ALLOWED.has(String(command || '').toLowerCase());
}

/**
 * Exactly "1".."4" and nothing else — no surrounding space, no trailing dot, no
 * emoji-keycap. Measured on live data 2026-08-04: only 5 of 7,644 reflective
 * answers are a bare 1-4, but 365 are <= 2 characters, so anything looser would
 * start eating real answers.
 */
function isMenuDigit(text) {
  return /^[1-4]$/.test(String(text ?? ''));
}

function isYes(text) {
  return YES_WORDS.has(String(text ?? '').trim().toLowerCase());
}

function isNo(text) {
  return NO_WORDS.has(String(text ?? '').trim().toLowerCase());
}

function isEveningWindow(hour) {
  return hour >= EVENING_WINDOW_START_HOUR && hour < EVENING_WINDOW_END_HOUR;
}

/** Current hour (0-23) in the house timezone, independent of server TZ. */
function currentHourInTz(tz = REMINDER_TZ) {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false })
      .format(new Date()),
    10
  );
}

/** How many reflective questions this session has answers for. */
function answeredCount(session) {
  const state = session?.conversation_state || {};
  if (typeof state.questions_answered === 'number') return state.questions_answered;
  return (state.questions || []).filter((q) => q && q.answer).length;
}

/**
 * Ask the teacher to confirm before we suspend her reflection.
 * Names the service she asked for and how far through she is.
 *
 * @param {Object} [opts]
 * @param {string} [opts.label] override the label (menu path supplies its own)
 * @param {string} [opts.menuSelector] button id / digit to dispatch on YES,
 *        instead of replaying a text command
 */
async function askToConfirmSwitch(from, userId, session, command, fullMessage, opts = {}) {
  const answered = answeredCount(session);
  const label = opts.label || labelFor(command);
  // Ask in HER language. Best-effort: a cache miss must not block the prompt,
  // because failing to ask means silently destroying the reflection again.
  let languageCode = 'en';
  try {
    languageCode = (await getUserLanguage(userId)) || 'en';
  } catch (err) {
    logToFile('⚠️ Language lookup failed for switch prompt, using English', { userId });
  }

  // Stash what YES should do. For a slash command that is the ORIGINAL message
  // text, so arguments survive ("/lessonplan grade 4 maths"). For a menu pick
  // there is no re-runnable text, so the selector is stashed and dispatched
  // directly instead.
  await redis.setex(
    CONFIRM_KEY(userId),
    CONFIRM_TTL_SECONDS,
    JSON.stringify({
      sessionId: session.id,
      command,
      fullMessage,
      label,
      menuSelector: opts.menuSelector || null,
    })
  );

  // Every teacher-facing string comes from coaching-messages.js so a fork can ship
  // translations without hunting through pipeline files (enforced by
  // tests/setup/no-hardcoded-coaching-strings.test.js). {{...}} placeholders are
  // substituted here, deliberately NOT ${} interpolation, so translators see the
  // same tokens in every language.
  const keptLine = answered > 0
    ? getCoachingMessage('switchKeptWithAnswers', languageCode)
        .replace('{{count}}', String(answered))
        .replace('{{plural}}', answered === 1 ? '' : 's')
        .replace('{{isare}}', answered === 1 ? 'is' : 'are')
    : getCoachingMessage('switchKeptNoAnswers', languageCode);

  // Two variants because NUM_REFLECTIVE_QUESTIONS is 1 today — "0 of 1 questions"
  // reads badly, so a single outstanding question gets its own phrasing.
  const key = NUM_REFLECTIVE_QUESTIONS === 1 ? 'switchConfirmSingle' : 'switchConfirmMulti';
  const text = getCoachingMessage(key, languageCode)
    .replace(/\{\{service\}\}/g, label)
    .replace(/\{\{answered\}\}/g, String(answered))
    .replace(/\{\{total\}\}/g, String(NUM_REFLECTIVE_QUESTIONS))
    .replace('{{kept}}', keptLine);

  await WhatsAppService.sendMessage(from, text);

  logToFile('🎓 Asked teacher to confirm switching away from coaching', {
    coachingSessionId: session.id,
    command,
    answered,
  });
}

/**
 * Menu-path guard. Returns true when the caller must STOP because a confirmation
 * was sent instead of the service starting.
 *
 * Why this exists separately from the handler path: a slash command is visible to
 * the coaching interceptor, which asks before the command ever runs. A menu pick
 * arrives as a bare digit that the interceptor deliberately DEFERS (that deferral
 * is what makes /menu usable at all), so by the time MenuService runs the
 * ask-first opportunity has already passed. This puts the gate back, at the
 * menu's own two entry points (buttons and typed digits).
 *
 * `selector` is a button id (`menu_video`) or a typed digit ("3"). Anything absent
 * from MENU_SERVICE_LABELS — notably `menu_other` / "4" — passes straight through
 * with the reflection left running, since it starts no service.
 *
 * @returns {Promise<boolean>} true = confirmation sent, caller must return early
 */
async function guardMenuSelection(selector, userId, from) {
  const label = MENU_SERVICE_LABELS[selector];
  if (!label) return false; // not a service-starting pick (e.g. general chat)

  const { data: active } = await supabase
    .from('coaching_sessions')
    .select('id, conversation_state')
    .eq('user_id', userId)
    .eq('status', 'conducting_conversation')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!active) return false; // no reflection in flight, nothing to protect

  logToFile('🎓 Menu pick during coaching — asking before pausing', {
    coachingSessionId: active.id,
    selector,
  });
  await askToConfirmSwitch(from, userId, active, selector, null, {
    label,
    menuSelector: selector,
  });
  return true;
}

/**
 * Is a confirmation outstanding for this user? Returns the stashed payload or null.
 *
 * NOTE: railway-redis `get()` ALREADY JSON.parses (falling back to the raw string),
 * so this must NOT parse again — a second parse on an object throws. Verified
 * against the service 2026-08-04.
 */
async function getPendingConfirmation(userId) {
  const payload = await redis.get(CONFIRM_KEY(userId));
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  // Redis fell back to a raw string, i.e. the value was not valid JSON. Drop it
  // rather than trapping the teacher behind a gate she can never answer.
  logToFile('⚠️ Corrupt coaching confirmation payload, clearing', { userId });
  await clearPendingConfirmation(userId);
  return null;
}

async function clearPendingConfirmation(userId) {
  // `delete`, not `del` — RailwayRedisService exposes delete(key) (line 508).
  // There is no `del` method; calling it would throw.
  await redis.delete(CONFIRM_KEY(userId));
}

/**
 * Suspend the session. `paused` (not `abandoned`) so the questions survive and the
 * evening reminder can find it. Every answer already lives in
 * conversation_state.questions, so nothing the teacher said is lost.
 */
async function pauseSession(sessionId, reason) {
  await supabase
    .from('coaching_sessions')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
      pause_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  logToFile('⏸️ Coaching session paused', { coachingSessionId: sessionId, reason });
}

/**
 * Put a paused session back into `conducting_conversation` and re-ask the question
 * she was on. Clears evening_reminder_sent_at so a later pause can ping again.
 */
async function resumeSession(sessionId, from) {
  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('id, conversation_state')
    .eq('id', sessionId)
    .single();

  if (!session) {
    logToFile('⚠️ Resume requested for a missing session', { coachingSessionId: sessionId });
    return false;
  }

  await supabase
    .from('coaching_sessions')
    .update({
      status: 'conducting_conversation',
      paused_at: null,
      pause_reason: null,
      evening_reminder_sent_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  const answered = answeredCount(session);

  // Required here, not at module load: reflective-conversation.service requires
  // this file too, so a top-level require would be circular.
  const ReflectiveConversationService = require('./reflective-conversation.service');
  await ReflectiveConversationService.conductReflectiveConversation(
    sessionId,
    from,
    answered + 1
  );

  logToFile('▶️ Coaching session resumed', {
    coachingSessionId: sessionId,
    fromQuestion: answered + 1,
  });
  return true;
}

module.exports = {
  SERVICE_LABELS,
  MENU_SERVICE_LABELS,
  ALWAYS_ALLOWED,
  guardMenuSelection,
  NUM_REFLECTIVE_QUESTIONS,
  CONFIRM_KEY,
  CONFIRM_TTL_SECONDS,
  EVENING_WINDOW_START_HOUR,
  EVENING_WINDOW_END_HOUR,
  REMINDER_TZ,
  labelFor,
  isAlwaysAllowed,
  isMenuDigit,
  isYes,
  isNo,
  isEveningWindow,
  currentHourInTz,
  answeredCount,
  askToConfirmSwitch,
  getPendingConfirmation,
  clearPendingConfirmation,
  pauseSession,
  resumeSession,
};
