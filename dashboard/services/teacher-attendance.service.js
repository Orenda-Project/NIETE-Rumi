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

const classes = (userId, date) => callBot('classes', { userId, date: date || null });
const roster = (userId, listId) => callBot('roster', { userId, listId });
const mark = (userId, listId, { date, absentIds, leaveIds }) => callBot('mark', { userId, listId, date, absentIds, leaveIds });
const day = (userId, listId, date) => callBot('day', { userId, listId, date });
const month = (userId, listId, m) => callBot('month', { userId, listId, month: m });
const registerFile = (userId, listId, m) => callBot('register', { userId, listId, month: m });
const sendRegister = (userId, listId, m) => callBot('register/send', { userId, listId, month: m });

module.exports = { classes, roster, mark, day, month, registerFile, sendRegister, callBot };
