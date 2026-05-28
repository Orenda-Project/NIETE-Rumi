/**
 * Coaching Trend Service.
 *
 * Loads N most-recent COMPLETED coaching sessions for a user and turns them
 * into a sparkline-ready trend array. Used by the hero coaching report and
 * any future framework that wants a trajectory chart.
 *
 * Design notes:
 *   - Returns ALL recent sessions across frameworks, NOT filtered to a single
 *     framework. A user who switched frameworks mid-history would otherwise see
 *     an empty sparkline; the template can style differently per framework
 *     using the `framework` field on each point.
 *   - Sort ASC (oldest → newest) so the sparkline reads left-to-right.
 *   - Defensive: returns [] (never null/undefined) on missing user, empty
 *     data, supabase error, or malformed analysis_data.
 *   - Each point: { date, pct, framework, label }.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const DEFAULT_LIMIT = 10;

/**
 * Short human label for a session date. Used as the x-axis tick label
 * on the sparkline. Default to Swahili month names for consistency with
 * the existing MEWAKA template; caller can override via options.locale = 'en'.
 */
const SW_MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortLabel(isoDate, locale = 'sw') {
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return '';
    const months = locale === 'en' ? EN_MONTHS : SW_MONTHS;
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  } catch {
    return '';
  }
}

function pctFromRow(row) {
  const ad = row.analysis_data;
  if (!ad || typeof ad !== 'object') return null;
  // Prefer scores.overall_percentage (MEWAKA / v2 canonical), then the OECD
  // shape scores.percentage (every pre-MEWAKA session stores its overall %
  // here), then any top-level overall_percentage. This keeps the sparkline
  // framework-agnostic.
  const cand = ad.scores?.overall_percentage ?? ad.scores?.percentage ?? ad.overall_percentage;
  const n = Number(cand);
  return Number.isFinite(n) ? n : null;
}

/**
 * Load the user's recent coaching-score trend.
 *
 * @param {string} userId - User UUID
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - Max rows to fetch
 * @param {string} [opts.locale='sw'] - Locale for label formatting (sw|en)
 * @param {string} [opts.excludeSessionId] - Skip this session (e.g. the
 *   session currently being reported, to avoid duplicating its data point
 *   in the sparkline of its own report). Optional.
 * @returns {Promise<Array<{date:string, pct:number, framework:string, label:string}>>}
 *   Sorted ascending by date (oldest → newest). Always an array; empty on
 *   any error or missing data.
 */
async function loadTrendData(userId, opts = {}) {
  const { limit = DEFAULT_LIMIT, locale = 'sw', excludeSessionId = null } = opts;
  try {
    if (!userId) return [];

    // Fetch the MOST-RECENT `limit` sessions, not the oldest:
    // `.order(ascending:true).limit(N)` returns the N OLDEST rows, which for a
    // teacher with a long history yields a stale, frozen sparkline. Order DESC
    // so the DB returns the newest N, then reverse() below to get ascending
    // (oldest→newest) for left-to-right plotting.
    const { data, error } = await supabase
      .from('coaching_sessions')
      .select('id, created_at, analysis_data')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logToFile('[coaching-trend] supabase error', { userId, error: error.message });
      return [];
    }
    if (!Array.isArray(data) || data.length === 0) return [];

    // Reverse the newest-first window into oldest→newest for the sparkline.
    return [...data].reverse()
      .filter((row) => !excludeSessionId || row.id !== excludeSessionId)
      .map((row) => {
        const pct = pctFromRow(row);
        if (pct == null) return null;
        return {
          date: row.created_at,
          pct,
          framework: row.analysis_data?.framework || null,
          label: shortLabel(row.created_at, locale),
        };
      })
      .filter(Boolean);
  } catch (err) {
    logToFile('[coaching-trend] unexpected error', { userId, error: err.message });
    return [];
  }
}

module.exports = { loadTrendData, shortLabel };
