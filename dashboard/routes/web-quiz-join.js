/**
 * A child joins on their own, at the edge (switch quiz_student_join, decided by the bot; OFF by default).
 *
 *   GET  /quiz/join/:token     the ONE join screen: "Which class are you in?" (chips 1–5) and "What should Jugnu call
 *                              you?", then "Let's go!". Rendered here at once, never waiting on the bot (the first
 *                              byte never waits on the database): the token is only READ for its language and
 *                              practice flag; the bot verifies it on every POST.
 *   POST /api/wq/join/grade    {t, grade, device_ref}   → the bot's /api/internal/wq/join/grade (join_grade + the
 *                              home's warm list, fired on the grade tap, before the name is typed)
 *   POST /api/wq/join          {t, grade, name, device_ref, same?, force?} → the bot's /api/internal/wq/join (the write)
 *
 * The page carries no phone, no school, no test word and no "register"; the name the child types goes in a POST body
 * only, never a URL. The device_ref rides in the body and is forwarded as x-wq-device.
 */

// A signed j token (bot web-quiz-student-join.js signJoin): base64url payload "." 22-char signature.
const JOIN_TOKEN_RX = /^[A-Za-z0-9_-]{16,700}\.[A-Za-z0-9_-]{22}$/;
const DEVICE_RX = /^[A-Za-z0-9_-]{22}$/;
const CHIP_RX = /^[0-9a-f]{16}$/;
// The home's long-cached assets the grade tap warms (the bot names the same list: HOME_ASSETS).
const WARM = ['/wq/hub.js', '/wq/wq.css', '/wq/hub-play.js', '/wq/wq-tel.js'];

// COPY_FTUE §3 (signed in COPY_FTUE_UR_READ §3, FIX rows applied); the REAL strings reused are named beside each.
const COPY = {
  en: {
    title: 'Jugnu',
    h: 'Which class are you in?',
    grades: ['1', '2', '3', '4', '5'],
    name: 'What should Jugnu call you?',
    hint: 'Just your first name',
    go: "Let's go!",
    later: 'Your teacher can add you to the class later.',
    // wq-bind.js noticeSave / noticeStopPhoneOnly (REAL, signed): what is kept, until when, how to remove it
    notice: "Jugnu will save this phone number with your name until the end of the school year (31 March), longer only if you keep playing.",
    stop: 'A grown-up can remove this phone number any time by sending STOP on WhatsApp.',
    // wq.js isYou / yesMe / diff (REAL)
    isYou: (n) => `Are you ${n}?`, yesMe: "Yes, it's me", diff: (n) => `I'm a different ${n}`,
    full: 'This phone already has 4 children. Open it and choose who is playing.',
    open: 'Open',
    teacher: "This is a teacher's phone, so nothing is saved here. Play anyway!",
    practice: 'Practice: nothing is saved on this phone',
    // fd.sub / fd.none (onboard COPY C, signed): the switch-off words
    off: 'Open the link your teacher sent to the class group, or type the code written on it.',
    offNone: 'No class link yet? Ask your teacher.',
    stale: 'This link has expired. For a new one, send “quiz” in the chat.',   // mk.stale (signed)
    error: "That didn't work. Try again in a moment.",                        // mk.error (signed)
    wait: 'Opening…',
  },
  ur: {
    title: 'جگنو',
    h: 'آپ کس جماعت میں ہیں؟',
    grades: ['۱', '۲', '۳', '۴', '۵'],
    name: 'جگنو آپ کو کیا کہہ کر بلائے؟',
    hint: 'بس اپنا پہلا نام لکھیں',
    go: 'چلو شروع کریں!',
    later: 'کلاس میں شامل کرنا ٹیچر کا کام ہے، وہ بعد میں ہو جائے گا۔',
    notice: 'جگنو اس فون نمبر کو آپ کے نام کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔',
    stop: 'گھر کے بڑے کسی بھی وقت واٹس ایپ پر ⁦STOP⁩ بھیج کر یہ نمبر ہٹا سکتے ہیں۔',
    isYou: (n) => `کیا آپ ${n} ہیں؟`, yesMe: 'جی ہاں، یہ میں ہوں', diff: (n) => `میں کوئی اور ${n} ہوں`,
    full: 'اس فون پر پہلے ہی ۴ بچے ہیں۔ کھولیں اور چنیں کہ کون کھیل رہا ہے۔',
    open: 'کھولیں',
    teacher: 'یہ ٹیچر کا فون ہے، اس لیے یہاں کچھ محفوظ نہیں ہوگا۔ پھر بھی کھیلیں!',
    practice: 'مشق: اس فون پر کچھ محفوظ نہیں ہوگا',
    off: 'ٹیچر نے کلاس گروپ میں جو لنک بھیجا ہے وہ کھولیں، یا اُس پیغام میں لکھا کوڈ یہاں لکھیں۔',
    offNone: 'ابھی لنک نہیں ملا؟ اپنے ٹیچر سے پوچھیں۔',
    stale: 'اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔',
    error: 'یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    wait: 'کھل رہا ہے…',
  },
};

/** The token's payload, READ (not verified: display only — the bot verifies on every POST). null when not a j token. */
function peekToken(token) {
  if (typeof token !== 'string' || !JOIN_TOKEN_RX.test(token)) return null;
  try {
    const p = JSON.parse(Buffer.from(token.slice(0, token.indexOf('.')), 'base64url').toString('utf8'));
    return p && p.k === 'j' ? { lang: p.l === 'ur' ? 'ur' : 'en', practice: p.m === 'practice' } : null;
  } catch (_) {
    return null;
  }
}

// ≤ 2 KB of CSS, inline: the page needs no stylesheet, no web font and no image but Jugnu's (already long-cached).
const CSS = `*{box-sizing:border-box}html,body{margin:0;background:#fff8ec;color:#2b2118;font:18px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Nastaliq Urdu","Noto Naskh Arabic",sans-serif}
main{max-width:480px;margin:0 auto;padding:16px 16px 32px}.jg{display:block;margin:4px auto 8px;width:96px;height:96px}
h1{font-size:24px;margin:8px 0 12px;text-align:center}.chips{display:flex;gap:8px;justify-content:center;margin:0 0 20px;padding:0;list-style:none}
.chip{min-width:56px;height:56px;border-radius:16px;border:2px solid #e3c48a;background:#fff;font-size:24px;font-weight:700;color:#2b2118}
.chip[aria-pressed=true]{background:#ffb703;border-color:#e08e00}label{display:block;font-size:20px;font-weight:700;margin:4px 0 6px}
input{width:100%;height:56px;border-radius:14px;border:2px solid #e3c48a;padding:0 14px;font-size:22px;background:#fff}
.hint,.small{font-size:16px;color:#6b5a48;margin:6px 0 0}.go{display:block;width:100%;height:60px;margin:20px 0 12px;border:0;border-radius:18px;background:#2a9d8f;color:#fff;font-size:22px;font-weight:700}
.go:disabled{background:#b9c9c6}.note{font-size:15px;color:#6b5a48;margin:10px 0 0}.line{background:#fff;border-radius:14px;padding:12px 14px;margin:12px 0;font-size:18px}
.pick{display:block;width:100%;min-height:56px;margin:8px 0;border-radius:14px;border:2px solid #e3c48a;background:#fff;font-size:20px}
[dir=rtl] body,[dir=rtl] main{text-align:right}[dir=rtl] h1{text-align:center}bdi{unicode-bidi:isolate}`;

function renderJoinPage({ token, lang, practice, assetV, jsV, esc, bootJson }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const c = COPY[l];
  const dir = l === 'ur' ? 'rtl' : 'ltr';
  const boot = { view: 'join', t: token, lang: l, practice: Boolean(practice), v: assetV, warm: WARM, copy: {
    isYou: c.isYou('{n}'), yesMe: c.yesMe, diff: c.diff('{n}'), full: c.full, open: c.open, teacher: c.teacher,
    off: c.off, offNone: c.offNone, stale: c.stale, error: c.error, wait: c.wait,
  } };
  const chips = c.grades.map((g, i) => `<li><button type="button" class="chip" data-tap="grade" data-grade="${i + 1}" aria-pressed="false">${esc(g)}</button></li>`).join('');
  return `<!doctype html>
<html lang="${l}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin">
<title>${esc(c.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main id="jn" data-screen="join">
<img class="jg" src="/wq/jugnu/hello.webp" alt="" width="96" height="96">
${practice ? `<p class="line">${esc(c.practice)}</p>` : ''}
<h1 id="jn-h">${esc(c.h)}</h1>
<ul class="chips" role="group" aria-labelledby="jn-h">${chips}</ul>
<label for="jn-name">${esc(c.name)}</label>
<input id="jn-name" name="first" type="text" maxlength="20" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="go">
<p class="hint">${esc(c.hint)}</p>
<button type="button" class="go" id="jn-go" data-primary data-tap="go" disabled>${esc(c.go)}</button>
<div id="jn-out" aria-live="polite"></div>
${practice ? '' : `<p class="note">${esc(c.notice)} ${esc(c.stop).replace('STOP', '<bdi dir="ltr">STOP</bdi>')}</p>
<p class="note">${esc(c.later)}</p>`}
</main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/join.js?v=${esc(jsV || assetV)}" defer></script>
</body>
</html>`;
}

function cleanBody(b, withName) {
  const body = b && typeof b === 'object' ? b : {};
  const out = {};
  if (typeof body.t !== 'string' || !JOIN_TOKEN_RX.test(body.t)) return null;
  out.t = body.t;
  const g = Number(body.grade);
  if (!(Number.isInteger(g) && g >= 1 && g <= 5)) return null;
  out.grade = g;
  if (withName) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 40) return null;
    out.name = body.name;
    if (typeof body.same === 'string' && CHIP_RX.test(body.same)) out.same = body.same;
    if (body.force === true) out.force = true;
  }
  return out;
}

/**
 * Registers the join's routes on the web quiz router (called once from createWebQuizRouter, before its /api/wq/*
 * catch-all).
 * @param {object} d  callBot, limiters, jsonBody, noStore, configured, ready(), pageHeaders, version, jsVersion, esc, bootJson,
 *                    closedPage(req, res, status, kind)
 */
function registerJoin(router, d) {
  const forward = (step, withName) => async (req, res) => {
    const body = cleanBody(req.body, withName);
    if (!body) return res.status(400).json({ error: 'bad_request' });
    const device = typeof (req.body || {}).device_ref === 'string' && DEVICE_RX.test(req.body.device_ref) ? req.body.device_ref : null;
    try {
      const route = `/api/internal/wq/join${step}`;
      const out = await d.callBot('POST', route, req, body, { route, device });
      if (out.status >= 500 && out.status !== 503) return res.status(502).json({ error: 'upstream_error' });
      return res.status(out.status).json(out.body == null ? {} : out.body);
    } catch (_) {
      return res.status(502).json({ error: 'bot_unreachable' });
    }
  };
  router.post('/api/wq/join/grade', d.noStore, d.configured, d.jsonBody, d.limiters.read, forward('/grade', false));
  router.post('/api/wq/join', d.noStore, d.configured, d.jsonBody, d.limiters.session, forward('', true));

  router.get('/quiz/join/:token', d.limiters.read, (req, res) => {
    d.pageHeaders(res);
    res.set('Cache-Control', 'no-store');
    const token = String(req.params.token || '');
    const seen = peekToken(token);
    if (!seen) return d.closedPage(req, res, 404, 'closed');
    if (!d.ready()) return d.closedPage(req, res, 503, 'off');
    return res.status(200).type('html').send(renderJoinPage({ token, lang: seen.lang, practice: seen.practice, assetV: d.version(), jsV: d.jsVersion(), esc: d.esc, bootJson: d.bootJson }));
  });
}

module.exports = { registerJoin, renderJoinPage, peekToken, cleanBody, COPY, WARM, JOIN_TOKEN_RX };
