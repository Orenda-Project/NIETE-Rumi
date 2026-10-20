/*
 * The big flight (switch sa_game): the reading and number battery as a game, on the battery engine (/sa/*, sa_engine).
 *
 * A sea map: Numbers, English and Urdu islands, then the Big flight tower. An island is the form's `islands.<subject>`
 * list and the tower its `tower` list (else by task id), from the form's battery file, run by the engine in game mode. The
 * engine owns every item, instruction, practice item, clock and stop rule; this page only frames it: the map, the
 * stones, Jugnu's glow as the clock while a timed task runs, a sound on each task finished, a result card per subject
 * with effort stars (finished every stone, did the practice, kept going to the end) — never a score, never a hint.
 *
 * Boot (#boot): { token, kid, lang, form, grade, bank (the form's battery file), engine: [urls], juice: {js, css} }. No test words
 * on any screen (the tower is a flight, never an exam). Progress lives on the phone
 * (localStorage sg.<kid>.<form>, a convenience only: the engine's own store keeps every answer). ES5, no build.
 */
(function (W) {
  'use strict';
  var D = W.document;
  var boot;
  try { boot = JSON.parse(D.getElementById('boot').textContent); } catch (_) { return; }
  var L = boot.lang === 'en' ? 'en' : 'ur';
  var root = D.getElementById('sg');

  var T = {
    en: {
      map: 'Cross the three islands, then take the Big flight!',
      maths: 'Numbers Island', english: 'English Island', urdu: 'Urdu Island', tower: 'Big flight',
      go: "Let's go", start: 'Start', back: 'Back', toMap: 'Back to the map', next: 'Next island', climb: 'Take the Big flight',
      locked: 'Cross all three islands first, then the Big flight opens.',
      stones: function (n) { return n + ' stones on this island. Try a few first, then play.'; },
      towerSay: function (n) { return 'The Big flight: all ' + n + ' stones, one after another.'; },
      timed: 'On a ⏱ stone, Jugnu\'s light lasts one minute. Do as many as you can.',
      crossed: function (s) { return s + ': crossed!'; }, towerDone: 'Big flight: done!',
      finished: 'Finished', notYet: 'Not yet',
      star1: 'You finished every stone', star2: 'You did the practice', star3: 'You kept going to the end',
      notReady: 'This is still getting ready. Come back soon.', mute: 'Sound off', unmute: 'Sound on',
      saved: 'Saved on this phone',
    },
    ur: {
      map: 'تینوں جزیرے پار کریں، پھر بڑی اڑان بھریں!',
      maths: 'گنتی کا جزیرہ', english: 'انگریزی کا جزیرہ', urdu: 'اردو کا جزیرہ', tower: 'بڑی اڑان',
      go: 'چلیں', start: 'شروع کریں', back: 'واپس', toMap: 'نقشے پر واپس', next: 'اگلا جزیرہ', climb: 'بڑی اڑان بھریں',
      locked: 'بڑی اڑان کے لیے پہلے تینوں جزیرے پار کریں۔',
      stones: function (n) { return 'اس جزیرے پر ' + ud(n) + ' پتھر ہیں۔ پہلے مشق، پھر کھیل۔'; },
      towerSay: function (n) { return 'بڑی اڑان: سارے ' + ud(n) + ' پتھر، ایک کے بعد ایک۔'; },
      timed: '⏱ والے پتھر پر جگنو کی روشنی ایک منٹ چلتی ہے۔ جتنا ہو سکے، کریں۔',
      crossed: function (s) { return s + ' پار!'; }, towerDone: 'بڑی اڑان پوری!',
      finished: 'پورا کیا', notYet: 'ابھی نہیں',
      star1: 'آپ نے ہر پتھر پورا کیا', star2: 'آپ نے مشق کی', star3: 'آپ نے آخر تک کوشش جاری رکھی',
      notReady: 'یہ ابھی تیار ہو رہا ہے۔ تھوڑی دیر بعد دوبارہ آئیں۔', mute: 'آواز بند', unmute: 'آواز چالو',
      saved: 'اس فون پر محفوظ',
    },
  }[L];
  var ISLANDS = ['maths', 'english', 'urdu'];
  var ICON = { maths: '1 2 3', english: 'A b c', urdu: 'ا ب پ' };
  // where each island sits on the 360-wide map (percent of the map box), and Jugnu beside it
  var AT = { maths: [8, 66], english: [52, 46], urdu: [10, 30], tower: [50, 0] };

  function ud(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function J() { return W.WQJ || null; }
  function title(t) { return (t && t.title && (t.title[L] || t.title.en)) || (t && t.id) || ''; }

  // ---- progress on the phone (a convenience; never the record) ----
  var KEY = 'sg.' + boot.kid + '.' + boot.form;
  function load() { try { return JSON.parse(W.localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } }
  function save(p) { try { W.localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) { /* private window: the run still works */ } }
  var prog = load();
  prog.done = prog.done || {};
  prog.runs = prog.runs || {};

  // ---- the battery and the engine, loaded after the first paint ----
  var battery = null;
  var ready = null;
  function script(src) {
    return new Promise(function (ok) {
      var s = D.createElement('script'); s.src = src; s.async = false; s.onload = ok; s.onerror = ok; D.head.appendChild(s);
    });
  }
  function css(href) { var l = D.createElement('link'); l.rel = 'stylesheet'; l.href = href; D.head.appendChild(l); }
  function prepare() {
    if (ready) return ready;
    if (boot.juice) { css(boot.juice.css); script(boot.juice.js); }
    css('/sa/sa.css');
    var eng = Promise.all((boot.engine || []).map(script));
    var bank = fetch(boot.bank, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    ready = Promise.all([eng, bank]).then(function (a) { battery = asBattery(a[1]); return battery; });
    return ready;
  }

  // The file in either of the item set's shapes: a battery ({battery_id, tasks: [...]}) as it is, or a bank
  // ({forms: {<form>: {order, islands, tower}}, tasks: {"<form>/<task>": …}}) read into one for this form.
  function asBattery(f) {
    if (f && Array.isArray(f.tasks)) return f.tasks.length ? f : null;
    var form = f && f.forms && f.forms[boot.form];
    if (!form || !f.tasks) return null;
    var tasks = (form.order || []).map(function (id) { var t = f.tasks[boot.form + '/' + id]; if (!t) return null; var o = {}; for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) o[k] = t[k]; o.id = t.id || id; return o; }).filter(Boolean);
    return tasks.length ? { battery_id: boot.form + '.' + L, version: f.version, form: boot.form, lang: L, lines: f.lines, islands: form.islands, tower: form.tower, tasks: tasks } : null;
  }

  // the form's battery (the engine's own file): an island is its `islands.<subject>` list when the file names one, else
  // the subject's tasks by id (ma. / en. / ur.); the flight is the `tower` list, else every task in the file's order
  var PREFIX = { maths: 'ma.', english: 'en.', urdu: 'ur.' };
  function idsOf(where) {
    var all = battery.tasks.map(function (t) { return t.id; });
    if (where === 'tower') return Array.isArray(battery.tower) ? battery.tower : all;
    if (battery.islands && Array.isArray(battery.islands[where])) return battery.islands[where];
    return all.filter(function (id) { return String(id).indexOf(PREFIX[where]) === 0; });
  }
  function byId(id) { for (var i = 0; i < battery.tasks.length; i++) if (battery.tasks[i].id === id) return battery.tasks[i]; return null; }
  function timedOf(t) { return Boolean(t.timed_s || (t.tap && t.tap.time_limit_s) || (t.record && t.record.time_limit_s)); }
  function tasksOf(where) {
    if (!battery) return [];
    return idsOf(where).map(byId).filter(Boolean).map(function (t) { return { id: t.id, title: t.title, timed: timedOf(t) }; });
  }
  // the engine runs a battery: this part's is the file with its tasks narrowed to the part's, in the part's order
  function partOf(where) {
    var b = {}; for (var k in battery) if (Object.prototype.hasOwnProperty.call(battery, k)) b[k] = battery[k];
    b.battery_id = battery.battery_id + '.' + where;
    b.tasks = idsOf(where).map(byId).filter(Boolean);
    return b;
  }

  // ---- the shared top bar: back, the title, the one sound switch ----
  function soundIcon() { var m = J() && J().muted(); return m ? '🔇' : '🔊'; }
  function top(label, backTo) {
    return '<div class="sg-top">' + (backTo ? '<button class="sg-ico" data-tap="' + backTo + '" aria-label="' + esc(T.back) + '">‹</button>' : '<span style="width:48px"></span>') +
      '<div class="sg-grow">' + esc(label || '') + '</div><button class="sg-ico" data-tap="mute" aria-label="' + esc(T.mute) + '">' + soundIcon() + '</button></div>';
  }
  function show(html, cls) {
    root.innerHTML = '<section class="sg-scr ' + (cls || 'sg-land') + '">' + html + '</section>';
    W.scrollTo(0, 0);
  }

  // ---- the map ----
  function allIslands() { return ISLANDS.every(function (k) { return prog.done[k]; }); }
  function nextIsland() { for (var i = 0; i < ISLANDS.length; i++) if (!prog.done[ISLANDS[i]]) return ISLANDS[i]; return 'tower'; }
  function map() {
    var nx = nextIsland();
    var isl = ISLANDS.map(function (k) {
      var p = AT[k];
      return '<button class="sg-isl' + (prog.done[k] ? ' is-done' : '') + (k === nx ? ' is-next' : '') + '" style="left:' + p[0] + '%;top:' + p[1] + '%" data-tap="island" data-k="' + k + '">' +
        '<i' + (k === 'urdu' ? ' dir="rtl" style="font-family:var(--fu)"' : ' dir="ltr"') + '>' + esc(ICON[k]) + '</i><span>' + esc(T[k]) + '</span></button>';
    }).join('');
    var open = allIslands();
    var tw = '<button class="sg-tower' + (open ? ' is-open' : '') + '" data-tap="island" data-k="tower"><div class="sg-tw">' + (prog.done.tower ? '⭐' : open ? '✨' : '🔒') + '</div><span>' + esc(T.tower) + '</span></button>';
    var jp = AT[nx] || AT.tower;
    var jug = '<img class="sg-jug sg-bob" src="/wq/jugnu/hello.webp" alt="" style="left:calc(' + jp[0] + '% + ' + (nx === 'tower' ? 70 : 104) + 'px);top:calc(' + jp[1] + '% + 30px)">';
    var path = '<svg class="sg-path" viewBox="0 0 360 440" preserveAspectRatio="none"><path d="M70 330 C 60 300, 210 260, 230 230 S 70 170, 90 150 S 180 120, 180 90" stroke="#fff" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" fill="none" opacity=".9"/></svg>';
    show(top('', null) + '<div class="sg-say">' + esc(T.map) + '</div><div class="sg-map">' + path + tw + isl + jug + '</div>' +
      '<button class="sg-btn" data-tap="island" data-k="' + nx + '">' + esc(nx === 'tower' ? T.climb : T[nx]) + '</button>', 'sg-sea');
    prepare();
  }

  // ---- an island's intro: its stones ----
  function stonesHtml(tasks, now, done) {
    return '<div class="sg-stones">' + tasks.map(function (t, i) {
      var cls = done && done[t.id] ? ' is-done' : i === now ? ' is-now' : '';
      return '<div class="sg-stone' + cls + '">' + (t.timed ? '<b>⏱</b>' : '') + esc(title(t)) + '</div>';
    }).join('') + '</div>';
  }
  function intro(k) {
    if (k === 'tower' && !allIslands()) {
      show(top(T.tower, 'map') + '<div class="sg-grow"></div><img src="/wq/jugnu/sleep.webp" alt="" width="120" style="margin:0 auto"><p class="sg-note">' + esc(T.locked) + '</p><div class="sg-grow"></div><button class="sg-btn" data-tap="map">' + esc(T.toMap) + '</button>');
      return;
    }
    show(top(T[k], 'map') + '<div class="sg-grow"></div><img src="/wq/jugnu/hello.webp" alt="" width="96" style="margin:0 auto"><p class="sg-note">…</p><div class="sg-grow"></div>');
    prepare().then(function () {
      if (!battery || !W.SAE || typeof W.SAE.start !== 'function' || !tasksOf(k).length) {
        show(top(T[k], 'map') + '<div class="sg-grow"></div><img src="/wq/jugnu/sleep.webp" alt="" width="120" style="margin:0 auto"><p class="sg-note">' + esc(T.notReady) + '</p><div class="sg-grow"></div><button class="sg-btn" data-tap="map">' + esc(T.toMap) + '</button>');
        return;
      }
      var tasks = tasksOf(k);
      show(top(T[k], 'map') + '<div style="display:flex;gap:8px;align-items:flex-end;padding:0 16px"><img src="/wq/jugnu/idle.webp" alt="" width="80" class="sg-bob"><div class="sg-say" style="flex:1;margin:0">' +
        esc(k === 'tower' ? T.towerSay(tasks.length) : T.stones(tasks.length)) + '</div></div>' + stonesHtml(tasks, 0, null) +
        (tasks.some(function (t) { return t.timed; }) ? '<p class="sg-note">' + esc(T.timed) + '</p>' : '') +
        '<div class="sg-grow"></div><button class="sg-btn" data-tap="run" data-k="' + k + '">' + esc(T.start) + '</button>');
    });
  }

  // ---- a run: the engine's screens, framed ----
  var engine = null;
  var glow = null;
  function setGlow(v) {
    if (!glow) return;
    var t = v && v.phase === 'running' ? v.task : null;
    var s = t ? (t.timed_s || t.time_limit_s || (t.tap && t.tap.time_limit_s) || (t.record && t.record.time_limit_s)) : 0;
    var lim = v && v.time_limit_ms ? v.time_limit_ms : s ? s * 1000 : 0;
    if (!lim || v.time_left_ms == null) { glow.className = 'sg-glow'; return; }
    glow.className = 'sg-glow is-on';
    glow.style.setProperty('--glow', String(Math.max(0, Math.min(1, v.time_left_ms / lim))));
  }
  function run(k) {
    if (engine) { try { engine.destroy(); } catch (_) { /* gone */ } engine = null; }
    var tasks = tasksOf(k);
    var n = (prog.runs[k] || 0) + 1;
    prog.runs[k] = n; save(prog);
    var seen = { practice: false, ended: {}, early: false };
    show(top(T[k], null) + '<div class="sg-run" id="sg-run"></div><div class="sg-glow" id="sg-glow"><img src="/wq/jugnu/idle.webp" alt=""></div>');
    glow = D.getElementById('sg-glow');
    var started = W.SAE.start({
      mount: D.getElementById('sg-run'), battery: partOf(k), mode: 'game', lang: L,
      session_id: ['g', boot.kid, boot.form, k, n].join('.'),
      sink: W.SAG && W.SAG.sink ? W.SAG.sink(boot, k) : undefined,
    });
    Promise.resolve(started).then(function (e) {
      engine = e;
      if (J() && J().muted()) e.mute(true);
      e.on('state', setGlow);
      e.on('practice_feedback', function () { seen.practice = true; });
      e.on('task_end', function (ev) {
        var r = (ev && ev.value) || {};
        seen.ended[r.task_id || ev.task_id] = true;
        if (r.stop_reason && r.stop_reason !== 'complete' && r.stop_reason !== 'time_up') seen.early = true;
        if (J()) J().sentence();
      });
      e.on('battery_end', function () { setGlow(null); done(k, tasks, seen); });
    }, function () { intro(k); });
  }

  // ---- the result card: what was finished, effort stars; never a score ----
  function done(k, tasks, seen) {
    prog.done[k] = true; save(prog);
    var all = tasks.every(function (t) { return seen.ended[t.id]; });
    var stars = [all, seen.practice, !seen.early];
    var rows = tasks.map(function (t) { return '<div><span>' + esc(title(t)) + '</span><em>' + (seen.ended[t.id] ? '✓ ' + esc(T.finished) : esc(T.notYet)) + '</em></div>'; }).join('');
    var why = [T.star1, T.star2, T.star3].map(function (s, i) { return stars[i] ? '★ ' + esc(s) : ''; }).filter(Boolean).join('<br>');
    var nx = nextIsland();
    show(top('', null) + '<div class="sg-card" id="sg-card"><img src="/wq/jugnu/celebrate.webp" alt="" width="110" class="sg-bob"><h2>' + esc(k === 'tower' ? T.towerDone : T.crossed(T[k])) + '</h2>' +
      '<div class="sg-stars">' + stars.map(function (s) { return s ? '★' : '<s>★</s>'; }).join('') + '</div><div class="sg-why">' + why + '</div><div class="sg-rows">' + rows + '</div>' +
      '<div class="sg-sync">' + esc(T.saved) + '</div></div><div class="sg-grow"></div>' +
      (k !== 'tower' ? '<button class="sg-btn" data-tap="island" data-k="' + nx + '">' + esc(nx === 'tower' ? T.climb : T.next) + '</button><div style="height:12px"></div>' : '') +
      '<button class="sg-btn" style="background:#fff;color:var(--ink);box-shadow:0 5px 0 var(--line)" data-tap="map">' + esc(T.toMap) + '</button>', 'sg-sea');
    if (J()) J().finish({ el: D.getElementById('sg-card'), kind: k === 'tower' ? 'big' : 'island' });
  }

  // ---- taps ----
  D.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-tap]') : null;
    if (!b) return;
    if (J()) J().tap();
    var tap = b.getAttribute('data-tap');
    var k = b.getAttribute('data-k');
    if (tap === 'map') { if (engine) { try { engine.destroy(); } catch (_) { /* gone */ } engine = null; } map(); }
    else if (tap === 'island') intro(k);
    else if (tap === 'run') run(k);
    else if (tap === 'mute' && J()) { J().mute(!J().muted()); if (engine) engine.mute(J().muted()); b.textContent = soundIcon(); }
  });
  W.addEventListener('pagehide', function () { if (engine && engine.flushed) engine.flushed(); });

  W.SG = { map: map, intro: intro, run: run, _prog: function () { return prog; } };
  map();
}(window));
