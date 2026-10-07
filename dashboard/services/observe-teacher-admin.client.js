/**
 * bd-o15qnr.11 — ask the bot to run the /observe teacher admin for the coach
 * app's Edit teacher. Over HTTP, not a require: the portal cannot load bot
 * modules (see training-bands.service.js for the full story).
 *
 * Never throws: answers { status, data } — the bot's own status and body, or
 * 502 when the bot cannot be reached — so the route can return it as it is.
 */

const axios = require('axios');

const TIMEOUT_MS = 15_000;

async function post(path, body) {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) return { status: 503, data: { success: false, reason: 'not_configured' } };
  try {
    const res = await axios.post(`${baseUrl}/api/internal/observe/${path}`, body, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS,
    });
    return { status: res.status, data: res.data };
  } catch (error) {
    if (error && error.response) return { status: error.response.status, data: error.response.data };
    console.error(`observe-teacher-admin: ${path} unreachable:`, error && error.message);
    return { status: 502, data: { success: false, reason: 'bot_unreachable' } };
  }
}

const moveTeacher = ({ leaderUserId, teacherPhone, schoolExtId }) =>
  post('teacher-move', { leaderUserId, teacherPhone, schoolExtId });

const removeTeacher = ({ leaderUserId, userId, schoolExtId }) =>
  post('teacher-remove', { leaderUserId, userId, schoolExtId });

/** bd-o15qnr.13 — name / level / role / phone_check / phone: main's /observe edit path, ported. */
const editTeacher = ({ leaderUserId, schoolExtId, userId, edit, value }) =>
  post('teacher-edit', { leaderUserId, schoolExtId, userId, edit, value });

module.exports = { moveTeacher, removeTeacher, editTeacher };
