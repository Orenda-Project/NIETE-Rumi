/**
 * bd-4r3rei — an app page address with no ids and nothing a person typed, for the funnel.
 *
 *   '/portal/coach/visit/12345/record?x=1#y'  →  '/portal/coach/visit/:id/record'
 *
 * Query and fragment are dropped; a segment that is not a plain lower-case word (digits, dots, %, ':', over 24
 * characters) becomes ':id'. Null when it is not a portal page at all. The server applies the SAME rule again to
 * whatever it is sent (bot/shared/services/app-journey.js normaliseRoute — the browser is not trusted); a Jest
 * parity test (tests/app-funnel/route-parity.test.js) keeps the two identical.
 *
 * CommonJS with no imports, like app-target.cjs: testable under the repo's Jest runner and consumable by Vite.
 */
const MAX_RAW = 200;
const MAX_SEGMENTS = 8;
const WORD = /^[a-z]+(?:-[a-z]+)*$/;
/** Pages that are signed-out or public: never reported (there is no session to attribute them to). */
const UNTRACKED = new Set(['login', 'setup', 'reset-password', 'delete-account', 'privacy']);

function normaliseRoute(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_RAW) return null;
  if (raw[0] !== '/' || raw.startsWith('//')) return null;
  const path = raw.split('#')[0].split('?')[0];
  const segs = path.toLowerCase().split('/').filter(Boolean);
  if (segs[0] !== 'portal' || segs.length > MAX_SEGMENTS) return null;
  const out = segs.map((s, i) => (i === 0 || (s.length <= 24 && WORD.test(s)) ? s : ':id'));
  return `/${out.join('/')}`;
}

/** Is this a page the funnel reports? A portal page, but not sign-in, setup, password reset, account deletion or privacy. */
function shouldTrack(path) {
  const route = normaliseRoute(path);
  if (!route) return false;
  const second = route.split('/')[2];
  return !UNTRACKED.has(second);
}

module.exports = { normaliseRoute, shouldTrack };
