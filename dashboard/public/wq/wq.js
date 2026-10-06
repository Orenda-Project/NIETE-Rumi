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
  // A magnifier with a plus: the zoom control is an icon in the picture's corner (its words are for screen readers).
  var ZOOM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
    '<path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
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
      '<button class="wq-zoom" aria-label="' + esc(T.zoom || 'Zoom') + '">' + ZOOM_ICON + '</button></figure>';
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
    // p: the kind of part, logged with audio_missing so misses can be counted per kind.
    if (fg.say && speakable(fg.say) && !points) parts.push({ text: fg.say, url: null, p: 'fig' });
    parts.push({ text: rd.stem || say(q.text, lang), url: (au && au.q) || null, p: 'q' });
    if (au && au.stim) parts.push({ text: '', url: au.stim, stim: true, p: 'stim' });
    if (kind(q) === 'match') (q.left || []).forEach(function (l) { if (speakable(l.text)) parts.push({ text: say(l.text, lang), url: null, p: 'left' }); });
    if (kind(q) === 'label') return parts;
    opts(q).forEach(function (o, k) {
      var si = 'ABCD'.indexOf(String(o.slot || '').charAt(0));
      var url = au && au.opts && si >= 0 ? au.opts[si] || null : null;
      var t = (rd.opts && rd.opts[k]) || o.name || (o.pic && o.pic.name) || say(o.text, lang);
      if (url || speakable(t)) parts.push({ text: t, url: url, p: 'opt' });
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
    if (o.pic && o.pic.svg) {
      // An unnamed picture (an emoji option drawn as a picture) is hidden from screen readers; its button carries the shape's name.
      var al = o.pic.alt != null ? o.pic.alt : nm;
      return '<span class="wq-pic"' + (al ? ' role="img" aria-label="' + esc(al) + '"' : ' aria-hidden="true"') + '>' + cleanSvg(o.pic.svg) + '</span>';
    }
    // ?z=1: the server cropped near-identical pictures to where they differ; the crop fills the tile.
    if (o.img && /[?&]z=1\b/.test(o.img)) return '<img src="' + esc(o.img) + '" alt="' + esc(nm || '') + '" class="wq-z wq-ld" onload="this.className=\'wq-z\'" onerror="this.className=\'wq-z\'">';
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
        return '<button class="wq-ml' + (l.pic ? ' wq-mlp' : '') + '" data-i="' + i + '">' + (l.pic ? picHtml(l, l.name) : '') + '<span class="wq-lab">' + tex(l.text) + '</span><span class="wq-mto"></span></button>';
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
  // The deployment's brand (boot JSON, from bot/shared/config/web-quiz-brand.js): marks, names, mascot, place.
  var BR = B.brand || null;
  var MASC = (BR && BR.mascot) || { en: 'Jugnu', ur: 'جگنو' };
  var PLACE = (BR && BR.place) || null;
  var params = (function () { var o = {}; try { new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); } catch (e) {} return o; })();

  /* ---------------- copy (en + ur). Jugnu speaks one short line per screen. ---------------- */
  var T = {
    en: {
      quiz: 'QUIZ', from: function (t, c) { return [t ? 'From ' + t : '', c].filter(Boolean).join(' · '); },
      meta: function (n) { var m = Math.max(1, Math.round(n * 0.6)); return n + (n === 1 ? ' question' : ' questions') + ' · about ' + m + (m === 1 ? ' minute' : ' minutes'); },
      hello: 'Assalam o Alaikum! Let\'s play the quiz together.', helloN: function (n) { return 'Welcome back, ' + n + '!'; },
      play: 'Play', playAs: function (n) { return 'Play as ' + n; }, notMe: function (n) { return 'Not ' + n + '?'; },
      proof: function (n) { return n.toLocaleString('en') + (PLACE ? ' children in ' + PLACE.en + ' played today' : ' children played today'); },
      classToday: function (n) { return n + ' in your class played today'; },
      whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: function (c) { return 'Find your name in ' + c; },
      newKid: "I'm new", newT: 'Hello! What is your first name?', newSay: 'Just your first name.', start: 'Start', privacy: 'Only first names. No phone numbers.',
      isYou: function (n) { return 'Are you ' + n + '?'; }, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", diff: function (n) { return "I'm a different " + n; },
      vT: 'Watch the lesson (optional)', vSay: 'Watch first, or go straight in.', skip: 'Go to the questions', watched: 'Done watching',
      how: [['🔊', 'Listen to each question'], ['👆', 'Tap a colour or a picture'], ['🙋', 'Stuck? Help comes']],
      qof: function (i, n) { return 'Question ' + i + ' of ' + n; }, listen: 'Listen again', helpAgain: 'Shall we listen again?', hintAsk: 'Need a hint?', hintNudge: 'Stuck? Tap me for a hint.',
      orderHelp: 'Tap the steps in the right order.', matchHelp: 'Tap one, then tap its partner.', labelHelp: 'Tap the right part of the picture.',
      zoom: 'Make the picture bigger', close: 'Close', playSound: 'Play the sound', yes: 'True', no: 'False',
      notyet: function (lead, r) { return lead + ' "' + String(r).replace(/[.!۔]+\s*$/, '') + '".'; }, next: 'Next', again: 'This one comes back at the end, to fix together.',
      half: 'Halfway there!',
      tricky: function (n) { return n === 1 ? '1 tricky one' : n + ' tricky ones'; }, trickySay: "Before we celebrate, let's fix it together.", fixGo: 'Fix it with ' + MASC.en, later: 'Maybe later',
      second: 'Second try · with ' + MASC.en, tryAgain: 'Look again. You can do it.',
      got: function (s, n) { return 'You got ' + s + ' out of ' + n; }, fixedLine: function (k) { return '+ fixed ' + k + ' tricky one' + (k > 1 ? 's' : '') + ' with ' + MASC.en; },
      scoreNote: 'Your score is your first try.', praise: function (s, n) { return s === n ? 'Brilliant!' : s >= n * 0.8 ? 'Great work!' : 'Good try!'; },
      done: 'QUIZ COMPLETE', seeCard: 'See my card', classBtn: 'See my class',
      prac: 'This name already finished on another phone. This round is practice; your first finished score stays.',
      shareBtn: 'Share to class group', challenge: 'Challenge a friend', cardPriv: 'Only your first name goes on the card.',
      shareLine: function (w, s, n, t) { return w + ' got ' + s + '/' + n + ' stars on ' + t + '. Can you beat it?'; },
      tableLine: function (t, c) { return c + ' league table for ' + t + '. Not played yet? Same link, still open:'; },
      leagueT: function (c) { return c + ' league table'; }, you: 'YOU', moreN: function (n) { return n + ' more in the class'; },
      finN: function (n) { return n + ' finished'; }, yourScore: 'Your score', avg: 'Class average', firstOnly: 'First names only. Ties share a place.',
      shareTable: 'Share the class table', noRows: 'Nobody has finished yet. Be the first!',
      schoolsBtn: '🏫 School league', schoolsT: 'School league', schoolsRule: 'This week · 10 points for playing, up to 10 for your score',
      pts: function (n) { return fmtN(n) + (n === 1 ? ' point' : ' points'); }, kidsN: function (n) { return fmtN(n) + (n === 1 ? ' child played' : ' children played'); },
      yourSchool: 'YOUR SCHOOL', moveNew: 'NEW', schoolPlace: function (s, p) { return s + ' is #' + p + ' this week'; },
      sinceY: function (m) { return (m > 0 ? '▲' : '▼') + Math.abs(m) + ' since yesterday'; },
      added: function (n, s) { return '+' + n + ' points for ' + s + '!'; },
      ghost: function (s) { return 'No one from ' + s + ' has played yet this week. Be the first!'; },
      zeroN: function (n) { return fmtN(n) + (n === 1 ? ' school still to start' : ' schools still to start'); },
      allSchools: 'All', mySector: 'My sector',
      noSchools: 'No school has played yet this week. Yours can be first!', shareSchools: 'Share the school league', inviteSchool: 'Invite my school to play',
      schoolsLine: function (s, p) { return p ? s + ' is #' + p + ' of all schools this week. Play and help us climb:' : 'No one from ' + s + ' has played yet this week. Be the first:'; },
      histT: 'Your scores', todayT: PLACE ? 'Today in ' + PLACE.en : 'Today', rest: 'Time to rest. See you tomorrow!', todayMore: 'Great work today! Want to watch another video?', back: 'Back', sounds: 'Sounds',
      cont: function (i, n) { return 'Go on: question ' + i + ' of ' + n; }, contSay: function (n) { return 'Welcome back, ' + n + '! Your answers are saved.'; }, restart: 'Start again', months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      fbT: 'Send it on WhatsApp', fbSub: 'Tap the WhatsApp button, then pick the chat.', fbWa: 'Send on WhatsApp', fbCopy: 'Copy the message', copied: 'Message copied',
      backAgain: 'Your answers are saved. Press back again to leave.',
      todaySub: 'children played today', myScores: 'My scores',
      sharePlayed: function (w, t) { return w + ' played ' + t + '. Your turn!'; },
      moreBtn: 'Watch another video', moreT: 'More videos for you', moreSay: 'Pick a video. Its quiz comes right after.',
      moreNone: 'No more videos for your class yet.', moreWait: 'Opening the video…', mins: function (n) { return n + ' min'; }, doneTag: 'Done ✓',
      selfT: 'This is your own test run. It will not show in your class report.',
      challenged: function (n, s, t) { return n + ' got ' + s + '/' + t + ' stars. Can you beat it?'; }, challengedBy: function (n) { return n + ' challenged you. Can you beat their score?'; },
      vs: { win: 'You beat the challenge!', tie: "It's a tie!", lose: 'So close! Play again?' }, vsYou: 'You', frOut: { win: 'beat you!', tie: 'tie', lose: 'you won' },
      offWait: 'Your results will reach your teacher when you are back online.', offDone: 'All done! Your answers are saved on this phone.', tryNow: 'Send now',
      offline: 'No internet right now. Your answers are saved on this phone.', tooFew: 'Answer a few more questions first.', oops: 'Something went wrong. Please try again.',
      friends: 'Friends who finished', home: 'Home', yourClass: 'Your class', check: 'Check', pickAll: 'Tap every right answer, then Check.', previewPlay: 'Try it as a child'
    },
    ur: {
      quiz: 'کوئز', from: function (t, c) { return [t ? t + ' کی طرف سے' : '', c ? String(c).replace(/ /g, '\u00A0') : ''].filter(Boolean).join(' · '); },
      meta: function (n) { return n + ' سوال · تقریباً ' + Math.max(1, Math.round(n * 0.6)) + ' منٹ'; },
      hello: 'السلام علیکم! آئیں، کوئز کھیلیں۔', helloN: function (n) { return n + '، خوش آمدید!'; },
      play: 'کھیلیں', playAs: function (n) { return n + '، شروع کریں'; }, notMe: function (n) { return n + ' نہیں؟'; },
      proof: function (n) { return 'آج ' + (PLACE ? PLACE.ur + ' میں ' : '') + n.toLocaleString('en') + ' بچوں نے کھیلا'; },
      classToday: function (n) { return 'آج آپ کی کلاس میں ' + n + ' نے کھیلا'; },
      whoT: 'آج کس کی باری ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', onPhone: 'اس فون پر', inClass: function (c) { return c + ' میں اپنا نام ڈھونڈیں'; },
      newKid: 'نیا نام', newT: 'السلام علیکم! آپ کا پہلا نام کیا ہے؟', newSay: 'صرف پہلا نام لکھیں۔', start: 'شروع کریں', privacy: 'صرف پہلا نام۔ فون نمبر نہیں۔',
      isYou: function (n) { return 'کیا آپ ' + n + ' ہیں؟'; }, isYouSub: 'ہاں صرف تب دبائیں جب یہ آپ کا اپنا نام ہو۔', yesMe: 'جی ہاں، یہ میں ہوں', diff: function (n) { return 'میں کوئی اور ' + n + ' ہوں'; },
      vT: 'سبق دیکھیں (اختیاری)', vSay: 'پہلے دیکھیں، یا سیدھا سوالوں پر چلیں۔', skip: 'سوالوں پر چلیں', watched: 'دیکھ لیا',
      how: [['🔊', 'ہر سوال سنیں'], ['👆', 'رنگ یا تصویر پر ٹیپ کریں'], ['🙋', 'مشکل ہو تو مدد ملے گی']],
      qof: function (i, n) { return 'سوال ' + i + ' از ' + n; }, listen: 'دوبارہ سنیں', helpAgain: 'کیا دوبارہ سنیں؟', hintAsk: 'اشارہ چاہیے؟', hintNudge: 'مشکل لگ رہا ہے؟ اشارے کے لیے مجھے دبائیں۔',
      orderHelp: 'قدموں کو صحیح ترتیب سے ٹیپ کریں۔', matchHelp: 'ایک پر ٹیپ کریں، پھر اس کے جوڑے پر۔', labelHelp: 'تصویر میں صحیح حصے پر ٹیپ کریں۔',
      zoom: 'تصویر بڑی کریں', close: 'بند کریں', playSound: 'آواز سنیں', yes: 'درست', no: 'غلط',
      notyet: function (lead, r) { return lead + ' ' + String(r).replace(/[.!۔]+\s*$/, ''); }, next: 'اگلا', again: 'یہ سوال آخر میں دوبارہ آئے گا، مل کر ٹھیک کرنے کے لیے۔',
      half: 'آدھا راستہ طے!',
      tricky: function (n) { return n + ' مشکل سوال'; }, trickySay: 'جشن سے پہلے، آئیں اسے مل کر ٹھیک کریں۔', fixGo: MASC.ur + ' کے ساتھ ٹھیک کریں', later: 'بعد میں',
      second: 'دوسری کوشش · ' + MASC.ur + ' کے ساتھ', tryAgain: 'دوبارہ دیکھیں۔ آپ کر سکتے ہیں۔',
      got: function (s, n) { return 'آپ نے ' + n + ' میں سے ' + s + (s === 1 ? ' درست کیا' : ' درست کیے'); }, fixedLine: function (k) { return MASC.ur + ' کے ساتھ ' + k + ' مشکل سوال ٹھیک کیے'; },
      scoreNote: 'اسکور پہلی کوشش کا ہے۔', praise: function (s, n) { return s === n ? 'زبردست!' : s >= n * 0.8 ? 'بہت خوب!' : 'اچھی کوشش!'; },
      done: 'کوئز مکمل', seeCard: 'میرا کارڈ دیکھیں', classBtn: 'اپنی کلاس دیکھیں',
      prac: 'یہ نام کسی اور فون پر مکمل ہو چکا ہے۔ یہ باری مشق ہے؛ پہلا مکمل اسکور ہی رہے گا۔',
      shareBtn: 'کلاس گروپ میں بھیجیں', challenge: 'دوست کو چیلنج کریں', cardPriv: 'کارڈ پر صرف آپ کا پہلا نام جاتا ہے۔',
      shareLine: function (w, s, n, t) { return w + ' نے ' + t + ' میں ' + n + ' میں سے ' + s + ' ستارے لیے۔ کیا اس سے زیادہ ستارے ملیں گے؟'; },
      tableLine: function (t, c) { return t + ': ' + c + ' کی لیگ ٹیبل۔ ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے:'; },
      leagueT: function (c) { return c + ' کی لیگ ٹیبل'; }, you: 'آپ', moreN: function (n) { return 'کلاس میں ' + n + ' اور'; },
      finN: function (n) { return n + ' نے مکمل کیا'; }, yourScore: 'آپ کا اسکور', avg: 'کلاس کی اوسط', firstOnly: 'صرف پہلے نام۔ برابر اسکور والوں کا نمبر ایک ہے۔',
      shareTable: 'کلاس ٹیبل بھیجیں', noRows: 'ابھی کسی نے مکمل نہیں کیا۔ سب سے پہلے کھیلیں!',
      schoolsBtn: '🏫 اسکولوں کی لیگ', schoolsT: 'اسکولوں کی لیگ', schoolsRule: 'اس ہفتے · کھیلنے کے 10 پوائنٹس، اسکور کے 10 تک',
      pts: function (n) { return fmtN(n) + ' پوائنٹس'; }, kidsN: function (n) { return fmtN(n) + (n === 1 ? ' بچے نے کھیلا' : ' بچوں نے کھیلا'); },
      yourSchool: 'آپ کا اسکول', moveNew: 'نیا', schoolPlace: function (s, p) { return s + ' اس ہفتے نمبر ' + p + ' پر'; },
      sinceY: function (m) { return 'کل سے ' + Math.abs(m) + (m > 0 ? ' درجے اوپر' : ' درجے نیچے'); },
      added: function (n, s) { return s + ' کے لیے ' + n + '+ پوائنٹس!'; },
      ghost: function (s) { return 'اس ہفتے ' + s + ' سے ابھی کسی نے نہیں کھیلا۔ سب سے پہلے کھیلیں!'; },
      zeroN: function (n) { return fmtN(n) + ' اسکول ابھی شروع نہیں ہوئے'; },
      allSchools: 'سب', mySector: 'میرا سیکٹر',
      noSchools: 'اس ہفتے ابھی کسی اسکول نے نہیں کھیلا۔ آپ کا اسکول پہلا ہو سکتا ہے!', shareSchools: 'اسکول لیگ بھیجیں', inviteSchool: 'اسکول کو کھیلنے کی دعوت دیں',
      schoolsLine: function (s, p) { return p ? s + ' اس ہفتے سب اسکولوں میں نمبر ' + p + ' پر ہے۔ کھیلیں اور اسے اوپر لے جائیں:' : 'اس ہفتے ' + s + ' سے ابھی کسی نے نہیں کھیلا۔ سب سے پہلے کھیلیں:'; },
      histT: 'آپ کے اسکور', todayT: PLACE ? 'آج ' + PLACE.ur + ' میں' : 'آج', rest: 'اب آرام کا وقت۔ کل پھر ملاقات ہوگی!', todayMore: 'آج بہت اچھا کام کیا! ایک اور ویڈیو دیکھیں؟', back: 'واپس', sounds: 'آوازیں',
      cont: function (i, n) { return 'جاری رکھیں: سوال ' + i + ' از ' + n; }, contSay: function (n) { return n + '، خوش آمدید! آپ کے جواب محفوظ ہیں۔'; }, restart: 'نئے سرے سے شروع کریں', months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
      fbT: 'واٹس ایپ پر بھیجیں', fbSub: 'واٹس ایپ والا بٹن دبائیں، پھر چیٹ چنیں۔', fbWa: 'واٹس ایپ پر بھیجیں', fbCopy: 'پیغام کاپی کریں', copied: 'پیغام کاپی ہو گیا',
      backAgain: 'آپ کے جواب محفوظ ہیں۔ باہر جانے کے لیے دوبارہ بیک دبائیں۔',
      todaySub: 'بچوں نے کھیلا', myScores: 'میرے اسکور',
      sharePlayed: function (w, t) { return w + ' نے ' + t + ' کھیلا۔ اب آپ کی باری!'; },
      moreBtn: 'ایک اور ویڈیو دیکھیں', moreT: 'آپ کے لیے مزید ویڈیوز', moreSay: 'ایک ویڈیو چنیں۔ اس کے بعد اس کا کوئز آئے گا۔',
      moreNone: 'ابھی آپ کی کلاس کے لیے اور ویڈیوز نہیں ہیں۔', moreWait: 'ویڈیو کھل رہی ہے…', mins: function (n) { return n + ' منٹ'; }, doneTag: 'مکمل ✓',
      selfT: 'یہ آپ کا اپنا ٹیسٹ رن ہے۔ یہ کلاس رپورٹ میں شامل نہیں ہوگا۔',
      challenged: function (n, s, t) { return n + ' نے ' + t + ' میں سے ' + s + ' ستارے لیے۔ اب آپ کی باری!'; }, challengedBy: function (n) { return n + ' نے آپ کو چیلنج کیا ہے۔ اب آپ کی باری!'; },
      vs: { win: 'آپ نے چیلنج جیت لیا!', tie: 'مقابلہ برابر رہا!', lose: 'تھوڑی سی کمی رہ گئی! دوبارہ کھیلیں؟' }, vsYou: 'آپ', frOut: { win: 'آپ سے آگے!', tie: 'برابر', lose: 'آپ کی جیت' },
      offWait: 'انٹرنیٹ واپس آتے ہی آپ کا نتیجہ استاد تک پہنچ جائے گا۔', offDone: 'سب ہو گیا! آپ کے جواب اس فون پر محفوظ ہیں۔', tryNow: 'ابھی بھیجیں',
      offline: 'ابھی انٹرنیٹ نہیں ہے۔ آپ کے جواب اس فون پر محفوظ ہیں۔', tooFew: 'پہلے کچھ اور سوالوں کے جواب دیں۔', oops: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
      friends: 'دوست جنہوں نے مکمل کیا', home: 'پہلا صفحہ', yourClass: 'آپ کی کلاس', check: 'جانچیں', pickAll: 'ہر درست جواب پر ٹیپ کریں، پھر جانچیں۔', previewPlay: 'بچے کی طرح آزمائیں'
    }
  }[LANG];

  var CLASS_LABEL = CLS.label || T.yourClass;
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var STAR = '<svg class="wq-star{on}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  var IMG = '/wq/jugnu/';

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
  // One switch for every sound on the page (the voice and the tap tones), remembered on this phone; on by default.
  var SOUND = sget('wq_sound', true) !== false;

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

  /* ---------------- the shared feedback voice ----------------
     Lines recorded ONCE for every quiz (public/wq/voice/<lang>/<set>-<i>.mp3, manifest.json beside them,
     its `voices` naming the voice: the quiz's ONE voice per language, bot/shared/services/quiz/
     web-quiz-voice.js, the same voice as every per-quiz clip). VOICE_V is the hash of the recorded
     files (a test holds it), so a re-record reaches every phone. The words here are
     exactly the recorded words (a test holds them to manifest.json); one is picked at random per
     answer, never the same one twice in a row. Urdu addresses the child only with imperatives or
     noun phrases; a not-yet line never praises. */
  var VOICE_V = 'af23702c';
  var VOICE = {"en": {"right": ["Yes! That's right!", "You got it!", "Correct! Well spotted.", "Yes! That's the one.", "Right answer! Good thinking.", "Yes! You checked carefully.", "That's it! Well done.", "Spot on!", "Yes! Keep it up.", "Brilliant, that's right!"], "notyet": ["Not yet. The answer is", "Not quite. The right answer is", "Not this one. The answer is", "Let's learn it together. The answer is", "That one was tricky. The answer is", "Not this time. The right answer is", "Hmm, not yet. The answer is", "No problem, let's see. The answer is"], "fixed": ["Fixed it!", "Now you've got it!", "Yes! That's it now.", "You worked it out!", "Second try, and it's right!", "That's the one!", "Now it's right. Well done!", "Yes! Fixed it."], "done": ["Quiz complete! Every question done.", "All done! Thank you for playing.", "You finished the whole quiz!", "The end! Let's see your stars.", "That was the last one. All done!", "Finished! Well played.", "Quiz complete! Let's look at your stars.", "Every question answered. Well done!"], "cheer": ["Halfway there! Keep going.", "Keep going!", "Take your time and listen carefully.", "On to the next one!", "Half the quiz done!", "Every question teaches something new.", "Let's keep going!", "Half the questions done!"], "notyetpic": ["Not yet. Look, this one is right."], "tftrue": ["Not yet. This sentence is true."], "tffalse": ["Not yet. This sentence is false."]}, "ur": {"right": ["شاباش! بالکل صحیح!", "جی ہاں! یہی صحیح جواب ہے۔", "واہ! بالکل ٹھیک۔", "زبردست! صحیح جواب۔", "بہت خوب! یہی تو ہے۔", "صحیح! غور سے دیکھنا کام آیا۔", "جی ہاں! بہت عمدہ جواب۔", "کمال! بالکل درست۔", "ہاں! یہی ہے صحیح جواب۔", "شاباش! ایسے ہی آگے چلیں۔"], "notyet": ["ابھی نہیں۔ صحیح جواب ہے:", "یہ والا نہیں۔ صحیح جواب ہے:", "کوئی بات نہیں۔ صحیح جواب ہے:", "آئیں مل کر سیکھیں۔ صحیح جواب ہے:", "یہ سوال مشکل تھا۔ صحیح جواب ہے:", "اس بار نہیں۔ صحیح جواب ہے:", "ابھی نہیں۔ آئیں دیکھیں، صحیح جواب ہے:", "کوشش سے ہی سیکھتے ہیں۔ صحیح جواب ہے:"], "fixed": ["ٹھیک ہو گیا!", "اب بالکل صحیح!", "جی ہاں! اب ٹھیک ہے۔", "شاباش! دوسری کوشش میں صحیح۔", "زبردست! اب بات سمجھ میں آ گئی۔", "واہ! یہی ہے صحیح جواب۔", "کمال! اب درست ہے۔", "بہت خوب! اب جواب ٹھیک ہے۔"], "done": ["کوئز مکمل! سارے سوال ہو گئے۔", "شاباش! پورا کوئز مکمل۔", "کوئز ختم! چلیں، ستارے دیکھیں۔", "واہ! آخری سوال بھی ہو گیا۔", "مکمل! کھیلنے کا شکریہ۔", "زبردست! پورا کوئز حل ہو گیا۔", "کوئز پورا ہو گیا! بہت خوب۔", "سارے سوال مکمل! شاباش۔"], "cheer": ["آدھا کوئز ہو گیا! چلتے رہیں۔", "آدھا راستہ طے، آگے چلیں!", "ہمت نہ ہاریں، اگلا سوال!", "آرام سے، غور سے سنیں۔", "چلیں، اگلا سوال دیکھیں!", "ہر سوال سے کچھ نیا سیکھیں۔", "ایسے ہی چلتے رہیں!", "آدھے سوال ہو گئے!"], "notyetpic": ["ابھی نہیں۔ دیکھیں، یہ والا صحیح ہے۔"], "tftrue": ["ابھی نہیں۔ یہ بات درست ہے۔"], "tffalse": ["ابھی نہیں۔ یہ بات غلط ہے۔"]}};
  var lastPick = {};
  function vline(set) {
    var lang = VOICE[LANG] ? LANG : 'en';
    var lines = VOICE[lang][set] || [];
    if (!lines.length) return { text: '', url: null };
    var i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && i === lastPick[set]) i = (i + 1) % lines.length;
    lastPick[set] = i;
    return { text: lines[i], url: '/wq/voice/' + lang + '/' + set + '-' + i + '.mp3?v=' + VOICE_V };
  }

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
  // One voice: a clip that is only SLOW is never swapped for the phone's voice (that is a second
  // voice in the same sentence). After CLIP_SLOW_MS the words are shown big while it keeps loading;
  // after CLIP_GIVEUP_MS with no sound the line is let go quietly (logged as stalled). A clip the
  // browser refused to start (autoplay before a tap) is not spoken by the phone either: the speaker
  // button pulses ("tap to hear") and a tap plays the clips. Only a clip that cannot play here at all
  // (an error, a format this phone lacks) falls back to the phone's voice.
  var CLIP_SLOW_MS = 2000, CLIP_GIVEUP_MS = 8000;
  function speak(text, url, done, meta) {
    stopVoice();
    if (!SOUND) { if (done) done(); return; }
    if (!url && meta) noteMissing(meta, text);
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
        if (why === 'stalled') { end(); return; }
        if (why === 'reject') { try { ROOT.classList.add('wq-tap'); } catch (e) {} end(); return; }
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
        setTimeout(function () { if (!started && !switched && !fin && gen === voiceGen) try { ROOT.classList.add('wq-novoice'); } catch (e) {} }, CLIP_SLOW_MS);
        setTimeout(function () { if (!started) fallback('stalled'); }, CLIP_GIVEUP_MS);
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function (e) { fallback('reject'); });
        return;
      } catch (e) { fallback('error'); return; }
    }
    speakTts(text, end);
  }
  // A part with no recorded clip: logged once (audio_missing), and on a phone with no voice for this
  // language (Android's in-app browser has none) the words are shown big instead of silence.
  var missing = {};
  function hasVoice() {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      var vs = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
      if (!vs || !vs.length) return true; // not loaded yet: try the phone voice
      return vs.some(function (v) { return String(v.lang || '').toLowerCase().indexOf(LANG) === 0; });
    } catch (e) { return false; }
  }
  function noteMissing(meta, text) {
    if (!speakable(text)) return;
    var k = meta.qid + ':' + meta.part;
    if (!missing[k]) { missing[k] = 1; ev('audio_missing', { qid: meta.qid, part: meta.part }); }
    if (!hasVoice()) try { ROOT.classList.add('wq-novoice'); } catch (e) {}
  }
  function speakTts(text, end) {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { setTimeout(end, 4000); return; }
      // The phone's own voice is a different voice from the quiz's: the speaker button says so (📱).
      try { ROOT.classList.add('wq-phonevoice'); } catch (e) {}
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
    try { ROOT.classList.remove('wq-novoice'); ROOT.classList.remove('wq-phonevoice'); ROOT.classList.remove('wq-tap'); } catch (e) {}
    ROOT.innerHTML = '<section class="wq-screen" data-m="' + moment + '">' + (LANG === 'ur' ? latinRuns(html) : html) + '</section>';
    ROOT.setAttribute('data-m', moment);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // Urdu: the page widens word gaps for Nastaliq. A run of two or more Latin words inside it (an
  // English video title, a teacher's Latin name, "3.2 MB"), and a single atom that mixes digits and
  // Latin letters (a class label like "3-B", which right-to-left would paint as "B-3"), is marked
  // lang="en": wq.css draws it with the sans face at normal spacing, isolated left-to-right.
  // Text only: tags, attributes, SVG and MathML are left alone.
  var LAT_RUN = /[A-Za-z0-9&("'\u201C\u2018][^\s<>\u0600-\u06FF]*(?:[ \u00A0]+[A-Za-z0-9&("'\u201C\u2018][^\s<>\u0600-\u06FF]*)*/g;
  var LAT_SKIP = /^<(\/?)(svg|math|script|style|textarea)\b/i;
  function latinRuns(html) {
    var skip = 0;
    return String(html).split(/(<[^>]*>)/).map(function (part) {
      if (part.charAt(0) === '<') {
        var m = LAT_SKIP.exec(part);
        if (m && !/\/>$/.test(part)) skip = Math.max(0, skip + (m[1] ? -1 : 1));
        return part;
      }
      if (skip || !/[A-Za-z]/.test(part)) return part;
      return part.replace(LAT_RUN, function (run) {
        // A link is already its own left-to-right line (.wq-url), never part of a sentence.
        var mark = /[A-Za-z]/.test(run) && (/[ \u00A0]/.test(run) || /[0-9]/.test(run)) && run.indexOf('://') < 0;
        return mark ? '<span class="wq-lat" lang="en">' + run + '</span>' : run;
      });
    }).join('');
  }
  // The same for a name typed in Latin letters into the Urdu name box.
  function latinBox(e) {
    var t = e && e.target;
    if (!t || !/(^|\s)wq-input(\s|$)/.test(t.className || '')) return;
    var v = String(t.value || '');
    if (/[A-Za-z]/.test(v) && !/[\u0600-\u06FF]/.test(v)) t.setAttribute('lang', 'en'); else t.removeAttribute('lang');
  }
  if (LANG === 'ur' && ROOT) ROOT.addEventListener('input', latinBox);
  // The brand mark (trusted inline SVG from the server's brand table) on its tile, or bare when it is a wide mark.
  function markHtml() {
    return BR ? '<span class="wq-mark ' + (BR.mark.tile ? 'wq-tile' : 'wq-bare') + '" aria-hidden="true">' + BR.mark.svg + '</span>' : '';
  }
  // The lockup: mark, name over the product line (the server always sends a brand; without one, just the product word).
  // teacher: the teacher's own pages (preview link) wear the brand's teacher line ("FOR TEACHERS") when it has one.
  function lockup(teacher) {
    if (!BR) return '<span class="wq-brand"><span class="wq-lock"><b>' + esc(T.quiz) + '</b></span></span>';
    var sub = teacher && BR.subTeacher ? BR.subTeacher : BR.sub;
    return '<span class="wq-brand" aria-label="' + esc(BR.name) + '">' + markHtml() + '<span class="wq-lock"><b>' + esc(BR.label[LANG]) + '</b><small>' + esc(sub[LANG]) + '</small></span></span>';
  }
  function bar(extra, teacher) {
    return '<div class="wq-bar">' + lockup(teacher) + (extra || '<span class="wq-grow"></span>') +
      '<button class="wq-icon" id="wq-snd" aria-label="' + esc(T.sounds) + '" aria-pressed="' + SOUND + '">' + (SOUND ? '🔔' : '🔕') + '</button></div>';
  }
  function wireBar() {
    on('#wq-snd', function () {
      SOUND = !SOUND; sset('wq_sound', SOUND);
      this.setAttribute('aria-pressed', SOUND); this.textContent = SOUND ? '🔔' : '🔕';
      if (!SOUND) stopAll(); // silent at once; nothing starts again until the next screen with sound on
    });
  }
  /* ---------------- mascot (Jugnu): a still pose that comes alive ----------------
   * Each pose has a few short seamless loops (first frame = last frame), one picked at random so it never
   * feels canned. The still is the poster and the fallback, so the first question never waits on a loop:
   * a loop loads only once the screen is up and in view, plays muted and inline, and gives way to the still
   * on reduced motion, Save-Data or 2G, a refused autoplay, off-screen, or a hidden / closing page.
   * Android plays VP9-with-alpha WebM; WebKit has no WebM alpha, so iPhones get the animated WebP.
   * A child's data is money: a loop plays only where the screen asks for one (the landing hello, the first right
   * answer, the results celebration), never on 3G or slower, never before the page has loaded. A pose plays the
   * same variant all day, so a second quiz fetches no new loop. The animated WebP is ~3x a WebM, so iPhones loop
   * only the celebration. A mascot file that fails falls back to the old still, then hides: never a broken box. */
  var JUG_DIR = '/wq/jugnu/';
  var JUG_V = { idle: 'abc', hello: 'ab', thinking: 'ab', correct: 'abc', notyet: 'ab', celebrate: 'ab', sleep: 'ab' };
  var JUG_OLD = '/wq/jugnu_';
  var JUG_WEBP_LOOPS = { celebrate: 1 };
  var jugRightDone = false; // only the FIRST right answer of the visit gets the loop
  var jugOn = true;
  var jugIO = null;
  var JUG_WEBM = (function () {
    try {
      var ua = navigator.userAgent || '';
      if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua))) return false;
      var v = document.createElement('video');
      return !!(v.canPlayType && v.canPlayType('video/webm; codecs="vp9"'));
    } catch (e) { return false; }
  })();
  function jugImg(pose, loop) {
    return '<span class="wq-jimg" data-jpose="' + pose + '"' + (loop ? ' data-jloop="1"' : '') + '><img src="' + JUG_DIR + pose + '.webp" alt="" width="92" height="92"></span>';
  }
  function jug(pose, line, big, loop) {
    return '<div class="wq-jug' + (big ? ' wq-big' : '') + '">' + jugImg(pose, loop) + '<div class="wq-say">' + esc(line) + '</div></div>';
  }
  function jugMotion() {
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {}
    var c = navigator.connection || {};
    return !(c.saveData || /(2g|3g)$/.test(c.effectiveType || ''));
  }
  // one variant per pose per day (the phone caches it), and every variant comes round over the days
  function jugPick(pose) {
    var v = JUG_V[pose] || 'a';
    var day = Math.floor(Date.now() / 86400000);
    return pose + '_' + v.charAt(day % v.length);
  }
  function jugLive(el) { if (!/ wq-live/.test(el.className)) el.className += ' wq-live'; }
  // put the still back: drop the loop element so nothing decodes in the background
  function jugQuiet(el) {
    el.className = el.className.replace(/ wq-live/g, '');
    el.removeAttribute('data-jon');
    var kids = [];
    for (var i = 0; i < el.children.length; i++) if (/wq-anim/.test(el.children[i].className)) kids.push(el.children[i]);
    kids.forEach(function (a) {
      try { if (a.pause) a.pause(); } catch (e) {}
      try { a.removeAttribute('src'); } catch (e) {}
      el.removeChild(a);
    });
  }
  function jugStart(el) {
    if (!jugOn || el.getAttribute('data-jon') || !el.getAttribute('data-jloop')) return;
    var pose = el.getAttribute('data-jpose');
    if (!JUG_WEBM && !JUG_WEBP_LOOPS[pose]) return;
    el.setAttribute('data-jon', '1');
    var name = jugPick(pose);
    var webp = function () {
      if (!jugOn || el.getAttribute('data-jon') !== '1' || !JUG_WEBP_LOOPS[pose]) return;
      var im = document.createElement('img');
      im.alt = ''; im.className = 'wq-anim';
      im.onload = function () { jugLive(el); };
      im.src = JUG_DIR + name + '.webp';
      el.appendChild(im);
    };
    if (!JUG_WEBM) { webp(); return; }
    var v = document.createElement('video');
    v.muted = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.className = 'wq-anim';
    var gone = function () { return v.parentNode !== el; };
    v.addEventListener('playing', function () { if (!gone()) jugLive(el); });
    // logged so the page's events say how often a browser (e.g. an in-app one) refuses the WebM loop
    var fellBack = function (why) { try { ev('jug_fallback', { reason: String(why || 'error').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'error' }); } catch (e) {} };
    v.addEventListener('error', function () { if (gone()) return; el.removeChild(v); fellBack('media_error'); webp(); });
    v.src = JUG_DIR + name + '.webm';
    el.appendChild(v);
    var p = null;
    try { p = v.play(); } catch (e) {}
    // autoplay refused (some in-app browsers): the animated WebP needs no permission. A play() aborted
    // because the page was hidden is not a refusal.
    if (p && p.catch) p.catch(function (e) { if (gone() || !jugOn || (e && e.name === 'AbortError')) return; el.removeChild(v); fellBack(e && e.name); webp(); });
  }
  function jugWake() {
    if (!ROOT || !jugOn || !jugMotion()) return;
    var els = ROOT.querySelectorAll('.wq-jimg');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (jugIO) {
        if (!el.getAttribute('data-jio')) { el.setAttribute('data-jio', '1'); jugIO.observe(el); }
        else if (el.getAttribute('data-jin')) jugStart(el);
      } else jugStart(el);
    }
  }
  function jugStop() {
    jugOn = false;
    if (!ROOT) return;
    var els = ROOT.querySelectorAll('.wq-jimg');
    for (var i = 0; i < els.length; i++) jugQuiet(els[i]);
  }
  function jugResume() {
    if (jugOn) return;
    jugOn = true;
    jugWake();
  }
  try {
    if (window.IntersectionObserver) {
      jugIO = new window.IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.setAttribute('data-jin', '1'); if (jugMotion()) jugStart(e.target); }
          else { e.target.removeAttribute('data-jin'); jugQuiet(e.target); }
        });
      });
    }
  } catch (e) { jugIO = null; }
  window.addEventListener('pagehide', jugStop);
  window.addEventListener('pageshow', jugResume);
  document.addEventListener('freeze', jugStop);
  document.addEventListener('resume', jugResume);
  document.addEventListener('wq-silence', jugStop);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') jugStop(); else jugResume(); });
  // a new screen is drawn into ROOT: wake its mascot a second later, and never before the page has loaded,
  // so a loop never competes with the page, the first question or its audio for a slow connection
  var jugT = null;
  var jugLoaded = document.readyState === 'complete';
  function jugSoon() {
    if (!jugLoaded || jugT) return;
    jugT = setTimeout(function () { jugT = null; jugWake(); }, 1000);
  }
  window.addEventListener('load', function () { jugLoaded = true; jugSoon(); });
  try {
    if (window.MutationObserver && ROOT) new window.MutationObserver(jugSoon).observe(ROOT, { childList: true, subtree: true });
    jugSoon();
  } catch (e) {}
  // a mascot picture that fails (patchy data, 404/500): the old still, then nothing; never a broken-image box.
  // error does not bubble, so this listens in the capture phase.
  function jugBroken(e) {
    var im = e && e.target;
    if (!im || im.tagName !== 'IMG') return;
    var src = im.getAttribute('src') || '';
    var slot = im.parentNode && /(^| )wq-jimg( |$)/.test(im.parentNode.className) ? im.parentNode : null;
    if (/(^| )wq-anim( |$)/.test(im.className)) { try { im.parentNode.removeChild(im); } catch (x) {} return; }
    var m = /\/wq\/jugnu\/([a-z]+)\.webp/.exec(src);
    if (m && !im.getAttribute('data-jold')) { im.setAttribute('data-jold', '1'); im.src = JUG_OLD + m[1] + '.webp'; return; }
    if (!m && src.indexOf(JUG_OLD) < 0 && !im.getAttribute('data-jold')) return;
    if (slot) { if (!/ wq-jgone/.test(slot.className)) slot.className += ' wq-jgone'; } else im.style.display = 'none';
  }
  try { if (ROOT) ROOT.addEventListener('error', jugBroken, true); } catch (e) {}
  window.wqJug = { stop: jugStop, resume: jugResume };
  /* ---------------- end mascot ---------------- */
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
    // The challenger comes from the server (the challenge code), never from a name in the URL.
    var chLine = ch ? T.challenged(ch.first, ch.correct, ch.total) : '';
    if (B.preview && params.p) return teacherLanding();
    if (ID && !B.preview) return ID.landing(chLine);
    var h = bar() +
      (B.preview ? '<div class="wq-banner">' + esc(T.selfT) + '</div>' : '') +
      jug('hello', last ? T.helloN(last.first) : T.hello, true, true) +
      '<div class="wq-card wq-stack"><h1>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(CLS.teacher, CLS.label)) + '</p>' +
      '<p class="wq-small">' + esc(T.meta(N)) + '</p></div>' +
      (chLine ? '<div class="wq-banner">' + esc(chLine) + '</div>' : '') +
      (B.preview && params.p ? '<button class="wq-btn wq-go" id="wq-preview">' + esc(T.previewPlay) + '</button><button class="wq-btn wq-navy" id="wq-whoplayed">' + esc(TW.whoBtn) + '</button>' :
      last ? '<button class="wq-btn wq-go" id="wq-play-as">' + esc(T.playAs(last.first)) + '</button><button class="wq-btn wq-ghost" id="wq-notme">' + esc(T.notMe(last.first)) + '</button>'
        : '<button class="wq-btn wq-go" id="wq-play">' + esc(T.play) + '</button>') +
      (LIVE.ict_today_floor ? '<p class="wq-proof">🌟 ' + esc(T.proof(LIVE.ict_today_floor)) + '</p>' : '') +
      (LIVE.class_today ? '<p class="wq-small">' + esc(T.classToday(LIVE.class_today)) + '</p>' : '');
    render(h, 'M3');
    wireBar();
    on('#wq-play', who);
    on('#wq-notme', who);
    on('#wq-preview', function () { ev('identity_pick', { src: 'preview' }); startSession({}, null, ''); });
    on('#wq-whoplayed', whoPlayed);
    on('#wq-play-as', function () { ev('identity_pick', { src: 'remembered' }); startSession({ chip: last.chip, via: 'remembered' }, last); });
  }

  /* The teacher's own preview link: a page for the teacher (no mascot greeting them like a child),
     "Who played?" first, and a test run as a child second. */
  function teacherLanding() {
    var h = bar('', true) +
      '<div class="wq-card wq-stack wq-teach"><p class="wq-small">' + esc(TW.tFor) + '</p><h1>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(CLS.teacher, CLS.label)) + '</p>' +
      '<p class="wq-small">' + esc(T.meta(N)) + '</p></div>' +
      '<p class="wq-sub">' + esc(TW.tLead) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-whoplayed">' + esc(TW.whoBtn) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-preview">' + esc(T.previewPlay) + '</button>' +
      '<p class="wq-small">' + esc(T.selfT) + '</p>';
    render(h, 'M3-teacher');
    wireBar();
    on('#wq-preview', function () { ev('identity_pick', { src: 'preview' }); startSession({}, null, ''); });
    on('#wq-whoplayed', whoPlayed);
  }

  /* ---------------- M4 who's playing ---------------- */
  // A teacher with a class list (CLS.roster): the child gives a roll number on a big pad and confirms
  // "Are you <name>?"; no classmates' names are shown. Without one, today's name chips.
  var TW = ({
    en: {
      rollT: 'What is your roll number?', rollSay: 'Tap your roll number, then Go.', go: 'Go', del: 'Delete',
      noRoll: "I don't know my number", onPhoneOr: 'Or tap your name',
      unknown: function (n) { return 'No one in this class has number ' + n + '. Try again!'; },
      isYouSub: 'Is this you?', tryAgain: 'No, try again', none: 'None of these is me', no: 'No', notMe: "No, I'm someone else",
      classT: 'Which class are you in?', classSay: 'Tap your class.', notHere: 'My class is not here',
      whoBtn: 'Who played?', whoT: 'Who played', whoSub: 'Children not on your class list come first. Tap one to give their roll number.',
      whoNone: 'No child has finished yet.', offList: 'Not on your class list', roll: function (n) { return 'Roll ' + n; },
      setRoll: 'Set roll no.', noList: 'This quiz is not linked to a class list, so names stay as the children typed them.',
      fixT: function (n) { return 'Roll number for ' + n + '?'; }, fixSay: 'Type the roll number from your class list.',
      isKid: function (n) { return 'Is this ' + n + '?'; }, yes: 'Yes', fixed: 'Fixed.',
      practice: function (c, t) { return 'Practice round · your first score ' + c + '/' + t + ' is the one that counts'; },
      newBest: 'New best!', wasBest: 'was',
      tFor: 'For you, the teacher', tLead: 'Your class plays this from the link you forwarded. See who has played, or try it yourself.',
      sumOf: function (p, of) { return p + ' of ' + of + ' played'; }, sumN: function (p) { return p + ' played'; },
      avg: 'Average', hard: function (n, m) { return 'Q' + n + ' was the hardest (' + m + ' missed it)'; },
      notYet: function (n) { return 'Not played yet (' + n + ')'; }, allPlayed: 'Everyone on your class list has played.',
      playedT: function (n) { return 'Played (' + n + ')'; }, setRollLink: 'Set roll',
      // identity v2 (wq-identity.js): name first, a collision asked, never shown
      someone: 'Someone else', nameT: 'What is your name?', nameSay: 'Type the name you are called by in class.',
      nameFull: 'Type your full name.', namePriv: 'Only your name. No phone number.',
      moreFull: function (f, c) { return 'There is more than one ' + f + (c ? ' in ' + c : ' here') + '. What is your full name?'; },
      fatherT: "What is your father's name?", numT: 'What number does your teacher call you by?', numSay: 'The number on the class list.',
      dontKnow: "I don't know",
      nfT: function (t, c) { return "I can't find " + t + (c ? ' in ' + c : '') + '. Is that how your name is written?'; },
      nfYes: "Yes, that's my name", nfFix: 'Let me fix it',
      nsT: function (t, c, n) { return 'There are ' + n + ' children called ' + t + (c ? ' in ' + c : '') + '.'; },
      nsSay: 'Tap Yes to play. Your teacher will check which one you are.'
    },
    ur: {
      rollT: 'آپ کا رول نمبر کیا ہے؟', rollSay: 'اپنا رول نمبر دبائیں، پھر آگے دبائیں۔', go: 'آگے', del: 'مٹائیں',
      noRoll: 'مجھے اپنا نمبر نہیں پتا', onPhoneOr: 'یا اپنے نام پر ٹیپ کریں',
      unknown: function (n) { return 'اس کلاس میں نمبر ' + n + ' کسی کا نہیں۔ دوبارہ کوشش کریں!'; },
      isYouSub: 'کیا یہ آپ ہیں؟', tryAgain: 'نہیں، دوبارہ', none: 'ان میں سے کوئی نہیں', no: 'نہیں', notMe: 'نہیں، میں کوئی اور ہوں',
      classT: 'آپ کس کلاس میں ہیں؟', classSay: 'اپنی کلاس پر ٹیپ کریں۔', notHere: 'میری کلاس یہاں نہیں',
      whoBtn: 'کس نے کھیلا؟', whoT: 'کس نے کھیلا', whoSub: 'جو بچے آپ کی کلاس لسٹ میں نہیں، وہ اوپر ہیں۔ رول نمبر دینے کے لیے نام پر ٹیپ کریں۔',
      whoNone: 'ابھی کسی بچے نے کوئز مکمل نہیں کیا۔', offList: 'کلاس لسٹ میں نہیں', roll: function (n) { return 'رول نمبر ' + n; },
      setRoll: 'رول نمبر دیں', noList: 'یہ کوئز کسی کلاس لسٹ سے جڑا نہیں، اس لیے نام ویسے ہی ہیں جیسے بچوں نے لکھے۔',
      fixT: function (n) { return n + ' کا رول نمبر؟'; }, fixSay: 'کلاس لسٹ سے رول نمبر لکھیں۔',
      isKid: function (n) { return 'کیا یہ ' + n + ' ہے؟'; }, yes: 'جی ہاں', fixed: 'درست ہو گیا۔',
      practice: function (c, t) { return 'مشق کا راؤنڈ · پہلی بار کا اسکور ' + c + '/' + t + ' شمار ہوتا ہے'; },
      newBest: 'نیا ریکارڈ!', wasBest: 'پہلے',
      tFor: 'استاد کے لیے', tLead: 'آپ کی کلاس یہ کوئز آپ کے بھیجے ہوئے لنک سے کھیلتی ہے۔ دیکھیں کس نے کھیلا، یا خود آزمائیں۔',
      sumOf: function (p, of) { return of + ' میں سے ' + p + ' نے کھیلا'; }, sumN: function (p) { return p + ' نے کھیلا'; },
      avg: 'اوسط', hard: function (n, m) { return 'سوال ' + n + ' سب سے مشکل رہا (' + m + ' نے غلط کیا)'; },
      notYet: function (n) { return 'ابھی نہیں کھیلا (' + n + ')'; }, allPlayed: 'آپ کی کلاس لسٹ کے سب بچوں نے کھیل لیا۔',
      playedT: function (n) { return 'کھیل لیا (' + n + ')'; }, setRollLink: 'رول نمبر دیں',
      someone: 'کوئی اور', nameT: 'آپ کا نام کیا ہے؟', nameSay: 'وہ نام لکھیں جس سے آپ کو کلاس میں پکارا جاتا ہے۔',
      nameFull: 'اپنا پورا نام لکھیں۔', namePriv: 'صرف نام۔ فون نمبر نہیں۔',
      moreFull: function (f, c) { return (c ? c + ' میں' : 'یہاں') + ' ایک سے زیادہ ' + f + ' ہیں۔ آپ کا پورا نام کیا ہے؟'; },
      fatherT: 'آپ کے والد کا نام کیا ہے؟', numT: 'کلاس لسٹ میں آپ کا نمبر کیا ہے؟', numSay: 'جو نمبر کلاس میں پکارا جاتا ہے۔',
      dontKnow: 'مجھے نہیں پتا',
      nfT: function (t, c) { return (c ? c + ' میں ' : '') + t + ' کا نام نہیں ملا۔ کیا آپ کا نام ایسے ہی لکھا جاتا ہے؟'; },
      nfYes: 'جی ہاں، یہی میرا نام ہے', nfFix: 'دوبارہ لکھیں',
      nsT: function (t, c, n) { return (c ? c + ' میں ' : '') + t + ' نام کے ' + n + ' بچے ہیں۔'; },
      nsSay: 'کھیلنے کے لیے جی ہاں دبائیں۔ استاد خود دیکھ لیں گے کہ آپ کون ہیں۔'
    }
  })[LANG === 'ur' ? 'ur' : 'en'];
  // One digit rule for the whole page, Urdu included: 0-9. The roll number is matched to the
  // teacher's register, which prints it 0-9 like every other surface (scores, counters, maths).
  function digitsFor(n) { return String(n); }
  function padNext(cur, key) {
    if (key === 'del') return cur.slice(0, -1);
    if (!/^[0-9]$/.test(key) || cur.length >= 3 || (cur === '' && key === '0')) return cur;
    return cur + key;
  }
  function kidBtn(k, src) { return '<button class="wq-kid" data-chip="' + esc(k.chip) + '" data-src="' + src + '">' + ani(k.animal) + esc(k.first) + '</button>'; }
  function wireKids(list) {
    Array.prototype.forEach.call(ROOT.querySelectorAll('.wq-kid'), function (b) {
      b.addEventListener('click', function () {
        var chip = b.getAttribute('data-chip');
        var k = list.filter(function (x) { return x.chip === chip; })[0];
        ev('identity_pick', { src: b.getAttribute('data-src') });
        startSession({ chip: chip, via: b.getAttribute('data-src') === 'phone' ? 'remembered' : 'chips' }, k);
      });
    });
  }

  // The one class this quiz plays against, when the server could not tell (two lists, no grade match):
  // the child taps their class first; 'none' = "my class is not here" (a new child, no list).
  var CLS_PICK = null;
  // Identity v2 (name first; dashboard/public/wq/wq-identity.js) when the server turns it on for this quiz.
  var ID = CLS.identity && CLS.identity.mode === 'v2' && typeof WQID === 'function' ? WQID({
    T: T, TW: TW, CLS: CLS, Q: Q, N: N, LIVE: LIVE, params: params, esc: esc, ani: ani, bar: bar, jug: jug, render: render, wireBar: wireBar,
    on: on, $: $, kids: kids, ev: ev, startSession: startSession, rollPad: rollPad, landing: landing,
    pick: function () { return CLS_PICK; }, setPick: function (v) { CLS_PICK = v; }, doc: typeof document !== 'undefined' ? document : null
  }) : null;
  function who() {
    if (ID) return ID.who();
    if (CLS.roster && CLS.roster.classes && CLS.roster.classes.length && !CLS_PICK) return whichClass(CLS.roster.classes);
    if (CLS_PICK === 'none') return newKid();
    if (CLS.roster) return rollPad('', '');
    var here = kids();
    var chips = (CLS.chips || []).filter(function (c) { return !here.some(function (k) { return k.chip === c.chip; }); });
    var h = bar() + jug('idle', T.whoSay) + '<h2>' + esc(T.whoT) + '</h2>' +
      (here.length ? '<p class="wq-sub">' + esc(T.onPhone) + '</p><div class="wq-chips">' + here.map(function (k) { return kidBtn(k, 'phone'); }).join('') + '</div>' : '') +
      (chips.length ? '<p class="wq-sub">' + esc(T.inClass(CLASS_LABEL)) + '</p><div class="wq-chips">' + chips.map(function (k) { return kidBtn(k, 'class'); }).join('') + '</div>' : '') +
      '<button class="wq-btn wq-navy" id="wq-new">' + esc(T.newKid) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M4');
    wireBar();
    wireKids(here.concat(CLS.chips || []));
    on('#wq-new', newKid);
    on('#wq-back', landing);
  }

  function whichClass(classes) {
    var h = bar() + jug('idle', TW.classSay) + '<h2>' + esc(TW.classT) + '</h2>' +
      '<div class="wq-chips">' + classes.map(function (c) {
        return '<button class="wq-kid wq-cls" data-cls="' + esc(c.key) + '"><bdi dir="ltr">' + esc(c.label) + '</bdi></button>';
      }).join('') + '</div>' +
      '<button class="wq-btn wq-soft" id="wq-notmine">' + esc(TW.notHere) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M4-class');
    wireBar();
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-cls]'), function (b) {
      b.addEventListener('click', function () {
        CLS_PICK = b.getAttribute('data-cls');
        ev('identity_pick', { src: 'class' });
        rollPad('', '');
      });
    });
    on('#wq-notmine', function () { CLS_PICK = 'none'; ev('identity_pick', { src: 'class_none' }); newKid(); });
    on('#wq-back', landing);
  }

  /* The roll-number pad: numbers only, so a child who cannot read yet can still say who they are. */
  function rollPad(cur, note, opts) {
    opts = opts || {};
    var here = opts.teacher || opts.noKids ? [] : kids();
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'];
    var h = bar('', opts.teacher) + (opts.teacher ? '<p class="wq-sub">' + esc(opts.say) + '</p>' : jug('idle', note || opts.say || TW.rollSay)) + (opts.teacher && note ? '<p class="wq-small">' + esc(note) + '</p>' : '') + '<h2>' + esc(opts.title || TW.rollT) + '</h2>' +
      '<div class="wq-roll" aria-live="polite">' + (cur ? esc(digitsFor(cur)) : '<span class="wq-roll-ph">–</span>') + '</div>' +
      '<div class="wq-pad">' + keys.map(function (k) {
        if (k === 'del') return '<button class="wq-key wq-key-del" data-k="del" aria-label="' + esc(TW.del) + '">⌫</button>';
        if (k === 'go') return '<button class="wq-key wq-key-go" data-k="go"' + (cur ? '' : ' disabled') + '>' + esc(TW.go) + '</button>';
        return '<button class="wq-key" data-k="' + k + '">' + esc(digitsFor(k)) + '</button>';
      }).join('') + '</div>' +
      (here.length ? '<p class="wq-sub">' + esc(TW.onPhoneOr) + '</p><div class="wq-chips">' + here.map(function (k) { return kidBtn(k, 'phone'); }).join('') + '</div>' : '') +
      (opts.teacher ? '' : '<button class="wq-btn wq-soft" id="wq-noroll">' + esc(opts.dontKnow || TW.noRoll) + '</button>') +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, opts.screen || 'M4-roll');
    wireBar();
    wireKids(here);
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-k]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-k');
        if (k === 'go') {
          if (!cur) return;
          if (opts.onGo) return opts.onGo(cur);
          ev('identity_pick', { src: 'roll_try' });
          return startSession({ roll: cur }, null, '', cur);
        }
        rollPad(padNext(cur, k), '', opts);
      });
    });
    on('#wq-noroll', opts.onDontKnow || function () { ev('identity_pick', { src: 'no_roll' }); newKid(); });
    on('#wq-back', opts.back || (CLS_PICK ? function () { CLS_PICK = null; who(); } : landing));
  }

  /* The teacher's "Who played?" (their own preview link): first names and roll numbers only; a child who
     typed a name that is not on the class list can be moved to the right child by roll number. */
  function whoPlayed() {
    api('POST', 'who', { code: CODE, p: params.p }).then(function (r) {
      if (!r.ok) { toast(T.oops); return; }
      var b = r.body || {};
      var rows = b.rows || [];
      var sm = b.summary || null;
      var np = b.not_played || null;
      var score = function (c, t) { return '<bdi dir="ltr">' + esc(digitsFor(c)) + '/' + esc(digitsFor(t)) + '</bdi>'; };
      var top = sm ? '<div class="wq-card wq-stack wq-who-sum">' +
          '<h2>' + esc(sm.of ? TW.sumOf(digitsFor(sm.played), digitsFor(sm.of)) : TW.sumN(digitsFor(sm.played))) + '</h2>' +
          (sm.played && sm.avg != null ? '<p class="wq-sub">' + esc(TW.avg) + ' ' + score(sm.avg, sm.total) + '</p>' : '') +
          (sm.hardest ? '<p class="wq-sub">' + esc(TW.hard(digitsFor(sm.hardest.n), digitsFor(sm.hardest.missed))) + '</p>' : '') +
        '</div>' : '';
      var rowHtml = function (x) {
        var tag = x.on_list ? '<span class="wq-tag">' + esc(TW.roll(digitsFor(x.roll))) + '</span>' : '<span class="wq-tag wq-tag-off">' + esc(TW.offList) + '</span>';
        return '<div class="wq-who-row"><b>' + esc(x.first) + '</b> ' + tag + '<span class="wq-grow"></span><span class="wq-who-score">' + score(x.correct, x.total) + '</span>' +
          (b.roster && !x.on_list ? '<button class="wq-linkbtn wq-who-fix" data-ref="' + esc(x.ref) + '">' + esc(TW.setRollLink) + '</button>' : '') + '</div>';
      };
      var h = bar('', true) + '<h2>' + esc(TW.whoT) + '</h2>' + top +
        (np ? (np.length ? '<h3 class="wq-who-h">' + esc(TW.notYet(digitsFor(np.length))) + '</h3><div class="wq-card wq-stack wq-who wq-who-not">' + np.map(function (k) {
          return '<div class="wq-who-row wq-who-np"><b>' + esc(k.first) + '</b> <span class="wq-tag">' + esc(TW.roll(digitsFor(k.roll))) + '</span></div>';
        }).join('') + '</div>' : '<p class="wq-small">' + esc(TW.allPlayed) + '</p>') : '') +
        (rows.length ? '<h3 class="wq-who-h">' + esc(TW.playedT(digitsFor(rows.length))) + '</h3>' +
          (b.roster ? '<p class="wq-small">' + esc(TW.whoSub) + '</p>' : '<p class="wq-small">' + esc(TW.noList) + '</p>') +
          '<div class="wq-card wq-stack wq-who">' + rows.map(rowHtml).join('') + '</div>' : '<p class="wq-small">' + esc(TW.whoNone) + '</p>') +
        '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
      render(h, 'M4-who-played');
      wireBar();
      Array.prototype.forEach.call(ROOT.querySelectorAll('[data-ref]'), function (btn) {
        btn.addEventListener('click', function () {
          var ref = btn.getAttribute('data-ref');
          fixRow(rows.filter(function (x) { return x.ref === ref; })[0]);
        });
      });
      on('#wq-back', landing);
    }, function () { toast(T.offline); });
  }

  function fixRow(row) {
    var padOpts = { teacher: true, screen: 'M4-who-fix', title: TW.fixT(row.first), say: TW.fixSay, back: whoPlayed, onGo: goFix };
    rollPad('', '', padOpts);
    function goFix(roll) {
      api('POST', 'who/fix', { code: CODE, p: params.p, ref: row.ref, roll: roll }).then(function (r) {
        if (r.status === 404 && r.body && r.body.error === 'roll_unknown') return rollPad('', TW.unknown(digitsFor(roll)), padOpts);
        if (r.status !== 409 || !r.body || r.body.error !== 'is_this_you') { toast(T.oops); return; }
        confirmFix(r.body.candidates || [], 0);
      }, function () { toast(T.offline); });
    }
    // One candidate at a time, as the child's own "is this you?".
    function confirmFix(cands, i) {
      var c = cands[i];
      if (!c) return fixRow(row);
      var h = bar('', true) + '<div class="wq-card wq-stack"><h2>' + esc(TW.isKid(c.first)) + ' ' + ani(c.animal) + '</h2>' +
          (c.cls ? '<p class="wq-sub"><bdi dir="ltr">' + esc(c.cls) + '</bdi></p>' : '') +
          '<button class="wq-btn wq-go" data-chip="' + esc(c.chip) + '">' + esc(TW.yes) + '</button></div>' +
        '<button class="wq-btn wq-soft" id="wq-diff">' + esc(i < cands.length - 1 ? TW.no : TW.tryAgain) + '</button>';
      render(h, 'M4-who-confirm');
      wireBar();
      Array.prototype.forEach.call(ROOT.querySelectorAll('[data-chip]'), function (b) {
        b.addEventListener('click', function () {
          api('POST', 'who/fix', { code: CODE, p: params.p, ref: row.ref, chip: b.getAttribute('data-chip') }).then(function (r2) {
            if (!r2.ok) { toast(T.oops); return; }
            ev('identity_fixed', {});
            toast(TW.fixed);
            whoPlayed();
          }, function () { toast(T.offline); });
        });
      });
      on('#wq-diff', function () { confirmFix(cands, i + 1); });
    }
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

  /* "Are you Ayesha?" — after a roll number (roll set) or a typed name that is near a known child.
     ONE candidate at a time, so there is never a second green Yes for a child to tap by mistake. */
  function isThisYou(cands, typed, roll, i) {
    i = i || 0;
    var c = cands[i];
    if (!c) return;
    var last = i >= cands.length - 1;
    var h = bar() + jug('thinking', roll ? TW.isYouSub : T.isYouSub) +
      '<div class="wq-card wq-stack"><h2>' + esc(T.isYou(c.first)) + ' ' + ani(c.animal) + '</h2>' +
      (c.cls ? '<p class="wq-sub"><bdi dir="ltr">' + esc(c.cls) + '</bdi></p>' : '') +
      (c.roll != null ? '<p class="wq-sub">' + esc(TW.roll(digitsFor(c.roll))) + '</p>' : '') +
      '<button class="wq-btn wq-go" data-chip="' + esc(c.chip) + '">' + esc(T.yesMe) + '</button></div>' +
      '<button class="wq-btn wq-soft" id="wq-diff">' + esc(roll && last ? TW.tryAgain : TW.notMe) + '</button>';
    render(h, 'M4-isyou');
    wireBar();
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-chip]'), function (b) {
      b.addEventListener('click', function () {
        ev('identity_pick', { src: roll ? 'roll' : 'is_this_you' });
        startSession({ chip: c.chip, via: roll ? 'roll' : 'name' }, c);
      });
    });
    on('#wq-diff', function () {
      if (!last) return isThisYou(cands, typed, roll, i + 1);
      if (roll) { ev('identity_pick', { src: 'roll_not_me' }); return rollPad('', ''); }
      startSession({ new: { name: typed, cls: String(Q.grade || ''), force: true } }, null, typed);
    });
  }

  /* ---------------- E3 session ---------------- */
  var busy = false;
  function startSession(pick, kid, typed, roll) {
    if (busy) return;
    busy = true;
    var body = { code: CODE };
    for (var k in pick) body[k] = pick[k];
    var dref = sget('wq_d', null);
    if (dref) body.device_ref = dref;
    if (params.p) body.p = params.p;
    if (S.st) body.resume_st = S.st;
    if (CLS_PICK && (pick.roll != null || pick.new)) body.list = CLS_PICK;
    api('POST', 'session', body).then(function (r) {
      busy = false;
      if (ID && ID.reply(r.status, r.body || {}, pick)) return;
      if (r.status === 409 && r.body.error === 'which_class') { CLS_PICK = null; ev('identity_pick', { src: 'which_class' }); return whichClass(r.body.classes || []); }
      if (r.status === 409 && r.body.error === 'maybe_you') return isThisYou(r.body.candidates || [], typed || '');
      if (r.status === 409 && r.body.error === 'is_this_you') return isThisYou(r.body.candidates || [], '', roll);
      if (r.status === 404 && r.body.error === 'roll_unknown') { ev('identity_pick', { src: 'roll_unknown' }); return rollPad('', TW.unknown(digitsFor(roll))); }
      // A child remembered on this phone whom this quiz's class list does not know (they played another class's quiz
      // here, or the teacher removed them): forget them on this phone and ask who is playing. Never a dead end.
      if (r.status === 404 && pick.chip && (r.body.error === 'chip_unknown' || r.body.error === 'not_found')) {
        sset('wq_kids', kids().filter(function (k) { return k.chip !== pick.chip; }));
        if (S.child && S.child.chip === pick.chip) { S.child = null; save(); }
        ev('identity_pick', { src: 'remembered_gone' });
        return who();
      }
      if (!r.ok) { ev('error', { err: 'session_' + r.status }); toast(r.status === 410 ? T.oops : T.oops); if (pick.from_st) landing(); return; }
      var b = r.body;
      if (b.device_ref) sset('wq_d', b.device_ref);
      var child = b.child || kid || { first: typed || '' };
      var sameChild = S.child && child.chip && S.child.chip === child.chip;
      if (!sameChild) { S.answers = {}; S.queue = []; S.seq = 0; S.wrong = []; S.result = null; S.vt = 0; S.vdone = 0; }
      S.st = b.st; S.child = child; S.counted = b.counted !== false; S.reason = b.reason || null;
      ((b.resume && b.resume.answered) || []).forEach(function (q) { if (!S.answers[q]) S.answers[q] = { slot: '?', ok: null }; });
      save();
      rememberKid(child);
      if (ID) ID.started(child);
      ev('quiz_start', { reason: b.reason || undefined, ok: b.counted === false ? 0 : 1 });
      if (wantsVideo()) video(); else nextQuestion();
    }, function () { busy = false; toast(T.offline); ev('error', { err: 'session_net' }); if (pick.from_st) landing(); });
  }

  function answeredCount() { var n = 0; QS.forEach(function (q) { if (S.answers[q.qid]) n++; }); return n; }
  // The lesson video plays once per attempt: skipped or watched to the end, a reload goes on to the questions.
  function wantsVideo() { return Boolean(B.video && B.video.url && !answeredCount() && !S.vdone); }

  /* ---------------- M5 video (optional) ---------------- */
  // Where the lesson video is, kept every few seconds and whenever it pauses or the page hides.
  function keepVideoAt(vid, now) {
    var t = Math.floor((vid && vid.currentTime) || 0);
    if (!t || S.vdone || t === S.vt) return;
    if (now || !(S.vt > 0) || Math.abs(t - S.vt) >= 3) { S.vt = t; save(); }
  }
  window.addEventListener('pagehide', function () { if (ROOT.getAttribute('data-m') === 'M5') keepVideoAt($('video'), true); });
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
  /* Lookahead: the next two questions' pictures now, their recorded clips a moment later (this
     question's own voice gets the line first), so a dropped connection mid-quiz keeps the pictures
     and the voice. On 4G without data saver the rest of the quiz is warmed in idle time after Q1.
     no-cors requests fill the HTTP cache that <audio> and <img> then read; no URL is ever stored. */
  var warmed = {};
  function clipUrls(q) {
    var au = q.audio || {}, out = [];
    [au.q, au.stim, au.why, au.hint].concat(au.opts || [], au.fbs || []).forEach(function (u) { if (u && typeof u === 'string') out.push(u); });
    return out;
  }
  function warmPics(q) { if (q) WQI.imageUrls(q).forEach(function (u) { try { new Image().src = u; } catch (e) {} }); }
  function warmClips(q) {
    if (!q || warmed[q.qid] || !SOUND) return;
    warmed[q.qid] = 1;
    clipUrls(q).forEach(function (u) { try { fetch(u, { mode: 'no-cors', credentials: 'omit' }).catch(function () {}); } catch (e) {} });
  }
  function ahead(i) {
    warmPics(QS[i + 1]); warmPics(QS[i + 2]);
    setTimeout(function () {
      warmClips(QS[i + 1]); warmClips(QS[i + 2]);
      var c = navigator.connection || {};
      if (i === 0 && c.effectiveType === '4g' && !c.saveData) QS.forEach(function (q) { warmPics(q); warmClips(q); });
    }, 1500);
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
  function speakSeq(parts, done, qid) {
    var i = 0;
    (function nextPart() {
      if (i >= parts.length) { if (done) done(); return; }
      var k = i, part = parts[i++];
      speak(part.text, part.url, nextPart, qid ? { qid: qid, part: part.p || k } : null);
    })();
  }

  // What the voice says after an answer, in order: a recorded library line (right / fixed / not
  // yet), for not yet the right answer by name (its own option clip when it is one option), then
  // the why. The question's "why" clip is its reason (the explanation), so it is played only where
  // the reason is what is said; a picked option's feedback has its own clip (fbs) or the phone's voice.
  function feedbackParts(q, ok, lead, why, picked, named) {
    var au = q.audio || {};
    var rs = String(q.correct_slot || '');
    var si = 'ABCD'.indexOf(rs.charAt(0));
    var one = rs.length === 1 && si >= 0 && WQI.kind(q) !== 'order' && WQI.kind(q) !== 'match';
    var parts = [lead];
    if (!ok && named) parts.push({ text: WQI.rightText(q, LANG), url: (one && au.opts && au.opts[si]) || null });
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

  // How long a child sits with a question, after the voice, before Jugnu offers help.
  var HELP_AFTER_MS = 20000;
  function hintOf(q) { var h = q && q.hint; return h && typeof h.text === 'string' && h.text.trim() ? h.text.trim() : ''; }
  function hintBtn(q) {
    if (!hintOf(q)) return '';
    return '<button class="wq-jhelp" id="wq-jhelp" aria-label="' + esc(T.hintAsk) + '"><img src="' + IMG + 'thinking.webp" alt="">' +
      '<span id="wq-jhelp-t">' + esc(T.hintAsk) + '</span></button>';
  }
  function question(i, retry) {
    var q = QS[i];
    var shown = Date.now();
    var h = bar(retry ? '<span class="wq-grow wq-qof">' + esc(T.second) + '</span>' : dots(i)) +
      (retry ? '' : '<p class="wq-qof">' + esc(T.qof(i + 1, N)) + '</p>') +
      '<div class="wq-item" data-kind="' + WQI.kind(q) + '">' + WQI.itemHtml(q, T, LANG) + '</div>' +
      '<div id="wq-help">' + hintBtn(q) + '</div><div id="wq-hintbox"></div><div id="wq-fb"></div>';
    render(h, retry ? 'M9-fix' : 'M6');
    wireBar();
    WQI.wireZoom(ROOT, T);
    if (!retry) ahead(i);
    ev(retry ? 'retry_view' : 'question_view', { qid: q.qid, i: i + 1 });

    // Jugnu's hint (q.hint, written with the lesson in mind and checked in code never to give the
    // answer): a tap shows it beside a thinking Jugnu and plays its own clip. A question with no hint
    // keeps the "listen again" help.
    var hint = hintOf(q);
    var hintUsed = false;
    on('#wq-jhelp', function () {
      hintUsed = true;
      clearTimers();
      var b = $('#wq-jhelp'); if (b) b.className = 'wq-jhelp';
      var bt = $('#wq-jhelp-t'); if (bt) bt.textContent = T.hintAsk;
      var sp = $('#wq-spk'); if (sp) sp.classList.remove('wq-speaking');
      var box = $('#wq-hintbox');
      if (box) {
        box.innerHTML = '<div class="wq-jug wq-hintjug">' + jugImg('thinking', true) + '<div class="wq-say" dir="auto">' + WQI.tex(hint) + '</div></div>';
        try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }
      ev('hint_used', { qid: q.qid, i: i + 1, src: retry ? 'retry' : 'first' });
      speak(WQI.say(hint, LANG), (q.audio && q.audio.hint) || null, null, { qid: q.qid, part: 'hint' });
    });
    function armHelp() {
      clearTimers();
      helpTimer = setTimeout(function () {
        var el = $('#wq-help');
        if (!el || el.getAttribute('data-done')) return;
        if (hint) {
          if (hintUsed) return;
          var b = $('#wq-jhelp'); if (b) b.className = 'wq-jhelp wq-nudge';
          var t = $('#wq-jhelp-t'); if (t) t.textContent = T.hintNudge;
          ev('help_shown', { qid: q.qid, src: 'hint' });
          return;
        }
        el.innerHTML = '<div class="wq-hint"><img src="' + IMG + 'thinking.webp" alt="">' + esc(T.helpAgain) + '<button class="wq-spk" id="wq-help-spk" aria-label="' + esc(T.listen) + '">🔊</button></div>';
        ev('help_shown', { qid: q.qid });
        on('#wq-help-spk', function () { ev('help_used', { qid: q.qid }); read(); });
      }, HELP_AFTER_MS);
    }
    // Help waits until the voice has finished, then gives the child time of their own.
    function read() {
      var b = $('#wq-spk'); if (b) b.classList.add('wq-speaking');
      speakSeq(readParts(q), function () { var b2 = $('#wq-spk'); if (b2) b2.classList.remove('wq-speaking'); armHelp(); }, q.qid);
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
        var hbox = $('#wq-hintbox'); if (hbox) hbox.innerHTML = '';
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
    // A picture question cannot name its answer aloud, so after the picked tile's own line ("That is
    // a seed.") the reason the right picture is right still follows.
    var reason = !ok && !named && picked.fb && q.why ? WQI.letters(q, q.why) : '';
    if (reason === why) reason = '';
    // A true/false item says which the sentence is ("Not yet. This sentence is true."): the true
    // button is always shown first.
    var tf = !ok && WQI.kind(q) === 'tf';
    var tfTrue = tf && (q.options || [])[0] && String(q.correct_slot || '') === q.options[0].slot;
    var lead = vline(ok ? (retry ? 'fixed' : 'right') : tf ? (tfTrue ? 'tftrue' : 'tffalse') : named ? 'notyet' : 'notyetpic');
    var line = !ok && named && !tf ? T.notyet(lead.text, optText(right)) : lead.text;
    if (tf) named = false; // the lead already names the answer
    var answered = answeredCount();
    var halfway = !retry && ok !== null && answered === Math.ceil(N / 2) && N >= 4;
    var cheer = halfway ? vline('cheer') : null;
    var fb = $('#wq-fb');
    var loopIt = !!ok && !jugRightDone;
    if (ok) jugRightDone = true;
    fb.innerHTML = '<div class="wq-jug">' + jugImg(ok ? 'correct' : 'notyet', loopIt) + '<div class="wq-fb ' + (ok ? 'wq-ok' : 'wq-no') + '">' + esc(line) +
      (why ? '<div class="wq-why">' + WQI.tex(why) + '</div>' : '') +
      (reason ? '<div class="wq-why">' + WQI.tex(reason) + '</div>' : '') +
      (!ok && !retry ? '<div class="wq-why">' + esc(T.again) + '</div>' : '') + '</div></div>' +
      (cheer ? '<p class="wq-proof">🎉 ' + esc(cheer.text) + '</p>' : '') +
      '<button class="wq-btn wq-go" id="wq-next">' + esc(T.next) + '</button>';
    ROOT.setAttribute('data-m', 'M7');
    ev('feedback_view', { qid: q.qid, ok: ok ? 1 : 0 });
    var reasonPart = reason && speakable(WQI.say(reason, LANG)) ? [{ text: WQI.say(reason, LANG), url: (q.audio && q.audio.why) || null }] : [];
    speakSeq(feedbackParts(q, ok, lead, why, picked, named).concat(reasonPart, cheer ? [cheer] : []), null);
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
      if (S.pending) { ev('offline_sync', { lag_s: Math.round((Date.now() - (S.pendingAt || Date.now())) / 1000), i: answeredCount() }); S.pending = 0; }
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
      var done = vline('done');
      var h = bar() + jug('celebrate', done.text, true, true) +
        '<div class="wq-card wq-stack wq-center"><p class="wq-qof">' + esc(T.done) + '</p>' +
        '<h1>' + esc(T.got(sc.correct, total)) + '</h1>' + stars(sc.correct, total) +
        (fixed ? '<p class="wq-sub">' + esc(T.fixedLine(fixed)) + '</p>' : '') +
        '<p class="wq-small">' + esc(T.scoreNote) + '</p></div>' +
        (res.counted === false ? '<div class="wq-banner">' + esc(T.prac) + '</div>' : '') +
        '<button class="wq-btn wq-go" id="wq-card">' + esc(T.seeCard) + '</button>' +
        '<button class="wq-btn wq-navy" id="wq-class">' + esc(T.classBtn) + '</button>' + moreBtn();
      render(h, 'M9');
      wireBar();
      sfx('done');
      speak(done.text, done.url, null);
      on('#wq-card', card);
      on('#wq-class', board);
      on('#wq-more', moreVideos);
    }, function (e) {
      var tooFew = e && e.r && e.r.status === 409;
      if (!tooFew && offlineLike(e) && answeredCount() >= Math.ceil(N / 2)) return pendingResults(fixed);
      var h = bar() + jug('notyet', tooFew ? T.tooFew : T.offline) +
        '<button class="wq-btn wq-go" id="wq-retry">' + esc(tooFew ? T.next : T.next) + '</button>';
      render(h, 'M9-error');
      wireBar();
      ev('error', { err: (e && e.message) || 'finish' });
      on('#wq-retry', function () { if (tooFew) { S.answers = {}; save(); nextQuestion(); } else results(fixed); });
    });
  }

  /* ---------------- finished with no internet (M9-pending) ----------------
     The phone grades every answer itself (WQI.grade), so a child who loses the connection at the end
     still sees their score. The result is marked pending (it survives a closed tab) and is sent by
     itself: on 'online', when the page comes back into view, on a backing-off timer, or on the next
     open of this code. The server's result then replaces the phone's. */
  var syncT = null, syncWait = 15000;
  function offlineLike(e) { return !(e && e.r) || !e.r.status || e.r.status >= 500; }
  function localScore() {
    var c = 0, t = 0;
    QS.forEach(function (q) { var a = S.answers[q.qid]; if (a) { t++; if (a.ok) c++; } });
    return { correct: c, total: t };
  }
  function pendingResults(fixed) {
    if (!S.pending) { S.pending = 1; S.pendingAt = Date.now(); ev('offline_finish', { i: answeredCount() }); }
    S.fixed = fixed; save();
    var sc = localScore();
    var h = bar() + jug('celebrate', T.offDone, true) +
      '<div class="wq-card wq-stack wq-center"><p class="wq-qof">' + esc(T.done) + '</p>' +
      '<h1>' + esc(T.got(sc.correct, sc.total)) + '</h1>' + stars(sc.correct, sc.total) + '</div>' +
      '<div class="wq-banner">' + esc(T.offWait) + '</div>' +
      '<button class="wq-btn wq-go" id="wq-sync">' + esc(T.tryNow) + '</button>';
    render(h, 'M9-pending');
    wireBar();
    on('#wq-sync', function () { syncNow(true); });
    syncLater();
  }
  function syncLater() {
    clearTimeout(syncT);
    syncT = setTimeout(function () { syncNow(false); }, syncWait);
    syncWait = Math.min(60000, syncWait * 2);
  }
  function syncNow(tapped) {
    if (!S.pending || ROOT.getAttribute('data-m') !== 'M9-pending') return;
    clearTimeout(syncT);
    finish().then(function () { syncWait = 15000; results(S.fixed || 0); }, function (e) {
      if (tapped) toast(T.offline);
      if (offlineLike(e)) syncLater(); else results(S.fixed || 0);
    });
  }
  window.addEventListener('online', function () { syncNow(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncNow(false); });

  /* ---------------- share: navigator.share -> wa.me -> copy ---------------- */
  function share(text, url, what) {
    var full = text + ' ' + url;
    ev('share_click', { src: what, step: 'tap' });
    if (navigator.share) {
      navigator.share({ text: text, url: url }).then(function () { ev('share_click', { src: what, step: 'native', path: 'native' }); },
        function (e) { if (e && e.name === 'AbortError') ev('share_click', { src: what, step: 'native_cancel' }); else fallback(full, what, text, url); });
      return;
    }
    fallback(full, what, text, url);
  }
  // The preview shows the link on its own left-to-right line: inside an Urdu message it would wrap backwards.
  function fallback(full, what, text, url) {
    var h = bar() + '<h2>' + esc(T.fbT) + '</h2><p class="wq-sub">' + esc(T.fbSub) + '</p>' +
      '<div class="wq-card"><p>' + esc(text != null ? text : full) + '</p>' + (url ? '<p class="wq-url" dir="ltr">' + esc(url) + '</p>' : '') + '</div>' +
      '<a class="wq-btn wq-go" id="wq-wa" href="https://wa.me/?text=' + encodeURIComponent(full) + '">' + esc(T.fbWa) + '</a>' +
      '<button class="wq-btn wq-soft" id="wq-copy">' + esc(T.fbCopy) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    var at = ROOT.getAttribute('data-m');
    var back = at === 'M11' ? board : at === 'M16' ? drawSchools : card;
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
    // A practice round: say so, and share the kept first-try score the class league shows.
    var kept = c.practice && c.kept ? c.kept : null;
    var shareC = kept ? kept.correct : c.correct, shareT = kept ? (kept.total || total) : total;
    var h = bar() +
      '<div class="wq-scorecard"><header>' + markHtml() + dotJoin(BR ? BR.name : '', CLS.label) + '</header><div class="wq-in">' +
      '<img src="' + IMG + 'celebrate.webp" alt="">' +
      '<div class="wq-name">' + ani(c.animal) + ' ' + esc(c.first || (S.child && S.child.first) || '') + '</div>' +
      '<p class="wq-sub">' + esc(Q.topic) + '</p>' +
      '<div class="wq-big">' + esc(c.correct) + '/' + esc(total) + '</div>' + stars(c.stars != null ? c.stars : c.correct, total) +
      '<div class="wq-praise">' + esc(T.praise(c.correct, total)) + '</div></div></div>' +
      (kept ? '<div class="wq-banner">' + esc(TW.practice(digitsFor(kept.correct), digitsFor(shareT))) + '</div>' : '') +
      vsStrip(res.vs, c, total) + newBest(c, total) +
      '<p class="wq-small wq-center">' + esc(T.cardPriv) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-share">' + esc(T.shareBtn) + '</button>' +
      '<button class="wq-btn wq-navy" id="wq-chal">' + esc(T.challenge) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-class">' + esc(T.classBtn) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-schools">' + esc(T.schoolsBtn) + '</button>' + moreBtn();
    render(h, 'M10');
    wireBar();
    ev('card_view', {});
    if (res.vs && T.vs[res.vs.outcome]) ev('challenge_result', { reason: res.vs.outcome });
    // The challenge code names the challenger on the server: no child's name rides in the link.
    var chalUrl = link('/q/' + (res.challenge_code || CODE));
    // The class group gets the CLASS link: a classmate who joined through a friend's challenge code would
    // count as that child's friend and drop out of the teacher's class report.
    var classUrl = link('/q/' + CODE);
    // A zero is shared as "played", never as a score for the group to beat.
    // A practice round shares the kept first-try score (shareC/shareT), the one the league shows.
    var line = shareC ? T.shareLine(c.first, shareC, shareT, Q.topic) : T.sharePlayed(c.first, Q.topic);
    on('#wq-share', function () { share(line, classUrl, 'card'); });
    on('#wq-chal', function () { share(line, chalUrl, 'challenge'); });
    on('#wq-class', board);
    on('#wq-schools', function () { schools(card); });
    on('#wq-more', moreVideos);
  }

  // A practice round that beats the child's best earlier score on this code (finish's card.best).
  function newBest(c, total) {
    var b = c.practice && c.best;
    if (!b || !(b.total > 0) || !(total > 0) || c.correct * b.total <= b.correct * total) return '';
    function sc(x, y) { return '<bdi dir="ltr">' + esc(x) + '/' + esc(y) + '</bdi>'; }
    return '<div class="wq-banner wq-best">' + esc(TW.newBest) + ' ' + sc(c.correct, total) + ' · ' + esc(TW.wasBest) + ' ' + sc(b.correct, b.total) + ' ⭐</div>';
  }

  // A friend's challenge: who won, with both scores (each score isolated so it reads left to right in Urdu).
  function vsStrip(vs, c, total) {
    if (!vs || !T.vs[vs.outcome]) return '';
    function sc(a, b) { return '<bdi dir="ltr">' + esc(a) + '/' + esc(b) + '</bdi>'; }
    return '<div class="wq-banner wq-vs"><b>' + esc(T.vs[vs.outcome]) + '</b><br>' + esc(T.vsYou) + ' ' + sc(c.correct, total) +
      ' · ' + esc(vs.first) + ' ' + sc(vs.correct, vs.total) + '</div>';
  }

  /* ---------------- M15 watch another video -> its quiz ---------------- */
  // The video bank is by grade: a quiz with no grade has nothing to offer. The list comes from the
  // bot (E11); picking a lesson gets its code (E12) and opens it in the SAME view (the in-app
  // browser has no reliable new tab). Who is playing goes along in this phone's storage, never in
  // the link: the new page starts at once with the session token of the quiz just played.
  var SUBJECT_TILE = { Science: '🔬', Maths: '➗', English: '🔤', Urdu: 'ا', 'Islamic Studies': '🕌', 'General Knowledge': '🌍', Geography: '🗺️', History: '📜' };
  var HANDOVER_MS = 10 * 60 * 1000;
  function moreBtn() { return Q.grade ? '<button class="wq-btn wq-soft wq-more" id="wq-more">▶ ' + esc(T.moreBtn) + '</button>' : ''; }
  function vItem(v, i) {
    // Each atom isolated, so "3.2 MB" keeps its Latin order inside an Urdu line.
    var meta = [v.secs ? esc(T.mins(Math.max(1, Math.round(v.secs / 60)))) : '', v.mb ? '<bdi dir="ltr">' + esc(v.mb + ' MB') + '</bdi>' : ''].filter(Boolean).join(' · ');
    var pic = v.poster ? '<img class="wq-vtile" src="' + esc(v.poster) + '" alt="" loading="lazy">'
      : '<span class="wq-vtile wq-vt' + (i % 4 + 1) + '" aria-hidden="true">' + (SUBJECT_TILE[v.subject] || '▶') + '</span>';
    return '<li><button class="wq-vitem" data-vid="' + esc(v.vid) + '">' + pic +
      '<span class="wq-vtext"><b dir="auto">' + esc(v.title) + '</b><small>' + meta + '</small></span>' +
      (v.done ? '<span class="wq-vdone">' + esc(T.doneTag) + '</span>' : '') + '</button></li>';
  }
  function moreVideos() {
    var from = ROOT.getAttribute('data-m') || '';
    render(bar() + '<div class="wq-boot"><img src="' + IMG + 'thinking.webp" alt="" width="96"></div>', 'M15-wait');
    wireBar();
    api('GET', 'videos/' + encodeURIComponent(CODE) + (S.st ? '?st=' + encodeURIComponent(S.st) : '')).then(function (r) {
      var vids = (r.ok && r.body && r.body.videos) || [];
      var h = bar() + jug('hello', vids.length ? T.moreSay : T.moreNone) + '<h2>' + esc(T.moreT) + '</h2>' +
        (vids.length ? '<ul class="wq-vlist">' + vids.map(vItem).join('') + '</ul>' : '') +
        '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
      render(h, 'M15');
      wireBar();
      ev('more_view', { src: from.toLowerCase().replace(/[^a-z0-9_]/g, '_') || undefined, i: vids.length });
      on('#wq-back', afterResult);
      vids.forEach(function (v, i) { on('[data-vid="' + v.vid + '"]', function () { pickVideo(v, i); }); });
    }, function () {
      render(bar() + jug('notyet', T.offline) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M15-error');
      wireBar();
      ev('error', { err: 'more_net' });
      on('#wq-retry', moreVideos);
    });
  }
  var picking = false;
  function pickVideo(v, i) {
    if (picking) return;
    picking = true;
    // Jugnu waits on screen at once: the bot call and the next page's load take seconds on slow 4G.
    render(bar() + jug('thinking', T.moreWait, true, true) + '<p class="wq-sub wq-center" dir="auto">' + esc(v.title) + '</p>', 'M15-go');
    wireBar();
    ev('more_pick', { i: i, ok: !v.done });
    api('POST', 'videos/start', { code: CODE, st: S.st, vid: v.vid }).then(function (r) {
      if (!r.ok || !r.body || !r.body.code) throw new Error('more_start_' + r.status);
      sset('wq_from', { code: r.body.code, st: S.st, at: Date.now() });
      flushEv(true);
      location.assign('/q/' + encodeURIComponent(r.body.code));
    }).catch(function (e) {
      picking = false;
      toast(T.oops);
      moreVideos();
      ev('error', { err: String((e && e.message) || 'more_start').replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 40) });
    });
  }
  // On the lesson's own page: the hand-over left by pickVideo, if it is for this code and fresh.
  function handover() {
    var f = sget('wq_from', null);
    if (!f) return null;
    sset('wq_from', null);
    try { localStorage.removeItem('wq_from'); } catch (e) {}
    return f.code === CODE && f.st && Date.now() - (f.at || 0) < HANDOVER_MS ? f : null;
  }

  /* ---------------- M11 league table ---------------- */
  // A row's stars are its score, the card's rule (one lit star per right answer), never one ⭐ for every child.
  function rowScore(c, t) {
    var n = Number(c) || 0, tot = Number(t) || 0;
    var s = tot > 0 && tot <= 12 ? stars(Math.min(n, tot), tot).replace('class="wq-stars"', 'class="wq-stars wq-rstars"') : '';
    return '<span class="wq-rscore">' + esc(c) + '/' + esc(t) + '</span>' + s;
  }
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
          (isYou ? '<span class="wq-tag">' + esc(T.you) + '</span>' : '') + '</td><td>' + rowScore(x.correct, x.total) + '</td></tr>';
      }).join('');
      if (you && !youShown) {
        rows += '<tr class="wq-you"><td>' + esc(you.place) + '</td><td>' + ani(S.child && S.child.animal) + ' ' + esc(me || '') + '<span class="wq-tag">' + esc(T.you) + '</span></td><td>' + rowScore(you.correct, you.total) + '</td></tr>';
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
        '<button class="wq-btn wq-soft" id="wq-schools">' + esc(T.schoolsBtn) + '</button>' +
        (S.result ? '<button class="wq-btn wq-soft" id="wq-next">' + esc(T.myScores) + '</button>' : '<button class="wq-btn wq-navy" id="wq-play">' + esc(T.play) + '</button>');
      render(h, 'M11');
      wireBar();
      ev('board_view', { src: B.view === 'class' ? 'class_link' : 'page', i: b.finishers_n });
      on('#wq-share-t', function () { share(T.tableLine(Q.topic, CLASS_LABEL), link('/q/' + CODE + '/class'), 'table'); });
      on('#wq-schools', function () { schools(board); });
      on('#wq-next', history);
      on('#wq-play', landing);
    }).catch(function (e) {
      ev('error', { err: (e && e.message) || 'board' });
      render(bar() + jug('notyet', T.offline) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M11-error');
      wireBar();
      on('#wq-retry', board);
    });
  }

  /* ---------------- M16 school league ---------------- */
  // Every school's points this week (10 for playing + up to 10 for the score). The child's own school is a
  // card on top (its place, its move since yesterday, what this finish added) and its row is pinned (CSS
  // sticky) when scrolled away; a school with nothing yet gets "be the first" on top and is never given a
  // rank. The schools still to start are names behind a fold, never numbers. "My sector" filters here.
  var SCH = { back: null, data: null, sector: false };
  function schoolMove(m) {
    if (m === 'new') return '<span class="wq-move wq-new">' + esc(T.moveNew) + '</span>';
    if (typeof m !== 'number' || !m) return '';
    return m > 0 ? '<span class="wq-move wq-up" dir="ltr">▲' + m + '</span>' : '<span class="wq-move wq-down" dir="ltr">▼' + (-m) + '</span>';
  }
  function schoolRow(r) {
    return '<li class="wq-srow' + (r.mine ? ' wq-you' : '') + '"' + (r.mine ? ' id="wq-mine"' : '') + '>' +
      '<span class="wq-splace">' + esc(r.place) + '</span>' +
      '<span class="wq-sname"><bdi>' + esc(r.name) + '</bdi>' + (r.mine ? '<span class="wq-tag">' + esc(T.yourSchool) + '</span>' : '') +
      '<small>' + esc(T.kidsN(r.kids || 0)) + '</small></span>' +
      '<span class="wq-spts">' + esc(T.pts(r.points || 0)) + schoolMove(r.move) + '</span></li>';
  }
  function schoolsSrc(back) { return B.view === 'schools' && !SCH.opened ? 'link' : back === card ? 'card' : back === today ? 'today' : 'class'; }
  function schools(from) {
    SCH.back = typeof from === 'function' ? from : afterResult;
    NAV.schoolsBack = SCH.back;
    render(bar() + '<div class="wq-boot"><img src="' + IMG + 'thinking.webp" alt="" width="96"></div>', 'M16-wait');
    wireBar();
    api('GET', 'schools/' + encodeURIComponent(CODE) + (S.st ? '?st=' + encodeURIComponent(S.st) : '')).then(function (r) {
      if (!r.ok) throw new Error('schools_' + r.status);
      SCH.data = r.body || {};
      SCH.sector = false;
      var mine = SCH.data.mine || null;
      ev('leaderboard_view', { src: schoolsSrc(SCH.back), i: (mine && mine.place) || 0, seq: SCH.data.ranked_n || 0 });
      SCH.opened = true;
      drawSchools();
    }).catch(function (e) {
      ev('error', { err: (e && e.message) || 'schools' });
      render(bar() + jug('notyet', T.offline) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M16-error');
      wireBar();
      on('#wq-retry', function () { schools(SCH.back); });
    });
  }
  function drawSchools() {
    var b = SCH.data || {};
    var mine = b.mine || null;
    var rows = b.rows || [];
    if (SCH.sector && mine && mine.sector) rows = rows.filter(function (x) { return x.sector === mine.sector; });
    var list = rows.map(schoolRow).join('');
    var nm = mine ? '<bdi>' + esc(mine.name) + '</bdi>' : '';
    var top = !mine ? '' : mine.ghost
      ? '<div class="wq-card wq-mycard wq-zero" id="wq-mine"><p>' + T.ghost(nm) + '</p></div>'
      : '<div class="wq-card wq-mycard" id="wq-mycard"><p><b>' + T.schoolPlace(nm, esc(mine.place)) + '</b></p>' +
        (typeof mine.move === 'number' && mine.move ? '<p class="wq-move ' + (mine.move > 0 ? 'wq-up' : 'wq-down') + '">' + esc(T.sinceY(mine.move)) + '</p>' : '') +
        '<p class="wq-sub">' + esc(T.pts(mine.points || 0)) + ' · ' + esc(T.kidsN(mine.kids || 0)) + '</p>' +
        (b.added ? '<p class="wq-added">' + T.added(esc(b.added), nm) + '</p>' : '') + '</div>';
    var chips = mine && mine.sector && (b.rows || []).length
      ? '<div class="wq-chips wq-schips"><button class="wq-chip' + (SCH.sector ? '' : ' wq-on') + '" id="wq-all">' + esc(T.allSchools) + '</button>' +
        '<button class="wq-chip' + (SCH.sector ? ' wq-on' : '') + '" id="wq-sector">' + esc(T.mySector) + ' · <bdi>' + esc(mine.sector) + '</bdi></button></div>' : '';
    var zn = b.zero_names || [];
    var zero = b.zero_n && (b.rows || []).length && !SCH.sector
      ? '<details class="wq-zero-list"><summary>' + esc(T.zeroN(b.zero_n)) + '</summary>' +
        (zn.length ? '<ul>' + zn.map(function (n) { return '<li><bdi>' + esc(n) + '</bdi></li>'; }).join('') + '</ul>' : '') + '</details>' : '';
    var h = bar() + '<h2>' + esc(T.schoolsT) + '</h2><p class="wq-sub">' + esc(T.schoolsRule) + '</p>' + top + chips +
      (list ? '<ol class="wq-slist">' + list + '</ol>' : mine ? '' : '<div class="wq-card">' + esc(T.noSchools) + '</div>') + zero +
      (mine ? '<button class="wq-btn wq-go" id="wq-share-s">' + esc(mine.ghost ? T.inviteSchool : T.shareSchools) + '</button>' : '') +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M16');
    wireBar();
    on('#wq-all', function () { SCH.sector = false; drawSchools(); });
    on('#wq-sector', function () { SCH.sector = true; drawSchools(); });
    on('#wq-share-s', function () {
      ev('leaderboard_share', { src: 'schools', i: (mine && mine.place) || 0 });
      share(T.schoolsLine(mine.name, mine.ghost ? null : mine.place), link('/q/' + CODE + '/schools'), 'schools');
    });
    on('#wq-back', SCH.back);
  }

  /* ---------------- M13 history (when the API has it) -> M14 today ---------------- */
  // The server's ISO day ("2026-10-06") as a child reads it: "6 Oct" / «6 اکتوبر»; anything else as it came.
  function dayMonth(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    var mon = m && T.months && T.months[+m[2] - 1];
    return mon ? (+m[3]) + ' ' + mon : String(d || '');
  }
  function history() {
    var chips = kids().map(function (k) { return k.chip; }).filter(Boolean).slice(0, 6);
    if (!chips.length) return today();
    api('POST', 'me', { code: CODE, chips: chips }).then(function (r) {
      var hist = (r.ok && r.body.history) || [];
      var fr = (r.ok && r.body.friends_finished) || [];
      if (!hist.length && !fr.length) return today();
      var h = bar() + '<h2>' + esc(T.histT) + '</h2><ul class="wq-hist">' + hist.slice(0, 10).map(function (x) {
        return '<li><span>' + esc(x.topic) + '<br><small class="wq-small">' + esc(dayMonth(x.date)) + '</small></span><span>' + rowScore(x.correct, x.total) + '</span></li>';
      }).join('') + '</ul>' +
        (fr.length ? '<p class="wq-sub">' + esc(T.friends) + '</p><ul class="wq-hist">' + fr.slice(0, 6).map(function (x) {
          return '<li><span>' + dotJoin(x.first, x.topic, T.frOut[x.outcome]) + '</span><span>' + esc(x.correct) + '/' + esc(x.total) + '</span></li>';
        }).join('') + '</ul>' : '') +
        '<button class="wq-btn wq-go" id="wq-next">' + esc(T.next) + '</button>';
      render(h, 'M13');
      wireBar();
      ev('history_view', { i: hist.length });
      on('#wq-next', today);
    }, today);
  }
  // "Time to rest" only when nothing is left to play today: with an unplayed lesson in the class's
  // list the screen offers it instead. The list is asked for once the screen is up; no grade, no list.
  function today() {
    todayView(!!Q.grade);
    ev('today_view', {});
    if (!Q.grade) return;
    api('GET', 'videos/' + encodeURIComponent(CODE) + (S.st ? '?st=' + encodeURIComponent(S.st) : '')).then(function (r) {
      var vids = (r.ok && r.body && r.body.videos) || [];
      var left = vids.some(function (v) { return !v.done; });
      if (!left && ROOT.getAttribute('data-m') === 'M14') todayView(false);
    }, function () {});
  }
  function todayView(more) {
    var h = bar() + (more ? jug('hello', T.todayMore, true) : jug('sleep', T.rest, true)) +
      '<div class="wq-card wq-stack wq-center"><p class="wq-qof">' + esc(T.todayT) + '</p>' +
      '<div class="wq-big">' + esc(fmtN(LIVE.ict_today_floor || 0)) + '</div>' +
      '<p class="wq-sub">' + esc(T.todaySub) + '</p></div>' +
      (more ? moreBtn() : '') + '<button class="wq-btn wq-soft" id="wq-schools">' + esc(T.schoolsBtn) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-home">' + esc(T.home) + '</button>';
    render(h, 'M14');
    wireBar();
    on('#wq-schools', function () { schools(today); });
    on('#wq-home', function () { if (S.result) card(); else landing(); });
    on('#wq-more', moreVideos);
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
  var NAV = { armed: false, warnAt: 0, leaving: false, shareBack: null, schoolsBack: null };
  var PLAYING = { M5: 1, M6: 1, M7: 1, 'M9-fix': 1, 'M9-tricky': 1 };
  function afterResult() { if (S.result) card(); else landing(); }
  function backTo(m) {
    if (ID && ID.backTo(m)) return ID.backTo(m);
    if (m === 'M4') return landing;
    if (m === 'M4-new' || m === 'M4-isyou') return who;
    if (m === 'M12-fallback') return NAV.shareBack || afterResult;
    if (/^M16/.test(m)) return NAV.schoolsBack || afterResult;
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
  ev('page_open', { ua: String(navigator.userAgent || '').slice(0, 300), iab: IAB, store: STORE_OK ? 1 : 0, net: conn.effectiveType || '', src: B.view || 'quiz', reason: B.challenge ? 'challenge' : undefined });
  if (S.queue.length) flushQueue();
  var FROM = B.view === 'class' || B.view === 'schools' || S.st ? null : handover();
  if (B.view === 'schools') schools(afterResult);
  else if (B.view === 'class') board();
  else if (FROM) { ev('more_arrive', {}); startSession({ from_st: FROM.st }, null, ''); }
  else if (S.result && S.st) card();
  else if (S.pending && S.st) results(S.fixed || 0);
  else if (S.st && S.child && (answeredCount() > 0 || (S.vt > 0 && wantsVideo()))) resume();
  else landing();
})();
