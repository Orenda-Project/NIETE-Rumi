/**
 * A per-teacher soft limit on making papers: 10 an hour, 30 a day.
 *
 * WHY
 * ---
 * A board-pattern paper is several model calls, and generation shares one worker queue with
 * everything else. Before this limit, the heaviest teacher made 21 papers in one hour; 7 teachers
 * had ever passed 10. A teacher who is told "the next one can be made at 11:40" has a better day
 * than every teacher waiting behind one burst.
 *
 * SWITCH
 * ------
 * `assessment_rate_limit_enabled` in app_settings, read through the shared fail-closed reader:
 * absent, malformed or unreadable all mean OFF, and off means the count never runs.
 *
 * FAILS OPEN
 * ----------
 * The limit is a courtesy, not a guard: if the count cannot be read, the teacher is not blocked.
 *
 * The count is one bounded read on idx_assessment_requests_user_time (user_id, created_at DESC):
 * one teacher, the last 24 hours, at most 30 rows. Every surface's requests count (a paper is a
 * paper, whether it was asked for on WhatsApp or in the app).
 */

const { isFlagEnabled } = require('./feature-flags');

const ASSESSMENT_RATE_LIMIT_KEY = 'assessment_rate_limit_enabled';
const PER_HOUR = 10;
const PER_DAY = 30;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const COUNT_SQL =
  'SELECT created_at FROM assessment_requests WHERE user_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT 30';

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: Array<{created_at: string|Date}>}>} dbQuery
 * @param {string} userId the session's teacher
 * @param {Date} [now]
 * @returns {Promise<{ok: true} | {ok: false, window: 'hour'|'day', retryAt: string}>}
 */
async function check(dbQuery, userId, now = new Date()) {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { rows } = await dbQuery(COUNT_SQL, [userId, since]);
  const times = (rows || []).map((r) => new Date(r.created_at).getTime()).sort((a, b) => b - a);
  const hour = times.filter((t) => t > now.getTime() - HOUR_MS);

  // A slot frees when the request that filled it ages out of the window: the PER_HOUR-th newest
  // in the hour, the PER_DAY-th newest in the day. Both full → the later of the two.
  let refusal = null;
  if (hour.length >= PER_HOUR) refusal = { window: 'hour', at: hour[PER_HOUR - 1] + HOUR_MS };
  if (times.length >= PER_DAY) {
    const at = times[PER_DAY - 1] + DAY_MS;
    if (!refusal || at > refusal.at) refusal = { window: 'day', at };
  }
  if (!refusal) return { ok: true };
  return { ok: false, window: refusal.window, retryAt: new Date(refusal.at).toISOString() };
}

/** "11:40" in Pakistan time, 24-hour. The app turns retryAt into its own words in either language. */
function clock(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/** The server's English sentence for a refusal. */
function message(refusal) {
  const what = refusal.window === 'day' ? `${PER_DAY} papers today` : `${PER_HOUR} papers this hour`;
  return `You have made ${what}. The next one can be made at ${clock(refusal.retryAt)}.`;
}

/**
 * The route's one call. null → go ahead; otherwise the 429 body to send.
 * @returns {Promise<null | {success: false, error: string, errorCode: 'RATE_LIMITED', retryAt: string}>}
 */
async function guard({ supabase, dbQuery, userId, now = new Date() }) {
  if (!(await isFlagEnabled(supabase, ASSESSMENT_RATE_LIMIT_KEY))) return null;
  let refusal;
  try {
    refusal = await check(dbQuery, userId, now);
  } catch (error) {
    console.error('❌ Assessment rate limit count failed; not limiting', { error: error?.message });
    return null;
  }
  if (refusal.ok) return null;
  return { success: false, error: message(refusal), errorCode: 'RATE_LIMITED', retryAt: refusal.retryAt };
}

module.exports = { ASSESSMENT_RATE_LIMIT_KEY, PER_HOUR, PER_DAY, check, message, guard };
