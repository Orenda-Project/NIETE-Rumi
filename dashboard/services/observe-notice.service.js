/**
 * bd-xorfy — ask the bot to tell a teacher about a visit booked, moved or
 * cancelled on the portal.
 *
 * Over HTTP, not a require: the portal cannot load bot modules (see
 * training-bands.service.js for the full story). The bot re-reads the schedule
 * row itself, so only ids and a kind are sent.
 *
 * NEVER throws. The booking is the product; the notice is a courtesy. Any
 * failure is logged and answered `false`.
 */

const axios = require('axios');

const TIMEOUT_MS = 10_000;

async function notifyTeacher({ scheduleId, leaderUserId, kind }) {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey || !scheduleId || !leaderUserId) return false;
  try {
    const res = await axios.post(
      `${baseUrl}/api/internal/observe/notify-teacher`,
      { scheduleId, leaderUserId, kind },
      { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
    );
    return !!(res && res.data && res.data.sent === true);
  } catch (error) {
    console.error('observe-notice: notify-teacher failed (non-blocking):', error.message);
    return false;
  }
}

module.exports = { notifyTeacher };
