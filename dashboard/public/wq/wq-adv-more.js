/*
 * WQAD: the adventure look's second part, asked for by the kit (wq-adv.js) as soon as the look is on, so it is here
 * before a child finishes anything. The kit hands it every finish card, every Home it dresses and every new node.
 *
 *   WQAD.card(card)   a finish card (WQFC's .wqfc): Jugnu answers it (cheering; waving on a try that read nothing, with
 *                     the "Brave try" badge, never a stamp), the Next tile leads and Share + Home sit under it as a
 *                     pair; the finished thing's picture is kept on this phone for its land's trail stop
 *   WQAD.home(home)   Home: each trail stop shows the last thing finished in its land (the next stop: what is next;
 *                     nothing yet: the empty ring), and the Next tile's title keeps its own direction
 *   WQAD.scan(root)   Urdu: every Home button says «گھر», the app's one word for it
 * Nothing here changes what a tap does or adds a request: the pictures are ones the pages already drew.
 */
(function (W) {
  'use strict';
  if (!W || !W.document || W.WQAD) return;
  var D = W.document;
  var JUG = '/wq/jugnu/';
  var BRAVE = { en: 'Brave try!', ur: 'ہمت والی کوشش!' };
  var HOME_UR = 'گھر', HOME_OLD = { 'واپس جائیں': 1, 'ہوم': 1 };
  var LAND = { story: 'stories', book: 'stories', read: 'stories', game: 'games', quiz: 'games', numbers: 'games', challenge: 'games', video: 'videos' };
  var AKEY = 'wqa_art';
  // a heart in a ring: the try badge (not a land's stamp, so nothing is kept for it)
  var HEART = '<svg class="wqa-heart" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="22" fill="var(--card)" stroke="var(--gold)" stroke-width="3"/>' +
    '<path d="M24 35s-10-6.2-10-13a5.6 5.6 0 0 1 10-3.4A5.6 5.6 0 0 1 34 22c0 6.8-10 13-10 13z" fill="var(--glow)" stroke="var(--gold)" stroke-width="2.4" stroke-linejoin="round"/></svg>';

  function has(e, c) { return (' ' + (e.className || '') + ' ').indexOf(' ' + c + ' ') >= 0; }
  function ur(e) { return (e && e.getAttribute && e.getAttribute('lang') === 'ur') || D.documentElement.lang === 'ur'; }
  // a picture we may draw: a same-site path or https, never Jugnu's own pose (he is not a thing to finish)
  function pic(s) { return typeof s === 'string' && /^(\/(?!\/)|https:\/\/)[^\s"'<>\\]+$/.test(s) && s.indexOf(JUG) !== 0 ? s : ''; }
  function arts() { try { return JSON.parse(W.localStorage.getItem(AKEY) || '{}') || {}; } catch (e) { return {}; } }
  function keep(land, src) {
    if (!land || !src) return;
    var a = arts();
    a[land] = src;
    try { W.localStorage.setItem(AKEY, JSON.stringify(a)); } catch (e) { /* storage blocked: the trail keeps its rings */ }
  }
  function img(cls, src, size) {
    var i = D.createElement('img');
    i.className = cls; i.alt = ''; i.width = size; i.height = size;
    i.setAttribute('src', src);
    return i;
  }

  // ── the finish card ──────────────────────────────────────────────────────────────────────────────────────────
  function landOf(card) {
    if (card.querySelector('.wqfc-cov')) return 'stories';
    if (D.querySelector('video.wq-vid')) return 'videos';
    return /^\/q\//.test((W.location && W.location.pathname) || '') ? 'games' : '';
  }
  function artOf(card) {
    var c = card.querySelector('.wqfc-cov'), v = D.querySelector('video.wq-vid');
    return pic(c ? c.getAttribute('src') : v ? v.getAttribute('poster') : '');
  }
  function card(c) {
    if (!c || !has(c, 'wqfc') || c.getAttribute('data-wqad')) return;
    c.setAttribute('data-wqad', '1');
    // a try that read nothing has no Share (WQFC draws none for read_tried)
    var tried = !c.querySelector('.wqfc-share');
    var cov = c.querySelector('.wqfc-cov'), head = c.querySelector('.wqfc-head');
    if (!D.querySelector('.wq-jimg,.wq-moment-jug')) c.insertBefore(img('wqa-jug', JUG + (tried ? 'hello' : 'celebrate') + '.webp', 96), cov ? cov.nextSibling : c.firstChild);
    if (tried) {
      var b = D.createElement('p');
      b.className = 'wqa-got wqa-brave';
      b.setAttribute('role', 'status');
      b.innerHTML = HEART + '<b>' + BRAVE[ur(c) ? 'ur' : 'en'] + '</b>';
      c.insertBefore(b, head ? head.nextSibling : c.firstChild);
      return;
    }
    keep(landOf(c), artOf(c));
    var nx = c.querySelector('.wqfc-next'), sh = c.querySelector('.wqfc-share'), hm = c.querySelector('.wqfc-home');
    // ONE next step: the Next tile leads; Share becomes the soft secondary under it
    if (nx && sh.hasAttribute('data-primary')) {
      sh.removeAttribute('data-primary');
      sh.className = sh.className.replace(/\bwq-go\b/, 'wq-soft');
      nx.setAttribute('data-primary', '');
      if (!has(nx, 'wqfc-lead')) nx.className += ' wqfc-lead';
      c.insertBefore(nx, sh);
    }
    // Share + Home: the secondary pair (never when Share is the card's one primary)
    if (hm && !sh.hasAttribute('data-primary') && sh.parentNode === c && hm.parentNode === c) {
      var p = D.createElement('div');
      p.className = 'wqa-pair';
      c.insertBefore(p, sh);
      p.appendChild(sh);
      p.appendChild(hm);
    }
  }

  // ── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function home(h) {
    if (!h || !h.querySelector) return;
    var nx = h.querySelector('.wq-next'), a = arts();
    if (nx) {
      var na = nx.querySelector('.wq-nart'), nl = LAND[nx.getAttribute('data-kind')];
      if (nl && !a[nl] && na) a[nl] = na.getAttribute('src');
      var t = nx.querySelector('.wq-ntext');
      var tb = t && t.querySelector('b');
      if (tb) tb.setAttribute('dir', 'auto');
      // the minutes go on their own line (wq-adventure.css), so the separator before them goes
      var sm = t && t.querySelector('small');
      if (sm && sm.querySelector('.wq-nmin')) strip(sm);
    }
    h.querySelectorAll('.wqa-stop').forEach(function (s) {
      var src = pic(a[s.getAttribute('data-door')]), i = s.querySelector('i');
      if (!src || !i || s.querySelector('img')) return;
      i.insertBefore(img('wqa-sp', src, 60), i.firstChild);
      s.className += ' wqa-pic';
    });
  }
  function strip(sm) {
    var n = Array.prototype.slice.call(sm.childNodes);
    n.forEach(function (x) { if (x.nodeType === 3 && /^[\s،·,]*$/.test(x.nodeValue)) sm.removeChild(x); });
  }

  // ── Urdu Home buttons say «گھر» ──────────────────────────────────────────────────────────────────────────────
  function word(e) {
    Array.prototype.slice.call(e.childNodes).forEach(function (x) {
      if (x.nodeType === 3) { if (HOME_OLD[x.nodeValue.trim()]) x.nodeValue = HOME_UR; } else if (x.nodeType === 1 && x.tagName === 'SPAN') word(x);
    });
  }
  function scan(root) {
    if (!root || root.nodeType !== 1 || !ur(null)) return;
    (root.matches && root.matches('[data-home]') ? [root] : []).concat(Array.prototype.slice.call(root.querySelectorAll('[data-home]'))).forEach(word);
  }

  W.WQAD = { card: card, home: home, scan: scan };
  // arriving after the page drew: what is already there
  if (!D.documentElement.classList.contains('wq-adv')) return;
  Array.prototype.slice.call(D.querySelectorAll('.wqfc[data-screen=card]')).forEach(card);
  home(D.querySelector('section.wq-home[data-screen=home]'));
  if (D.body) scan(D.body);
})(typeof window !== 'undefined' ? window : null);
