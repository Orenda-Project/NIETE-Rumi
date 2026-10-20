/**
 * The big flight's skin for the child's page (/sa/play.html?...&skin=game; switch sa_engine, opened from the game
 * page behind sa_game). The engine owns every item, word, clock and stop rule; the skin only frames them:
 *
 *   - registers SAE.sinks.game({session_id}) → the game sink (sink-game.js) with the run token the game page kept
 *     for that session (localStorage sg.st.<session id>); none kept → no sink (the run stays on the phone)
 *   - Jugnu's glow in the corner while a timed task runs, shrinking with the engine's own time_left_ms
 *   - the child pages' sound kit (WQJ): a soft chime when a task ends, the fanfare when the part ends, and one mute for
 *     that music and those sounds only: Jugnu's instructions and prompts are part of the measure and always play
 *   - never a right/wrong sound on a scored item (the engine's correct/incorrect events are ignored)
 *
 * It finds the engine at window.__sae (sa-page.js sets it once started) and attaches once. ES5, no build.
 */
(function (W) {
  'use strict';
  if (!W || !W.document || W.__saSkin) return;
  W.__saSkin = true;
  var D = W.document;
  var SAE = W.SAE = W.SAE || {};

  function script(src) { var s = D.createElement('script'); s.src = src; s.async = true; D.head.appendChild(s); return s; }
  function css(href) { var l = D.createElement('link'); l.rel = 'stylesheet'; l.href = href; D.head.appendChild(l); }
  function kept(id) { try { return W.localStorage.getItem('sg.st.' + id); } catch (_) { return null; } }

  // the game sink, for sa-page.js: only when the game page kept this session's run token
  SAE.sinks = SAE.sinks || {};
  // sink-game.js may still be on its way when the page asks: each call waits for it (≤ 10 s), then forwards
  var sinkReady = new Promise(function (ok) {
    if (SAE.sinkGame) { ok(SAE.sinkGame); return; }
    var s = script('/sa/sink-game.js');
    s.onload = function () { ok(SAE.sinkGame || null); };
    s.onerror = function () { ok(null); };
    W.setTimeout(function () { ok(SAE.sinkGame || null); }, 10000);
  });
  SAE.sinks.game = function (o) {
    var st = o && o.session_id ? kept(o.session_id) : null;
    if (!st) return null;
    var real = sinkReady.then(function (m) { return m && typeof m.create === 'function' ? m.create({ st: st, session_id: o.session_id }) : null; });
    var call = function (name) {
      return function () {
        var args = arguments;
        return real.then(function (s) { if (!s || typeof s[name] !== 'function') throw new Error('sink_unavailable'); return s[name].apply(s, args); });
      };
    };
    return { putBatch: call('putBatch'), presignAudio: call('presignAudio'), registerAudio: call('registerAudio'), status: call('status') };
  };
  if (!W.WQJ) { css('/wq/wq-juice.css'); script('/wq/wq-juice.js'); }
  function J() { return W.WQJ || null; }

  // Jugnu's glow: the corner firefly, its light the share of the minute left
  var glow = D.createElement('div');
  glow.className = 'sg-glow';
  glow.setAttribute('aria-hidden', 'true');
  glow.innerHTML = '<img src="/wq/jugnu/idle.webp" alt="">';
  function paint(v) {
    var lim = v && v.phase === 'running' && v.task && v.task.time_limit_s ? v.task.time_limit_s * 1000 : 0;
    if (!lim || v.time_left_ms == null) { glow.className = 'sg-glow'; return; }
    glow.className = 'sg-glow is-on';
    glow.style.setProperty('--glow', String(Math.max(0, Math.min(1, v.time_left_ms / lim))));
  }

  // the one sound switch: the kit's music and sounds only (never Jugnu's words)
  var btn = D.createElement('button');
  btn.type = 'button';
  btn.className = 'sg-mute';
  function drawMute() { var m = J() ? J().muted() : false; btn.textContent = m ? '🔇' : '🔊'; btn.setAttribute('aria-pressed', m ? 'true' : 'false'); }

  function attach(engine) {
    D.body.appendChild(glow);
    D.body.appendChild(btn);
    drawMute();
    btn.addEventListener('click', function () {
      if (!J()) return;
      J().mute(!J().muted());
      drawMute();
    });
    engine.on('state', paint);
    engine.on('task_end', function () { if (J()) J().sentence(); });
    engine.on('battery_end', function () { paint(null); if (J()) J().finish({ el: D.body, kind: 'flight' }); });
  }

  var tries = 0;
  (function wait() {
    if (W.__sae && typeof W.__sae.on === 'function') { attach(W.__sae); return; }
    if (++tries < 600) W.setTimeout(wait, 100);
  }());
}(typeof window !== 'undefined' ? window : null));
