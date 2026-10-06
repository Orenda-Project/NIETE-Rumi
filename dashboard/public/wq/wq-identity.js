/* Web quiz page: "who is playing?" v2, used only when the boot JSON says cls.identity.mode === 'v2'.
 * Name first: the child gives what the child knows (the name they are called by in class) and the
 * server matches it inside ONE class. A same-name collision is ASKED (full name, father's name, the
 * class-list number), never shown; the child only ever sees ONE "Are you X?" card, never a
 * classmate. Loaded before wq.js, which builds it with its own helpers: WQID(P) -> the screens.
 *   S0 landing   remembered children as cards + "Someone else" (a hub link ?k=<chip> = a card tapped)
 *   S1 class     only when the hand-out could not tell the class (identity.class.state 'ambiguous')
 *   S2 name      "What is your name?"
 *   S3 askMore   the server's 409 ask_more: full_name | father | number, each with "I don't know"
 *   S4 isThisYou the server's 409 is_this_you: one card
 *   S5 notFound  the server's 409 not_found: "Yes, that's my name" (new.force) or fix it; with `same` (2+
 *                children share the name, the answers could not tell which) it says so and offers Yes or Back */
var WQID = function (P) {
  'use strict';
  var T = P.T, TW = P.TW, esc = P.esc, on = P.on;
  var ID = (P.CLS && P.CLS.identity) || {};
  var NEW = {};          // the answers so far, sent whole on every round-trip
  var VIA = 'name';      // the step that produced the last answer (logged by the server)
  var CLASSES = (ID.class && ID.class.ask) || [];
  var hubDone = false;
  // A phone that remembers this many children is passed around (a teacher's or an older sibling's): "Someone else"
  // comes first, with the smaller cards.
  var CLASS_PHONE = 4;
  // From 2 remembered children (siblings on a parent's phone) a tapped card gets a "Not X?" undo over the first
  // question, logged as wrong_card.
  var UNDO_PHONE = 2;
  var UNDO_MS = 20000;
  var pending = null;    // the card just tapped on a class phone, until its session starts
  var undoEl = null;

  // An invited friend, or a teacher with no class: a name only, never a class or a roster question.
  function nameOnly() { return Boolean(ID.invited) || ID.roster === false; }
  function nm(s) { return '<bdi>' + esc(s) + '</bdi>'; }
  function lbl(s) { return s ? '<bdi dir="ltr" class="wq-nw">' + esc(s) + '</bdi>' : ''; }
  // The same label inside plain text (the mascot's bubble): an LTR isolate with a no-break hyphen, so "4-A"
  // never reads "A-4" in Urdu nor breaks as "4-" / "A".
  function lblText(s) { return s ? '\u2066' + String(s).replace(/-/g, '\u2011') + '\u2069' : ''; }
  // The class label is shown only when the child chose it on S1.
  function chosenLabel() {
    var k = P.pick();
    if (!k || k === 'none') return '';
    var c = CLASSES.filter(function (x) { return x.key === k; })[0];
    return c ? c.label : '';
  }
  function send() {
    var body = {};
    for (var k in NEW) body[k] = NEW[k];
    P.startSession({ new: body, via: VIA }, null, NEW.name || '');
  }
  function dropHubParam() {
    try {
      var l = window.location, h = window.history;
      var q = l.search.replace(/([?&])k=[^&]*(&|$)/, function (m, a, b) { return b ? a : ''; });
      h.replaceState(h.state, '', l.pathname + q + l.hash);
    } catch (e) {}
  }

  /* S0 */
  // pic: the invited friend's picture (wq.js chPic), shown above the challenge line.
  function landing(chLine, pic) {
    var here = P.kids();
    var Q = P.Q, CLS = P.CLS, LIVE = P.LIVE || {};
    var classPhone = here.length >= CLASS_PHONE;
    var someone = '<button class="wq-btn wq-navy" id="wq-someone">' + esc(TW.someone) + '</button>';
    var h = P.bar() +
      P.jug('hello', here.length ? T.whoSay : T.hello, true, true) +
      '<div class="wq-card wq-stack"><h1>' + esc(Q.topic) + '</h1>' +
      '<p class="wq-sub">' + esc(T.from(CLS.teacher, CLS.label)) + '</p>' +
      '<p class="wq-small">' + esc(T.meta(P.N)) + '</p></div>' +
      (pic || '') + (chLine ? '<div class="wq-banner">' + esc(chLine) + '</div>' : '') +
      (here.length
        ? '<h2>' + esc(T.whoT) + '</h2>' + (classPhone ? someone : '') +
          '<div class="wq-kids-big' + (classPhone ? ' wq-kids-small' : '') + '">' + here.map(function (k, i) {
            return '<button class="wq-kid wq-kid-big" id="wq-kid-' + i + '">' + P.ani(k.animal) + nm(k.first) + '</button>';
          }).join('') + '</div>' + (classPhone ? '' : someone)
        : '<button class="wq-btn wq-go" id="wq-play">' + esc(T.play) + '</button>') +
      (LIVE.ict_today_floor ? '<p class="wq-proof">🌟 ' + esc(T.proof(LIVE.ict_today_floor)) + '</p>' : '') +
      (LIVE.class_today ? '<p class="wq-small">' + esc(T.classToday(LIVE.class_today)) + '</p>' : '') +
      // Classmates with a right answer in the last 2 minutes (the bot's peer-pulse memory): a count, from 2 up; never a friend's.
      (LIVE.now >= 2 && !chLine && !ID.invited && T.liveNow ? '<p class="wq-proof">🟢 ' + esc(T.liveNow(LIVE.now)) + '</p>' : '');
    P.render(h, 'M4-who-v2');
    P.wireBar();
    here.forEach(function (k, i) {
      on('#wq-kid-' + i, function () {
        P.ev('identity_pick', { src: 'remembered' });
        pending = here.length >= UNDO_PHONE ? { first: k.first, t: Date.now() } : null;
        P.startSession({ chip: k.chip, via: 'remembered' }, k);
      });
    });
    on('#wq-someone', function () { P.ev('identity_pick', { src: 'someone_else' }); who(); });
    on('#wq-play', who);
    // A link from the child's hub carries the child: play as them, exactly like a card tapped.
    // Used once; a chip the server does not know is forgotten by startSession, which asks who() next.
    var k = P.params.k;
    if (k && !hubDone) {
      hubDone = true;
      dropHubParam();
      P.ev('identity_pick', { src: 'hub' });
      P.startSession({ chip: String(k).slice(0, 64), via: 'hub' }, null, '');
    }
  }

  function who() {
    pending = null;
    dropUndo();
    if (!nameOnly() && ID.class && ID.class.state === 'ambiguous' && !P.pick()) return classPick(ID.class.ask || []);
    name();
  }

  /* S1: class labels only (no names, no counts); the opaque key goes to the server as `list`. */
  function classPick(classes) {
    CLASSES = classes || [];
    var h = P.bar() + P.jug('idle', TW.classSay) + '<h2>' + esc(TW.classT) + '</h2>' +
      '<div class="wq-chips">' + CLASSES.map(function (c, i) {
        return '<button class="wq-kid wq-cls" id="wq-cls-' + i + '">' + lbl(c.label) + '</button>';
      }).join('') + '</div>' +
      '<button class="wq-btn wq-soft" id="wq-notmine">' + esc(TW.notHere) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    P.render(h, 'M4-class');
    P.wireBar();
    CLASSES.forEach(function (c, i) {
      on('#wq-cls-' + i, function () { P.setPick(c.key); P.ev('identity_pick', { src: 'class' }); name(); });
    });
    on('#wq-notmine', function () { P.setPick('none'); P.ev('identity_pick', { src: 'class_none' }); name(); });
    on('#wq-back', P.landing);
  }

  /* S2 */
  function name(sub, prefill) {
    NEW = {};
    var h = P.bar() + P.jug('hello', sub || TW.nameSay) + '<h2>' + esc(TW.nameT) + '</h2>' +
      '<input class="wq-input" id="wq-name" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="go" aria-label="' + esc(TW.nameT) + '">' +
      '<p class="wq-small">' + esc(TW.namePriv) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-start">' + esc(T.start) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    P.render(h, 'M4-name');
    P.wireBar();
    var inp = P.$('#wq-name');
    if (prefill) inp.value = prefill;
    function go() {
      var v = String(inp.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (v.length < 2) { inp.focus(); return; }
      NEW = { name: v };
      VIA = 'name';
      P.ev('identity_pick', { src: 'name' });
      send();
    }
    on('#wq-start', go);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    on('#wq-back', P.landing);
  }

  /* S3: one question at a time about the child's OWN data; the server picks `need`. */
  function askMore(need, first, cls) {
    var back = function () { name(null, NEW.name); };
    function dontKnow() { NEW[need] = null; VIA = need; P.ev('identity_pick', { src: 'dont_know' }); send(); }
    if (need === 'number') {
      return P.rollPad('', '', {
        screen: 'M4-ask-number', title: TW.numT, say: TW.numSay, noKids: true, dontKnow: TW.dontKnow, onDontKnow: dontKnow, back: back,
        onGo: function (v) { NEW.number = v; VIA = 'number'; P.ev('identity_pick', { src: 'number' }); send(); }
      });
    }
    var full = need === 'full_name';
    var nmFirst = first || NEW.name || '';
    var say = full ? TW.moreFull(nmFirst, lblText(cls)) : TW.fatherT;
    var title = full ? TW.moreFull(nm(nmFirst), lbl(cls)) : esc(TW.fatherT);
    var h = P.bar() + P.jug('thinking', say) + '<h2>' + title + '</h2>' +
      '<input class="wq-input" id="wq-more" maxlength="60" autocomplete="off" autocapitalize="words" enterkeyhint="go" aria-label="' + esc(say) + '">' +
      '<button class="wq-btn wq-go" id="wq-more-go">' + esc(T.next) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-dontknow">' + esc(TW.dontKnow) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    P.render(h, 'M4-ask');
    P.wireBar();
    var inp = P.$('#wq-more');
    if (full && NEW.name) inp.value = NEW.name;
    function go() {
      var v = String(inp.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (v.length < 2) { inp.focus(); return; }
      NEW[need] = v;
      VIA = need;
      P.ev('identity_pick', { src: need });
      send();
    }
    on('#wq-more-go', go);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    on('#wq-dontknow', dontKnow);
    on('#wq-back', back);
  }

  /* S4: exactly one card, the roster first name and the child's own animal, nothing else. */
  function isThisYou(c) {
    var label = chosenLabel();
    var h = P.bar() + P.jug('thinking', T.isYouSub) +
      '<div class="wq-card wq-stack"><h2>' + esc(T.isYou(c.first)) + ' ' + P.ani(c.animal) + '</h2>' +
      (label ? '<p class="wq-sub">' + lbl(label) + '</p>' : '') +
      '<button class="wq-btn wq-go" id="wq-yes">' + esc(T.yesMe) + '</button></div>' +
      '<button class="wq-btn wq-soft" id="wq-diff">' + esc(TW.no) + '</button>';
    P.render(h, 'M4-isyou');
    P.wireBar();
    on('#wq-yes', function () {
      P.ev('identity_pick', { src: 'is_this_you' });
      P.startSession({ chip: c.chip, via: VIA }, { chip: c.chip, first: c.first, animal: c.animal });
    });
    on('#wq-diff', function () { P.ev('identity_pick', { src: 'not_me' }); name(TW.nameFull); });
  }

  /* S5: nothing matched. The child confirms the spelling and starts as a new child of this hand-out. */
  function notFound(typed, cls, same) {
    if (!NEW.name) NEW = { name: typed };
    if (same > 1) return notSure(typed, cls, same);
    var h = P.bar() + P.jug('thinking', TW.nfT(typed, lblText(cls))) +
      '<h2>' + TW.nfT(nm(typed), lbl(cls)) + '</h2>' +
      '<button class="wq-btn wq-go" id="wq-force">' + esc(TW.nfYes) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-fix">' + esc(TW.nfFix) + '</button>';
    P.render(h, 'M4-notfound');
    P.wireBar();
    on('#wq-force', function () { NEW.force = true; VIA = 'new'; P.ev('identity_pick', { src: 'new_force' }); send(); });
    on('#wq-fix', function () { name(null, typed); });
  }

  // The name WAS found, more than once, and the child could not say which: no "fix the spelling".
  function notSure(typed, cls, same) {
    var h = P.bar() + P.jug('thinking', TW.nsT(typed, lblText(cls), same) + ' ' + TW.nsSay) +
      '<h2>' + TW.nsT(nm(typed), lbl(cls), same) + '</h2>' +
      '<p class="wq-sub">' + esc(TW.nsSay) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-force">' + esc(TW.yes) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-back">' + esc(T.back) + '</button>';
    P.render(h, 'M4-notfound');
    P.wireBar();
    on('#wq-force', function () { NEW.force = true; VIA = 'new'; P.ev('identity_pick', { src: 'new_force' }); send(); });
    on('#wq-back', function () { name(null, typed); });
  }

  // Called by startSession once a session has started.
  function started(child) {
    var p = pending;
    pending = null;
    dropUndo();
    if (p) showUndo((child && child.first) || p.first, p.t);
  }
  function showUndo(first, t) {
    var d = P.doc;
    if (!d || !d.body) return;
    var el = d.createElement('button');
    el.className = 'wq-btn wq-undo';
    el.textContent = T.notMe(first);
    el.addEventListener('click', function () {
      P.ev('identity_pick', { src: 'wrong_card', ms: Date.now() - t });
      who();
    });
    d.body.appendChild(el);
    undoEl = el;
    setTimeout(function () { if (undoEl === el) dropUndo(); }, UNDO_MS);
  }
  function dropUndo() {
    if (undoEl && undoEl.parentNode) undoEl.parentNode.removeChild(undoEl);
    undoEl = null;
  }

  // The server's answer to POST /session; true when it was one of the v2 identity steps.
  function reply(status, b, pick) {
    if (status === 409 && b.error === 'which_class') { P.setPick(null); classPick(b.classes || []); return true; }
    if (status === 409 && b.error === 'ask_more') { askMore(b.need, b.first, b.cls); return true; }
    if (status === 409 && (b.error === 'is_this_you' || b.error === 'maybe_you')) {
      var c = (b.candidates || [])[0];
      if (c) isThisYou(c); else name(TW.nameFull);
      return true;
    }
    if (status === 409 && b.error === 'not_found') { notFound(b.typed || NEW.name || '', b.cls, Number(b.same) || 0); return true; }
    if (status === 400 && pick && pick.new) { name(null, NEW.name); return true; }
    return false;
  }

  function backTo(m) {
    if (m === 'M4-who-v2') return null;
    if (m === 'M4-name' || m === 'M4-class') return P.landing;
    if (m === 'M4-ask' || m === 'M4-ask-number' || m === 'M4-notfound' || m === 'M4-isyou') return function () { name(null, NEW.name); };
    return null;
  }

  return { landing: landing, who: who, reply: reply, backTo: backTo, started: started };
};
