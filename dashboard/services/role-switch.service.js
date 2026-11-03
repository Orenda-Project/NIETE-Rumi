'use strict';
/**
 * bd-tacnwy — an internal tester switches her OWN profile type (users.role). The route
 * (routes/portal-role-switch.routes.js) decides WHO may; this file is WHAT a switch does.
 *
 * ONE users write, with three columns:
 *   role                            the new profile type
 *   conversation_state              null — whatever she was half-way through belongs to the old role
 *   conversation_state_expires_at   null — the pair is written together, as conversation-state.service writeRow does
 *
 * It goes through a client built for this one request that sends `x-rumi-actor: <her users.id>`. The
 * users_history_trigger (record_history) already logs role changes; the header makes it name HER instead of
 * 'authenticator' (bot/database/migrations/row_history_actor.sql: honoured only with the service-role key and only
 * when uuid-shaped). That row — who, old role, new role, when — is the audit; nothing else is stored.
 *
 * Then the bot's per-user Redis waits are deleted, so her next WhatsApp message is not swallowed by a question the
 * old role was asked (a survey reason, a menu reply, "whose observation is this?"). The list is FLOW_KEYS below: every
 * key the bot keeps per users.id that holds a wait or a flow step. Kept on purpose: her PARKED recordings
 * (observe:parked:, media:parked:) — they hold audio she made and expire on their own (6 h / 2 h) — and
 * caches that are not flow state (consent, cooldowns, the lesson-plan shelf).
 */
const { createClient } = require('@supabase/supabase-js');
const { ACTOR_HEADER } = require('../../bot/shared/utils/actor-context');

/** Every per-user Redis key that holds a wait or a flow step, by the bot file that owns it. */
const FLOW_KEYS = Object.freeze([
  (id) => `user:${id}:awaiting_menu_selection`, //       bot/shared/services/menu.service.js
  (id) => `user:${id}:expecting:recovery`, //            bot/shared/handlers/text-message.handler.js
  (id) => `user:${id}:stuck:reminder`, //                bot/shared/handlers/text-message.handler.js
  (id) => `reading:user:${id}:current_assessment`, //    bot/shared/services/reading-assessment.service.js
  (id) => `reading:user:${id}:student_count`, //         bot/shared/services/reading-assessment.service.js
  (id) => `lp_feedback_pending:${id}`, //                bot/shared/services/lp-feedback.service.js
  (id) => `lp612_feedback_pending:${id}`, //             bot/shared/services/lp612-feedback.shared.js
  (id) => `coaching_feedback_pending:${id}`, //          bot/shared/services/coaching/coaching-feedback.service.js
  (id) => `student_video_feedback_pending:${id}`, //     bot/shared/services/student-video-feedback.service.js
  (id) => `quiz_intent_pending:${id}`, //                bot/shared/services/quiz/quiz-intent-router.service.js
  (id) => `pending_quiz_resume:${id}`, //                bot/shared/services/quiz/quiz-intent-router.service.js
  (id) => `quiz:awaiting_next_topic:${id}`, //           bot/shared/services/quiz/quiz-follow-up.service.js
  (id) => `observe:state:${id}`, //                      bot/shared/services/observe/observe-state.service.js
  (id) => `observe:who:${id}`, //                        bot/shared/services/observe/observe-who.service.js
  (id) => `observe:who-typed:${id}`, //                  bot/shared/services/observe/observe-who.service.js
  (id) => `media:target:${id}`, //                       bot/shared/services/coaching/media-target.service.js
  (id) => `ctst:state:${id}`, //                         bot/shared/services/child-test/conversation/state.js
]);

/** The keys for one user. */
function flowKeysFor(userId) {
  return FLOW_KEYS.map((k) => k(userId));
}

/**
 * A service-role client whose every request names `userId` as the actor. Built per request (a switch is rare); the
 * shared client (config/supabase.js) is left exactly as it is. Null when the environment has no Supabase.
 */
function clientAs(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { [ACTOR_HEADER]: String(userId).toLowerCase() } },
  });
}

/**
 * Write the new role for `userId`, as `userId`. Throws on any failure, including a write that changed no row.
 * @returns {Promise<void>}
 */
async function writeRole(userId, role) {
  const db = clientAs(userId);
  if (!db) throw new Error('role-switch: no database configured');
  const { data, error } = await db
    .from('users')
    .update({ role, conversation_state: null, conversation_state_expires_at: null })
    .eq('id', userId)
    .select('id, role');
  if (error) throw new Error(error.message || 'users update failed');
  if (!Array.isArray(data) || data.length !== 1) throw new Error(`role-switch: expected 1 row, got ${Array.isArray(data) ? data.length : 'none'}`);
}

/**
 * Delete her flow keys. Never throws: Redis is best effort (the database state is the one the bot reads first).
 * @param {{ del: (key: string) => Promise<boolean|null> }} redis lib/edge-redis
 * @returns {Promise<{ redis: boolean, cleared: string[] }>} redis false when no key could be asked about
 */
async function clearFlowKeys(redis, userId) {
  const keys = flowKeysFor(userId);
  const answers = await Promise.all(keys.map((k) => Promise.resolve().then(() => redis.del(k)).catch(() => null)));
  return {
    redis: answers.some((a) => a !== null),
    cleared: keys.filter((_k, i) => answers[i] === true),
  };
}

module.exports = { FLOW_KEYS, flowKeysFor, clientAs, writeRole, clearFlowKeys };
