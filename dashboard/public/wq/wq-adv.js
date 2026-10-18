/*
 * WQA: the adventure look's kit (wq-adv.js + wq-adventure.css). The edge links both, and puts `wq-adv` on <html>, only
 * when the page payload carries `adv: true` (app_settings web_quiz_adventure_look, default off). With it absent nothing
 * here runs, so every caller writes `if (window.WQA) …` and keeps today's path otherwise.
 *
 *   WQA.icon(name[, label])       one inline-SVG icon (currentColor; the class animals and subjects too); unknown = star
 *   WQA.animal(key) / WQA.subject(name)   the class avatar / the subject tile, as icons (the emoji maps' keys)
 *   WQA.bar(done, total[, label]) a progress bar (role=progressbar), WQA.badge(text[, icon]) a sticker
 *   WQA.move(el, name)            one motion (pop, rise, wobble, glow), a 150 ms fade under reduced motion
 *   WQA.cue(name[, el])           one sound from the sound kit (wq-juice.js, fetched on the first cue); never when muted
 *   WQA.burst(el)                 the celebration: the finish sound, el pops, confetti (none under reduced motion)
 *   WQA.muted() / WQA.mute(b)     the pages' ONE sound switch (the sound kit's own keys)
 *   WQA.still()                   true under prefers-reduced-motion
 *   WQA.stamp(kind[, quiet])      the ONE "you finished something" hook: keeps the land's stamp on this phone, plays the
 *                                 two blips (not when quiet), answers { kind, land, svg }
 *   WQA.award(card) / climb(line) a finish card's stamp (effort only; the moment's badge is its slot) / the class table's
 *                                 move up (both done by themselves)
 *   WQA.tone(name)                stamp (784 + 1175 Hz) or notyet (a soft 220 Hz), WebAudio, never when muted
 *   WQA.trail(names, next)        Home's three land stops (drawn by itself under the Next tile, with Jugnu's "Next stop!")
 *   WQA.swap(node)                the emoji in node's text become their icons (done by itself, page-wide)
 */
(function (W) {
  'use strict';
  if (!W || W.WQA) return;
  var D = W.document;
  var ME = (D.currentScript && D.currentScript.src) || '';
  var V = (/[?&]v=([0-9a-f]+)/.exec(ME) || [])[1] || '0';

  // ── icons: 24×24, stroke 2, round joins; paths only ────────────────────────────────────────────────
  var P = {
    stories: 'M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1zM21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z',
    book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
    listen: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
    numbers: 'M4 4h16v16H4zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01',
    video: 'M3 6h18v12H3zM10 9v6l5-3z',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    lantern: 'M9 3h6M12 3v2M7 8a5 5 0 0 1 10 0v7a5 5 0 0 1-10 0zM9 20h6M12 10v3',
    share: 'M18 8a3 3 0 1 0-3-3M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
    home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
    back: 'M15 5l-7 7 7 7',
    speaker: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
    play: 'M7 4l13 8-13 8z',
    pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
    check: 'M4 12l5 5 11-11',
    gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
    close: 'M6 6l12 12M18 6L6 18',
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    mute: 'M6 16V11a6 6 0 0 1 9-5M18 11v5l2 2H8M10 21h4M3 3l18 18',
    trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6',
    mic: 'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3',
    school: 'M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5M12 9h.01',
    hand: 'M8 13V5a2 2 0 0 1 4 0v6M12 10a2 2 0 0 1 4 0v2M16 12a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a2 2 0 0 1 3-2l1 1',
    puzzle: 'M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4z',
    child: 'M12 3a3 3 0 1 0 .01 0M8 21v-6l-2-2 2-4h8l2 4-2 2v6',
    dot: 'M12 8a4 4 0 1 0 .01 0',
    // the class animals: one head shape, one tell each
    cat: 'M5 20v-9l2-7 4 4h2l4-4 2 7v9zM9 13h.01M15 13h.01M11 16h2',
    dog: 'M6 8l-3 6 3 2M18 8l3 6-3 2M6 8h12v8a6 6 0 0 1-12 0zM9 12h.01M15 12h.01M11 16h2',
    rabbit: 'M9 9V3M15 9V3M6 15a6 6 0 0 1 12 0 6 6 0 0 1-12 0zM10 14h.01M14 14h.01',
    parrot: 'M8 21V11a5 5 0 0 1 10 0l3 3-3 1v6zM14 10h.01',
    fish: 'M3 12c4-6 11-6 15 0-4 6-11 6-15 0zM18 12l3-3v6zM8 11h.01',
    turtle: 'M4 15a8 6 0 0 1 16 0zM20 13l2-1M7 15l-1 3M17 15l1 3M10 9l2 3 2-3',
    lion: 'M12 3l2 2 3-1 1 3 3 1-1 3 1 3-3 1-1 3-3-1-2 2-2-2-3 1-1-3-3-1 1-3-1-3 3-1 1-3 3 1zM10 11h.01M14 11h.01M11 14h2',
    elephant: 'M5 7a7 7 0 0 1 14 0v5a4 4 0 0 1-4 4v4h-2v-4M5 7v6l2 2M9 9h.01',
    owl: 'M6 4l3 3h6l3-3v12a6 6 0 0 1-12 0zM9.5 11a1.5 1.5 0 1 0 .01 0M14.5 11a1.5 1.5 0 1 0 .01 0M12 14v1',
    butterfly: 'M12 7v12M12 9C9 3 3 4 4 9s5 4 8 3M12 9c3-6 9-5 8 0s-5 4-8 3M12 13c-3 0-6 2-5 5s4 0 5-3M12 13c3 0 6 2 5 5s-4 0-5-3',
    bee: 'M7 10h10v6a5 5 0 0 1-10 0zM7 13h10M8 10l-3-4M16 10l3-4M10 6a2 2 0 0 1 4 0',
    horse: 'M8 21v-6L5 12l3-8 3 2h3a5 5 0 0 1 5 5v10zM10 9h.01',
    // the subjects
    science: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10',
    maths: 'M5 12h14M12 5v.01M12 19v.01',
    english: 'M4 19l5-14 5 14M6 14h6M15 9h5v10h-5z',
    urdu: 'M15 4v10a4 4 0 0 1-8 0',
    islamic: 'M4 20h16M6 20v-8a6 6 0 0 1 12 0v8M12 3v3M10 20v-4a2 2 0 0 1 4 0v4',
    gk: 'M12 3a9 9 0 1 0 .01 0M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    geography: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
    history: 'M6 3h12v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM6 21h12M9 10l-1 11M15 10l1 11'
  };
  // the emoji the child screens still draw, and the icon each becomes under the look (the swap below)
  var EMO = {
    '🐱': 'cat', '🐶': 'dog', '🐰': 'rabbit', '🦜': 'parrot', '🐟': 'fish', '🐢': 'turtle', '🦁': 'lion', '🐘': 'elephant', '🦉': 'owl', '🦋': 'butterfly', '🐝': 'bee', '🐴': 'horse',
    '🔬': 'science', '➗': 'maths', '⚖': 'maths', '🔤': 'english', '🕌': 'islamic', '🌍': 'gk', '🗺': 'geography', '📜': 'history',
    '📖': 'stories', '📚': 'book', '📒': 'book', '🎧': 'listen', '👂': 'listen', '🔢': 'numbers', '🧩': 'puzzle', '🏮': 'lantern', '🪔': 'lantern',
    '⭐': 'star', '🌟': 'star', '✨': 'star', '🎉': 'gift', '🎬': 'video', '🏠': 'home', '🏘': 'school', '🏫': 'school', '🧒': 'child', '🔊': 'speaker',
    '🔔': 'bell', '🔕': 'mute', '🏆': 'trophy', '🎤': 'mic', '👆': 'hand', '🙋': 'hand', '🟢': 'dot', '✓': 'check', '✕': 'close', '✗': 'close', '↩': 'back'
  };
  var EMO_RX = new RegExp('(' + Object.keys(EMO).join('|') + ')\\uFE0F?', 'g');
  var SUBJ = { Science: 'science', Maths: 'maths', English: 'english', Urdu: 'urdu', 'Islamic Studies': 'islamic', 'General Knowledge': 'gk', Geography: 'geography', History: 'history' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(name, label) {
    var d = P[name] || P.star;
    return '<svg class="wqa-i wqa-i-' + (P[name] ? name : 'star') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true" focusable="false"') + '><path d="' + d + '"/></svg>';
  }

  // ── motion ─────────────────────────────────────────────────────────────────────────────────────────
  function still() { try { return !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function move(el, name) {
    if (!el || !el.classList) return;
    var c = 'wqa-m-' + (still() ? 'fade' : name);
    el.classList.remove(c);
    void el.offsetWidth; // restart the animation
    el.classList.add(c);
    el.addEventListener('animationend', function off() { el.classList.remove(c); el.removeEventListener('animationend', off); });
  }

  // ── sound: the sound kit, fetched on the first cue (its own one switch) ────────────────────────────
  var KEY = 'wq_sound', KEY2 = 'wq_snd', kit = null, wait = [];
  function get(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function muted() { return W.WQJ ? W.WQJ.muted() : get(KEY) === 'false' || get(KEY2) === '0'; }
  function mute(b) {
    if (W.WQJ) return W.WQJ.mute(b);
    try { W.localStorage.setItem(KEY, b ? 'false' : 'true'); W.localStorage.setItem(KEY2, b ? '0' : '1'); } catch (e) { /* storage blocked */ }
  }
  function withKit(fn) {
    if (W.WQJ) return fn(W.WQJ);
    wait.push(fn);
    if (kit) return;
    var l = D.createElement('link');
    l.rel = 'stylesheet'; l.href = '/wq/wq-juice.css?v=' + V;
    var s = D.createElement('script');
    s.src = '/wq/wq-juice.js?v=' + V;
    s.onload = function () { var q = wait; wait = []; if (W.WQJ) q.forEach(function (f) { try { f(W.WQJ); } catch (e) { /* a cue never breaks a screen */ } }); };
    kit = s;
    D.head.appendChild(l);
    D.head.appendChild(s);
  }
  function cue(name, el) {
    if (muted() && name !== 'finish') return;
    withKit(function (J) {
      if (name === 'finish') J.finish({ el: el, kind: 'adv' });
      else if (name === 'badge') J.badge(el);
      else if (J[name]) J[name]({ el: el });
    });
  }
  function burst(el) {
    move(el, 'pop');
    if (still()) { cue('sentence'); return; }
    withKit(function (J) { if (!J.muted()) J.sentence(); J.confetti(); });
  }

  // ── small parts ────────────────────────────────────────────────────────────────────────────────────
  function bar(done, total, label) {
    var t = Math.max(1, Number(total) || 1), n = Math.max(0, Math.min(t, Number(done) || 0));
    return '<div class="wqa-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + t + '" aria-valuenow="' + n + '"' + (label ? ' aria-label="' + esc(label) + '"' : '') +
      '><i style="width:' + Math.round((n / t) * 100) + '%"></i></div>';
  }
  function badge(text, ic) { return '<span class="wqa-badge">' + icon(ic || 'star') + '<b>' + esc(text) + '</b></span>'; }

  var JUG_DIR = '/wq/jugnu/';

  // ── the emoji swap: every emoji a child screen draws becomes its icon (one stroke style on every phone; Android 9
  // draws some emoji as empty boxes). Text only: attributes (aria-label) and form fields are left as they are.
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, svg: 1, SVG: 1 };
  function swapText(t) {
    var v = t.nodeValue;
    EMO_RX.lastIndex = 0;
    if (!v || !EMO_RX.test(v)) return;
    var box = D.createElement('span');
    box.innerHTML = esc(v).replace(EMO_RX, function (m, e) { return icon(EMO[e]); });
    var f = D.createDocumentFragment();
    while (box.firstChild) f.appendChild(box.firstChild);
    t.parentNode.replaceChild(f, t);
  }
  function swap(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.parentNode && !SKIP[root.parentNode.nodeName]) swapText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    var w = D.createTreeWalker(root, 4, null), list = [], n;
    while ((n = w.nextNode())) if (!SKIP[n.parentNode.nodeName] && !(n.parentNode.closest && n.parentNode.closest('svg'))) list.push(n);
    list.forEach(swapText);
  }
  function watch() {
    if (!D.documentElement.classList.contains('wq-adv') || !D.body) return;
    swap(D.body);
    scan(D.body);
    if (!W.MutationObserver) return;
    new W.MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') swap(m.target);
        else for (var i = 0; i < m.addedNodes.length; i++) { swap(m.addedNodes[i]); scan(m.addedNodes[i]); }
      });
    }).observe(D.body, { childList: true, subtree: true, characterData: true });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', watch); else watch();

  // ── tones: WebAudio, no files (the stamp's two blips, the soft not-yet); after a gesture, never when muted ─────
  var actx = null;
  var TONES = { stamp: [['sine', 784, 0], ['sine', 1175, 0.13]], notyet: [['triangle', 220, 0, 0.3]] };
  function tone(name) {
    var list = TONES[name];
    if (!list || muted()) return;
    try {
      var C = W.AudioContext || W.webkitAudioContext;
      if (!C) return;
      actx = actx || new C();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      list.forEach(function (t) {
        var o = actx.createOscillator(), g = actx.createGain(), at = actx.currentTime + t[2], len = t[3] || 0.12;
        o.type = t[0];
        o.frequency.setValueAtTime(t[1], at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g); g.connect(actx.destination);
        o.start(at); o.stop(at + len + 0.02);
      });
    } catch (e) { /* a sound never breaks a screen */ }
  }

  // ── stamps: the one "you finished something" hook. Every finished story, reading, game, quiz or video calls
  // WQA.stamp(kind): the land's stamp is kept on this phone (Home's trail shows it), the two blips play, and the
  // answer is the share card's centre element for that deed (n.b. never a number).
  var LAND = { story: 'stories', book: 'stories', read: 'stories', game: 'games', quiz: 'games', challenge: 'games', video: 'videos', lesson: 'videos' };
  var LANDS = ['stories', 'games', 'videos'];
  var LAND_N = { stories: 1, games: 2, videos: 3 }, LAND_V = { stories: 'st', games: 'gm', videos: 'vd' };
  var LAND_I = { stories: 'stories', games: 'puzzle', videos: 'video' };
  var SKEY = 'wqa_stamps';
  function stamps() { try { return JSON.parse(W.localStorage.getItem(SKEY) || '{}') || {}; } catch (e) { return {}; } }
  function stampSvg(land) {
    var v = '--land-' + LAND_V[land], c = 'var(' + v + ')';
    return '<svg class="wqa-stamp wqa-stamp-' + land + '" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="30" fill="var(--card)" stroke="' + c +
      '" stroke-width="3" stroke-dasharray="3 3"/><circle cx="32" cy="32" r="24" fill="var(' + v + '-bg)" stroke="' + c + '" stroke-width="4"/><circle cx="32" cy="32" r="18" fill="none" stroke="' + c +
      '" stroke-width="1.5" stroke-dasharray="1 3"/><g transform="translate(20 20)" fill="none" stroke="' + c + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + P[LAND_I[land]] + '"/></g></svg>';
  }
  function stamp(kind, quiet) {
    var land = LAND[kind];
    if (!land) return null;
    var all = stamps();
    all[land] = { kind: kind, at: Date.now() };
    try { W.localStorage.setItem(SKEY, JSON.stringify(all)); } catch (e) { /* storage blocked: the stamp still shows */ }
    if (!quiet) tone('stamp');
    return { kind: kind, land: land, svg: stampSvg(land) };
  }

  // ── Home's map: a trail of the three lands (the newest stamp in each, or an empty ring; the next stop glows) ──
  function trail(names, next) {
    var got = stamps();
    return '<nav class="wqa-trail" aria-label="' + esc(LANDS.map(function (l) { return names[l]; }).join(' · ')) + '">' + LANDS.map(function (l) {
      return '<a class="wqa-stop wqa-l' + LAND_N[l] + (got[l] ? ' on' : '') + (l === next ? ' next' : '') + '" href="#' + l + '" data-tap="door" data-door="' + l + '"><i>' +
        (got[l] ? stampSvg(l) : icon(LAND_I[l])) + '</i><span>' + esc(names[l]) + '</span></a>';
    }).join('') + '</nav>';
  }
  var UR = function () { return D.documentElement.lang === 'ur'; };
  var SAY = { en: { next: 'Next stop!', got: 'New stamp!', go: "Let's go!", stories: 'Stories', games: 'Games', videos: 'Videos' },
    ur: { next: 'اگلی منزل!', got: 'نئی مہر!', go: 'آئیں چلیں!', stories: 'کہانیاں', games: 'کھیل', videos: 'ویڈیوز' } };
  function say() { return SAY[UR() ? 'ur' : 'en']; }
  function dress(home) {
    var nx = home.querySelector('.wq-next');
    if (!nx || home.querySelector('.wqa-trail')) return;
    var t = say(), names = {};
    LANDS.forEach(function (l) { var d = D.querySelector('.wq-door[data-door="' + l + '"] span'); names[l] = (d && d.textContent) || t[l]; });
    var go = nx.querySelector('.wq-ngo');
    if (go) go.insertAdjacentHTML('beforeend', '<b>' + esc(t.go) + '</b>');
    nx.insertAdjacentHTML('beforeend', '<span class="wqa-bub" aria-hidden="true"><span>' + esc(t.next) + '</span><img src="' + JUG_DIR + 'hello.webp" alt="" width="56" height="56"></span>');
    nx.insertAdjacentHTML('afterend', trail(names, LAND[nx.getAttribute('data-kind')] || 'games'));
  }
  // a finished thing's card (the finish card, or the moment): its stamp pops in under the deed, once per card
  function deedOf(card) {
    var k = card.getAttribute('data-deed');
    if (k) return k;
    if (/^\/q\//.test(W.location && W.location.pathname)) return 'quiz';
    return card.querySelector('.wqfc-cov') ? 'story' : 'game';
  }
  var lastStamp = { kind: null, at: 0 };
  function award(card) {
    if (card.getAttribute('data-wqa')) return;
    card.setAttribute('data-wqa', '1');
    // a try that certified nothing (read_tried: no Share on the card; a 0-word read: the moment's try badge): no stamp
    if (card.querySelector('[data-badge=try]') || !card.querySelector('.wqfc-share,.wq-moment-deed')) return;
    // the reading moment: its badge is the stamp's slot (no row: a long Urdu read has ~5 px under Next at 360) and
    // no second sound (the moment plays its own, once per result)
    var badge = card.querySelector('.wq-moment-badge');
    if (!badge && D.querySelector && D.querySelector('.wq-moment-badge')) return; // a moment beside it carries the stamp
    if (badge) {
      var m = stamp('read', true);
      if (m) badge.setAttribute('data-wqa-stamp', m.land);
      return;
    }
    var kind = deedOf(card), now = Date.now();
    var s = kind === lastStamp.kind && now - lastStamp.at < 15000 ? { land: LAND[kind], svg: stampSvg(LAND[kind]) } : stamp(kind);
    if (!s) return;
    lastStamp = { kind: kind, at: now };
    var head = card.querySelector('.wqfc-deed,.wq-moment-deed,h1,h2');
    var html = '<p class="wqa-got" role="status">' + s.svg + '<b>' + esc(say().got) + '</b></p>';
    if (head) head.insertAdjacentHTML('afterend', html); else card.insertAdjacentHTML('afterbegin', html);
  }
  // the class table's "how you moved" line (<p class="wq-move" data-move="up|same|down">): a move up gets the stamp
  // ring at its start and the stamp blip, once; the same place or a move down gets nothing (only a climb is celebrated)
  function climb(el) {
    if (el.getAttribute('data-move') !== 'up' || el.getAttribute('data-wqa')) return;
    el.setAttribute('data-wqa', '1');
    el.insertAdjacentHTML('afterbegin', '<span class="wqa-climb">' + stampSvg('games') + '</span>');
    tone('stamp');
  }
  // a land tile with no picture gets its icon (a game: numbers; a story: the book; a quiz: the star; a subject: its own)
  var ROW_I = { game: 'numbers', passage: 'stories', quiz: 'star', video: 'video', lesson: 'video', book: 'book' };
  function rowArt(row) {
    if (row.querySelector('.wq-rart,.wqa-art')) return;
    var k = row.getAttribute('data-kind');
    var ic = k === 'subject' ? SUBJ[row.getAttribute('data-item')] : ROW_I[k];
    row.insertAdjacentHTML('afterbegin', '<span class="wqa-art">' + icon(ic || 'star') + '</span>');
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('.wq-dli .wq-drow') : []).forEach(rowArt);
    var home = root.matches && root.matches('section.wq-home[data-screen=home]') ? root : root.querySelector && root.querySelector('section.wq-home[data-screen=home]');
    if (home) dress(home);
    var cards = root.matches && root.matches('.wqfc[data-screen=card],.wq-moment') ? [root] : Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('.wqfc[data-screen=card],.wq-moment') : []);
    cards.forEach(award);
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('.wq-move[data-move=up]') : []).forEach(climb);
  }

  W.WQA = {
    icon: icon, animal: function (k) { return icon(P[k] ? k : 'star'); }, subject: function (s) { return icon(SUBJ[s] || 'star'); },
    bar: bar, badge: badge, move: move, cue: cue, burst: burst, muted: muted, mute: mute, still: still, swap: swap, P: P, EMO: EMO,
    stamp: stamp, stamps: stamps, stampSvg: stampSvg, tone: tone, trail: trail, award: award, climb: climb
  };
})(typeof window !== 'undefined' ? window : null);
