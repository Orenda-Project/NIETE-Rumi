/**
 * v10 coaching test (bd-v0toag.8): the one thing to try, for groups C and D (the new report).
 *
 * After a recording, bd-v0toag.20 stores one thing to try on that session's
 * prioritized_action.thing_to_try = { move_id, lesson_id, text, tag, step }. Here: the next plan of the same
 * subject and grade ends its caption with it (bd-v0toag.100.8: the ask stays there until it is done), and for C and D it replaces the "Quick reminder" of the last commitment. Only while
 * ab_v10_enabled is on (groupFor is null otherwise). A, B and teachers outside the draw keep today's
 * caption byte for byte. Never throws: any failure falls back to today's caption and reminder.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { groupFor } = require('./ab-v10-arms');
const { scopeOf, activeThing } = require('./thing-to-try-scope');

const CAPTION_LIMIT = 1024; // WhatsApp document caption, in code points
const THING_LIMIT = 300; // a plan caption is ~60; this leaves it ample room

/** The stored thing to try, or null when it has no text. Pure. */
function thingToTryOf(prioritizedAction) {
  const t = prioritizedAction && prioritizedAction.thing_to_try;
  if (!t || typeof t.text !== 'string' || !t.text.trim()) return null;
  return {
    move_id: t.move_id || null,
    lesson_id: t.lesson_id || null,
    text: t.text.trim(),
    tag: t.tag || null,
  };
}

/** True for the new-report groups (C, D). Pure. */
function replacesReminder(arms) {
  return Boolean(arms && arms.report === 'new');
}

/** The caption line, its text capped so `${caption}\n\n${line}` fits 1024. Pure. */
function captionLine(thing, lang, caption = '') {
  const template = getCoachingMessage('thingToTryCaption', lang);
  const room = Math.min(THING_LIMIT,
    CAPTION_LIMIT - [...caption].length - 2 - [...template.replace('{{thing}}', '')].length);
  const chars = [...thing.text];
  const text = chars.length > room ? `${chars.slice(0, Math.max(0, room - 1)).join('')}…` : thing.text;
  return template.replace('{{thing}}', () => text);
}

/** The live ask for this plan's subject and grade, or null. */
async function latestThing(userId, lessonId) {
  const scope = scopeOf(lessonId);
  if (!scope) return null;
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, prioritized_action')
    .eq('user_id', userId)
    .not('prioritized_action', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return null;
  const live = activeThing(data, scope);
  return live ? thingToTryOf({ thing_to_try: live.thing }) : null;
}

/** The plan caption: today's, or for C and D today's plus the thing to try. */
async function planCaption({ userId, lessonId, caption, lang }) {
  try {
    const arms = await groupFor(userId);
    if (!replacesReminder(arms)) return caption;
    const thing = await latestThing(userId, lessonId);
    if (!thing) return caption;
    const out = `${caption}\n\n${captionLine(thing, lang, caption)}`;
    logEvent('coaching.thing_to_try.caption', {
      userId,
      group: arms.group,
      lessonId,
      moveId: thing.move_id,
      setOnLessonId: thing.lesson_id,
      tag: thing.tag,
    });
    return out;
  } catch (err) {
    logToFile('v10 test: thing to try caption failed (the plan goes with today\'s caption)', {
      userId, lessonId, error: err.message,
    });
    return caption;
  }
}

/** False for C and D (the thing to try replaces it); true otherwise, including on any failure. */
async function sendsPriorReminder(userId) {
  try {
    return !replacesReminder(await groupFor(userId));
  } catch (err) {
    return true;
  }
}

/**
 * The prior action the report's commitment card is built with (bd-v0toag.63). A "Yes" on it opens the action
 * with "Building on your last commitment:"; for C and D the thing to try replaces that, so null. Today's
 * prior action for everyone else, including on any failure.
 */
async function cardPriorAction(userId, priorAction) {
  if (!priorAction) return null;
  return (await sendsPriorReminder(userId)) ? priorAction : null;
}

module.exports = { thingToTryOf, replacesReminder, captionLine, planCaption, sendsPriorReminder, cardPriorAction };
