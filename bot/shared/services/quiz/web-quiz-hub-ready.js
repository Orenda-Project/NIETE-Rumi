'use strict';
/**
 * The hub a reminder tap opens (?from=push, read as src 'push'): "Quiz ready" on each child the reminder was for.
 *
 *   carry(hubAnswerPromise, { src, device, now }) -> the hub answer, with `round: true` on each listed chip whose child
 *   still has tonight's class round waiting on this phone
 *
 * The children come from class-link's roundsReadyForPhone(device_ref, PKT day, { withKids: true }), the same answer the
 * reminder was built from, and the field is class-link's own (/j/'s "Whose turn?" chips carry `round: true`). Only a
 * chip the hub already lists is marked, by chip id: no name, no student id and no new chip leaves the bot.
 * Any other answer (not src 'push', locked, no children, no device), and any failure of the lookup, is returned as it
 * came, the same object, and nothing is asked. Off in production while class-link's own switch keeps its answer [].
 */
const T = require('./web-quiz-token');
const { logToFile } = require('../../utils/logger');

const PKT_MS = 5 * 60 * 60 * 1000;
const pktDay = (now) => new Date(now + PKT_MS).toISOString().slice(0, 10);

async function carry(answer, { src, device, now = Date.now() } = {}) {
  const out = await answer;
  if (src !== 'push' || !device || !out || out.locked || !Array.isArray(out.kids) || !out.kids.length) return out;
  try {
    const rounds = await require('./web-quiz-class-link').roundsReadyForPhone(device, pktDay(now), { withKids: true });
    const waiting = new Set((Array.isArray(rounds) ? rounds : []).flatMap((r) => (r && Array.isArray(r.kids) ? r.kids : []))
      .map((k) => k && k.student_id && T.chipId('h', String(k.student_id))).filter(Boolean));
    if (!waiting.size) return out;
    return { ...out, kids: out.kids.map((k) => (k && waiting.has(String(k.chip)) ? { ...k, round: true } : k)) };
  } catch (err) {
    logToFile('⚠️ web quiz hub: reminder marks unavailable', { error: err && err.message });
    return out;
  }
}

module.exports = { carry, pktDay };
