/*
 * The grade-1 stop on the Challenge page: "how many dots?" (exercise `numbers`, loaded by wq-challenge.js only
 * when the served exercise is `numbers`).
 *   One item at a time: a ten-frame (2 rows of 5 cells, k dots drawn with CSS, no picture to fetch), the prompt
 *   "How many?" and three numeral tiles. One tap per item (the tiles lock after it), no timer shown, no right or
 *   wrong colour, no count and no score shown at any point. Nothing needs sound.
 *   After the last item the taps go once to the Challenge's result endpoint (ch/result, the run's `ct`), as
 *   "Which is bigger?" does, then the page's own end card.
 * The body: { ct, taps: [{ i, pick, ms }], ms } (+ helped when asked); `ms` per tap counts from the item's paint.
 * Copy: the three grade-1 lines only (en + ur). Tile numerals are Urdu digits on an Urdu page.
 */
(function () {
  'use strict';
  var COPY = {
    en: { title: 'Find the number', say: 'Count the dots. Tap the number.', how: 'How many?' },
    ur: { title: 'نمبر ڈھونڈیں', say: 'نقطے گنیں۔ پھر نمبر دبائیں۔', how: 'کتنے ہیں؟' },
  };
  var UD = '۰۱۲۳۴۵۶۷۸۹';
  var TILE_IDS = ['wq-g1-ta', 'wq-g1-tb', 'wq-g1-tc'];

  function langOf(ctx) { return ctx && ctx.L === 'ur' ? 'ur' : 'en'; }
  function copy(ctx) { return COPY[langOf(ctx)]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // a tile's numeral: Urdu digits on an Urdu page, Western otherwise
  function numeral(n, L) { var s = String(n); return L === 'ur' ? s.replace(/[0-9]/g, function (d) { return UD.charAt(+d); }) : s; }

  (function css() {
    try {
      if (document.getElementById('wq-g1-css')) return;
      var s = document.createElement('style');
      s.id = 'wq-g1-css';
      s.textContent = [
        '.wq-g1{display:grid;gap:14px}',
        '.wq-g1-title{font-size:24px;text-align:center}',
        'html[lang=ur] .wq-g1-title{font-weight:700;line-height:2}',
        'html[lang=ur] .wq-g1 .wq-say{font-size:20px}',
        'html[lang=ur] .wq-g1 .wq-btn{font-size:20px}',
        '.wq-g1-frame{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;direction:ltr;background:var(--card);border-radius:20px;padding:10px;box-shadow:0 4px 0 var(--line);max-width:340px;width:100%;margin:0 auto;box-sizing:border-box}',
        '.wq-g1-c{display:block;aspect-ratio:1/1;border:3px solid var(--line);border-radius:12px;position:relative}',
        '.wq-g1-c.wq-g1-on:after{content:"";position:absolute;inset:16%;border-radius:50%;background:var(--navy)}',
        '.wq-g1-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
        '.wq-g1-t{min-height:76px;border-radius:20px;border:3px solid transparent;background:var(--card);box-shadow:0 5px 0 var(--line);font-size:40px;font-weight:900;color:var(--navy);cursor:pointer;font-family:inherit;line-height:1.2;touch-action:manipulation}',
        '.wq-g1-t[disabled]{cursor:default}',
        '.wq-g1-t.wq-g1-picked{border-color:var(--navy)}',
      ].join('\n');
      document.head.appendChild(s);
    } catch (e) { /* the screen still works unstyled */ }
  })();

  // k dots in a ten-frame: 2 rows of 5, filled from the first cell; aria-hidden, nothing in it is a digit
  function frame(k) {
    var n = Math.max(0, Math.min(10, Number(k) || 0));
    var cells = '';
    for (var j = 0; j < 10; j += 1) cells += '<i class="wq-g1-c' + (j < n ? ' wq-g1-on' : '') + '"></i>';
    return '<div class="wq-g1-frame" id="wq-g1-frame" aria-hidden="true">' + cells + '</div>';
  }

  /** The item screen's inner HTML for item `ctx.i` (default 0): prompt, ten-frame, three tiles. */
  function html(payload, ctx) {
    ctx = ctx || {};
    var L = langOf(ctx);
    var it = ((payload && payload.items) || [])[ctx.i || 0] || { n: 0, tiles: [] };
    var c = copy(ctx);
    var tiles = (it.tiles || []).slice(0, 3).map(function (v, j) {
      return '<button class="wq-g1-t" type="button" id="' + TILE_IDS[j] + '">' + esc(numeral(v, L)) + '</button>';
    }).join('');
    var ask = ctx.jug ? ctx.jug('thinking', c.how) : '<p class="wq-sub" id="wqc-say">' + esc(c.how) + '</p>';
    return '<div class="wq-g1">' + ask + frame(it.n) + '<div class="wq-g1-tiles">' + tiles + '</div></div>';
  }

  /**
   * Plays the stop. ctx (from wq-challenge.js): L, data (the served payload), show, on, q, jug, api, withHelped,
   * startLabel, end (the page's end card), fail(err, retry) (the page's error screen).
   */
  function run(ctx) {
    var d = ctx.data || {};
    var c = copy(ctx);
    var items = d.items || [];
    var taps = [];
    var started = 0;

    function intro() {
      ctx.show('numbers-intro', '<div class="wq-g1"><h1 class="wq-g1-title" id="wq-g1-title">' + esc(c.title) + '</h1>'
        + ctx.jug('hello', c.say, true) + frame(0)
        + '<div class="wq-stack"><button class="wq-btn wq-go" id="wqc-go" type="button">' + esc(ctx.startLabel) + '</button></div></div>');
      ctx.on('wqc-go', function () { started = Date.now(); item(0); });
    }

    function item(i) {
      if (i >= items.length) { finish(); return; }
      var it = items[i];
      ctx.show('numbers-play', html(d, { L: ctx.L, i: i, jug: ctx.jug }));
      var t0 = Date.now();
      var tapped = false;
      (it.tiles || []).slice(0, 3).forEach(function (v, j) {
        ctx.on(TILE_IDS[j], function () {
          if (tapped) return;
          tapped = true;
          taps.push({ i: i, pick: v, ms: Date.now() - t0 });
          TILE_IDS.forEach(function (id) { var el = ctx.q(id); if (el) el.disabled = true; });
          var me = ctx.q(TILE_IDS[j]);
          if (me) me.className += ' wq-g1-picked';
          setTimeout(function () { item(i + 1); }, 350);
        });
      });
    }

    function finish() {
      ctx.show('numbers-wait', '<div class="wq-g1">' + ctx.jug('thinking', c.title, true) + '</div>');
      ctx.api('ch/result', ctx.withHelped({ ct: d.ct, taps: taps, ms: Date.now() - started }))
        .then(function () { ctx.end(); })
        .catch(function (e) { ctx.fail(e, finish); });
    }

    intro();
  }

  window.WQG1 = { html: html, run: run, frame: frame, numeral: numeral, COPY: COPY };
})();
