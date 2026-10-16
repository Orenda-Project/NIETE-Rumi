/* The hub's Jugnu corner (loaded only when the bot's hub JSON carries `play`; bot web-quiz-hub-play.js):
 * the Jugnu card first when the last quiz is finished, the lantern (the server's "next thing" line), the Story
 * Time shelf with NEW tags, and the install prompt's events. The page decides nothing: what comes next, which
 * story is new and which doors may be counted all come from the server. No framework, no build step. */
(function () {
  'use strict';
  // Copy: copy.v2.json keys jg.lantern.*, jg.next.*, jg.shelf.* (camelCase of the key tail).
  var T = {
    en: {
      lanternTrailOne: 'A game is waiting for you on the Trail.',
      lanternTrailMany: 'Games are waiting for you on the Trail.',
      lanternNewStory: function (title) { return 'A new story is here: ' + title; },
      lanternTomorrow: 'Tomorrow: a new story',
      lanternAllSeen: 'Next story arrives on Monday. Until then, play numbers with Jugnu.',
      nextMonday: 'Next story arrives on Monday',
      shelfTitle: 'Jugnu today', shelfWeekStory: 'This week\'s story', shelfListen: 'Listen to a story',
      shelfNumbers: 'Numbers with Jugnu', shelfOlder: 'More stories', shelfTagNew: 'NEW',
      installTitle: 'Add Jugnu to your home screen', installBtn: 'Add', installLater: 'Not now',
    },
    ur: {
      lanternTrailOne: 'جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔',
      lanternTrailMany: 'جگنو کے راستے پر کھیل آپ کا انتظار کر رہے ہیں۔',
      lanternNewStory: function (title) { return 'ایک نئی کہانی آ گئی ہے: ⁨' + title + '⁩'; },
      lanternTomorrow: 'کل نئی کہانی آئے گی۔',
      lanternAllSeen: 'اگلی کہانی پیر کو آئے گی۔ تب تک جگنو کے ساتھ گنتی کے کھیل کھیلیں۔',
      nextMonday: 'اگلی کہانی پیر کو آئے گی',
      shelfTitle: 'آج جگنو کے ساتھ', shelfWeekStory: 'اس ہفتے کی کہانی', shelfListen: 'کہانی سنیں',
      shelfNumbers: 'جگنو کے ساتھ گنتی', shelfOlder: 'اور کہانیاں', shelfTagNew: 'نئی',
      installTitle: 'جگنو کو اپنی ہوم اسکرین پر لگائیں', installBtn: 'لگائیں', installLater: 'ابھی نہیں',
    },
  };
  var SHELF = { week_story: ['shelfWeekStory', '📖'], listen: ['shelfListen', '🎧'], numbers: ['shelfNumbers', '🔢'], older: ['shelfOlder', '📚'] };
  var CSS = '.wqp-jug{display:flex;flex-direction:column;gap:8px}' +
    '.wqp-go{display:flex;align-items:center;gap:12px;min-height:64px;color:var(--navy);text-decoration:none}' +
    '.wqp-go img{flex:none;width:64px;height:64px}.wqp-go b{display:block;font-size:19px;line-height:1.25}.wqp-go small{display:block;font-size:14px;color:var(--muted);font-weight:700}' +
    '.wqp-lant{display:flex;align-items:center;gap:8px;min-height:48px;margin:0;padding:8px 12px;border-radius:14px;background:var(--soft,#fff7d6);color:var(--navy);font-weight:800;font-size:16px;line-height:1.35;text-decoration:none}' +
    '.wqp-lant span[aria-hidden]{flex:none}' +
    '.wqp-label{margin:6px 0 0;font-weight:900;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}' +
    'html[lang=ur] .wqp-label{letter-spacing:0;font-weight:400;font-size:20px;line-height:1.9;text-transform:none}' +
    '.wqp-shelf{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.wqp-tile{position:relative;display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:72px;padding:10px 12px;border-radius:16px;border:2px solid var(--line);background:var(--card);color:var(--navy);text-decoration:none;box-shadow:0 3px 0 var(--line);font-weight:800;font-size:16px;line-height:1.3}' +
    '.wqp-tile i{font-style:normal;font-size:22px}' +
    '.wqp-new{position:absolute;top:6px;inset-inline-end:6px;padding:1px 8px;border-radius:999px;background:var(--brand);color:#fff;font-size:12px;font-weight:900}' +
    '.wqp-inst{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:18px;border:2px solid var(--line);background:var(--card);color:var(--navy)}' +
    '.wqp-inst b{font-size:17px;line-height:1.3}.wqp-inst div{display:flex;gap:10px}' +
    '.wqp-inst button{flex:1;min-height:48px;border-radius:14px;font:inherit;font-weight:800;font-size:16px;cursor:pointer}' +
    '.wqp-inst .wqp-add{background:var(--brand);color:#fff;border:0}.wqp-inst .wqp-later{background:transparent;color:var(--navy);border:2px solid var(--line)}' +
    'html[lang=ur] .wqp-inst b,html[lang=ur] .wqp-inst button{font-weight:400;font-size:20px;line-height:1.9}' +
    'html[lang=ur] .wqp-lant,html[lang=ur] .wqp-tile,html[lang=ur] .wqp-go b{font-weight:400;font-size:20px;line-height:1.9}' +
    'html[lang=ur] .wqp-go small{font-size:20px;line-height:1.9;font-weight:400}html[lang=ur] .wqp-new{display:inline-flex;align-items:center;font-size:22px;line-height:1.6;min-height:28px;min-width:48px;justify-content:center;font-weight:400;padding:2px 12px}';

  var shown = {};          // door_shown once per door (and per shelf tile) per page view
  var lastTap = {};        // door_tap debounced 1 s
  var styled = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function door(B, name) { return Boolean(B.play && B.play.doors && B.play.doors.indexOf(name) >= 0); }
  // The Jugnu tile in the hub's own tiles markup (hub.js homeTiles / tiles), taken out when the card goes first.
  var CH_TILE = /<a class="wq-htile" id="wq-h-ch"[^>]*>[\s\S]*?<\/a>/;
  // The Jugnu door's 1-based position on the hub: the cards and tiles above it, top to bottom.
  function slotOf(html) {
    var at = html.indexOf('id="wq-h-ch"');
    if (at < 0) return 0;
    // The Jugnu card's or tile's own class comes before its id, so it counts itself.
    return (html.slice(0, at).match(/class="wq-(?:card|htile)\b/g) || []).length;
  }

  // The lantern: the server's resolver result as one line. Returns {html, door, nx} or null.
  function lantern(B, L, chHref) {
    var x = B.play.lantern;
    if (!x || !x.kind) return null;
    var line = null; var dr = null; var nx = null; var href = chHref;
    if (x.kind === 'trail') { line = Number(x.stops) > 1 ? L.lanternTrailMany : L.lanternTrailOne; dr = 'next'; nx = 'trail'; }
    else if (x.kind === 'story' && x.title) {
      line = L.lanternNewStory(x.title); dr = 'next'; nx = 'story';
      if (x.pid) href = chHref + '&room=story&pid=' + encodeURIComponent(x.pid);
    } else if (x.day === 'tomorrow') { line = L.lanternTomorrow; dr = 'tomorrow'; href = null; }
    else if (x.kind === 'numbers' && x.day === 'monday') { line = L.lanternAllSeen; dr = 'next'; nx = 'numbers'; }
    else if (x.kind === 'day' && x.day === 'monday') { line = L.nextMonday; href = null; }
    else { line = L.shelfNumbers; dr = 'next'; nx = 'numbers'; }
    var inner = '<span aria-hidden="true">🏮</span><span>' + esc(line) + '</span>';
    var html = href
      ? '<a class="wqp-lant" id="wqp-next" data-nx="' + esc(nx || '') + '" href="' + esc(href) + '">' + inner + '</a>'
      : '<p class="wqp-lant" id="wqp-next">' + inner + '</p>';
    return { html: html, door: dr, nx: nx };
  }

  function shelf(B, L, chHref) {
    var list = B.play.shelf;
    if (!list || !list.length) return '';
    return '<p class="wqp-label">' + esc(L.shelfTitle) + '</p><div class="wqp-shelf">' + list.map(function (t, i) {
      var s = SHELF[t.id];
      if (!s) return '';
      var href = chHref + (t.id === 'numbers' ? '' : '&room=story' + (t.pid ? '&pid=' + encodeURIComponent(t.pid) : ''));
      var tag = t.nx === 'new' && t.id !== 'numbers' ? '<span class="wqp-new">' + esc(L.shelfTagNew) + '</span>' : '';
      return '<a class="wqp-tile" data-shelf="' + (i + 1) + '" data-pid="' + esc(t.pid || '') + '" data-nx="' + (t.nx === 'new' ? 'new' : 'seen') + '" href="' + esc(href) + '">' +
        tag + '<i aria-hidden="true">' + s[1] + '</i><span>' + esc(L[s[0]]) + '</span></a>';
    }).join('') + '</div>';
  }

  var pending = null;
  /** The hub's `top` block. parts: {HOME, lastCard, homeTiles, teacher, teacherAny, tiles, T, LANG, MASC, chHref, ROOT, ev, afterJug}. */
  function top(B, HT, parts) {
    var L = T[parts.LANG === 'ur' ? 'ur' : 'en'];
    var base = parts.HOME
      ? parts.lastCard + parts.homeTiles + parts.teacher
      : parts.teacherAny + (parts.tiles ? '<div class="wq-htiles">' + parts.tiles + '</div>' : '');
    var chOn = Boolean(B.challenge && B.challenge.on);
    var lt = chOn ? lantern(B, L, parts.chHref) : null;
    var sh = chOn ? shelf(B, L, parts.chHref) : '';
    var html;
    if (B.play.first && chOn && base.indexOf('id="wq-h-ch"') >= 0) {
      var card = '<div class="wq-card wq-hcard wqp-jug"><a class="wqp-go" id="wq-h-ch" href="' + esc(parts.chHref) + '">' +
        '<img src="/wq/jugnu/hello.webp" alt="" width="64" height="64"><span><b>' + esc(HT.chT(parts.MASC[parts.LANG])) + '</b><small>' + esc(HT.chSub) + '</small></span></a>' +
        (lt ? lt.html : '') + '</div>';
      // The tiles row without the Jugnu tile; an emptied row goes.
      var rest = base.replace(CH_TILE, '').replace('<div class="wq-htiles"></div>', '');
      // afterJug (hub.js: keep my place's mount, or ''): the Jugnu card leads, the keep card right after it.
      html = card + (parts.afterJug || '') + sh + inst(B) + rest;
    } else {
      html = base + (lt || sh ? (lt ? lt.html : '') + sh : '') + inst(B);
    }
    if (!styled && (lt || sh || B.play.first || B.play.install)) {
      styled = true;
      try { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
    }
    pending = { lt: lt, slot: slotOf(html), parts: parts };
    // The hub renders this block right after; wire it then (the hub's own handlers are already on).
    setTimeout(function () { if (pending) { var p = pending; pending = null; wire(p.parts.ROOT, p.parts.ev, B, p); } }, 0);
    return html;
  }

  function tap(ev, name, props) {
    var k = name + '|' + (props.pid || props.slot || '');
    var now = Date.now();
    if (lastTap[k] && now - lastTap[k] < 1000) return;
    lastTap[k] = now;
    ev('door_tap', props);
  }

  function wire(ROOT, ev, B, p) {
    if (!ROOT || !ev || !B || !B.play) return;
    p = p || { slot: slotOf(ROOT.innerHTML || ''), lt: null };
    var ch = ROOT.querySelector('#wq-h-ch');
    if (ch && door(B, 'hub_first')) {
      var slot = p.slot || 1;
      if (!shown.hub_first) { shown.hub_first = true; ev('door_shown', { door: 'hub_first', surface: 'hub', slot: slot }); }
      ch.addEventListener('click', function () { tap(ev, 'hub_first', { door: 'hub_first', surface: 'hub', slot: slot }); });
    }
    var nxEl = ROOT.querySelector('#wqp-next');
    if (nxEl && p.lt && p.lt.door && door(B, p.lt.door) && !shown[p.lt.door]) {
      shown[p.lt.door] = true;
      ev('door_shown', p.lt.door === 'next' ? { door: 'next', surface: 'hub', nx: p.lt.nx } : { door: 'tomorrow', surface: 'hub' });
    }
    if (nxEl && p.lt && p.lt.door === 'next' && door(B, 'next')) {
      nxEl.addEventListener('click', function () { tap(ev, 'next', { door: 'next', surface: 'hub', nx: p.lt.nx }); });
    }
    if (door(B, 'shelf')) {
      var tiles = Array.prototype.slice.call(ROOT.querySelectorAll('[data-shelf]'));
      var seen = function (t) {
        var k = 'shelf|' + t.getAttribute('data-shelf');
        if (shown[k]) return;
        shown[k] = true;
        ev('door_shown', shelfProps(t));
      };
      if (typeof IntersectionObserver === 'function') {
        try {
          var io = new IntersectionObserver(function (ents) {
            ents.forEach(function (en) { if (en.isIntersecting && en.intersectionRatio >= 0.5) { seen(en.target); io.unobserve(en.target); } });
          }, { threshold: [0.5] });
          tiles.forEach(function (t) { io.observe(t); });
        } catch (e) { tiles.forEach(seen); }
      } else tiles.forEach(seen);
      tiles.forEach(function (t) { t.addEventListener('click', function () { tap(ev, 'shelf', shelfProps(t)); }); });
    }
  }
  function shelfProps(t) {
    var o = { door: 'shelf', surface: 'hub', slot: Number(t.getAttribute('data-shelf')) || 0, nx: t.getAttribute('data-nx') === 'new' ? 'new' : 'seen' };
    var pid = t.getAttribute('data-pid');
    if (pid) o.pid = pid;
    return o;
  }

  // The install card (web_quiz_install_prompt; copy jg.install.*): its slot sits after the shelf, never above the Jugnu
  // card. It fills only once the browser offered the install (beforeinstallprompt), never in the day's first hub view,
  // and not for 7 days after "Not now".
  var DAY_KEY = 'wqp_hv_day';
  var LATER_KEY = 'wqp_inst_later';
  var LATER_MS = 7 * 24 * 60 * 60 * 1000;
  var deferred = null;     // the browser's install event, kept for "Add"
  var firstView = true;    // the day's first hub view (decided once per page load; storage trouble keeps it true)
  var dayChecked = false;
  var installWired = false;
  var IB = null; var IEV = null; var IROOT = null;
  // Where the page runs: an installed app (no card), an in-app browser (no card: opening the hub in the system browser
  // lands on the lock screen because the device differs there; a signed one-time device hand-over is pending), or a
  // browser (the card waits for beforeinstallprompt). The UA test is the quiz page's (wq.js IAB) plus WhatsApp's `WA4A/`.
  var IAB_RX = /\bWA4A\/|WhatsApp|FBAN|FBAV|Instagram|; wv\)/;
  function where() {
    try {
      if ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator && window.navigator.standalone === true)) return 'app';
    } catch (e) {}
    return IAB_RX.test(String((typeof navigator !== 'undefined' && navigator.userAgent) || '')) ? 'none' : 'browser';
  }
  var WHERE = null;
  function inst(B) { return B.play && B.play.install ? '<div id="wqp-inst"></div>' : ''; }
  function pktDay() { return String(Math.floor((Date.now() + 5 * 3600000) / 86400000)); }
  function checkDay() {
    if (dayChecked) return;
    dayChecked = true;
    try {
      var today = pktDay();
      firstView = localStorage.getItem(DAY_KEY) !== today;
      localStorage.setItem(DAY_KEY, today);
    } catch (e) { firstView = true; }
  }
  function snoozed() {
    try { var t = Number(localStorage.getItem(LATER_KEY)); return isFinite(t) && t > 0 && Date.now() - t < LATER_MS; } catch (e) { return true; }
  }
  function installSlot(html) {
    var at = html.indexOf('id="wqp-inst"');
    return at < 0 ? 0 : (html.slice(0, at).match(/class="(?:wq-card|wq-htile|wqp-tile)\b/g) || []).length + 1;
  }
  function installed() { tap(IEV, 'install', { door: 'install', surface: 'hub' }); }
  // Fill the card's slot when every condition holds; empty it otherwise.
  function fillInstall() {
    var box = IROOT && IROOT.querySelector('#wqp-inst');
    if (!box) return;
    var L = T[IB.lang === 'ur' ? 'ur' : 'en'];
    if (!deferred || firstView || snoozed()) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="wqp-inst"><b>' + esc(L.installTitle) + '</b><div>' +
      '<button type="button" class="wqp-add" data-inst="add">' + esc(L.installBtn) + '</button>' +
      '<button type="button" class="wqp-later" data-inst="later">' + esc(L.installLater) + '</button></div></div>';
    if (!shown.install && door(IB, 'install')) {
      shown.install = true;
      IEV('door_shown', { door: 'install', surface: 'hub', slot: installSlot(IROOT.innerHTML || '') });
    }
    if (!box.wqpWired) {
      box.wqpWired = true;
      box.addEventListener('click', function (e) {
        var t = e && e.target;
        var b = t && t.getAttribute && t.getAttribute('data-inst') ? t : t && t.closest ? t.closest('[data-inst]') : null;
        var what = b && b.getAttribute('data-inst');
        if (what === 'later') {
          try { localStorage.setItem(LATER_KEY, String(Date.now())); } catch (x) {}
          box.innerHTML = '';
        } else if (what === 'add' && deferred) {
          var d = deferred; deferred = null;
          box.innerHTML = '';
          try {
            d.prompt();
            if (d.userChoice && d.userChoice.then) d.userChoice.then(function (c) { if (c && c.outcome === 'accepted' && door(IB, 'install')) installed(); });
          } catch (x) {}
        }
      });
    }
  }
  function install(B, ev, ROOT) {
    if (!B || !B.play || !B.play.install) return;
    IB = B; IEV = ev; IROOT = ROOT;
    if (WHERE === null) WHERE = where();
    if (WHERE === 'app' || WHERE === 'none') return;
    checkDay();
    if (!installWired) {
      installWired = true;
      try {
        window.addEventListener('beforeinstallprompt', function (e) {
          // Our card offers it (when it may show); keep the event for "Add".
          try { if (e && e.preventDefault) e.preventDefault(); } catch (x) {}
          deferred = e;
          fillInstall();
        });
        window.addEventListener('appinstalled', function () { deferred = null; if (door(IB, 'install')) installed(); });
      } catch (e) {}
    }
    setTimeout(fillInstall, 0);
  }

  window.WQPLAY = {
    top: function (B, HT, parts) { var h = top(B, HT, parts); install(B, parts.ev, parts.ROOT); return h; },
    wire: wire,
  };
})();
