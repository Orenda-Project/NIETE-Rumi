'use strict';
/**
 * The Urdu fit walk: every screen of the self-administered battery (dashboard/sa/sa-ui.js), driven phase by phase in a
 * real browser with the house Nastaliq, and every Urdu word on each screen measured.
 *
 * A word fails when its ink (the word's own glyphs drawn on a canvas with its computed font, on its baseline; the pixels
 * decide, never the font's bounding box):
 *   clipped    reaches past an ancestor that clips it (overflow hidden/clip; a scroller's whole scroll area)
 *   outside    reaches past the box it sits in (the nearest ancestor with a border or its own background: a tile, a
 *              button, a card, a pill)
 *   covered    its glyphs meet a picture, an emoji glyph, a control or another box that is not its own
 *   collides   its glyphs meet the glyphs of an Urdu word in another element
 * Reported, not failed: touch (two lines of one paragraph or passage whose strokes meet: line spacing) and cut (a word half shown at
 * a scroller's edge where the screen opens: the screen scrolls).
 *   broken     is split over two lines (a Nastaliq word never breaks)
 *   sideways   the page scrolls sideways
 *   small      is under 16 px (a child's screen) or 14 px (the coach's own words)
 *   tight      sits on a line under 2 × its size (the portal's Urdu rule, index.css)
 *   face       is not drawn in the Nastaliq face
 *
 * Used by tests/sa-ur-screens-fit.service.test.js and scripts/sa-ur-fit-walk.js. Needs playwright-core and Chromium.
 */
const fs = require('fs');
const path = require('path');

const DASH = path.join(__dirname, '..', '..');
const SA = path.join(DASH, 'sa');
const WQ = path.join(DASH, 'public', 'wq');
const FORMS = path.join(DASH, '..', 'bot', 'shared', 'data', 'child-test', 'sa');

/** The switches sandbox puts on battery.ui (GET /sa/batteries/<form>.json, 25 Oct): the screens the coaches will see. */
const UI_FLAGS = {
  one_at_a_time: true, passage_punct: true, rdf_manual: true, voice_gate_v2: true, comp_all_questions: true,
  cell_pace: true, section_recording: true, coach_last_word: true, cell_next_only: true, auto_child_last_word: true,
};

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  // 130 %: a 360x640 phone zoomed to 130 % (the browser's zoom, or Android's large text): 277 css px across.
  { name: '360x640@130', width: 277, height: 492, deviceScaleFactor: 1.3 },
  // Android's "Font size" at 130 %: the page's px font sizes ×1.3 on a 360x640 phone, nothing else.
  { name: '360x640@text130', width: 360, height: 640, textScale: 1.3 },
];

/** sa.css with every font-size's px/vw lengths scaled (the phone's text scale). */
function scaledCss(css, k) {
  return css.replace(/font-size:([^;}]*)/g, (m, v) => 'font-size:' + v.replace(/(\d*\.?\d+)(px|vw)/g, (x, n, u) => (Math.round(parseFloat(n) * k * 100) / 100) + u));
}

/** One walk: a form's block in a mode. block rdf_auto = the self-run visit, rdf_manual = coach-led. */
function scenarios(opts = {}) {
  const grades = opts.grades || [1, 2, 3, 4, 5];
  const out = [];
  grades.forEach((g) => {
    ['rdf_auto', 'rdf_manual'].forEach((block) => out.push({ id: `G${g}.ur.${block}`, form: `sa.coach.G${g}.A.ur`, block, mode: 'proctored' }));
  });
  if (opts.english) grades.forEach((g) => out.push({ id: `G${g}.en.rdf_auto`, form: `sa.coach.G${g}.A.en`, block: 'rdf_auto', mode: 'proctored' }));
  if (opts.game) ['G1', 'G23', 'G45'].forEach((g) => out.push({ id: `game.${g}.ur`, form: `sa.game.${g}.ur`, block: 'full', mode: 'game' }));
  return out;
}

/** The battery the page would run: the form, the server's ui flags, the block picked, every passage variant listed. */
function batteryOf(sc, variant) {
  const page = require(path.join(SA, 'sa-page.js'));
  const full = JSON.parse(fs.readFileSync(path.join(FORMS, sc.form + '.json'), 'utf8'));
  full.ui = Object.assign({}, UI_FLAGS);
  const picked = page.pick(full, sc.block);
  const b = Object.assign({}, picked, {
    tasks: picked.tasks.map((t) => {
      if (!Array.isArray(t.variants) || !t.variants.length) return t;
      const v = t.variants[(variant || 0) % t.variants.length];
      const c = Object.assign({}, t, { passage: v.passage || t.passage, items: v.items, variant: { id: v.id } });
      if (v.stop) c.stop = v.stop;
      delete c.variants;
      return c;
    }),
  });
  const variants = Math.max(1, ...picked.tasks.map((t) => (Array.isArray(t.variants) ? t.variants.length : 1)));
  return { battery: b, manual: page.manualOf(full, sc.block), variants };
}

function pageHtml(lang) {
  const js = ['sa-core.js', 'sa-ui.js'].map((f) => `<script src="/sa/${f}"></script>`).join('\n');
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/sa/sa.css"></head><body><main id="sae-root"></main>${js}
<script src="/__walk.js"></script></body></html>`;
}

/** In the page: mount the screens on a runner, and step it. */
function walkScript() {
  /* eslint-disable no-var */
  return `(function () {
  var W = window.__walk = {};
  W.setup = function (cfg) {
    var SAE = window.SAE;
    var battery = SAE.core.normalize(cfg.battery);
    var ui = battery.ui || {};
    var manual = cfg.mode === 'proctored' && cfg.manual === true;
    var runner = SAE.core.createRunner({ battery: battery, now: function () { return performance.now(); }, session_id: 'walk-1',
      audio_check: true, warmup: true, mic: function () { return 'ok'; }, mic_check: cfg.mode === 'game', oral_practice: true, keypad_warmup: true,
      one_at_a_time: ui.one_at_a_time === true, manual: manual, comp_all_questions: ui.comp_all_questions === true,
      cell_pace: ui.cell_pace === true, section_recording: ui.section_recording === true, cell_next_only: ui.cell_next_only === true,
      guided: ui.guided === true && !manual, onEvent: function () {} });
    var el = document.getElementById('sae-root');
    var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: cfg.lang, mode: cfg.mode,
      // guided: Jugnu's lines never end here, so a guided screen waits for the walker instead of moving on by itself
      speak: ui.guided === true ? function () { return new Promise(function () {}); } : function () { return Promise.resolve(); }, check_words: battery.check_words || null,
      child: cfg.mode === 'proctored' ? { first_name: cfg.child || 'Zara Testwala' } : null,
      onMute: cfg.mode === 'game' ? function () {} : null, onUnlock: function () {}, onHandover: function () {},
      micProbe: function () { return Promise.resolve({ ok: true, rms: 0.2, url: null }); },
      micLevel: function (cb) { cb(0.6); return function () {}; },
      manual: manual, passage_punct: ui.passage_punct === true, section_recording: ui.section_recording === true,
      coach_last_word: ui.coach_last_word === true, lastWordHint: function () { return Promise.resolve(2); },
      auto_child_last_word: ui.auto_child_last_word === true, ur_fit: ui.ur_fit === true, app_asks: ui.app_asks === true,
      guided: ui.guided === true, embed: cfg.embed === true });
    W.runner = runner; W.view = view; W.el = el; W.seen = {}; W.items = 0; W.fb = {}; W.briefed = {};
    if (cfg.mode === 'proctored' && view.setSync) view.setSync({ state: 'pending' });
  };
  function primary() { return W.el.querySelector('.sae-foot .sae-primary, .sae-foot .sae-btn, .sae-primary'); }
  W.state = function () {
    var v = W.runner.view();
    var s = W.el.firstElementChild;
    return { phase: v.phase, shown: W.el.getAttribute('data-phase'), cls: s ? s.className : '', task: v.task ? v.task.id : null,
      mode: v.task ? v.task.mode : null, item: v.item_index == null ? null : v.item_index, cell: v.cell_index == null ? null : v.cell_index,
      practice: v.practice ? v.practice.id : null };
  };
  /** One step forward; returns what was done. Practice and run items: a few each, then the task is ended. */
  W.step = function () {
    var r = W.runner, v = r.view(), shown = W.el.getAttribute('data-phase'), s = W.el.firstElementChild, cls = s ? s.className : '';
    var done = '';
    if (shown === 'handover' || shown === 'listen' || (/sae-coach-brief/.test(cls) && !W.briefed[v.task.id] && (W.briefed[v.task.id] = 1))) {
      var b = primary(); if (b) { b.click(); done = 'click:' + shown; }
    }
    if (!done) switch (v.phase) {
      case 'battery_intro': r.start(); done = 'start'; break;
      case 'audio_check': r.audioCheck(true); done = 'audio'; break;
      case 'warmup': r.warmupDone(5, 2000); done = 'warmup'; break;
      case 'mic_check': r.micChecked(true, 0.2); done = 'mic'; break;
      case 'oral_practice': r.oralPracticeDone(true); done = 'oralp'; break;
      case 'keypad_warmup': r.keypadWarmupDone(3); done = 'kpw'; break;
      case 'instruction': r.instructionDone(); done = 'instr'; break;
      case 'practice': {
        // sa_guided_instructions: the guided ladder's screens (demo, turn, check), each measured, then on
        if (v.guided) { if (/check|retry/.test(v.guided.role)) r.guidedCheck('passed'); else r.guidedStep(); done = 'guided-' + v.guided.role; break; }
        var p = v.practice;
        var k = v.task.id + '/' + p.id;
        // A wrong tile first (the "try again" feedback screen), then the right answer.
        var wrong = v.task.mode === 'tap' && !W.fb[k] ? Array.prototype.find.call(W.el.querySelectorAll('.sae-opt'), function (o) { return o.getAttribute('data-value') !== String(p.target) && o.textContent.trim() !== String(p.target); }) : null;
        if (wrong) { W.fb[k] = 1; wrong.click(); done = 'practice-wrong'; break; }
        r.practiceAnswer(p.target); done = 'practice'; break;
      }
      case 'ready': r.begin(); done = 'begin'; break;
      case 'running': {
        W.items++;
        if (v.cell != null && W.items <= 3) { r.nextCell('tap'); done = 'cell'; break; }
        if (v.task.mode === 'record') { if (v.cell == null) { r.done(); done = 'done'; } else { r.coachEnd(); done = 'coach-end'; } break; }
        if (W.items <= 3 && v.item) { r.answer(v.task.mode === 'oral' ? 'spoken' : v.item.target); done = 'answer'; break; }
        r.coachEnd(); done = 'coach-end'; break;
      }
      case 'last_word': r.lastWord(2, { how: 'confirm', suggested: 2 }); done = 'lastword'; break;
      case 'task_end': W.items = 0; r.next(); done = 'next'; break;
      case 'battery_end': return 'end';
      default: return 'stuck:' + v.phase;
    }
    W.view.render();
    return done;
  };
  W.refuse = function (on) { if (on) W.view.refuse('voice', { retry: true }); else W.view.unrefuse(); };
}());`;
}

/** In the page: measure every Urdu word on the screen. Returns { nodes, fails, sideways }. */
function measureInPage(cfg) {
  const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻾]/;
  const COACH = '.sae-coach-text,.sae-coach-items,.sae-coach-says,.sae-coach-card,.sae-coach-menu,.sae-devjump-row,.sae-coach-brief,.is-coach';
  const S = 2; // canvas pixels per css px for the ink tests
  const INK = 96; // an ink pixel: alpha above this (anti-aliasing at the edge is not ink)
  const vw = window.innerWidth;
  const sel = (e) => {
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 4 && n.id !== 'sae-root'; n = n.parentElement) {
      parts.unshift(n.tagName.toLowerCase() + (n.classList.length ? '.' + Array.from(n.classList).slice(0, 2).join('.') : ''));
    }
    return parts.join('>');
  };
  const inner = (e) => {
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { top: r.top + (parseFloat(c.borderTopWidth) || 0), bottom: r.bottom - (parseFloat(c.borderBottomWidth) || 0),
      left: r.left + (parseFloat(c.borderLeftWidth) || 0), right: r.right - (parseFloat(c.borderRightWidth) || 0) };
  };
  const visible = (e) => {
    // The body of a folded <details> is not shown (only its summary is).
    const fold = e.closest('details:not([open])');
    if (fold && !e.closest('summary')) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    }
    return true;
  };
  const painted = (c) => c.backgroundColor && c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent';
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const clear = (col) => !col || col === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(col);
  const boxy = (e) => {
    const c = getComputedStyle(e);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(c['border' + s + 'Width']) > 0 && c['border' + s + 'Style'] !== 'none' && !clear(c['border' + s + 'Color']));
    return border || (painted(c) && c.backgroundColor !== bodyBg) || c.backgroundImage !== 'none';
  };
  /** The part of the screen an element can show in now: inside every clipping ancestor's visible box. */
  const seenOf = (e) => {
    let v = { top: -1e5, bottom: 1e5, left: -1e5, right: 1e5 };
    for (let n = e.parentElement; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const nc = getComputedStyle(n);
      if (nc.overflowX === 'visible' && nc.overflowY === 'visible') continue;
      const ib = inner(n);
      v = { top: Math.max(v.top, nc.overflowY === 'visible' ? -1e5 : ib.top), bottom: Math.min(v.bottom, nc.overflowY === 'visible' ? 1e5 : ib.bottom),
        left: Math.max(v.left, nc.overflowX === 'visible' ? -1e5 : ib.left), right: Math.min(v.right, nc.overflowX === 'visible' ? 1e5 : ib.right) };
    }
    return v;
  };
  const meet = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const r1 = (x) => Math.round(x * 10) / 10;
  const box = (b) => ({ top: r1(b.top), bottom: r1(b.bottom), left: r1(b.left), right: r1(b.right) });

  /** The word's own glyphs on a canvas over `area` (css px); `then(ctx)` may cut it; returns the ink pixels left. */
  const inkLeft = (w, area, then) => {
    const wd = Math.ceil((area.right - area.left) * S) + 2; const ht = Math.ceil((area.bottom - area.top) * S) + 2;
    if (wd < 2 || ht < 2 || wd * ht > 4e6) return 0;
    const cv = document.createElement('canvas'); cv.width = wd; cv.height = ht;
    const c = cv.getContext('2d');
    c.scale(S, S); c.translate(-area.left, -area.top);
    c.font = w.font; c.direction = 'ltr'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
    w.runs.forEach((r) => c.fillText(r.text, r.x, r.base));
    if (then) then(c);
    const d = c.getImageData(0, 0, wd, ht).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > INK) n++;
    return n / (S * S);
  };
  /** Ink pixels of w outside rect b. */
  const outsideOf = (w, b) => inkLeft(w, w.ink, (c) => { c.globalCompositeOperation = 'destination-out'; c.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top); });
  /** Ink pixels of w inside rect b. */
  const insideOf = (w, b) => {
    const a = { top: Math.max(w.ink.top, b.top), bottom: Math.min(w.ink.bottom, b.bottom), left: Math.max(w.ink.left, b.left), right: Math.min(w.ink.right, b.right) };
    return a.right - a.left > 0 && a.bottom - a.top > 0 ? inkLeft(w, a) : 0;
  };
  /** Ink pixels where w and v overlap. */
  const bothOf = (w, v) => {
    const a = { top: Math.max(w.ink.top, v.ink.top, w.seen.top, v.seen.top), bottom: Math.min(w.ink.bottom, v.ink.bottom, w.seen.bottom, v.seen.bottom),
      left: Math.max(w.ink.left, v.ink.left, w.seen.left, v.seen.left), right: Math.min(w.ink.right, v.ink.right, w.seen.right, v.seen.right) };
    if (!(a.right - a.left > 0 && a.bottom - a.top > 0)) return 0;
    return inkLeft(w, a, (c) => { c.globalCompositeOperation = 'source-in'; c.font = v.font; v.runs.forEach((r) => c.fillText(r.text, r.x, r.base)); });
  };
  const MIN = 1; // css px² of ink: a real touch, not a rounding

  // What a word must never meet: pictures, emoji glyphs, layers that paint over the screen, and other controls' boxes.
  const ROOT = (cfg && cfg.root && document.querySelector(cfg.root)) || document.getElementById('sae-root') || document.body;
  const all = Array.from(ROOT.querySelectorAll('*')).filter((e) => {
    if (!visible(e)) return false;
    const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 1;
  });
  const blockers = all.filter((e) => {
    const c = getComputedStyle(e);
    if (/^(IMG|SVG|CANVAS|VIDEO|PICTURE)$/i.test(e.tagName) || c.backgroundImage !== 'none') return true;
    if (e.matches('.sae-jugnu-f,.sae-big-ico,.sae-pic-e,.sae-glyph,.sae-mic,.sae-ear,.sae-star-ico,.sae-clock,.sae-sync,.sae-dot,.sae-replay,.sae-mute,.sae-counter,.sae-key,.sae-meter')) return true;
    return false;
  });
  const boxes = all.filter((e) => boxy(e) && !e.matches('.sae-screen,.sae,#sae-root'));

  const words = [];
  const nodes = [];
  const fails = [];
  const touches = [];
  const mctx = document.createElement('canvas').getContext('2d');
  const tw = document.createTreeWalker(ROOT, NodeFilter.SHOW_TEXT);
  for (let tn = tw.nextNode(); tn; tn = tw.nextNode()) {
    const text = tn.nodeValue;
    if (!AR.test(text)) continue;
    const e = tn.parentElement;
    if (!visible(e)) continue;
    const whole = document.createRange(); whole.selectNodeContents(tn);
    if (!whole.getClientRects().length) continue; // in a closed <details>, or not laid out
    const c = getComputedStyle(e);
    const fsz = parseFloat(c.fontSize);
    const lh = c.lineHeight === 'normal' ? null : parseFloat(c.lineHeight);
    const coach = !!(cfg && cfg.coach) || !!e.closest(COACH);
    const node = { text: text.trim().slice(0, 80), sel: sel(e), font_px: r1(fsz), line_px: lh == null ? null : r1(lh), coach, face: /Nastaliq/i.test(c.fontFamily) && document.fonts.check(c.font, text), fails: [] };
    const nf = (kind, detail) => { if (node.fails.indexOf(kind) < 0) node.fails.push(kind); fails.push(Object.assign({ kind, text: node.text, sel: node.sel }, detail || {})); };
    if (!node.face) nf('face', { family: c.fontFamily.slice(0, 40) });
    if (fsz < (coach ? 14 : 16) - 0.01) nf('small', { font_px: node.font_px });
    if (lh != null && lh / fsz < 2 - 0.01) nf('tight', { ratio: r1(lh / fsz) });
    const clips = [];
    let holder = null;
    for (let n = e; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const nc = getComputedStyle(n);
      if (!holder && boxy(n) && !n.matches('.sae-screen,.sae,#sae-root,body')) holder = n;
      const ox = nc.overflowX; const oy = nc.overflowY;
      if (ox !== 'visible' || oy !== 'visible') {
        const ib = inner(n);
        const sx = ox === 'auto' || ox === 'scroll'; const sy = oy === 'auto' || oy === 'scroll';
        clips.push({ el: n, box: {
          top: sy ? ib.top - n.scrollTop : (oy === 'visible' ? -1e5 : ib.top),
          bottom: sy ? ib.top - n.scrollTop + n.scrollHeight : (oy === 'visible' ? 1e5 : ib.bottom),
          left: sx ? ib.left - n.scrollLeft : (ox === 'visible' ? -1e5 : ib.left),
          right: sx ? ib.left - n.scrollLeft + n.scrollWidth : (ox === 'visible' ? 1e5 : ib.right) } });
      }
      if (nc.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) nf('truncated', {});
    }
    // What of the word can be seen now: inside every clipping ancestor's visible box (a scroller's own window).
    let seen = { top: -1e5, bottom: 1e5, left: -1e5, right: 1e5 };
    for (let n = e; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const nc = getComputedStyle(n);
      if (nc.overflowX === 'visible' && nc.overflowY === 'visible') continue;
      const ib = inner(n);
      seen = { top: Math.max(seen.top, nc.overflowY === 'visible' ? -1e5 : ib.top), bottom: Math.min(seen.bottom, nc.overflowY === 'visible' ? 1e5 : ib.bottom),
        left: Math.max(seen.left, nc.overflowX === 'visible' ? -1e5 : ib.left), right: Math.min(seen.right, nc.overflowX === 'visible' ? 1e5 : ib.right) };
    }
    node.holder = holder ? sel(holder) : null;
    const hb = holder ? inner(holder) : null;
    node.holder_box = hb ? box(hb) : null;
    mctx.font = c.font; mctx.direction = 'ltr'; mctx.textAlign = 'left'; mctx.textBaseline = 'alphabetic';
    const re = /\S+/g; let m; let ink = null;
    while ((m = re.exec(text))) {
      const wtext = m[0];
      if (!AR.test(wtext)) continue;
      const rg = document.createRange(); rg.setStart(tn, m.index); rg.setEnd(tn, m.index + wtext.length);
      const rects = Array.from(rg.getClientRects()).filter((x) => x.width > 0);
      if (!rects.length) continue;
      const tops = new Set(rects.map((x) => Math.round(x.top)));
      const mt = mctx.measureText(wtext);
      // One run per line fragment; a word on one line is one run.
      const runs = rects.length === 1 ? [{ text: wtext, x: rects[0].left, base: rects[0].top + mt.fontBoundingBoxAscent }] : rects.map((x) => ({ text: wtext, x: x.left, base: x.top + mt.fontBoundingBoxAscent }));
      const r0 = rects[0];
      const pad = fsz * 1.5; // the ink box from the font's own extents, padded; the pixels decide
      const inkBox = { top: r0.top + mt.fontBoundingBoxAscent - mt.actualBoundingBoxAscent - 2, bottom: r0.top + mt.fontBoundingBoxAscent + mt.actualBoundingBoxDescent + 2,
        left: Math.min(r0.left, r0.left - mt.actualBoundingBoxLeft) - 2, right: Math.max(r0.right, r0.left + mt.actualBoundingBoxRight) + 2 };
      void pad;
      const w = { word: wtext, font: c.font, runs: runs.slice(0, 1), ink: inkBox, el: e, node: nodes.length, tops, seen };
      // A word scrolled out of its scroller's window is hidden, not covered: its overlaps are checked where it shows.
      const shows = meet(inkBox, seen);
      if (tops.size > 1) nf('broken', { word: wtext });
      clips.forEach((cl) => {
        const px = outsideOf(w, cl.box);
        if (px >= MIN) nf('clipped', { word: wtext, px: r1(px), ink: box(inkBox), clip: sel(cl.el), clip_box: box(cl.box) });
      });
      if (hb) { const px = outsideOf(w, hb); if (px >= MIN) nf('outside', { word: wtext, px: r1(px), ink: box(inkBox), holder: node.holder, holder_box: box(hb) }); }
      { const px = outsideOf(w, { top: -1e5, bottom: 1e5, left: 0, right: vw }); if (px >= MIN) nf('offscreen', { word: wtext, px: r1(px), ink: box(inkBox) }); }
      if (shows) blockers.concat(boxes).forEach((b) => {
        if (b === e || b.contains(e) || e.contains(b)) return;
        const r = b.getBoundingClientRect(); const bs = seenOf(b);
        const br = { top: Math.max(r.top, seen.top, bs.top), bottom: Math.min(r.bottom, seen.bottom, bs.bottom), left: Math.max(r.left, seen.left, bs.left), right: Math.min(r.right, seen.right, bs.right) };
        if (!meet(inkBox, br)) return;
        const px = insideOf(w, br);
        if (px >= MIN) nf('covered', { word: wtext, px: r1(px), ink: box(inkBox), by: sel(b), by_box: box(br) });
      });
      if (shows) words.push(w);
      ink = ink ? { top: Math.min(ink.top, inkBox.top), bottom: Math.max(ink.bottom, inkBox.bottom), left: Math.min(ink.left, inkBox.left), right: Math.max(ink.right, inkBox.right) } : inkBox;
    }
    node.ink = ink ? box(ink) : null;
    let near = null;
    if (ink) blockers.concat(boxes).forEach((b) => {
      if (b === e || b.contains(e) || e.contains(b)) return;
      const br = b.getBoundingClientRect();
      const d = Math.hypot(Math.max(0, br.left - ink.right, ink.left - br.right), Math.max(0, br.top - ink.bottom, ink.top - br.bottom));
      if (!near || d < near.gap) near = { sel: sel(b), gap: r1(d) };
    });
    node.nearest = near;
    nodes.push(node);
  }
  // Ink against ink: two words on different lines, or in different elements, never touch.
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i]; const b = words[j];
      if ((a.el === b.el || (a.el.closest('.sae-passage') && a.el.closest('.sae-passage') === b.el.closest('.sae-passage'))) && [...a.tops].some((t) => b.tops.has(t))) continue;
      if (!meet(a.ink, b.ink)) continue;
      const px = bothOf(a, b);
      if (px >= MIN) {
        const na = nodes[a.node];
        // Two lines of one paragraph whose strokes touch: spacing, reported (touch); glyphs meeting another element's: a failure.
        const para = (x) => x.el.closest('.sae-passage') || x.el;
        const kind = para(a) === para(b) ? 'touch' : 'collides';
        if (kind === 'collides' && na.fails.indexOf(kind) < 0) na.fails.push(kind);
        (kind === 'touch' ? touches : fails).push({ kind, text: na.text, sel: na.sel, word: a.word, other: b.word, other_sel: nodes[b.node].sel, px: r1(px), ink: box(a.ink), other_ink: box(b.ink) });
      }
    }
  }
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) fails.push({ kind: 'sideways', scroll_width: sw, viewport: vw });
  void cfg;
  // A word cut by its scroller's edge where the screen opens (half shown): reported (cut), the screen scrolls.
  const cut = words.filter((w) => w.ink.top < w.seen.top - 0.5 || w.ink.bottom > w.seen.bottom + 0.5).map((w) => ({ kind: 'cut', word: w.word, sel: nodes[w.node].sel }));
  return { nodes: nodes, fails: fails, touches: touches, cut: cut };
}

/** Draws the failures' boxes on the page (for the frame), returns a remover. */
function markInPage(fails) {
  const layer = document.createElement('div');
  layer.id = '__marks';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  const add = (b, color) => {
    if (!b) return;
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:${b.top}px;left:${b.left}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;outline:2px solid ${color}`;
    layer.appendChild(d);
  };
  fails.forEach((f) => { add(f.ink, 'red'); add(f.clip_box || f.holder_box || f.by_box || f.other_ink, 'blue'); });
  document.body.appendChild(layer);
}

function route(page, lang, vp) {
  return page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    const p = decodeURIComponent(u.pathname);
    if (p === '/') return r.fulfill({ body: pageHtml(lang), contentType: 'text/html; charset=utf-8' });
    if (p === '/__walk.js') return r.fulfill({ body: walkScript(), contentType: 'text/javascript' });
    const file = p.startsWith('/sa/') ? path.join(SA, p.slice(4)) : p.startsWith('/wq/') ? path.join(WQ, p.slice(4)) : null;
    if (vp && vp.textScale && file === path.join(SA, 'sa.css')) return r.fulfill({ body: scaledCss(fs.readFileSync(file, 'utf8'), vp.textScale), contentType: 'text/css' });
    if (file && file.startsWith(DASH) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file);
      const type = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' }[ext] || 'application/octet-stream';
      return r.fulfill({ path: file, contentType: type });
    }
    return r.fulfill({ status: 404, body: '' });
  });
}

/**
 * Walk one scenario at one viewport. onScreen(state, result, page) is called for each new screen.
 * Returns [{ key, state, nodes, fails }].
 */
async function walk(browser, sc, vp, opts = {}) {
  const lang = /\.en$/.test(sc.form) ? 'en' : 'ur';
  const { battery, manual } = batteryOf(sc, opts.variant || 0);
  if (opts.urFit) battery.ui = Object.assign({}, battery.ui, { ur_fit: true });
  if (opts.appAsks) battery.ui = Object.assign({}, battery.ui, { app_asks: true });
  if (opts.guided) battery.ui = Object.assign({}, battery.ui, { guided: true });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await route(page, lang, vp);
  if (process.env.SA_WALK_DEBUG) page.on('pageerror', (e) => process.stdout.write('PAGEERR ' + e.message + '\n'));
  await page.goto('http://sa.test/');
  if (opts.css) await page.addStyleTag({ content: opts.css });
  await page.evaluate((cfg) => window.__walk.setup(cfg), { battery, manual, mode: sc.mode, lang, child: opts.child, embed: opts.embed === true });
  // embed: the coach page's corner hold ("End test (coach)"), fixed over the engine's frame at top 8 px, 48 px tall, on
  // the coach's start side (portal AssessEngineSlot). A stand-in control at the same place, so the measure sees it.
  if (opts.embed) {
    await page.evaluate((side) => {
      const b = document.createElement('button');
      b.className = 'walk-coach-hold';
      b.setAttribute('aria-hidden', 'true');
      b.style.cssText = `position:fixed;top:8px;${side}:8px;width:120px;height:48px;z-index:1001;background:#fff;border:1px solid #cbd5e1;border-radius:12px`;
      document.body.appendChild(b);
    }, lang === 'ur' ? 'right' : 'left');
  }
  await page.evaluate(() => document.fonts.ready);
  const mcfg = opts.embed ? { root: 'body' } : {}; // embedded: the coach's hold over the frame counts too
  const out = [];
  const seen = new Set();
  const look = async (tag) => {
    await page.evaluate(() => document.fonts.ready);
    const st = await page.evaluate(() => window.__walk.state());
    const key = [st.shown, st.cls, st.task, st.practice, st.item, st.cell, tag || ''].join('|');
    if (seen.has(key)) return st;
    seen.add(key);
    const res = await page.evaluate(measureInPage, mcfg);
    // A screen that scrolls (the page, or a scroller in it) is measured again at its end, so every word is seen once.
    const scrolled = await page.evaluate(() => {
      let moved = false;
      [document.scrollingElement].concat(Array.from(document.querySelectorAll('#sae-root *'))).forEach((n) => {
        if (n && n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY + (n === document.scrollingElement ? 'auto' : ''))) { n.scrollTop = n.scrollHeight; moved = true; }
      });
      return moved;
    });
    if (scrolled) {
      const more = await page.evaluate(measureInPage, mcfg);
      const have = new Set(res.fails.map((f) => [f.kind, f.sel, f.word, f.other || f.by || ''].join('|')));
      more.fails.forEach((f) => { if (!have.has([f.kind, f.sel, f.word, f.other || f.by || ''].join('|'))) res.fails.push(Object.assign({ scrolled: true }, f)); });
      await page.evaluate(() => { [document.scrollingElement].concat(Array.from(document.querySelectorAll('#sae-root *'))).forEach((n) => { if (n) n.scrollTop = 0; }); });
    }
    const rec = { key, state: st, nodes: res.nodes, fails: res.fails, touches: res.touches, cut: res.cut, scrolls: scrolled };
    out.push(rec);
    if (opts.onScreen) await opts.onScreen(rec, page, out.length);
    return st;
  };
  await page.evaluate(() => window.__walk.refuse(true));
  await look('refused');
  await page.evaluate(() => window.__walk.refuse(false));
  for (let i = 0; i < (opts.maxSteps || 600); i++) {
    await look();
    const did = await page.evaluate(() => window.__walk.step());
    if (process.env.SA_WALK_DEBUG) process.stdout.write(`step ${i} ${did} ${JSON.stringify(await page.evaluate(() => window.__walk.state()))}\n`);
    if (did === 'end' || /^stuck/.test(did)) { if (/^stuck/.test(did)) out.push({ key: did, state: {}, nodes: [], fails: [{ kind: 'stuck', detail: did }] }); break; }
    await page.waitForTimeout(opts.settleMs == null ? 30 : opts.settleMs);
  }
  await ctx.close();
  return out;
}

module.exports = { UI_FLAGS, VIEWPORTS, scaledCss, scenarios, batteryOf, walk, markInPage, measureInPage, FORMS };
