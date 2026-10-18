'use strict';
/**
 * The reminder's live class picture switch: app_settings `quiz_reminder_live_preview`. On, the teacher's quiz reminder
 * link /q/<CODE> carries ?v=<played> (how many children played), so WhatsApp previews it as the live class picture
 * (the page's ogImageFor: played, average, top) and a new count is a new preview. Never a storybook send, never at 0.
 * Only JSON `true` is on; an absent row, `false`, any other value (the strings "true" and "\"true\"", "yes", 1, {},
 * {enabled: true}, "TRUE", " true ") and a failed read are all OFF.
 * It rides the report's fold switch read (settings-group), so the report reads app_settings as often as it did
 * before this switch; with no host read in the last 30 s it reads its own key once.
 */
const { logToFile } = require('../../utils/logger');
const { settingsGroup } = require('../settings-group');
const FoldFlag = require('./report-fold-flag');

const KEY = 'quiz_reminder_live_preview';
const TTL_MS = 30 * 1000;
const group = settingsGroup(FoldFlag.KEY, [KEY], TTL_MS);

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  try {
    const { data, error } = await group.rider(KEY, now);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return Boolean(data) && isTrue(data.value);
  } catch (err) {
    logToFile('⚠️ teacher report: reminder live-preview setting unreadable — the reminder link stays plain', { error: err && err.message });
    return false;
  }
}

/** The quiz report's two switches: the fold switch's read first (it carries this key), then this one. → { fold, live }. */
async function withFold(now = Date.now()) {
  const fold = await FoldFlag.on(now);
  return { fold, live: await on(now) };
}

/** Tests only: forget the cached reading. */
function reset() { group.forget(KEY); }

module.exports = { on, withFold, reset, isTrue, KEY, TTL_MS };
