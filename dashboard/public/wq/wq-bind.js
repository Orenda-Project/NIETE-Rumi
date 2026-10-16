/* "Keep your place on WhatsApp" (web_quiz_phone_bind): the card, the confirm sheet with the notice, the wa.me
 * hand-off, and "Saved ✓ — not your family's phone? Undo" when the page comes back into view.
 * No framework, no build step. The edge links this file only when the hub JSON carries `bind`.
 *
 *   window.WQBIND.card(mountEl, {hub, kid, first, lang, practice, ev})  draw the card (false when it must not show)
 *   window.WQBIND.onFocus()          ask the bot how the code this session minted went
 *   window.WQBIND.t(lang)            this file's copy (the hub picker's "Who is playing?" and its avatar line)
 *   window.WQBIND.chipExtra(kid, lang)  a picker chip's second line (father's first name / "played on this phone")
 *
 * Kept on the device: sessionStorage `wq_bind` {code, kid} for this session only; localStorage `wq_bind_later`
 * (until when the card stays hidden: "Not now" or Undo, 7 days). Never a phone number, never a name. */
(function () {
  'use strict';
  var LATER_KEY = 'wq_bind_later';
  var CODE_KEY = 'wq_bind';
  var HIDE_KEY = 'wq_bind_hide';
  var WEEK_MS = 7 * 86400000;
  var T = {
    en: {
      cardTitle: "Keep your place on WhatsApp",
      cardSub: "Then sending /quiz opens this page and your stickers again.",
      cardBtn: "Keep my place",
      cardLater: "Not now",
      isYou: function (name) { return "" + name + ", is this you?"; },
      yes: "Yes, it's me",
      no: "No, it's not me",
      noticeSave: function (name) { return "Jugnu will save this phone number with " + name + "'s name until the end of the school year (31 March), longer only if you keep playing."; },
      noticeStopPhoneOnly: "A grown-up can undo this any time by sending STOP on WhatsApp.",
      noticeReadings: function (name) { return "Readings " + name + " makes with the microphone are kept too."; },
      whoSends: "A grown-up sends one WhatsApp message from this phone.",
      sendBtn: "Send on WhatsApp",
      validHour: "This code works for the next hour.",
      saved: "Saved ✓",
      undoQ: "Not your family's phone?",
      undo: "Undo",
      undone: "Removed. This phone number is not kept.",
      refusedTeacher: "This is a teacher's phone, so a child's place is not saved on it.",
      refusedFull: "This phone already keeps four children's places.",
      refusedPhones: "This child's place is already saved on three phones.",
      codeExpired: "That took too long. Tap Keep my place again.",
      tryAgain: "Your place wasn't saved just now. Please tap again.",
      whoPlaying: "Who is playing?",
      whoPlayedHere: "Played on this phone before",
    },
    ur: {
      cardTitle: "اپنی جگہ واٹس ایپ پر محفوظ کریں",
      cardSub: "پھر \u2066/quiz\u2069 بھیجنے سے یہ صفحہ اور آپ کے اسٹیکر دوبارہ کھل جائیں گے۔",
      cardBtn: "میری جگہ محفوظ کریں",
      cardLater: "ابھی نہیں",
      isYou: function (name) { return "\u2068" + name + "\u2069، کیا یہ آپ ہیں؟"; },
      yes: "جی ہاں، یہ میں ہوں",
      no: "یہ میں نہیں ہوں",
      // the first clause is the ruled one (a link, never a rename); the retention clause is the deck's
      noticeSave: function (name) { return "جگنو اس فون نمبر کو ⁨" + name + "⁩ کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔"; },
      noticeStopPhoneOnly: "گھر کے بڑے کسی بھی وقت واٹس ایپ پر ⁦STOP⁩ بھیج کر یہ نمبر ہٹا سکتے ہیں۔",
      noticeReadings: function (name) { return "مائیک پر ⁨" + name + "⁩ کی پڑھائی کی ریکارڈنگ بھی رکھی جاتی ہے۔"; },
      whoSends: "پھر گھر کے بڑے اس فون سے واٹس ایپ پر ایک پیغام بھیجیں۔",
      sendBtn: "واٹس ایپ پر بھیجیں",
      validHour: "یہ کوڈ اگلے ایک گھنٹے تک کام کرے گا۔",
      saved: "محفوظ ہو گیا ✓",
      undoQ: "یہ آپ کے گھر کا فون نہیں؟",
      undo: "واپس لیں",
      undone: "ہٹا دیا گیا۔ یہ فون نمبر اب محفوظ نہیں۔",
      refusedTeacher: "یہ ٹیچر کا فون ہے، اس لیے اس پر بچے کی جگہ محفوظ نہیں ہوتی۔",
      refusedFull: "اس فون پر پہلے ہی چار بچوں کی جگہ محفوظ ہے۔",
      refusedPhones: "اس بچے کی جگہ پہلے ہی تین فونوں پر محفوظ ہے۔",
      codeExpired: "اس میں دیر ہو گئی۔ دوبارہ «میری جگہ محفوظ کریں» دبائیں۔",
      tryAgain: "ابھی جگہ محفوظ نہیں ہو سکی۔ دوبارہ دبائیں۔",
      whoPlaying: "کھیلنے کے لیے اپنا نام چنیں",
      whoPlayedHere: "پہلے بھی اسی فون پر کھیلا گیا",
    },
  };
  var view = { shown: false, mount: null, ctx: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // /quiz and STOP keep their own direction inside an Urdu line: the isolate in the string AND an ltr chip on the page.
  function chips(html) {
    var h = String(html)
      .replace(/⁦?\/quiz⁩?/g, '⁦<bdi dir="ltr" class="wqb-chip">/quiz</bdi>⁩')
      .replace(/⁦?\bSTOP\b⁩?/g, '⁦<bdi dir="ltr" class="wqb-chip">STOP</bdi>⁩');
    // «واٹس ایپ» is one word on the page: never «واٹس / ایپ» across a line (native read, page note 2; wq-tel.js WQT.nowrap)
    return window.WQT && window.WQT.nowrap ? window.WQT.nowrap(h) : h;
  }
  function L(lang) { return T[lang === 'ur' ? 'ur' : 'en']; }
  function sget(st, k) { try { return st.getItem(k); } catch (e) { return null; } }
  function sset(st, k, v) { try { if (v == null) st.removeItem(k); else st.setItem(k, v); } catch (e) {} }
  function later() { return Number(sget(localStorage, LATER_KEY)) > Date.now(); }
  function hideWeek() { sset(localStorage, LATER_KEY, String(Date.now() + WEEK_MS)); }
  function kept() { try { return JSON.parse(sget(sessionStorage, CODE_KEY) || 'null'); } catch (e) { return null; } }
  function api(method, path, body) {
    var init = { method: method, headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/wq/' + path, init).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return j || {}; });
    });
  }
  function ev(n, props) { try { if (view.ctx && typeof view.ctx.ev === 'function') view.ctx.ev(n, props); } catch (e) {} }
  function draw(html) {
    if (!view.mount) return;
    view.mount.innerHTML = html ? '<div class="wqb-card" dir="' + (view.ctx.lang === 'ur' ? 'rtl' : 'ltr') + '">' + html + '</div>' : '';
  }
  function on(b, fn) { var el = view.mount && view.mount.querySelector('[data-b="' + b + '"]'); if (el) el.addEventListener('click', fn); return el; }
  function msg(text, extra) { draw('<p class="wqb-msg" role="status">' + chips(esc(text)) + '</p>' + (extra || '')); }

  function cardHtml() {
    var t = L(view.ctx.lang);
    return '<h3 class="wqb-title">' + esc(t.cardTitle) + '</h3><p class="wqb-sub">' + chips(esc(t.cardSub)) + '</p>' +
      // Urdu: the two buttons stacked full width, so «میری جگہ محفوظ کریں» never leaves «کریں» alone on a second line
      '<div class="wqb-row' + (view.ctx.lang === 'ur' ? ' wqb-stack' : '') + '"><button type="button" class="wqb-btn wqb-go" data-b="keep">' + esc(t.cardBtn) + '</button>' +
      '<button type="button" class="wqb-btn wqb-ghost" data-b="later">' + esc(t.cardLater) + '</button></div>';
  }
  function showCard() {
    draw(cardHtml());
    on('keep', sheet);
    on('later', function () { hideWeek(); draw(''); });
  }
  // The confirm sheet: the child's first name, the notice (what is kept, until when, how to remove it), who sends,
  // and two answers with nothing preselected.
  function sheet() {
    var t = L(view.ctx.lang);
    var raw = view.ctx.first || '';
    var name = esc(raw);   // the title line inserts it as-is; the notice lines escape the whole sentence, so they take the raw name
    draw('<h3 class="wqb-title">' + t.isYou(name) + '</h3>' +
      // the two answers come before the notice, so both are on screen at 360x640 once the sheet's top is scrolled into view
      '<p class="wqb-sub">' + chips(esc(t.whoSends)) + '</p>' +
      '<div class="wqb-row wqb-stack"><button type="button" class="wqb-btn wqb-go" data-b="yes">' + esc(t.yes) + '</button>' +
      '<button type="button" class="wqb-btn wqb-ghost" data-b="no">' + esc(t.no) + '</button></div>' +
      '<div class="wqb-notice"><p>' + chips(esc(t.noticeSave(raw))) + '</p>' + (t.noticeReadings ? '<p>' + chips(esc(t.noticeReadings(raw))) + '</p>' : '') + '<p>' + chips(esc(t.noticeStopPhoneOnly)) + '</p></div>');
    // the sheet may open below the fold on a small screen: bring its top into view (guarded; older browsers lack it)
    try { if (view.mount && typeof view.mount.scrollIntoView === 'function') view.mount.scrollIntoView({ block: 'start' }); } catch (e) {}
    on('yes', confirm);
    on('no', function () { draw(''); });
  }
  function refusal(why) {
    var t = L(view.ctx.lang);
    if (why === 'teacher_phone') return t.refusedTeacher;
    if (why === 'max_kids') return t.refusedFull;
    if (why === 'max_phones') return t.refusedPhones;
    if (why === 'code_expired' || why === 'expired') return t.codeExpired;
    return null;
  }
  function confirm() {
    var c = view.ctx;
    api('POST', 'bind/mint', { hub: c.hub, kid: c.kid, lang: c.lang === 'ur' ? 'ur' : 'en' }).then(function (r) {
      if (r && r.ok && r.code && r.href) {
        sset(sessionStorage, CODE_KEY, JSON.stringify({ code: r.code, kid: c.kid }));
        var t = L(c.lang);
        draw('<p class="wqb-sub">' + chips(esc(t.whoSends)) + '</p><a class="wqb-btn wqb-go wqb-wa" data-b="send" href="' + esc(r.href) + '" target="_blank" rel="noopener">' + esc(t.sendBtn) + '</a>' +
          '<p class="wqb-sub">' + esc(t.validHour) + '</p>');
        on('send', function () { ev('bind_sent', { w: 'p' }); });
        return;
      }
      // max_phones: the child is already kept on three phones -> its line, and no card again this session.
      if (r && r.refused === 'max_phones') sset(sessionStorage, HIDE_KEY, '1');
      var m = r && refusal(r.refused);
      if (m) msg(m); else tryAgain();
    }).catch(function () { tryAgain(); });
  }
  // A save that failed without a known reason (or a network error): say so and keep Yes so the parent can tap again.
  function tryAgain() {
    var t = L(view.ctx.lang);
    msg(t.tryAgain, '<div class="wqb-row wqb-stack"><button type="button" class="wqb-btn wqb-go" data-b="yes">' + esc(t.yes) + '</button></div>');
    on('yes', confirm);
  }
  function banner() {
    var t = L(view.ctx.lang);
    draw('<p class="wqb-saved">' + esc(t.saved) + '</p><p class="wqb-sub">' + esc(t.undoQ) + '</p>' +
      '<div class="wqb-row"><button type="button" class="wqb-btn wqb-ghost" data-b="undo">' + esc(t.undo) + '</button>' +
      '<button type="button" class="wqb-x" data-b="close" aria-label="×">×</button></div>');
    on('close', function () { sset(sessionStorage, CODE_KEY, null); draw(''); });
    on('undo', function () {
      var k = kept();
      if (!k) return;
      api('POST', 'bind/undo', { code: k.code }).then(function (r) {
        if (!r || !r.ok) return;
        sset(sessionStorage, CODE_KEY, null);
        hideWeek();
        msg(L(view.ctx.lang).undone);
      }).catch(function () {});
    });
  }
  function onFocus() {
    var k = kept();
    if (!k || !k.code || !view.mount) return;
    api('GET', 'bind/status?code=' + encodeURIComponent(k.code)).then(function (r) {
      var st = r && r.state;
      if (st === 'bound') banner();
      else if (st === 'refused' || st === 'expired') {
        sset(sessionStorage, CODE_KEY, null);
        if (r.reason === 'max_phones') sset(sessionStorage, HIDE_KEY, '1');
        var m = refusal(st === 'expired' ? 'expired' : r.reason);
        if (m) msg(m);
      }
    }).catch(function () {});
  }
  function card(mountEl, ctx) {
    if (!mountEl || !ctx || ctx.practice || !ctx.hub || !ctx.kid) return false;
    view.mount = mountEl; view.ctx = ctx;
    // A code minted this session: its outcome first (the next hub render in the same session).
    if (kept()) { showCard(); onFocus(); return true; }
    if (later() || sget(sessionStorage, HIDE_KEY) === '1') return false;
    showCard();
    if (!view.shown) { view.shown = true; ev('bind_offered', { surface: 'hub', w: 'p' }); }
    return true;
  }
  function chipExtra(k, lang) {
    if (!k) return '';
    var t = L(lang);
    var line = k.line2 ? esc(k.line2) : k.avatarLine || k.played ? esc(t.whoPlayedHere) : '';
    return line ? '<small class="wqb-line2" dir="auto">' + line + '</small>' : '';
  }
  window.addEventListener('focus', onFocus);
  try { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') onFocus(); }); } catch (e) {}
  window.WQBIND = { card: card, onFocus: onFocus, chipExtra: chipExtra, t: L };
})();
