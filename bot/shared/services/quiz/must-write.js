'use strict';
/**
 * A write that a "done" on someone's screen depends on (open the code, mark the send, write the row): it lands, or it is
 * logged at error level and refused. One shape for every send door, so an ignored `{ error }` behind a 200 cannot be
 * written by accident.
 *
 *   const row = await mustWrite(supabase.from('quizzes').insert(…).select().single(), 'story send: could not write the send',
 *     { needRow: true, refuse: () => new StoryError(503, 'unavailable') });
 *
 * `{ error }` (or no row with `needRow`: null, or an empty list — an update(…).eq(…).select('id') that matched nothing) → logToFile('❌ <what>', { error: <message> }, 'error') and `throw refuse()`
 * (default: an Error with status 503 and body { error: 'unavailable' }). A write that throws is not caught here: the
 * caller sees the same rejection it would see without this helper.
 */
const { logToFile } = require('../../utils/logger');

const unavailable = () => Object.assign(new Error('unavailable'), { status: 503, body: { error: 'unavailable' } });

async function mustWrite(write, what, { needRow = false, refuse = unavailable } = {}) {
  const { data, error } = (await write) || {};
  // No row: null, or the empty list an update(...).select() answers when it matched nothing.
  if (error || (needRow && (!data || (Array.isArray(data) && !data.length)))) {
    logToFile(`❌ ${what}`, { error: error ? error.message : null }, 'error');
    throw refuse();
  }
  return data;
}

module.exports = { mustWrite };
