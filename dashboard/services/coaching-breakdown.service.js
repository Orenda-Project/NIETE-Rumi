/**
 * Coaching score client — the portal's only source of "how was she scored?".
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * Mirrors lp-catalogue.service.js and assessment.service.js. The portal used
 * to assemble its own breakdown from six hardcoded OECD goal names:
 *
 *   goal: 'Formative Assessment',  points: scores.goal1_total || 0
 *   goal: 'Student Engagement',    points: scores.goal2_total || 0
 *   …six in total
 *
 * Every NIETE region is configured for FICO, and a FICO session contains none
 * of those keys — 30 of 30 recent completed sessions on production. The `|| 0`
 * is what made it silent: the page rendered five zeroed bars under labels her
 * framework has never used, and picked "Strongest Area" by sorting them.
 *
 * So this module names no framework, no domain and no goal. It asks the bot,
 * which dispatches five adapters through the same code path that renders her
 * WhatsApp report image, and returns the answer. A sixth framework should
 * never require a portal change.
 *
 * FAILURE POLICY
 * --------------
 * Throws on a transport error, so the route answers 5xx and the page can say
 * "we could not load your scores" rather than drawing zeros — which is the
 * failure this whole change exists to remove. `breakdown: null` is NOT an
 * error: it means the session has not been scored yet, and the caller must be
 * able to tell that apart from a real zero.
 */

const axios = require('axios');

const TIMEOUT_MS = 15_000;

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

/**
 * The score breakdown for one session's analysis.
 *
 * The ANALYSIS is sent rather than a session id: the caller has already
 * fetched the row and confirmed it is hers, so making the bot re-read it
 * would be a second place to get ownership wrong.
 */
async function breakdown(analysisData, language = 'en') {
  if (!analysisData) return null;

  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('Coaching API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/coaching/breakdown`,
    { analysisData, language },
    {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    });

  const data = res && res.data;
  if (!data || data.success !== true) {
    throw new Error('Coaching API returned failure for breakdown');
  }
  return data.breakdown || null;
}

module.exports = { breakdown };
