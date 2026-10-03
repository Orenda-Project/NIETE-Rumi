/**
 * bd-5rz1v.10 — relay a lesson plan PDF from storage to the portal, from the portal's own origin.
 *
 * WHY THIS EXISTS. The portal now shows lesson plans in its own viewer (pdf.js) instead of
 * handing a presigned R2 link to another app — in the Android app that hand-off put the portal
 * in the background, where Android silences the microphone of a lesson being recorded. A viewer
 * has to READ the bytes from the page, and a cross-origin read only works where the bucket's
 * CORS names the page's origin. Measured 2026-10-03 on the production bucket: it allows the
 * production portal, https://localhost and the staging portal, and refuses the sandbox portal.
 * Bucket CORS is not changed from here, and a new portal host must not quietly break lesson
 * plans, so the bytes come through the portal's server instead.
 *
 * WHAT KEEPS IT FROM BEING AN OPEN PROXY.
 *   - The URL is never the caller's: the routes get it from the same bot lookup that mints
 *     today's links, for the signed-in teacher.
 *   - Only https to the lesson plan storage host (the configured R2 endpoint, or an R2 account
 *     host) is fetched, with no credentials in the URL and no redirects followed.
 *   - The body is streamed, never buffered, and anything far larger than a lesson plan is refused.
 */

const { Readable } = require('stream');

/** Lesson plans are 0.2-2 MB (measured: a grade 4 plan 1.9 MB, a grade 6 plan 0.2 MB). */
const MAX_LESSON_PLAN_BYTES = 60 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const R2_ACCOUNT_HOST = /^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/;

function configuredStorageHost() {
  try {
    return process.env.R2_ENDPOINT ? new URL(process.env.R2_ENDPOINT).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** True only for an https URL on the lesson plan storage host. */
function isLessonPlanStorageUrl(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === configuredStorageHost() || R2_ACCOUNT_HOST.test(host);
}

function refuse(res, status, error) {
  if (!res.headersSent) res.status(status).json({ success: false, error });
  return undefined;
}

/**
 * Fetch `url` from storage and stream it into `res` as a PDF.
 * Answers 502 (refused host, storage error), 413 (too large) or 504 (timeout) itself.
 */
async function relayLessonPlanPdf(url, res, { fetchImpl = globalThis.fetch } = {}) {
  if (!isLessonPlanStorageUrl(url)) {
    console.error('❌ Lesson plan relay refused a non-storage URL', { host: (() => { try { return new URL(url).hostname; } catch { return null; } })() });
    return refuse(res, 502, 'Lesson plan storage refused');
  }

  let upstream;
  try {
    upstream = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    console.error('❌ Lesson plan relay could not reach storage', { error: error?.message });
    return refuse(res, timedOut ? 504 : 502, 'Could not load this lesson plan');
  }

  if (upstream.status !== 200 || !upstream.body) {
    try { await upstream.body?.cancel(); } catch { /* nothing to drain */ }
    console.error('❌ Lesson plan relay: storage answered', { status: upstream.status });
    return refuse(res, 502, 'Could not load this lesson plan');
  }

  const length = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_LESSON_PLAN_BYTES) {
    try { await upstream.body.cancel(); } catch { /* nothing to drain */ }
    return refuse(res, 413, 'That file is too large to open here');
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  if (Number.isFinite(length) && length > 0) res.setHeader('Content-Length', String(length));
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  await new Promise((resolve) => {
    let sent = 0;
    const body = Readable.fromWeb(upstream.body);
    body.on('data', (chunk) => {
      sent += chunk.length;
      // No length header to check up front: stop a runaway body here instead.
      if (sent > MAX_LESSON_PLAN_BYTES) body.destroy(new Error('lesson plan too large'));
    });
    body.on('error', (error) => {
      console.error('❌ Lesson plan relay stream failed', { error: error?.message });
      res.destroy(error);
      resolve();
    });
    res.on('finish', resolve);
    res.on('close', resolve);
    body.pipe(res);
  });
  return undefined;
}

module.exports = { isLessonPlanStorageUrl, relayLessonPlanPdf, MAX_LESSON_PLAN_BYTES };
