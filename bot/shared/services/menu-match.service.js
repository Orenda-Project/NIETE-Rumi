'use strict';
/**
 * bd-xw56ed — what a message no door caught is asking for, read against the user's LIVE menu.
 *
 * The fallthrough classifier used to choose between four fixed labels (lesson plan, presentation,
 * video, general), so anything else a teacher asked for — an assessment, attendance, training —
 * could only become general chat. Production, 20 Oct 2026: "/assesments" was answered by the AI
 * chat, which offered to write an assessment itself instead of opening the generator.
 *
 * Its choices are now exactly the rows /menu would draw for this user (featureMenuRows with the
 * same menuGates), so a feature appears here when it appears on the menu and not otherwise: a row
 * whose Flow is unset, or whose switch is off, is never something the classifier can open.
 */

const { featureMenuRows, NOT_A_FEATURE_ROWS, rowLabel } = require('../config/role-features');
const { resolveUx } = require('../config/ux-strings');
const { logToFile } = require('../utils/logger');

/**
 * The commands each row's own door already answers to, shown to the model beside the row so a
 * mistyped or partial command reads as the row it names. Not a list of typos: the door's own words
 * (the assessment door answers /exam as well). Lesson plans have no slash command.
 */
const ROW_COMMANDS = Object.freeze({
  menu_training: ['/training'],
  menu_coaching: ['/coaching'],
  menu_observe: ['/observe'],
  menu_attendance: ['/attendance'],
  menu_classes: ['/classes'],
  menu_quiz: ['/quiz'],
  menu_assessment: ['/assessment', '/exam'],
  menu_videos: ['/video'],
  menu_roster: ['/roster'],
});

/**
 * The rows this user's /menu would show, as classifier choices. Never throws: a failed gate read
 * offers fewer rows, and a failure here offers none, which leaves lesson plans and chat.
 *
 * @param {object|null} user
 * @returns {Promise<Array<{label: string, rowId: string, title: {en: string, ur: string},
 *   description: string, commands: string[]}>>}
 */
async function liveMenuChoices(user) {
  try {
    const { menuGates } = require('../config/menu-gates');
    const gates = await menuGates();
    return featureMenuRows(user, gates)
      .filter((row) => !NOT_A_FEATURE_ROWS.has(row.id))
      .map((row) => ({
        label: rowLabel(row.id),
        rowId: row.id,
        title: {
          en: resolveUx(row.titleKey, { language: 'en' }),
          ur: resolveUx(row.titleKey, { language: 'ur' }),
        },
        description: resolveUx(row.descriptionKey, { language: 'en' }),
        commands: ROW_COMMANDS[row.id] || [],
      }));
  } catch (err) {
    logToFile('⚠️ menu-match: the live menu could not be read — the classifier offers lesson plans and chat only', {
      error: err?.message,
    }, 'warn');
    return [];
  }
}

module.exports = { liveMenuChoices };
