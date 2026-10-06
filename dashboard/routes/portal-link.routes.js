/**
 * A portal area on the web: the portal end of the link on a template's button.
 *
 *   GET /t/:token   genuine, unexpired, for a teacher who exists → a NEW portal
 *                   session for her (regenerated, exactly as /login does), scoped
 *                   to the area the token names, then that area's page. Anything
 *                   else → the en/ur "this link has expired" page, and no session.
 *   GET /t          the same page (where the portal app sends a link session
 *                   that has run out, instead of the password login).
 *
 *   portalLinkScope   mounted in front of every /api/portal router in index.js.
 *                     A session that came from a link reaches its own area's API
 *                     and the few reads the portal's frame needs; everything
 *                     else is 403. Whoever holds a forwarded link gets that one
 *                     area of hers — not her coaching recordings, classes or
 *                     school, and not another area. Password sessions are
 *                     untouched.
 *
 * AREAS below is the whole contract: where each area lands and what it may call.
 * The bot names the area when it signs (bot/shared/services/portal-link-token.js,
 * same key), and the portal app shows only that area's pages
 * (portal/src/portal/lib/linkSession.ts). The path sits outside the Android app's
 * link list so WhatsApp opens it in its own browser rather than the app. A GET
 * that starts a session is safe here: the token is the credential, and a
 * link-preview fetcher that follows it gets a session it never uses.
 */
const express = require('express');
const { verifyPortalLink } = require('../../bot/shared/services/portal-link-token');
// The portal's OWN sink. Never the bot's loggers: they need pino, which this service
// does not install, so a require of them throws and the event is silently lost
// (services/telemetry.service.js has the history).
const telemetry = require('../services/telemetry.service');

const prefix = (...roots) => (p) => roots.some((r) => p === r || p.startsWith(`${r}/`));

/** Each area: where the link lands, and what its session may call under /api/portal. */
const AREAS = {
  training: {
    landing: '/portal/training',
    api: [{ method: 'ANY', test: prefix('/training') }],
  },
  lessons: {
    landing: '/portal/curriculum',
    // The catalogue (grades 1-5), the grade 6-12 renders, and her own lesson plans.
    api: [
      { method: 'GET', test: prefix('/curriculum', '/lp612', '/lesson-plans') },
      { method: 'POST', test: prefix('/lp612/request') },
    ],
  },
};

/** What every link session needs for the portal's frame (who she is, flags, language, log out). */
const FRAME = [
  { method: 'GET', test: (p) => p === '/dashboard' || p === '/auth/verify' || p === '/config' || p === '/me/language' },
  { method: 'POST', test: (p) => p === '/logout' },
];

function allowed(area, method, path) {
  const spec = AREAS[area];
  if (!spec) return false;
  const m = String(method || '').toUpperCase();
  const p = String(path || '');
  return [...spec.api, ...FRAME].some((a) => (a.method === 'ANY' || a.method === m) && a.test(p));
}

function portalLinkScope(req, res, next) {
  const area = req.session && req.session.portalScope;
  if (!area) return next();
  if (allowed(area, req.method, req.path)) return next();
  return res.status(403).json({ success: false, error: 'link_area_only' });
}

// Teacher-facing, both languages at once: with no genuine token we know neither her language
// nor which area the link was for.
const EXPIRED_COPY = {
  en: {
    title: 'This link has expired',
    body: 'Go back to WhatsApp and open it again from the menu. We will send you a new link.',
  },
  ur: {
    title: 'یہ لنک ختم ہو چکا ہے',
    body: 'واٹس ایپ پر واپس جائیں اور مینو سے دوبارہ کھولیں۔ ہم آپ کو نیا لنک بھیج دیں گے۔',
  },
};

function renderExpiredPage() {
  const { en, ur } = EXPIRED_COPY;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${en.title}</title>
<style>
  :root { --bg:#ffffff; --fg:#333748; --muted:#5b6475; --accent:#47BA7D; --card:#f3f6f4; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --fg:#eceef3; --muted:#a6adbb; --card:#1d2129; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:480px; margin:0 auto; }
  section { background:var(--card); border-radius:16px; padding:20px; margin:0 0 16px; border-top:4px solid var(--accent); }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:var(--muted); }
  [lang="ur"] { font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif; line-height:2.1; }
</style>
</head>
<body>
<main>
<section lang="en" dir="ltr"><h1>${en.title}</h1><p>${en.body}</p></section>
<section lang="ur" dir="rtl"><h1>${ur.title}</h1><p>${ur.body}</p></section>
</main>
</body>
</html>`;
}

/** WhatsApp's own browser announces itself in the UA, or in X-Requested-With while Android still sends it. */
function browserFacts(req) {
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const xrw = String(req.get('x-requested-with') || '').slice(0, 80) || null;
  const iab = /WhatsApp|WA4A\/|; wv\)/.test(ua) || /^com\.whatsapp/.test(xrw || '') ? 1 : 0;
  return { ua, xrw, iab };
}

function log(props) {
  try {
    telemetry.logEvent('web_link.open', props);
  } catch (_) { /* logging never decides the response */ }
  // A failed lookup or session write is a real failure, not a stale link: the error console, so it is seen.
  if (props && props.outcome === 'error') console.error('portal link: could not open a session', props);
}

async function defaultFindUser(id) {
  const supabase = require('../config/supabase');
  const { data, error } = await supabase.from('users').select('id, name').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || 'users lookup failed');
  return data || null;
}

function createPortalLinkRouter({ findUser = defaultFindUser, verify = verifyPortalLink } = {}) {
  const router = express.Router();

  const expired = (req, res, outcome, extra = {}) => {
    log({ outcome, area: null, ...browserFacts(req), ...extra });
    res.set('Cache-Control', 'no-store');
    res.status(200).type('html').send(renderExpiredPage());
  };

  router.get('/t', (req, res) => expired(req, res, 'invalid'));

  router.get('/t/:token', async (req, res) => {
    const payload = verify(req.params.token);
    const spec = payload && AREAS[payload.area];
    if (!spec) return expired(req, res, 'invalid');
    const { area } = payload;

    let user = null;
    try {
      user = await findUser(payload.u);
    } catch (err) {
      return expired(req, res, 'error', { area, userId: payload.u, err: String(err && err.message).slice(0, 120) });
    }
    if (!user || !user.id) return expired(req, res, 'unknown_user', { area, userId: payload.u });

    // A new session id, never the one the browser arrived with (session fixation),
    // and never a password session's privileges.
    req.session.regenerate((err) => {
      if (err) return expired(req, res, 'error', { area, userId: user.id, err: 'session_regenerate' });
      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;
      req.session.portalUserName = user.name;
      req.session.portalScope = area;
      req.session.save((saveErr) => {
        if (saveErr) return expired(req, res, 'error', { area, userId: user.id, err: 'session_save' });
        log({ outcome: 'ok', area, userId: user.id, ...browserFacts(req) });
        res.set('Cache-Control', 'no-store');
        return res.redirect(303, spec.landing);
      });
    });
  });

  return router;
}

module.exports = { createPortalLinkRouter, portalLinkScope };
