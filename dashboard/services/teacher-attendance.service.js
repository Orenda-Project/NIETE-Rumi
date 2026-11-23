'use strict';
/**
 * bd-fmf24g.7 — teacher app v2: class attendance, reached through the bot's internal API
 * (bot/shared/routes/internal-attendance.routes.js). The portal holds no attendance rule of its
 * own: the roster, the write path, the 90-day window and the register all live in the bot, so the
 * portal and WhatsApp cannot disagree about a day.
 *
 * Every function takes the SESSION's teacher id; routes/portal-teacher-attendance.routes.js never
 * reads one from the request. A rule the teacher can act on comes back as { code }
 * (NOT_FOUND, BAD_DATE, BAD_MONTH, EMPTY_ROSTER); a bot that cannot answer THROWS — an empty list
 * would read "you have no classes".
 *
 * bd-33wxxi.10 — every function takes an optional last `{ staff: true }`: the route's word that this user may
 * open the principal's teacher register (listId "staff"). It is sent to the bot only when set, so a teacher's
 * calls are byte-for-byte what they were.
 */

function botConfig() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

async function callBot(path, body) {
  const axios = require('axios');
  const { baseUrl, apiKey } = botConfig();
  if (!baseUrl || !apiKey) throw new Error('attendance API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  const res = await axios.post(`${baseUrl}/api/internal/attendance/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: 20000,
    validateStatus: () => true,
  });
  const data = res && res.data;
  if (data && data.success === false && data.code) return { code: data.code };
  if (!res || res.status >= 400 || !data || data.success !== true) {
    throw new Error(`attendance/${path} failed (HTTP ${res && res.status})`);
  }
  const { success, ...rest } = data; // eslint-disable-line no-unused-vars
  return rest;
}

/** `{ staff: true }` into the body only when the route allowed it. */
const withStaff = (body, opts) => (opts && opts.staff === true ? { ...body, staff: true } : body);

const classes = (userId, date, opts) => callBot('classes', withStaff({ userId, date: date || null }, opts));
const roster = (userId, listId, opts) => callBot('roster', withStaff({ userId, listId }, opts));
const mark = (userId, listId, { date, absentIds, leaveIds }, opts) => callBot('mark', withStaff({ userId, listId, date, absentIds, leaveIds }, opts));
const day = (userId, listId, date, opts) => callBot('day', withStaff({ userId, listId, date }, opts));
const month = (userId, listId, m, opts) => callBot('month', withStaff({ userId, listId, month: m }, opts));
const registerFile = (userId, listId, m, opts) => callBot('register', withStaff({ userId, listId, month: m }, opts));
const sendRegister = (userId, listId, m, opts) => callBot('register/send', withStaff({ userId, listId, month: m }, opts));

/**
 * Her classes as the selector shows them: the class's grade code → its grade number, and her
 * subjects' codes → their names in her language (subject-vocabulary, the same spellings every v2
 * picker uses). A class with no grade (early years) or no subjects keeps null / [].
 */
function withNames(list, lang) {
  const { subjectKey, subjectName, gradeOf } = require('./subject-vocabulary.service');
  return (list || []).map((c) => {
    const g = c.gradeCode ? gradeOf(c.gradeCode) : null;
    const names = (c.subjectCodes || [])
      .map((code) => { const k = subjectKey(code); return k ? subjectName(k, lang) : null; })
      .filter(Boolean);
    return { ...c, grade: g && g.grade ? g.grade : null, subjects: [...new Set(names)] };
  });
}

module.exports = { classes, roster, mark, day, month, registerFile, sendRegister, withNames, callBot };
