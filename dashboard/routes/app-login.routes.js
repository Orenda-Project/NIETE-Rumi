/**
 * The one-tap app login — bd-fmf24g.35.
 *
 *   GET /go/:token   genuine, unexpired, for a teacher who exists → a NEW portal session for her (regenerated,
 *                    exactly as the password login does; the WHOLE app, no area scope), then the page for what she
 *                    asked for (bot/shared/services/app-login-link.js LANDINGS). Re-tappable for 24 h.
 *                    Anything else → the en/ur "get a new link" page and no session.
 *   GET /go          the same page.
 *
 * The bot sends this link (as a cta_url button) only to a pilot teacher on the teacher app. If she is no longer
 * on it by the time she taps, she is still signed in and lands on today's dashboard, never on a page she cannot
 * open. The path is outside the Android app's link list, so WhatsApp opens it in its own browser. The token is
 * the credential: it is never logged, and the response is no-store. Rate limited per IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAppLink, LANDINGS, LEGACY_LANDING } = require('../../bot/shared/services/app-login-link');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

// Teacher-facing, both languages at once: with no genuine token we do not know hers.
const COPY = {
  en: {
    title: 'This link has expired',
    body: 'Links last 24 hours. Go back to WhatsApp and send /menu. We will send you a new link.',
  },
  ur: {
    title: 'یہ لنک ختم ہو چکا ہے',
    body: 'لنک 24 گھنٹے تک چلتا ہے۔ واٹس ایپ پر واپس جائیں اور /menu بھیجیں۔ ہم آپ کو نیا لنک بھیج دیں گے۔',
  },
};

function renderNewLinkPage() {
  const { en, ur } = COPY;
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

function log(props) {
  try { telemetry.logEvent('app_link.open', props); } catch (_) { /* logging never decides the response */ }
  if (props && props.outcome === 'error') console.error('app link: could not open a session', props);
}

async function defaultFindUser(id) {
  const supabase = require('../config/supabase');
  const { data, error } = await supabase.from('users').select('id, name').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || 'users lookup failed');
  return data || null;
}

async function defaultIsTeacherV2(userId) {
  const supabase = require('../config/supabase');
  const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
  return isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, userId);
}

function createAppLoginRouter({ findUser = defaultFindUser, isTeacherV2 = defaultIsTeacherV2, limiter } = {}) {
  const router = express.Router();
  // Per IP; a teacher taps a link a handful of times, never 60 times a minute. (Mobile carriers share IPs, so not tighter.)
  const limit = limiter || rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: 'Too many requests. Please try again later.',
  });

  const newLink = (req, res, outcome, extra = {}) => {
    log({ outcome, ...extra });
    res.set('Cache-Control', 'no-store');
    res.status(200).type('html').send(renderNewLinkPage());
  };

  router.get('/go', limit, (req, res) => newLink(req, res, 'invalid'));

  router.get('/go/:token', limit, async (req, res) => {
    const payload = verifyAppLink(req.params.token);
    if (!payload) return newLink(req, res, 'invalid');

    let user = null;
    try {
      user = await findUser(payload.u);
    } catch (err) {
      return newLink(req, res, 'error', { feature: payload.f, userId: payload.u, err: String(err && err.message).slice(0, 120) });
    }
    if (!user || !user.id) return newLink(req, res, 'unknown_user', { feature: payload.f, userId: payload.u });

    let onApp = false;
    try { onApp = Boolean(await isTeacherV2(user.id)); } catch (_) { onApp = false; }
    const landing = onApp ? LANDINGS[payload.f] : LEGACY_LANDING;

    // A new session id, never the one the browser arrived with (session fixation). No portalScope: the whole app.
    req.session.regenerate((err) => {
      if (err) return newLink(req, res, 'error', { feature: payload.f, userId: user.id, err: 'session_regenerate' });
      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;
      req.session.portalUserName = user.name;
      req.session.save((saveErr) => {
        if (saveErr) return newLink(req, res, 'error', { feature: payload.f, userId: user.id, err: 'session_save' });
        log({ outcome: 'ok', feature: payload.f, userId: user.id, v2: onApp });
        res.set('Cache-Control', 'no-store');
        return res.redirect(303, landing);
      });
    });
  });

  return router;
}

module.exports = { createAppLoginRouter };
