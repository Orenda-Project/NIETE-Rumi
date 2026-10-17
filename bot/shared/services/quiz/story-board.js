/**
 * A storybook the teacher sent has no class table (app_settings web_quiz_story_board_refuse, JSON `true` only).
 * The class page never asks for one; this keeps the bot's board answer from listing the children who opened a story.
 * Off (absent, false, anything but `true`, or a read that fails): no quiz row is read and the board is today's.
 * On: one `quizzes` read per quiz per process, kept (a quiz never changes source); the switch at most every 30 s.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_story_board_refuse';
// story-teacher.service's SOURCE: the quiz row a story send makes (a test pins the two equal).
const SOURCE = 'story';
const FLAG_TTL_MS = 30 * 1000;
const KEEP_MAX = 2000;

let flag = null;
const sources = new Map();

async function on(db) {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag.on;
  try {
    const { data, error } = await db.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    flag = { at: Date.now(), on: Boolean(data) && data.value === true };
  } catch (e) {
    logToFile('⚠️ story board: settings lookup failed — off', { error: e.message });
    flag = { at: Date.now(), on: false };
  }
  return flag.on;
}

/** Whether this quiz's class board is refused: on, and the quiz is a storybook the teacher sent. Never throws. */
async function refused(quizId, { db = supabase } = {}) {
  if (!quizId || !(await on(db))) return false;
  if (sources.has(quizId)) return sources.get(quizId) === SOURCE;
  try {
    const { data, error } = await db.from('quizzes').select('quiz_source').eq('id', quizId).maybeSingle();
    if (error) throw new Error(error.message || 'quizzes read failed');
    if (sources.size >= KEEP_MAX) sources.clear();
    sources.set(quizId, (data && data.quiz_source) || null);
    return Boolean(data) && data.quiz_source === SOURCE;
  } catch (e) {
    logToFile('⚠️ story board: quiz lookup failed — today\'s board', { error: e.message });
    return false;
  }
}

module.exports = { KEY, SOURCE, refused, _reset: () => { flag = null; sources.clear(); } };
