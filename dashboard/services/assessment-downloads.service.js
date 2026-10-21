'use strict';
/**
 * bd-ivsjk8.1 — every generator paper (or answer key) a teacher takes from the portal is recorded.
 *
 * The "Did your class sit the paper?" A/B (bd-ivsjk8) asks the school day after she gets a paper,
 * so the portal now says when that happened: one assessment_downloads row (V1.7.3) per successful
 * hand-over, from the two routes that give her a paper — the signed link (/download, via 'link') and
 * the app's Paper ready viewer (/file, via 'viewer').
 *
 * LOGGING NEVER COSTS HER THE PAPER — the same contract as lp-activity.service's logOpen:
 * `logDownload` is fire-and-forget, never throws, and a failure is logged at error level.
 */

const ARTIFACTS = Object.freeze(['paper', 'answer_key']);
const VIAS = Object.freeze(['link', 'viewer']);

/** Same teacher + paper + artifact inside this many minutes is ONE download (a re-render, a double
 *  tap, the viewer falling back to the link). */
const DEDUPE_MINUTES = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One conditional INSERT: stored only if the same (user, paper, artifact) has no row in the last
 * DEDUPE_MINUTES. The probe range-scans idx_assessment_downloads_user_recent (user_id, created_at DESC).
 */
const INSERT_DOWNLOAD_SQL = `
  INSERT INTO assessment_downloads (user_id, paper_id, artifact, via)
  SELECT $1::uuid, $2::uuid, $3, $4
   WHERE NOT EXISTS (
     SELECT 1 FROM assessment_downloads
      WHERE user_id = $1::uuid
        AND paper_id = $2::uuid
        AND artifact = $3
        AND created_at > now() - make_interval(mins => $5::int))
  RETURNING id`;

function cleanDownload({ userId, paperId, artifact, via } = {}) {
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (typeof paperId !== 'string' || !UUID.test(paperId)) return null;
  if (!ARTIFACTS.includes(artifact) || !VIAS.includes(via)) return null;
  return { userId, paperId, artifact, via };
}

/**
 * Record one download. Resolves { recorded: true, id, download } when stored, { recorded: false } when
 * it was a repeat inside the window, { recorded: false, reason: 'invalid' } when there is nothing valid
 * to record. Rejects on a database error — the routes use logDownload instead.
 *
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 */
async function recordDownload(query, download) {
  const d = cleanDownload(download);
  if (!d) return { recorded: false, reason: 'invalid' };
  const { rows } = await query(INSERT_DOWNLOAD_SQL, [d.userId, d.paperId, d.artifact, d.via, DEDUPE_MINUTES]);
  const row = (rows || [])[0];
  return row ? { recorded: true, id: row.id, download: d } : { recorded: false };
}

/**
 * Fire-and-forget recordDownload for the download path: never throws (synchronously or not), and logs
 * a failure at error level. Returns the promise only so a test can wait on it — the routes do not.
 */
function logDownload(query, download) {
  let pending;
  try {
    pending = Promise.resolve(recordDownload(query, download));
  } catch (error) {
    pending = Promise.reject(error);
  }
  return pending.catch((error) => {
    console.error('❌ Paper download not logged', {
      paperId: download && download.paperId,
      artifact: download && download.artifact,
      via: download && download.via,
      error: error && error.message,
    });
    return { recorded: false, reason: 'error' };
  });
}

module.exports = { ARTIFACTS, VIAS, DEDUPE_MINUTES, recordDownload, logDownload };
