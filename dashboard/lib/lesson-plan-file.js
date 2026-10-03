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
 *   - Only https to the lesson plan bucket is fetched (see "WHICH URLS ARE STORAGE" below), with
 *     no credentials in the URL and no redirects followed.
 *   - The body is streamed, never buffered, and anything far larger than a lesson plan is refused.
 *
 * WHICH URLS ARE STORAGE (bd-5rz1v.22). Derived from this service's own R2_ENDPOINT and
 * R2_BUCKET_NAME — the same two variables the bot signs with, set to the same values on the bot
 * and the portal in every environment (Railway, 3 Oct 2026: one endpoint host; bucket
 * digital-coach-audio on production and staging, rumi-sandbox on sandbox). An S3-style link to
 * one object in one bucket has exactly two forms, and both are accepted:
 *   virtual-hosted  https://<bucket>.<endpoint host>/<key>   ← what the bot's S3 client signs.
 *                   Axiom, 3 Oct 2026: 20,984 presigns on production in 7 days and every one is
 *                   digital-coach-audio.<account>.r2.cloudflarestorage.com; sandbox's are all
 *                   rumi-sandbox.<account>.r2.cloudflarestorage.com.
 *   path-style      https://<endpoint host>/<bucket>/<key>   ← what a client with forcePathStyle
 *                   signs (the portal's own S3 client is one).
 * Anything else is refused: another bucket on the same account, another R2 account, a look-alike
 * host, and everything when either variable is unset. The first version accepted the endpoint
 * host or ANY single-label *.r2.cloudflarestorage.com host — so it refused every lesson plan the
 * bot signs (502, and the viewer fell back to another app) while accepting any R2 account's host.
 */

const { Readable } = require('stream');

/** Lesson plans are 0.2-2 MB (measured: a grade 4 plan 1.9 MB, a grade 6 plan 0.2 MB). */
const MAX_LESSON_PLAN_BYTES = 60 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
/**
 * The lesson plan bucket as this environment configures it, or null when it is not configured
 * (then nothing is storage, and the viewer falls back to the presigned link as before).
 * Read on every call, not at load, so the value is always the service's current env.
 */
function configuredStorage() {
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim().toLowerCase();
  if (!process.env.R2_ENDPOINT || !bucket) return null;
  try {
    const host = new URL(process.env.R2_ENDPOINT).hostname.toLowerCase();
    return host ? { host, bucket } : null;
  } catch {
    return null;
  }
}

/** True only for an https URL to an object in the configured lesson plan bucket. */
function isLessonPlanStorageUrl(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  const storage = configuredStorage();
  if (!storage) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  // Virtual-hosted: the bucket is the only label in front of the endpoint host.
  if (host === `${storage.bucket}.${storage.host}`) return true;
  // Path-style: the endpoint host itself, and the bucket is the first path segment.
  return host === storage.host && url.pathname.startsWith(`/${storage.bucket}/`);
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
