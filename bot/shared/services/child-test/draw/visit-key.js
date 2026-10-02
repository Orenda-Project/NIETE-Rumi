'use strict';

/**
 * Child test — naming a visit that has no observe2 field form (CONTRACT v0.7 §12 CR-1).
 *
 * The draw is idempotent per visit. An observe2 visit is named by its observation_field_forms.id
 * (visitId); two coach paths have no such row, so they name the visit with a key (visit_key):
 *   cs:<coaching_session_id>                                  the offer after classic /observe
 *   day:<coachUserId>:<schoolId>:<YYYY-MM-DD, Pakistan time>  /egra on a visit day with no visit
 * Every part is a uuid; the date is a real calendar date. Anything else is not a key.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CS_RE = new RegExp(`^cs:(${UUID})$`);
const DAY_RE = new RegExp(`^day:(${UUID}):(${UUID}):([0-9]{4}-[0-9]{2}-[0-9]{2})$`);
const UUID_RE = new RegExp(`^${UUID}$`);

const isRealDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** The calendar date in Pakistan (UTC+5, no daylight saving), 'YYYY-MM-DD'. */
function pktDate(now = new Date()) {
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  return new Date(t + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * @returns {{kind:'cs', coachingSessionId:string} | {kind:'day', coachUserId:string, schoolId:string, date:string} | null}
 */
function parseVisitKey(key) {
  if (typeof key !== 'string') return null;
  const cs = CS_RE.exec(key);
  if (cs) return { kind: 'cs', coachingSessionId: cs[1] };
  const day = DAY_RE.exec(key);
  if (day && isRealDate(day[3])) return { kind: 'day', coachUserId: day[1], schoolId: day[2], date: day[3] };
  return null;
}

const isVisitKey = (key) => parseVisitKey(key) !== null;

/**
 * The key for a visit: pass { coachingSessionId } for classic /observe, or
 * { coachUserId, schoolId, now } for /egra with no visit. Returns null when the ids are not uuids.
 */
function visitKeyFor({ coachingSessionId, coachUserId, schoolId, now = new Date() } = {}) {
  if (coachingSessionId != null) return UUID_RE.test(String(coachingSessionId)) ? `cs:${coachingSessionId}` : null;
  if (!UUID_RE.test(String(coachUserId)) || !UUID_RE.test(String(schoolId))) return null;
  return `day:${coachUserId}:${schoolId}:${pktDate(now)}`;
}

/**
 * A caller names a visit by visitId or visitKey, never both.
 * @returns {{ok:true, visit:string|null} | {ok:false, reason:'ambiguous_visit'|'bad_visit_key'}}
 */
function oneVisit(visitId, visitKey) {
  if (visitId && visitKey) return { ok: false, reason: 'ambiguous_visit' };
  if (visitKey && !isVisitKey(visitKey)) return { ok: false, reason: 'bad_visit_key' };
  return { ok: true, visit: visitKey || visitId || null };
}

module.exports = { parseVisitKey, isVisitKey, visitKeyFor, pktDate, oneVisit };
