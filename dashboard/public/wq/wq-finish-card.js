/*
 * The finish card (window.WQFC; app_settings web_quiz_card_v3): one shareable card after every finish — a teacher's
 * quiz, a read-aloud, a story, a numbers game, a listening story, a storybook, a video. Loaded only when the server
 * says the switch is on (the quiz finish's / the Jugnu menu's `card_v3`); with it off this file is never asked for.
 *
 *   WQFC.mount(stack, o)   the card's block just before `stack` (the host's own buttons): "Send to class" + the Next
 *                          tile (+ Home when o.home). o = {kind, deed, lang, title?, next?, home?,
 *                          auth: {st}|{ct}|{hub, kid}, ev?(name, props)}
 *                          or the one result object: {source: 'quiz'|'read'|'story', ended, pages_read?,
 *                          pages_listened?, stars?, title?, cover?, lang, auth, ev?, next?, home?} — a story card draws
 *                          its own headline (by `ended`), the count-up deed ("3 pages read", Urdu digits) and ONE
 *                          sticker; zero input draws "Let's read it together", no sticker, no count
 *   WQFC.numbersFor(source)  'score' (the quiz's own screen keeps n/10) | 'deed' (a story's count-up) | 'none'
 *   WQFC.unheard(r, words, heard, len)  pure: a read that certifies nothing (0, < a tenth, silent, failed, later)
 *   WQFC.trailEnd(h, o)    the Jugnu page's end cards (wq-trail.js): the card's block, the host's Home soft
 *   WQFC.quizDeedHtml / primeQuiz / shareQuiz   the teacher's quiz card (wq.js M10): the deed line above the score,
 *                          and its "Share to class group" sends the card (deed + topic, no digits)
 *   WQFC.shareText(o)      pure: the deed (+ the title), the link on its own line, the return line last
 *   WQFC.deedFor(kind, r)  pure: the deed a finish earned (the server only accepts these)
 *
 * The share never navigates this page (the child would lose it in WhatsApp's own browser): an <a target="_blank"> to
 * wa.me with the text, or navigator.share({files}) with the card's picture where the browser can share a file.
 * The card token is minted once per finish (POST /api/wq/card); the card itself never waits for it — a tap before
 * it arrives shares the words and the return line without the link. First name only, and it comes from the server.
 * Events through the host's ev(): card_shown {src: kind, ok}, card_share {src: kind, step: 'card_image', how: path}.
 * Copy: the deeds are the server's (web-quiz-card-image.js COPY), word for word; native Urdu read in the PR.
 */
(function () {
  'use strict';
  var DEEDS = {
    en: {
      quiz_done: "I finished my teacher's quiz today!",
      read_all: 'I read a whole story out loud today!',
      read_some: 'I read out loud with Jugnu today!',
      read_tried: 'I tried a new story with Jugnu today!',
      listen_done: 'I listened to a story with Jugnu today!',
      story_read: 'I read a story with Jugnu today!',
      answered: 'I answered the story questions today!',
      game_done: 'I played a numbers game with Jugnu today!',
      book_read: 'I read a storybook with Jugnu today!',
      video_watched: 'I watched a video with Jugnu today!'
    },
    ur: {
      quiz_done: 'میں نے آج ٹیچر کا کوئز مکمل کیا!',
      read_all: 'میں نے آج پوری کہانی اونچی آواز میں پڑھی!',
      read_some: 'میں نے آج جگنو کے ساتھ اونچی آواز میں پڑھا!',
      read_tried: 'میں نے آج جگنو کے ساتھ ایک نئی کہانی پڑھنے کی کوشش کی!',
      listen_done: 'میں نے آج جگنو کے ساتھ کہانی سنی!',
      story_read: 'میں نے آج جگنو کے ساتھ کہانی پڑھی!',
      answered: 'میں نے آج کہانی کے سوالوں کے جواب دیے!',
      game_done: 'میں نے آج جگنو کے ساتھ گنتی کا کھیل کھیلا!',
      book_read: 'میں نے آج جگنو کے ساتھ کہانی کی کتاب پڑھی!',
      video_watched: 'میں نے آج جگنو کے ساتھ ویڈیو دیکھی!'
    }
  };
  var W = {
    en: { send: 'Send to class', next: 'Next', home: 'Home', sound: 'Sound', mins: function (n) { return n + ' min'; },
      ret: 'Play with Jugnu any day. Tap, then send:', words: 'quiz please', quizDeed: 'You finished the whole quiz!' },
    ur: { send: 'کلاس کو بھیجیں', next: 'اگلا', home: 'واپس جائیں', sound: 'آواز', mins: function (n) { return urDigits(n) + ' منٹ'; },
      ret: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:', words: 'کوئز دکھائیں', quizDeed: 'شاباش! آپ نے پورا کوئز کر لیا!' }
  };
  var KIND_DEEDS = { quiz: ['quiz_done'], read: ['read_all', 'read_some', 'read_tried'], listen: ['listen_done'], story: ['story_read', 'answered', 'read_tried'],
    game: ['game_done'], book: ['book_read', 'listen_done', 'read_tried'], video: ['video_watched'] };
  // The card's own screen lines: zero input (RULING #32's line, the story reader's own words), a storybook's
  // headline by how it ended, and the count-up deed (on this screen only: never on the picture or in the share).
  var S = {
    en: { together: "Let's read it together", readSome: 'You read with Jugnu!', heardSome: 'You listened with Jugnu!', sticker: 'A new sticker!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' page read' : ' pages read'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' page heard' : ' pages heard'); } },
    ur: { together: 'آئیں مل کر پڑھیں', readSome: 'آپ نے جگنو کے ساتھ پڑھا!', heardSome: 'آپ نے جگنو کے ساتھ سنا!', sticker: 'ایک نیا اسٹیکر!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' صفحہ پڑھا' : ' صفحے پڑھے'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' صفحہ سنا' : ' صفحے سنے'); } }
  };
  // A result not scored yet (the page stopped waiting for the scorer): certified as nothing, but told the truth —
  // "Your result is on its way", not "Let's read it together" (the child did read). true = the together line.
  var LATER_IS_KIND = false;
  // The one sticker, drawn (the picture's own disc): never a row of stars, never a count.
  var STICKER = '<svg width="56" height="56" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#FDE68A" stroke="#F59E0B" stroke-width="6"/>' +
    '<path d="M60 22l11 23 25 3-18 17 5 25-23-12-23 12 5-25-18-17 25-3z" fill="#F59E0B"/></svg>';

  // Drawn, never emoji (an Android 9 phone draws a newer emoji as an empty box; a symbol can come from the Nastaliq face).
  var PLAY = '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M8 5l15 9-15 9z" fill="currentColor"/></svg>';
  var SND_ON = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 9h5l6-5v18l-6-5H3z" fill="currentColor"/><path d="M18 8c2 2 2 8 0 10M21 5c4 4 4 12 0 16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var SND_OFF = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 9h5l6-5v18l-6-5H3z" fill="currentColor"/><path d="M18 9l6 8M24 9l-6 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
  function L(l) { return l === 'ur' ? 'ur' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- pure ---------- */
  // r: {all, some, zero} for a read; anything else maps by kind.
  function deedFor(kind, r) {
    r = r || {};
    if (kind === 'read') return r.zero ? 'read_tried' : (r.all ? 'read_all' : 'read_some');
    if (kind === 'story') return r.answered ? 'answered' : 'story_read';
    return (KIND_DEEDS[kind] || [])[0] || null;
  }
  function deedText(lang, deed) { return DEEDS[L(lang)][deed] || ''; }
  // RULING #19 / #24: which number a card may show, from the source alone.
  function numbersFor(source) { return source === 'quiz' ? 'score' : source === 'story' ? 'deed' : 'none'; }
  // A read that certifies nothing (RULING #32, W6): no result, a failed recording, not scored yet, ended silent,
  // nothing heard, or under a tenth of the story's words. words: the page's count; heard: the live read's.
  function unheard(r, words, heard, len) {
    if (!r || r.failed || r.later || r.ended === 'silent') return true;
    var n = heard != null ? heard : words != null ? words : (r.score ? (r.score.attempted != null ? r.score.attempted : r.score.correct) : 0);
    n = Number(n) || 0;
    return n <= 0 || (len > 0 && n < 0.1 * len);
  }
  // The one result object (RULING #24) as the card's {kind, deed} and its screen lines.
  function fromSource(o) {
    var l = L(o.lang);
    if (o.source === 'story') {
      var rd = Math.max(0, Math.floor(Number(o.pages_read) || 0));
      var hd = Math.max(0, Math.floor(Number(o.pages_listened) || 0));
      var heard = o.ended === 'listened';
      var tried = heard ? hd <= 0 && rd <= 0 : rd <= 0;
      var n = heard ? (hd || rd) : rd;
      return { kind: 'book', deed: tried ? 'read_tried' : heard ? 'listen_done' : 'book_read', tried: tried,
        head: tried ? S[l].together : heard ? S[l].heardSome : S[l].readSome,
        count: tried || !n ? null : { n: n, text: function (k) { return S[l][heard ? 'pagesHeard' : 'pagesRead'](l === 'ur' ? urDigits(k) : String(k), k); } } };
    }
    if (o.source === 'quiz') return { kind: 'quiz', deed: 'quiz_done' };
    if (o.source === 'read') {
      var t = unheard(o.result || o, null, null, 0);
      return { kind: 'read', deed: t ? 'read_tried' : (o.whole ? 'read_all' : 'read_some'), tried: t };
    }
    return null;
  }
  // The title keeps its own script and direction inside the line (U+2068…U+2069 first-strong isolate).
  function titleLine(lang, title) {
    var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t) return '';
    return L(lang) === 'ur' ? '«⁨' + t + '⁩»' : '“⁨' + t + '⁩”';
  }
  // o: {lang, deed, title?, url?, ret?: {text, href}}. The link stands alone on its line, so an Urdu message never
  // wraps it backwards; the return line is always last (the child's way back tomorrow).
  function shareText(o) {
    var l = L(o.lang);
    var ret = o.ret || {};
    var lines = ['⭐ ' + deedText(l, o.deed)];
    var tl = titleLine(l, o.title);
    if (tl) lines.push(tl);
    if (o.url) lines.push(String(o.url));
    lines.push(ret.text || W[l].ret);
    lines.push(ret.href || ('“' + (ret.words || W[l].words) + '”'));
    return lines.join('\n');
  }
  function waHref(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  // The Next tile (the ranked next_offer), only with a same-origin path to open.
  function nextHtml(lang, nx) {
    if (!nx || typeof nx.href !== 'string' || !/^\/[^/]/.test(nx.href)) return '';
    var l = L(lang);
    var title = (l === 'ur' && nx.title_ur) || nx.title || '';
    var sub = (l === 'ur' && nx.sub_ur) || nx.sub || '';
    if (!title) return '';
    var mins = nx.minutes >= 1 && nx.minutes <= 9 ? '<small class="wqfc-min">' + esc(W[l].mins(Math.round(nx.minutes))) + '</small>' : '';
    var art = typeof nx.art === 'string' && /^\/wq\/[A-Za-z0-9/_.-]+$/.test(nx.art) ? '<img class="wqfc-art" src="' + esc(nx.art) + '" alt="" width="64" height="64" loading="lazy">' : '<span class="wqfc-art" aria-hidden="true">' + PLAY + '</span>';
    return '<a class="wqfc-next" id="wqfc-next" data-tap="next" href="' + esc(nx.href) + '">' + art +
      '<span class="wqfc-nt"><small>' + esc(W[l].next) + '</small><b dir="auto">' + esc(title) + '</b>' + (sub ? '<span dir="auto">' + esc(sub) + '</span>' : '') + mins + '</span></a>';
  }
  function html(o) {
    var l = L(o.lang);
    var text = shareText({ lang: l, deed: o.deed, title: o.title, ret: o.ret });
    return '<div class="wqfc" data-screen="card" lang="' + l + '" dir="' + (l === 'ur' ? 'rtl' : 'ltr') + '">' + (o.top || '') +
      (o.sound === false ? '' : '<button class="wqfc-snd" id="wqfc-snd" type="button" data-tap="sound" aria-label="' + esc(W[l].sound) + '" aria-pressed="' + (muted() ? 'true' : 'false') + '">' + (muted() ? SND_OFF : SND_ON) + '</button>') +
      '<a class="wq-btn wq-go wqfc-share" id="wqfc-share" data-primary data-tap="card_share" target="_blank" rel="noopener" href="' + esc(waHref(text)) + '">' + esc(W[l].send) + '</a>' +
      nextHtml(l, o.next) +
      (o.home && /^\/[^/]/.test(o.home) ? '<a class="wq-btn wq-soft wqfc-home" id="wqfc-home" data-home data-tap="home" href="' + esc(o.home) + '">' + esc(W[l].home) + '</a>' : '') +
      '</div>';
  }

  /* ---------- the page ---------- */
  var CSS = '.wqfc{display:grid;gap:12px;margin:12px 0}.wqfc-head{font-size:24px;font-weight:800;margin:0;text-align:center}' +
    '.wqfc-count{font-size:20px;font-weight:700;margin:0;text-align:center}.wqfc-st{display:flex;align-items:center;justify-content:center;gap:10px;margin:0;font-weight:700;color:#92400E}' +
    '[lang="ur"] .wqfc-head,[lang="ur"] .wqfc-count,[lang="ur"] .wqfc-st{line-height:2}' +
    '.wqfc-share{display:block;text-align:center;text-decoration:none;min-height:56px}' +
    '.wqfc-next{display:flex;align-items:center;gap:12px;padding:12px;border-radius:16px;background:#EFF6FF;border:2px solid var(--brand-ink,#1E3A8A);color:var(--brand-ink,#1E3A8A);text-decoration:none;min-height:72px}' +
    '.wqfc-art{width:64px;height:64px;flex:0 0 64px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#DBEAFE;object-fit:cover}' +
    '.wqfc-snd{justify-self:end;width:48px;height:48px;border-radius:24px;border:2px solid #CBD5E1;background:#fff;color:#334155;display:flex;align-items:center;justify-content:center;padding:0}' +
    '.wqfc-nt{display:grid;gap:2px;min-width:0}.wqfc-nt b{font-size:19px}.wqfc-nt small{opacity:.8}' +
    '.wqfc-deed{font-weight:800;font-size:22px;margin:8px 0 0}[lang="ur"] .wqfc-nt b,[lang="ur"] .wqfc-nt small,[lang="ur"] .wqfc-nt span,[lang="ur"] .wqfc-deed,html[lang="ur"] .wqfc-share{font-size:20px;line-height:2}' +
    '@media (prefers-reduced-motion:no-preference){.wqfc{animation:wqfc-in .4s ease-out .3s both}@keyframes wqfc-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}';
  function css() {
    try {
      if (document.getElementById('wqfc-css')) return;
      var st = document.createElement('style');
      st.id = 'wqfc-css';
      st.textContent = CSS;
      (document.head || document.body).appendChild(st);
    } catch (e) { /* unstyled still works */ }
  }

  // card_shown once per finish: a card drawn again (Back from a share, a re-render) is not another card.
  var shown = {};
  function once(k) { if (shown[k]) return false; shown[k] = 1; return true; }
  // The one sound switch (both keys the pages read: wq.js wq_sound JSON, the kit's wq_snd '1'/'0'); the kit's own toggle when present.
  function muted() {
    try {
      if (window.WQJ && typeof window.WQJ.muted === 'function') return Boolean(window.WQJ.muted());
      return localStorage.getItem('wq_snd') === '0' || localStorage.getItem('wq_sound') === 'false';
    } catch (e) { return false; }
  }
  function toggleSound(btn) {
    if (window.WQJ && typeof window.WQJ.toggle === 'function') { window.WQJ.toggle(btn); return; }
    var off = !muted();
    try { localStorage.setItem('wq_snd', off ? '0' : '1'); localStorage.setItem('wq_sound', off ? 'false' : 'true'); } catch (e) { /* this view only */ }
    try { btn.setAttribute('aria-pressed', off ? 'true' : 'false'); btn.innerHTML = off ? SND_OFF : SND_ON; } catch (e) { /* drawn next time */ }
  }
  // One token per finish (the auth names it), kept for re-renders of the same card.
  var minted = {};
  function authKey(a) { return a ? (a.st || a.ct || ((a.hub || '') + '|' + (a.kid || ''))) : ''; }
  function mint(o) {
    var k = authKey(o.auth) + '|' + o.kind + '|' + o.deed + '|' + L(o.lang);
    if (minted[k]) return minted[k];
    var body = { kind: o.kind, deed: o.deed, lang: L(o.lang) };
    var a = o.auth || {};
    ['st', 'ct', 'hub', 'kid'].forEach(function (f) { if (typeof a[f] === 'string') body[f] = a[f]; });
    if (typeof fetch !== 'function') { minted[k] = Promise.resolve(null); return minted[k]; }
    minted[k] = fetch('/api/wq/card', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } })
      .then(function (j) { return j && typeof j.url === 'string' && /^\/(k\/|q\/)/.test(j.url) ? j : null; })
      .catch(function () { return null; });
    return minted[k];
  }
  // The picture as a file, only where the browser can share one (never in WhatsApp's own browser today).
  function fileOf(img) {
    try {
      if (!(navigator.canShare && navigator.share && typeof File === 'function')) return Promise.resolve(null);
    } catch (e) { return Promise.resolve(null); }
    return fetch(img).then(function (r) { return r && r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return null;
      var f = new File([b], 'jugnu-card.png', { type: 'image/png' });
      try { return navigator.canShare({ files: [f] }) ? f : null; } catch (e) { return null; }
    }).catch(function () { return null; });
  }

  // The share's words now, and the link once the token is in (st.text); the picture as a file where one can go.
  function prime(o) {
    css();
    var k = keyOf(o);
    if (primed[k]) return primed[k];
    var st = primed[k] = { text: shareText(o), url: null, file: null, ready: false };
    mint(o).then(function (j) {
      if (!j) return;
      st.url = location.origin + j.url;
      st.img = j.img;
      st.text = shareText({ lang: o.lang, deed: o.deed, title: o.title, url: st.url, ret: j.ret });
      st.ready = true;
      try {
        var a = document.getElementById('wqfc-share');
        if (a && a.tagName === 'A') a.setAttribute('href', waHref(st.text));
      } catch (e) { /* the tap still shares st.text */ }
      fileOf(j.img).then(function (f) { st.file = f; });
    });
    return st;
  }
  var primed = {};
  function keyOf(o) { return authKey(o.auth) + '|' + o.kind + '|' + o.deed + '|' + L(o.lang); }

  // A tap: the picture as a file where the browser can share one; else the anchor's own wa.me (new window), or the
  // host's fallback (the quiz's "send it on WhatsApp" screen) for a host's <button>.
  function tapShare(o, e, fallback) {
    var st = prime(o);
    var ev = typeof o.ev === 'function' ? o.ev : function () {};
    // The sender's WhatsApp fetches the preview picture a moment after the tap: ask for it now, so it is drawn by then.
    if (st.img && !st.warmed) { st.warmed = true; try { fetch(st.img).catch(function () {}); } catch (x) { /* the preview asks itself */ } }
    if (st.file) {
      if (e && e.preventDefault) e.preventDefault();
      navigator.share({ files: [st.file], text: st.text }).then(function () { ev('card_share', { src: o.kind, step: 'card_image', how: 'file' }); },
        function (x) { if (!(x && x.name === 'AbortError') && fallback) fallback(st.text, st.url); });
      return;
    }
    ev('card_share', { src: o.kind, step: 'card_image', how: fallback ? 'sheet' : 'wa' });
    if (fallback) fallback(st.text, st.url);
  }

  // The card's block, before `stack` (the host's own buttons): Share, the Next tile, Home. One listener per control.
  function mount(stack, o) {
    if (o && o.source && !o.kind) {
      var f = fromSource(o);
      if (!f) return false;
      var l = L(o.lang);
      var top = f.head ? '<h2 class="wqfc-head" dir="auto">' + esc(f.head) + '</h2>' +
        (f.count ? '<p class="wqfc-count" data-n>' + esc(f.count.text(f.count.n)) + '</p>' : '') +
        (f.tried ? '' : '<p class="wqfc-st" data-sticker>' + STICKER + '<span>' + esc(S[l].sticker) + '</span></p>') : '';
      o = { kind: f.kind, deed: f.deed, lang: l, title: o.title, next: o.next, home: o.home, auth: o.auth, ev: o.ev, top: top, count: f.count };
    }
    if (!stack || typeof stack.insertAdjacentHTML !== 'function' || !o || !KIND_DEEDS[o.kind] || KIND_DEEDS[o.kind].indexOf(o.deed) < 0) return false;
    prime(o);
    stack.insertAdjacentHTML('beforebegin', html(o));
    if (o.count && o.count.n > 1) countUp(o.count);
    var ev = typeof o.ev === 'function' ? o.ev : function () {};
    var a = document.getElementById('wqfc-share');
    if (a) a.addEventListener('click', function (e) { tapShare(o, e, null); });
    var snd = document.getElementById('wqfc-snd');
    if (snd) snd.addEventListener('click', function () { toggleSound(snd); });
    var nx = document.getElementById('wqfc-next');
    if (nx) {
      ev('next_shown', slot(o));
      nx.addEventListener('click', function () { ev('next_tap', slot(o)); });
    }
    if (once('m|' + keyOf(o))) ev('card_shown', { src: o.kind, ok: true });
    return true;
  }

  // The deed counts up to its number (1, 2, 3 pages…), still under reduced motion.
  function countUp(c) {
    try {
      var el = document.querySelector && document.querySelector('.wqfc-count');
      if (!el || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      var j = 0;
      (function up() { el.textContent = c.text(++j); if (j < c.n) setTimeout(up, 150); })();
    } catch (e) { /* the final number is already drawn */ }
  }

  // The Jugnu page's end cards (wq-trail.js, one guarded line per card): the card's block above the host's buttons,
  // the host's Home soft (green is Share only), the plain "Next: …" line given way to the tile. o = {name, line, r, t,
  // story}: the deed comes from the outcome the host already drew (r.tried: a read that certified nothing).
  function trailEnd(h, o) {
    var d = h.S.data || {};
    var r = o.r || {};
    if (!(h.md() || {}).card_v3 || d.round_turn || d.practice_round || r.hold || !d.ct) return false;
    var t = o.t || {};
    var kind, deed;
    if (o.name === 'read-result' && !o.story) {
      kind = 'read';
      deed = r.tried || o.line === t.endZeroWords ? 'read_tried' : o.line === t.endReadAll ? 'read_all' : 'read_some';
    } else if (d.ex === 'listen') { kind = 'listen'; deed = 'listen_done'; }
    else if (o.story) { kind = 'story'; deed = 'story_read'; }
    else { kind = 'game'; deed = 'game_done'; }
    var ttl = d.title && typeof d.title === 'object' ? (h.L === 'ur' && d.title.ur) || d.title.en || '' : '';
    var on = mount(document.querySelector('#wq .wq-stack'), { kind: kind, deed: deed, lang: h.L, title: typeof ttl === 'string' ? ttl : '', next: r.next_offer || d.next_offer, auth: { ct: d.ct }, ev: h.ev });
    if (!on) return false;
    try {
      var old = document.getElementById('wqfc-next') ? document.getElementById('wqc-next') : null;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var home = document.getElementById('wqc-menu');
      if (home && /\bwq-go\b/.test(home.className)) home.className = home.className.replace(/\bwq-go\b/, 'wq-soft');
    } catch (e) { /* the card still works */ }
    return true;
  }
  // The headline of a read that certified nothing.
  function together(lang) { return S[L(lang)].together; }
  function triedLine(lang, r, later) { return r && r.later && !LATER_IS_KIND ? later : together(lang); }

  // The slot event: the tile is position 0; the ranked object's own offer/arm/score_v ride along.
  function slot(o) {
    var n = o.next || {};
    var e = { src: 'after_' + o.kind, ctx: 'after_' + o.kind, step: String(n.kind || 'other').replace(/[^a-z0-9_]/g, '').slice(0, 32), pos: 0 };
    ['offer', 'arm', 'score_v', 'rank_src'].forEach(function (k) { if (typeof n[k] === 'string' || typeof n[k] === 'number') e[k] = n[k]; });
    return e;
  }

  // The teacher's quiz card (wq.js M10, which draws the deed line and the tile from these): its own screen keeps n/10
  //; its class share is the card — deed + topic, no score, the link, the return line.
  function quizDeedHtml(lang) { return '<p class="wqfc-deed" id="wqfc-deed">' + esc(W[L(lang)].quizDeed) + '</p>'; }
  function quiz(o) { return { kind: 'quiz', deed: 'quiz_done', lang: L(o.lang), title: o.topic, auth: o.st ? { st: o.st } : null, ev: o.ev }; }
  function primeQuiz(o) {
    var q = quiz(o);
    prime(q);
    if (typeof o.ev === 'function' && once('q|' + keyOf(q))) o.ev('card_shown', { src: 'quiz', ok: true });
  }
  function shareQuiz(o, fallback) { tapShare(quiz(o), null, fallback); }
  // wq.js registers this before today's "Share to class group" listener: the class share becomes the card, and
  // today's listener (still there, untouched) does not run for that tap.
  function quizShareTap(o, fallback) {
    return function (e) {
      if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      shareQuiz(o, fallback);
    };
  }

  window.WQFC = { mount: mount, primeQuiz: primeQuiz, shareQuiz: shareQuiz, quizShareTap: quizShareTap, quizDeedHtml: quizDeedHtml, shareText: shareText,
    deedFor: deedFor, deedText: deedText, numbersFor: numbersFor, unheard: unheard, together: together, triedLine: triedLine, trailEnd: trailEnd,
    html: html, nextHtml: nextHtml, DEEDS: DEEDS, W: W, S: S, CSS: CSS };
})();
