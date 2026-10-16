'use strict';
/**
 * The class round's events (EVENTS §3): class_round_{drawn, started, absent, child_done, finished}, server-written
 * (w:'s'). Written only with web_quiz_events_v2 on (and the round on: only round code calls this). `cls` and `kid`
 * come ONLY from the hashed-key module (web-quiz-kid.js); while that module is absent nothing is written (one log
 * line), never a raw class id, a child id, a name or a roster position that maps to a child (child_done has no pos).
 */
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./web-quiz-class-round-flags');

function keys() {
  try {
    // eslint-disable-next-line global-require
    return require('./web-quiz-kid');
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} name     class_round_drawn | _started | _absent | _child_done | _finished
 * @param {object} fields   the event's own fields (never an id or a name)
 * @param {{classId: string, childId?: string}} who  hashed here through web-quiz-kid, never sent raw
 */
async function emit(name, fields, { classId, childId = null } = {}) {
  try {
    if (!(await Flags.flags()).events) return false;
    const K = keys();
    if (!K || typeof K.cls !== 'function') {
      logToFile('class round: hashed-key module not deployed — event not written', { event: name });
      return false;
    }
    const cls = K.cls(classId);
    if (!cls) return false;
    const body = childId
      ? K.envelope({ kid: K.kid(childId), round: fields.round, cls, ...fields })
      : { w: 's', ev_v: 2, round: fields.round, cls, ...fields };
    logEvent(`web_quiz.${name}`, body);
    return true;
  } catch (err) {
    logToFile('⚠️ class round: event not written', { event: name, error: err.message }, 'warn');
    return false;
  }
}

module.exports = { emit };
