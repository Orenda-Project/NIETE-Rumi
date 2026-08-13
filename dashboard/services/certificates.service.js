/**
 * Certificates client — the portal's only route to a teacher's certificates.
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * Mirrors training-rules.service.js. The portal knows one thing about
 * certificates: who is logged in. Everything else — which certificates exist,
 * whether a PDF has been rendered, how to render one, where it lives in R2,
 * how to sign a download — belongs to the bot.
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * Not a style choice; module resolution forces it. The renderer lives at
 * bot/shared/services/training/certificate-pdf.service.js, so its
 * `require('pdfkit')` searches bot/node_modules and then the repo root, and
 * never dashboard/node_modules — the dashboard declaring pdfkit itself makes
 * no difference. A portal-side render works in a dev tree where both installs
 * exist and fails on the deployed service. Same trap the lesson-plan enqueue
 * fell into, where the swallowed require degraded silently for two days.
 *
 * IDENTITY STAYS HERE
 * -------------------
 * The caller passes the userId it read from the SESSION. The bot filters every
 * lookup on it and never accepts a bare certificate code, so this client must
 * never be handed a user id that came off a request body.
 *
 * TWO FAILURE POLICIES, ON PURPOSE
 * --------------------------------
 *   listCertificates  THROWS. `[]` is a legitimate answer ("none yet"), so
 *                     returning it on error would tell a teacher their
 *                     certificates do not exist.
 *   getCertificatePdf returns null (or { notFound: true }). A download that
 *                     cannot be produced is just unavailable — the caller
 *                     degrades that ONE certificate and the list is untouched.
 */

const axios = require('axios');

const TIMEOUT_MS = 30_000;   // a cold mint renders a PDF and uploads it

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

/**
 * POST to the bot's internal training API.
 * @throws when unconfigured, unreachable, or the bot reports failure.
 */
async function ask(path, body) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('certificates API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/training/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const data = res && res.data;
  if (!data || data.success !== true) {
    throw new Error(`certificates API returned failure for ${path}`);
  }
  return data;
}

/**
 * Every certificate this teacher has earned. Never mints — the bot's list
 * route is a pure read, so drawing a list of 40 costs 40 rows and no renders.
 *
 * @param {string} userId - from the session, never from a request body
 * @returns {Promise<Array>} the bot's rows, verbatim
 * @throws on any failure (see the module note)
 */
async function listCertificates(userId) {
  const data = await ask('certificates', { userId });
  return data.certificates || [];
}

/**
 * Fetch-or-mint one certificate's PDF and get a signed download URL.
 *
 * @param {string} userId - from the session
 * @param {string} certificateCode
 * @param {'attachment'|'inline'} [disposition] - bd-2676. 'inline' returns a url
 *   the browser RENDERS; 'attachment' (the bot's default when omitted) returns
 *   one it SAVES. The portal's View button asks for inline, Download for
 *   attachment. Kept as a parameter rather than a second function because the
 *   only difference is one signed response header.
 * @returns {Promise<{download_url: string, minted: boolean}|{notFound: true}|null>}
 *   null when the file could not be produced; `{ notFound: true }` when this
 *   teacher has no such certificate — the caller needs to tell those apart to
 *   answer 404 vs 502.
 */
async function getCertificatePdf(userId, certificateCode, disposition) {
  try {
    return await ask('certificate-pdf', {
      userId,
      certificateCode,
      ...(disposition ? { disposition } : {}),
    });
  } catch (error) {
    if (error?.response?.status === 404) return { notFound: true };
    console.error('❌ Certificate PDF could not be fetched or minted', {
      certificateCode,
      status: error?.response?.status,
      error: error?.message,
    });
    return null;
  }
}

module.exports = { listCertificates, getCertificatePdf };
