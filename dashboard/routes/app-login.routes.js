/**
 * The one-tap app login — bd-fmf24g.35.
 *
 *   GET /go/:token   genuine, unexpired, for a teacher who exists → a NEW portal session for her (regenerated,
 *                    exactly as the password login does; the WHOLE app, no area scope), then the page for what she
 *                    asked for (bot/shared/services/app-login-link.js LANDINGS). Re-tappable for 24 h.
 *                    Anything else → the en/ur "get a new link" page and no session.
 *   GET /go          the same page.
 *
 * The bot sends this link (as a cta_url button) only to a teacher on the teacher app, or (bd-fmf24g.52) a pilot coach
 * on the coach app, whose token lands on the coach app (COACH_LANDINGS), or (bd-a73p5m) a leader asking for lesson
 * plans, whose token lands on the Lesson Plans tab (LEADER_LANDINGS) whatever the app flags say. If she is no longer
 * on it by the time she taps, she is still signed in and lands on today's dashboard, never on a page she cannot
 * open. The path is outside the Android app's link list, so WhatsApp opens it in its own browser. The token is
 * the credential: it is never logged, and the response is no-store. Rate limited per IP (60 a minute).
 */
const express = require('express');
const { verifyAppLink, leaderPathFor, landingQuery, LANDINGS, COACH_LANDINGS, LEGACY_LANDING } = require('../../bot/shared/services/app-login-link');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

// Teacher-facing, both languages at once: with no genuine token we do not know hers.
// bd-x7aprz.3: the page hands her a NEW link in one tap — a button that opens THIS deployment's bot with /portal typed
// (the bot answers /portal with a fresh signed link). It used to say "send /menu", which opens the menu, not a link.
const COPY = {
  en: {
    title: 'This link has expired',
    body: 'Links last 24 hours. Tap below and send the message: we will reply with a new link.',
    // No bot number configured on this deployment: no button, so the words carry the whole instruction.
    bodyNoButton: 'Links last 24 hours. Go back to WhatsApp and send /portal. We will send you a new link.',
    button: 'Get a new link',
  },
  ur: {
    title: 'یہ لنک ختم ہو چکا ہے',
    body: 'لنک ۲۴ گھنٹے تک چلتا ہے۔ نیچے ٹیپ کریں اور پیغام بھیجیں: ہم آپ کو نیا لنک بھیج دیں گے۔',
    bodyNoButton: 'لنک ۲۴ گھنٹے تک چلتا ہے۔ واٹس ایپ پر واپس جائیں اور \u2066/portal\u2069 بھیجیں۔ ہم آپ کو نیا لنک بھیج دیں گے۔',
    button: 'نیا لنک لیں',
  },
};

/**
 * This deployment's own WhatsApp number, digits only, or null. WHATSAPP_BOT_NUMBER first, then REFERRAL_BOT_NUMBER
 * (already on every service — the same order the bot's share links use). No fallback to another number: a sandbox
 * page that opened the production bot would hand a tester a production link. Read at call time.
 */
function botNumber() {
  const digits = String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/** The chat with THIS deployment's bot with `text` already typed, or null with no bot number configured. */
function waMeLink(text) {
  const n = botNumber();
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** The chat with this bot, /portal already typed — or null with no number configured. */
function newLinkUrl() {
  return waMeLink('/portal');
}

function renderNewLinkPage() {
  const { en, ur } = COPY;
  const href = newLinkUrl();
  const button = href
    ? `<a class="btn" href="${href}"><span lang="en" dir="ltr">${en.button}</span><span class="sep" aria-hidden="true">·</span><span lang="ur" dir="rtl">${ur.button}</span></a>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${en.title}</title>
<style>
  :root { --bg:#ffffff; --fg:#333748; --muted:#5b6475; --accent:#47BA7D; --card:#f3f6f4; --on-accent:#ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --fg:#eceef3; --muted:#a6adbb; --card:#1d2129; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:480px; margin:0 auto; }
  section { background:var(--card); border-radius:16px; padding:20px; margin:0 0 16px; border-top:4px solid var(--accent); }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:var(--muted); }
  [lang="ur"] { font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif; line-height:2.1; }
  .btn { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; min-height:56px; padding:12px 20px; margin:0 0 16px;
         border-radius:999px; background:var(--accent); color:var(--on-accent); font-weight:700; text-decoration:none; }
  .btn [lang="ur"] { line-height:1.6; }
</style>
</head>
<body>
<main>
<section lang="en" dir="ltr"><h1>${en.title}</h1><p>${href ? en.body : en.bodyNoButton}</p></section>
<section lang="ur" dir="rtl"><h1>${ur.title}</h1><p>${href ? ur.body : ur.bodyNoButton}</p></section>
${button}
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
  const { data, error } = await supabase.from('users').select('id, name, deleted_at').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || 'users lookup failed');
  return data || null;
}

async function defaultIsTeacherV2(userId) {
  const supabase = require('../config/supabase');
  const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
  return isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, userId);
}

/** bd-fmf24g.52 — on the coach app: portal_coach_v2 for them AND role coach (dashboard/lib/feature-flags.js). */
async function defaultIsCoachApp(userId) {
  const supabase = require('../config/supabase');
  const { isCoachAppUser } = require('../lib/feature-flags');
  return isCoachAppUser(supabase, userId);
}

/** A fixed-window per-IP limiter with no dependency (the root test install has no express-rate-limit). */
function createLimiter({ windowMs = 60 * 1000, max = 60 } = {}) {
  const hits = new Map(); // ip -> { n, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let h = hits.get(ip);
    if (!h || h.resetAt <= now) { h = { n: 0, resetAt: now + windowMs }; hits.set(ip, h); }
    h.n += 1;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      return res.status(429).type('text').send('Too many requests. Please try again later.');
    }
    return next();
  };
}

function createAppLoginRouter({
  findUser = defaultFindUser, isTeacherV2 = defaultIsTeacherV2, isCoachApp = defaultIsCoachApp, limiter,
} = {}) {
  const router = express.Router();
  // Per IP; a teacher taps a link a handful of times, never 60 times a minute. (Mobile carriers share IPs, so not tighter.)
  const limit = limiter || createLimiter();

  const newLink = (req, res, outcome, extra = {}) => {
    log({ outcome, ...extra });
    res.set('Cache-Control', 'no-store');
    res.status(200).type('html').send(renderNewLinkPage());
  };

  router.get('/go', limit, (req, res) => newLink(req, res, 'invalid'));

  router.get('/go/:token', limit, async (req, res) => {
    const payload = verifyAppLink(req.params.token);
    if (!payload) return newLink(req, res, 'invalid');
    // bd-4r3rei — the journey the bot minted when it sent this link (null for a link sent before it existed). Every
    // row from here on carries it, so the open joins the WhatsApp message and the pages that follow.
    const journeyId = payload.j || null;

    let user = null;
    try {
      user = await findUser(payload.u);
    } catch (err) {
      return newLink(req, res, 'error', { feature: payload.f, userId: payload.u, journeyId, err: String(err && err.message).slice(0, 120) });
    }
    if (!user || !user.id) return newLink(req, res, 'unknown_user', { feature: payload.f, userId: payload.u, journeyId });
    // bd-x7aprz.3: a link minted before the account was deleted signs nobody in.
    if (user.deleted_at) return newLink(req, res, 'deleted_user', { feature: payload.f, userId: payload.u, journeyId });

    // bd-fmf24g.52 — a coach token (coach_menu, coach_observe) asks the coach-app question and lands on a coach page;
    // a teacher token asks the teacher-app question, exactly as before. Either way, off the app → today's dashboard.
    const coach = Object.prototype.hasOwnProperty.call(COACH_LANDINGS, payload.f);
    let onApp = false;
    // bd-a73p5m: a leader token lands on the tab whatever the flags say, so it asks neither app question.
    if (!leaderPathFor(payload.f)) {
      try { onApp = Boolean(await (coach ? isCoachApp(user.id) : isTeacherV2(user.id))); } catch (_) { onApp = false; }
    }
    // An FLN target and (bd-a73p5m) a leader's Lesson Plans tab land as they are: their pages decide who reads them.
    const landing = require('../../bot/shared/services/fln-go-target').flnPathFor(payload.f) || leaderPathFor(payload.f)
      || (onApp ? (coach ? COACH_LANDINGS : LANDINGS)[payload.f] + landingQuery(payload) : LEGACY_LANDING);

    // A new session id, never the one the browser arrived with (session fixation). No portalScope: the whole app.
    req.session.regenerate((err) => {
      if (err) return newLink(req, res, 'error', { feature: payload.f, userId: user.id, journeyId, err: 'session_regenerate' });
      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;
      req.session.portalUserName = user.name;
      // The session carries the journey (and when it began) so the funnel endpoint and action logger read it from the
      // server's own record — never from the browser (dashboard/routes/app-funnel.routes.js).
      if (journeyId) req.session.appJourney = { id: journeyId, at: Date.now(), feature: payload.f };
      req.session.save((saveErr) => {
        if (saveErr) return newLink(req, res, 'error', { feature: payload.f, userId: user.id, journeyId, err: 'session_save' });
        log({ outcome: 'ok', feature: payload.f, userId: user.id, journeyId, v2: onApp });
        res.set('Cache-Control', 'no-store');
        return res.redirect(303, landing);
      });
    });
  });

  return router;
}

module.exports = { createAppLoginRouter, newLinkUrl, waMeLink };
