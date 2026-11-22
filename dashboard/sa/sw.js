/**
 * The battery's service worker, scope /sa/ (switch sa_engine): the child's page keeps working when the network goes
 * down mid-child. Served no-cache by routes/sa-engine.routes.js; it never touches /wq/'s or the portal's requests.
 *
 *   the engine's files and play.html   network first (3 s), else the cached copy: an update reaches an online phone,
 *                                      an offline phone still opens the page
 *   the battery file and Jugnu's clips cache first (they never change under one URL: the clip name is a hash)
 *   anything else (the sink's /api calls, other paths)  not touched
 *
 * The page asks for a session's files with postMessage({ type: 'prepare', urls, fresh? }) on a MessageChannel and gets
 * back { ok, cached, missing[], bytes }; "ready offline" is shown only when missing is empty. The files are fetched six at
 * a time, and one that fails (a 429 from a busy tunnel, a dropped request) is tried once more after a short pause.
 * A fetch is given up (then tried once more) only when it stalls: no answer for 20 s, or no body bytes for 20 s. A clip that
 * keeps arriving slowly is never cut. A URL already being fetched by any prepare is not fetched again: the second prepare
 * waits on the same download. With { progress: true } the worker also posts { type: 'progress', done, bytes, link } on the
 * channel at once and at least every 5 s (done = this prepare's files kept, bytes = its body bytes, link = every body byte
 * this worker received), so the page can tell a slow link from a dead one.
 * Round 8 (the coach's "ready for offline"): a URL in `fresh` (a battery file, which changes under one URL when a switch
 * flips) is read from the network even when a copy is kept, and keeps that copy when the network fails; bytes counts
 * what came over the network. postMessage({ type: 'check', urls }) answers { ok, cached, missing[] } from the phone
 * alone, fetching nothing.
 * A SESSION bump keeps what did not change (carry, at install and again at activate): the new SESSION's cache copies an
 * older cache's entry if, and only if, the entry's own bytes hash to the sha1 the new clips.lock.json names for its path.
 * Anything else is fetched by the next prepare; a battery file is never carried. activate deletes the older cache only
 * after its second pass settled.
 */
'use strict';

// sa-3: the install of sa-2 may have kept the portal's page for an engine file the folder did not have yet.
// sa-4: the prepare queue (six at a time, one retry): phones take the new worker and the new engine files.
// sa-5: round 7 (RDF auto with no last-word step): the new engine files.
// sa-6: round 7b (back, End test + Restart, End this section, the auto stop-checks, the instruction lines): the new engine files.
// sa-7: a line held by a hidden page plays on when it is shown again, never in the phone's voice (sa-voice.js, sa-engine.js).
// sa-8: round 8, the child's flow (no Done line on a reading, story questions wait for Next, practice says its answer).
// sa-9: round 8 offline: sa-offline.js prepVisit / checkVisit / partOf (the coach page's "ready for offline").
// sa-10: round 8 offline: Jugnu's pictures go on the phone with "ready for offline" (sa-offline.js ART).
// sa-11: round 8 offline: the Start gate checks the phone first and the background download gives it the line (sa-offline.js fresh / paused).
// sa-12: round 8 offline: an installed worker is used without waiting on register() (which rejects with no signal).
// sa-13: round 8: the engine files (speak.audio() for the word highlight, the story's ear with r8_reading_position).
// sa-14 (production only): the engine files again. Each VERSION bump drops only the sa-core-* cache; the batteries, clips
// and word timings stay in SESSION, so neither of these two refreshed a battery or clip copy a phone already held.
// sa-15: round 8 close: sa-ui.js (the story questions' hint names Next / «آگے»).
// sa-16: round 8 close: sa-offline.js asks the registration to update() and waits (bounded) for a new worker before
// 'prepare', so a phone still on the previous SESSION prepares into the new one, not into a cache it is about to delete.
// sa-17: round 8 close: a new worker found by update() is waited for up to 30 s; still not active (or its install failed),
// "ready for offline" says not ready instead of preparing into the old worker.
// sa-18: round 8 close: "ready for offline" is not ready when a newer worker turned up while it ran (sa-offline.js replaced()).
// sa-19: round 8 close: nothing goes to a worker while update() is unanswered (up to 30 s, then not ready) or a newer worker
// exists; checked before every message (sa-offline.js guarded()), and a newer worker that activates gets the whole visit.
// sa-20: round 9: the engine files (sa-rec.js lets go of the call-mode microphone between recordings; a phone that loads
// the page offline gets it only through this bump).
// sa-21: round 10: the engine files of three lanes in one bump (sa-ui.js and sa.css: the hint heard once, Next at once after
// practice, Urdu centred and whole, numbers sized to their box; sa-voice.js and sa-engine.js: clips play with no tap behind them).
// sa-22: round 12: sa-ui.js (r12_intro_once: the Whole battery's "your turn" line said once per run).
// sa-23: round 13: sa-page.js, sa-engine.js and sa-core.js (r13_whole_stop: the Whole battery moves on to the next
// subject when a part is not finished).
// sa-24: round 13b: sa-engine.js and sa-core.js (r13_oral_rule: a spoken part ends its subject only after N questions in a
// row ran out unanswered).
// sa-25: round 20: sa-engine.js and sa-core.js (r20_silence_stop: N silent letter/word parts in a row end the subject in RDF
// auto; r20_auto_end_section: the coach's End this section in RDF auto too).
// sa-26: round 28 follow-up: sa-core.js (a letter-sound task the coach ends before every item was presented is not rated).
// sa-27: round 28 follow-up: sa.css (the letter picker draws no language toggle inside the coach page's frame; the spoken MCQ's head
//   gap under the toggle fit).
// sa-28: round 28 follow-up: sa-ui.js and sa-core.js (the letter picker and the spoken MCQ draw no Back button on their item and
//   practice screens, so the cards and the replay stay in reach on a phone; the sandbox-only dev row stays off those screens;
//   a scored answer records since_fold_ms).
// sa-29: round 28 follow-up: sa.css and sa-ui.js (the Urdu sound check fits a phone under sa_r28_check_fit; the letter
//   picker's practice example keeps room for its pointing hand in RDF auto; its last practice feedback keeps the 1.2 s floor).
// sa-30: round 28 follow-up: sa-ui.js and sa.css (RDF auto's Next sits in the head row with its place held, on the letter
//   picker and the spoken MCQ, so nothing moves when it is offered and a phone keeps every card and option in reach).
// sa-31: round 28 follow-up: sa-ui.js (the coach's hold menu says End this task in Urdu apart from the portal's End this
//   section, under sa_r28_end_task_copy).
// sa-32: round 28 follow-up, one bump for the engine files of several changes: sa-ui.js and sa.css (Jugnu says the letter
//   picker's and the spoken MCQ's instruction and practice feedback in coach-led; the picker practice's named line wraps in
//   the coach-led head row in place of the chip and the Skip), sa-offline.js (the offline timing sweep asks only for files
//   that exist, prompt_timings.json first).
// sa-33: round 28, sa.css (the Urdu story question card on a phone in RDF auto holds a two-line question: more
//   padding over and under, the gaps below it tightened so the four answers stay on the screen).
// sa-34: round 28, sa-core.js, sa-ui.js and sink-coach.js (the session row keeps the child's practice taps, the answer
//   cards' reach at each item and again when Next is offered, a story question's first choice, and which engine served
//   the page; no screen changes).
// sa-35: round 28, sa-ui.js (the spoken MCQ keeps a few listed Urdu word runs, names and paired words, on one line in the
//   question and its answers, so a phone never breaks them across two lines).
// sa-36: round 28, sa.css (the Urdu story question card on a phone in RDF auto keeps a two-line question's lines apart:
//   18 px at a taller line pitch, the card's padding moved to the top; the four answers stay on the screen).
// sa-37: round 28, sa-voice.js and sa-ui.js (a spoken clip that starts and then stops mid-way is given up after a short
//   wait and one retry, not counted as heard; the picker's and the MCQ's cards ignore a tap while it is stopped; the
//   never-ended guard waits while the page is hidden).
// sa-38: round 28, sa.css (the Urdu story questions' practice in RDF auto fits a phone like the scored question: the
//   head row the replay's height, the feedback one fixed line, the four answers 8 px apart and all on the screen).
// sa-39: sa-offline.js and this worker (a slow link no longer refuses the start: the page waits while clips keep arriving,
//   a fetch is given up only when it stalls, a retry joins the downloads already running, and the phone logs how long
//   the preparation took).
// sa-40: hotfix, sa-page.js (a late "no voice" verdict inside a timed task whose items need no clip no longer stops it:
//   the task runs to its end on its own clock and the voice refusal comes at that end, between tasks).
// sa-42: round 28, sa-page.js and sa-offline.js and this worker (device_ready names the build that ran: the page's own
//   VERSION, the VERSION of each worker that prepared it, and the session cache the clips were found in, asked for on its
//   own 'held' message; worker_swap marks a newer worker taking the page over mid-session).
// sa-43: this worker and sa-page.js (a SESSION bump keeps what did not change: install, then activate, copies an older
//   session cache's entry whose bytes hash to the new lock's sha1 for its path; nothing else is kept). SESSION unchanged:
//   the carry needs no record from an earlier worker, so it works on the bump it ships with.
// sa-45: the letter-sound picker's prompt clips re-made (SESSION v32); no worker code changes.
// sa-46: sa-engine.js (the last recording: the battery's end waits for a recorder stop under way, and tells the page when
//   the audio is acked). SESSION unchanged: no clip or battery changed.
// sa-47: sa-page.js + sa-sync.js (the drain keeps an upload that is making progress; an already-scored recording counts as
//   sent), sa-core.js + sa-mic.js + sa-ui.js + sink-coach.js (an unknown microphone is checked, behind its switch), and
//   sa-engine.js. SESSION unchanged: no clip or battery changed.
// sa-48: the letter-sound picker's re-made prompts and the your-turn / picker-intro lines (SESSION v33); no worker code changes.
// sa-49: the English letter names e, B, t and d play production's v4 takes again under their keys (SESSION v34); no worker
//   code changes.
var VERSION = 'sa-49';
var CORE = 'sa-core-' + VERSION;
// v2: v1 may hold the portal's page cached as a clip (a missing clip used to answer 200 HTML); it is dropped.
// v3: letter-sound clips re-made under the same keys (one held "ssss", not "s s s"); a kept copy would play the old one.
// v4: batteries re-read after the round-5 switches (one at a time on Next only, the child's last-word tap in auto); a copy kept
// under v3 between the deploy and the flip would keep the old behaviour.
// v5: round 7: the letter name ثے re-voiced under its key ("se", not a "t" word) and the batteries' new lines.
// v6: round 7b: a battery served while its switches are ON carries their ui flags and new lines (sa-battery-switches.js); a copy
// kept under v5 would keep the old behaviour on a phone that already took it. Turn the switches on BEFORE this reaches a tier.
// v7: round 8 close: v4 clips re-made under their keys (sums end on "equals", letter sounds held, praise excited) and the
// battery files' new lines; a kept copy would play the old one. Phones re-download their clips on the next prepare.
// clips.lock.json records the bytes each SESSION was taken with (dashboard/scripts/sa-clips-lock.js); the dashboard test
// sa-clips-lock fails when a locked file changes under the same SESSION.
// v8: round 9: every v4 clip levelled again to -16 LUFS under its key (quiet on some phones), the Urdu sums re-voiced under
// their keys with the operation in English ("plus", "minus", "times", "equals"), and the battery files' new lines (the
// reviewers' Section 11 edits, "my friend" / «پیارے دوست», operations named in English); a kept copy would play the old one.
// v14: round 10 release A: the reviewers' 6 Nov corrections in the battery files («جزیرہ», «ہر جواب», "Jugnu will just
// listen", «دبائیں» for every "press") and Urdu v4 clips re-voiced under their keys so «آواز میں» is said in full.
// v15: round 10 release B: the English v4 clips re-made under their keys in the reviewers' picked voice (lower, calmer and
// a little slower), their word timings scaled to match.
// v16: round 12: the Urdu letter name «ثے» (said "se") re-voiced under its three keys (the letter alone and its two
// practice answers), which the voice had read as a "t"/"th" sound; the two answers' word timings re-made.
// v17: the field review of 16 Nov: «جھنڈا» re-voiced under its key with its vowel («جَھنڈا», it was said "jhunda"), five
// English letter sounds said alone (h, r, y, k, qu) and six lines re-made under their keys; no word timings change.
// v18: the review's second listen: the nine English dictation lines (word, sentence, word) re-voiced so the word and the
// sentence are said clearly, the plough picture «کِسان … ہَل», and the five letter sounds from v17 given the English set's
// voice processing (pitch and pace) like every other English clip; no word timings change.
// v19: the two English letter sounds the content owner picked (x "ks", j "juh"), re-made under their keys.
// v20: the 24 Urdu recordings the content owner marked wrong (letter names, check words, made-up words, five lines),
// re-made under their keys from a line fix each (UR_LINE_SAID), with the lines' word timings re-made.
// v21: the letter name «تے» and the made-up word «جھیٹ» in the content owner's own recordings (no voice said them right),
// trimmed and levelled like the other v4 clips, under their keys.
// v22: round 28's battery files (the letter-sound picker, story options and timed-task extension built in, stripped on serve
// while their switches are OFF), so a phone takes the new files.
// v23: round 28's letter-sound prompts re-picked under their keys (each sound heard right on repeated listens and
// through a phone-speaker filter: «مَ» short, not «ما»; /a/, /o/, /ba/, /da/, /ta/, «شَ», «چَ»), the picker intro's /ba/ with them.
// v26: round 28's battery files re-made with two Urdu story options re-worded (their clips re-voiced) and the EN
// familiar words' accept forms (scorer only; never served).
// v27: round 28's battery files re-made with the letter-sound picker's practice feedback naming the sound (the
// letter-sounds lines, then the item's own clip; no new clip).
// v28: round 28's battery files re-made with their source notes (why a line or item is as it is) worded in product
// words, not by decision numbers. Nothing a child sees or hears changes.
// v29: round 28's battery files re-made with three Urdu "your turn" lines spelt right («آواز میں», «کا نام»,
// «آواز بولیں»), each with its clip at the new text's key.
// v30: the letter-names practice example's name «ثے» re-voiced under its v4 key: the take said "see" ([siː]), now "say"
// ([seː]), heard so on repeated listens; levelled like the other v4 clips. No word timings change.
// v32: the letter-sound picker's 24 prompts (scored and practice, English and Urdu) say each sound three times: one
// recorded sound copied three times with the same gap, so no letter gets a clue; English t (a real /t/ burst) and d
// (longer) re-made, the held sounds as the content owner picked, Urdu م and س held. v5/prompt_timings.json gives the
// three spans: speech_start_ms is the first sound's start, speech_end_ms the third one's end. (v31 is retired unused;
// the next re-voice takes v33, and SESSION never moves backwards.)
// v33: 13 of the picker's prompts re-made under their keys as the content owner picked them on a phone speaker (Urdu ب ل ن
// ر ک گ چ ٹ م ش ف as a short «بَ»-like syllable, not a long «با»; English t and n), each said three times as before, with
// their spans in v5/prompt_timings.json; the your-turn lines say «آواز میں بولیں» and the picker intro names its example
// in the task's language, each at its text's key with its word timings (the Urdu-task intro re-made under its key).
// v34: the English letter names e, B, t and d play production's v4 takes again under their keys: their re-made takes did
// not pass the ear check. A phone that kept a v33 copy of those four keys takes production's bytes.
var SESSION = 'sa-session-v34';
var CORE_FILES = ['play.html', 'sa-core.js', 'sa-store.js', 'sa-voice.js', 'sa-ui.js', 'sa-sync.js', 'sa-rec.js',
  'sa-engine.js', 'sa-mic.js', 'sa-offline.js', 'sa-page.js', 'sa.css', 'sink-coach.js', 'sink-game.js', 'skin-game.css', 'skin-game.js'];
var NETWORK_WAIT_MS = 3000;
var PREFETCH_AT_ONCE = 6;
var RETRY_MS = 1500;
var IDLE_MS = 20000;
var PROGRESS_MS = 5000;

/**
 * prefetch(urls, { fetch, match, put, ok, limit?, retryMs?, fresh?, onBytes? }) → Promise<missing urls>: each url not
 * already kept (match) is fetched, at most `limit` at a time, kept (put) when ok(url, res); a failure is tried once more
 * after retryMs. A url in fresh is fetched first even when kept (a failure then falls back to the kept copy).
 * onBytes(n) gets the body bytes as they arrive (a response with no readable body: its content-length). A try is
 * abandoned when no answer comes for idleMs, or no body bytes for idleMs (abort() gives the AbortController whose signal
 * the fetch gets); a body that keeps arriving is never cut. inflight (shared by every prepare) holds the urls being fetched:
 * a url already there waits on that download instead of starting another, except that a fresh ask never waits on a plain
 * one that may still end on the kept copy. onDone(u) once per url kept. Never rejects.
 */
function prefetch(urls, o) {
  var limit = o.limit || PREFETCH_AT_ONCE;
  var wait = o.retryMs != null ? o.retryMs : RETRY_MS;
  var idle = o.idleMs || IDLE_MS;
  var fresh = o.fresh || [];
  var running = o.inflight || {};
  var queue = urls.slice();
  var missing = [];
  function once(u) {
    var ctl = typeof o.abort === 'function' ? o.abort() : null;
    var t = null;
    var stop = null;
    var stalled = new Promise(function (_, no) { stop = no; });
    stalled.then(null, function () {});
    // no answer, or no body bytes, for idle ms: the try is given up (a slow body that keeps coming is never cut)
    function arm() {
      clearTimeout(t);
      t = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (_) { /* already settled */ } stop(new Error('stalled')); }, idle);
    }
    arm();
    var got = Promise.resolve().then(function () { return ctl ? o.fetch(u, { signal: ctl.signal }) : o.fetch(u); }).then(function (res) {
      arm();
      if (!o.ok(u, res)) throw new Error(String(res && res.status));
      var body = null;
      if (res.body && typeof res.body.getReader === 'function' && typeof res.clone === 'function') {
        var reader = res.clone().body.getReader();
        body = (function next() {
          return reader.read().then(function (c) {
            if (c.done) return null;
            arm();
            if (o.onBytes) o.onBytes((c.value && c.value.byteLength) || 0);
            return next();
          });
        }());
      } else if (o.onBytes) {
        o.onBytes(Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0) || 0);
      }
      return Promise.all([Promise.resolve(o.put(u, res)), body]).then(function () { return true; });
    });
    got.then(null, function () {});
    return Promise.race([got, stalled]).then(function (v) { clearTimeout(t); return v; }, function () { clearTimeout(t); return false; });
  }
  // a download from the network (a fresh ask, or a plain one whose match missed) can be joined by any ask; a plain one
  // still matching may end on the kept copy, so a fresh ask never joins it
  function fromNet(e) { return !!e && (e.fresh || e.net); }
  function fetchOne(u, e) {
    var first = e.fresh ? once(u) : Promise.resolve(false);
    return first.then(function (got) { return got ? true : o.match(u); }).then(null, function () { return null; }).then(function (hit) {
      if (hit) return true;
      var now = running[u];
      if (now !== e && fromNet(now)) return now.p; // a fresh ask started while this one matched: one request, not two
      e.net = true;
      return once(u).then(function (got) {
        return got ? true : new Promise(function (r) { setTimeout(r, wait); }).then(function () { return once(u); });
      });
    });
  }
  function one(u) {
    var isFresh = fresh.indexOf(u) >= 0;
    var e = running[u];
    if (!e || (isFresh && !fromNet(e))) {
      var mine = e = running[u] = { fresh: isFresh, net: false };
      e.p = fetchOne(u, e);
      e.p.then(function () { if (running[u] === mine) delete running[u]; });
    }
    return e.p.then(function (got) { if (!got) missing.push(u); else if (o.onDone) o.onDone(u); });
  }
  function worker() { var u = queue.shift(); return u === undefined ? null : one(u).then(worker); }
  var workers = [];
  for (var i = 0; i < Math.min(limit, urls.length); i++) workers.push(worker());
  return Promise.all(workers).then(function () { return urls.filter(function (u) { return missing.indexOf(u) >= 0; }); });
}

/**
 * The sa-session-* cache holding most of urls (the one the clips are read from), or null when none holds any. On a deploy
 * day the worker answering can be newer than the cache the clips are in, so this is looked up, not taken from SESSION.
 * Only the 'held' message runs it: a prepare reply never waits on it.
 */
function heldIn(urls, cachesApi) {
  if (!urls.length) return Promise.resolve(null);
  return cachesApi.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('sa-session-') === 0; }).map(function (k) {
      return cachesApi.open(k).then(function (c) {
        return Promise.all(urls.map(function (u) { return c.match(u, { ignoreSearch: true }); }));
      }).then(function (hits) { return { name: k, n: hits.filter(Boolean).length }; });
    }));
  }).then(function (held) {
    var best = null;
    held.forEach(function (h) { if (h.n > 0 && (!best || h.n > best.n)) best = h; });
    return best ? best.name : null;
  }).then(null, function () { return null; });
}

/** A response worth keeping: 2xx, and the type the URL is (a clip is audio, a battery JSON, an engine file not HTML). */
function cacheable(url, res) {
  if (!res || !res.ok) return false;
  var type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  var p = new URL(url).pathname;
  if (/\.(mp3|m4a|ogg)$/.test(p)) return type.indexOf('audio/') === 0;
  // a battery read while a switch was never read (X-SA-Switches: unread, sa_r8_switch_hold) guessed its OFFs: the page uses it,
  // the phone never keeps it for the next child
  if (/\.json$/.test(p)) return type.indexOf('json') >= 0 && String((res.headers.get && res.headers.get('x-sa-switches')) || '').toLowerCase() !== 'unread';
  if (/\.html$/.test(p)) return type.indexOf('text/html') === 0;
  return type.indexOf('text/html') < 0;
}

/** One engine file into the install cache, only when it is one (a cold portal may answer its own page once). */
function installOne(cache, url, fetchFn) {
  return Promise.resolve().then(function () { return fetchFn(url, { cache: 'no-cache' }); })
    .then(function (res) { return cacheable(url, res) ? cache.put(url, res) : null; })
    .catch(function () { return null; });
}

// The lock this SESSION's files were taken under (clips.lock.json, served beside this worker).
var LOCK_FILE = 'clips.lock.json';
var CARRY_AT_ONCE = 8;

/** The lock's name for a URL the worker keeps ('dashboard/sa/v4/ur/x.mp3'); null for a battery file or a path outside /sa/. */
function lockPath(url) {
  var p = new URL(url).pathname;
  if (p.indexOf('/sa/') !== 0 || p.indexOf('/sa/batteries/') === 0) return null;
  return 'dashboard' + p;
}

function hex(buf) {
  var b = new Uint8Array(buf);
  var s = '';
  for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

/**
 * carry(io) → Promise<{ kept, lock }>, never rejects. A SESSION bump keeps what did not change: the SESSION cache takes an
 * entry of an older sa-session-* cache if, and only if, the entry's own bytes hash (SHA-1) to the new lock's sha1 for its
 * path (a short, corrupt or re-voiced copy is not kept). Anything else is left for the next prepare to fetch; a battery
 * file is never carried (it changes under one URL when a switch flips). io.seen (a Set, kept across calls) names the
 * entries an earlier pass already looked at, so a second pass reads only what an older cache gained since. The lock is
 * read only when an older SESSION cache is there, and is used only when it names this SESSION.
 * io: { session, keys(), open(name), lock() → Promise<lock|null>, digest(ArrayBuffer) → Promise<hex sha1>, seen?, limit? }.
 */
function carry(io) {
  var kept = 0;
  var now = null;
  var seen = io.seen || new Set();
  function copyFrom(dst, src, name) {
    return src.keys().then(function (reqs) {
      var queue = reqs.filter(function (req) { return !seen.has(name + ' ' + req.url); });
      function one(req) {
        // settled = never worth reading again; an entry whose bytes did not match is read again (the old worker may
        // re-fetch it under the same URL before activate)
        function settled() { seen.add(name + ' ' + req.url); }
        var p = lockPath(req.url);
        var want = p && now.files[p];
        if (!want) return settled();
        return dst.match(req).then(function (have) {
          if (have) return settled();
          return src.match(req).then(function (res) {
            if (!res || !cacheable(req.url, res)) return null;
            return res.clone().arrayBuffer().then(io.digest).then(function (h) {
              if (h !== want) return null;
              return dst.put(req, res).then(function () { kept += 1; settled(); });
            });
          });
        });
      }
      function worker() {
        var req = queue.shift();
        if (req === undefined) return null;
        return Promise.resolve().then(function () { return one(req); }).then(null, function () { return null; }).then(worker);
      }
      var workers = [];
      for (var i = 0; i < Math.min(io.limit || CARRY_AT_ONCE, queue.length); i++) workers.push(worker());
      return Promise.all(workers);
    });
  }
  return Promise.resolve().then(function () { return io.keys(); }).then(function (keys) {
    // newest older SESSION first: an entry taken from it is not taken again from an older one
    var olds = keys.filter(function (k) { return k.indexOf('sa-session-') === 0 && k !== io.session; })
      .sort(function (a, b) { return (parseInt(b.slice(12), 10) || 0) - (parseInt(a.slice(12), 10) || 0); });
    if (!olds.length) return { kept: 0, lock: null };
    return io.lock().then(function (l) {
      if (!l || l.session !== io.session || !l.files) return { kept: 0, lock: null };
      now = l;
      return io.open(io.session).then(function (dst) {
        return olds.reduce(function (chain, name) {
          return chain.then(function () { return io.open(name).then(function (src) { return copyFrom(dst, src, name); }); })
            .then(null, function () { return null; });
        }, Promise.resolve());
      }).then(function () { return { kept: kept, lock: now }; });
    });
  }).then(null, function () { return { kept: kept, lock: now }; });
}

/** The lock served beside this worker (prefetch's stall guard and one retry), or null. */
function readLock(url, io) {
  var got = null;
  return prefetch([url], {
    fetch: io.fetch, abort: io.abort, limit: 1,
    match: function () { return null; },
    ok: function (u, res) { return !!res && res.ok && String((res.headers && res.headers.get && res.headers.get('content-type')) || '').indexOf('json') >= 0; },
    put: function (u, res) { return res.json().then(function (j) { got = j; }); },
  }).then(function () { return got; }, function () { return null; });
}

/** Which way a request is answered: 'core' | 'static' | null (not ours). */
function strategyFor(url, method, origin) {
  if (method !== 'GET') return null;
  var u = new URL(url);
  if (u.origin !== origin) return null;
  var p = u.pathname;
  if (/^\/sa\/v\d+\//.test(p) || /^\/sa\/batteries\//.test(p) || /\.(mp3|m4a|ogg|webp|png|woff2)$/.test(p)) {
    return /^\/(sa|wq)\//.test(p) ? 'static' : null;
  }
  if (/^\/sa\/[^/]+\.(js|css|html|json)$/.test(p) && p !== '/sa/sw.js') return 'core';
  return null;
}

// every prepare's downloads in flight (url → its promise), and every body byte this worker received
var INFLIGHT = {};
var LINK = { bytes: 0 };

/**
 * One 'prepare' message: prefetch(urls) into the session cache, then { ok, cached, missing, bytes } on the port. With
 * d.progress, { type: 'progress', done, bytes, link } at once and every PROGRESS_MS until the answer (an older page that
 * never asks for progress gets only the answer, as before). io: prefetch's fetch / match / put / ok / abort.
 */
function prepareReply(d, urls, port, io) {
  var bytes = 0;
  var done = 0;
  var tick = null;
  function progress() { port.postMessage({ type: 'progress', done: done, bytes: bytes, link: LINK.bytes }); }
  if (d.progress === true) { progress(); tick = setInterval(progress, PROGRESS_MS); }
  return prefetch(urls, {
    fetch: io.fetch, match: io.match, put: io.put, ok: io.ok, abort: io.abort, inflight: INFLIGHT,
    fresh: (d.fresh || []).filter(function (u) { return typeof u === 'string'; }),
    onBytes: function (n) { bytes += n; LINK.bytes += n; },
    onDone: function () { done += 1; },
  }).then(function (missing) {
    clearInterval(tick);
    port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing, bytes: bytes, sw: VERSION });
  }, function (err) {
    clearInterval(tick);
    throw err;
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { strategyFor: strategyFor, cacheable: cacheable, installOne: installOne, prefetch: prefetch, carry: carry, readLock: readLock, lockPath: lockPath, prepareReply: prepareReply, heldIn: heldIn, CORE_FILES: CORE_FILES, CORE: CORE, SESSION: SESSION, VERSION: VERSION, IDLE_MS: IDLE_MS, PROGRESS_MS: PROGRESS_MS, PREFETCH_AT_ONCE: PREFETCH_AT_ONCE };
} else {
  // The SESSION carry: install copies what an older SESSION cache holds unchanged, while the old worker still serves; activate
  // makes a second pass (what the old worker kept since, e.g. a prepare it answered during the install) and only then
  // deletes the older caches, so a clip a page was told is ready is never lost in the swap.
  // activate reads no network (fetches wait while a worker activates): its pass uses the lock install read and checked.
  // A waiting worker is stopped when idle (a slow link holds activation for minutes) and its globals go with it, so
  // install also keeps that lock in this worker's CORE cache, under a key no request is answered from, and activate reads
  // it back from there. With no lock (none served, or one naming another SESSION) activate carries nothing, as install did.
  var installLock = null;
  var carrySeen = new Set();
  var CARRY_LOCK_KEY = '/sa/carry/lock.json';
  function heldLock() {
    if (installLock) return Promise.resolve(installLock);
    return caches.open(CORE).then(function (c) { return c.match(new URL(CARRY_LOCK_KEY, self.location.href).href); })
      .then(function (res) { return res ? res.json() : null; })
      .then(function (l) { return l && l.session === SESSION && l.files ? l : null; }, function () { return null; });
  }
  function keepLock(l) {
    return caches.open(CORE).then(function (c) {
      return c.put(new URL(CARRY_LOCK_KEY, self.location.href).href,
        new Response(JSON.stringify(l), { headers: { 'content-type': 'application/json' } }));
    }).then(null, function () { return null; });
  }
  function carryNow(atActivate) {
    return carry({
      session: SESSION,
      seen: carrySeen,
      keys: function () { return caches.keys(); },
      open: function (n) { return caches.open(n); },
      lock: function () {
        if (atActivate) return heldLock();
        return readLock(new URL('/sa/' + LOCK_FILE, self.location.href).href, {
          fetch: function (u, init) { return fetch(u, Object.assign({ cache: 'no-cache' }, init || {})); },
          abort: function () { return typeof AbortController === 'function' ? new AbortController() : null; },
        });
      },
      digest: function (buf) { return crypto.subtle.digest('SHA-1', buf).then(hex); },
    }).then(function (r) {
      if (!atActivate && r.lock) { installLock = r.lock; return keepLock(r.lock).then(function () { return r; }); }
      return r;
    });
  }
  self.addEventListener('install', function (e) {
    e.waitUntil(Promise.all([caches.open(CORE).then(function (c) {
      // One by one: a file the game lane has not shipped yet must not stop the worker installing.
      return Promise.all(CORE_FILES.map(function (f) { return installOne(c, new URL('/sa/' + f, self.location.href).href, fetch); }));
    }), carryNow()]).then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(carryNow(true).then(function () { return caches.keys(); }).then(function (keys) {
      return Promise.all(keys.filter(function (k) { return (k.indexOf('sa-core-') === 0 && k !== CORE) || (k.indexOf('sa-session-') === 0 && k !== SESSION); }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  var fromCache = function (req) {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    });
  };

  self.addEventListener('fetch', function (e) {
    var how = strategyFor(e.request.url, e.request.method, self.location.origin);
    if (!how) return;
    if (how === 'static') {
      e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(e.request).then(function (res) {
          if (cacheable(e.request.url, res)) { var copy = res.clone(); caches.open(SESSION).then(function (c) { c.put(e.request, copy); }); }
          return res;
        });
      }).catch(function () { return fromCache(e.request); }));
      return;
    }
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fromCache(e.request)); } }, NETWORK_WAIT_MS);
      fetch(e.request).then(function (res) {
        if (cacheable(e.request.url, res)) {
          var copy = res.clone();
          var key = new URL(e.request.url); key.search = '';
          caches.open(CORE).then(function (c) { c.put(key.toString(), copy); });
        }
        if (!done) { done = true; clearTimeout(timer); resolve(res.ok ? res : fromCache(e.request).then(function (hit) { return hit.status === 503 ? res : hit; })); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(fromCache(e.request)); }
      });
    }));
  });

  self.addEventListener('message', function (e) {
    var d = e.data || {};
    var port = e.ports && e.ports[0];
    if ((d.type !== 'prepare' && d.type !== 'check' && d.type !== 'held') || !port) return;
    var urls = (d.urls || []).filter(function (u) { return typeof u === 'string'; });
    // which build this is and where the clips are (device_ready, worker_swap); the page caps its wait at 2 s
    if (d.type === 'held') {
      e.waitUntil(heldIn(urls, caches).then(function (session) { port.postMessage({ sw: VERSION, session: session }); }));
      return;
    }
    if (d.type === 'check') {
      e.waitUntil(Promise.all(urls.map(function (u) {
        return caches.match(u, { ignoreSearch: true }).then(function (hit) { return hit ? null : u; }, function () { return u; });
      })).then(function (r) {
        var missing = r.filter(Boolean);
        port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
      }));
      return;
    }
    e.waitUntil(caches.open(SESSION).then(function (c) {
      return prepareReply(d, urls, port, {
        fetch: function (u, init) { return init ? fetch(u, init) : fetch(u); },
        match: function (u) { return caches.match(u, { ignoreSearch: true }); },
        put: function (u, res) { return c.put(u, res); },
        ok: function (u, res) { return cacheable(new URL(u, self.location.href).href, res); },
        abort: function () { return typeof AbortController === 'function' ? new AbortController() : null; },
      });
    }).then(null, function (err) {
      port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err), sw: VERSION });
    }));
  });
}
