/* Web child quiz page. Vanilla JS, no framework, no build step.
 * Reads the quiz from <script id="boot">, talks to /api/wq/*, and keeps the
 * child's answers in a local queue so a weak connection never loses one. */
/* Item renderer (WQI): how each question type looks, what the voice says, and how an answer is
 * graded on the phone. Pure functions over the E2 question payload, so the page and the tests share
 * them. A question with no `type` renders exactly as before (single, or multi when multi:true). */
var WQI = (function () {
  'use strict';
  var SHAPES = [
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 2 23 21H1z"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 1 22 12 12 23 2 12z"/></svg>'
  ];
  var SHAPE_NAMES = { en: ['circle', 'square', 'triangle', 'diamond'], ur: ['دائرہ', 'مربع', 'تکون', 'معین'] };
  var KINDS = {
    single: 'single', mcq: 'single', choice: 'single', single_choice: 'single',
    multi: 'multi', multi_select: 'multi', multiple: 'multi',
    tf: 'tf', true_false: 'tf', truefalse: 'tf',
    order: 'order', order_steps: 'order', sequence: 'order',
    match: 'match', match_pairs: 'match', matching: 'match',
    label: 'label', label_diagram: 'label', hotspot: 'label',
    listen: 'listen', listen_choose: 'listen', listen_and_choose: 'listen',
    picture: 'picture', picture_choice: 'picture', picture_grid: 'picture'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function opts(q) { return q.options || []; }
  function kind(q) {
    var k = KINDS[String(q.type || '').toLowerCase()];
    if (k) return k;
    if (q.multi) return 'multi';
    var o = opts(q);
    if (o.length && o.every(function (x) { return x.img || (x.pic && (x.pic.svg || x.pic.glyph || x.pic.kind === 'glyph')); })) return 'picture';
    return 'single';
  }
  function slots(v) { return String(v || '').toUpperCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  var ORDERED = { order: 1, match: 1 };
  function grade(q, ans) {
    var a = slots(ans), r = slots(q.correct_slot);
    if (!ORDERED[kind(q)]) { a.sort(); r.sort(); }
    return a.join(',') === r.join(',');
  }

  /* ---- maths: $...$ with a small TeX subset -> MathML (native in Chrome/WebView 109+) ---- */
  var SYM = { times: '×', div: '÷', cdot: '·', pm: '±', le: '≤', ge: '≥', ne: '≠', pi: 'π', degree: '°', circ: '°', approx: '≈', to: '→', rightarrow: '→' };
  function texTokens(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === '\\') {
        var m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
        out.push({ cmd: m[1] }); i += m[0].length;
      } else if (c === '{' || c === '}' || c === '^' || c === '_') { out.push({ p: c }); i++; }
      else if (/\s/.test(c)) { i++; }
      else if (/[0-9.]/.test(c)) { var n = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i)) || [c]; out.push({ n: n[0] }); i += n[0].length; }
      else if (/[A-Za-z؀-ۿ]/.test(c)) { out.push({ v: c }); i++; }
      else { out.push({ o: c }); i++; }
    }
    return out;
  }
  function texParse(tk, st) {
    // st.i walks tk; returns MathML for a run until '}' or end.
    var parts = [];
    function group() {
      if (tk[st.i] && tk[st.i].p === '{') { st.i++; var g = texParse(tk, st); st.i++; return '<mrow>' + g + '</mrow>'; }
      return atom();
    }
    function textArg() {
      var t = '';
      if (tk[st.i] && tk[st.i].p === '{') {
        st.i++;
        while (st.i < tk.length && !(tk[st.i].p === '}')) { var x = tk[st.i++]; t += x.n || x.v || x.o || (x.cmd ? '' : ''); }
        st.i++;
      }
      return t;
    }
    function atom() {
      var t = tk[st.i++];
      if (!t) return '';
      if (t.n) return '<mn>' + esc(t.n) + '</mn>';
      if (t.v) return '<mi>' + esc(t.v) + '</mi>';
      if (t.o) return '<mo>' + esc(t.o) + '</mo>';
      if (t.cmd) {
        if (t.cmd === 'frac') { var a = group(), b = group(); return '<mfrac>' + wrapRow(a) + wrapRow(b) + '</mfrac>'; }
        if (t.cmd === 'sqrt') return '<msqrt>' + group() + '</msqrt>';
        if (t.cmd === 'text' || t.cmd === 'mathrm') return '<mtext>' + esc(textArg()) + '</mtext>';
        if (t.cmd === ',' || t.cmd === ';' || t.cmd === ' ') return '<mspace width="0.2em"/>';
        if (SYM[t.cmd]) return '<mo>' + SYM[t.cmd] + '</mo>';
        return '<mi>' + esc(t.cmd) + '</mi>';
      }
      return '';
    }
    while (st.i < tk.length && !(tk[st.i].p === '}')) {
      var base = atom();
      while (tk[st.i] && (tk[st.i].p === '^' || tk[st.i].p === '_')) {
        var op = tk[st.i++].p, sup = group();
        sup = /^<mrow>/.test(sup) ? sup : '<mrow>' + sup + '</mrow>';
        base = op === '^' ? '<msup>' + base + sup + '</msup>' : '<msub>' + base + sup + '</msub>';
      }
      parts.push(base);
    }
    return parts.join('');
  }
  function wrapRow(x) { return /^<mrow>/.test(x) ? x : '<mrow>' + x + '</mrow>'; }
  function tex(s) {
    return String(s == null ? '' : s).split(/(\$[^$]*\$)/).map(function (seg) {
      if (seg.length > 1 && seg[0] === '$' && seg[seg.length - 1] === '$') {
        return '<math class="wq-m" dir="ltr">' + texParse(texTokens(seg.slice(1, -1)), { i: 0 }) + '</math>';
      }
      return esc(seg);
    }).join('');
  }
  // What the voice says for text that may carry maths.
  function say(s, lang) {
    return String(s == null ? '' : s).replace(/\$([^$]*)\$/g, function (m, body) {
      return body
        .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, function (x, a, b) { return lang === 'ur' ? b + ' میں سے ' + a : a + ' over ' + b; })
        .replace(/\\text\s*\{([^}]*)\}/g, ' $1')
        .replace(/\\times/g, lang === 'ur' ? ' ضرب ' : ' times ')
        .replace(/\\div/g, lang === 'ur' ? ' تقسیم ' : ' divided by ')
        .replace(/\^\{?2\}?/g, lang === 'ur' ? ' کا مربع' : ' squared')
        .replace(/\\[,; ]/g, ' ')
        .replace(/\\[a-zA-Z]+/g, function (c) { return SYM[c.slice(1)] || ''; })
        .replace(/[{}]/g, '')
        .replace(/\s+/g, ' ').trim();
    }).replace(/\s+/g, ' ').trim();
  }

  /* ---- figures: SCHEMA_v2 figure {kind:svg|img}. An SVG is drawn inline so its Urdu labels use the page's
   * own fonts; the bot validates it against an allowlist, and the page strips anything executable again. ---- */
  function cleanSvg(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?script[^>]*>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '').replace(/<\/?(iframe|object|embed|image|use)\b[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/<a\b[^>]*>/gi, '').replace(/<\/a\s*>/gi, '')
      .replace(/\s(href|xlink:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/url\s*\([^)]*\)/gi, 'none').replace(/expression\s*\(/gi, '');
  }
  function viewBox(svg) {
    var m = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(String(svg || ''));
    return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
  }
  function figureOf(q) {
    var f = q.figure;
    if (f && (f.svg || f.url)) return f;
    if (q.img) return { kind: 'img', url: q.img, alt: (f && f.alt) || '' };
    return null;
  }
  function pct(n) { return Math.round(n * 1000) / 10 + '%'; }
  // A picture file shows a soft pulse until it arrives (slow data), then clears itself.
  var LOADING = ' class="wq-ld" onload="this.className=\'\'" onerror="this.className=\'\'"';
  // Every picture file a question needs, so the page can fetch the next question's while the child answers.
  function imageUrls(q) {
    var out = [], f = figureOf(q);
    function add(u) { if (u && out.indexOf(u) < 0) out.push(u); }
    if (f && f.url) add(f.url);
    if (q.img) add(q.img);
    opts(q).forEach(function (o) { add(o.img); });
    return out;
  }
  function figureHtml(q, T) {
    var f = figureOf(q);
    if (!f) return '';
    var vb = f.svg ? viewBox(f.svg) : null;
    if (f.w && f.h) vb = { x: vb ? vb.x : 0, y: vb ? vb.y : 0, w: +f.w, h: +f.h };
    var hot = '';
    if (kind(q) === 'label' && f.hotspots && vb) {
      hot = f.hotspots.map(function (h, k) {
        var o = opts(q).filter(function (x) { return x.slot === h.slot; })[0] || {};
        // A see-through ring over the part (the part stays visible), sized to r, never under 48 px; its number sits outside it.
        var w = h.r ? ';width:' + pct(2 * h.r / vb.w) : '';
        return '<button class="wq-hot" data-slot="' + esc(h.slot) + '" style="left:' + pct((h.x - vb.x) / vb.w) + ';top:' + pct((h.y - vb.y) / vb.h) + w + '" aria-label="' +
          esc(String(k + 1)) + '"><b class="wq-hotn">' + (k + 1) + '</b></button>';
      }).join('');
    }
    var box = vb ? ' style="aspect-ratio:' + vb.w + '/' + vb.h + ';max-width:calc(46vh * ' + vb.w + ' / ' + vb.h + ')"' : '';
    var draw = f.svg
      ? '<div class="wq-svg" role="img" aria-label="' + esc(f.alt || '') + '"' + (f.dir ? ' dir="' + esc(f.dir) + '"' : '') + '>' + cleanSvg(f.svg) + '</div>'
      : '<img src="' + esc(f.url) + '" alt="' + esc(f.alt || '') + '"' + LOADING + '>';
    return '<figure class="wq-fig' + (hot ? ' wq-labelfig' : '') + (f.type ? ' wq-f-' + esc(String(f.type).replace(/[^a-z0-9_-]/gi, '')) : '') + '"><div class="wq-figbox"' + box + '>' + draw + hot + '</div>' +
      '<button class="wq-zoom" aria-label="' + esc(T.zoom || 'Zoom') + '"><span aria-hidden="true">⤢</span> ' + esc(T.zoom || '') + '</button></figure>';
  }

  /* ---- what each option is called (spoken, and in the "not yet" line) ---- */
  function optName(o) { return (o && (o.name || o.text || (o.pic && o.pic.name))) || ''; }
  function speakable(t) { return /[A-Za-z0-9؀-ۿ]/.test(String(t || '')); }
  function rightText(q, lang) {
    var o = opts(q), r = slots(q.correct_slot);
    var by = function (s) { return o.filter(function (x) { return x.slot === s; })[0] || {}; };
    var k = kind(q);
    if (k === 'order') return r.map(function (s) { return say(optName(by(s)), lang); }).join(lang === 'ur' ? ' ← ' : ' → ');
    if (k === 'match') return (q.left || []).map(function (l, i) { return say(l.text, lang) + ' – ' + say(optName(by(r[i])), lang); }).join(lang === 'ur' ? '، ' : ', ');
    return r.map(function (s) { return say(optName(by(s)), lang); }).join(lang === 'ur' ? '، ' : ', ');
  }
  function readParts(q, lang) {
    var au = q.audio || null;
    var rd = q.read || {};
    var parts = [];
    var fg = q.figure || {};
    // A stem that already points at the picture does not need the figure's own pointer first.
    var points = /\b(look|picture|diagram|figure|drawing)\b|تصویر|شکل|خاکہ/i.test(String(q.text || ''));
    if (fg.say && speakable(fg.say) && !points) parts.push({ text: fg.say, url: null });
    parts.push({ text: rd.stem || say(q.text, lang), url: (au && au.q) || null });
    if (au && au.stim) parts.push({ text: '', url: au.stim, stim: true });
    if (kind(q) === 'match') (q.left || []).forEach(function (l) { if (speakable(l.text)) parts.push({ text: say(l.text, lang), url: null }); });
    if (kind(q) === 'label') return parts;
    opts(q).forEach(function (o, k) {
      var si = 'ABCD'.indexOf(String(o.slot || '').charAt(0));
      var url = au && au.opts && si >= 0 ? au.opts[si] || null : null;
      var t = (rd.opts && rd.opts[k]) || o.name || (o.pic && o.pic.name) || say(o.text, lang);
      if (url || speakable(t)) parts.push({ text: t, url: url });
    });
    return parts;
  }

  // Lines for the voice, joined so a line that already ends a sentence is not followed by another stop.
  function joinSay(list) {
    return list.filter(function (x) { return x && String(x).trim(); }).map(function (x, i, a) {
      x = String(x).trim();
      return i < a.length - 1 && !/[.!?\u06D4\u061F]$/.test(x) ? x + '.' : x;
    }).join(' ');
  }
  /* ---- markup per type ---- */
  function picHtml(o, nm) {
    var g = o.pic && (o.pic.glyph || (o.pic.kind === 'glyph' && o.pic.text));
    if (g) return '<span class="wq-glyph" dir="auto">' + esc(g) + '</span>';
    if (o.pic && o.pic.svg) return '<span class="wq-pic" role="img" aria-label="' + esc(o.pic.alt || nm || '') + '">' + cleanSvg(o.pic.svg) + '</span>';
    if (o.img) return '<img src="' + esc(o.img) + '" alt="' + esc(nm || '') + '"' + LOADING + '>';
    return '';
  }
  // Options arrive in the order the child sees; letter k is the k-th shown option (as on WhatsApp and the
  // teacher's answer key). A why/feedback naming a stored letter is remapped to the shown one.
  function letters(q, t) {
    var map = {};
    opts(q).forEach(function (o, k) { map[String(o.slot).charAt(0)] = 'ABCD'.charAt(k); });
    return String(t == null ? '' : t).replace(/(\b(?:answer is|answer|option|choice)\s+|\(|جواب\s+|آپشن\s+)([A-D])(?![A-Za-z])/gi, function (m, pre, l) { return pre + (map[l.toUpperCase()] || l); });
  }
  var LETTERS = true; // off while a figure is on screen: its own A/B/C labels would mean something else
  function optBtn(o, k, extra) {
    return '<button class="wq-opt wq-s' + (k % 4 + 1) + '" data-slot="' + esc(o.slot) + '"' + (extra || '') + '><span class="wq-shp">' + SHAPES[k % 4] + (LETTERS ? '<b class="wq-let">' + 'ABCD'.charAt(k) + '</b>' : '') + '</span>' +
      picHtml(o, o.name) + '<span class="wq-lab">' + tex(o.text || o.name || '') + '</span></button>';
  }
  function itemHtml(q, T, lang) {
    var k = kind(q), o = opts(q);
    LETTERS = !figureOf(q);
    var stim = q.audio && q.audio.stim ? '<button class="wq-btn wq-soft" id="wq-stim"><span aria-hidden="true">🔔</span> ' + esc(T.playSound || '') + '</button>' : '';
    var stem = k === 'listen'
      ? '<div class="wq-qcard wq-listen"><button class="wq-spk wq-spk-big" id="wq-spk" aria-label="' + esc(T.listen || T.listenBig) + '">🔊</button><p class="wq-qtext wq-qsmall">' + tex(q.text) + '</p>' + stim + '</div>'
      : '<div class="wq-qcard"><p class="wq-qtext">' + tex(q.text) + '</p><button class="wq-spk" id="wq-spk" aria-label="' + esc(T.listen || T.listenBig) + '">🔊</button></div>' + stim;
    var body = '';
    var pics = o.length && o.every(function (x) { return x.img || (x.pic && (x.pic.svg || x.pic.glyph || x.pic.kind === 'glyph')); });
    if (k === 'picture' || (k === 'listen' && pics)) {
      var quiet = k === 'listen';
      body = '<div class="wq-pgrid" role="group">' + o.map(function (x, i) {
        var nm = x.name || (x.pic && x.pic.name) || x.text || '';
        // A picture with no word anywhere: the button is named by its shape for screen readers only.
        var aria = speakable(x.text || nm) ? '' : ' aria-label="' + esc(SHAPE_NAMES[lang === 'ur' ? 'ur' : 'en'][i % 4]) + '"';
        return '<button class="wq-opt wq-ptile wq-s' + (i % 4 + 1) + '" data-slot="' + esc(x.slot) + '"' + aria + '><span class="wq-shp">' + SHAPES[i % 4] + (quiet || !LETTERS ? '' : '<b class="wq-let">' + 'ABCD'.charAt(i) + '</b>') + '</span>' +
          (picHtml(x, nm) || '<span class="wq-emoji">' + esc(x.text) + '</span>') +
          (!quiet && speakable(x.text || nm) && !(x.pic && (x.pic.glyph || x.pic.text) === (x.text || nm)) ? '<span class="wq-pname">' + tex(x.text || nm) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    } else if (k === 'tf') {
      body = '<div class="wq-tf" role="group">' + o.slice(0, 2).map(function (x, i) {
        return '<button class="wq-opt wq-tf' + (i ? 'n' : 'y') + '" data-slot="' + esc(x.slot) + '"><span class="wq-tfi" aria-hidden="true">' + (i ? '✗' : '✓') + '</span><span class="wq-lab">' + tex(x.text || (i ? T.no : T.yes)) + '</span></button>';
      }).join('') + '</div>';
    } else if (k === 'order') {
      body = '<p class="wq-small">' + esc(T.orderHelp) + '</p><ol class="wq-seq">' + o.map(function (x, i) {
        return '<li class="wq-place" data-i="' + i + '"><b>' + (i + 1) + '</b><span></span></li>';
      }).join('') + '</ol><div class="wq-pool" role="group">' + o.map(optBtn).join('') + '</div>' +
        '<button class="wq-btn wq-navy" id="wq-check" disabled>' + esc(T.check) + '</button>';
    } else if (k === 'match') {
      body = '<p class="wq-small">' + esc(T.matchHelp) + '</p><div class="wq-mgrid"><div class="wq-mcol">' + (q.left || []).map(function (l, i) {
        return '<button class="wq-ml" data-i="' + i + '"><span class="wq-lab">' + tex(l.text) + '</span><span class="wq-mto"></span></button>';
      }).join('') + '</div><div class="wq-mcol">' + o.map(function (x, i) {
        return '<button class="wq-mr" data-slot="' + esc(x.slot) + '">' + picHtml(x, x.name) + '<span class="wq-lab">' + tex(x.text || x.name || '') + '</span></button>';
      }).join('') + '</div></div><button class="wq-btn wq-navy" id="wq-check" disabled>' + esc(T.check) + '</button>';
    } else if (k === 'label') {
      body = '<p class="wq-small">' + esc(T.labelHelp) + '</p>';
    } else if (k === 'multi') {
      body = '<div class="wq-opts" role="group">' + o.map(function (x, i) { return optBtn(x, i, ' aria-pressed="false"'); }).join('') + '</div>' +
        '<p class="wq-small">' + esc(T.pickAll) + '</p><button class="wq-btn wq-navy" id="wq-check" disabled>' + esc(T.check) + '</button>';
    } else {
      body = '<div class="wq-opts" role="group">' + o.map(function (x, i) { return optBtn(x, i); }).join('') + '</div>';
    }
    return stem + figureHtml(q, T) + body;
  }

  /* ---- taps: wire(root, q, done) calls done(answerString) once ---- */
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function wire(root, q, done) {
    var k = kind(q), sent = false;
    function fire(a) { if (!sent) { sent = true; done(a); } }
    var chk = root.querySelector('#wq-check');
    if (k === 'single' || k === 'picture' || k === 'tf' || k === 'listen') {
      each(root, '.wq-opt', function (b) { b.addEventListener('click', function () { fire(b.getAttribute('data-slot')); }); });
    } else if (k === 'label') {
      each(root, '.wq-hot', function (b) { b.addEventListener('click', function () { fire(b.getAttribute('data-slot')); }); });
    } else if (k === 'multi') {
      var chosen = {};
      each(root, '.wq-opt', function (b) {
        b.addEventListener('click', function () {
          var s = b.getAttribute('data-slot');
          if (chosen[s]) delete chosen[s]; else chosen[s] = 1;
          b.setAttribute('aria-pressed', chosen[s] ? 'true' : 'false');
          b.classList.toggle('wq-chosen', !!chosen[s]);
          if (chk) chk.disabled = !Object.keys(chosen).length;
        });
      });
      if (chk) chk.addEventListener('click', function () { var c = Object.keys(chosen).sort(); if (c.length) fire(c.join(',')); });
    } else if (k === 'order') {
      var seq = [];
      var places = root.querySelectorAll('.wq-place');
      var paint = function () {
        Array.prototype.forEach.call(places, function (p, i) {
          var s = seq[i]; var src = s ? root.querySelector('.wq-pool [data-slot="' + s + '"] .wq-lab') : null;
          p.querySelector('span').innerHTML = src ? src.innerHTML : '';
          p.classList.toggle('wq-filled', !!s);
        });
        each(root, '.wq-pool .wq-opt', function (b) { var used = seq.indexOf(b.getAttribute('data-slot')) >= 0; b.classList.toggle('wq-used', used); b.setAttribute('aria-pressed', used ? 'true' : 'false'); });
        if (chk) chk.disabled = seq.length !== places.length;
      };
      each(root, '.wq-pool .wq-opt', function (b) {
        b.addEventListener('click', function () {
          var s = b.getAttribute('data-slot'), at = seq.indexOf(s);
          if (at >= 0) seq.splice(at, 1); else if (seq.length < places.length) seq.push(s);
          paint();
        });
      });
      Array.prototype.forEach.call(places, function (p, i) { p.addEventListener('click', function () { if (seq[i]) { seq.splice(i, 1); paint(); } }); });
      if (chk) chk.addEventListener('click', function () { if (seq.length === places.length) fire(seq.join(',')); });
    } else if (k === 'match') {
      var pairs = [], cur = null;
      var lefts = root.querySelectorAll('.wq-ml');
      var paintM = function () {
        Array.prototype.forEach.call(lefts, function (l, i) {
          var s = pairs[i];
          l.classList.toggle('wq-sel', cur === i);
          l.className = l.className.replace(/\bwq-p\d\b/g, '').trim() + (s ? ' wq-p' + (i % 4 + 1) : '');
          var src = s ? root.querySelector('.wq-mr[data-slot="' + s + '"] .wq-lab') : null;
          l.querySelector('.wq-mto').innerHTML = src ? src.innerHTML : '';
        });
        each(root, '.wq-mr', function (r) {
          var i = pairs.indexOf(r.getAttribute('data-slot'));
          r.className = r.className.replace(/\bwq-p\d\b/g, '').trim() + (i >= 0 ? ' wq-p' + (i % 4 + 1) : '');
        });
        var full = 0; for (var i = 0; i < lefts.length; i++) if (pairs[i]) full++;
        if (chk) chk.disabled = full !== lefts.length;
      };
      Array.prototype.forEach.call(lefts, function (l, i) { l.addEventListener('click', function () { if (pairs[i]) pairs[i] = null; cur = i; paintM(); }); });
      each(root, '.wq-mr', function (r) {
        r.addEventListener('click', function () {
          var s = r.getAttribute('data-slot');
          var was = pairs.indexOf(s); if (was >= 0) pairs[was] = null;
          if (cur == null) { for (var i = 0; i < lefts.length; i++) if (!pairs[i]) { cur = i; break; } }
          if (cur == null) return;
          pairs[cur] = s; cur = null;
          for (var j = 0; j < lefts.length; j++) if (!pairs[j]) { cur = j; break; }
          paintM();
        });
      });
      if (lefts.length) { cur = 0; paintM(); }
      if (chk) chk.addEventListener('click', function () { var a = []; for (var i = 0; i < lefts.length; i++) a.push(pairs[i]); if (a.every(Boolean)) fire(a.join(',')); });
    }
  }
  // After an answer: lock every control and colour the right one(s).
  function mark(root, q, ans) {
    var k = kind(q), r = slots(q.correct_slot), p = slots(ans), ok = grade(q, ans);
    var c = root.querySelector('#wq-check'); if (c && c.parentNode) c.parentNode.removeChild(c);
    each(root, '.wq-opt, .wq-hot, .wq-ml, .wq-mr, .wq-place', function (b) { b.disabled = true; b.classList.add('wq-locked'); });
    if (k === 'order' || k === 'match') {
      root.querySelector(k === 'order' ? '.wq-seq' : '.wq-mgrid').classList.add(ok ? 'wq-right' : 'wq-picked');
      return;
    }
    each(root, '[data-slot]', function (b) {
      var s = b.getAttribute('data-slot');
      if (r.indexOf(s) >= 0) b.classList.add('wq-right');
      else if (p.indexOf(s) >= 0) b.classList.add('wq-picked');
      else b.classList.add('wq-dim');
    });
  }
  // Tap a figure to see it full screen; tap again (or Close) to go back.
  function wireZoom(root, T) {
    each(root, '.wq-fig:not(.wq-labelfig) .wq-figbox', function (fb) {
      fb.addEventListener('click', function () { var z = fb.parentNode.querySelector('.wq-zoom'); if (z) z.click(); });
    });
    each(root, '.wq-zoom', function (z) {
      z.addEventListener('click', function () {
        var src = z.parentNode.querySelector('.wq-svg, img');
        if (!src) return;
        var ov = document.createElement('div');
        ov.className = 'wq-zoomed'; ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<div class="wq-zbody"></div><button class="wq-icon wq-zclose" aria-label="' + esc(T.close || 'Close') + '">✕</button>';
        ov.firstChild.appendChild(src.cloneNode(true));
        ov.addEventListener('click', function () { if (ov.parentNode) ov.parentNode.removeChild(ov); });
        document.body.appendChild(ov);
      });
    });
  }
  return { kind: kind, grade: grade, tex: tex, say: say, cleanSvg: cleanSvg, figureHtml: figureHtml, itemHtml: itemHtml, readParts: readParts,
    rightText: rightText, joinSay: joinSay, letters: letters, imageUrls: imageUrls, wire: wire, mark: mark, wireZoom: wireZoom, speakable: speakable, SHAPES: SHAPES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WQI;

(function () {
  'use strict';

  if (typeof document === 'undefined') return;
  var bootEl = document.getElementById('boot');
  var ROOT = document.getElementById('wq');
  if (!bootEl || !ROOT) return;
  var B;
  try { B = JSON.parse(bootEl.textContent); } catch (e) { return; }
  var Q = B.quiz || {};
  var QS = Q.questions || [];
  var N = QS.length;
  var CODE = B.code || Q.code || '';
  var LANG = Q.lang === 'ur' ? 'ur' : 'en';
  var CLS = B.cls || {};
  var LIVE = B.live || {};
  var params = (function () { var o = {}; try { new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); } catch (e) {} return o; })();

  /* ---------------- copy (en + ur). Jugnu speaks one short line per screen. ---------------- */
  var T = {
    en: {
      quiz: 'NIETE QUIZ', from: function (t, c) { return [t ? 'From ' + t : '', c].filter(Boolean).join(' · '); },
      meta: function (n) { return n + ' questions · about ' + Math.max(1, Math.round(n * 0.6)) + ' minutes'; },
      hello: 'Assalam o Alaikum! Let\'s read it together.', helloN: function (n) { return 'Welcome back, ' + n + '!'; },
      play: 'Play', playAs: function (n) { return 'Play as ' + n; }, notMe: function (n) { return 'Not ' + n + '?'; },
      proof: function (n) { return n.toLocaleString('en') + ' children in Islamabad played today'; },
      classToday: function (n) { return n + ' in your class played today'; },
      whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: function (c) { return 'Find your name in ' + c; },
      newKid: "I'm new", newT: 'Hello! What is your first name?', newSay: 'Just your first name.', start: 'Start', privacy: 'Only first names. No phone numbers.',
      isYou: function (n) { return 'Are you ' + n + '?'; }, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", diff: function (n) { return "I'm a different " + n; },
      vT: 'Watch the lesson (optional)', vSay: 'Watch first, or go straight in.', skip: 'Go to the questions', watched: 'Done watching',
      how: [['🔊', 'Listen to each question'], ['👆', 'Tap a colour or a picture'], ['🙋', 'Stuck? Help comes']],
      qof: function (i, n) { return 'Question ' + i + ' of ' + n; }, listen: 'Listen again', helpAgain: 'Shall we listen again?',
      orderHelp: 'Tap the steps in the right order.', matchHelp: 'Tap a word, then tap its partner.', labelHelp: 'Tap the right part of the picture.',
      zoom: 'Make the picture bigger', close: 'Close', playSound: 'Play the sound', yes: 'True', no: 'False',
      right: ['Yes! You found it.', 'You checked carefully!', 'Right! Well looked.', 'Yes! You kept going.', 'You got it!'],
      notyet: function (r) { return 'Not yet. The answer is "' + r + '".'; }, notyetLead: 'Not yet. The answer is', notyetPlain: 'Not yet.', next: 'Next', again: 'This one comes back at the end, to fix together.',
      half: 'Halfway there!',
      tricky: function (n) { return n === 1 ? '1 tricky one' : n + ' tricky ones'; }, trickySay: "Before we celebrate, let's fix it together.", fixGo: 'Fix it with Jugnu', later: 'Maybe later',
      second: 'Second try · with Jugnu', fixed: 'Fixed it!', tryAgain: 'Look again. You can do it.',
      got: function (s, n) { return 'You got ' + s + ' out of ' + n; }, fixedLine: function (k) { return '+ fixed ' + k + ' tricky one' + (k > 1 ? 's' : '') + ' with Jugnu'; },
      scoreNote: 'Your score is your first try.', praise: function (s, n) { return s === n ? 'Brilliant!' : s >= n * 0.8 ? 'Great work!' : 'Good try!'; },
      done: 'QUIZ COMPLETE', seeCard: 'See my card', classBtn: 'See my class',
      prac: 'This name already finished on another phone. This round is practice; your first finished score stays.',
      shareBtn: 'Share to class group', challenge: 'Challenge a friend', cardPriv: 'Only your first name goes on the card.',
      shareLine: function (w, s, n, t) { return w + ' got ' + s + '/' + n + ' stars on ' + t + '. Can you beat it?'; },
      tableLine: function (t, c) { return c + ' league table for ' + t + '. Not played yet? Same link, still open:'; },
      leagueT: function (c) { return c + ' league table'; }, you: 'YOU', moreN: function (n) { return n + ' more in the class'; },
      finN: function (n) { return n + ' finished'; }, yourScore: 'Your score', avg: 'Class average', firstOnly: 'First names only. Ties share a place.',
      shareTable: 'Share the class table', noRows: 'Nobody has finished yet. Be the first!',
      histT: 'Your scores', todayT: 'Today in Islamabad', rest: 'Time to rest. See you tomorrow!', back: 'Back', sounds: 'Sounds',
      cont: function (i, n) { return 'Continue ' + i + '/' + n; }, contSay: function (n) { return 'Welcome back, ' + n + '! Your answers are saved.'; }, restart: 'Start again',
      fbT: 'Send it on WhatsApp', fbSub: 'Tap the green button, then pick the chat.', fbWa: 'Send on WhatsApp', fbCopy: 'Copy the message', copied: 'Message copied',
      backAgain: 'Your answers are saved. Press back again to leave.',
      selfT: 'This is your own test run. It will not show in your class report.',
      challenged: function (n, s, t) { return n + ' got ' + s + '/' + t + ' stars. Can you beat it?'; }, challengedBy: function (n) { return n + ' challenged you. Can you beat their score?'; },
      offline: 'No internet right now. Your answers are saved on this phone.', tooFew: 'Answer a few more questions first.', oops: 'Something went wrong. Please try again.',
      friends: 'Friends who finished', home: 'Home', yourClass: 'Your class', check: 'Check', pickAll: 'Tap every right answer, then Check.', previewPlay: 'Try it as a child'
    },
    ur: {
      quiz: 'NIETE QUIZ', from: function (t, c) { return [t ? t + ' کی طرف سے' : '', c].filter(Boolean).join(' · '); },
      meta: function (n) { return n + ' سوال · تقریباً ' + Math.max(1, Math.round(n * 0.6)) + ' منٹ'; },
      hello: 'السلام علیکم! آئیں، مل کر پڑھیں۔', helloN: function (n) { return n + '، خوش آمدید!'; },
      play: 'کھیلیں', playAs: function (n) { return n + '، شروع کریں'; }, notMe: function (n) { return n + ' نہیں؟'; },
      proof: function (n) { return 'آج اسلام آباد میں ' + n.toLocaleString('en') + ' بچوں نے کھیلا'; },
      classToday: function (n) { return 'آج آپ کی کلاس میں ' + n + ' نے کھیلا'; },
      whoT: 'آج کس کی باری ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', onPhone: 'اس فون پر', inClass: function (c) { return c + ' میں اپنا نام ڈھونڈیں'; },
      newKid: 'نیا نام', newT: 'السلام علیکم! آپ کا پہلا نام کیا ہے؟', newSay: 'صرف پہلا نام لکھیں۔', start: 'شروع کریں', privacy: 'صرف پہلا نام۔ فون نمبر نہیں۔',
      isYou: function (n) { return 'کیا آپ ' + n + ' ہیں؟'; }, isYouSub: 'ہاں صرف تب دبائیں جب یہ آپ کا اپنا نام ہو۔', yesMe: 'جی ہاں، یہ میں ہوں', diff: function (n) { return 'میں کوئی اور ' + n + ' ہوں'; },
      vT: 'سبق دیکھیں (اختیاری)', vSay: 'پہلے دیکھیں، یا سیدھا سوالوں پر چلیں۔', skip: 'سوالوں پر چلیں', watched: 'دیکھ لیا',
      how: [['🔊', 'ہر سوال سنیں'], ['👆', 'رنگ یا تصویر پر ٹیپ کریں'], ['🙋', 'مشکل ہو تو مدد ملے گی']],
      qof: function (i, n) { return 'سوال ' + i + ' از ' + n; }, listen: 'دوبارہ سنیں', helpAgain: 'کیا دوبارہ سنیں؟',
      orderHelp: 'قدموں کو صحیح ترتیب سے ٹیپ کریں۔', matchHelp: 'ایک لفظ پر ٹیپ کریں، پھر اس کے جوڑے پر۔', labelHelp: 'تصویر میں صحیح حصے پر ٹیپ کریں۔',
      zoom: 'تصویر بڑی کریں', close: 'بند کریں', playSound: 'آواز سنیں', yes: 'درست', no: 'غلط',
      right: ['جی ہاں! آپ نے ڈھونڈ لیا۔', 'آپ نے غور سے دیکھا!', 'بالکل درست!', 'جی ہاں! آپ نے کوشش جاری رکھی۔', 'شاباش، درست!'],
      notyet: function (r) { return 'ابھی نہیں۔ صحیح جواب ہے: ' + r; }, notyetLead: 'ابھی نہیں۔ صحیح جواب ہے:', notyetPlain: 'ابھی نہیں۔', next: 'اگلا', again: 'یہ سوال آخر میں دوبارہ آئے گا، مل کر ٹھیک کرنے کے لیے۔',
      half: 'آدھا راستہ طے!',
      tricky: function (n) { return n + ' مشکل سوال'; }, trickySay: 'جشن سے پہلے، آئیں اسے مل کر ٹھیک کریں۔', fixGo: 'جگنو کے ساتھ ٹھیک کریں', later: 'بعد میں',
      second: 'دوسری کوشش · جگنو کے ساتھ', fixed: 'ٹھیک ہو گیا!', tryAgain: 'دوبارہ دیکھیں۔ آپ کر سکتے ہیں۔',
      got: function (s, n) { return 'آپ نے ' + n + ' میں سے ' + s + ' درست کیے'; }, fixedLine: function (k) { return '+ جگنو کے ساتھ ' + k + ' مشکل سوال ٹھیک کیا'; },
      scoreNote: 'اسکور پہلی کوشش کا ہے۔', praise: function (s, n) { return s === n ? 'زبردست!' : s >= n * 0.8 ? 'بہت خوب!' : 'اچھی کوشش!'; },
      done: 'کوئز مکمل', seeCard: 'میرا کارڈ دیکھیں', classBtn: 'اپنی کلاس دیکھیں',
      prac: 'یہ نام کسی اور فون پر مکمل ہو چکا ہے۔ یہ باری مشق ہے؛ پہلا مکمل اسکور ہی رہے گا۔',
      shareBtn: 'کلاس گروپ میں بھیجیں', challenge: 'دوست کو چیلنج کریں', cardPriv: 'کارڈ پر صرف آپ کا پہلا نام جاتا ہے۔',
      shareLine: function (w, s, n, t) { return w + ' نے ' + t + ' میں ' + n + ' میں سے ' + s + ' ستارے لیے۔ کیا اس سے زیادہ ستارے ملیں گے؟'; },
      tableLine: function (t, c) { return t + ': ' + c + ' کی لیگ ٹیبل۔ ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے:'; },
      leagueT: function (c) { return c + ' کی لیگ ٹیبل'; }, you: 'آپ', moreN: function (n) { return 'کلاس میں ' + n + ' اور'; },
      finN: function (n) { return n + ' نے مکمل کیا'; }, yourScore: 'آپ کا اسکور', avg: 'کلاس کی اوسط', firstOnly: 'صرف پہلے نام۔ برابر اسکور والوں کا نمبر ایک ہے۔',
      shareTable: 'کلاس ٹیبل بھیجیں', noRows: 'ابھی کسی نے مکمل نہیں کیا۔ سب سے پہلے کھیلیں!',
      histT: 'آپ کے اسکور', todayT: 'آج اسلام آباد میں', rest: 'اب آرام کا وقت۔ کل پھر ملاقات ہوگی!', back: 'واپس', sounds: 'آوازیں',
      cont: function (i, n) { return 'جاری رکھیں ' + i + '/' + n; }, contSay: function (n) { return n + '، خوش آمدید! آپ کے جواب محفوظ ہیں۔'; }, restart: 'نئے سرے سے شروع کریں',
      fbT: 'واٹس ایپ پر بھیجیں', fbSub: 'ہرا بٹن دبائیں، پھر چیٹ چنیں۔', fbWa: 'واٹس ایپ پر بھیجیں', fbCopy: 'پیغام کاپی کریں', copied: 'پیغام کاپی ہو گیا',
      backAgain: 'آپ کے جواب محفوظ ہیں۔ باہر جانے کے لیے دوبارہ بیک دبائیں۔',
      selfT: 'یہ آپ کا اپنا ٹیسٹ رن ہے۔ یہ کلاس رپورٹ میں شامل نہیں ہوگا۔',
      challenged: function (n, s, t) { return n + ' نے ' + t + ' میں سے ' + s + ' ستارے لیے۔ اب آپ کی باری!'; }, challengedBy: function (n) { return n + ' نے آپ کو چیلنج کیا ہے۔ اب آپ کی باری!'; },
      offline: 'ابھی انٹرنیٹ نہیں ہے۔ آپ کے جواب اس فون پر محفوظ ہیں۔', tooFew: 'پہلے کچھ اور سوالوں کے جواب دیں۔', oops: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
      friends: 'دوست جنہوں نے مکمل کیا', home: 'شروع', yourClass: 'آپ کی کلاس', check: 'جانچیں', pickAll: 'ہر درست جواب پر ٹیپ کریں، پھر جانچیں۔', previewPlay: 'بچے کی طرح آزمائیں'
    }
  }[LANG];

  var CLASS_LABEL = CLS.label || T.yourClass;
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var STAR = '<svg class="wq-star{on}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  var IMG = '/wq/jugnu_';

  /* ---------------- storage that survives being blocked ---------------- */
  var mem = {};
  var STORE_OK = (function () { try { var k = '__wq'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })();
  function sget(k, d) {
    try { var v = STORE_OK ? localStorage.getItem(k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function sset(k, v) {
    var s = JSON.stringify(v);
    mem[k] = s;
    try { if (STORE_OK) localStorage.setItem(k, s); } catch (e) {}
  }
  var SKEY = 'wq_s_' + CODE;
  var S = sget(SKEY, null) || { st: null, child: null, answers: {}, queue: [], seq: 0, wrong: [], result: null };
  if (!S.answers) S.answers = {};
  if (!S.queue) S.queue = [];
  function save() { sset(SKEY, S); }
  function kids() { return sget('wq_kids', []) || []; }
  function rememberKid(c) {
    if (!c || !c.chip) return;
    // A remembered child playing the teacher's next quiz comes back under that quiz's chip.
    // Same first name and same animal (the animal is fixed per child) is the same button on
    // "Whose turn?", so it is kept once, with the newest chip.
    var list = kids().filter(function (k) { return k.chip !== c.chip && !(k.first === c.first && k.animal === c.animal); });
    list.unshift({ chip: c.chip, first: c.first, animal: c.animal });
    sset('wq_kids', list.slice(0, 6));
  }
  var SOUND = !!sget('wq_sound', false);

  /* ---------------- analytics (E8) ---------------- */
  var evq = [];
  var IAB = /WhatsApp|FBAN|FBAV|Instagram|; wv\)/.test(navigator.userAgent || '') ? 1 : 0;
  function ev(n, props) {
    var e = { t: Date.now(), code: CODE, lang: LANG };
    if (props) for (var k in props) if (props[k] !== undefined) e[k] = props[k];
    e.n = n;
    evq.push(e);
    if (evq.length >= 10) flushEv();
  }
  function flushEv(beacon) {
    if (!evq.length) return;
    var body = JSON.stringify({ events: evq.splice(0, 20) });
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/wq/e', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) {}
    try { fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  setInterval(function () { flushEv(false); }, 5000);
  window.addEventListener('pagehide', function () { flushQueue(true); flushEv(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushEv(true); } });
  window.addEventListener('error', function (e) { ev('error', { err: String((e && e.message) || 'error').slice(0, 200) }); });
  window.addEventListener('unhandledrejection', function (e) { ev('error', { err: String((e && e.reason && e.reason.message) || 'rejection').slice(0, 200) }); });

  /* ---------------- api ---------------- */
  function api(method, path, body) {
    var init = { method: method, headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/wq/' + path, init).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        return { status: r.status, ok: r.ok, body: j || {} };
      });
    });
  }

  // The offline answer queue: every answer is stored first, then sent in one call.
  // A caller that arrives while a flush is in flight waits for it (finish must never
  // race the last answer), then flushes whatever is still queued.
  var flushP = null;
  function flushQueue(beacon) {
    if (beacon) {
      if (S.st && S.queue.length && navigator.sendBeacon) {
        try { navigator.sendBeacon('/api/wq/answers', new Blob([JSON.stringify({ st: S.st, a: S.queue.slice(0, 20) })], { type: 'application/json' })); } catch (e) {}
      }
      return Promise.resolve();
    }
    if (flushP) return flushP.then(function () { return S.queue.length ? flushQueue() : null; });
    if (!S.st || !S.queue.length) return Promise.resolve();
    var batch = S.queue.slice(0, 20);
    var progressed = false;
    flushP = api('POST', 'answers', { st: S.st, a: batch }).then(function (r) {
      if (r.ok) {
        var done = {};
        (r.body.recorded || []).concat(r.body.dup || [], r.body.unknown || []).forEach(function (q) { done[q] = 1; });
        var before = S.queue.length;
        S.queue = S.queue.filter(function (a) { return !done[a.qid]; });
        progressed = S.queue.length < before;
        save();
      } else if (r.status === 401) {
        ev('error', { err: 'answers_401' });
      }
    }, function () {}).then(function () {
      flushP = null;
      if (progressed && S.queue.length) return flushQueue();
    });
    return flushP;
  }
  window.addEventListener('online', function () { flushQueue(); });

  /* ---------------- sound (off by default) + read-aloud ---------------- */
  var actx = null;
  function sfx(kind) {
    if (!SOUND) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      var notes = kind === 'right' ? [660, 880] : kind === 'done' ? [523, 659, 784] : [330];
      notes.forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.2, actx.currentTime + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.12 + 0.2);
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + i * 0.12); o.stop(actx.currentTime + i * 0.12 + 0.22);
      });
    } catch (e) {}
  }
  var player = null;
  var voiceGen = 0; // bumped on every stop: a line that was stopped or replaced never speaks again
  function stopVoice() {
    voiceGen += 1;
    try { if (player) { player.pause(); player = null; } } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  }
  // Recorded clip when the payload has one, else the phone's own voice. done() runs when it ends.
  function speak(text, url, done) {
    stopVoice();
    var gen = voiceGen;
    var fin = false;
    // A stopped line (cancel fires the utterance's onerror; its safety timer still runs) never calls done().
    function end() { if (!fin && gen === voiceGen) { fin = true; if (done) done(); } }
    if (url) {
      // A clip that errors, will not play here, or stalls for more than 2 s counts as missing:
      // that line falls back to the phone's own voice, and we log why.
      var switched = false;
      var fallback = function (why) {
        // A clip stopped by the next screen (a fast tap, slow data) rejects its play() and
        // fires its stalled timer: that is not a missing clip, and its old line stays quiet.
        if (switched || fin || gen !== voiceGen) return;
        switched = true;
        try { if (player) player.pause(); } catch (e) {}
        player = null;
        ev('audio_fallback', { reason: why });
        speakTts(text, end);
      };
      try {
        var probe = document.createElement('audio');
        if (/\.ogg(\?|$)/i.test(url) && probe.canPlayType && !probe.canPlayType('audio/ogg; codecs="opus"')) { fallback('unsupported'); return; }
        var a = new Audio(url);
        player = a;
        var started = false;
        a.addEventListener('playing', function () { started = true; });
        a.onended = function () { if (!switched) end(); };
        a.onerror = function () { fallback('error'); };
        setTimeout(function () { if (!started) fallback('stalled'); }, 2000);
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function (e) { fallback('reject'); });
        return;
      } catch (e) { fallback('error'); return; }
    }
    speakTts(text, end);
  }
  function speakTts(text, end) {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { setTimeout(end, 4000); return; }
      var u = new SpeechSynthesisUtterance(text);
      u.lang = LANG === 'ur' ? 'ur-PK' : 'en-US';
      u.rate = 0.9;
      u.onend = end; u.onerror = end;
      speechSynthesis.speak(u);
      setTimeout(end, Math.min(20000, 3000 + text.length * 110));
    } catch (e) { setTimeout(end, 4000); }
  }

  /* ---------------- tiny DOM helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return ROOT.querySelector(sel); }
  function on(sel, fn) { var el = $(sel); if (el) el.addEventListener('click', fn); return el; }
  var helpTimer = null;
  function clearTimers() { if (helpTimer) { clearTimeout(helpTimer); helpTimer = null; } }
  function render(html, moment) {
    clearTimers();
    stopVoice();
    ROOT.innerHTML = '<section class="wq-screen" data-m="' + moment + '">' + html + '</section>';
    ROOT.setAttribute('data-m', moment);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function bar(extra) {
    return '<div class="wq-bar"><span class="wq-brand"><i></i>' + esc(T.quiz) + '</span>' + (extra || '<span class="wq-grow"></span>') +
      '<button class="wq-icon" id="wq-snd" aria-label="' + esc(T.sounds) + '" aria-pressed="' + SOUND + '">' + (SOUND ? '🔔' : '🔕') + '</button></div>';
  }
  function wireBar() {
    on('#wq-snd', function () {
      SOUND = !SOUND; sset('wq_sound', SOUND);
      this.setAttribute('aria-pressed', SOUND); this.textContent = SOUND ? '🔔' : '🔕';
    });
  }
  function jug(pose, line, big) {
    return '<div class="wq-jug' + (big ? ' wq-big' : '') + '"><img src="' + IMG + pose + '.webp" alt="" width="92" height="92"><div class="wq-say">' + esc(line) + '</div></div>';
  }
  function stars(n, total) {
    var h = '';
    for (var i = 0; i < total; i++) h += STAR.replace('{on}', i < n ? ' wq-on' : '');
    return '<div class="wq-stars" role="img" aria-label="' + n + '/' + total + '">' + h + '</div>';
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'wq-toast'; t.textContent = msg; t.setAttribute('role', 'status');
    ROOT.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function ani(a) { return '<span class="wq-ani">' + (ANIMALS[a] || '⭐') + '</span>'; }
  function fmtN(n) { return Number(n || 0).toLocaleString('en'); }
  // Joins the non-empty parts with a middle dot, so a missing class label or topic never leaves "NIETE ·".
  function dotJoin() { return Array.prototype.filter.call(arguments, function (x) { return x != null && String(x) !== ''; }).map(esc).join(' · '); }
  function link(path) { return location.origin + path; }

  /* ---------------- M3 landing ---------------- */
  function landing() {
    var here = kids();
    var classChips = {};
    (CLS.chips || []).forEach(function (c) { classChips[c.chip] = 1; });
    var last = here.filter(function (k) { return classChips[k.chip]; })[0] || here[0];
    var ch = B.challenge;
    var chLine = ch ? T.challenged(ch.first, ch.correct, ch.total) : (params.from ? T.challengedBy(String(params.from).slice(0, 20)) : '');
    var h = bar() +
      (B.preview ? '<div class="wq-banner">' + esc(T.selfT) + '</div>' : '') +
      jug('hello', last ? T.helloN(last.first) : T.hello, true) +
      '<div class="wq-card wq-stack"><h1>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(CLS.teacher, CLS.label)) + '</p>' +
      '<p class="wq-small">' + esc(T.meta(N)) + '</p></div>' +
      (chLine ? '<div class="wq-banner">' + esc(chLine) + '</div>' : '') +
      (B.preview && params.p ? '<button class="wq-btn wq-go" id="wq-preview">' + esc(T.previewPlay) + '</button>' :
      last ? '<button class="wq-btn wq-go" id="wq-play-as">' + esc(T.playAs(last.first)) + '</button><button class="wq-btn wq-ghost" id="wq-notme">' + esc(T.notMe(last.first)) + '</button>'
        : '<button class="wq-btn wq-go" id="wq-play">' + esc(T.play) + '</button>') +
      (LIVE.ict_today_floor ? '<p class="wq-proof">🌟 ' + esc(T.proof(LIVE.ict_today_floor)) + '</p>' : '') +
      (LIVE.class_today ? '<p class="wq-small">' + esc(T.classToday(LIVE.class_today)) + '</p>' : '');
    render(h, 'M3');
    wireBar();
    on('#wq-play', who);
    on('#wq-notme', who);
    on('#wq-preview', function () { ev('identity_pick', { src: 'preview' }); startSession({}, null, ''); });
    on('#wq-play-as', function () { ev('identity_pick', { src: 'remembered' }); startSession({ chip: last.chip }, last); });
  }

  /* ---------------- M4 who's playing ---------------- */
  function who() {
    var here = kids();
    var chips = (CLS.chips || []).filter(function (c) { return !here.some(function (k) { return k.chip === c.chip; }); });
    function kidBtn(k, src) { return '<button class="wq-kid" data-chip="' + esc(k.chip) + '" data-src="' + src + '">' + ani(k.animal) + esc(k.first) + '</button>'; }
    var h = bar() + jug('idle', T.whoSay) + '<h2>' + esc(T.whoT) + '</h2>' +
      (here.length ? '<p class="wq-sub">' + esc(T.onPhone) + '</p><div class="wq-chips">' + here.map(function (k) { return kidBtn(k, 'phone'); }).join('') + '</div>' : '') +
      (chips.length ? '<p class="wq-sub">' + esc(T.inClass(CLASS_LABEL)) + '</p><div class="wq-chips">' + chips.map(function (k) { return kidBtn(k, 'class'); }).join('') + '</div>' : '') +
      '<button class="wq-btn wq-navy" id="wq-new">' + esc(T.newKid) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M4');
    wireBar();
    Array.prototype.forEach.call(ROOT.querySelectorAll('.wq-kid'), function (b) {
      b.addEventListener('click', function () {
        var chip = b.getAttribute('data-chip');
        var k = here.concat(CLS.chips || []).filter(function (x) { return x.chip === chip; })[0];
        ev('identity_pick', { src: b.getAttribute('data-src') });
        startSession({ chip: chip }, k);
      });
    });
    on('#wq-new', newKid);
    on('#wq-back', landing);
  }

  function newKid() {
    var h = bar() + jug('hello', T.newSay) + '<h2>' + esc(T.newT) + '</h2>' +
      '<input class="wq-input" id="wq-name" maxlength="30" autocomplete="off" autocapitalize="words" enterkeyhint="go" aria-label="' + esc(T.newT) + '">' +
      '<p class="wq-small">' + esc(T.privacy) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-start">' + esc(T.start) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M4-new');
    wireBar();
    var inp = $('#wq-name');
    function go(force) {
      var name = String(inp.value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      if (name.length < 2) { inp.focus(); return; }
      ev('identity_pick', { src: force ? 'new_force' : 'new' });
      startSession({ new: { name: name, cls: String(Q.grade || ''), force: !!force } }, null, name);
    }
    on('#wq-start', function () { go(false); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(false); });
    on('#wq-back', who);
    newKid.force = function () { go(true); };
  }

  function isThisYou(cands, typed) {
    var h = bar() + jug('thinking', T.isYouSub) +
      cands.map(function (c) {
        return '<div class="wq-card wq-stack"><h2>' + esc(T.isYou(c.first)) + ' ' + ani(c.animal) + '</h2>' +
          '<button class="wq-btn wq-go" data-chip="' + esc(c.chip) + '">' + esc(T.yesMe) + '</button></div>';
      }).join('') +
      '<button class="wq-btn wq-soft" id="wq-diff">' + esc(T.diff(typed.split(' ')[0])) + '</button>';
    render(h, 'M4-isyou');
    wireBar();
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-chip]'), function (b) {
      b.addEventListener('click', function () {
        var c = cands.filter(function (x) { return x.chip === b.getAttribute('data-chip'); })[0];
        ev('identity_pick', { src: 'is_this_you' });
        startSession({ chip: c.chip }, c);
      });
    });
    on('#wq-diff', function () { startSession({ new: { name: typed, cls: String(Q.grade || ''), force: true } }, null, typed); });
  }

  /* ---------------- E3 session ---------------- */
  var busy = false;
  function startSession(who, kid, typed) {
    if (busy) return;
    busy = true;
    var body = { code: CODE };
    for (var k in who) body[k] = who[k];
    var dref = sget('wq_d', null);
    if (dref) body.device_ref = dref;
    if (params.p) body.p = params.p;
    if (S.st) body.resume_st = S.st;
    api('POST', 'session', body).then(function (r) {
      busy = false;
      if (r.status === 409 && r.body.error === 'maybe_you') return isThisYou(r.body.candidates || [], typed || '');
      if (!r.ok) { ev('error', { err: 'session_' + r.status }); toast(r.status === 410 ? T.oops : T.oops); return; }
      var b = r.body;
      if (b.device_ref) sset('wq_d', b.device_ref);
      var child = b.child || kid || { first: typed || '' };
      var sameChild = S.child && child.chip && S.child.chip === child.chip;
      if (!sameChild) { S.answers = {}; S.queue = []; S.seq = 0; S.wrong = []; S.result = null; S.vt = 0; S.vdone = 0; }
      S.st = b.st; S.child = child; S.counted = b.counted !== false; S.reason = b.reason || null;
      ((b.resume && b.resume.answered) || []).forEach(function (q) { if (!S.answers[q]) S.answers[q] = { slot: '?', ok: null }; });
      save();
      rememberKid(child);
      ev('quiz_start', { reason: b.reason || undefined, ok: b.counted === false ? 0 : 1 });
      if (wantsVideo()) video(); else nextQuestion();
    }, function () { busy = false; toast(T.offline); ev('error', { err: 'session_net' }); });
  }

  function answeredCount() { var n = 0; QS.forEach(function (q) { if (S.answers[q.qid]) n++; }); return n; }

  /* ---------------- M5 video (optional) ---------------- */
  // Where the lesson video is, kept every few seconds and whenever it pauses or the page hides.
  function keepVideoAt(vid, now) {
    var t = Math.floor((vid && vid.currentTime) || 0);
    if (!t || S.vdone || t === S.vt) return;
    if (now || !(S.vt > 0) || Math.abs(t - S.vt) >= 3) { S.vt = t; save(); }
  }
  window.addEventListener('pagehide', function () { if (ROOT.getAttribute('data-m') === 'M5') keepVideoAt($('video'), true); });
  // The lesson video plays once per attempt: skipped or watched to the end, a reload goes on to the questions.
  function wantsVideo() { return Boolean(B.video && B.video.url && !answeredCount() && !S.vdone); }
  function video() {
    var v = B.video;
    // A reload mid-video picks up where it was (#t= is a media fragment; the server never sees it).
    var at = S.vt > 0 ? Math.floor(S.vt) : 0;
    var h = bar() + jug('hello', T.vSay) + '<h2>' + esc(T.vT) + '</h2>' +
      // A cover over the box until the first play: a tap anywhere starts the video (the native button
      // is small), and with no poster the child sees Jugnu and a big play button, not a dark box.
      '<div class="wq-vbox"><video class="wq-video" controls playsinline preload="none"' + (v.poster ? ' poster="' + esc(v.poster) + '"' : '') + ' src="' + esc(v.url + (at ? '#t=' + at : '')) + '"></video>' +
      '<button class="wq-vcover' + (v.poster ? ' wq-vposter' : '') + '" type="button" aria-label="' + esc(T.vT) + '">' +
      (v.poster ? '' : '<img src="' + IMG + 'hello.webp" alt="" class="wq-vjug">') + '<span class="wq-vplay" aria-hidden="true">▶</span></button></div>' +
      '<ul class="wq-how">' + T.how.map(function (x) { return '<li><span>' + x[0] + '</span>' + esc(x[1]) + '</li>'; }).join('') + '</ul>' +
      '<button class="wq-btn wq-go" id="wq-skip">' + esc(T.skip) + '</button>';
    render(h, 'M5');
    wireBar();
    var vid = $('video');
    var cover = $('.wq-vcover');
    if (vid) vid.addEventListener('play', function () { if (cover) cover.hidden = true; ev('video_play', at ? { t: at } : {}); });
    if (vid) vid.addEventListener('timeupdate', function () { keepVideoAt(vid, false); });
    if (vid) vid.addEventListener('pause', function () { keepVideoAt(vid, true); });
    if (vid) vid.addEventListener('ended', function () { S.vdone = 1; S.vt = 0; save(); ev('video_end', {}); });
    on('.wq-vcover', function () {
      if (!vid || !vid.paused) return;
      try { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    });
    on('#wq-skip', function () {
      try { vid.pause(); } catch (e) {}
      ev('video_skip', { pct: vid && vid.duration ? Math.round(100 * vid.currentTime / vid.duration) : 0 });
      S.vdone = 1; S.vt = 0; save();
      nextQuestion();
    });
  }

  /* ---------------- M6 / M7 questions ---------------- */
  function dots(cur) {
    return '<div class="wq-dots" aria-hidden="true">' + QS.map(function (q, i) {
      return '<span class="wq-dot' + (S.answers[q.qid] ? ' wq-done' : '') + (i === cur ? ' wq-now' : '') + '"></span>';
    }).join('') + '</div>';
  }
  function nextQuestion() {
    for (var i = 0; i < N; i++) if (!S.answers[QS[i].qid]) return question(i, false);
    finishFirstPass();
  }
  function optText(o) { return o.text || ''; }
  // An option that is only a picture (emoji) is never spoken by the phone's voice.
  function speakable(t) { return /[A-Za-z0-9\u0600-\u06FF]/.test(String(t || '')); }
  // The question, then each option: the recorded clip when there is one, else the phone's voice.
  function readParts(q) { return WQI.readParts(q, LANG); }
  function speakSeq(parts, done) {
    var i = 0;
    (function nextPart() {
      if (i >= parts.length) { if (done) done(); return; }
      var part = parts[i++];
      speak(part.text, part.url, nextPart);
    })();
  }

  // What the voice says after an answer, in order. The question's recorded "why" clip is its
  // reason (the explanation), so it is played only where the reason is what is said; the
  // feedback for a picked option has its own clip (fbs) or the phone's voice. Not yet = a kind
  // lead-in, the right answer by name (its own option clip when it is one option), then why.
  function feedbackParts(q, ok, line, why, picked, named) {
    var au = q.audio || {};
    var rs = String(q.correct_slot || '');
    var si = 'ABCD'.indexOf(rs.charAt(0));
    var one = rs.length === 1 && si >= 0 && WQI.kind(q) !== 'order' && WQI.kind(q) !== 'match';
    var parts = [];
    if (ok) parts.push({ text: line, url: null });
    else if (!named) parts.push({ text: T.notyetPlain, url: null });
    else if (one && au.opts && au.opts[si]) parts.push({ text: T.notyetLead, url: null }, { text: WQI.rightText(q, LANG), url: au.opts[si] });
    else parts.push({ text: line, url: null });
    var said = WQI.say(why, LANG);
    if (!speakable(said)) return parts;
    var pi = 'ABCD'.indexOf(String(picked.slot || '').charAt(0));
    var url = null;
    if (!ok && picked.fb) url = (au.fbs && pi >= 0 && au.fbs[pi]) || null;
    else if (q.why && why === WQI.letters(q, q.why)) url = au.why || null;
    parts.push({ text: said, url: url });
    return parts;
  }
  // Leaving the page (closing the in-app browser, switching app, locking the phone) silences the
  // voice, the sound effects and any playing media at once. Nothing starts again by itself when
  // the child comes back: the next tap speaks. Other parts of the page can listen for 'wq-silence'.
  function stopAll() {
    stopVoice();
    try { if (actx && actx.state === 'running') actx.suspend(); } catch (e) {}
    try { Array.prototype.forEach.call(document.querySelectorAll('audio, video'), function (m) { try { m.pause(); } catch (e) {} }); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('wq-silence')); } catch (e) {}
  }
  window.addEventListener('pagehide', stopAll);
  window.addEventListener('beforeunload', stopAll);
  document.addEventListener('freeze', stopAll);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') stopAll(); });

  function question(i, retry) {
    var q = QS[i];
    var shown = Date.now();
    var h = bar(retry ? '<span class="wq-grow wq-qof">' + esc(T.second) + '</span>' : dots(i)) +
      (retry ? '' : '<p class="wq-qof">' + esc(T.qof(i + 1, N)) + '</p>') +
      '<div class="wq-item" data-kind="' + WQI.kind(q) + '">' + WQI.itemHtml(q, T, LANG) + '</div>' +
      '<div id="wq-help"></div><div id="wq-fb"></div>';
    render(h, retry ? 'M9-fix' : 'M6');
    wireBar();
    WQI.wireZoom(ROOT, T);
    // Fetch the next question's pictures now, so they are already here on slow data.
    if (!retry && QS[i + 1]) WQI.imageUrls(QS[i + 1]).forEach(function (u) { try { new Image().src = u; } catch (e) {} });
    ev(retry ? 'retry_view' : 'question_view', { qid: q.qid, i: i + 1 });

    function armHelp() {
      clearTimers();
      helpTimer = setTimeout(function () {
        var el = $('#wq-help');
        if (!el || el.getAttribute('data-done')) return;
        el.innerHTML = '<div class="wq-hint"><img src="' + IMG + 'thinking.webp" alt="">' + esc(T.helpAgain) + '<button class="wq-spk" id="wq-help-spk" aria-label="' + esc(T.listen) + '">🔊</button></div>';
        ev('help_shown', { qid: q.qid });
        on('#wq-help-spk', function () { ev('help_used', { qid: q.qid }); read(); });
      }, 12000);
    }
    // Help waits until the voice has finished, then gives the child time of their own.
    function read() {
      var b = $('#wq-spk'); if (b) b.classList.add('wq-speaking');
      speakSeq(readParts(q), function () { var b2 = $('#wq-spk'); if (b2) b2.classList.remove('wq-speaking'); armHelp(); });
    }
    on('#wq-spk', function () { ev('listen', { qid: q.qid }); read(); });
    on('#wq-stim', function () { ev('listen', { qid: q.qid, stim: 1 }); var au = q.audio || {}; if (au.stim) speak('', au.stim, null); });
    read();

    WQI.wire(ROOT, q, answer);
    function answer(slot) {
      (function () {
        var ok = WQI.grade(q, slot);
        var ms = Date.now() - shown;
        clearTimers(); stopVoice();
        var help = $('#wq-help'); if (help) { help.setAttribute('data-done', '1'); help.innerHTML = ''; }
        WQI.mark(ROOT, q, slot);
        if (retry) {
          lastRetryOk = ok;
          ev('retry_answer', { qid: q.qid, slot: slot, ok: ok ? 1 : 0, ms: ms });
        } else {
          S.seq = (S.seq || 0) + 1;
          S.answers[q.qid] = { slot: slot, ok: ok };
          if (!ok && S.wrong.indexOf(q.qid) < 0) S.wrong.push(q.qid);
          S.queue.push({ qid: q.qid, slot: slot, ms: ms, seq: S.seq });
          save();
          flushQueue();
          ev('answer', { qid: q.qid, slot: slot, ok: ok ? 1 : 0, ms: ms, i: i + 1 });
        }
        feedback(q, i, slot, ok, retry);
      })();
    }
  }

  function feedback(q, i, slot, ok, retry) {
    sfx(ok ? 'right' : 'notyet');
    var right = { text: WQI.rightText(q, LANG) };
    var picked = (q.options || []).filter(function (o) { return o.slot === slot; })[0] || {};
    // Right: the reason (why), so the child hears WHY it is right; a praise-only fb_right is the fallback.
    // Not yet: the feedback for the option the child picked, else the reason. Never praise.
    var why = WQI.letters(q, ok ? (q.why || q.fb_right || '') : (picked.fb || q.why || ''));
    var named = speakable(optText(right));
    var line = ok ? (retry ? T.fixed : T.right[i % T.right.length]) : named ? T.notyet(optText(right)) : T.notyetPlain;
    var answered = answeredCount();
    var halfway = !retry && ok !== null && answered === Math.ceil(N / 2) && N >= 4;
    var fb = $('#wq-fb');
    fb.innerHTML = '<div class="wq-jug"><img src="' + IMG + (ok ? 'correct' : 'notyet') + '.webp" alt=""><div class="wq-fb ' + (ok ? 'wq-ok' : 'wq-no') + '">' + esc(line) +
      (why ? '<div class="wq-why">' + WQI.tex(why) + '</div>' : '') +
      (!ok && !retry ? '<div class="wq-why">' + esc(T.again) + '</div>' : '') + '</div></div>' +
      (halfway ? '<p class="wq-proof">🎉 ' + esc(T.half) + '</p>' : '') +
      '<button class="wq-btn wq-go" id="wq-next">' + esc(T.next) + '</button>';
    ROOT.setAttribute('data-m', 'M7');
    ev('feedback_view', { qid: q.qid, ok: ok ? 1 : 0 });
    speakSeq(feedbackParts(q, ok, line, why, picked, named), null);
    var nx = $('#wq-next');
    try { nx.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    nx.addEventListener('click', function () {
      if (retry) return nextRetry();
      nextQuestion();
    });
  }

  /* ---------------- end of the first pass: finish (E5), then fix the tricky ones ---------------- */
  var finishing = null;
  function finish() {
    if (finishing) return finishing;
    finishing = flushQueue().then(function () {
      if (S.queue.length) throw new Error('queue_pending');
      return api('POST', 'finish', { st: S.st });
    }).then(function (r) {
      if (!r.ok) { finishing = null; var e = new Error('finish_' + r.status); e.r = r; throw e; }
      S.result = r.body; save();
      ev('quiz_complete', { pct: r.body.score && r.body.score.pct, ok: r.body.counted === false ? 0 : 1 });
      return r.body;
    }, function (e) { finishing = null; throw e; });
    return finishing;
  }
  function finishFirstPass() {
    finish().catch(function () {});
    var wrong = (S.wrong || []).filter(function (q) { return QS.some(function (x) { return x.qid === q; }); });
    if (!wrong.length) return results(0);
    var h = bar() + jug('thinking', T.trickySay) + '<h2>' + esc(T.tricky(wrong.length)) + '</h2>' +
      '<button class="wq-btn wq-go" id="wq-fix">' + esc(T.fixGo) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-later">' + esc(T.later) + '</button>';
    render(h, 'M9-tricky');
    wireBar();
    on('#wq-fix', function () { retryList = wrong.slice(); fixedN = 0; ev('retry_start', { i: wrong.length }); nextRetry(); });
    on('#wq-later', function () { ev('retry_skip', {}); results(0); });
  }
  var retryList = [], fixedN = 0, lastRetry = null;
  function nextRetry() {
    if (lastRetry) { if (lastRetryOk) fixedN++; lastRetry = null; lastRetryOk = false; }
    var qid = retryList.shift();
    if (!qid) return results(fixedN);
    var i = 0; for (; i < N; i++) if (QS[i].qid === qid) break;
    lastRetry = qid;
    question(i, true);
  }
  var lastRetryOk = false;

  /* ---------------- results (M9) ---------------- */
  function results(fixed) {
    render(bar() + '<div class="wq-boot"><img src="' + IMG + 'thinking.webp" alt="" width="96"></div>', 'M9-wait');
    wireBar();
    finish().then(function (res) {
      S.fixed = fixed; save();
      var sc = res.score || {};
      var total = sc.total || N;
      var h = bar() + jug('celebrate', T.praise(sc.correct, total), true) +
        '<div class="wq-card wq-stack wq-center"><p class="wq-qof">' + esc(T.done) + '</p>' +
        '<h1>' + esc(T.got(sc.correct, total)) + '</h1>' + stars(sc.correct, total) +
        (fixed ? '<p class="wq-sub">' + esc(T.fixedLine(fixed)) + '</p>' : '') +
        '<p class="wq-small">' + esc(T.scoreNote) + '</p></div>' +
        (res.counted === false ? '<div class="wq-banner">' + esc(T.prac) + '</div>' : '') +
        '<button class="wq-btn wq-go" id="wq-card">' + esc(T.seeCard) + '</button>' +
        '<button class="wq-btn wq-navy" id="wq-class">' + esc(T.classBtn) + '</button>';
      render(h, 'M9');
      wireBar();
      sfx('done');
      on('#wq-card', card);
      on('#wq-class', board);
    }, function (e) {
      var tooFew = e && e.r && e.r.status === 409;
      var h = bar() + jug('notyet', tooFew ? T.tooFew : T.offline) +
        '<button class="wq-btn wq-go" id="wq-retry">' + esc(tooFew ? T.next : T.next) + '</button>';
      render(h, 'M9-error');
      wireBar();
      ev('error', { err: (e && e.message) || 'finish' });
      on('#wq-retry', function () { if (tooFew) { S.answers = {}; save(); nextQuestion(); } else results(fixed); });
    });
  }

  /* ---------------- share: navigator.share -> wa.me -> copy ---------------- */
  function share(text, url, what) {
    var full = text + ' ' + url;
    ev('share_click', { src: what, step: 'tap' });
    if (navigator.share) {
      navigator.share({ text: text, url: url }).then(function () { ev('share_click', { src: what, step: 'native', path: 'native' }); },
        function (e) { if (e && e.name === 'AbortError') ev('share_click', { src: what, step: 'native_cancel' }); else fallback(full, what); });
      return;
    }
    fallback(full, what);
  }
  function fallback(full, what) {
    var h = bar() + '<h2>' + esc(T.fbT) + '</h2><p class="wq-sub">' + esc(T.fbSub) + '</p>' +
      '<div class="wq-card"><p>' + esc(full) + '</p></div>' +
      '<a class="wq-btn wq-go" id="wq-wa" href="https://wa.me/?text=' + encodeURIComponent(full) + '">' + esc(T.fbWa) + '</a>' +
      '<button class="wq-btn wq-soft" id="wq-copy">' + esc(T.fbCopy) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    var back = ROOT.getAttribute('data-m') === 'M11' ? board : card;
    NAV.shareBack = back;
    render(h, 'M12-fallback');
    wireBar();
    on('#wq-wa', function () { ev('share_click', { src: what, step: 'wa', path: 'wa' }); });
    on('#wq-copy', function () {
      function done() { ev('share_click', { src: what, step: 'copy', path: 'copy' }); toast(T.copied); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(full).then(done, legacy); else legacy();
      function legacy() {
        var ta = document.createElement('textarea'); ta.value = full; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
        if (ok) done(); else ev('share_click', { src: what, step: 'copy_failed' });
      }
    });
    on('#wq-back', back);
  }

  /* ---------------- M10 scorecard ---------------- */
  function card() {
    var res = S.result || {};
    var c = res.card || {};
    var total = c.total || N;
    var h = bar() +
      '<div class="wq-scorecard"><header><i></i>' + dotJoin('NIETE', CLS.label) + '</header><div class="wq-in">' +
      '<img src="' + IMG + 'celebrate.webp" alt="">' +
      '<div class="wq-name">' + ani(c.animal) + ' ' + esc(c.first || (S.child && S.child.first) || '') + '</div>' +
      '<p class="wq-sub">' + esc(Q.topic) + '</p>' +
      '<div class="wq-big">' + esc(c.correct) + '/' + esc(total) + '</div>' + stars(c.stars != null ? c.stars : c.correct, total) +
      '<div class="wq-praise">' + esc(T.praise(c.correct, total)) + '</div></div></div>' +
      '<p class="wq-small wq-center">' + esc(T.cardPriv) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-share">' + esc(T.shareBtn) + '</button>' +
      '<button class="wq-btn wq-navy" id="wq-chal">' + esc(T.challenge) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-class">' + esc(T.classBtn) + '</button>';
    render(h, 'M10');
    wireBar();
    ev('card_view', {});
    var chalUrl = link('/q/' + (res.challenge_code || CODE) + '?from=' + encodeURIComponent(c.first || ''));
    // The class group gets the CLASS link: a classmate who joined through a friend's challenge code would
    // count as that child's friend and drop out of the teacher's class report.
    var classUrl = link('/q/' + CODE);
    on('#wq-share', function () { share(T.shareLine(c.first, c.correct, total, Q.topic), classUrl, 'card'); });
    on('#wq-chal', function () { share(T.shareLine(c.first, c.correct, total, Q.topic), chalUrl, 'challenge'); });
    on('#wq-class', board);
  }

  /* ---------------- M11 league table ---------------- */
  function board() {
    render(bar() + '<div class="wq-boot"><img src="' + IMG + 'thinking.webp" alt="" width="96"></div>', 'M11-wait');
    wireBar();
    api('GET', 'board/' + encodeURIComponent(CODE) + (S.st ? '?st=' + encodeURIComponent(S.st) : '')).then(function (r) {
      if (!r.ok) throw new Error('board_' + r.status);
      var b = r.body;
      var you = b.you || null;
      var me = S.child && S.child.first;
      var youShown = false;
      var rows = (b.rows || []).map(function (x) {
        var isYou = you && x.place === you.place && x.first === me && x.correct === you.correct && !youShown;
        if (isYou) youShown = true;
        return '<tr' + (isYou ? ' class="wq-you"' : '') + '><td>' + esc(x.place) + '</td><td>' + ani(x.animal) + ' ' + esc(x.first) +
          (isYou ? '<span class="wq-tag">' + esc(T.you) + '</span>' : '') + '</td><td>' + esc(x.correct) + '/' + esc(x.total) + ' ⭐</td></tr>';
      }).join('');
      if (you && !youShown) {
        rows += '<tr class="wq-you"><td>' + esc(you.place) + '</td><td>' + ani(S.child && S.child.animal) + ' ' + esc(me || '') + '<span class="wq-tag">' + esc(T.you) + '</span></td><td>' + esc(you.correct) + '/' + esc(you.total) + ' ⭐</td></tr>';
      }
      var yourPct = you && you.total ? Math.round(100 * you.correct / you.total) : null;
      var h = bar() + '<h2>' + esc(T.leagueT(CLASS_LABEL)) + '</h2><p class="wq-sub">' + dotJoin(Q.topic, T.finN(b.finishers_n || 0)) + '</p>' +
        (rows ? '<table class="wq-table"><tbody>' + rows + '</tbody></table>' : '<div class="wq-card">' + esc(T.noRows) + '</div>') +
        (b.more_n ? '<p class="wq-sub wq-center">' + esc(T.moreN(b.more_n)) + '</p>' : '') +
        '<div class="wq-card wq-cmp">' +
        (yourPct != null ? '<span>' + esc(T.yourScore) + '</span><span>' + yourPct + '%</span><div class="wq-meter" style="grid-column:1/3"><b style="width:' + yourPct + '%"></b></div>' : '') +
        '<span>' + esc(T.avg) + '</span><span>' + esc(b.class_avg_pct || 0) + '%</span><div class="wq-meter wq-avg" style="grid-column:1/3"><b style="width:' + (b.class_avg_pct || 0) + '%"></b></div></div>' +
        '<p class="wq-small">' + esc(T.firstOnly) + '</p>' +
        '<button class="wq-btn wq-go" id="wq-share-t">' + esc(T.shareTable) + '</button>' +
        (S.result ? '<button class="wq-btn wq-soft" id="wq-next">' + esc(T.next) + '</button>' : '<button class="wq-btn wq-navy" id="wq-play">' + esc(T.play) + '</button>');
      render(h, 'M11');
      wireBar();
      ev('board_view', { src: B.view === 'class' ? 'class_link' : 'page', i: b.finishers_n });
      on('#wq-share-t', function () { share(T.tableLine(Q.topic, CLASS_LABEL), link('/q/' + CODE + '/class'), 'table'); });
      on('#wq-next', history);
      on('#wq-play', landing);
    }).catch(function (e) {
      ev('error', { err: (e && e.message) || 'board' });
      render(bar() + jug('notyet', T.offline) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M11-error');
      wireBar();
      on('#wq-retry', board);
    });
  }

  /* ---------------- M13 history (when the API has it) -> M14 today ---------------- */
  function history() {
    var chips = kids().map(function (k) { return k.chip; }).filter(Boolean).slice(0, 6);
    if (!chips.length) return today();
    api('POST', 'me', { code: CODE, chips: chips }).then(function (r) {
      var hist = (r.ok && r.body.history) || [];
      var fr = (r.ok && r.body.friends_finished) || [];
      if (!hist.length && !fr.length) return today();
      var h = bar() + '<h2>' + esc(T.histT) + '</h2><ul class="wq-hist">' + hist.slice(0, 10).map(function (x) {
        return '<li><span>' + esc(x.topic) + '<br><small class="wq-small">' + esc(x.date) + '</small></span><span>' + esc(x.correct) + '/' + esc(x.total) + ' ⭐</span></li>';
      }).join('') + '</ul>' +
        (fr.length ? '<p class="wq-sub">' + esc(T.friends) + '</p><ul class="wq-hist">' + fr.slice(0, 6).map(function (x) {
          return '<li><span>' + dotJoin(x.first, x.topic) + '</span><span>' + esc(x.correct) + '/' + esc(x.total) + '</span></li>';
        }).join('') + '</ul>' : '') +
        '<button class="wq-btn wq-go" id="wq-next">' + esc(T.next) + '</button>';
      render(h, 'M13');
      wireBar();
      ev('history_view', { i: hist.length });
      on('#wq-next', today);
    }, today);
  }
  function today() {
    var h = bar() + jug('sleep', T.rest, true) +
      '<div class="wq-card wq-stack wq-center"><p class="wq-qof">' + esc(T.todayT) + '</p>' +
      '<div class="wq-big">' + esc(fmtN(LIVE.ict_today_floor || 0)) + '</div>' +
      '<p class="wq-sub">' + esc(T.proof(LIVE.ict_today_floor || 0)) + '</p></div>' +
      '<button class="wq-btn wq-soft" id="wq-home">' + esc(T.home) + '</button>';
    render(h, 'M14');
    wireBar();
    ev('today_view', {});
    on('#wq-home', function () { if (S.result) card(); else landing(); });
  }

  /* ---------------- resume after reload ("Continue 3/5") ---------------- */
  function resume() {
    var n = answeredCount();
    var h = bar() + jug('hello', T.contSay(S.child.first || '')) +
      '<div class="wq-card"><h1>' + esc(Q.topic) + '</h1></div>' +
      '<button class="wq-btn wq-go" id="wq-cont">' + esc(T.cont(n + 1 > N ? N : n + 1, N)) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-restart">' + esc(T.notMe(S.child.first || '')) + '</button>';
    render(h, 'M3-continue');
    wireBar();
    on('#wq-cont', function () { ev('resume', { i: n }); flushQueue(); if (wantsVideo()) video(); else nextQuestion(); });
    on('#wq-restart', who);
  }

  /* ---------------- the Android back button (in-app browser) ---------------- */
  // WhatsApp's in-app browser closes on Back when the page has no history entry of its own, so a child who
  // pressed it on a question lost the page. The page keeps ONE entry, added on a tap (Chrome skips entries
  // a page adds without one): Back on a side screen goes to the screen it came from; during the quiz the
  // first Back only warns (the answers are saved) and a second one leaves; on the end screens it leaves.
  var NAV = { armed: false, warnAt: 0, leaving: false, shareBack: null };
  var PLAYING = { M5: 1, M6: 1, M7: 1, 'M9-fix': 1, 'M9-tricky': 1 };
  function afterResult() { if (S.result) card(); else landing(); }
  function backTo(m) {
    if (m === 'M4') return landing;
    if (m === 'M4-new' || m === 'M4-isyou') return who;
    if (m === 'M12-fallback') return NAV.shareBack || afterResult;
    if (m === 'M11' || m === 'M13' || m === 'M14' || /^M15/.test(m)) return afterResult;
    return null;
  }
  function navArm() {
    if (NAV.armed || NAV.leaving) return;
    try {
      var h = window.history;   // not `history`: that name is the M13 screen in this file
      if (!h || !h.pushState) return;
      h.replaceState({ wq: 'base' }, '');
      h.pushState({ wq: 'top' }, '');
      NAV.armed = true;
    } catch (e) {}
  }
  function navBack() {
    NAV.armed = false;
    var m = ROOT.getAttribute('data-m') || '';
    var to = backTo(m);
    var src = m.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (to) { ev('back', { src: src, step: 'screen' }); to(); return; }
    if (PLAYING[m] && Date.now() - NAV.warnAt > 3000) { NAV.warnAt = Date.now(); ev('back', { src: src, step: 'warn' }); toast(T.backAgain); return; }
    ev('back', { src: src, step: 'leave' });
    flushEv(true);
    NAV.leaving = true;
    try { window.history.back(); } catch (e) {}
  }
  window.addEventListener('popstate', function () { if (!NAV.leaving) navBack(); });
  document.addEventListener('click', navArm, true);

  /* ---------------- boot ---------------- */
  var conn = navigator.connection || {};
  ev('page_open', { ua: String(navigator.userAgent || '').slice(0, 300), iab: IAB, store: STORE_OK ? 1 : 0, net: conn.effectiveType || '', src: B.view || 'quiz', reason: params.from ? 'challenge' : undefined });
  if (S.queue.length) flushQueue();
  if (B.view === 'class') board();
  else if (S.result && S.st) card();
  else if (S.st && S.child && (answeredCount() > 0 || (S.vt > 0 && wantsVideo()))) resume();
  else landing();
})();
