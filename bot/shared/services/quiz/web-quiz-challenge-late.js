'use strict';
/**
 * A Challenge result that arrives late (app_settings `web_quiz_challenge_late_result`, default off).
 *
 * A game played with no network sends its result when the network is back: hours or days after its run was served.
 * (A school Chromebook gets its games ready online, then children play offline.) Two rules refuse that result:
 *   - the run's token lives two hours (web-quiz-token CHALLENGE_TTL_S): 401 bad_token;
 *   - a served row is closed by the sweep after a day (SERVED_MS: served → abandoned, record=false), and the next
 *     serve draws again. No run is left that holds the questions the child answered.
 * With the switch on, a request that SAYS it is late (`late: { at }`, the device's clock when the child finished, or
 * `late: true`) is taken with the run's own lapsed token (genuine, of this run, no older than MAX_AGE_S) and finishes
 * the run's own row, served or abandoned, so it is scored against the questions that row holds. The row says so
 * (meta.late). Nothing else moves: a token still alive takes today's path whatever the request says; a run that has
 * its result answers 409 as today; a class-round token is never late (the turn is the teacher's, in the room).
 *
 * The record (`web_quiz_challenge_late_record`, default off, read only for a late result): the sweep took the record
 * from a row it took for never played. A late result shows it was played. With this switch on the row is the record
 * again when it was the record at its serve AND no other row holds the stop's record for the period: the unique
 * indexes of web_quiz_challenge_runs_record_locks.sql decide that (23505 → stored without it, meta.late.record
 * 'taken'). Off: the result is stored as a played run and is never a record.
 */
const T = require('./web-quiz-token');

const FLAG_KEY = 'web_quiz_challenge_late_result';
const RECORD_FLAG_KEY = 'web_quiz_challenge_late_record';
// how long after its serve a run still takes its late result: a school holiday, not a school year
const MAX_AGE_S = 45 * 24 * 60 * 60;
// the device's clock may be a little off the server's
const SKEW_MS = 10 * 60 * 1000;
// the states a late result finishes: served (the sweep has not come yet), abandoned (it has)
const OPEN = Object.freeze(['served', 'abandoned']);
// the columns the record rule reads from the row itself
const RECORD_COLS = 'mode, record, period_id, exposure_no, anchor_block';

/** When the run of a token was served (ms): its expiry less its life. */
const servedMs = (c) => (Number(c.exp) - T.CHALLENGE_TTL_S) * 1000;

/**
 * The run of a genuine challenge token that has LAPSED and is no older than MAX_AGE_S; null for anything else (a
 * token still alive, a forged or other-kind token, a class-round token, one too old).
 */
function lapsedRun(ct, now = Date.now()) {
  const c = T.verify(ct, 'c', { allowExpired: true });
  if (!c || !c.r || !c.sid || !c.ex || !c.exp || c.cr) return null;
  const nowS = Math.floor(now / 1000);
  if (Number(c.exp) >= nowS) return null;
  if (now - servedMs(c) > MAX_AGE_S * 1000) return null;
  return c;
}

/** What the row keeps of a late result: when the device says the child finished, when it arrived, the run's age. */
function stamp(c, late, now = Date.now()) {
  const at = late && typeof late === 'object' ? Number(late.at) : NaN;
  const played = Number.isFinite(at) && at >= servedMs(c) - SKEW_MS && at <= now + SKEW_MS ? new Date(at).toISOString() : null;
  return { played_at: played, received_at: new Date(now).toISOString(), age_s: Math.max(0, Math.round((now - servedMs(c)) / 1000)) };
}

/**
 * Was this row the record when it was served? Read from the row's own serve-time columns: the draw module's
 * recordAtServe rule (a check, in a period, a first exposure unless an anchor block, never an "on its way" draw).
 * A row made practice at its serve (a second record, a blocked record) has mode 'practice' and is not.
 */
function wasRecord(row) {
  if (!row || row.mode !== 'check' || row.period_id == null) return false;
  if (row.anchor_block == null && Number(row.exposure_no) !== 1) return false;
  const meta = row.meta || {};
  return !meta.record_blocked && !(meta.draw && meta.draw.outcome === 'on_its_way');
}

/** The record locks (23505) or a record CHECK (23514) refused the row as a record. */
const recordRefused = (error) => !!error && (error.code === '23505' || error.code === '23514');

/** meta without the note that the record was given up (the row has it again). */
const withoutRecordLost = (meta) => { const { record_lost: _r, ...rest } = meta || {}; return rest; };

/**
 * Write a late result onto its row. `late`: { stamp, record } (the note the row keeps; whether the record may come
 * back). `patchOf(meta, note)` builds the caller's patch from the row's meta and the note for meta.late; `write(patch)`
 * is the caller's own guarded update and answers { data, error }. The row is written as the record again when it may
 * be; when the record locks refuse that (another row holds the stop's record), or when it may not, without.
 */
async function writeLate(row, late, patchOf, write) {
  const restore = !!late.record && row.status === 'abandoned' && row.record !== true && wasRecord(row);
  if (restore) {
    const out = await write({ ...patchOf(withoutRecordLost(row.meta), { ...late.stamp, record: 'restored' }), record: true });
    if (!recordRefused(out && out.error)) return out;
  }
  return write(patchOf(row.meta, restore ? { ...late.stamp, record: 'taken' } : late.stamp));
}

module.exports = { FLAG_KEY, RECORD_FLAG_KEY, MAX_AGE_S, OPEN, RECORD_COLS, lapsedRun, stamp, wasRecord, recordRefused, withoutRecordLost, writeLate };
