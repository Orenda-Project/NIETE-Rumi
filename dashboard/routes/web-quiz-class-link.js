/**
 * The standing class link at the edge (switch web_quiz_class_link, decided by the bot; OFF by default).
 *
 *   GET  /j/:code            the landing: a generic preview (og.link.* only: no class, school, teacher or child
 *                            name, no digit) and a shell; class-link.js asks the bot for each step
 *   POST /api/wq/cl/arrive   {code, device_ref, jt?}  forwarded to the bot's /api/internal/wq/cl/arrive
 *   POST /api/wq/cl/teacher  {code, s, tk}
 *   POST /api/wq/cl/letter   {code, s, letter}
 *   POST /api/wq/cl/pick     {code, s, chip, device_ref}
 *
 * The edge never touches the database and never sees the class list: the page holds no child before the gate.
 * A malformed code, or a code the bot does not answer (switch off, parent off, unknown, revoked, expired), gets
 * EXACTLY the page an unknown /q/ code gets today (the closed page, 404). The device_ref rides in the body only.
 */

// The code alphabet (bot web-quiz-class-link.js): no I, O, 0 or 1.
const CL_CODE_RX = /^[A-HJ-NP-Z2-9]{8,16}$/;
// The teacher card's own link carries a signed preview token (?t=): the visit plays as practice.
const JT_RX = /^[A-Za-z0-9_-]{8,600}\.[A-Za-z0-9_-]{22}$/;
const STEPS = ['arrive', 'teacher', 'letter', 'pick'];

// og.link.title / og.link.desc (copy.v2.json) — the preview carries nothing else.
const OG = {
  en: { title: "Jugnu's Challenge", desc: 'Stories and number games. Tap to play.' },
  ur: { title: 'جگنو کا چیلنج', desc: 'کہانیاں اور گنتی کے کھیل۔ کھیلنے کے لیے دبائیں۔' },
};
const BOOT_SAY = { en: 'Opening…', ur: 'کھل رہا ہے…' };

function renderClassLinkPage({ lang, code, jt, origin, assetV, jsV, brand, ui, head, esc, bootJson, preview = false }) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const og = OG[l];
  // og:url is the origin, never the code: the preview carries no digit.
  const top = `${head({ lang: l, dir: l === 'ur' ? 'rtl' : 'ltr', title: og.title, desc: og.desc, origin, url: origin, assetV, brand, ui })}
</head>`;
  if (preview) return `${top}\n<body></body>\n</html>`;
  const boot = { view: 'class_link', code, lang: l };
  if (jt) boot.jt = jt;
  return `${top}
<body>
<main id="wq" class="wq-app" aria-live="polite"><div class="wq-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p class="wq-bootsay">${esc(BOOT_SAY[l])}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/class-link.js?v=${jsV || assetV}" defer></script>
</body>
</html>`;
}

/**
 * Registers the class link's routes on the web quiz router. Called once from createWebQuizRouter, before its
 * /api/wq/* catch-all.
 * @param {import('express').Router} router
 * @param {object} d  the router's own helpers: callBot, limiters, unknownCode, jsonBody, noStore, configured,
 *                    ready(), pageHeaders, originOf, version, jsVersion, closedPage(req, res, status, kind), brand(), ui(), and the
 *                    page helpers head, esc, bootJson, isPreviewFetch
 */
function registerClassLink(router, d) {
  for (const step of STEPS) {
    const limiter = step === 'pick' ? d.limiters.session : d.limiters.read;
    router.post(`/api/wq/cl/${step}`, d.noStore, d.configured, d.jsonBody, limiter, async (req, res) => {
      try {
        const out = await d.callBot('POST', `/api/internal/wq/cl/${step}`, req, req.body, { route: `/api/internal/wq/cl/${step}` });
        if (out.status >= 500 && out.status !== 503) return res.status(502).json({ error: 'upstream_error' });
        return res.status(out.status).json(out.body == null ? {} : out.body);
      } catch (_) {
        return res.status(502).json({ error: 'bot_unreachable' });
      }
    });
  }

  router.get('/j/:code', d.limiters.read, d.unknownCode, async (req, res) => {
    d.pageHeaders(res);
    const origin = d.originOf(req);
    const code = String(req.params.code || '');
    if (!CL_CODE_RX.test(code)) return d.closedPage(req, res, 404, 'closed');
    if (!d.ready()) return d.closedPage(req, res, 503, 'off');
    const preview = d.isPreviewFetch(req);
    let out;
    try {
      out = await d.callBot('GET', `/api/internal/wq/cl/${code}${preview ? '?pv=1' : ''}`, req, null, { route: '/api/internal/wq/cl/:code' });
    } catch (_) {
      return d.closedPage(req, res, 502, 'off');
    }
    if (out.status !== 200 || !out.body) {
      // Off, unknown, revoked, expired: exactly an unknown /q/ code's page.
      return d.closedPage(req, res, out.status === 404 || out.status === 410 ? 404 : 502, out.status === 404 || out.status === 410 ? 'closed' : 'off');
    }
    const jt = typeof req.query.t === 'string' && JT_RX.test(req.query.t) ? req.query.t : null;
    return res.status(200).type('html').send(renderClassLinkPage({
      lang: out.body.lang, code, jt, origin, assetV: d.version(), jsV: d.jsVersion(), brand: d.brand(), ui: d.ui(),
      head: d.head, esc: d.esc, bootJson: d.bootJson, preview,
    }));
  });
}

module.exports = { registerClassLink, renderClassLinkPage, CL_CODE_RX, OG };
