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
  // Inline SVG marks, never emoji: old Android phones draw newer emoji as empty boxes.
  var SPK = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
  function ico(body) { return '<svg class="wq-i" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>'; }
  // With the sound kit on the page (web_quiz_juice) the remaining marks are inline SVG; without it, today's emoji.
  function ic(svg, emoji) { try { return window.WQJ ? svg : emoji; } catch (e) { return emoji; } }
  var ICON = {
    tap: ico('<path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v2m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L9 14"/>'),
    help: ico('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'),
    school: ico('<path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5M12 5V2h3"/>'),
    trophy: ico('<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>'),
    home: ico('<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/>'),
    kid: ico('<circle cx="12" cy="7" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
    street: ico('<path d="M2 20h20M3 20v-8l5-4 5 4v8M13 20v-6l4-3 4 3v6"/>'),
    live: ico('<circle cx="12" cy="12" r="6" fill="currentColor"/>'),
    star: ico('<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/>'),
    check: ico('<path d="M5 12.5l4.5 4.5L19 7"/>'),
    cross: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: ico('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
    play: ico('<path d="M7 4l13 8-13 8z" fill="currentColor"/>')
  };
  var BELL = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" fill="currentColor"/><path d="M10 21h4"/></svg>';
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
  function hotsFit(q) {
    var f = q.figure, hs = f && f.hotspots;
    if (!hs || !hs.length) return false;
    var vb = f.svg ? viewBox(f.svg) : null;
    if (f.w && f.h) vb = { x: vb ? vb.x : 0, y: vb ? vb.y : 0, w: +f.w, h: +f.h };
    if (!vb || !(vb.w > 0) || !(vb.h > 0)) return false;
    return hs.every(function (h) { return +h.x >= vb.x && +h.x <= vb.x + vb.w && +h.y >= vb.y && +h.y <= vb.y + vb.h; });
  }
  function allPics(o) { return o.length > 0 && o.every(function (x) { return x.img || (x.pic && (x.pic.svg || x.pic.glyph || x.pic.kind === 'glyph')); }); }
  function kind(q) {
    var k = KINDS[String(q.type || '').toLowerCase()];
    // A label item plays only when every hotspot sits on its drawing; one outside the picture's box was drawn
    // off the picture (render matrix). Then the parts are offered as words.
    if (k === 'label' && q.figure && !hotsFit(q)) return 'single';
    if (k) return k;
    if (q.multi) return 'multi';
    if (allPics(opts(q))) return 'picture';
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
  var SYM = { times: '×', div: '÷', cdot: '·', pm: '±', le: '≤', ge: '≥', ne: '≠', pi: 'π', degree: '°', circ: '°', approx: '≈', to: '→', rightarrow: '→',
    neq: '≠', leq: '≤', geq: '≥', dots: '…', ldots: '…', cdots: '⋯', infty: '∞', leftarrow: '←', Rightarrow: '⇒', longrightarrow: '⟶', rightleftharpoons: '⇌' };
  // Greek letters seen in prod questions (\Omega in a circuit): upright, as a unit is written.
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', rho: 'ρ', sigma: 'σ', omega: 'ω', Omega: 'Ω' };
  // Every TeX command the page typesets. Anything else is spelled out in letters, so the author gate reads this
  // list (quiz-math texFaults) and rewrites an item that uses a command outside it.
  var TEX_SUPPORTED = Object.keys(SYM).concat(Object.keys(GREEK), ['frac', 'sqrt', 'text', 'textrm', 'mathrm', 'xrightarrow', 'begin', 'end', 'hline', ',', ';', ' ', '\\']);
  function texTokens(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === '\\') {
        var m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
        i += m[0].length;
        var raw = /^(text|textrm|mathrm)$/.test(m[1]) ? /^\s*\{([^}]*)\}/.exec(s.slice(i)) : null;
        if (raw) { out.push({ cmd: 'text', raw: raw[1] }); i += raw[0].length; } else out.push({ cmd: m[1] });
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
    // \begin{array}{rr} … \end{array} (a column sum): a table, its cells typeset, \hline a rule over the next row.
    function table() {
      textArg();
      var spec = textArg().replace(/[^lcr]/g, '');
      var rows = [[[]]], ruled = [false];
      while (st.i < tk.length && !(tk[st.i].cmd === 'end')) {
        var x = tk[st.i++], row = rows[rows.length - 1];
        if (x.cmd === '\\') { rows.push([[]]); ruled.push(false); } else if (x.o === '&') row.push([]);
        else if (x.cmd === 'hline') ruled[rows.length - 1] = true;
        else row[row.length - 1].push(x);
      }
      st.i++; textArg();
      var al = { l: 'left', c: 'center', r: 'right' };
      return '<mtable>' + rows.map(function (cells, r) {
        if (!ruled[r] && cells.length === 1 && !cells[0].length) return '';
        return '<mtr>' + cells.map(function (cell, k) {
          var css = 'text-align:' + (al[spec.charAt(k)] || 'right') + (ruled[r] ? ';border-top:2px solid currentColor' : '');
          return '<mtd style="' + css + '">' + texParse(cell, { i: 0 }) + '</mtd>';
        }).join('') + '</mtr>';
      }).join('') + '</mtable>';
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
        if (t.raw != null) return '<mtext>' + esc(t.raw.replace(/ /g, '\u00a0')) + '</mtext>';
        if (t.cmd === 'text' || t.cmd === 'mathrm') return '<mtext>' + esc(textArg()) + '</mtext>';
        if (t.cmd === 'xrightarrow') return '<mover><mo>→</mo>' + wrapRow(group()) + '</mover>';
        if (t.cmd === 'begin') return table();
        if (GREEK[t.cmd]) return '<mi mathvariant="normal">' + GREEK[t.cmd] + '</mi>';
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
        return '<span class="wq-mx"><math class="wq-m" dir="ltr">' + texParse(texTokens(seg.slice(1, -1)), { i: 0 }) + '</math></span>';
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
  // A figure file that never arrives (a missing object) hides its figure: never a broken-picture icon and its alt text.
  var FIG_LOADING = ' class="wq-ld" onload="this.className=\'\'" onerror="var f=this.closest(\'figure\');if(f)f.style.display=\'none\'"';
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
      : '<img src="' + esc(f.url) + '" alt="' + esc(f.alt || '') + '"' + FIG_LOADING + '>';
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
    // The sound to identify is the question: its options are heard one by one, on their own 🔊, never as a block before the
    // child answers (hearing every option in order and then being asked "which was it" assesses nothing).
    if (au && au.stim) return parts;
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
  var ILANG = 'en'; // the page language itemHtml was last drawn for (latDir on the option labels)
  // The clip of ONE option, by its stored slot (its content), never by where the shuffle put it.
  function optClip(q, slot) {
    var au = q && q.audio, si = 'ABCD'.indexOf(String(slot || '').charAt(0));
    return au && au.opts && si >= 0 ? au.opts[si] || null : null;
  }
  var HEAR = null; // { q, label } while a single/multi item renders: an option with a clip gets its own 🔊
  function hearHtml(o) {
    if (!HEAR || !optClip(HEAR.q, o.slot)) return '';
    return '<span class="wq-ohear" role="button" tabindex="0" data-hear="' + esc(o.slot) + '" aria-label="' + esc(HEAR.label) + '">' + SPK + '</span>';
  }
  // Sound tiles: an item whose options are SOUNDS (a listen-and-identify item, or the bank's audio-only "Sound 1/2"), with a
  // clip on every option. Each tile plays its option's clip; a separate "This one" under it is the answer.
  var AUDIO_ONLY = /^Sound (\d+)$/;
  function soundTiles(q) {
    var o = opts(q);
    if (o.length < 2 || !o.every(function (x) { return optClip(q, x.slot); })) return false;
    var au = q.audio || {};
    return Boolean(au.stim) || o.every(function (x) { return AUDIO_ONLY.test(String(x.text || '').trim()); });
  }
  function tilesHtml(q, T) {
    return '<div class="wq-stiles" role="group">' + opts(q).map(function (x, i) {
      var m = AUDIO_ONLY.exec(String(x.text || '').trim());
      var lab = m ? m[1] : (x.text || x.name || '');
      return '<div class="wq-stile wq-st' + (i % 4 + 1) + '"><button class="wq-shear" type="button" data-hear="' + esc(x.slot) + '" aria-label="' + esc(T.hearOption || T.listen || '') + '">' +
        '<span class="wq-shp" aria-hidden="true">' + SHAPES[i % 4] + '</span><span aria-hidden="true">' + SPK + '</span><b class="wq-stxt">' + tex(lab) + '</b></button>' +
        '<button class="wq-opt wq-sthis" data-slot="' + esc(x.slot) + '">' + esc(T.thisOne || '') + '</button></div>';
    }).join('') + '</div>';
  }
  function ur2On() { try { return document.documentElement.classList.contains('wq-ur2'); } catch (e) { return false; } }
  // the one button system (wq-1b): an answer's shape marker is a glyph, so screen readers skip it (the sound tiles already do)
  function shpAttr() { try { return document.documentElement.classList.contains('wq-1b') ? ' aria-hidden="true"' : ''; } catch (e) { return ''; } }
  function optBtn(o, k, extra) {
    // over 28 code points a label runs to three lines beside the badge and 🔊 at 360 px (measured on the live quizzes: 32–36 cp)
    // an English label on an Urdu page with the look (latin) keeps the one layout beside its icon, never the Nastaliq long one
    var longLab = ur2On() && !latin(o.text || o.name, ILANG) && Array.from(String(o.text || '')).length > 28 ? ' wq-long' : '';
    return '<button class="wq-opt wq-s' + (k % 4 + 1) + longLab + '" data-slot="' + esc(o.slot) + '"' + (typeof extra === 'string' ? extra : '') + '><span class="wq-shp"' + shpAttr() + '>' + SHAPES[k % 4] + (LETTERS ? '<b class="wq-let">' + 'ABCD'.charAt(k) + '</b>' : '') + '</span>' +
      picHtml(o, o.name) + '<span class="wq-lab"' + latDir(o.text || o.name, ILANG) + '>' + tex(o.text || o.name || '') + '</span>' + hearHtml(o) + '</button>';
  }
  // the adventure look on an Urdu page: an English line (no Urdu letter) is set left to right, so its marks sit at its own
  // ends; an English question is also marked Latin (its face and line height, wq-adventure.css)
  function latin(text, lang) {
    var adv = false;
    try { adv = lang === 'ur' && document.documentElement.classList.contains('wq-adv'); } catch (e) { adv = false; }
    return adv && /[A-Za-z]/.test(String(text || '')) && !/[\u0600-\u06FF]/.test(String(text || ''));
  }
  function latQ(text, lang) { return latin(text, lang) ? ' wq-qlat" dir="ltr"' : '"'; }
  function latDir(text, lang) { return latin(text, lang) ? ' dir="ltr"' : ''; }
  function itemHtml(q, T, lang) {
    var k = kind(q), o = opts(q);
    LETTERS = !figureOf(q);
    ILANG = lang;
    HEAR = k === 'single' || k === 'multi' ? { q: q, label: T.hearOption || T.listen || '' } : null;
    var stim = q.audio && q.audio.stim ? '<button class="wq-btn wq-soft" id="wq-stim">' + BELL + ' ' + esc(T.playSound || '') + '</button>' : '';
    var stem = k === 'listen'
      ? '<div class="wq-qcard wq-listen"><button class="wq-spk wq-spk-big" id="wq-spk" aria-label="' + esc(T.listen || T.listenBig) + '">' + SPK + '</button><p class="wq-qtext wq-qsmall">' + tex(q.text) + '</p>' + stim + '</div>'
      : '<div class="wq-qcard"><p class="wq-qtext' + latQ(q.text, lang) + '>' + tex(q.text) + '</p><button class="wq-spk" id="wq-spk" aria-label="' + esc(T.listen || T.listenBig) + '">' + SPK + '</button></div>' + stim;
    var body = '';
    var pics = o.length && o.every(function (x) { return x.img || (x.pic && (x.pic.svg || x.pic.glyph || x.pic.kind === 'glyph')); });
    // A picture grid needs every option to be a picture (or an emoji, drawn big): one the bot could not
    // draw stays a word, and a word in a picture tile was painted twice (render matrix). Then: a list.
    var grid = o.length && o.every(function (x) { return x.img || (x.pic && (x.pic.svg || x.pic.glyph || x.pic.kind === 'glyph')) || !speakable(x.text); });
    if ((k === 'picture' && grid) || (k === 'listen' && pics)) {
      var quiet = k === 'listen';
      body = '<div class="wq-pgrid" role="group">' + o.map(function (x, i) {
        var nm = x.name || (x.pic && x.pic.name) || x.text || '';
        // A picture with no word anywhere: the button is named by its shape for screen readers only.
        var aria = speakable(x.text || nm) ? '' : ' aria-label="' + esc(SHAPE_NAMES[lang === 'ur' ? 'ur' : 'en'][i % 4]) + '"';
        return '<button class="wq-opt wq-ptile wq-s' + (i % 4 + 1) + '" data-slot="' + esc(x.slot) + '"' + aria + '><span class="wq-shp"' + shpAttr() + '>' + SHAPES[i % 4] + (quiet || !LETTERS ? '' : '<b class="wq-let">' + 'ABCD'.charAt(i) + '</b>') + '</span>' +
          (picHtml(x, nm) || '<span class="wq-emoji">' + esc(x.text) + '</span>') +
          (!quiet && speakable(x.text || nm) && !(x.pic && (x.pic.glyph || x.pic.text) === (x.text || nm)) ? '<span class="wq-pname">' + tex(x.text || nm) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    } else if (k === 'tf') {
      body = '<div class="wq-tf" role="group">' + o.slice(0, 2).map(function (x, i) {
        return '<button class="wq-opt wq-tf' + (i ? 'n' : 'y') + '" data-slot="' + esc(x.slot) + '"><span class="wq-tfi" aria-hidden="true">' + ic(i ? ICON.cross : ICON.check, i ? '✗' : '✓') + '</span><span class="wq-lab"' + latDir(x.text, ILANG) + '>' + tex(x.text || (i ? T.no : T.yes)) + '</span></button>';
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
    } else if (soundTiles(q)) {
      body = tilesHtml(q, T);
    } else {
      body = '<div class="wq-opts" role="group">' + o.map(function (x, i) { return optBtn(x, i); }).join('') + '</div>';
    }
    return stem + figureHtml(q, T) + body;
  }

  /* ---- taps: wire(root, q, done) calls done(answerString) once ---- */
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function wire(root, q, done, hear) {
    var k = kind(q), sent = false;
    function fire(a) { if (!sent) { sent = true; done(a); } }
    // An option's own 🔊 plays that option's clip and is never an answer.
    function hearable(h) {
      function play(e) {
        if (e) { e.stopPropagation(); if (e.preventDefault) e.preventDefault(); }
        var slot = h.getAttribute('data-hear'), url = optClip(q, slot);
        if (url && hear) hear(url, slot);
      }
      h.addEventListener('click', play);
      h.addEventListener('keydown', function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) play(e); });
    }
    each(root, '.wq-ohear', hearable);
    each(root, '.wq-shear', hearable);
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
  // "Watch the lesson again": a library question can reopen its lesson video over the question (no answer changes).
  function rewatchHtml(v, T) {
    if (!v || !v.url) return '';
    return '<button class="wq-btn wq-soft wq-again" id="wq-again" type="button">' + ic(ICON.play, '<span aria-hidden="true">▶</span>') + ' ' + esc(T.vAgain || '') + '</button>';
  }
  function openRewatch(doc, v, T, onClose) {
    var ov = doc.createElement('div');
    ov.className = 'wq-zoomed wq-vagain'; ov.setAttribute('role', 'dialog');
    var vid = doc.createElement('video');
    vid.setAttribute('controls', ''); vid.setAttribute('playsinline', ''); vid.setAttribute('src', v.url);
    if (v.poster) vid.setAttribute('poster', v.poster);
    var x = doc.createElement('button');
    x.className = 'wq-icon wq-zclose'; x.setAttribute('aria-label', T.close || 'Close'); x.innerHTML = '✕';
    var done = false;
    x.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (done) return; done = true;
      try { vid.pause(); } catch (err) {}
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (onClose) onClose();
    });
    ov.appendChild(vid); ov.appendChild(x);
    doc.body.appendChild(ov);
    try { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (err) {}
    return ov;
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
  return { kind: kind, grade: grade, tex: tex, latDir: latDir, say: say, cleanSvg: cleanSvg, figureHtml: figureHtml, itemHtml: itemHtml, readParts: readParts,
    rightText: rightText, joinSay: joinSay, letters: letters, imageUrls: imageUrls, wire: wire, optClip: optClip, rewatchHtml: rewatchHtml, openRewatch: openRewatch, mark: mark, wireZoom: wireZoom, speakable: speakable, SHAPES: SHAPES, SPK: SPK, ICON: ICON, ic: ic, TEX_SUPPORTED: TEX_SUPPORTED };
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
  // The always-visible Home button (app_settings web_quiz_home_button) and the step-back navigation
  // (web_quiz_back_nav): the server says which are on in the payload's `nav`; absent = today's page.
  var NAVF = B.nav || {};
  var HOME_ON = Boolean(NAVF.home), BACK_ON = Boolean(NAVF.back);
  var N = QS.length;
  var CODE = B.code || Q.code || '';
  // ui_lang (web_quiz_class_doors: the class table and league; web_quiz_page_lang: the quiz page): the link's language, set
  // by the edge; else the quiz's.
  var LANG = B.ui_lang === 'ur' || B.ui_lang === 'en' ? B.ui_lang : Q.lang === 'ur' ? 'ur' : 'en';
  // ...and when that is not the quiz's, Play opens the quiz page itself, in the quiz's own language.
  var UI_SWAP = LANG !== (Q.lang === 'ur' ? 'ur' : 'en');
  // a video lesson's Urdu-script name (the bot's topic_ur, web_quiz_videos_ur_titles): an Urdu page names the quiz with it
  if (LANG === 'ur' && typeof Q.topic_ur === 'string' && Q.topic_ur) Q.topic = Q.topic_ur;
  // ...and so does a "My scores" row of one (the server's topic_ur)
  function topicOf(x) { return (LANG === 'ur' && x.topic_ur) || x.topic; }
  var CLS = B.cls || {};
  var LIVE = B.live || {};
  // The deployment's brand (boot JSON, from bot/shared/config/web-quiz-brand.js): marks, names, mascot, place.
  var BR = B.brand || null;
  var MASC = (BR && BR.mascot) || { en: 'Jugnu', ur: 'جگنو' };
  var PLACE = (BR && BR.place) || null;
  var params = (function () { var o = {}; try { new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); } catch (e) {} return o; })();

  var IC = WQI.ICON, ic = WQI.ic;
  /* ---------------- copy (en + ur). Jugnu speaks one short line per screen. ---------------- */
  var T = {
    en: {
      quiz: 'QUIZ', from: function (t, c) { return [t ? 'From ' + t : '', c].filter(Boolean).join(' · '); },
      meta: function (n) { var m = Math.max(1, Math.round(n * 0.6)); return n + (n === 1 ? ' question' : ' questions') + ' · about ' + m + (m === 1 ? ' minute' : ' minutes'); },
      hello: 'Assalam o Alaikum! Let\'s play the quiz together.', helloN: function (n) { return 'Welcome back, ' + n + '!'; },
      play: 'Play', playAs: function (n) { return 'Play as ' + n; }, notMe: function (n) { return 'Not ' + n + '?'; }, nextTurn: "Someone else's turn",
      proof: function (n) { var kids = n === 1 ? ' child' : ' children'; return n.toLocaleString('en') + kids + (PLACE ? ' in ' + PLACE.en : '') + ' played today'; },
      classToday: function (n) { return n + ' in your class played today'; },
      whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: function (c) { return 'Find your name in ' + c; },
      newKid: "I'm new", newT: 'Hello! What is your first name?', newSay: 'Just your first name.', start: 'Start', privacy: 'Only first names. No phone numbers.',
      isYou: function (n) { return 'Are you ' + n + '?'; }, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", diff: function (n) { return "I'm a different " + n; },
      vT: 'Watch the lesson (optional)', vT3: 'Watch the lesson', vSay: 'Watch first, or go straight in.', skip: 'Go to the questions', watched: 'Done watching',
      how: [['🔊', 'Listen to each question'], ['👆', 'Tap a colour or a picture'], ['🙋', 'Stuck? Help comes']],
      qof: function (i, n) { return 'Question ' + i + ' of ' + n; }, listen: 'Listen again', helpAgain: 'Shall we listen again?', hintAsk: 'Need a hint?', hintNudge: 'Stuck? Tap me for a hint.',
      orderHelp: 'Tap the steps in the right order.', matchHelp: 'Tap one, then tap its partner.', labelHelp: 'Tap the right part of the picture.',
      zoom: 'Make the picture bigger', close: 'Close', vAgain: 'Watch the lesson again', playSound: 'Play the sound', hearOption: 'Hear this one', thisOne: 'This one', yes: 'True', no: 'False',
      notyet: function (lead, r) { return lead + ' "' + String(r).replace(/[.!۔]+\s*$/, '') + '".'; }, next: 'Next', again: 'This one comes back at the end, to fix together.',
      half: 'Halfway there!',
      tricky: function (n) { return n === 1 ? '1 tricky one' : n + ' tricky ones'; }, trickySay: "Before we celebrate, let's fix it together.", fixGo: 'Fix it with ' + MASC.en, later: 'Maybe later',
      second: 'Second try · with ' + MASC.en, tryAgain: 'Look again. You can do it.',
      got: function (s, n) { return 'You got ' + s + ' out of ' + n; }, fixedLine: function (k) { return '+ fixed ' + k + ' tricky one' + (k > 1 ? 's' : '') + ' with ' + MASC.en; },
      scoreNote: 'Your score is your first try.', praise: function (s, n) { return s === n ? 'Brilliant!' : s >= n * 0.8 ? 'Great work!' : 'Good try!'; },
      done: 'QUIZ COMPLETE', seeCard: 'See my card', classBtn: 'See my class',
      prac: 'This name already finished on another phone. This round is practice; your first finished score stays.',
      shareBtn: 'Share to class group', challenge: 'Challenge a friend', cardPriv: 'Only your first name goes on the card.',
      hubDoor: 'My quizzes, videos and challenges',
      // the folded card's Next with nothing ranked: the home's own words (wq-home.js nextPick)
      foldPick: 'Pick a story', sharePlain: 'Share',
      shareLine: function (w, s, n, t) { return w + ' got ' + s + '/' + n + ' stars on ' + t + '. Can you beat it?'; },
      tableLine: function (t, c) { return c + ' league table for ' + t + '. Not played yet? Same link, still open:'; },
      leagueT: function (c) { return c + ' league table'; }, leagueW: 'League table', myClassT: function (c) { return 'Class ' + c; }, onlyClass: function (c) { return 'Only Class ' + c; },
      movedUp: function (n) { return 'You moved up ' + n + (n === 1 ? ' place!' : ' places!'); }, movedNow: function (p) { return 'More friends played. You are at place ' + p + ' now.'; }, samePlace: 'Same place as last time.', you: 'YOU', moreN: function (n) { return n + ' more in the class'; },
      finN: function (n) { return n + ' finished'; }, yourScore: 'Your score', avg: 'Class average', firstOnly: 'First names only. Ties share a place.',
      shareTable: 'Share the class table', noRows: 'Nobody has finished yet. Be the first!', tableNone: 'This table opens for a class quiz.',
      schoolsBtn: 'School league', schoolsT: 'School league', schoolsRule: 'This week · 10 points for playing, up to 10 for your score',
      pts: function (n) { return fmtN(n) + (n === 1 ? ' point' : ' points'); }, kidsN: function (n) { return fmtN(n) + (n === 1 ? ' child played' : ' children played'); },
      yourSchool: 'YOUR SCHOOL', moveNew: 'NEW', schoolPlace: function (s, p) { return s + ' is #' + p + ' this week'; },
      sinceY: function (m) { return (m > 0 ? '▲' : '▼') + Math.abs(m) + ' since yesterday'; },
      added: function (n, s) { return '+' + n + ' points for ' + s + '!'; },
      ghost: function (s) { return 'No one from ' + s + ' has played yet this week. Be the first!'; },
      zeroN: function (n) { return fmtN(n) + (n === 1 ? ' school still to start' : ' schools still to start'); },
      allSchools: 'All', mySector: 'My sector', playFor: function (s) { return 'Play and add points for ' + s; }, playMine: 'Play and add points for your school',
      noSchools: 'No school has played yet this week. Yours can be first!', shareSchools: 'Share the school league', inviteSchool: 'Invite my school to play',
      schoolsLine: function (s, p) { return p ? s + ' is #' + p + ' of all schools this week. Play and help us climb:' : 'No one from ' + s + ' has played yet this week. Be the first:'; },
      histT: 'Your scores', todayT: PLACE ? 'Today in ' + PLACE.en : 'Today', rest: 'Time to rest. See you tomorrow!', todayMore: 'Great work today! Want to watch another video?', back: 'Back', sounds: 'Sounds',
      cont: function (i, n) { return 'Go on: question ' + i + ' of ' + n; }, contSay: function (n) { return 'Welcome back, ' + n + '! Your answers are saved.'; }, restart: 'Start again', months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      fbT: 'Send it on WhatsApp', fbSub: 'Tap the WhatsApp button, then pick the chat.', fbWa: 'Send on WhatsApp', fbCopy: 'Copy the message', copied: 'Message copied', saveArt: 'Save the picture',
      backAgain: 'Your answers are saved. Press back again to leave.',
      homeBtn: 'Home', homeSure: 'Go to your home page? Your answers are saved.', homeSaving: 'Go to your home page? Saving your answers first.',
      goHome: 'Go home', stay: 'Keep playing',
      revSay: function (n) { return 'You are looking at question ' + n + ' again. Your first answer is the one that counts.'; },
      revBack: function (n) { return 'Back to question ' + n; },
      todaySub: 'children played today', myScores: 'My scores',
      sharePlayed: function (w, t) { return w + ' played ' + t + '. Your turn!'; },
      // The challenge asked as "who?" (app_settings web_quiz_invite_ask): the head around an isolated score, the play-at-home
      // head below 60%, the three tiles, and the challenge's own first-person words (the friend sees a parent's number as sender).
      askHead: ['Who can beat your ', '?'], askLow: 'Play it with someone at home',
      whoHome: 'Someone at home', whoCousin: 'A cousin', whoStreet: 'A friend in my street',
      chalLine: function (w, s, n, t) { return w + ' here! I got ' + s + '/' + n + ' stars on ' + t + '. Can you beat me? 🏆 Tap the link to play:'; },
      chalPlayed: function (w, t) { return w + ' here! I played ' + t + '. Your turn! Tap the link to play:'; },
      moreBtn: 'Watch another video', moreT: 'More videos for you', moreSay: 'Pick a video. Its quiz comes right after.',
      moreNone: 'No more videos for your class yet.', vchip: 'Video quiz', nextT: 'Next in this chapter', moreWait: 'Opening the video…', mins: function (n) { return n + ' min'; }, doneTag: 'Done', playAgain: 'Play again',
      selfT: 'This is your own test run. It will not show in your class report.',
      challenged: function (n, s, t) { return n + ' got ' + s + '/' + t + ' stars. Can you beat it?'; }, challengedBy: function (n) { return n + ' challenged you. Can you beat their score?'; },
      vs: { win: 'You beat the challenge!', tie: "It's a tie!", lose: 'So close! Play again?' }, vsYou: 'You', frOut: { win: 'beat you!', tie: 'tie', lose: 'you won' },
      offWait: 'Your results will reach your teacher when you are back online.', offDone: 'All done! Your answers are saved on this phone.', tryNow: 'Send now',
      offline: 'No internet right now. Your answers are saved on this phone.', tooFew: 'Answer a few more questions first.', oops: 'Something went wrong. Please try again.',
      friends: 'Friends who finished', home: 'Home', yourClass: 'Your class', check: 'Check', pickAll: 'Tap every right answer, then Check.', previewPlay: 'Try it as a child',
      pulse: function (f, n) { return (f || 'A friend') + ' got Q' + n + ' right'; },
      liveNow: function (n) { return n + ' classmates are playing right now — join them!'; },
      // how many children of the class finished today (the child's own finish counts them all); never a place, and
      // never a count under 5 ("2 children" tells a child exactly one classmate finished): 1–4 say the one-finisher line
      nth: function (n) {
        if (n < 5) return 'You finished this quiz today!';
        return ['', '<bdi>' + n + '</bdi>', ' children in your class finished this quiz today.'];
      }
    },
    ur: {
      quiz: 'کوئز', from: function (t, c) { return [t ? t + ' کی طرف سے' : '', c ? String(c).replace(/ /g, '\u00A0') : ''].filter(Boolean).join(' · '); },
      meta: function (n) { return urDigits(n) + ' سوال · تقریباً ' + urDigits(Math.max(1, Math.round(n * 0.6))) + ' منٹ'; },
      hello: 'السلام علیکم! آئیں، کوئز کھیلیں۔', helloN: function (n) { return n + '، خوش آمدید!'; },
      play: 'کھیلیں', playAs: function (n) { return n + '، شروع کریں'; }, notMe: function (n) { return n + ' نہیں؟'; }, nextTurn: 'کسی اور کی باری',
      proof: function (n) { return 'آج ' + (PLACE ? PLACE.ur + ' میں ' : '') + urDigits(n.toLocaleString('en')) + (n === 1 ? ' بچے نے کھیلا' : ' بچوں نے کھیلا'); },
      classToday: function (n) { return 'آج آپ کی کلاس میں ' + urDigits(n) + ' نے کھیلا'; },
      whoT: 'آج کس کی باری ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', onPhone: 'اس فون پر', inClass: function (c) { return c + ' میں اپنا نام ڈھونڈیں'; },
      newKid: 'نیا نام', newT: 'السلام علیکم! آپ کا پہلا نام کیا ہے؟', newSay: 'صرف پہلا نام لکھیں۔', start: 'شروع کریں', privacy: 'صرف پہلا نام۔ فون نمبر نہیں۔',
      isYou: function (n) { return 'کیا آپ ' + n + ' ہیں؟'; }, isYouSub: 'ہاں صرف تب دبائیں جب یہ آپ کا اپنا نام ہو۔', yesMe: 'جی ہاں، یہ میں ہوں', diff: function (n) { return 'میں کوئی اور ' + n + ' ہوں'; },
      vT: 'سبق دیکھیں (اختیاری)', vT3: 'سبق دیکھیں', vSay: 'پہلے دیکھیں، یا سیدھا سوالوں پر چلیں۔', skip: 'سوالوں پر چلیں', watched: 'دیکھ لیا',
      how: [['🔊', 'ہر سوال سنیں'], ['👆', 'رنگ یا تصویر پر ٹیپ کریں'], ['🙋', 'مشکل ہو تو مدد ملے گی']],
      qof: function (i, n) { return 'سوال ' + urDigits(i) + ' از ' + urDigits(n); }, listen: 'دوبارہ سنیں', helpAgain: 'کیا دوبارہ سنیں؟', hintAsk: 'اشارہ چاہیے؟', hintNudge: 'مشکل لگ رہا ہے؟ اشارے کے لیے مجھے دبائیں۔',
      orderHelp: 'قدموں کو صحیح ترتیب سے ٹیپ کریں۔', matchHelp: 'ایک پر ٹیپ کریں، پھر اس کے جوڑے پر۔', labelHelp: 'تصویر میں صحیح حصے پر ٹیپ کریں۔',
      zoom: 'تصویر بڑی کریں', close: 'بند کریں', vAgain: 'سبق کی ویڈیو دوبارہ دیکھیں', playSound: 'آواز سنیں', hearOption: 'یہ سنیں', thisOne: 'یہ والا', yes: 'درست', no: 'غلط',
      notyet: function (lead, r) { return lead + ' ' + String(r).replace(/[.!۔]+\s*$/, ''); }, next: 'اگلا', again: 'یہ سوال آخر میں دوبارہ آئے گا، مل کر ٹھیک کرنے کے لیے۔',
      half: 'آدھا راستہ طے!',
      tricky: function (n) { return urDigits(n) + ' مشکل سوال'; }, trickySay: 'جشن سے پہلے، آئیں اسے مل کر ٹھیک کریں۔', fixGo: MASC.ur + ' کے ساتھ ٹھیک کریں', later: 'بعد میں',
      second: 'دوسری کوشش · ' + MASC.ur + ' کے ساتھ', tryAgain: 'دوبارہ کوشش کریں!',
      got: function (s, n) { return 'آپ نے ' + urDigits(n) + ' میں سے ' + urDigits(s) + (s === 1 ? ' درست کیا' : ' درست کیے'); }, fixedLine: function (k) { return MASC.ur + ' کے ساتھ ' + urDigits(k) + ' مشکل سوال ٹھیک کیے'; },
      scoreNote: 'اسکور پہلی کوشش کا ہے۔', praise: function (s, n) { return s === n ? 'زبردست!' : s >= n * 0.8 ? 'بہت خوب!' : 'اچھی کوشش!'; },
      done: 'کوئز مکمل', seeCard: 'میرا کارڈ دیکھیں', classBtn: 'اپنی کلاس دیکھیں',
      prac: 'یہ نام کسی اور فون پر مکمل ہو چکا ہے۔ یہ باری مشق ہے؛ پہلا مکمل اسکور ہی رہے گا۔',
      shareBtn: 'کلاس گروپ میں بھیجیں', challenge: 'دوست کو چیلنج کریں', cardPriv: 'کارڈ پر صرف آپ کا پہلا نام جاتا ہے۔',
      hubDoor: 'میرے کوئز، ویڈیوز اور چیلنج',
      foldPick: 'کہانی چنیں', sharePlain: 'شیئر کریں',
      shareLine: function (w, s, n, t) { return w + ' نے ' + t + ' میں ' + n + ' میں سے ' + s + ' ستارے لیے۔ کیا اس سے زیادہ ستارے ملیں گے؟'; },
      tableLine: function (t, c) { return t + ': ' + c + ' کی لیگ ٹیبل۔ ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے:'; },
      leagueT: function (c) { return c + ' کی لیگ ٹیبل'; }, leagueW: 'لیگ ٹیبل', myClassT: function (c) { return 'کلاس ' + c; }, onlyClass: function (c) { return 'صرف کلاس ' + c; },
      movedUp: function (n) { return 'آپ اب ' + urDigits(n) + (n === 1 ? ' درجہ' : ' درجے') + ' اوپر ہیں!'; }, movedNow: function (p) { return 'کچھ اور دوستوں نے بھی کھیلا۔ اب آپ ' + urDigits(p) + ' نمبر پر ہیں۔'; }, samePlace: 'آپ پچھلی بار والی جگہ پر ہیں۔', you: 'آپ', moreN: function (n) { return 'کلاس میں ' + urDigits(n) + ' اور'; },
      finN: function (n) { return urDigits(n) + ' نے مکمل کیا'; }, yourScore: 'آپ کا اسکور', avg: 'کلاس کی اوسط', firstOnly: 'صرف پہلے نام۔ برابر اسکور والوں کا نمبر ایک ہے۔',
      shareTable: 'کلاس ٹیبل بھیجیں', noRows: 'ابھی کسی نے مکمل نہیں کیا۔ سب سے پہلے کھیلیں!', tableNone: 'کلاس ٹیبل صرف کلاس کے کوئز میں ہوتی ہے۔',
      schoolsBtn: 'اسکولوں کی لیگ', schoolsT: 'اسکولوں کی لیگ', schoolsRule: 'اس ہفتے · کھیلنے کے ۱۰ پوائنٹس، اسکور کے ۱۰ تک',
      pts: function (n) { return urDigits(fmtN(n)) + ' پوائنٹس'; }, kidsN: function (n) { return urDigits(fmtN(n)) + (n === 1 ? ' بچے نے کھیلا' : ' بچوں نے کھیلا'); },
      yourSchool: 'آپ کا اسکول', moveNew: 'نیا', schoolPlace: function (s, p) { return s + ' اس ہفتے نمبر ' + urDigits(p) + ' پر'; },
      sinceY: function (m) { return 'کل سے ' + urDigits(Math.abs(m)) + (m > 0 ? ' درجے اوپر' : ' درجے نیچے'); },
      added: function (n, s) { return s + ' کے لیے ' + urDigits(n) + '+ پوائنٹس!'; },
      ghost: function (s) { return 'اس ہفتے ' + s + ' سے ابھی کسی نے نہیں کھیلا۔ سب سے پہلے کھیلیں!'; },
      zeroN: function (n) { return urDigits(fmtN(n)) + ' اسکول ابھی شروع نہیں ہوئے'; },
      allSchools: 'سب', mySector: 'میرا سیکٹر', playFor: function (s) { return 'کھیلیں اور ' + s + ' کے پوائنٹس بڑھائیں'; }, playMine: 'کھیلیں اور اپنے اسکول کے پوائنٹس بڑھائیں',
      noSchools: 'اس ہفتے ابھی کسی اسکول نے نہیں کھیلا۔ آپ کا اسکول پہلا ہو سکتا ہے!', shareSchools: 'اسکول لیگ بھیجیں', inviteSchool: 'اسکول کو کھیلنے کی دعوت دیں',
      schoolsLine: function (s, p) { return p ? s + ' اس ہفتے سب اسکولوں میں نمبر ' + p + ' پر ہے۔ کھیلیں اور اسے اوپر لے جائیں:' : 'اس ہفتے ' + s + ' سے ابھی کسی نے نہیں کھیلا۔ سب سے پہلے کھیلیں:'; },
      histT: 'آپ کے اسکور', todayT: PLACE ? 'آج ' + PLACE.ur + ' میں' : 'آج', rest: 'اب آرام کا وقت۔ کل پھر ملاقات ہوگی!', todayMore: 'آج بہت اچھا کام کیا! ایک اور ویڈیو دیکھیں؟', back: 'واپس', sounds: 'آوازیں',
      cont: function (i, n) { return 'جاری رکھیں: سوال ' + urDigits(i) + ' از ' + urDigits(n); }, contSay: function (n) { return n + '، خوش آمدید! آپ کے جواب محفوظ ہیں۔'; }, restart: 'نئے سرے سے شروع کریں', months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
      fbT: 'واٹس ایپ پر بھیجیں', fbSub: 'واٹس ایپ والا بٹن دبائیں، پھر چیٹ چنیں۔', fbWa: 'واٹس ایپ پر بھیجیں', fbCopy: 'پیغام کاپی کریں', copied: 'پیغام کاپی ہو گیا', saveArt: 'تصویر محفوظ کریں',
      backAgain: 'آپ کے جواب محفوظ ہیں۔ باہر جانے کے لیے دوبارہ بیک دبائیں۔',
      homeBtn: 'ہوم', homeSure: 'ہوم پیج پر جائیں؟ آپ کے جواب محفوظ ہیں۔', homeSaving: 'ہوم پیج پر جائیں؟ پہلے آپ کے جواب محفوظ کیے جا رہے ہیں۔',
      goHome: 'ہوم پر جائیں', stay: 'کھیلتے رہیں',
      revSay: function (n) { return 'آپ سوال \u2066' + urDigits(n) + '\u2069 دوبارہ دیکھ رہے ہیں۔ پہلا جواب ہی گنا جاتا ہے۔'; },
      revBack: function (n) { return 'سوال \u2066' + urDigits(n) + '\u2069 پر واپس'; },
      todaySub: 'بچوں نے کھیلا', myScores: 'میرے اسکور',
      sharePlayed: function (w, t) { return w + ' نے ' + t + ' کھیلا۔ اب آپ کی باری!'; },
      askHead: ['', ' سے آگے نکلنے کا چیلنج کسے دیں؟'], askLow: 'گھر میں کسی کے ساتھ کھیلیں',
      whoHome: 'گھر میں کوئی', whoCousin: 'کزن', whoStreet: 'محلے کا دوست',
      // Urdu prose: Urdu digits; the first name (either script) and the topic sit in first-strong isolates.
      chalLine: function (w, s, n, t) { return 'میں \u2068' + w + '\u2069 ہوں! میں نے \u2068' + t + '\u2069 کوئز میں ' + urDigits(n) + ' میں سے ' + urDigits(s) + ' ستارے لیے۔ مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک پر ٹیپ کریں:'; },
      chalPlayed: function (w, t) { return 'میں \u2068' + w + '\u2069 ہوں! میں نے \u2068' + t + '\u2069 کوئز کھیلا۔ اب آپ کی باری! کھیلنے کے لیے لنک پر ٹیپ کریں:'; },
      moreBtn: 'ایک اور ویڈیو دیکھیں', moreT: 'آپ کے لیے مزید ویڈیوز', moreSay: 'ایک ویڈیو چنیں۔ اس کے بعد اس کا کوئز آئے گا۔',
      moreNone: 'ابھی آپ کی کلاس کے لیے اور ویڈیوز نہیں ہیں۔', vchip: 'ویڈیو کوئز', nextT: 'اسی باب کی اگلی ویڈیو', moreWait: 'ویڈیو کھل رہی ہے…', mins: function (n) { return urDigits(n) + ' منٹ'; }, doneTag: 'مکمل', playAgain: 'دوبارہ کھیلیں',
      selfT: 'یہ آپ کا اپنا ٹیسٹ رن ہے۔ یہ کلاس رپورٹ میں شامل نہیں ہوگا۔',
      challenged: function (n, s, t) { return n + ' نے ' + urDigits(t) + ' میں سے ' + urDigits(s) + ' ستارے لیے۔ اب آپ کی باری!'; }, challengedBy: function (n) { return n + ' نے آپ کو چیلنج کیا ہے۔ اب آپ کی باری!'; },
      vs: { win: 'آپ نے چیلنج جیت لیا!', tie: 'مقابلہ برابر رہا!', lose: 'تھوڑی سی کمی رہ گئی! دوبارہ کھیلیں؟' }, vsYou: 'آپ', frOut: { win: 'آپ سے آگے!', tie: 'برابر', lose: 'آپ کی جیت' },
      offWait: 'انٹرنیٹ واپس آتے ہی آپ کا نتیجہ ٹیچر تک پہنچ جائے گا۔', offDone: 'سب ہو گیا! آپ کے جواب اس فون پر محفوظ ہیں۔', tryNow: 'ابھی بھیجیں',
      offline: 'ابھی انٹرنیٹ نہیں ہے۔ آپ کے جواب اس فون پر محفوظ ہیں۔', tooFew: 'پہلے کچھ اور سوالوں کے جواب دیں۔', oops: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
      friends: 'دوست جنہوں نے مکمل کیا', home: 'پہلا صفحہ', yourClass: 'آپ کی کلاس', check: 'جانچیں', pickAll: 'ہر درست جواب پر ٹیپ کریں، پھر جانچیں۔', previewPlay: 'بچے کی طرح آزمائیں',
      pulse: function (f, n) { return (f ? f : 'ایک دوست') + ' نے سوال ' + urDigits(n) + ' ٹھیک کیا'; },
      liveNow: function (n) { return 'ابھی ' + urDigits(n) + ' ہم جماعت کھیل میں شامل ہیں — آپ بھی آئیں!'; },
      nth: function (n) {
        if (n < 5) return 'آج آپ نے یہ کوئز مکمل کر لیا۔';
        return ['آج آپ کی کلاس میں ', '<bdi>' + urDigits(n) + '</bdi>', ' بچوں نے یہ کوئز مکمل کیا۔'];
      }
    }
  }[LANG];
  // The corrected Urdu share words (app_settings web_quiz_ur_share_copy → the payload's `ur_share`): «بھیجیں» for Share,
  // no masculine form aimed at the child, «دبائیں» for tap. The polished copy below keeps its own lines on top. Off: today's T.
  if (LANG === 'ur' && B.ur_share === true) {
    T = Object.assign({}, T, {
      sharePlain: 'دوستوں کو بھیجیں',
      shareLine: function (w, s, n, t) { return '\u2068' + w + '\u2069 نے \u2068' + t + '\u2069 میں ' + urDigits(n) + ' میں سے ' + urDigits(s) + ' ستارے لیے۔ اب آپ کھیلیں اور اس سے زیادہ ستارے لیں!'; },
      tableLine: function (t, c) { return t + ': ' + c + ' کی لیگ ٹیبل۔ آپ نے ابھی تک نہیں کھیلا؟ یہی لنک ابھی بھی کھلا ہے، آئیں کھیلیں:'; },
      whoStreet: 'محلے میں کوئی دوست',
      chalLine: function (w, s, n, t) { return 'میں \u2068' + w + '\u2069 ہوں! میں نے \u2068' + t + '\u2069 کوئز میں ' + urDigits(n) + ' میں سے ' + urDigits(s) + ' ستارے لیے۔ مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک دبائیں:'; },
      chalPlayed: function (w, t) { return 'میں \u2068' + w + '\u2069 ہوں! میں نے \u2068' + t + '\u2069 کوئز کھیلا۔ اب آپ کی باری! کھیلنے کے لیے لنک دبائیں:'; }
    });
  }
  // The polished Urdu copy (app_settings web_quiz_ur_polish → the edge's `wq-ur2` class on <html>): a child's words, shorter
  // lines, Urdu digits isolated left to right, one word for "done". Off, T is today's map, untouched.
  var UR2 = LANG === 'ur' && (function () { try { return document.documentElement.classList.contains('wq-ur2'); } catch (e) { return false; } })();
  if (UR2) {
    T = Object.assign({}, T, {
      from: function (t, c) { return [t ? t + ' کی طرف سے' : '', c ? String(c).replace(/ /g, ' ') : ''].filter(Boolean).join('\n'); },
      meta: function (n) { return '⁦' + urDigits(n) + '⁩ سوال، ⁦' + urDigits(Math.max(1, Math.round(n * 0.6))) + '⁩ منٹ'; },
      hello: 'السلام علیکم! کوئز کھیلیں؟',
      whoSay: 'اپنا نام دبائیں۔', newT: 'آپ کا نام کیا ہے؟', newSay: 'صرف پہلا نام۔', privacy: 'فون نمبر نہیں لگے گا۔',
      isYouSub: 'یہ آپ ہیں تو «ہاں» دبائیں۔', yesMe: 'ہاں، یہ میں ہوں',
      vSay: 'پہلے دیکھیں، یا سوال شروع کریں۔',
      how: [['🔊', 'ہر سوال سنیں'], ['👆', 'رنگ یا تصویر دبائیں'], ['🙋', 'مشکل ہو تو مدد ملے گی']],
      qof: function (i, n) { return '⁦' + urDigits(n) + '⁩ میں سے سوال ⁦' + urDigits(i) + '⁩'; },
      hintNudge: 'مشکل ہے؟ مجھے دبائیں۔',
      orderHelp: 'ترتیب سے دبائیں: پہلا، دوسرا…', matchHelp: 'ایک دبائیں، پھر اس کا جوڑا۔', labelHelp: 'تصویر میں صحیح جگہ دبائیں۔',
      again: 'یہ سوال آخر میں پھر آئے گا۔',
      trickySay: 'آئیں، اسے مل کر ٹھیک کریں۔',
      prac: 'یہ نام پہلے کھیل چکا ہے۔ یہ باری مشق ہے۔ پہلا اسکور ہی گنا جائے گا۔',
      cardPriv: 'کارڈ پر صرف آپ کا نام ہے۔', hubDoor: 'میرے کوئز اور ویڈیوز',
      firstOnly: 'صرف پہلے نام۔ برابر اسکور والوں کا نمبر ایک ہے۔', noRows: 'ابھی کسی نے مکمل نہیں کیا۔ آپ پہلے بنیں!',
      rest: 'اب آرام کریں۔ کل پھر ملیں گے!', todayMore: 'شاباش! ایک اور ویڈیو دیکھیں؟',
      contSay: function (n) { return n + '، واپس آ گئے! جواب محفوظ ہیں۔'; },
      cont: function (i, n) { return 'جاری رکھیں: ⁦' + urDigits(n) + '⁩ میں سے سوال ⁦' + urDigits(i) + '⁩'; },
      fbSub: 'واٹس ایپ دبائیں، پھر گروپ چنیں۔',
      backAgain: 'جواب محفوظ ہیں۔ باہر جانا ہے تو پھر بیک دبائیں۔',
      homeSure: 'ہوم پر جائیں؟ جواب محفوظ ہیں۔', homeSaving: 'ہوم پر جائیں؟ جواب محفوظ ہو رہے ہیں…',
      revSay: function (n) { return 'سوال ⁦' + urDigits(n) + '⁩ دوبارہ۔ پہلا جواب ہی گنا جائے گا۔'; },
      offWait: 'انٹرنیٹ آتے ہی نتیجہ ٹیچر کو مل جائے گا۔', offline: 'انٹرنیٹ نہیں ہے۔ جواب اس فون پر محفوظ ہیں۔',
      pickAll: 'ہر صحیح جواب دبائیں، پھر «جانچیں»۔',
      liveNow: function (n) { return 'ابھی ⁦' + urDigits(n) + '⁩ ساتھی کھیل رہے ہیں!'; },
      moreSay: 'ایک ویڈیو چنیں۔ پھر اس کا کوئز کھیلیں۔', moreNone: 'ابھی اور ویڈیوز نہیں ہیں۔',
      selfT: 'یہ آپ کی آزمائش ہے۔ کلاس رپورٹ میں نہیں جائے گی۔',
      vs: { win: 'آپ نے چیلنج جیت لیا!', tie: 'مقابلہ برابر رہا!', lose: 'تھوڑا سا رہ گیا! پھر کھیلیں؟' },
      ghost: function (s) { return s + ' سے ابھی کسی نے نہیں کھیلا۔ آپ پہلے بنیں!'; },
      noSchools: 'ابھی کسی اسکول نے نہیں کھیلا۔ آپ کا اسکول پہلا بنے!',
      // lists join with «،»: in Nastaliq a «·» reads as the zero «۰»
      schoolsRule: 'اس ہفتے، کھیلنے کے ۱۰ پوائنٹس، اسکور کے ۱۰ تک', second: 'دوسری کوشش، ' + MASC.ur + ' کے ساتھ',
      // the league's counts: Urdu digits, five digits up split with «٬» (urCount)
      pts: function (n) { return urCount(n) + ' پوائنٹس'; }, kidsN: function (n) { return urCount(n) + (n === 1 ? ' بچے نے کھیلا' : ' بچوں نے کھیلا'); },
      zeroN: function (n) { return urCount(n) + ' اسکول ابھی شروع نہیں ہوئے'; },
      // the WhatsApp share prose: Western digits, isolated, the approved sentence shape kept
      chalLine: function (w, s, n, t) { return 'میں ⁨' + w + '⁩ ہوں! میں نے ⁨' + t + '⁩ کوئز میں ⁦' + n + '⁩ میں سے ⁦' + s + '⁩ ستارے لیے۔ مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک دبائیں:'; },
      chalPlayed: function (w, t) { return 'میں ⁨' + w + '⁩ ہوں! میں نے ⁨' + t + '⁩ کوئز کھیلا۔ اب آپ کی باری! کھیلنے کے لیے لنک دبائیں:'; }
    });
  }

  // ui_lang ur on an English quiz's class table or league (web_quiz_class_doors): the class label in the page's own Urdu
  // word and digits ("Classes 2, 3" -> "کلاس ۲، ۳"); a lettered class ("3-B") keeps the teacher's letters.
  function urClassLabel(l) {
    // "Class 5" / "Classes 2, 3" and an Urdu quiz's stored «جماعت 5»: one name for a class on every screen, «کلاس ۵»
    // (the class table's), Urdu digits
    var m = /^(?:Class(?:es)?|جماعت|کلاس)\s*(.+)$/.exec(String(l));
    return m ? 'کلاس ' + m[1].split(/\s*[,،]\s*/).map(function (c) { return /^\d+$/.test(c) ? urDigits(c) : c; }).join('، ') : l;
  }
  // in Urdu words and digits for an English quiz on an Urdu page, and on any Urdu page with the polish (the doors' rule)
  var CLASS_LABEL = CLS.label ? ((UI_SWAP && LANG === 'ur') || UR2 ? urClassLabel(CLS.label) : CLS.label) : T.yourClass;
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var STAR = '<svg class="wq-star{on}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  var IMG = '/wq/jugnu/';

  // Urdu digits (U+06F0–06F9) for a number inside Urdu prose.
  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); }

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
  if (window.WQJ && WQJ.muted()) SOUND = false; // the kit (web_quiz_juice): one sound switch with the home's key

  /* ---------------- analytics (E8) ---------------- */
  var evq = [];
  var IAB = /WhatsApp|FBAN|FBAV|Instagram|; wv\)/.test(navigator.userAgent || '') ? 1 : 0;
  function ev(n, props) {
    var e = { t: Date.now(), code: CODE, lang: LANG };
    if (props) for (var k in props) if (props[k] !== undefined) e[k] = props[k];
    if (n === 'error' && e.src === undefined) e.src = 'h'; // a failure the page caught itself
    // The invite-ask arm, on the events its measures read (the ask rate, the cancels, the class share and the door).
    if ((n === 'card_view' || n === 'share_click' || n === 'hub_door_tap') && e.v === undefined) { var arm = askArm(); if (arm) e.v = arm; }
    e.n = n;
    // Page-session telemetry on (wq-tel.js): the event joins that page session's queue.
    if (window.WQT && window.WQT.push(e)) return;
    evq.push(e);
    if (evq.length >= 10) flushEv();
  }
  function flushEv(beacon) {
    if (window.WQT && window.WQT.on) window.WQT.flush(beacon);
    if (!evq.length) return;
    // The hub token and the chip when the Jugnu card set them (wq-card.js, events v2): on the body, never an event.
    var body = { events: evq.splice(0, 20) }, x = window.WQT && window.WQT.batchIds ? window.WQT.batchIds() : {}, k;
    for (k in x) body[k] = x[k];
    // The Jugnu card's events (finish's jugnu_ev): this quiz's session and this phone's device ref on the body too, so
    // the server can key the card's door lines to the child without the page-session telemetry (wq-tel.js).
    if (S.result && S.result.jugnu_ev) {
      if (body.st == null && typeof S.st === 'string') body.st = S.st;
      var dref = sget('wq_d', null);
      if (body.dr == null && typeof dref === 'string' && dref) body.dr = dref;
    }
    body = JSON.stringify(body);
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/wq/e', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) {}
    try { fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  setInterval(function () { flushEv(false); }, 5000);
  window.addEventListener('pagehide', function () { flushQueue(true); flushEv(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushEv(true); } });
  // Which script broke, by file name only: one of ours ('wq.js'), 'page' for the page's own inline script,
  // 'other' for a script that is not ours (a browser or app can inject one). Never the URL.
  function errFile(u) {
    u = String(u || '');
    if (!u) return undefined;
    var own = u.indexOf(location.origin + '/') === 0;
    var b = u.split(/[?#]/)[0].split('/').pop().toLowerCase();
    return !own ? 'other' : /^[a-z0-9_.-]{1,37}\.js$/.test(b) ? b : 'page';
  }
  // An Error's first stack frame with a position: its file, line and column.
  function errAt(r) {
    var m = /(https?:\/\/[^\s()]+?):(\d+):(\d+)/.exec(String((r && r.stack) || ''));
    return m ? { file: errFile(m[1]), line: +m[2], col: +m[3] } : {};
  }
  window.addEventListener('error', function (e) {
    e = e || {};
    ev('error', { err: String(e.message || 'error').slice(0, 200), src: 'win', file: errFile(e.filename), line: e.lineno || undefined, col: e.colno || undefined });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason, at = errAt(r), msg;
    // A non-Error reason says what it is by its type ("[object Event]"); a string reason's text is never sent (it may be a name).
    try { msg = r && r.message ? String(r.message) : typeof r === 'string' ? 'string_rejection' : r == null ? 'rejection' : Object.prototype.toString.call(r); } catch (x) { msg = 'rejection'; }
    ev('error', { err: msg.slice(0, 200), src: 'rej', file: at.file, line: at.line, col: at.col });
  });

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
    flushP = api('POST', 'answers', { st: S.st, a: batch, since: PULSE.since }).then(function (r) {
      if (r.ok) {
        pulseFeed(r.body.pulse);
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

  /* ---------------- M17 peer pulse: "Sara got Q4 right ✓" ----------------
     Classmates' right answers on this class code (bot web-quiz-pulse.js), fed by the /answers response
     and, while a child sits on one question, a light poll (every 15 s after 15 s, at most 8 per question,
     only while the tab is visible). One quiet line under the progress bar: never over the options or the
     listen button, never in the first 3 s of a question, at most one per 20 s, gone after 2.5 s, no sound.
     Off for grades 1-2 (they follow the voice and the pictures; a moving name competes with it), in the
     teacher's preview, and when the page is quiet (🔕). An invited friend is "A friend", never a name. */
  var PULSE = { since: 0, shown: 0, qid: null, qAt: 0, pend: null, held: null, wt: 0, poll: 0, polls: 0 };
  // Early years are off: a grade that does not carry a number of at least 3 (NURSERY, KG, PG, 1, 2, a band
  // starting 1 or 2). Only a grade that is missing altogether counts as unknown, and that is on. An invited
  // friend is not in the class: never on.
  function pulseOn() {
    var raw = Q.grade == null ? '' : String(Q.grade).trim();
    var m = /(\d+)/.exec(raw);
    var grown = !raw || (m && parseInt(m[1], 10) >= 3);
    var friend = Boolean(B.challenge || (CLS.identity && CLS.identity.invited));
    return !B.preview && SOUND && grown && !friend;
  }
  function pulseFeed(list) {
    if (!list || !list.length) return;
    list.forEach(function (e) { if (e && e.at > PULSE.since) PULSE.since = e.at; });
    if (!pulseOn()) return;
    PULSE.pend = { e: list[0], n: list.length, got: Date.now() };
    pulseTry();
  }
  function pulseTry() {
    var p = PULSE.pend;
    if (!p) return;
    var now = Date.now();
    if (!PULSE.qid || !/^M[67]$/.test(ROOT.getAttribute('data-m') || '') || now - p.got > 30000 || !pulseOn()) { PULSE.pend = null; return; }
    var wait = Math.max(PULSE.qAt + 3000, PULSE.shown ? PULSE.shown + 20000 : 0) - now;
    if (wait > 0) { if (PULSE.wt) clearTimeout(PULSE.wt); PULSE.wt = setTimeout(pulseTry, wait); return; }
    PULSE.pend = null;
    // The count travels as `i`: ev() keeps `n` for the event's own name.
    if (pulseShow(p.e)) { PULSE.shown = now; ev('pulse_shown', { i: p.n }); }
    // It would have covered content (a tall question scrolled to "Next"): keep it for the top of the next question.
    else PULSE.held = p;
  }
  // Under the bar's "Question n of N" line; when the page is scrolled so that the strip would touch an
  // option or the listen button, it is skipped rather than drawn over them.
  function pulseShow(e) {
    var top = null;
    try {
      var bar = $('.wq-bar').getBoundingClientRect();
      if (bar.bottom < 0) return false;
      top = Math.max(0, Math.round(bar.bottom) + 2);
      var hit = ['.wq-opt', '#wq-spk', '.wq-item'].some(function (sel) {
        var el = $(sel); if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.height > 0 && r.top < top + 28 && r.bottom > top;
      });
      if (hit) return false;
    } catch (x) {}
    var t = document.createElement('div');
    t.className = 'wq-pulse';
    t.setAttribute('aria-hidden', 'true');
    var pl = T.pulse(e.invited ? null : e.first, e.qn);
    if (window.WQJ) t.innerHTML = esc(pl) + ' ' + IC.check; else t.textContent = pl + ' ✓';
    if (top != null) t.style.top = top + 'px';
    ROOT.appendChild(t);
    // Fixed, so a scroll would slide it over the stem or the options: it goes at the first scroll.
    function gone() { t.hidden = true; if (t.parentNode) t.parentNode.removeChild(t); try { window.removeEventListener('scroll', gone); } catch (x) {} }
    try { window.addEventListener('scroll', gone, { passive: true }); } catch (x) {}
    setTimeout(gone, 2500);
    return true;
  }
  function pulseStop() { if (PULSE.poll) clearInterval(PULSE.poll); PULSE.poll = 0; }
  function pulseQuestion(q, at) {
    PULSE.qid = q.qid; PULSE.qAt = at; PULSE.polls = 0;
    pulseStop();
    if (!pulseOn()) return;
    // A pulse held back because it would have covered the last question: shown 3 s into this one (if under 60 s old).
    var h = PULSE.held; PULSE.held = null;
    if (h && at - h.got <= 60000 && !PULSE.pend) { PULSE.pend = { e: h.e, n: h.n, got: at }; pulseTry(); }
    PULSE.poll = setInterval(function () {
      if (PULSE.qid !== q.qid || S.answers[q.qid] || ROOT.getAttribute('data-m') !== 'M6' || PULSE.polls >= 8 || !S.st) { pulseStop(); return; }
      if (document.visibilityState !== 'visible') return;
      PULSE.polls += 1;
      api('GET', 'pulse/' + CODE + '?st=' + encodeURIComponent(S.st) + '&since=' + PULSE.since)
        .then(function (r) { if (r.ok) pulseFeed(r.body.pulse); }, function () {});
    }, 15000);
  }
  /* ---------------- end peer pulse ---------------- */

  /* ---------------- the shared feedback voice ----------------
     Lines recorded ONCE for every quiz (public/wq/voice/<lang>/<set>-<i>.mp3, manifest.json beside them,
     its `voices` naming the voice: the quiz's ONE voice per language, bot/shared/services/quiz/
     web-quiz-voice.js, the same voice as every per-quiz clip). VOICE_V is the hash of the recorded
     files (a test holds it), so a re-record reaches every phone. The words here are
     exactly the recorded words (a test holds them to manifest.json); one is picked at random per
     answer, never the same one twice in a row. Urdu addresses the child only with imperatives or
     noun phrases; a not-yet line never praises. */
  var VOICE_V = 'b39e82a9';
  var VOICE = {"en": {"right": ["Yes! That's right!", "You got it!", "Correct! Well spotted.", "Yes! That's the one.", "Right answer! Good thinking.", "Yes! You checked carefully.", "That's it! Well done.", "Spot on!", "Yes! Keep it up.", "Brilliant, that's right!"], "notyet": ["Not yet. The answer is", "Not quite. The right answer is", "Not this one. The answer is", "Let's learn it together. The answer is", "That one was tricky. The answer is", "Not this time. The right answer is", "Hmm, not yet. The answer is", "No problem, let's see. The answer is"], "fixed": ["Fixed it!", "Now you've got it!", "Yes! That's it now.", "You worked it out!", "Second try, and it's right!", "That's the one!", "Now it's right. Well done!", "Yes! Fixed it."], "done": ["Quiz complete! Every question done.", "All done! Thank you for playing.", "You finished the whole quiz!", "The end! Let's see your stars.", "That was the last one. All done!", "Finished! Well played.", "Quiz complete! Let's look at your stars.", "Every question answered. Well done!"], "cheer": ["Halfway there! Keep going.", "Keep going!", "Take your time and listen carefully.", "On to the next one!", "Half the quiz done!", "Every question teaches something new.", "Let's keep going!", "Half the questions done!"], "notyetpic": ["Not yet. Look, this one is right."], "tftrue": ["Not yet. This sentence is true."], "tffalse": ["Not yet. This sentence is false."], "fig": ["Look at the bars.", "Look at the number line.", "Look at the clock.", "Look at the money.", "Look at the shape.", "Look at the graph.", "Look at the steps.", "Look at the timeline.", "Look at the picture and the word.", "Look at the picture."]}, "ur": {"right": ["شاباش! بالکل صحیح!", "جی ہاں! یہی صحیح جواب ہے۔", "واہ! بالکل ٹھیک۔", "زبردست! صحیح جواب۔", "بہت خوب! یہی تو ہے۔", "صحیح! غور سے دیکھنا کام آیا۔", "جی ہاں! بہت عمدہ جواب۔", "کمال! بالکل درست۔", "ہاں! یہی ہے صحیح جواب۔", "شاباش! ایسے ہی آگے چلیں۔"], "notyet": ["ابھی نہیں۔ صحیح جواب ہے:", "یہ والا نہیں۔ صحیح جواب ہے:", "کوئی بات نہیں۔ صحیح جواب ہے:", "آئیں مل کر سیکھیں۔ صحیح جواب ہے:", "یہ سوال مشکل تھا۔ صحیح جواب ہے:", "اس بار نہیں۔ صحیح جواب ہے:", "ابھی نہیں۔ آئیں دیکھیں، صحیح جواب ہے:", "کوشش سے ہی سیکھتے ہیں۔ صحیح جواب ہے:"], "fixed": ["ٹھیک ہو گیا!", "اب بالکل صحیح!", "جی ہاں! اب ٹھیک ہے۔", "شاباش! دوسری کوشش میں صحیح۔", "زبردست! اب بات سمجھ میں آ گئی۔", "واہ! یہی ہے صحیح جواب۔", "کمال! اب درست ہے۔", "بہت خوب! اب جواب ٹھیک ہے۔"], "done": ["کوئز مکمل! سارے سوال ہو گئے۔", "شاباش! پورا کوئز مکمل۔", "کوئز ختم! چلیں، ستارے دیکھیں۔", "واہ! آخری سوال بھی ہو گیا۔", "مکمل! کھیلنے کا شکریہ۔", "زبردست! پورا کوئز حل ہو گیا۔", "کوئز پورا ہو گیا! بہت خوب۔", "سارے سوال مکمل! شاباش۔"], "cheer": ["آدھا کوئز ہو گیا! چلتے رہیں۔", "آدھا راستہ طے، آگے چلیں!", "ہمت نہ ہاریں، اگلا سوال!", "آرام سے، غور سے سنیں۔", "چلیں، اگلا سوال دیکھیں!", "ہر سوال سے کچھ نیا سیکھیں۔", "ایسے ہی چلتے رہیں!", "آدھے سوال ہو گئے!"], "notyetpic": ["ابھی نہیں۔ دیکھیں، یہ والا صحیح ہے۔"], "tftrue": ["ابھی نہیں۔ یہ بات درست ہے۔"], "tffalse": ["ابھی نہیں۔ یہ بات غلط ہے۔"], "fig": ["پٹیوں کو دیکھیں۔", "عددی لکیر کو دیکھیں۔", "گھڑی کو دیکھیں۔", "پیسوں کو دیکھیں۔", "شکل کو دیکھیں۔", "گراف کو دیکھیں۔", "مراحل کو دیکھیں۔", "وقت کی لکیر کو دیکھیں۔", "تصویر اور لفظ کو دیکھیں۔", "تصویر کو دیکھیں۔"]}};
  var lastPick = {};
  // The shared lines speak the language of the QUESTIONS, not the page: a library quiz is one set of
  // rows in one language, and an English quiz opened from an Urdu class page must not say "not yet"
  // in the Urdu voice and the answer in the English one. The page's own copy stays in LANG.
  var VLANG = (function () {
    // The server names the language the quiz's clips are recorded in (quiz.voice_lang); an English
    // quiz that quotes an Urdu word stays English. The script guess below is only for a page served
    // by a bot that does not send it yet.
    var v = Q && Q.voice_lang;
    if (v === 'en' || v === 'ur') return v;
    var t = (QS || []).map(function (q) { return (q.text || '') + ' ' + ((q.options || [])[0] || {}).text; }).join(' ');
    if (!t.replace(/\s|undefined/g, '')) return LANG;
    return /[\u0600-\u06FF]/.test(t) ? 'ur' : 'en';
  })();
  // One voice per quiz (boot one_voice, app_settings web_quiz_one_voice): a line with no clip is shown, never
  // read in the phone's own voice (a second voice beside the quiz's).
  // The shared lines then come from the set recorded in the plan's voice (boot voice_sets: { <lang>: { path, v } },
  // public/wq/voice/one/<path>/); a language with no set has no shared-line audio (the line is shown).
  var ONE_VOICE = Boolean(B.one_voice);
  // web_quiz_voice_gap_phone (the answer's voice_gap_phone): with one voice on, a part with no recorded clip (or one that
  // cannot play here) is read by the phone's own voice, as before one voice, instead of left silent
  var GAP_PHONE = Boolean(B.voice_gap_phone);
  // web_quiz_voice_gap_slow (the answer's voice_gap_slow, only beside GAP_PHONE): a clip that is there but will not play
  // (its play() aborts, or it has not started at 8 s) is read by the phone's own voice too, instead of left silent
  var GAP_SLOW = GAP_PHONE && Boolean(B.voice_gap_slow);
  var VOICE_SETS = (ONE_VOICE && B.voice_sets) || {};
  function voiceUrl(lang, file) {
    if (!ONE_VOICE) return '/wq/voice/' + lang + '/' + file + '.mp3?v=' + VOICE_V;
    var set = VOICE_SETS[lang];
    return set && set.path && set.v ? '/wq/voice/one/' + set.path + '/' + file + '.mp3?v=' + set.v : null;
  }
  function vline(set) {
    var lang = VOICE[VLANG] ? VLANG : 'en';
    var lines = VOICE[lang][set] || [];
    if (!lines.length) return { text: '', url: null };
    var i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && i === lastPick[set]) i = (i + 1) % lines.length;
    lastPick[set] = i;
    return { text: lines[i], url: voiceUrl(lang, set + '-' + i) };
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
  // GAP_SLOW: a clip not started by 5 s is read by the phone voice (a good clip starts by ~4 s even when just recorded)
  var CLIP_GAP_SLOW_MS = 5000;
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
      var fallback = function (why, err) {
        // A clip stopped by the next screen (a fast tap, slow data) rejects its play() and
        // fires its stalled timer: that is not a missing clip, and its old line stays quiet.
        if (switched || fin || gen !== voiceGen) return;
        switched = true;
        try { if (player) player.pause(); } catch (e) {}
        player = null;
        // GAP_SLOW: a refused start names its error as the events' slug (notallowederror keeps the tap; others are read aloud)
        ev('audio_fallback', GAP_SLOW && why === 'reject' ? { reason: why, err: String((err && err.name) || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'unknown' } : { reason: why });
        var aborted = why === 'reject' && err && err.name === 'AbortError';
        if (why === 'stalled' && !GAP_SLOW) { end(); return; }
        if (why === 'reject' && !(GAP_SLOW && aborted)) { try { ROOT.classList.add('wq-tap'); } catch (e) {} end(); return; }
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
        setTimeout(function () { if (!started) fallback('stalled'); }, GAP_SLOW ? CLIP_GAP_SLOW_MS : CLIP_GIVEUP_MS);
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function (e) { fallback('reject', e); });
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
      // one voice: the words shown big, never the phone's voice; with GAP_PHONE the phone reads the line where it has a
      // voice for the language (a phone with none keeps the big words)
      if (ONE_VOICE && (!GAP_PHONE || !hasVoice())) { try { ROOT.classList.add('wq-novoice'); } catch (e) {} setTimeout(end, 4000); return; }
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { setTimeout(end, 4000); return; }
      // The phone's own voice is a different voice from the quiz's: the speaker button says so (a small phone mark, wq.css).
      try { ROOT.classList.add('wq-phonevoice'); } catch (e) {}
      var u = new SpeechSynthesisUtterance(text);
      u.lang = VLANG === 'ur' ? 'ur-PK' : 'en-US';
      u.rate = 0.9;
      u.onend = end; u.onerror = end;
      speechSynthesis.speak(u);
      setTimeout(end, Math.min(20000, 3000 + text.length * 110));
    } catch (e) { setTimeout(end, 4000); }
  }

  /* ---------------- tiny DOM helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // «واٹس ایپ» held on one line (wq-tel.js WQT.nowrap): escaped HTML in, the same HTML with the word held out.
  function nowrap(h) { return window.WQT && window.WQT.nowrap ? window.WQT.nowrap(h) : h; }
  function $(sel) { return ROOT.querySelector(sel); }
  function on(sel, fn) { var el = $(sel); if (el) el.addEventListener('click', fn); return el; }
  var helpTimer = null;
  function clearTimers() { if (helpTimer) { clearTimeout(helpTimer); helpTimer = null; } }
  function render(html, moment) {
    lateHook = null;
    clearTimers();
    stopVoice();
    try { ROOT.classList.remove('wq-novoice'); ROOT.classList.remove('wq-phonevoice'); ROOT.classList.remove('wq-tap'); } catch (e) {}
    var land = LAND; LAND = '';
    ROOT.innerHTML = '<section class="wq-screen" data-m="' + moment + '"' + (land ? ' data-land="' + land + '"' : '') + '>' + (LANG === 'ur' ? latinRuns(html) : html) + '</section>';
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
  // Home: a class child's own run (a session, not a friend's challenge, not the teacher's preview); the server's door decides the rest.
  function homeOk() { return HOME_ON && Boolean(S.st) && !friendRun() && !B.preview; }
  // The folded card's bar (FOLD_BAR): its one Home is the row under the card, so the bar draws none.
  var FOLD_BAR = '<span class="wq-grow" data-fold></span>';
  function bar(extra, teacher) {
    var home = homeOk() && !teacher && extra !== FOLD_BAR;
    // With Home in the bar the progress dots get their own row under it, so a long quiz still fits at 360 px.
    var dotsRow = home && extra && extra.indexOf('wq-dots') >= 0 ? extra : '';
    return '<div class="wq-bar">' + lockup(teacher) + (dotsRow ? '<span class="wq-grow"></span>' : (extra || '<span class="wq-grow"></span>')) +
      '<button class="wq-icon" id="wq-snd" aria-label="' + esc(T.sounds) + '" aria-pressed="' + SOUND + '">' + (SOUND ? '🔔' : '🔕') + '</button>' +
      (home ? '<button class="wq-home" id="wq-home" type="button" aria-label="' + esc(T.homeBtn) + '"><span aria-hidden="true">🏠</span><span class="wq-homet">' + esc(T.homeBtn) + '</span></button>' : '') +
      '</div>' + (dotsRow ? '<div class="wq-dotrow">' + dotsRow + '</div>' : '');
  }
  // The adventure look (boot adv + <html class="wq-adv">, web_quiz_adventure_look): the lesson video page, the class table
  // and the school league wear the land header of the hub's land screens (wq-doors.js frame) in place of bar(): the round
  // Home, the screen's name on the land's colour, the sound. landBar() names the land; render() puts it on the screen.
  var LAND = '';
  function oneB() { try { return document.documentElement.classList.contains('wq-1b'); } catch (e) { return false; } }
  function advOn() { try { return B.adv === true && document.documentElement.classList.contains('wq-adv'); } catch (e) { return false; } }
  // The hub this tab came from (hub.js keeps its path with the look on): the way home from the class table or the league
  // opened from My class, where the page has no session of its own to ask the hub door with.
  function hubBack() {
    var p = '';
    try { p = String(window.sessionStorage.getItem('wq_hub_at') || ''); } catch (e) {}
    return /^\/h\/[A-Za-z0-9._-]+$/.test(p) ? p : '';
  }
  function landBar(land, title) {
    LAND = land;
    var home = homeOk() || Boolean(hubBack());
    return '<div class="wq-dtop wq-ltop">' + (home ? '<button class="wq-home" id="wq-home" type="button" aria-label="' + esc(T.homeBtn) + '"><span aria-hidden="true">🏠</span><span class="wq-homet">' + esc(T.homeBtn) + '</span></button>' : '') +
      '<h2 dir="auto">' + title + '</h2>' +
      '<button class="wq-icon" id="wq-snd" aria-label="' + esc(T.sounds) + '" aria-pressed="' + SOUND + '">' + (SOUND ? '🔔' : '🔕') + '</button></div>';
  }
  function wireBar() {
    on('#wq-snd', function () {
      SOUND = !SOUND; sset('wq_sound', SOUND);
      this.setAttribute('aria-pressed', SOUND); this.textContent = SOUND ? '🔔' : '🔕';
      if (!SOUND) stopAll(); // silent at once; nothing starts again until the next screen with sound on
    });
    if (window.WQJ) WQJ.skin($('#wq-snd')); // the kit draws this button as SVG (web_quiz_juice)
    on('#wq-home', function () { homeTap(); });
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
  function jv(u) { return window.wqjv ? window.wqjv(u) : u; } // a Jugnu picture with its version (the page's wqjv, web_quiz_brotli on), else as is
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
    return '<span class="wq-jimg" data-jpose="' + pose + '"' + (loop ? ' data-jloop="1"' : '') + '><img src="' + jv(JUG_DIR + pose + '.webp') + '" alt="" width="92" height="92"></span>';
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
      im.src = jv(JUG_DIR + name + '.webp');
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
    v.src = jv(JUG_DIR + name + '.webm');
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
    if (m && !im.getAttribute('data-jold')) { im.setAttribute('data-jold', '1'); im.src = jv(JUG_OLD + m[1] + '.webp'); return; }
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
  function ani(a) { return '<span class="wq-ani">' + (ANIMALS[a] || ic(IC.star, '⭐')) + '</span>'; }
  function fmtN(n) { return Number(n || 0).toLocaleString('en'); }
  // with the Urdu polish a four-digit count prints whole (۲۳۱۵), as school books do; five digits up split with the
  // Arabic «٬» (U+066C), never a Latin comma inside Urdu digits
  function urCount(n) { return urDigits(Math.abs(Number(n || 0)) < 10000 ? String(Number(n || 0)) : fmtN(n).replace(/,/g, '\u066C')); }
  // Joins the non-empty parts with a middle dot, so a missing class label or topic never leaves "NIETE ·".
  // the table's topic line: with the Urdu polish, never a «·» beside Urdu digits (it reads as «۰»), and a Latin title in
  // its own left-to-right piece; else today's "topic · n finished"
  function topicLine(topic, fin) {
    if (!UR2 || !topic) return dotJoin(topic, fin);
    return '<bdi' + (/[\u0600-\u06FF]/.test(topic) ? '' : ' dir="ltr"') + '>' + esc(topic) + '</bdi>، ' + esc(fin);
  }
  // with the Urdu polish a «·» beside an Urdu digit reads as «۰» (1 → 10), so Urdu pages join with «،»
  function sep() { return typeof UR2 !== 'undefined' && UR2 ? '، ' : ' · '; }
  function dotJoin() { return Array.prototype.filter.call(arguments, function (x) { return x != null && String(x) !== ''; }).map(esc).join(sep()); }
  function link(path) { return location.origin + path; }

  /* ---------------- M3 landing ---------------- */
  // the class label on an Urdu page with the Urdu polish (wq-ur2), whatever the quiz's language: in Urdu, as the class
  // table does (urClassLabel). The door's line and the finish card's header.
  function doorLabel() { return CLS.label && typeof UR2 !== 'undefined' && UR2 && typeof urClassLabel === 'function' ? urClassLabel(CLS.label) : CLS.label; }
  // ...and the teacher the same way: "Teacher <name>" (an English quiz's) reads «<name> ٹیچر», as an Urdu quiz's does
  function doorTeacher() { var t = CLS.teacher; return t && typeof UR2 !== 'undefined' && UR2 ? String(t).replace(/^Teacher\s+(.+)$/, '$1 ٹیچر') : t; }
  // the quiz title's dir on the door: an English title on an Urdu page with the look is left to right (WQI.latDir)
  function latT(t) { return typeof WQI !== 'undefined' ? WQI.latDir(t, LANG) : ''; }
  // The invited friend's landing shows the picture their link previewed as (already drawn and cached), so the
  // hand-off from the chat to the page is one picture, not two different things. Gone if it cannot load.
  function chPic(chLine) {
    var id = chLine && B.art && B.art.invite;
    return id ? '<img class="wq-chpic" src="' + esc('/q/' + encodeURIComponent(CODE) + '/art/invite.jpg?a=' + encodeURIComponent(id)) + '" alt="' + esc(chLine) + '">' : '';
  }
  // fold (web_quiz_challenge_fold): the picture sits right under the way in and carries a drawn "tap the link to play",
  // so a tap on it is a tap on Play (or the remembered child's button); with the class's children listed, it shows them
  function wireChPic(fold) {
    var im = ROOT.querySelector && ROOT.querySelector('.wq-chpic');
    if (im && im.addEventListener) im.addEventListener('error', function () { if (im.parentNode) im.parentNode.removeChild(im); });
    if (fold && im && im.addEventListener) {
      im.style.cursor = 'pointer';
      im.addEventListener('click', function () {
        var b = ROOT.querySelector('#wq-play') || ROOT.querySelector('#wq-play-as');
        if (b && b.click) return b.click();
        var k = ROOT.querySelector('.wq-kid');
        if (k && k.scrollIntoView) k.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  // A storybook the teacher sent (wq-story-link.js, loaded only then): the landing names a story.
  if (B.story && window.WQSTORYLINK) T = window.WQSTORYLINK.copy(T, LANG);

  function landing() {
    var here = kids();
    var classChips = {};
    (CLS.chips || []).forEach(function (c) { classChips[c.chip] = 1; });
    var last = here.filter(function (k) { return classChips[k.chip]; })[0] || here[0];
    var ch = B.challenge;
    // The challenger comes from the server (the challenge code), never from a name in the URL.
    // A challenger who scored 0 is never a score to beat (the card shares a zero as "played"): the friend is just challenged.
    var chLine = ch ? (ch.correct > 0 ? T.challenged(ch.first, ch.correct, ch.total) : T.challengedBy(ch.first)) : '';
    if (B.preview && params.p) return teacherLanding();
    // web_quiz_challenge_fold (the answer's challenge_fold): the way in comes right after the challenge line, and the
    // invite picture follows it, so a small phone shows Play on the first screen
    var pic = chPic(chLine), fold = Boolean(B.challenge_fold && pic);
    if (ID && !B.preview) { if (fold) ID.landing(chLine, pic, true); else ID.landing(chLine, pic); wireChPic(fold); return; }
    var h = bar() +
      (B.preview ? '<div class="wq-banner">' + esc(T.selfT) + '</div>' : '') +
      jug('hello', last ? T.helloN(last.first) : T.hello, true, true) +
      '<div class="wq-card wq-stack"><h1' + latT(Q.topic) + '>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(doorTeacher(), doorLabel())) + '</p>' +
      '<p class="wq-small">' + esc(T.meta(N)) + '</p></div>' +
      (fold ? '' : pic) +
      (chLine ? '<div class="wq-banner">' + esc(chLine) + '</div>' : '') +
      (B.preview && params.p ? '<button class="wq-btn wq-go" id="wq-preview">' + esc(T.previewPlay) + '</button><button class="wq-btn wq-navy" id="wq-whoplayed">' + esc(TW.whoBtn) + '</button>' :
      last ? '<button class="wq-btn wq-go" id="wq-play-as">' + esc(T.playAs(last.first)) + '</button><button class="wq-btn wq-ghost" id="wq-notme">' + esc(T.notMe(last.first)) + '</button>'
        : '<button class="wq-btn wq-go" id="wq-play">' + esc(T.play) + '</button>') +
      (fold ? pic : '') +
      (LIVE.ict_today_floor ? '<p class="wq-proof">🌟 ' + esc(T.proof(LIVE.ict_today_floor)) + '</p>' : '') +
      (LIVE.class_today >= 5 && !B.challenge ? '<p class="wq-small">' + esc(T.classToday(LIVE.class_today)) + '</p>' : '') +
      // Classmates with a right answer in the last 2 minutes (a count from the bot's memory); never on a friend's challenge.
      (LIVE.now >= 5 && !ch ? '<p class="wq-proof">' + ic(IC.live, '🟢 ') + esc(T.liveNow(LIVE.now)) + '</p>' : '');
    render(h, 'M3');
    wireBar();
    wireChPic(fold);
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
      '<p class="wq-sub">' + esc(T.from(doorTeacher(), doorLabel())) + '</p>' +
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
      preview: "This is your preview. It isn't saved for your class.",
      newBest: 'New best!', wasBest: 'was',
      tFor: 'For you, the teacher', tLead: 'Your class plays this from the link you forwarded. See who has played, or try it yourself.',
      sumOf: function (p, of) { return p + ' of ' + of + ' played'; }, sumN: function (p) { return p + ' played'; },
      avg: 'Average', hard: function (n, m) { return 'Q' + n + ' was the hardest (' + m + ' missed it)'; },
      notYet: function (n) { return 'Not played yet (' + n + ')'; }, allPlayed: 'Everyone on your class list has played.',
      playedT: function (n) { return 'Played (' + n + ')'; }, setRollLink: 'Set roll',
      // identity v2 (wq-identity.js): name first, a collision asked, never shown
      someone: "My name isn't here", opening: 'Opening your quiz…', nameT: 'What is your name?', nameSay: 'Type the name you are called by in class.',
      nameFull: 'Type your full name.', namePriv: 'Only your name. No phone number.',
      moreFull: function (f, c) { return 'There is more than one ' + f + (c ? ' in ' + c : ' here') + '. What is your full name?'; },
      fatherT: "What is your father's name?", numT: 'What number does your teacher call you by?', numSay: 'The number on the class list.',
      dontKnow: "I don't know",
      nfT: function (t, c) { return "I can't find " + t + (c ? ' in ' + c : '') + '. Is that how your name is written?'; },
      nfYes: "Yes, that's my name", nfFix: 'Let me fix it',
      nsT: function (t, c, n) { return 'There are ' + n + ' children called ' + t + (c ? ' in ' + c : '') + '.'; },
      nsSay: 'Tap Yes to play. Your teacher will check which one you are.',
      // a class link on a phone that holds a child (web_quiz_link_known_child): asked before the name box
      knIs: function (n) { return 'Is it ' + n + '?'; }, knYes: "Yes, that's me", knElse: 'Someone else'
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
      // sep(): «،» with the Urdu polish, else today's «·» (guarded: this table runs in the identity tests' slice)
      practice: function (c, t) { return 'مشق کا راؤنڈ' + (typeof sep === 'function' ? sep() : ' · ') + 'پہلی بار کا اسکور ' + c + '/' + t + ' شمار ہوتا ہے'; },
      preview: 'یہ صرف آپ کے دیکھنے کے لیے تھا۔ آپ کے جوابات کلاس کے ریکارڈ میں محفوظ نہیں کیے گئے۔',
      newBest: 'نیا ریکارڈ!', wasBest: 'پہلے',
      tFor: 'استاد کے لیے', tLead: 'آپ کی کلاس یہ کوئز آپ کے بھیجے ہوئے لنک سے کھیلتی ہے۔ دیکھیں کس نے کھیلا، یا خود آزمائیں۔',
      sumOf: function (p, of) { return of + ' میں سے ' + p + ' نے کھیلا'; }, sumN: function (p) { return p + ' نے کھیلا'; },
      avg: 'اوسط', hard: function (n, m) { return 'سوال ' + n + ' سب سے مشکل رہا (' + m + ' نے غلط کیا)'; },
      notYet: function (n) { return 'ابھی نہیں کھیلا (' + n + ')'; }, allPlayed: 'آپ کی کلاس لسٹ کے سب بچوں نے کھیل لیا۔',
      playedT: function (n) { return 'کھیل لیا (' + n + ')'; }, setRollLink: 'رول نمبر دیں',
      someone: 'میرا نام یہاں نہیں', opening: 'آپ کا کوئز کھل رہا ہے…', nameT: 'آپ کا نام کیا ہے؟', nameSay: 'وہ نام لکھیں جس سے آپ کو کلاس میں پکارا جاتا ہے۔',
      nameFull: 'اپنا پورا نام لکھیں۔', namePriv: 'صرف نام۔ فون نمبر نہیں۔',
      moreFull: function (f, c) { return (c ? c + ' میں' : 'یہاں') + ' ایک سے زیادہ ' + f + ' ہیں۔ آپ کا پورا نام کیا ہے؟'; },
      fatherT: 'آپ کے والد کا نام کیا ہے؟', numT: 'کلاس لسٹ میں آپ کا نمبر کیا ہے؟', numSay: 'جو نمبر کلاس میں پکارا جاتا ہے۔',
      dontKnow: 'مجھے نہیں پتا',
      nfT: function (t, c) { return (c ? c + ' میں ' : '') + t + ' کا نام نہیں ملا۔ کیا آپ کا نام ایسے ہی لکھا جاتا ہے؟'; },
      nfYes: 'جی ہاں، یہی میرا نام ہے', nfFix: 'دوبارہ لکھیں',
      nsT: function (t, c, n) { return (c ? c + ' میں ' : '') + t + ' نام کے ' + n + ' بچے ہیں۔'; },
      nsSay: 'کھیلنے کے لیے جی ہاں دبائیں۔ ٹیچر خود دیکھ لیں گے کہ آپ کون ہیں۔',
      knIs: function (n) { return 'کیا آپ ' + n + ' ہیں؟'; }, knYes: 'جی ہاں، میں ہی ہوں', knElse: 'نہیں، میں کوئی اور ہوں'
    }
  })[LANG === 'ur' ? 'ur' : 'en'];
  // The roll pad and its lists: 0-9, Urdu included. The roll number is matched to the teacher's
  // register, which prints it 0-9.
  function digitsFor(n) { return String(n); }
  // A score or count the child reads on an Urdu screen: Urdu digits; English: as is.
  function scoreN(n) { return LANG === 'ur' ? urDigits(n) : n; }
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
    pick: function () { return CLS_PICK; }, setPick: function (v) { CLS_PICK = v; }, doc: typeof document !== 'undefined' ? document : null,
    lat: latT, doorLabel: doorLabel, doorTeacher: doorTeacher
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
    // The stored session resumes only its own child: another card, a typed name or a roll number never carries it.
    var other = pick.new || pick.roll != null || (pick.chip && !(S.child && S.child.chip === pick.chip));
    if (S.st && !other) body.resume_st = S.st;
    if (CLS_PICK && (pick.roll != null || pick.new)) body.list = CLS_PICK;
    // A new child who came in through a card's door in its language (?lang=): the bot keeps it on them (web_quiz_share_link_lang).
    if (pick.new && (params.lang === 'ur' || params.lang === 'en')) body.door_lang = params.lang;
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
      // A hub link's session that cannot start: the landing asks who is playing (it never asked while starting).
      if (!r.ok) { ev('error', { err: 'session_' + r.status }); toast(r.status === 410 ? T.oops : T.oops); if (pick.from_st || pick.via === 'hub' || pick.via === 'handset' || pick.via === 'known') landing(); return; }
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
      if (B.story && window.WQSTORYLINK) window.WQSTORYLINK.open({ st: S.st, story: B.story, preview: Boolean(B.preview), lang: LANG, T: T, api: api, flushQueue: flushQueue, ev: ev, flushEv: flushEv, toast: toast, landing: landing, withLang: withLang, go: function (u) { location.assign(u); } }); else if (wantsVideo()) video(); else nextQuestion();
    }, function () { busy = false; toast(T.offline); ev('error', { err: 'session_net' }); if (pick.from_st || pick.via === 'hub' || pick.via === 'handset' || pick.via === 'known') landing(); });
  }

  function answeredCount() { var n = 0; QS.forEach(function (q) { if (S.answers[q.qid]) n++; }); return n; }
  // The lesson video plays once per attempt: skipped or watched to the end, a reload goes on to the questions.
  // A lesson's Quiz button on the Videos door (?to=q, web_quiz_video_shelf on) opens straight at the questions.
  function wantsVideo() { return Boolean(B.video && B.video.url && !answeredCount() && !S.vdone && !(B.video_shelf === true && params.to === 'q')); }

  /* ---------------- M5 video (optional) ---------------- */
  // Where the lesson video is, kept every few seconds and whenever it pauses or the page hides.
  function keepVideoAt(vid, now) {
    var t = Math.floor((vid && vid.currentTime) || 0);
    if (!t || S.vdone || t === S.vt) return;
    if (now || !(S.vt > 0) || Math.abs(t - S.vt) >= 3) { S.vt = t; save(); }
  }
  window.addEventListener('pagehide', function () { if (ROOT.getAttribute('data-m') === 'M5') keepVideoAt($('video'), true); });
  // M4b library: Download (the bot names the video only when the library is on).
  function dlOpts() { return { code: CODE, st: S.st, lang: LANG, iab: IAB, on: on, ev: ev }; }
  function vDownload(v) {
    if (!v.vid || typeof WQL === 'undefined') return '';
    return WQL.dlHtml(dlOpts(), { vid: v.vid, mb: v.bytes ? Math.round(v.bytes / 100000) / 10 : null }, true) + WQL.helpHtml(dlOpts());
  }
  function video() {
    var v = B.video;
    // A reload mid-video picks up where it was (#t= is a media fragment; the server never sees it).
    var at = S.vt > 0 ? Math.floor(S.vt) : 0;
    // From the child home's Videos door (?via=videos) with web_quiz_videos_v3 on: the play is the one primary and the
    // heading is not "optional"; "Go to the questions" waits in the secondary style until the video ends. Else today's.
    var door = Boolean(B.videos_v3 && params.via === 'videos');
    var vT = door ? T.vT3 : T.vT;
    // web_quiz_rewatch_done (the answer's rewatch_done): a finished lesson opened again (?again=1) says it is a replay —
    // "Done watching ✓" on the video and "Play again" into the questions. Else today's.
    var rw = B.rewatch_done === true && params.again === '1';
    // The look: the Videos land header, and the questions are the one primary from the start (the video stays a choice).
    var adv = advOn();
    // web_quiz_video_clean_start (the answer's video_clean): the same one play button at 0:00 without the look too
    var clean = adv || B.video_clean === true;
    var h = (adv ? landBar('videos', esc(T.vT3)) + jug('hello', T.vSay) : bar() + jug('hello', T.vSay) + '<h2>' + esc(vT) + '</h2>') +
      // A cover over the box until the first play: a tap anywhere starts the video (the native button
      // is small), and with no poster the child sees Jugnu and a big play button, not a dark box.
      '<div class="wq-vbox">' + (rw ? '<span class="wq-vdone wq-vwatched">' + esc(T.watched) + ' ' + ic(IC.check, '✓') + '</span>' : '') + '<video class="wq-video"' + (clean ? '' : ' controls') + ' playsinline preload="none"' + (v.poster ? ' poster="' + esc(v.poster) + '"' : '') + ' src="' + esc(v.url + (at ? '#t=' + at : '')) + '"></video>' +
      '<button class="wq-vcover' + (v.poster ? ' wq-vposter' : '') + '" type="button"' + (door && !adv ? ' data-primary' : '') + ' aria-label="' + esc(vT) + '">' +
      (v.poster ? '' : '<img src="' + jv(IMG + 'hello.webp') + '" alt="" class="wq-vjug">') + '<span class="wq-vplay" aria-hidden="true">' + ic(IC.play, '▶') + '</span></button></div>' +
      '<ul class="wq-how">' + T.how.map(function (x, k) { return '<li><span>' + ic([WQI.SPK, IC.tap, IC.help][k], x[0]) + '</span>' + esc(x[1]) + '</li>'; }).join('') + '</ul>' +
      (adv ? '<button class="wq-btn wq-go" id="wq-skip" data-primary>' : '<button class="wq-btn ' + (door ? 'wq-soft' : 'wq-go') + '" id="wq-skip">') + esc(rw ? T.playAgain : T.skip) + '</button>' + vDownload(v);
    render(h, 'M5');
    wireBar();
    if (v.vid && typeof WQL !== 'undefined') WQL.wireDl(dlOpts(), [{ vid: v.vid }]);
    var vid = $('video');
    var cover = $('.wq-vcover');
    // the look: the player's own controls come with the first play, so at 0:00 the cover's play is the only one
    if (vid) vid.addEventListener('play', function () { if (cover) cover.hidden = true; if (clean) vid.setAttribute('controls', ''); ev('video_play', at ? { t: at } : {}); });
    if (vid && FROM && FROM.t) {
      var ff = function () { vid.removeEventListener('loadeddata', ff); ev('more_timing', { ff_ms: Date.now() - FROM.t }); FROM.t = 0; };
      vid.addEventListener('loadeddata', ff);
    }
    if (vid) vid.addEventListener('timeupdate', function () { keepVideoAt(vid, false); });
    if (vid) vid.addEventListener('pause', function () { keepVideoAt(vid, true); });
    if (vid) vid.addEventListener('ended', function () {
      S.vdone = 1; S.vt = 0; save(); ev('video_end', {});
      // The door's page: watched to the end, the questions lead again.
      var sk = door && $('#wq-skip');
      if (sk) { sk.className = 'wq-btn wq-go'; sk.setAttribute('data-primary', ''); if (cover) cover.removeAttribute('data-primary'); }
    });
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
    // The results screen's Jugnu too: a child who finishes offline still sees them celebrate.
    if (i === 0) { try { new Image().src = jv(JUG_DIR + 'celebrate.webp'); } catch (e) {} }
    setTimeout(function () {
      warmClips(QS[i + 1]); warmClips(QS[i + 2]);
      var c = navigator.connection || {};
      if (i === 0 && c.effectiveType === '4g' && !c.saveData) QS.forEach(function (q) { warmPics(q); warmClips(q); });
    }, 1500);
  }
  /* Late clips: a quiz's clips are recorded the first time its page is opened (about a minute), so
     that first page booted without them (the server says audio_pending). It asks for the quiz again a
     few times and each question takes its clips as they arrive: the next line spoken is the recorded
     voice, never a silent Urdu quiz (Android has no Urdu phone voice). Every 10 s for three minutes:
     clips land 50-160 s after the first open, and a question read in the gap before the next ask is read
     without a clip that already exists. */
  // late_ms (web_quiz_audio_each_question: each question is written as soon as it is done): ask at that pace, never
  // faster than every 3 s, still for about three minutes.
  var LATE_EVERY_MS = Q.late_ms > 0 ? Math.max(3000, Q.late_ms) : 10000, LATE_TRIES = Math.round(180000 / LATE_EVERY_MS);
  var lateTry = 0;
  var lateHook = null; // the question on screen: re-read in the recorded voice if it was read without it
  function lateClips() {
    if (!Q.audio_pending || lateTry >= LATE_TRIES) return;
    setTimeout(function () {
      lateTry += 1;
      api('GET', 'quiz/' + encodeURIComponent(CODE)).then(function (r) {
        var fresh = (r && r.ok && r.body && r.body.quiz) || null;
        if (fresh) {
          (fresh.questions || []).forEach(function (f) {
            if (!f || !f.audio) return;
            QS.forEach(function (q) { if (q.qid === f.qid) { q.audio = f.audio; delete warmed[q.qid]; } });
          });
          if (!fresh.audio_pending) Q.audio_pending = false;
          if (lateHook) lateHook();
        }
        lateClips();
      }, function () { lateClips(); });
    }, LATE_EVERY_MS);
  }
  lateClips();
  function nextQuestion() {
    for (var i = 0; i < N; i++) if (!S.answers[QS[i].qid]) return question(i, false);
    finishFirstPass();
  }
  function optText(o) { return o.text || ''; }
  // An option that is only a picture (emoji) is never spoken by the phone's voice.
  function speakable(t) { return /[A-Za-z0-9\u0600-\u06FF]/.test(String(t || '')); }
  // The question, then each option: the recorded clip when there is one, else the phone's voice.
  // A figure's pointer ("Look at the bars.") is one of the shared recorded lines (VOICE[lang].fig), matched by its exact
  // words, so the clip always says what is shown; a question's own wording for its figure has no clip (the phone reads it).
  function figClip(text) {
    var t = String(text || '').trim();
    var langs = [VLANG, VLANG === 'ur' ? 'en' : 'ur'];
    for (var k = 0; k < langs.length; k++) {
      var i = ((VOICE[langs[k]] || {}).fig || []).indexOf(t);
      if (i >= 0) return voiceUrl(langs[k], 'fig-' + i);
    }
    return null;
  }
  function readParts(q) {
    return WQI.readParts(q, LANG).map(function (p) { return p.p === 'fig' && !p.url ? { text: p.text, url: figClip(p.text), p: 'fig' } : p; });
  }
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
    return '<button class="wq-jhelp" id="wq-jhelp" aria-label="' + esc(T.hintAsk) + '"><img src="' + jv(IMG + 'thinking.webp') + '" alt="">' +
      '<span id="wq-jhelp-t">' + esc(T.hintAsk) + '</span></button>';
  }
  function question(i, retry) {
    var q = QS[i];
    var shown = Date.now();
    if (!retry) CURQ = i;
    // the look (wq-1b): the second-try label is a chip on its own row under the bar, so it never wraps beside the logo and Home
    var h = (retry && oneB() ? bar() + '<div class="wq-dotrow wq-2nd"><span class="wq-chip">' + esc(T.second) + '</span></div>' : bar(retry ? '<span class="wq-grow wq-qof">' + esc(T.second) + '</span>' : dots(i))) +
      (retry ? '' : qRow(i, T.qof(i + 1, N))) +
      '<div class="wq-item" data-kind="' + WQI.kind(q) + '">' + WQI.itemHtml(q, T, LANG) + '</div>' +
      '<div id="wq-help">' + hintBtn(q) + '</div><div id="wq-hintbox"></div><div id="wq-fb"></div>' + WQI.rewatchHtml(B.video, T);
    render(h, retry ? 'M9-fix' : 'M6');
    wireBar();
    if (!retry) wireQBack(i);
    WQI.wireZoom(ROOT, T);
    if (!retry) ahead(i);
    ev(retry ? 'retry_view' : 'question_view', { qid: q.qid, i: i + 1 });
    if (!retry) pulseQuestion(q, shown); else PULSE.qid = null;

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
        el.innerHTML = '<div class="wq-hint"><img src="' + jv(IMG + 'thinking.webp') + '" alt="">' + esc(T.helpAgain) + '<button class="wq-spk" id="wq-help-spk" aria-label="' + esc(T.listen) + '">' + WQI.SPK + '</button></div>';
        ev('help_shown', { qid: q.qid });
        on('#wq-help-spk', function () { ev('help_used', { qid: q.qid }); read(); });
      }, HELP_AFTER_MS);
    }
    // Help waits until the voice has finished, then gives the child time of their own.
    var readBare = false; // the last reading had no recorded clip (the phone's voice, or silence in Urdu)
    function read() {
      readBare = !(q.audio && q.audio.q);
      var b = $('#wq-spk'); if (b) b.classList.add('wq-speaking');
      speakSeq(readParts(q), function () { var b2 = $('#wq-spk'); if (b2) b2.classList.remove('wq-speaking'); armHelp(); }, q.qid);
    }
    on('#wq-spk', function () { ev('listen', { qid: q.qid }); read(); });
    on('#wq-again', function () {
      stopVoice(); clearTimers();
      ev('video_again', { qid: q.qid });
      WQI.openRewatch(document, B.video, T, function () { ev('video_again_close', { qid: q.qid }); });
    });
    on('#wq-stim', function () { ev('listen', { qid: q.qid, stim: 1 }); var au = q.audio || {}; if (au.stim) speak('', au.stim, null); });
    read();
    // Its clips landed while it is still on screen and unanswered: read it again, once, in the quiz's voice.
    if (!retry) lateHook = function () {
      if (readBare && !hintUsed && !S.answers[q.qid] && q.audio && q.audio.q) { lateHook = null; read(); }
    };

    WQI.wire(ROOT, q, answer, function (url, slot) {
      ev('listen', { qid: q.qid, slot: slot, part: 'opt' });
      var o = (q.options || []).filter(function (x) { return x.slot === slot; })[0];
      speak(o ? WQI.say(o.name || o.text || '', LANG) : '', url, null, { qid: q.qid, part: 'opt' });
    });
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
    if (!window.WQJ) sfx(ok ? 'right' : 'notyet');
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
    var ld = WQI.latDir(line, LANG);
    fb.innerHTML = '<div class="wq-jug">' + jugImg(ok ? 'correct' : 'notyet', loopIt) + '<div class="wq-fb ' + (ok ? 'wq-ok' : 'wq-no') + '">' + (ld ? '<div' + ld + '>' + esc(line) + '</div>' : esc(line)) +
      (why ? '<div class="wq-why"' + WQI.latDir(why, LANG) + '>' + WQI.tex(why) + '</div>' : '') +
      (reason ? '<div class="wq-why"' + WQI.latDir(reason, LANG) + '>' + WQI.tex(reason) + '</div>' : '') +
      (!ok && !retry ? '<div class="wq-why">' + esc(T.again) + '</div>' : '') + '</div></div>' +
      (cheer ? '<p class="wq-proof">🎉 ' + esc(cheer.text) + '</p>' : '') +
      '<button class="wq-btn wq-go" id="wq-next">' + esc(T.next) + '</button>';
    ROOT.setAttribute('data-m', 'M7');
    // The sound + motion kit (web_quiz_juice): its chime or soft bup, the picked option's pop or wobble, the run strip.
    if (window.WQJ) WQJ[ok ? 'correct' : 'wrong']({ el: ROOT.querySelector('.wq-opt[data-slot="' + slot + '"]'), panel: fb, at: ROOT.querySelector('.wq-dotrow') || ROOT.querySelector('.wq-bar') });
    ev('feedback_view', { qid: q.qid, ok: ok ? 1 : 0 });
    var reasonPart = reason && speakable(WQI.say(reason, LANG)) ? [{ text: WQI.say(reason, LANG), url: (q.audio && q.audio.why) || null }] : [];
    // With the kit, a right answer moves on by itself 900 ms after Jugnu has said why; a wrong one waits for the tap.
    speakSeq(feedbackParts(q, ok, lead, why, picked, named).concat(reasonPart, cheer ? [cheer] : []), ok && window.WQJ ? WQJ.autoNext(ROOT, retry ? nextRetry : nextQuestion) : null);
    var nx = $('#wq-next');
    try { nx.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    nx.addEventListener('click', function () {
      if (retry) return nextRetry();
      nextQuestion();
    });
  }

  /* ---------------- Back to the previous question: a read-only review (web_quiz_back_nav) ---------------- */
  // The first answer is the score (one answer per question on the server; finish counts first tries), so a
  // question seen again is shown exactly as it was left — the child's pick, the marks, the reason they already
  // heard — with its options locked. Trying again is the end-of-quiz "fix the tricky ones" pass, as today.
  var CURQ = 0, REVQ = -1;
  function backTarget(i) { return i > 0 ? 'review' : B.video ? 'video' : ''; }
  function qRow(i, text) {
    var to = BACK_ON ? backTarget(i) : '';
    var p = '<p class="wq-qof">' + esc(text) + '</p>';
    return to ? '<div class="wq-qrow"><button class="wq-qback" id="wq-qback" type="button"><span aria-hidden="true">' + (LANG === 'ur' ? '→' : '←') + '</span> ' + esc(T.back) + '</button>' + p + '</div>' : p;
  }
  function stepBack(i, src) {
    var to = backTarget(i);
    stopVoice(); clearTimers();
    ev('back', { src: src, step: to || 'home' });
    if (to === 'review') return review(i - 1);
    if (to === 'video') return video();
    if (homeOk()) return homeSheet(src);
    return nextQuestion();
  }
  function wireQBack(i) { on('#wq-qback', function () { stepBack(i, ROOT.getAttribute('data-m') === 'M6-review' ? 'm6_review' : 'm6'); }); }
  function review(j) {
    var q = QS[j];
    if (!q) return nextQuestion();
    REVQ = j;
    var a = S.answers[q.qid] || {};
    var picked = (q.options || []).filter(function (o) { return o.slot === a.slot; })[0] || {};
    var why = WQI.letters(q, a.ok ? (q.why || q.fb_right || '') : (picked.fb || q.why || ''));
    var nxt = -1;
    for (var k = 0; k < N; k++) if (!S.answers[QS[k].qid]) { nxt = k; break; }
    var h = bar(dots(j)) + qRow(j, T.qof(j + 1, N)) +
      '<div class="wq-revnote" role="note">' + ic(IC.back, '↩') + ' ' + esc(T.revSay(j + 1)) + '</div>' +
      '<div class="wq-item wq-review" data-kind="' + WQI.kind(q) + '">' + WQI.itemHtml(q, T, LANG) + '</div>' +
      (why ? '<div class="wq-fb ' + (a.ok ? 'wq-ok' : 'wq-no') + '"><div class="wq-why"' + WQI.latDir(why, LANG) + '>' + WQI.tex(why) + '</div></div>' : '') +
      '<button class="wq-btn wq-go" id="wq-revnext" type="button">' + esc(nxt >= 0 ? T.revBack(nxt + 1) : T.next) + '</button>';
    render(h, 'M6-review');
    wireBar();
    wireQBack(j);
    WQI.wireZoom(ROOT, T);
    if (a.slot) WQI.mark(ROOT, q, a.slot);
    ev('review_view', { qid: q.qid, i: j + 1 });
    on('#wq-revnext', function () { ev('back', { src: 'm6_review', step: 'return' }); nextQuestion(); });
  }

  /* ---------------- the Home button (web_quiz_home_button) ---------------- */
  // To this child's home (the kid hub) through the results card's door, which now also opens mid-quiz for the
  // child's own run. During play it asks first (a tap, never automatic); what is still unsent goes first, and
  // the sheet never says the answers are saved while one is waiting to be sent.
  var homeGoing = false, SHEET = false;
  function mSrc(m) { return String(m || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'); }
  function dropSheet() {
    SHEET = false;
    var el = document.getElementById('wq-sheet');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function homeTap() {
    var m = ROOT.getAttribute('data-m') || '';
    // the look's header with no session here (the class table from My class): back to the hub this tab came from
    if (!homeOk() && hubBack()) { ev('home_tap', { src: mSrc(m), how: 'hub' }); flushEv(true); location.assign(hubBack() + '?from=home'); return; }
    if (PLAYING[m] || m === 'M6-review') return homeSheet(mSrc(m));
    homeGo(mSrc(m));
  }
  function homeSheet(src) {
    if (SHEET) return;
    SHEET = true;
    ROOT.insertAdjacentHTML('beforeend', '<div class="wq-sheet" id="wq-sheet" role="dialog" aria-modal="true"><div class="wq-sheetbox">' +
      '<p>' + ic(IC.home, '🏠') + ' ' + esc(S.queue && S.queue.length ? T.homeSaving : T.homeSure) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-gohome" type="button">' + esc(T.goHome) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-stay" type="button">' + esc(T.stay) + '</button><!--/wq-sheet--></div></div>');
    on('#wq-gohome', function () { dropSheet(); homeGo(src); });
    on('#wq-stay', function () { dropSheet(); ev('home_tap', { src: src, how: 'stay' }); });
  }
  function homeGo(src, hash) {
    if (homeGoing) return;
    homeGoing = true;
    flushQueue().then(function () { return api('POST', 'hubdoor', { st: S.st, home: 1 }); }).then(function (r) {
      var href = r.ok && r.body && typeof r.body.href === 'string' ? r.body.href : '';
      if (/^\/h\/[A-Za-z0-9._-]+$/.test(href)) {
        ev('home_tap', { src: src, how: 'door' });
        flushQueue(true); flushEv(true);
        location.assign(href + '?from=home' + (hash || ''));
        return;
      }
      homeGoing = false;
      ev('home_tap', { src: src, how: 'no_door' });
      toast(T.oops);
    }, function () { homeGoing = false; ev('home_tap', { src: src, how: 'offline' }); toast(T.offline); });
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
  // A round that does not count (the finish card on, card_v3): a teacher's own run (preview) says it is not saved;
  // "Play again" on this phone (?again=1) or the finish naming this device shows the card's practice line (the kept
  // first score); "another phone" only when it was another phone.
  function pracBanner(res, total) {
    if (res.card_v3 && res.reason === 'preview') return '<div class="wq-banner">' + esc(TW.preview) + '</div>';
    if (!res.card_v3 || (!AGAIN && res.reason !== 'already_finished')) return '<div class="wq-banner">' + esc(T.prac) + '</div>';
    // no kept first score on the card: this round's score is the one shown
    var k = (res.card && res.card.kept) || { correct: (res.score || {}).correct || 0, total: total };
    return '<div class="wq-banner">' + esc(TW.practice(scoreN(k.correct), scoreN(k.total || total))) + '</div>';
  }
  function results(fixed) {
    render(bar() + '<div class="wq-boot"><img src="' + jv(IMG + 'thinking.webp') + '" alt="" width="96"></div>', 'M9-wait');
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
        (res.counted === false ? pracBanner(res, total) : '') +
        '<button class="wq-btn wq-go" id="wq-card"' + (window.WQJ ? ' data-primary' : '') + '>' + esc(T.seeCard) + '</button>' + // the kit (web_quiz_juice): one primary
        // The home on (finish's card_fold): the card is the one way on from here; the videos live on the home. The class
        // table stays with web_quiz_class_doors (finish's class_doors).
        (foldOn(res) ? (classDoors(res) ? '<button class="wq-btn wq-soft" id="wq-class">' + esc(T.classBtn) + '</button>' : '') : (friendRun() ? '' : '<button class="wq-btn ' + (window.WQJ ? 'wq-soft' : 'wq-navy') + '" id="wq-class">' + esc(T.classBtn) + '</button>') + moreBtn());
      render(h, 'M9');
      if (!foldOn(res)) libPrefetch();   // the folded card opens no video list
      wireBar();
      if (window.WQJ) WQJ.finish({ el: ROOT.querySelector('.wq-card'), kind: 'quiz' }); else sfx('done');
      speak(done.text, done.url, null);
      on('#wq-card', card);
      on('#wq-class', board);
      if (foldOn(res) && classDoors(res)) warmBoard();
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

  /* ---------------- share pictures: the bot draws them (web-quiz-art.js) ---------------- */
  // Every shared link previews as its own picture (the edge names it as og:image), so the picture reaches
  // the group even from WhatsApp's own browser, which has no navigator.share. Where the browser CAN share a
  // file, the square picture goes with the message: fetched when the screen opens, because a share must
  // start inside the tap (a wait would lose it).
  var ART = {};
  function artUrl(id, f) {
    var a = ART[id];
    return '/q/' + encodeURIComponent(CODE) + '/art/' + (a ? a.kind : 'card') + '.jpg?a=' + encodeURIComponent(id) + (f ? '&f=' + f : '');
  }
  function warmArt(kind, id) {
    if (!id || ART[id]) return;
    ART[id] = { kind: kind, file: null };
    try { fetch(artUrl(id)).catch(function () {}); } catch (e) { /* the preview draws on first ask */ }
    var files = false;
    try { files = !!(navigator.canShare && typeof File === 'function'); } catch (e) { files = false; }
    if (!files) return;
    fetch(artUrl(id, 'sq')).then(function (r) { return r && r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return;
      var f = new File([b], kind + '.jpg', { type: 'image/jpeg' });
      try { if (navigator.canShare({ files: [f] })) ART[id].file = f; } catch (e) { /* text share */ }
    }).catch(function () {});
  }

  // A picture only a link preview shows (never shared as a file): fetched once so it is drawn before WhatsApp asks.
  function warmPreviewArt(kind, id) {
    if (!id || ART[id]) return;
    ART[id] = { kind: kind, file: null };
    try { fetch(artUrl(id)).catch(function () {}); } catch (e) { /* the preview draws on first ask */ }
  }

  // The sender's WhatsApp builds the link preview before the message goes: a HEAD now teaches the edge each
  // link the card offers (a challenge code is new at finish), so that preview never waits for the whole quiz.
  var WARMED = {};
  function warmLink(url) {
    if (!url || WARMED[url]) return;
    WARMED[url] = 1;
    try { fetch(url, { method: 'HEAD', credentials: 'omit' }).catch(function () {}); } catch (e) { /* the preview asks itself */ }
  }

  /* ---------------- share: the picture as a file -> navigator.share -> wa.me -> copy ---------------- */
  // A share tap's labels: WhatsApp's own browser or not (by its UA marker), what this phone can share with,
  // and, for a challenge, the code the message carries (a code, never a person), so a landing can be tied to it.
  var WA_IAB = /\bWA4A\/|WhatsApp/.test(navigator.userAgent || '') ? 1 : 0;
  function share(text, url, what, art, who) {
    var full = text + ' ' + url;
    var file = art && ART[art] && ART[art].file;
    var to = what === 'challenge' ? /\/q\/([A-Z0-9]{4,12})(?:[/?#]|$)/i.exec(url) : null;
    // `who`: the invite-ask tile tapped, on the tap only (never in the text, never on the friend's side).
    ev('share_click', { src: what, step: 'tap', iab: WA_IAB, cap: file && navigator.share ? 'file' : navigator.share ? 'native' : 'none', to: to ? to[1] : undefined, who: who || undefined });
    if (file && navigator.share) {
      navigator.share({ files: [file], text: full }).then(function () { ev('share_click', { src: what, step: 'file', path: 'file' }); },
        function (e) { if (e && e.name === 'AbortError') ev('share_click', { src: what, step: 'file_cancel' }); else fallback(full, what, text, url, art); });
      return;
    }
    if (navigator.share) {
      navigator.share({ text: text, url: url }).then(function () { ev('share_click', { src: what, step: 'native', path: 'native' }); },
        function (e) { if (e && e.name === 'AbortError') ev('share_click', { src: what, step: 'native_cancel' }); else fallback(full, what, text, url, art); });
      return;
    }
    fallback(full, what, text, url, art);
  }
  // The preview shows the link on its own left-to-right line: inside an Urdu message it would wrap backwards.
  // blank: the finish card's share (web_quiz_card_v3) — WhatsApp opens in a new window, so the child keeps this page.
  function fallback(full, what, text, url, art, blank) {
    var pic = art && ART[art];
    var h = bar() + '<h2>' + nowrap(esc(T.fbT)) + '</h2><p class="wq-sub">' + nowrap(esc(T.fbSub)) + '</p>' +
      (pic ? '<img class="wq-artprev" src="' + esc(artUrl(art)) + '" alt="">' : '') +
      '<div class="wq-card"><p>' + esc(text != null ? text : full) + '</p>' + (url ? '<p class="wq-url" dir="ltr">' + esc(url) + '</p>' : '') + '</div>' +
      '<a class="wq-btn wq-go" id="wq-wa"' + (blank ? ' target="_blank" rel="noopener"' : '') + ' href="https://wa.me/?text=' + encodeURIComponent(full) + '">' + nowrap(esc(T.fbWa)) + '</a>' +
      '<button class="wq-btn wq-soft" id="wq-copy">' + esc(T.fbCopy) + '</button>' +
      (pic ? '<a class="wq-btn wq-soft" id="wq-save" href="' + esc(artUrl(art, 'sq')) + '" download="' + esc(pic.kind + '-' + CODE) + '.jpg">' + esc(T.saveArt) + '</a>' : '') +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    var at = ROOT.getAttribute('data-m');
    var back = at === 'M11' ? board : at === 'M16' ? drawSchools : card;
    NAV.shareBack = back;
    render(h, 'M12-fallback');
    wireBar();
    on('#wq-wa', function () { ev('share_click', { src: what, step: 'wa', path: 'wa' }); });
    on('#wq-save', function () { ev('share_click', { src: what, step: 'save', path: 'save' }); });
    on('#wq-copy', function () {
      function done() { ev('share_click', { src: what, step: 'copy', path: 'copy' }); toast(T.copied); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(full).then(done, legacy); else legacy();
      function legacy() {
        var ta = document.createElement('textarea'); ta.value = full; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
        if (ok) done(); else ev('share_click', { src: what, step: 'copy_failed' });
      }
    });
    on('#wq-back', function () { ev('share_click', { src: what, step: 'fb_back' }); back(); });
  }

  // The one share (web_quiz_share_v4: the quiz payload's or the finish's share_v4): the class table and the league open
  // the finish card's sheet (wq-finish-card.js WQFC.shareArt), their own picture and the same words and link. Off, or
  // the sheet's script not here yet: today's share above.
  function oneShare() { return B.share_v4 === true || Boolean(S.result && S.result.share_v4 === true); }
  function needSheet() { if (oneShare() && !window.WQFC) loadFC(); }
  function shareScreen(text, url, what, art) {
    if (!oneShare() || !window.WQFC || typeof window.WQFC.shareArt !== 'function') { share(text, url, what, art); return; }
    var a = art && ART[art];
    window.WQFC.shareArt({ lang: LANG, src: what, img: art ? artUrl(art) : '', save: art ? artUrl(art, 'sq') : '', file: (a && a.file) || null, text: text, url: url, ev: ev });
  }

  /* ---------------- M10 scorecard ---------------- */
  // "6 children in your class finished this quiz today.": the copy's text escaped, the number isolated (<bdi>).
  function nthHtml(n) {
    var t = T.nth(Number(n));
    return typeof t === 'string' ? esc(t) : esc(t[0]) + t[1] + esc(t[2]);
  }
  function card() {
    var res = S.result || {};
    var c = res.card || {};
    var total = c.total || N;
    // A practice round: say so, and share the kept first-try score the class league shows.
    var kept = c.practice && c.kept ? c.kept : null;
    var shareC = kept ? kept.correct : c.correct, shareT = kept ? (kept.total || total) : total;
    // A video quiz (item 18a): the same card, said to be one, with "Watch more" first; and the bot's
    // next video of this chapter (finish's `next`), when it names one, between the score and the shares.
    var isVideo = Boolean(B.video && B.video.url);
    var nx = res.next && res.next.vid && res.next.title ? res.next : null;
    // A friend who played a challenge is not in the challenger's class: no class table, no class group.
    var friend = friendRun();
    var shareBtn = friend ? '' : '<button class="wq-btn wq-go" id="wq-share">' + esc(T.shareBtn) + '</button>';
    // The door to this child's own hub (their quizzes, the video library, the challenge), when finish offered it:
    // the second action, right under "Share to class group".
    var doorBtn = res.hub_door && !friend && !(S.queue && S.queue.length) ? '<button class="wq-btn wq-soft" id="wq-hubdoor">' + esc(T.hubDoor) + '</button>' : '';
    // The home on: the card and one next thing (before the Jugnu card, whose file is then never asked for).
    if (foldOn(res)) return foldCard(res, c, total, res.card_v3 && window.WQFC ? window.WQFC : null);
    // The Jugnu card (wq-card.js, sent only when finish offers it): first under the score, above the shares.
    var jc = res.jugnu_card && !friend ? jugnuCard() : '';
    // The finish card (wq-finish-card.js, finish's card_v3): the deed above the score, the Next tile, the class share.
    var fc = res.card_v3 && !friend && window.WQFC ? window.WQFC : null;
    // With the door, a class child's first screen is the score, "Share to class group" and the door (a 360x740 phone,
    // Urdu included): the practice note and the two-line place-in-class note come after them. A video quiz card keeps its own order
    // ("Next in this chapter", "Watch more" first).
    var firstTwo = Boolean(doorBtn) && !isVideo;
    // The invite ask: the panel right under "Share to class group", in place of "Challenge a friend".
    var panel = askArm() === 'a1' ? askPanel(shareC, shareT) : '';
    var shares = (firstTwo ? '' : shareBtn + panel + doorBtn) +
      (panel ? '' : '<button class="wq-btn wq-navy" id="wq-chal">' + esc(T.challenge) + '</button>') +
      (friend ? '' : '<button class="wq-btn wq-soft" id="wq-class">' + esc(T.classBtn) + '</button>') +
      '<button class="wq-btn wq-soft" id="wq-schools">' + ic(IC.school, '🏫') + ' ' + esc(T.schoolsBtn) + '</button>';
    // done_today: this child's counted finish today, the class too small for a count (the server sends none under 5)
    var place = c.nth || c.done_today ? '<p class="wq-proof wq-nth"><span>' + nthHtml(c.nth || 1) + '</span></p>' : '';
    // The practice note is framing, not a control: on a door card it goes under the door with the place note.
    var practice = (kept ? '<div class="wq-banner">' + esc(TW.practice(scoreN(kept.correct), scoreN(shareT))) + '</div>' : '');
    var notes = (firstTwo ? '' : practice) +
      vsStrip(res.vs, c, total) + newBest(c, total) +
      (firstTwo ? '' : place) +
      (nx ? '<button class="wq-vitem wq-nextv" id="wq-next-v">' +
        (nx.poster ? '<img class="wq-vtile" src="' + esc(nx.poster) + '" alt="" loading="lazy">' : '<span class="wq-vtile wq-vt1" aria-hidden="true">' + ic(IC.play, '▶') + '</span>') +
        '<span class="wq-vtext"><small>' + esc(T.nextT) + '</small><b dir="auto">' + esc(nx.title) + '</b></span></button>' : '') +
      // The name notice is for the share it sits on: always directly above "Share to class group".
      '<p class="wq-small wq-center">' + esc(T.cardPriv) + '</p>';
    var h = bar() +
      '<div class="wq-scorecard' + (panel ? ' wq-askon' : '') + '"><header>' + markHtml() + dotJoin(BR ? BR.name : '', doorLabel()) + '</header><div class="wq-in">' +
      '<img src="' + jv(IMG + 'celebrate.webp') + '" alt="">' +
      (isVideo ? '<span class="wq-vchip">' + esc(T.vchip) + '</span>' : '') +
      '<div class="wq-name">' + ani(c.animal) + ' ' + esc(c.first || (S.child && S.child.first) || '') + '</div>' +
      // the topic: one line on a short phone (wq.css), the whole topic is on the quiz itself
      '<p class="wq-sub wq-ctopic">' + esc(Q.topic) + '</p>' +
      (fc ? fc.quizDeedHtml(LANG) : '') + '<div class="wq-big">' + esc(scoreN(c.correct)) + '/' + esc(scoreN(total)) + '</div>' + stars(c.stars != null ? c.stars : c.correct, total) +
      '<div class="wq-praise">' + esc(T.praise(c.correct, total)) + '</div></div></div>' +
      jc + (fc ? fc.nextHtml(LANG, res.next_offer) : '') + notes + (firstTwo ? shareBtn + panel + doorBtn + practice + place : '') +
      (isVideo ? moreBtn() + shares : shares + moreBtn()) +
      // One phone, many children: the next child starts from the landing. Not while answers wait to be sent.
      (S.queue && S.queue.length ? '' : '<button class="wq-btn wq-ghost" id="wq-turn">' + esc(T.nextTurn) + '</button>');
    render(h, 'M10');
    libPrefetch();
    wireBar();
    if (jc) window.WQCARD.wire(jcCtx());
    // How the child did (the share ask may depend on it) and whether this was a friend's challenge run.
    var pct = res.score && res.score.pct != null ? res.score.pct : (total ? Math.round(100 * (c.correct || 0) / total) : 0);
    // Once per finished session: the card re-renders on Back from the share screen, the class table or the league,
    // and a re-render is not another card (the share rate per card is read off this event).
    if (S.st && sget('wq_cv', null) !== S.st) {
      sset('wq_cv', S.st);
      ev('card_view', { band: pct < 50 ? 'low' : pct < 80 ? 'mid' : 'high', friend: friend ? 1 : 0 });
    }
    if (res.vs && T.vs[res.vs.outcome]) ev('challenge_result', { reason: res.vs.outcome });
    // The challenge code names the challenger on the server: no child's name rides in the link.
    var chalUrl = link('/q/' + (res.challenge_code || CODE));
    // The class group gets the CLASS link: a classmate who joined through a friend's challenge code would
    // count as that child's friend and drop out of the teacher's class report.
    // The card link names its picture (?a=): the group's preview IS the card. Still the CLASS code.
    var art = res.art || {};
    var classUrl = link('/q/' + CODE + (art.card ? '?a=' + encodeURIComponent(art.card) : ''));
    warmArt('card', art.card);
    warmArt('invite', art.invite);
    warmLink(classUrl);
    warmLink(chalUrl);
    // A zero is shared as "played", never as a score for the group to beat.
    // A practice round shares the kept first-try score (shareC/shareT), the one the league shows.
    var line = shareC ? T.shareLine(c.first, shareC, shareT, Q.topic) : T.sharePlayed(c.first, Q.topic);
    if (fc && res.share_v4 !== true) on('#wq-share', fc.quizShareTap(fcOpts(classUrl), function (full) { fallback(full, 'card', full, null, null, true); }));
    // the one share (finish's share_v4): the tap opens the one sheet, the card's picture and its link; with no card,
    // this page's own share (the picture and the class link) is the one that runs
    if (fc && res.share_v4 === true) on('#wq-share', fc.quizShareTap(fcOpts(classUrl, true), function (t, u, late) { if (late) fallback(line + ' ' + classUrl, 'card', line, classUrl, art.card, true); else share(line, classUrl, 'card', art.card); }));
    on('#wq-share', function () { share(line, classUrl, 'card', art.card); });
    on('#wq-chal', function () { share(line, chalUrl, 'challenge', art.invite); });
    // A tile shares the challenge in its own first-person words; the first name is the card's (c.first), never a full name.
    if (panel) {
      ASK_WHO.forEach(function (w) {
        on('#wq-who-' + w[0], function () {
          var chalText = askLow(shareC, shareT) ? T.chalPlayed(c.first, Q.topic) : T.chalLine(c.first, shareC, shareT, Q.topic);
          share(chalText, chalUrl, 'challenge', art.invite, w[0]);
        });
      });
    }
    on('#wq-class', board);
    on('#wq-schools', function () { schools(card); });
    on('#wq-more', moreVideos);
    on('#wq-turn', nextTurn);
    on('#wq-hubdoor', hubDoor);
    on('#wq-next-v', function () {
      ev('next_pick', { src: nx.code ? 'code' : 'start' });
      if (!nx.code) { pickVideo({ vid: nx.vid, title: nx.title }, 0); return; }
      sset('wq_from', { code: nx.code, st: S.st, at: Date.now() });
      flushEv(true);
      location.assign('/q/' + encodeURIComponent(nx.code));
    });
    if (res.card_v3 && !friend) finishCard(classUrl, res.share_v4 === true);
  }
  /* ---------------- the card and one next thing (app_settings web_quiz_home_v3, finish's card_fold) ---------------- */
  // A class child's own card with the home on: the card, the ranked Next tile (the one primary), "Share to class group"
  // as the secondary, one Home row. The doors, the class and the league live on the home; "Challenge a friend" is the
  // slot's invite when it ranks first. Without card_fold the card below is today's.
  function foldOn(res) { return Boolean(res && res.card_fold) && Boolean(S.st) && !friendRun() && !B.preview; }
  // The class table and the school league on the folded card and results (app_settings web_quiz_class_doors, finish's
  // class_doors): a class child's own run only, never a child with no class.
  // TODO(one button system): the two buttons are today's wq-soft; the sweep swaps the class.
  function classDoors(res) { return Boolean(res && res.class_doors) && res.no_class !== true && !friendRun(); }
  // The slot's offer, or the next of its alternatives, that opens on this site (an invite's WhatsApp message never).
  function foldOffer(nx) {
    var all = nx && typeof nx === 'object' ? [nx].concat(Array.isArray(nx.alts) ? nx.alts : []) : [];
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      if (x && typeof x.href === 'string' && /^\/[^/]/.test(x.href) && ((LANG === 'ur' && x.title_ur) || x.title)) return x;
    }
    return null;
  }
  // Its tile: the finish card's own when it can draw it, else this page's; with nothing to open, the home's own last
  // Next: "Pick a story".
  function foldNext(nx, fc) {
    var tile = fc && nx ? fc.nextHtml(LANG, nx, true) : '';
    if (tile) return tile;
    if (nx) return '<a class="wq-btn wq-go wq-fnext" id="wq-fnext" data-primary href="' + esc(nx.href) + '">' + esc((LANG === 'ur' && nx.title_ur) || nx.title) + '</a>';
    return '<button class="wq-btn wq-go wq-fnext" id="wq-fnext" data-primary>' + esc(T.foldPick) + '</button>';
  }
  function foldCard(res, c, total, fc) {
    var nx = foldOffer(res.next_offer);
    var kept = c.practice && c.kept ? c.kept : null;
    var shareC = kept ? kept.correct : c.correct, shareT = kept ? (kept.total || total) : total;
    var tile = foldNext(nx, fc);
    var h = bar(FOLD_BAR) +
      '<div class="wq-scorecard"><header>' + markHtml() + dotJoin(BR ? BR.name : '', doorLabel()) + '</header><div class="wq-in">' +
      '<img src="' + jv(IMG + 'celebrate.webp') + '" alt="">' +
      '<div class="wq-name">' + ani(c.animal) + ' ' + esc(c.first || (S.child && S.child.first) || '') + '</div>' +
      '<p class="wq-sub wq-ctopic">' + esc(Q.topic) + '</p>' +
      (fc ? fc.quizDeedHtml(LANG) : '') + '<div class="wq-big">' + esc(scoreN(c.correct)) + '/' + esc(scoreN(total)) + '</div>' + stars(c.stars != null ? c.stars : c.correct, total) +
      '<div class="wq-praise">' + esc(T.praise(c.correct, total)) + '</div></div></div>' +
      (kept ? '<div class="wq-banner">' + esc(TW.practice(scoreN(kept.correct), scoreN(shareT))) + '</div>' : '') + newBest(c, total) +
      tile +
      '<p class="wq-small wq-center">' + esc(T.cardPriv) + '</p>' +
      '<button class="wq-btn wq-soft" id="wq-share">' + esc(res.no_class === true ? T.sharePlain : T.shareBtn) + '</button>' +
      (classDoors(res) ? '<button class="wq-btn wq-soft" id="wq-class">' + esc(T.classBtn) + '</button>' +
        '<button class="wq-btn wq-soft" id="wq-schools">' + ic(IC.school, '🏫') + ' ' + esc(T.schoolsBtn) + '</button>' : '') +
      // the one share (finish's share_v4): "Challenge a friend" is back on the card, its own link and picture
      (res.share_v4 === true ? '<button class="wq-btn wq-navy" id="wq-chal">' + esc(T.challenge) + '</button>' : '') +
      '<button class="wq-btn wq-ghost" id="wq-fhome" data-home>' + esc(T.homeBtn) + '</button>';
    render(h, 'M10');
    wireBar();
    // a tap while offline (the quiz's offline_guard): the card's Next waits for the connection (wq-finish-card.js)
    if (B.offline_guard === true && fc && fc.og) fc.og(LANG);
    var pct = res.score && res.score.pct != null ? res.score.pct : (total ? Math.round(100 * (c.correct || 0) / total) : 0);
    if (S.st && sget('wq_cv', null) !== S.st) {
      sset('wq_cv', S.st);
      ev('card_view', { band: pct < 50 ? 'low' : pct < 80 ? 'mid' : 'high', friend: 0, fold: 1 });
    }
    var art = res.art || {};
    var classUrl = link('/q/' + CODE + (art.card ? '?a=' + encodeURIComponent(art.card) : ''));
    warmArt('card', art.card);
    warmLink(classUrl);
    var line = shareC ? T.shareLine(c.first, shareC, shareT, Q.topic) : T.sharePlayed(c.first, Q.topic);
    if (fc && res.share_v4 !== true) on('#wq-share', fc.quizShareTap(fcOpts(classUrl), function (full) { fallback(full, 'card', full, null, null, true); }));
    // the one share (finish's share_v4): the tap opens the one sheet, the card's picture and its link; with no card,
    // this page's own share (the picture and the class link) is the one that runs
    if (fc && res.share_v4 === true) on('#wq-share', fc.quizShareTap(fcOpts(classUrl, true), function (t, u, late) { if (late) fallback(line + ' ' + classUrl, 'card', line, classUrl, art.card, true); else share(line, classUrl, 'card', art.card); }));
    on('#wq-share', function () { share(line, classUrl, 'card', art.card); });
    if (res.share_v4 === true) {
      var chalUrl = link('/q/' + (res.challenge_code || CODE));
      warmArt('invite', art.invite);
      warmLink(chalUrl);
      on('#wq-chal', function () { share(line, chalUrl, 'challenge', art.invite); });
    }
    on('#wq-fhome', function () { homeGo('card'); });
    on('#wq-class', board);
    if (classDoors(res)) warmBoard();
    on('#wq-schools', function () { schools(card); });
    // No answer from the slot: the home, on its Stories door (the home's own Next when it has nothing ranked).
    if (!nx) on('#wq-fnext', function () { homeGo('card', '#stories'); });
    else {
      var pick = function () { ev('next_pick', { src: 'fold', kind: String(nx.kind || '').replace(/[^a-z0-9_]/g, '').slice(0, 32) }); flushEv(true); };
      on('#wq-fnext', pick);
      on('#wqfc-next', pick);   // the finish card's own tile, when it drew it
    }
    if (res.card_v3) finishCard(classUrl, res.share_v4 === true);
  }
  /* ---------------- the finish card (wq-finish-card.js; app_settings web_quiz_card_v3, finish's card_v3) ---------------- */
  // Last in card(): the card's token is asked for as the card opens (the share never waits); the file is asked for
  // only when finish sends card_v3, and the card is drawn again once it loads.
  var fcAsked = false;
  // url: the class link, shared until the card's own link is in (a slow phone taps before it is)
  // v4: the one share (finish's share_v4), so the card minted here is the sheet's
  function fcOpts(url, v4) { var o = { lang: LANG, topic: Q.topic, st: S.st, ev: ev, url: url }; if (v4) o.v4 = true; return o; }
  function finishCard(url, v4) {
    if (window.WQFC) { window.WQFC.primeQuiz(fcOpts(url, v4)); return; }
    loadFC();
  }
  function loadFC() {
    if (fcAsked) return;
    fcAsked = true;
    try {
      var own = document.querySelector && document.querySelector('script[src*="/wq/wq.js"]');
      var v = own && /[?&]v=([A-Za-z0-9_-]+)/.exec(own.getAttribute('src') || '');
      var el = document.createElement('script');
      el.src = '/wq/wq-finish-card.js' + (v ? '?v=' + v[1] : '');
      el.onload = function () { if (window.WQFC && ROOT.getAttribute('data-m') === 'M10') card(); };
      (document.head || document.body).appendChild(el);
    } catch (e) {}
  }
  /* ---------------- the invite ask (app_settings web_quiz_invite_ask) ---------------- */
  // a1 = the "who can beat your score?" panel, a0 = today's button; null = the switch is off, or this is a friend's own
  // run (the panel is for a class child's card). "split": one arm per phone, from its device key (FNV-1a), never per
  // load; a phone with no key yet is a0.
  function askArm() {
    var m = B.invite_ask;
    if (m !== 'on' && m !== 'split') return null;
    if (friendRun()) return null;
    if (m === 'on') return 'a1';
    var d = sget('wq_d', null);
    if (typeof d !== 'string' || !d) return 'a0';
    var h = 2166136261;
    for (var i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    // The top bit: FNV-1a's lowest bit is only the parity of the key's characters.
    return h >>> 31 ? 'a1' : 'a0';
  }
  var ASK_WHO = [['home', ic(IC.home, '🏠'), 'whoHome'], ['cousin', ic(IC.kid, '🧒'), 'whoCousin'], ['street', ic(IC.street, '🏘️'), 'whoStreet']];
  // Below 60% (or nothing right) there is no score to beat: play it with someone at home.
  function askLow(s, n) { return !s || !n || s / n < 0.6; }
  function askPanel(s, n) {
    var head = askLow(s, n) ? ic(IC.home, '🏠') + ' ' + esc(T.askLow) : ic(IC.trophy, '🏆') + ' ' + esc(T.askHead[0]) + '<bdi dir="ltr">' + esc(s + '/' + n) + '</bdi>' + esc(T.askHead[1]);
    return '<div class="wq-ask"><h2>' + head + '</h2><div class="wq-who">' + ASK_WHO.map(function (w) {
      return '<button class="wq-kid" id="wq-who-' + w[0] + '"><span class="wq-ani" aria-hidden="true">' + w[1] + '</span><span>' + esc(T[w[2]]) + '</span></button>';
    }).join('') + '</div></div>';
  }

  // Forgets the finished child's session on THIS page only (their result stays theirs on the server).
  function nextTurn() {
    ev('identity_pick', { src: 'next_turn' });
    S.st = null; S.child = null; S.result = null; S.pending = null; S.fixed = 0;
    S.answers = {}; S.seq = 0; S.wrong = []; S.vt = 0; S.vdone = 0;
    save();
    landing();
  }

  // This page is a friend's challenge (the server says so; a challenge banner implies it).
  function friendRun() { return Boolean(B.invited || B.challenge || (CLS.identity && CLS.identity.invited)); }

  // A practice round that beats the child's best earlier score on this code (finish's card.best).
  function newBest(c, total) {
    var b = c.practice && c.best;
    if (!b || !(b.total > 0) || !(total > 0) || c.correct * b.total <= b.correct * total) return '';
    function sc(x, y) { return '<bdi dir="ltr">' + esc(scoreN(x)) + '/' + esc(scoreN(y)) + '</bdi>'; }
    return '<div class="wq-banner wq-best">' + esc(TW.newBest) + ' ' + sc(c.correct, total) + sep() + esc(TW.wasBest) + ' ' + sc(b.correct, b.total) + ' ' + ic(IC.star, '⭐') + '</div>';
  }

  // A friend's challenge: who won, with both scores (each score isolated so it reads left to right in Urdu).
  function vsStrip(vs, c, total) {
    if (!vs || !T.vs[vs.outcome]) return '';
    function sc(a, b) { return '<bdi dir="ltr">' + esc(scoreN(a)) + '/' + esc(scoreN(b)) + '</bdi>'; }
    return '<div class="wq-banner wq-vs"><b>' + esc(T.vs[vs.outcome]) + '</b><br>' + esc(T.vsYou) + ' ' + sc(c.correct, total) +
      sep() + esc(vs.first) + ' ' + sc(vs.correct, vs.total) + '</div>';
  }

  /* ---------------- M15 watch another video -> its quiz ---------------- */
  // The video bank is by grade: a quiz with no grade has nothing to offer. The list comes from the
  // bot (E11); picking a lesson gets its code (E12) and opens it in the SAME view (the in-app
  // browser has no reliable new tab). Who is playing goes along in this phone's storage, never in
  // the link: the new page starts at once with the session token of the quiz just played.
  var SUBJECT_TILE = { Science: '🔬', Maths: '➗', English: '🔤', Urdu: 'ا', 'Islamic Studies': '🕌', 'General Knowledge': '🌍', Geography: '🗺️', History: '📜' };
  var HANDOVER_MS = 10 * 60 * 1000;
  function moreBtn() { return Q.grade ? '<button class="wq-btn wq-soft wq-more" id="wq-more">' + ic(IC.play, '▶') + ' ' + esc(T.moreBtn) + '</button>' : ''; }
  function vItem(v, i) {
    // Each atom isolated, so "3.2 MB" keeps its Latin order inside an Urdu line.
    var meta = [v.secs ? esc(T.mins(Math.max(1, Math.round(v.secs / 60)))) : '', v.mb ? '<bdi dir="ltr">' + esc(v.mb + ' MB') + '</bdi>' : ''].filter(Boolean).join(sep());
    var pic = v.poster ? '<img class="wq-vtile" src="' + esc(v.poster) + '" alt="" loading="lazy">'
      : '<span class="wq-vtile wq-vt' + (i % 4 + 1) + '" aria-hidden="true">' + (SUBJECT_TILE[v.subject] || ic(IC.play, '▶')) + '</span>';
    return '<li><button class="wq-vitem" data-vid="' + esc(v.vid) + '">' + pic +
      '<span class="wq-vtext"><b dir="auto">' + esc(v.title) + '</b><small>' + meta + '</small></span>' +
      (v.done ? '<span class="wq-vdone">' + esc(T.doneTag) + ' ' + ic(IC.check, '✓') + '</span>' : '') + '</button></li>';
  }
  // M4b library: subjects -> chapters (wq-lib.js) when the bot has it on; else today's list below.
  function moreVideos() {
    if (typeof WQL !== 'undefined' && !WQL.off()) {
      WQL.open({ code: CODE, st: S.st, lang: LANG, iab: IAB, on: on, ev: ev, onPick: pickVideo, onBack: afterResult, fallback: moreList,
        paint: function (h, m) { render(bar() + h, m); wireBar(); } });
      return;
    }
    moreList();
  }
  function libPrefetch() { if (typeof WQL !== 'undefined' && Q.grade) WQL.prefetch({ code: CODE, st: S.st }); }
  function moreList() {
    var from = ROOT.getAttribute('data-m') || '';
    render(bar() + '<div class="wq-boot"><img src="' + jv(IMG + 'thinking.webp') + '" alt="" width="96"></div>', 'M15-wait');
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
      on('#wq-retry', moreList);
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
    var tapAt = Date.now();
    // The class already has this lesson's code (the library says so): no round trip before the page.
    var got = v.code ? Promise.resolve({ ok: true, body: { code: v.code } }) : api('POST', 'videos/start', { code: CODE, st: S.st, vid: v.vid });
    got.then(function (r) {
      if (!r.ok || !r.body || !r.body.code) throw new Error('more_start_' + r.status);
      sset('wq_from', { code: r.body.code, st: S.st, at: Date.now(), t: tapAt });
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

  // The card's door: the server mints this child's hub link for this phone (never a name in it) and the page opens it.
  var hubGoing = false;
  // The pages' one link helper (wq-tel.js WQT.withLang): a hub opened from here opens in this page's language.
  function withLang(h) { return window.WQT && window.WQT.withLang ? window.WQT.withLang(h, LANG) : h; }
  function hubDoor() {
    if (hubGoing) return;
    hubGoing = true;
    api('POST', 'hubdoor', { st: S.st }).then(function (r) {
      var href = r.ok && r.body && typeof r.body.href === 'string' ? r.body.href : '';
      var ok = /^\/h\/[A-Za-z0-9._-]+$/.test(href);
      // One event per tap, with whether a hub opened (the hub counts its own view as src=door).
      ev('hub_door_tap', { ok: ok });
      flushEv(true);
      if (ok) { location.assign(withLang(href + '?from=door')); return; }
      hubGoing = false;
      if (S.result) { S.result.hub_door = false; save(); }
      var b = $('#wq-hubdoor');
      if (b && b.parentNode) b.parentNode.removeChild(b);
      toast(T.oops);
    }, function () { hubGoing = false; ev('hub_door_tap', { ok: false, err: 'net' }); toast(T.offline); });
  }

  /* ---------------- the Jugnu card (wq-card.js; app_settings web_quiz_challenge_card) ---------------- */
  // Its script is asked for the first time finish offers the card; it draws the card again once it arrives.
  var jcAsked = false;
  function jugnuCard() {
    if (window.WQCARD) return window.WQCARD.html(jcCtx());
    if (jcAsked) return '';
    jcAsked = true;
    try {
      var own = document.querySelector && document.querySelector('script[src*="/wq/wq.js"]');
      var v = own && /[?&]v=([A-Za-z0-9_-]+)/.exec(own.getAttribute('src') || '');
      var el = document.createElement('script');
      el.src = '/wq/wq-card.js' + (v ? '?v=' + v[1] : '');
      el.onload = function () { if (window.WQCARD && ROOT.getAttribute('data-m') === 'M10') card(); };
      (document.head || document.body).appendChild(el);
    } catch (e) {}
    return '';
  }
  function jcCtx() {
    return { res: S.result || {}, lang: LANG, mascot: MASC, first: S.child && S.child.first, T: { play: T.play, oops: T.oops, offline: T.offline },
      esc: esc, ani: ani, bar: bar, wireBar: wireBar, render: render, on: on, ev: ev, flushEv: flushEv, api: api, toast: toast, st: S.st, back: card };
  }

  /* ---------------- M11 league table ---------------- */
  // A row's stars are its score, the card's rule (one lit star per right answer), never one ⭐ for every child.
  // ur (the class table on an Urdu page, web_quiz_class_doors): the score in Urdu digits, kept in its order (U+2066…U+2069)
  function rowScore(c, t, ur) {
    var n = Number(c) || 0, tot = Number(t) || 0;
    var s = tot > 0 && tot <= 12 ? stars(Math.min(n, tot), tot).replace('class="wq-stars"', 'class="wq-stars wq-rstars"') : '';
    return '<span class="wq-rscore">' + (ur ? '\u2066' + esc(urDigits(c)) + '/' + esc(urDigits(t)) + '\u2069' : esc(c) + '/' + esc(t)) + '</span>' + s;
  }
  // web_quiz_class_doors (the quiz page's boot): the class table and the league wait as a skeleton of their own rows,
  // and their list root carries the list-state marks: data-fetch pending|done|failed, data-skel-from/-to (when the
  // skeleton came and went) and data-empty-at (when an empty note showed). Off: today's waiting Jugnu, no marks.
  var LS_ON = B.class_doors === true;
  var LS_FROM = {};
  function lsWait(kind) {
    LS_FROM[kind] = Date.now();
    var r = '';
    for (var i = 0; i < 5; i++) r += '<tr class="wq-skrow"><td><i></i></td><td><i></i></td><td><i></i></td></tr>';
    return '<h2 class="wq-skh"><i></i></h2><table class="wq-table wq-skel" data-list="' + kind + '" data-fetch="pending" data-skel-from="' + LS_FROM[kind] + '" aria-busy="true"><tbody>' + r + '</tbody></table>';
  }
  // The marks for a list root once its answer is in (state done|failed; empty: an empty note is what shows).
  function lsMarks(kind, state, empty) {
    if (!LS_ON) return '';
    var now = Date.now();
    return ' data-list="' + kind + '" data-fetch="' + state + '"' + (LS_FROM[kind] ? ' data-skel-from="' + LS_FROM[kind] + '" data-skel-to="' + now + '"' : '') + (empty ? ' data-empty-at="' + now + '"' : '');
  }
  // web_quiz_class_doors: while "See my class" is on screen, the class table is asked for once on idle, so the tap opens
  // real rows, not a skeleton. Kept 60 s, one at a time, never on saveData or a 2g line (a 3g reading is warmed: a real
  // 4G line at a high round trip reads as 3g, and the table is one small answer); board() takes it once (a failed or
  // old one: board() asks itself, as today).
  var BWARM = null;
  function boardPath() { return 'board/' + encodeURIComponent(CODE) + (S.st ? '?st=' + encodeURIComponent(S.st) : ''); }
  function warmBoard() {
    var c = navigator.connection || {};
    if (BWARM || c.saveData || /2g$/.test(c.effectiveType || '')) return;
    var m = ROOT.getAttribute('data-m');
    var go = function () {
      if (BWARM || ROOT.getAttribute('data-m') !== m || !$('#wq-class')) return;
      BWARM = { at: Date.now(), p: api('GET', boardPath()).catch(function () { return null; }) };
    };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 1200);
  }
  function boardGet() {
    var w = BWARM;
    BWARM = null;
    var fresh = function () { return api('GET', boardPath()); };
    if (!w || Date.now() - w.at > 60000) return fresh();
    return w.p.then(function (r) { return r && r.ok ? r : fresh(); });
  }
  // web_quiz_class_doors: the child's place on this table is kept on the device (a number per code and child, no name),
  // so the next visit says how they moved. The line shows with the adventure look (<html class="wq-adv">), which themes
  // .wq-move by its data-move (up|same|down).
  function moveLine(b, you) {
    var chip = S.child && S.child.chip;
    if (!b.class_doors || !you || !chip) return '';
    var k = 'wq_cp_' + CODE + '_' + chip;
    var was = sget(k, null);
    sset(k, you.place);
    var adv = false;
    try { adv = document.documentElement.classList.contains('wq-adv'); } catch (e) {}
    if (!adv || typeof was !== 'number') return '';
    var d = was - you.place;
    return '<p class="wq-move" data-move="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same') + '">' + esc(d > 0 ? T.movedUp(d) : d < 0 ? T.movedNow(you.place) : T.samePlace) + '</p>';
  }
  function board() {
    render((advOn() ? landBar('games', '') : bar()) + (LS_ON ? lsWait('table') : '<div class="wq-boot"><img src="' + jv(IMG + 'thinking.webp') + '" alt="" width="96"></div>'), 'M11-wait');
    wireBar();
    boardGet().then(function (r) {
      if (!r.ok) throw new Error('board_' + r.status);
      var b = r.body;
      // A table of more than one class (web_quiz_class_doors): "Only Class 3" shows the child's class on its own.
      var mixed = Boolean(b.class_doors && b.my_class && b.only && b.only.rows);
      drawBoard(b, mixed, false, true);
    }).catch(function (e) {
      ev('error', { err: (e && e.message) || 'board' });
      // web_quiz_class_doors: a table that is not there (404: a friend's challenge code, the shared watch quiz) is said so,
      // with one way on; never "no internet" and a retry that cannot work. Home for a child on this page (the hub door
      // needs the session); a visitor from a link with no session has no home here, so Play.
      if (LS_ON && e && e.message === 'board_404') {
        render((advOn() ? landBar('games', leagueTitle()) : bar()) + '<div' + lsMarks('table', 'failed') + ' data-why="not_found">' + jug('thinking', T.tableNone) + '</div>' +
          (S.st ? '<button class="wq-btn wq-go" id="wq-thome" data-primary data-home>' + esc(T.homeBtn) + '</button>' : '<button class="wq-btn wq-go" id="wq-play" data-primary>' + esc(T.play) + '</button>'), 'M11-none');
        wireBar();
        on('#wq-thome', function () { homeGo('table'); });
        on('#wq-play', landing);
        return;
      }
      render((advOn() ? landBar('games', leagueTitle()) : bar()) + (LS_ON ? '<div' + lsMarks('table', 'failed') + '>' + jug('notyet', T.offline) + '</div>' : jug('notyet', T.offline)) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M11-error');
      wireBar();
      on('#wq-retry', board);
    });
  }
  // The table drawn from the board's answer: the whole table, or (onlyOn) the child's class on its own.
  // The child's class number as html: escaped, isolated, in Urdu digits on an Urdu page.
  function clsNum(c) { return '<bdi>' + esc(LANG === 'ur' ? urDigits(c) : c) + '</bdi>'; }
  // The league's name in the land header (the look): "League table" with the class list as a small line under it, so
  // the header is 2 even lines at 360 and never breaks inside the list ("Classes 2, 3, 4, / 5 league table").
  // One header on every class table: the small line is the given html (the child's class, "Your class"), else the
  // quiz's class label, in Urdu words and digits on an Urdu page.
  function leagueTitle(sub) {
    if (!advOn() || !T.leagueW) return esc(T.leagueT(CLASS_LABEL));
    return '<span class="wq-lgt">' + esc(T.leagueW) + '</span><small class="wq-lgc" dir="auto">' + (sub || esc(CLS.label && LANG === 'ur' ? urClassLabel(CLS.label) : CLASS_LABEL)) + '</small>';
  }
  function drawBoard(b, mixed, onlyOn, first) {
    var v = onlyOn ? b.only : b;
    var you = v.you || null;
    var me = S.child && S.child.first;
    var youShown = false;
    // class_doors on an Urdu page: one digit system (places and scores in Urdu digits, like the counts around them)
    var ur = Boolean(b.class_doors) && LANG === 'ur';
    var place = function (n) { return esc(ur ? urDigits(n) : n); };
    var pct = function (n) { return ur ? urDigits(n) + '\u066A' : n + '%'; };
    var rows = (v.rows || []).map(function (x) {
      var isYou = you && x.place === you.place && x.first === me && x.correct === you.correct && !youShown;
      if (isYou) youShown = true;
      return '<tr' + (isYou ? ' class="wq-you"' : '') + '><td>' + place(x.place) + '</td><td>' + ani(x.animal) + ' ' + esc(x.first) +
        (isYou ? '<span class="wq-tag">' + esc(T.you) + '</span>' : '') + '</td><td>' + rowScore(x.correct, x.total, ur) + '</td></tr>';
    }).join('');
    if (you && !youShown) {
      rows += '<tr class="wq-you"><td>' + place(you.place) + '</td><td>' + ani(S.child && S.child.animal) + ' ' + esc(me || '') + '<span class="wq-tag">' + esc(T.you) + '</span></td><td>' + rowScore(you.correct, you.total, ur) + '</td></tr>';
    }
    // an English quiz's table shown in Urdu: the lesson's name from its Urdu twin when the teacher has one, else the quiz's
    // (a video lesson's own Urdu name, topic_ur, comes first: Q.topic is it already)
    var topic = ur && UI_SWAP && !Q.topic_ur && b.twin && typeof b.twin.topic === 'string' && b.twin.topic ? b.twin.topic : Q.topic;
    var yourPct = you && you.total ? Math.round(100 * you.correct / you.total) : null;
    // class_doors: the child's own class when every row is of it, "Your class" when the table holds more than one.
    // The class number is isolated (<bdi>, as the league's sector) and in the page's digits, like the other counts.
    var mine = b.class_doors && b.my_class ? (b.one_class ? T.myClassT(clsNum(b.my_class)) : esc(T.yourClass)) : '';
    var title = advOn() && T.leagueW ? leagueTitle(mine) : mine || leagueTitle();
    // the look: the names note has its own row above the rows (never near the sticky button), and Play is the one
    // primary with Share soft; a child with a result (no Play here) keeps Share as the primary
    var look = Boolean(b.class_doors) && advOn();
    var playOne = look && !S.result;
    var note = '<p class="wq-small' + (look ? ' wq-tnote' : '') + '">' + esc(T.firstOnly) + '</p>';
    var h = (advOn() ? landBar('games', title) : bar() + '<h2>' + title + '</h2>') + (first ? moveLine(b, v.you) : '') + '<p class="wq-sub">' + topicLine(topic, T.finN(v.finishers_n || 0)) + '</p>' +
      (mixed ? '<div class="wq-chips wq-schips wq-tall"><button class="wq-chip' + (onlyOn ? '' : ' wq-on') + '" id="wq-call">' + esc(T.allSchools) + '</button><button class="wq-chip' + (onlyOn ? ' wq-on' : '') + '" id="wq-conly">' + T.onlyClass(clsNum(b.my_class)) + '</button></div>' : '') + (look ? note : '') +
      (rows ? '<table class="wq-table"' + lsMarks('table', 'done') + '><tbody>' + rows + '</tbody></table>' : '<div class="wq-card"' + lsMarks('table', 'done', true) + '>' + esc(T.noRows) + '</div>') +
      (v.more_n ? '<p class="wq-sub wq-center">' + esc(T.moreN(v.more_n)) + '</p>' : '') +
      '<div class="wq-card wq-cmp">' +
      (yourPct != null ? '<span>' + esc(T.yourScore) + '</span><span>' + pct(yourPct) + '</span><div class="wq-meter" style="grid-column:1/3"><b style="width:' + yourPct + '%"></b></div>' : '') +
      '<span>' + esc(T.avg) + '</span><span>' + esc(pct(v.class_avg_pct || 0)) + '</span><div class="wq-meter wq-avg" style="grid-column:1/3"><b style="width:' + (v.class_avg_pct || 0) + '%"></b></div></div>' +
      (look ? '' : note) +
      // the look: a long table keeps its one primary on the screen (sticky at the bottom until the page reaches it)
      (playOne ? '<button class="wq-btn wq-go wq-stick" id="wq-play" data-primary>' + esc(T.play) + '</button>' : '') +
      (playOne ? '<button class="wq-btn wq-soft" id="wq-share-t">' : '<button class="wq-btn wq-go' + (look ? ' wq-stick' : '') + '" id="wq-share-t"' + (b.class_doors ? ' data-primary' : '') + '>') + esc(T.shareTable) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-schools">' + ic(IC.school, '🏫') + ' ' + esc(T.schoolsBtn) + '</button>' +
      (S.result ? '<button class="wq-btn wq-soft" id="wq-next">' + esc(T.myScores) + '</button>' : playOne ? '' : '<button class="wq-btn wq-navy" id="wq-play">' + esc(T.play) + '</button>');
    render(h, 'M11');
    wireBar();
    if (first) ev('board_view', { src: B.view === 'class' ? 'class_link' : 'page', i: b.finishers_n });
    // The child's own class picture ("me" named) when they have finished; else the class's. The link carries
    // ?v=<finishers>: WhatsApp caches a preview per URL, so a group that shared the table earlier would see an old one.
    var tArt = (S.result && S.result.art && S.result.art.class) || (B.art && B.art.class) || null;
    warmArt('class', tArt);
    needSheet();
    // The shared /class link previews the CLASS picture (nobody named), not the child's own: drawn now too, so the
    // sender's WhatsApp finds it ready instead of waiting for a draw.
    warmPreviewArt('class', B.art && B.art.class);
    on('#wq-share-t', function () { var u = link('/q/' + CODE + '/class' + (b.finishers_n ? '?v=' + b.finishers_n : '')); shareScreen(T.tableLine(Q.topic, CLASS_LABEL), b.class_doors && UI_SWAP ? withLang(u) : u, 'table', tArt); });
    on('#wq-schools', function () { schools(board); });
    on('#wq-next', history);
    on('#wq-call', function () { drawBoard(b, mixed, false); });
    on('#wq-conly', function () { drawBoard(b, mixed, true); });
    on('#wq-play', UI_SWAP ? function () { quizPage(b.twin); } : landing);
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
    // with the Urdu polish the step is in Urdu digits, like the rank
    var n = UR2 ? urDigits(Math.abs(m)) : Math.abs(m);
    return m > 0 ? '<span class="wq-move wq-up" dir="ltr">▲' + n + '</span>' : '<span class="wq-move wq-down" dir="ltr">▼' + n + '</span>';
  }
  // with the look a sector code stays whole ("G-5" never leaves a lone "5"): a hyphen before a digit does not break
  function schoolName(n) { return advOn() ? String(n || '').replace(/-(?=\d)/g, '\u2011') : n; }
  function schoolRow(r) {
    return '<li class="wq-srow' + (r.mine ? ' wq-you' : '') + '"' + (r.mine ? ' id="wq-mine"' : '') + '>' +
      // with the Urdu polish the rank is in Urdu digits, like the counts beside it and the class table's places
      '<span class="wq-splace">' + esc(UR2 ? urDigits(r.place) : r.place) + '</span>' +
      '<span class="wq-sname"><bdi>' + esc(schoolName(r.name)) + '</bdi>' + (r.mine ? '<span class="wq-tag">' + esc(T.yourSchool) + '</span>' : '') +
      '<small>' + esc(T.kidsN(r.kids || 0)) + '</small></span>' +
      '<span class="wq-spts">' + esc(T.pts(r.points || 0)) + schoolMove(r.move) + '</span></li>';
  }
  function schoolsSrc(back) { return B.view === 'schools' && !SCH.opened ? 'link' : back === card ? 'card' : back === today ? 'today' : 'class'; }
  function schools(from) {
    SCH.back = typeof from === 'function' ? from : afterResult;
    NAV.schoolsBack = SCH.back;
    render((advOn() ? landBar('games', esc(T.schoolsT)) : bar()) + (LS_ON ? lsWait('schools') : '<div class="wq-boot"><img src="' + jv(IMG + 'thinking.webp') + '" alt="" width="96"></div>'), 'M16-wait');
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
      render((advOn() ? landBar('games', esc(T.schoolsT)) : bar()) + (LS_ON ? '<div' + lsMarks('schools', 'failed') + '>' + jug('notyet', T.offline) + '</div>' : jug('notyet', T.offline)) + '<button class="wq-btn wq-go" id="wq-retry">' + esc(T.next) + '</button>', 'M16-error');
      wireBar();
      on('#wq-retry', function () { schools(SCH.back); });
    });
  }
  // With web_quiz_class_doors (the league's class_doors): a short lower-case sector code reads as a name ("ict" -> "ICT").
  // The quiz page itself (its own language), keeping the hub key: from a class table or league shown in the link's language.
  // tw: the quiz's twin in the page's language ({code[, k]}, the board's or the league's answer): its own page instead.
  function quizPage(tw) {
    if (tw && typeof tw.code === 'string' && /^[A-Za-z0-9]{4,16}$/.test(tw.code)) return location.assign('/q/' + tw.code + (tw.k ? '?k=' + encodeURIComponent(tw.k) : ''));
    location.assign('/q/' + CODE + (params.k ? '?k=' + encodeURIComponent(params.k) : ''));
  }
  function sectorName(s, on) { return on && /^[a-z]{2,4}$/.test(String(s)) ? String(s).toUpperCase() : s; }
  function drawSchools() {
    var b = SCH.data || {};
    var cd = Boolean(b.class_doors);
    var mine = b.mine || null;
    var rows = b.rows || [];
    if (SCH.sector && mine && mine.sector) rows = rows.filter(function (x) { return x.sector === mine.sector; });
    var list = rows.map(schoolRow).join('');
    var nm = mine ? '<bdi>' + esc(schoolName(mine.name)) + '</bdi>' : '';
    var top = !mine ? '' : mine.ghost
      ? '<div class="wq-card wq-mycard wq-zero" id="wq-mine"><p>' + T.ghost(nm) + '</p></div>'
      : '<div class="wq-card wq-mycard" id="wq-mycard"><p><b>' + T.schoolPlace(nm, esc(mine.place)) + '</b></p>' +
        (typeof mine.move === 'number' && mine.move ? '<p class="wq-move ' + (mine.move > 0 ? 'wq-up' : 'wq-down') + '">' + esc(T.sinceY(mine.move)) + '</p>' : '') +
        '<p class="wq-sub">' + esc(T.pts(mine.points || 0)) + sep() + esc(T.kidsN(mine.kids || 0)) + '</p>' +
        (b.added ? '<p class="wq-added">' + T.added(esc(b.added), nm) + '</p>' : '') + '</div>';
    var chips = mine && mine.sector && (b.rows || []).length
      ? '<div class="wq-chips wq-schips' + (cd ? ' wq-tall' : '') + '"><button class="wq-chip' + (SCH.sector ? '' : ' wq-on') + '" id="wq-all">' + esc(T.allSchools) + '</button>' +
        '<button class="wq-chip' + (SCH.sector ? ' wq-on' : '') + '" id="wq-sector">' + esc(T.mySector) + sep() + '<bdi>' + esc(sectorName(mine.sector, cd)) + '</bdi></button></div>' : '';
    var zn = b.zero_names || [];
    var zero = b.zero_n && !SCH.sector
      ? '<details class="wq-zero-list' + (cd ? ' wq-tall' : '') + '"><summary>' + esc(T.zeroN(b.zero_n)) + '</summary>' +
        (zn.length ? '<ul>' + zn.map(function (n) { return '<li><bdi>' + esc(n) + '</bdi></li>'; }).join('') + '</ul>' : '') + '</details>' : '';
    var h = (advOn() ? landBar('games', esc(T.schoolsT)) : bar() + '<h2>' + esc(T.schoolsT) + '</h2>') + '<p class="wq-sub">' + esc(T.schoolsRule) + '</p>' + top + chips +
      (list ? '<ol class="wq-slist"' + lsMarks('schools', 'done') + '>' + list + '</ol>' : mine ? (LS_ON ? '<div' + lsMarks('schools', 'done') + '></div>' : '') : '<div class="wq-card"' + lsMarks('schools', 'done', true) + '>' + esc(T.noSchools) + '</div>') + zero +
      // A cold recipient of the league link (never played here): the next step is to play, for their school.
      // (class_doors: the label is one flex item, never the words and the name side by side; the go button is the primary)
      (mine && !S.st && !S.result ? '<button class="wq-btn wq-go' + (cd ? ' wq-stick' : '') + '" id="wq-play-s"' + (cd ? ' data-primary><span class="wq-btn-t">' + esc(T.playMine) + '</span>' : '>' + T.playFor(nm)) + '</button>' : '') +
      (mine ? '<button class="wq-btn ' + (!S.st && !S.result ? 'wq-soft' : 'wq-go') + '" id="wq-share-s"' + (cd && (S.st || S.result) ? ' data-primary' : '') + '>' + esc(mine.ghost ? T.inviteSchool : T.shareSchools) + '</button>' : '') +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    render(h, 'M16');
    wireBar();
    on('#wq-all', function () { SCH.sector = false; drawSchools(); });
    on('#wq-sector', function () { SCH.sector = true; drawSchools(); });
    // The board's own picture travels with the link; ?v=<the hour in Pakistan> because WhatsApp caches a
    // preview per URL and the board moves every hour.
    var sArt = (B.art && B.art.schools) || null;
    warmArt('schools', sArt);
    needSheet();
    on('#wq-share-s', function () {
      ev('leaderboard_share', { src: 'schools', i: (mine && mine.place) || 0 });
      var hour = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 13).replace(/[-T]/g, '');
      var u = link('/q/' + CODE + '/schools?v=' + hour);
      shareScreen(T.schoolsLine(mine.name, mine.ghost ? null : mine.place), cd && UI_SWAP ? withLang(u) : u, 'schools', sArt);
    });
    on('#wq-play-s', UI_SWAP ? function () { quizPage(b.twin); } : landing);
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
        return '<li><span>' + esc(topicOf(x)) + '<br><small class="wq-small">' + esc(dayMonth(x.date)) + '</small></span><span>' + rowScore(x.correct, x.total) + '</span></li>';
      }).join('') + '</ul>' +
        (fr.length ? '<p class="wq-sub">' + esc(T.friends) + '</p><ul class="wq-hist">' + fr.slice(0, 6).map(function (x) {
          return '<li><span>' + dotJoin(x.first, topicOf(x), T.frOut[x.outcome]) + '</span><span>' + esc(x.correct) + '/' + esc(x.total) + '</span></li>';
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
      '<div class="wq-big">' + esc(scoreN(fmtN(LIVE.ict_today_floor || 0))) + '</div>' +
      '<p class="wq-sub">' + esc(T.todaySub) + '</p></div>' +
      (more ? moreBtn() : '') + '<button class="wq-btn wq-soft" id="wq-schools">' + ic(IC.school, '🏫') + ' ' + esc(T.schoolsBtn) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-home">' + esc(T.home) + '</button>';
    render(h, 'M14');
    libPrefetch();
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
    if (/^M15/.test(m) && typeof WQL !== 'undefined' && WQL.active()) return WQL.up;
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
      // Stepping back through questions: a second spare entry during play, so two quick Backs both stay here.
      var m = ROOT.getAttribute('data-m') || '';
      if (BACK_ON && (PLAYING[m] || m === 'M6-review')) h.pushState({ wq: 'top2' }, '');
      NAV.armed = true;
    } catch (e) {}
  }
  function navBack() {
    NAV.armed = false;
    var m = ROOT.getAttribute('data-m') || '';
    var to = backTo(m);
    var src = m.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (SHEET) { dropSheet(); ev('back', { src: src, step: 'sheet' }); return; }
    if (to) { ev('back', { src: src, step: 'screen' }); to(); return; }
    // web_quiz_back_nav: Back walks the questions back (review, then the video), and where the page would
    // close (the first screen of play, the results) it offers Home instead.
    if (BACK_ON && (m === 'M6' || m === 'M7')) { stepBack(CURQ, src); return; }
    if (BACK_ON && m === 'M6-review') { stepBack(REVQ, src); return; }
    if (BACK_ON && homeOk() && /^(M5|M9|M9-tricky|M10)$/.test(m)) { ev('back', { src: src, step: 'home' }); homeSheet(src); return; }
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
  ev('page_open', { ua: String(navigator.userAgent || '').slice(0, 300), iab: IAB, store: STORE_OK ? 1 : 0, net: conn.effectiveType || '', src: B.view || 'quiz', reason: B.challenge ? 'challenge' : undefined,
    // Where this link came from: a friend's challenge code, the class table a child shared, a child's shared card, else the teacher's own.
    via: B.challenge || B.invited ? 'invite' : B.view === 'class' ? 'table' : params.a ? 'card' : 'direct' });
  if (S.queue.length) flushQueue();
  // M4a hub: "Play again" (?again=1) starts a fresh attempt on this phone: a finished one only, never unsent
  // answers. (?k=<chip> is the identity code's: it confirms the child before playing.)
  // a "Play again" tap (the hub's, the home's or the next thing's) never goes back home through link-home below
  var AGAIN = params.again === '1';
  if (params.again === '1' && S.result && !S.queue.length && !S.pending) { S = { st: null, child: null, answers: {}, queue: [], seq: 0, wrong: [], result: null }; save(); ev('again', {}); }
  if (params.again) { try { var u = new URLSearchParams(location.search); u.delete('again'); window.history.replaceState(window.history.state, '', location.pathname + (String(u) ? '?' + u : '')); } catch (e) {} }
  var FROM = B.view === 'class' || B.view === 'schools' || S.st ? null : handover();
  // The one-shot handset link (#x=, from the bot's button to a known phone): the fragment is kept in
  // sessionStorage and dropped from the address bar first; the server spends it once with this device and
  // answers this phone's own children. One child opens straight in; several are the "Who is playing?" cards;
  // anything else (used, expired, off, offline) is today's landing. The fragment never reaches a server.
  function handsetX() {
    var x = '';
    try { var m = /(^|[#&])x=([^&]+)/.exec(String(location.hash || '')); if (m) x = m[2]; } catch (e) {}
    try { if (x) sessionStorage.setItem('wq_x', x); else x = sessionStorage.getItem('wq_x') || ''; } catch (e) {}
    try { if (location.hash) window.history.replaceState(window.history.state, '', location.pathname + location.search); } catch (e) {}
    return x;
  }
  function handsetBind(x) {
    var done = function () { try { sessionStorage.removeItem('wq_x'); } catch (e) {} };
    // While the server answers: the quiz and Jugnu, no question and nothing to tap (as a hub link's start).
    render(bar() + jug('thinking', TW.opening) + '<div class="wq-card wq-stack"><h1>' + esc(Q.topic) + '</h1><p class="wq-sub">' + esc(T.from(doorTeacher(), doorLabel())) + '</p></div>', 'M4-opening');
    wireBar();
    var body = { code: CODE, x: x };
    var dref = sget('wq_d', null);
    if (dref) body.device_ref = dref;
    ev('identity_pick', { src: 'handset' });
    api('POST', 'bind', body).then(function (r) {
      done();
      var b = r.body || {};
      if (!r.ok) { ev('handset_page', { ok: 0, status: r.status }); return landing(); }
      if (b.device_ref) sset('wq_d', b.device_ref);
      (b.kids || []).forEach(rememberKid);
      ev('handset_page', { ok: 1, kids: (b.kids || []).length, one: b.one ? 1 : 0 });
      if (b.one) return startSession({ chip: b.one, via: 'handset' }, (b.kids || [])[0] || null, '');
      landing();
    }, function () { done(); ev('handset_page', { ok: 0, status: 'net' }); landing(); });
  }
  // An old, finished class link opened again on the phone that finished it (boot link_home, app_settings
  // web_quiz_link_home): the server answers that child's hub (a token for that child only, bound to this phone) or
  // null, and then today's screen (`rest`). Asked once, only for ONE remembered child; never waits more than 3 s.
  function linkHome(rest) {
    var done = false;
    function fall() { if (!done) { done = true; rest(); } }
    setTimeout(fall, 3000);
    api('POST', 'linkhome', { code: CODE, device_ref: sget('wq_d', null) }).then(function (r) {
      var h = r && r.ok && r.body ? r.body.home : null;
      if (done || typeof h !== 'string' || !/^\/h\/[A-Za-z0-9._-]+\?from=link$/.test(h)) return fall();
      done = true;
      location.replace(withLang(h));
    }, fall);
  }
  // A class link on a phone that already holds a child (boot link_known, app_settings web_quiz_link_known_child): the
  // server answers the children THIS phone holds (never a classmate; nobody on a forwarded link) and the page asks
  // "Is it <First>?" (two or more: "Whose turn is it?") before the name box, so a child who joined on their own plays
  // as themselves. Asked once per quiz on this phone. Today's landing is drawn at once while it asks (never a blank
  // wait); the answer swaps it for the question only while the child has not touched the page (no tap, key, touch or
  // scroll) and the landing is still the screen. After a touch a late answer is dropped (link_known_late {ms}); every
  // answer the server gave is timed (link_known_answer {ms, kids, shown, asked}; an error writes no line).
  // "Someone else", nobody, an error or no answer: today's screen.
  var KN_KEY = 'wq_kn_' + CODE;
  function knownOk() {
    return Boolean(B.link_known) && !B.preview && !B.invited && !B.challenge && !params.k && !S.st && !S.queue.length && !S.pending
      && Boolean(sget('wq_d', null)) && !sget(KN_KEY, null);
  }
  function knownAsk() {
    var t0 = Date.now(), touched = false;
    function touch() { touched = true; }
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (n) { document.addEventListener(n, touch, true); });
    window.addEventListener('scroll', touch, { passive: true });
    landing();
    var painted = ROOT.getAttribute('data-m');
    // The server reads this phone's own wq_dv cookie (the edge forwards it), never a device the page sends.
    api('POST', 'known', { code: CODE }).then(function (r) {
      // A child already a card on this phone's landing is offered there; only the others are asked about here.
      var have = {};
      kids().forEach(function (k) { have[k.chip] = 1; });
      // An error, a fault or a reply of the wrong shape is not "nobody on this phone": no line, today's screen.
      if (!(r && r.ok && r.body && Array.isArray(r.body.kids))) return;
      var all = r.body.kids.filter(function (k) { return k && typeof k.chip === 'string' && k.chip && typeof k.first === 'string' && k.first; }).slice(0, 4);
      var list = all.filter(function (k) { return !have[k.chip]; });
      var ms = Math.max(0, Date.now() - t0);
      // kids = the server's count, shown = those already a card here, asked = the ones asked about (a miss is kids 0)
      ev('link_known_answer', { ms: ms, kids: all.length, shown: all.length - list.length, asked: list.length });
      if (!list.length) return;
      if (touched || ROOT.getAttribute('data-m') !== painted) return ev('link_known_late', { ms: ms });
      knownCards(list);
    }, function () {});
  }
  function knownCards(list) {
    var one = list.length === 1 ? list[0] : null;
    var nm = function (k) { return '<bdi>' + esc(k.first) + '</bdi>'; };
    var h = bar() +
      jug('hello', one ? T.hello : T.whoSay, true, true) +
      '<div class="wq-card wq-stack"><h1>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(doorTeacher(), doorLabel())) + '</p></div>' +
      (one
        ? '<h2>' + TW.knIs(nm(one)) + '</h2><button class="wq-btn wq-go" id="wq-kn-yes">' + ani(one.animal) + esc(TW.knYes) + '</button>'
        : '<h2>' + esc(T.whoT) + '</h2><div class="wq-kids-big">' + list.map(function (k, i) {
          return '<button class="wq-kid wq-kid-big" id="wq-kn-' + i + '">' + ani(k.animal) + nm(k) + '</button>';
        }).join('') + '</div>') +
      '<button class="wq-btn wq-ghost" id="wq-kn-else">' + esc(TW.knElse) + '</button>';
    render(h, 'M4-known');
    wireBar();
    ev('known_ask', { kids: list.length });
    // A finger already on its way to «Play» can come down on a button this sheet just drew there: for 500 ms the
    // buttons ignore taps, and a press that began inside that window is ignored when it lifts.
    var armed = false, early = false;
    setTimeout(function () { armed = true; }, 500);
    function tap(sel, fn) {
      var el = on(sel, function () { var skip = !armed || early; early = false; if (!skip) fn(); });
      if (el) el.addEventListener('pointerdown', function () { early = !armed; });
    }
    function pick(k) { sset(KN_KEY, 1); ev('identity_pick', { src: 'known' }); startSession({ chip: k.chip, via: 'known' }, k); }
    if (one) tap('#wq-kn-yes', function () { pick(one); });
    else list.forEach(function (k, i) { tap('#wq-kn-' + i, function () { pick(k); }); });
    tap('#wq-kn-else', function () { sset(KN_KEY, 1); ev('identity_pick', { src: 'known_else' }); landing(); });
  }
  var HX = B.view === 'class' || B.view === 'schools' || B.preview ? '' : handsetX();
  if (B.view === 'schools') schools(afterResult);
  // a story has no class board: its class view (/q/<code>/class) opens the story's landing below
  else if (B.view === 'class' && !B.story) board();
  else if (FROM) { ev('more_arrive', {}); if (FROM.t) ev('more_timing', { nav_ms: Date.now() - FROM.t }); startSession({ from_st: FROM.st }, null, ''); }
  else if (B.link_home && !AGAIN && !B.preview && !B.invited && !B.challenge && !HX && !S.queue.length && !S.pending && (S.result ? S.st : !S.st) && kids().length === 1 && sget('wq_d', null)) linkHome(function () { if (S.result) card(); else landing(); });
  else if (S.result && S.st) card();
  else if (S.pending && S.st) results(S.fixed || 0);
  else if (S.st && S.child && (answeredCount() > 0 || (S.vt > 0 && wantsVideo()))) resume();
  else if (HX) handsetBind(HX);
  else if (knownOk()) knownAsk();
  else landing();
})();
