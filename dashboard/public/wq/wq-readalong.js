/**
 * Read-along: Jugnu reads, and a green pill moves from word to word as each word is spoken.
 *
 *   var p = WQReadAlong.mount(el, data, { mode, leadMs, labels, onWord, onEnd, onState, onWordTap, tap, lines, gaps });
 *   p.play(); p.pause(); p.toggle(); p.replay(); p.seekToWord(i); p.playWord(i); p.slow(on, gaps); p.destroy();
 *
 * `data` is a timing object {v, id, lang, dir, audio:{url, ms, mime}, words:[{i, t, s_ms, e_ms, box?}], image?:{url, w, h},
 * quality?} (made by scripts/web-quiz/readalong-build.js), or a URL that returns one. Three modes, one clock, ONE pill:
 *   text   — one span per printed word; the current word gets the pill.
 *   image  — the page's picture with ONE pill moved over the printed word's box (image px scaled to the shown size).
 *   band   — opts.band {url, x, y, w, h} (the page's text-band crop and its rectangle in picture px) is drawn INSTEAD of
 *            the picture, with the same one pill on the boxes moved into it. The caller hides the print it replaces; a
 *            band is never drawn beside a visible print (one text on a page).
 * quality "low" (word times not trusted): the pill lights the whole printed LINE of the word being read, not the word.
 * The clock is the audio element: while playing, one requestAnimationFrame loop reads audio.currentTime and moves the
 * pill only when the word changes (≤ 1 frame late, no layout work per frame). The pill leads the sound by `leadMs`.
 * tap 'sentence': a tapped word replays its sentence (a "low" page: the lines it spans; `lines`: the page's own), lit as it plays.
 * gaps {sentence, comma} [target, least] ms (true: [700,500]/[400,250]), opt-in: the clip waits after a sentence end, a comma
 * or a line end, the pill on its word, for the target less its own pause, never under the least; play, pause, a seek or destroy drops it.
 * p.slowed is set once the clip has waited at one (the storybook's slow: 1 in its page-listened event).
 * Never autoplays: the first play() must run inside the child's tap (the in-app browser's audio unlock).
 * Fires window event 'wq:readalong' {type: started|word|finished|paused|resumed|tap_word, i, id}.
 */
(function () {
  'use strict';

  var CSS = '.wqra{position:relative;margin:8px 0 12px}'
    + '.wqra-text{font-size:24px;line-height:2.1;font-weight:700;color:#111827;unicode-bidi:isolate}'
    + '.wqra-text[dir=rtl]{font-size:22px;line-height:2.3;font-weight:400}'
    + '.wqra-w{display:inline-block;padding:0 4px;margin:2px 0;border-radius:8px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '.wqra-w.wqra-on{background:#BBF7D0;color:#14532D;box-shadow:0 0 0 2px #BBF7D0}'
    + '.wqra-pic{position:relative;line-height:0}'
    + '.wqra-pic img{width:100%;height:auto;display:block;border-radius:12px}'
    // a tight box on the word: colour at once, the box slides 100 ms (JUICE §2); no glow, nothing drawn outside the box
    + '.wqra-pill{position:absolute;left:0;top:0;border-radius:8px;background:rgba(187,247,208,.3);'
    + 'box-shadow:inset 0 0 0 3px #15803D;opacity:0;pointer-events:none;transition:transform .1s ease,width .1s ease,height .1s ease}'
    // a host that asks for it (data-ring: the storybook reader's polish setting) gets the ring round the word, off its letters
    + '[data-ring] .wqra-pill{box-shadow:none;outline:3px solid #15803D;outline-offset:4px}'
    + '.wqra-hit{position:absolute;background:transparent;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '.wqra-ctl{display:flex;justify-content:center;margin-top:10px}'
    + '.wqra-btn{width:64px;height:64px;border-radius:50%;border:0;background:#15803D;color:#fff;font-size:26px;line-height:64px;padding:0;cursor:pointer}'
    + '.wqra-btn.wqra-pulse{animation:wqra-p 1.2s ease-in-out infinite}'
    + '@keyframes wqra-p{50%{transform:scale(1.08)}}'
    + '@media (prefers-reduced-motion:reduce){.wqra-w,.wqra-pill{transition:none}.wqra-btn.wqra-pulse{animation:none}}';

  // a sentence's end (= sentenceOf below) and a comma, either before closing quotes or brackets
  var END_RX = /[.!?\u06D4\u061F]["'\u201D\u2019)\u00BB]*$/;
  var COMMA_RX = /[,\u060C;\u061B]["'\u201D\u2019)\u00BB]*$/;
  var METHODS = ['play', 'pause', 'toggle', 'replay', 'seekToWord', 'playWord', 'destroy'];
  var ICON = { play: '▶', pause: '❚❚', replay: '↻' };
  var LABEL = { play: 'Play', pause: 'Pause', replay: 'Again' };

  function injectCss() {
    if (document.getElementById('wqra-css')) return;
    var s = document.createElement('style');
    s.id = 'wqra-css';
    s.textContent = CSS;
    (document.head || document.body).appendChild(s);
  }

  /** The timing object, checked: words in order with whole numbers, or an Error naming what is wrong. */
  function parse(d) {
    if (typeof d === 'string' && d.charAt(0) === '{') { try { d = JSON.parse(d); } catch (e) { d = null; } }   // the file as its JSON text
    if (!d || typeof d !== 'object') throw new Error('readalong: no data');
    if (d.v !== 1) throw new Error('readalong: version ' + d.v);
    // audio null = a page not voiced yet: its words show, nothing plays
    if (d.audio != null && (typeof d.audio.url !== 'string' || !d.audio.url)) throw new Error('readalong: no audio');
    if (!Array.isArray(d.words) || !d.words.length) throw new Error('readalong: no words');
    var prev = -1;
    var words = d.words.map(function (w, k) {
      var s = Number(w && w.s_ms);
      var e = Number(w && w.e_ms);
      if (!w || w.i !== k) throw new Error('readalong: word ' + k + ' out of order');
      if (!isFinite(s) || !isFinite(e) || s < 0 || e < s || s < prev) throw new Error('readalong: word ' + k + ' bad time');
      prev = s;
      var box = Array.isArray(w.box) && w.box.length === 4 && w.box.every(function (n) { return isFinite(Number(n)); }) ? w.box.map(Number) : null;
      var o = { i: k, t: String(w.t == null ? '' : w.t), s: s, e: e, box: box };
      if (w.silent) o.sil = true;   // not read aloud: never lit
      return o;
    });
    var img = d.image && d.image.url && d.image.w > 0 && d.image.h > 0 ? { url: String(d.image.url), w: Number(d.image.w), h: Number(d.image.h) } : null;
    return { id: d.id == null ? null : String(d.id), lang: d.lang === 'ur' ? 'ur' : 'en', dir: d.dir === 'rtl' || (d.dir == null && d.lang === 'ur') ? 'rtl' : 'ltr',
      audio: d.audio == null ? null : { url: d.audio.url, ms: Number(d.audio.ms) || 0 }, words: words, image: img, quality: d.quality === 'low' ? 'low' : 'word' };
  }

  /** The word lit at t ms (the lead already added): the last word whose start ≤ t; −1 before the first. */
  function indexAt(words, t) {
    var lo = 0;
    var hi = words.length - 1;
    var at = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (words[mid].s <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    while (at >= 0 && words[at].sil) at -= 1;
    return at;
  }

  function emit(type, i, id) {
    try { window.dispatchEvent(new CustomEvent('wq:readalong', { detail: { type: type, i: i, id: id } })); } catch (e) { /* no CustomEvent: events are optional */ }
  }

  function getJson(url, cb) {
    fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (d) { cb(null, d); }, function (e) { cb(e); });
  }

  function mount(el, dataOrUrl, opts) {
    opts = opts || {};
    var api = { state: 'loading', current: -1 };
    if (typeof dataOrUrl === 'string') {
      // until the timings arrive, calls are queued; build() then puts the real methods on this same object
      var queued = [];
      METHODS.forEach(function (k) { api[k] = function () { queued.push([k, arguments]); }; });
      getJson(dataOrUrl, function (err, d) {
        if (err) { api.state = 'error'; if (opts.onState) opts.onState('error'); return; }
        build(el, d, opts, api);
        queued.forEach(function (q) { api[q[0]].apply(api, q[1]); });
      });
      return api;
    }
    return build(el, dataOrUrl, opts, api);
  }

  function build(el, raw, opts, api) {
    var d;
    var quality = raw && raw.quality === 'low' ? 'low' : 'word';
    try { d = parse(raw); } catch (e) {
      api.state = 'error';
      if (opts.onState) opts.onState('error');
      METHODS.forEach(function (k) { api[k] = function () {}; });
      return api;
    }
    injectCss();
    var words = d.words;
    // the story reader's names for the same options: overlay|strip, lead_ms, onFinished
    var mode = { overlay: 'image', strip: 'text' }[opts.mode] || opts.mode;
    var leadAsked = opts.leadMs == null ? opts.lead_ms : opts.leadMs;
    var onEnd = opts.onEnd || opts.onFinished;
    var lead = leadAsked == null ? 50 : Math.max(0, Math.min(90, Number(leadAsked) || 0));
    var labels = opts.labels || {};
    var boxed = words.every(function (w) { return w.box; });
    var bd = opts.band;
    // the surface the pill is drawn on: the picture, or (mode band) the text-band crop in its place — never both
    var surf = mode === 'band' && boxed && bd && bd.url && bd.w > 0 && bd.h > 0 ? { url: String(bd.url), w: Number(bd.w), h: Number(bd.h), x: Number(bd.x) || 0, y: Number(bd.y) || 0, band: true }
      : (mode == null || mode === 'image' || mode === 'band') && d.image && boxed ? { url: d.image.url, w: d.image.w, h: d.image.h, x: 0, y: 0 } : null;
    var useImage = !!surf;
    var lines = null;      // quality low: [first word, last word, box] per printed line
    var raf = window.requestAnimationFrame ? function (f) { return window.requestAnimationFrame(f); } : function (f) { return setTimeout(f, 16); };
    var unraf = window.cancelAnimationFrame ? function (h) { window.cancelAnimationFrame(h); } : function (h) { clearTimeout(h); };
    var loop = null;
    var stopAt = null;       // playWord: pause when the clock passes this ms
    var stopI = -1;          // ...and the slice's last word: the lead never lights the word after it
    var finished = false;
    var started = false;
    var dead = false;
    var spans = [];
    var pill = null;
    var img = null;
    var gapAt = {};          // word → ms to wait after it
    var gf = 0;              // gaps count from this ms
    var hold = null;

    function mk(tag, cls, attrs, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      return n;
    }
    var root = mk('div', 'wqra', { 'data-wqra': d.id || '' });
    if (useImage) {
      var pic = mk('div', 'wqra-pic', {});
      img = mk('img', '', { src: surf.url, alt: '', width: String(surf.w), height: String(surf.h) });
      pill = mk('span', 'wqra-pill', {});
      pic.appendChild(img);
      pic.appendChild(pill);
      words.forEach(function (w) { var b = mk('button', 'wqra-hit', { type: 'button', 'data-i': String(w.i), 'aria-label': w.t }); spans.push(b); pic.appendChild(b); });
      root.appendChild(pic);
    } else {
      var tx = mk('div', 'wqra-text', { dir: d.dir, lang: d.lang });
      words.forEach(function (w, k) {
        if (k) tx.appendChild(document.createTextNode(' '));
        var sp = mk('span', 'wqra-w', { 'data-i': String(w.i) }, w.t);
        spans.push(sp);
        tx.appendChild(sp);
      });
      root.appendChild(tx);
    }
    var btn = null;
    if (d.audio) {
      var ctl = mk('div', 'wqra-ctl', {});
      btn = mk('button', 'wqra-btn', { type: 'button', 'aria-label': labels.play || LABEL.play, 'data-ic': 'play' }, ICON.play);
      ctl.appendChild(btn);
      root.appendChild(ctl);
    }
    el.innerHTML = '';
    el.appendChild(root);
    if (useImage) {
      placeHits();
      img.addEventListener('load', placeHits);
    }
    window.addEventListener('resize', placeHits);
    if (!d.audio) {
      api.state = 'silent';
      if (opts.onState) opts.onState('silent');
      METHODS.forEach(function (k) { api[k] = function () {}; });
      api.destroy = function () { window.removeEventListener('resize', placeHits); el.innerHTML = ''; };
      api.mode = surf ? (surf.band ? 'band' : 'image') : 'text';
      api.quality = quality;
      return api;
    }

    var audio = new Audio();
    audio.preload = 'auto';
    audio.src = d.audio.url;
    setGaps(opts.gaps);

    // image px → shown px: the picture keeps its ratio (width 100%), so one scale for x and y
    function scale() {
      var w = img && (img.clientWidth || (img.getBoundingClientRect && img.getBoundingClientRect().width));
      return w > 0 ? w / surf.w : 0;
    }
    // a word's box on the surface (picture px moved into the band), or null when it lies outside the band
    function onSurf(b) {
      if (!b) return null;
      var r = [b[0] - surf.x, b[1] - surf.y, b[2], b[3]];
      return r[0] < -0.5 || r[1] < -0.5 || r[0] + r[2] > surf.w + 0.5 || r[1] + r[3] > surf.h + 0.5 ? null : r;
    }
    // printed lines (quality low), from the boxes
    function lineBoxes() { return boxLines(words); }
    // the same in text mode, from where the browser wrapped the words
    function lineSpans() {
      var out = [];
      spans.forEach(function (sp, k) {
        var top = sp.offsetTop;
        var cur = out[out.length - 1];
        if (cur && cur[2] === top) cur[1] = k; else out.push([k, k, top]);
      });
      return out;
    }
    // a sentence tap's line: the page's own (opts.lines), else as printed
    function tapLine(i) {
      var L = opts.lines || [];
      for (var k = 0; k < L.length; k += 1) if (i >= L[k][0] && i <= L[k][1]) return L[k];
      return lineOf(i) || [i, i];
    }
    function lineOf(i) {
      if (!lines) lines = useImage ? lineBoxes() : lineSpans();
      for (var j = 0; j < lines.length; j += 1) if (i >= lines[j][0] && i <= lines[j][1]) return lines[j];
      return null;
    }
    function boxStyle(b, k, padTo) {
      var x = b[0] * k + 2;
      var y = b[1] * k + 2;
      var w = Math.max(0, b[2] * k - 4);
      var h = Math.max(0, b[3] * k - 4);
      if (padTo && h < padTo) { y -= (padTo - h) / 2; h = padTo; }
      return { x: x, y: y, w: w, h: h };
    }
    function placeHits() {
      lines = useImage ? lines : null;   // text mode: the browser may wrap the words differently now
      if (!useImage) return;
      var k = scale();
      if (!k) return;
      for (var j = 0; j < spans.length; j += 1) {
        var on = onSurf(words[j].box);
        var st = spans[j].style;
        if (!on) { st.display = 'none'; continue; }
        var r = boxStyle(on, k, 40);
        st.display = ''; st.left = r.x + 'px'; st.top = r.y + 'px'; st.width = r.w + 'px'; st.height = r.h + 'px';
      }
      if (api.current >= 0) paint(api.current, true);
    }

    function setGaps(g) {
      // a wait only at punctuation (a sentence end or a comma), never where a printed line merely wraps mid-sentence
      var last = indexAt(words, 1e9);
      gapAt = {}; gf = audio.currentTime * 1000 || 0;
      if (g === true) g = { sentence: [700, 500], comma: [400, 250] };
      // [target, least]: the wait is max(least, target − the clip's own pause (next start − this end)); none where the timings overlap
      if (g) words.forEach(function (w, k) { var n = k < last && !w.sil ? words[k + 1].s - w.e : -1, v = END_RX.test(w.t) ? g.sentence : COMMA_RX.test(w.t) ? g.comma : 0; if (n >= 0 && v) gapAt[k] = Math.max(v[1], v[0] - n); });
    }
    function unhold() { clearTimeout(hold); hold = null; }
    function resume() { hold = null; if (!dead && api.state === 'playing') play(1); }

    function paint(i, force) {
      if (i === api.current && !force) return;
      var was = api.current;
      api.current = i;
      if (useImage) {
        var k = scale();
        var on = i >= 0 ? onSurf(quality === 'low' ? lineOf(i)[2] : words[i].box) : null;
        if (!on || !k) { pill.style.opacity = '0'; } else {
          var r = boxStyle(on, k, 0);
          pill.style.width = r.w + 'px'; pill.style.height = r.h + 'px';
          pill.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
          pill.style.opacity = '1';
        }
      } else {
        var a = quality === 'low' && was >= 0 ? lineOf(was) : [was, was];
        var z = quality === 'low' && i >= 0 ? lineOf(i) : [i, i];
        for (var j = a[0]; j >= 0 && j <= a[1]; j += 1) if (spans[j]) spans[j].className = 'wqra-w';
        for (j = z[0]; j >= 0 && j <= z[1]; j += 1) if (spans[j]) spans[j].className = 'wqra-w wqra-on';
      }
      if (i !== was && !force) {
        if (opts.onWord) opts.onWord(i);
        if (i >= 0) emit('word', i, d.id);
      }
    }

    function setState(s) {
      if (api.state === s) return;
      api.state = s;
      var icon = s === 'playing' ? 'pause' : s === 'ended' ? 'replay' : 'play';
      btn.textContent = ICON[icon];
      btn.setAttribute('data-ic', icon);   // the look (wq.css) draws it
      btn.setAttribute('aria-label', labels[icon] || LABEL[icon]);
      btn.className = 'wqra-btn' + (s === 'blocked' ? ' wqra-pulse' : '');
      if (opts.onState) opts.onState(s === 'blocked' ? 'paused' : s);
    }

    /** One frame: the word under the clock (+ lead); the end once, when the last word is over. */
    function tick() {
      loop = null;
      if (dead) return;
      var t = (audio.currentTime || 0) * 1000;
      if (stopAt != null && t >= stopAt) { stopAt = null; pause(); return; }
      var i = indexAt(words, t + lead);
      if (stopAt != null && stopI >= 0 && i > stopI) i = stopI;
      // the next gap the clip has not reached (none while one word or sentence plays): the pill never passes it
      // the clip stops mid-silence after the word (an early end time never clips the word)
      for (var k in gapAt) if (stopAt == null && gapAt[k] && words[k].e > gf) { var at = Math.max(words[k].e, (words[k].e + words[+k + 1].s) / 2); if (i > k) i = +k; if (t >= at) { paint(+k); audio.pause(); gf = words[k].e; api.slowed = 1; hold = setTimeout(resume, gapAt[k]); return; } break; }
      paint(i);
      // the end: the audio's own 'ended', or (a stream that never says it) the clock past the stored length
      if (!finished && d.audio.ms > 0 && t >= d.audio.ms) { finish(); return; }
      if (api.state === 'playing') loop = raf(tick);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (loop) { unraf(loop); loop = null; }
      stopAt = null;
      unhold();
      // rewound at once, paused: a clip left "ended" makes the browser's next play() jump to 0 after any seek we make
      try { audio.pause(); audio.currentTime = 0; } catch (e) { /* already stopped */ }
      paint(-1);
      setState('ended');
      emit('finished', -1, d.id);
      if (onEnd) onEnd();
    }

    function play(r) {
      if (dead) return;
      if (finished) { finished = false; try { audio.currentTime = 0; } catch (e) { /* not seekable yet */ } }
      if (!r) { unhold(); gf = audio.currentTime * 1000 || 0; }
      var first = !started;
      started = true;
      var pr;
      try { pr = audio.play(); } catch (e) { pr = null; setState('blocked'); return; }
      setState('playing');
      if (!r) emit(first ? 'started' : 'resumed', api.current, d.id);
      if (!loop) loop = raf(tick);
      if (pr && pr.catch) pr.catch(function () { if (!dead && api.state === 'playing') { setState('blocked'); } });
    }
    function pause() {
      if (dead) return;
      unhold();
      try { audio.pause(); } catch (e) { /* already stopped */ }
      if (loop) { unraf(loop); loop = null; }
      if (api.state === 'playing') { setState('paused'); emit('paused', api.current, d.id); }
    }
    // play, THEN seek: play() on a clip that has ended starts it again from 0 and would undo a seek made before it
    function playFrom(ms, i) {
      stopAt = null;
      finished = false;
      play();
      try { audio.currentTime = Math.max(0, ms) / 1000; } catch (e) { /* not seekable yet */ }
      gf = Math.max(0, ms);
      paint(i);
    }
    function seekToWord(i) {
      if (dead || !(i >= 0 && i < words.length)) return;
      playFrom(words[i].s - lead, i);
    }

    btn.addEventListener('click', function () { api.toggle(); });
    for (var j = 0; j < spans.length; j += 1) {
      (function (i) {
        spans[i].addEventListener('click', function () {
          // the sentence; a "low" page: its whole lines (their ends are the pauses we trust)
          if (opts.tap === 'sentence' && !dead) {
            var r = sentenceOf(words, i);
            if (quality === 'low') r = [tapLine(r[0])[0], tapLine(r[1])[1]];
            playFrom(words[r[0]].s - lead, r[0]);
            stopAt = words[r[1]].e; stopI = r[1];
          } else seekToWord(i);
          emit('tap_word', i, d.id);
          if (opts.onWordTap) opts.onWordTap(i);
        });
      }(j));
    }
    var onEnded = function () { finish(); };
    var onError = function () { if (dead) return; if (loop) { unraf(loop); loop = null; } paint(-1); setState('error'); btn.style.display = 'none'; };
    var onHide = function () { if (document.visibilityState === 'hidden') pause(); };
    var onPageHide = function () { pause(); };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    api.play = play;
    api.pause = pause;
    api.toggle = function () { if (api.state === 'playing') pause(); else play(); };
    api.replay = function () { finished = true; play(); };
    api.seekToWord = seekToWord;
    // one word in the same voice (a missed word, a tapped word): play from its start, stop at its end; never on a
    // "low" file (its word times are not trusted: a slice could say the neighbour or half a word)
    api.playWord = function (i) {
      if (dead || quality === 'low' || !(i >= 0 && i < words.length)) return;
      playFrom(words[i].s, i);
      stopAt = words[i].e; stopI = i;
    };
    // the storybook's Slower: with gaps (its switch) the voice keeps its own speed and waits between phrases; else the old stretch
    api.slow = function (on, g) { audio.playbackRate = on && !g ? 0.85 : 1; audio.preservesPitch = true; setGaps(on && g); };
    api.destroy = function () {
      if (dead) return;
      pause();
      dead = true;
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('resize', placeHits);
      try { audio.removeAttribute('src'); audio.load(); } catch (e) { /* nothing to drop */ }
      el.innerHTML = '';
    };
    api._tick = tick;   // tests drive the clock
    api.audio = audio;
    api.mode = surf ? (surf.band ? 'band' : 'image') : 'text';
    api.quality = quality;
    setState('ready');
    return api;
  }

  /** Warm the next page's audio (one request, no decode). */
  function preload(data) {
    try { var a = new Audio(); a.preload = 'auto'; a.src = (typeof data === 'string' ? data : data.audio.url); return a; } catch (e) { return null; }
  }

  /** One word in Jugnu's voice with nothing drawn (a skipped word tapped after a read): play, then seek to its start,
   *  pause once the clock passes its end. Call it inside the tap. Null when there is nothing to say. */
  function sayWord(data, i) {
    var d;
    try { d = parse(data); } catch (e) { return null; }
    if (!d.audio || (d.quality || (data && data.quality)) === 'low' || !okI(i, d.words.length)) return null;
    return clip(d.audio.url, d.words[i].s, d.words[i].e);
  }
  // one Audio on the signed URL, inside the caller's tap: play, seek to s, pause past e, then dropped
  function clip(url, s, e) {
    var a = new Audio();
    var raf = window.requestAnimationFrame ? function (f) { return window.requestAnimationFrame(f); } : function (f) { return setTimeout(f, 16); };
    var done = false;
    function stop() { if (done) return; done = true; try { a.pause(); a.removeAttribute('src'); a.load(); } catch (x) { /* gone */ } }
    (function watch() { if (done) return; if ((a.currentTime || 0) * 1000 >= e + 10) { stop(); return; } raf(watch); }());
    a.src = url;
    try { var pr = a.play(); if (pr && pr.catch) pr.catch(stop); } catch (x) { stop(); return null; }
    try { a.currentTime = s / 1000; } catch (x) { /* not seekable yet */ }
    return { stop: stop };
  }
  // a whole-number index on the page (never null, 1.5 or '1')
  function okI(i, n) { return i === (i | 0) && i >= 0 && i < n; }
  // [first, last] word of i's sentence (. ! ? ۔ ؟); a silent word never starts or ends one (= wq-stories-q.js sents)
  function sentenceOf(ws, i) {
    var end = function (k) { return !ws[k].sil && /[.!?\u06D4\u061F]["'\u201D\u2019)\u00BB]*$/.test(ws[k].t); };
    var a = i;
    var b = i;
    while (a > 0 && !end(a - 1)) a -= 1;
    while (b < ws.length - 1 && !end(b)) b += 1;
    while (a < b && ws[a].sil) a += 1;
    while (b > a && ws[b].sil) b -= 1;
    return [a, b];
  }
  // printed lines from the words' boxes: a word whose box's middle falls outside the line so far starts the next line
  function boxLines(words) {
    var out = [];
    words.forEach(function (w, k) {
      var b = w.box;
      var cur = out[out.length - 1];
      var mid = b[1] + b[3] / 2;
      if (cur && mid >= cur[2][1] && mid <= cur[2][1] + cur[2][3]) {
        var x0 = Math.min(cur[2][0], b[0]);
        var y0 = Math.min(cur[2][1], b[1]);
        cur[2] = [x0, y0, Math.max(cur[2][0] + cur[2][2], b[0] + b[2]) - x0, Math.max(cur[2][1] + cur[2][3], b[1] + b[3]) - y0];
        cur[1] = k;
      } else out.push([k, k, b.slice()]);
    });
    return out;
  }
  /**
   * Say the printed line holding word i, with nothing drawn (a tapped word on a page whose word times are not trusted:
   * a line's ends sit on pauses both aligners agree on). The line: the page's own [first, last] when it holds i; else
   * from the words' boxes (a picture page); else the sentence. Back: {stop, from, to} for the page to light, or null.
   */
  function sayLine(data, i, line) {
    var d;
    try { d = parse(data); } catch (e) { return null; }
    var ws = d.words;
    if (!d.audio || !okI(i, ws.length)) return null;
    var r = null;
    if (line && line[0] >= 0 && line[0] <= i && i <= line[1] && line[1] < ws.length) r = [line[0], line[1]];
    else if (ws.every(function (w) { return w.box; })) boxLines(ws).forEach(function (l) { if (i >= l[0] && i <= l[1]) r = l; });
    else r = sentenceOf(ws, i);
    var h = clip(d.audio.url, ws[r[0]].s, ws[r[1]].e);
    return h && { stop: h.stop, from: r[0], to: r[1] };
  }

  window.WQReadAlong = { mount: mount, parse: parse, indexAt: indexAt, preload: preload, sayWord: sayWord, sayLine: sayLine };
}());
