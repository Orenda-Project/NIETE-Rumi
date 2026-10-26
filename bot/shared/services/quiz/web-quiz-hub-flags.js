'use strict';
/**
 * The kid hub's switches (app_settings web_quiz_hub / web_quiz_challenge / web_quiz_library / web_quiz_hub_door /
 * web_quiz_child_quiz_home / web_quiz_events_v2 / web_quiz_challenge_v2 / web_quiz_challenge_rungs / web_quiz_readalong /
 * web_quiz_wait_ux / web_quiz_server_timing / web_quiz_hub_fanout / web_quiz_hub_early_kid / web_quiz_hub_child_memo / web_quiz_busy_page),
 * read like web-quiz-link.js (30 s cache, fail closed), and the hub link WhatsApp /quiz sends.
 * Its own module so student-quiz.service can send the link without loading web-quiz-hub.js
 * (which reads student-quiz.service): no require cycle.
 */
const supabase = require('../../config/supabase');
const Snap = require('../settings/settings-snapshot'); // web_quiz_page_keep: the page switches in one read
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const OneHop = require('./web-quiz-one-hop');

const HUB_KEY = 'web_quiz_hub';
const CHALLENGE_KEY = 'web_quiz_challenge';
const LIBRARY_KEY = 'web_quiz_library';
// The results card's door to the hub (web-quiz-hub-door.js); only with the hub on.
const DOOR_KEY = 'web_quiz_hub_door';
// A child's /quiz opens the hub as their home page: the Home button, and the last quiz on top. Only with the hub on.
const CHILD_HOME_KEY = 'web_quiz_child_quiz_home';
// The quiz page's always-visible Home button (the door from any screen of the child's own run; only with the hub
// on) and its step-back navigation (Back to the previous question as a review; the phone's Back walks it).
const HOME_BUTTON_KEY = 'web_quiz_home_button';
const BACK_NAV_KEY = 'web_quiz_back_nav';
// Events v2 (keyed child key, measurement events, the send ledger): read-side only; effective only with the hub on.
const EVENTS_V2_KEY = 'web_quiz_events_v2';
// The rung job (web-quiz-rungs.js): read-side; effective only with web_quiz_challenge_v2 and its parent web_quiz_challenge on.
const CHALLENGE_V2_KEY = 'web_quiz_challenge_v2';
const RUNGS_KEY = 'web_quiz_challenge_rungs';
// The read-along preview on the hub (#listen/<pid>): the hub JSON names it so the edge adds its script (web-quiz-hub.js).
const READALONG_KEY = 'web_quiz_readalong';
// One button system on the child pages (web-quiz-one-button.js): rides this one read, so it adds no read of its own.
// Only the stored JSON boolean true turns it on (not this module's 'true' string rule).
const ONE_BUTTON_KEY = 'web_quiz_one_button';
// The adventure look on the child pages (web-quiz-adventure-look.js): rides this one read too, by the same JSON true rule.
const ADV_KEY = 'web_quiz_adventure_look';
// The designed wait (web-quiz-wait-ux.js) rides this one read: only the stored JSON boolean true is on.
const WAIT_UX_KEY = 'web_quiz_wait_ux';
// The child home's step timings (web-quiz-server-timing.js): read in this same query, so the switch adds no settings read.
const SERVER_TIMING_KEY = 'web_quiz_server_timing';
// A tap while offline stays on the page (web-quiz-offline-guard.js) rides this one read: only the stored JSON boolean true is on.
const OFFLINE_GUARD_KEY = 'web_quiz_offline_guard';
// The hub's reads started together and its switches kept warm (web-quiz-hub.js, web-quiz-hub-warm.js): only JSON true.
const FANOUT_KEY = 'web_quiz_hub_fanout';
// The chosen child's own reads started from the link (web-quiz-hub.js earlyChild; only with fanout): only JSON true.
const EARLY_KID_KEY = 'web_quiz_hub_early_kid';
// The children's own rows read once per hub answer (web-quiz-hub-child-rows.js): only JSON true.
const CHILD_MEMO_KEY = 'web_quiz_hub_child_memo';
// The class rosters the hub uses kept fresh by the fanout keeper (web-quiz-identity-roster.js keepWarm): only JSON true.
const ROSTER_WARM_KEY = 'web_quiz_hub_roster_warm';
// The one share (web-quiz-card-switch.js: the card on AND the share on, each only as JSON true) rides this read too, so
// a home link (the join's, a hub reply's) learns whether to look for a shared card's kept item with no read of its own.
const CARD_KEY = 'web_quiz_card_v3';
const SHARE_KEY = 'web_quiz_share_v4';
// The child's language (web-quiz-return-lang.js): read here with the rest and handed to its own cache, so the hub's
// kept-language read costs no settings read of its own. A literal (equal to that module's KEY), so loading this module
// pulls no other module in; the require stays inside flags(). Not in KEYS: the join's read asks for KEYS (and names this
// row itself, web-quiz-student-join.js).
const RETURN_LANG_KEY = 'web_quiz_return_lang';
// The portal learns the page switches from the bot (web-quiz-edge-learn.js): read in this same query, so the hub answer
// can say it is on (`edge_learn: true`) with no settings read of its own. JSON true only.
const EDGE_LEARN_KEY = 'web_quiz_edge_learn';
// The bar also shows while the page is left (web-quiz-wait-hops.js), with the designed wait on: this same read, JSON true only.
const HOPS_KEY = 'web_quiz_wait_hops';
// The child home's files preloaded in the head the edge sends before the hub answers: the hub JSON names it (`home_pre`).
const HOME_PRELOAD_KEY = 'web_quiz_home_preload';
// The child home's first open in one response (the edge carries the home's files in the page): the hub JSON names it
// (`home_inline`). Only the stored JSON boolean true is on.
const HOME_INLINE_KEY = 'web_quiz_home_inline';
// The inline Home on every open of a saved phone too, not only while it lacks the files' cookie (with home_inline): the
// hub JSON names it (`home_every`). Only the stored JSON boolean true is on.
const HOME_EVERY_KEY = 'web_quiz_home_inline_every';
// A new phone's first Home asks for itself from the page's head (the edge starts the phone's own hub call before the
// page's scripts arrive): the hub JSON names it (`early_unlock`). Only the stored JSON boolean true is on.
const EARLY_UNLOCK_KEY = 'web_quiz_early_unlock';
// A finished lesson's picture on the Videos door plays the lesson again (wq-doors.js, again=1), never its old finish
// card: the hub JSON names it (`rewatch_done`). Only the stored JSON boolean true is on.
const REWATCH_DONE_KEY = 'web_quiz_rewatch_done';
// One play button at 0:00 on the video players (the lesson page, the Videos tab's): the player's own controls come with
// the first play. The hub JSON and the quiz answer name it (`video_clean`). Only the stored JSON boolean true is on.
const VIDEO_CLEAN_KEY = 'web_quiz_video_clean_start';
// The quiz page in the child's language (web-quiz-page-lang.js): the quiz and hub answers say `page_lang`, JSON true only.
const PAGE_LANG_KEY = 'web_quiz_page_lang';
// The wordless first paint (web-quiz-plain-paint.js) rides this read on the hub, so a child's home adds no settings read.
const PLAIN_PAINT_KEY = 'web_quiz_plain_paint';
// The closed and not-open pages in the child's language (web-quiz-closed-lang.js) ride this read on the hub, so a
// child's home adds no settings read for it.
const CLOSED_LANG_KEY = 'web_quiz_closed_lang';
// A class link's picture facts start beside the page's own reads (web-quiz-class-pic.js, with the fast page): the hub's
// switch cache only (nowOf('classPicEarly')), never a read of its own. Only the stored JSON boolean true is on.
const CLASS_PIC_EARLY_KEY = 'web_quiz_class_pic_early';
// web_quiz_class_rows_together (JSON true only, from this cache only: nowOf('classRows')): a class link's class
// (web-quiz-identity.js resolveQuizClass) reads its row and its list together, and its children start once its id is known
const CLASS_ROWS_KEY = 'web_quiz_class_rows_together';
// web_quiz_challenge_early (JSON true only, from this cache only: nowOf('challengeEarly')): a friend's challenge code reads its
// parent class code in its own row's read, and the challenger's score starts once the code is known (web-quiz.service.js)
const CHALLENGE_EARLY_KEY = 'web_quiz_challenge_early';
// web_quiz_challenge_fold (JSON true only, from this cache only: nowOf('challengeFold')): a friend's challenge door says
// `challenge_fold`, so the page puts Play right after the challenge line and the invite picture under it (wq.js landing)
const CHALLENGE_FOLD_KEY = 'web_quiz_challenge_fold';
// web_quiz_challenge_line_keep (JSON true only, from this cache only: nowOf('challengeLineKeep')): the quiz page answer says
// `challenge_line_keep`, so each number in the challenge line and the challenge share text keeps the word after it (wq.js keepNum)
const CHALLENGE_LINE_KEEP_KEY = 'web_quiz_challenge_line_keep';
// web_quiz_challenge_line_sent (JSON true only, from this cache only: nowOf('challengeLineSent')): the quiz page answer says
// `challenge_line_sent`, so the friend's challenge line is drawn one span per sentence and breaks only between them (wq.js)
const CHALLENGE_LINE_SENT_KEY = 'web_quiz_challenge_line_sent';
// web_quiz_end_fit (JSON true only, from this cache only: nowOf('endFit')): the quiz page answer says `end_fit`, so the end
// screen draws its stars in one row sized from their count and its score headline balanced (wq.js results)
const END_FIT_KEY = 'web_quiz_end_fit';
// web_quiz_share_name_bidi (JSON true only, from this cache only: nowOf('nameBidi')): the quiz page answer says `name_bidi`, so
// the English share words isolate the child's name (wq.js), and an Urdu page names a challenger as the English page does
// (web-quiz.service.js challengeOf)
const NAME_BIDI_KEY = 'web_quiz_share_name_bidi';
// web_quiz_end_short (JSON true only, from this cache only: nowOf('endShort'), only beside end_fit): the quiz page answer says
// `end_short`, so the end screen's Jugnu is smaller on a short screen and the Urdu headline breaks after «سے» (wq.js results)
const END_SHORT_KEY = 'web_quiz_end_short';
// web_quiz_end_once (JSON true only, from this cache only: nowOf('endOnce')): the quiz page answer says `end_once`, so
// Jugnu's end-screen line is picked only from the recorded lines that do not repeat the card's heading (wq.js results)
const END_ONCE_KEY = 'web_quiz_end_once';
// A grown-up changes the child's grade for good (web-quiz-grade-change.js): the hub answer says `grownups.grade`, JSON true only.
const GRADE_CHANGE_KEY = 'web_quiz_grade_change';
// web_quiz_hub_waves2 (JSON true only, and only with fanout on): the hub's longest read chains start earlier (hub.js)
const WAVES2_KEY = 'web_quiz_hub_waves2';
// web_quiz_hub_waves3 (JSON true only, and only with fanout on): the hub's last serial reads start earlier (hub.js)
const WAVES3_KEY = 'web_quiz_hub_waves3';
// web_quiz_hub_embed (JSON true only, and only with fanout on): the hub reads a row with the rows its keys point at in one
// request (the child's sessions with their codes and quizzes; the teacher's codes and the grade's lessons with their quizzes)
const EMBED_KEY = 'web_quiz_hub_embed';
// web_quiz_kid_together (JSON true only, from this cache only): the tap routes that name the hub's child (kidFromHub:
// the video library, the home's doors) read that child's row, list, sessions and kept language together, in one
// answer's shared child rows (web-quiz-hub-child-rows.js)
const KID_TOGETHER_KEY = 'web_quiz_kid_together';
// web_quiz_link_together (JSON true only, from this cache only): a class link's class (web-quiz-identity.js
// resolveQuizClass) reads its three steps' first rows at once, still used in their order
const LINK_TOGETHER_KEY = 'web_quiz_link_together';
// The live reading meter (web-quiz-live-read-v3.js meter/forHub): its variant and its parent (live reading v3) ride this
// one read, so the hub learns the meter with no settings read of its own. 'sky' | 'vine' (a JSON true is 'sky'), else null.
const LIVE_METER_KEY = 'web_quiz_live_meter';
const LIVE_READ_V3_KEY = 'web_quiz_live_read_v3';
// The first answer after idle keeps the look (web-quiz-one-button.js, web-quiz-adventure-look.js, web-quiz-fast.js late()):
// the route's carries look at their switch again once the answer lands, when this read is fresh. JSON true only.
const LOOK_AFTER_KEY = 'web_quiz_look_after';
// the page asks the Videos door's lists once the home has painted (the boot's `wait_pre`, with web_quiz_wait_ux only)
const PREFETCH_KEY = 'web_quiz_doors_prefetch';
// the early page draws Home as the child last saw it in this tab (the boot's `wait_home`, with web_quiz_wait_ux only)
const HOME_KEY = 'web_quiz_wait_home';
const METERS = ['sky', 'vine'];
function meterOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  if (isTrue(v)) return 'sky';
  const n = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return METERS.indexOf(n) >= 0 ? n : null;
}
// The light Urdu face (wq-nastaliq-7: the polished face with its outlines on a coarser grid) rides this one read too:
// the page payload's `ui.fl` (web-quiz-ur-polish.js lite()). Only the stored JSON boolean true is on.
const FACE_LITE_KEY = 'web_quiz_face_lite';
// The games door's reads started together (web-quiz-hub-doors.js, the read-aloud budget, the challenge's switches):
// the hub's switch cache only (nowOf('gamesTogether')), never a read of its own. Only the stored JSON boolean true is on.
const GAMES_TOGETHER_KEY = 'web_quiz_games_together';
// Minified page files (web-quiz-minify.js) ride this one read: only the stored JSON boolean true is on.
const MINIFY_KEY = 'web_quiz_minify';
// The child home's scripts and styles as one file each (the edge's pack): the hub JSON names it (`pack`).
const PACK_KEY = 'web_quiz_pack';
// The child pages' busy page (web-quiz-busy-page.js) rides this one read too: only the stored JSON boolean true is on.
const BUSY_PAGE_KEY = 'web_quiz_busy_page';
// The busy page asks again by itself (2 s, 4 s, 8 s) only with this on too: the same read, JSON true only.
const BUSY_RETRY_KEY = 'web_quiz_busy_retry';
const TTL_MS = require('../../config/app-settings-ttl').APP_SETTINGS_FLAG_TTL_MS;   // 30 s; APP_SETTINGS_FLAG_TTL_MS shortens it on a test lane (bd-0vaqcg)
let cache = null; // fromRows' answer: { at, <each SWITCHES field>, shareOpen }
// The child's language row from the read that filled `cache` ({ at, value }), or null when that read did not carry it.
let langSeen = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

// The hub's switches, ONE LINE EACH, in the order of their app_settings key: [the field on flags(), the key, its rule].
// A new switch adds one line here in its key's place (and its key constant above): KEYS, the cached answer and the
// failed read's answer all follow from this list, and nowOf('<field>') reads it from the cache without a function of its own.
// Rules: 'loose' = JSON true or the string 'true' (isTrue); 'json' = only the JSON boolean true (the string 'true', 1 or an
// object are off); 'meter' = meterOf; 'read' = read in the same query for a field worked out below (shareOpen).
const SWITCHES = Object.freeze([
  ['adv',          ADV_KEY,               'json'],
  ['backNav',      BACK_NAV_KEY,          'loose'],
  ['busyPage',     BUSY_PAGE_KEY,         'json'],
  ['busyRetry',    BUSY_RETRY_KEY,        'json'],
  [null,           CARD_KEY,              'read'],
  ['challenge',    CHALLENGE_KEY,         'loose'],
  ['challengeEarly', CHALLENGE_EARLY_KEY, 'json'],
  ['challengeFold', CHALLENGE_FOLD_KEY,   'json'],
  ['challengeLineKeep', CHALLENGE_LINE_KEEP_KEY, 'json'],
  ['challengeLineSent', CHALLENGE_LINE_SENT_KEY, 'json'],
  ['rungs',        RUNGS_KEY,             'loose'],
  ['challengeV2',  CHALLENGE_V2_KEY,      'loose'],
  ['childHome',    CHILD_HOME_KEY,        'loose'],
  ['classPicEarly', CLASS_PIC_EARLY_KEY,  'json'],
  ['classRows',    CLASS_ROWS_KEY,        'json'],
  ['closedLang',   CLOSED_LANG_KEY,       'json'],
  ['prefetch',     PREFETCH_KEY,          'json'],
  ['earlyUnlock',  EARLY_UNLOCK_KEY,      'json'],
  ['edgeLearn',    EDGE_LEARN_KEY,        'json'],
  ['endFit',       END_FIT_KEY,           'json'],
  ['endOnce',      END_ONCE_KEY,          'json'],
  ['endShort',     END_SHORT_KEY,         'json'],
  ['eventsV2',     EVENTS_V2_KEY,         'loose'],
  ['faceLite',     FACE_LITE_KEY,         'json'],
  ['gamesTogether', GAMES_TOGETHER_KEY,   'json'],
  ['gradeChange',  GRADE_CHANGE_KEY,      'json'],
  ['homeButton',   HOME_BUTTON_KEY,       'loose'],
  ['homeInline',   HOME_INLINE_KEY,       'json'],
  ['homeEvery',    HOME_EVERY_KEY,        'json'],
  ['homePreload',  HOME_PRELOAD_KEY,      'json'],
  ['hub',          HUB_KEY,               'loose'],
  ['childMemo',    CHILD_MEMO_KEY,        'json'],
  ['door',         DOOR_KEY,              'loose'],
  ['earlyKid',     EARLY_KID_KEY,         'json'],
  ['embed',        EMBED_KEY,             'json'],
  ['fanout',       FANOUT_KEY,            'json'],
  ['rosterWarm',   ROSTER_WARM_KEY,       'json'],
  ['waves2',       WAVES2_KEY,            'json'],
  ['waves3',       WAVES3_KEY,            'json'],
  ['kidTogether',  KID_TOGETHER_KEY,      'json'],
  ['library',      LIBRARY_KEY,           'loose'],
  ['linkTogether', LINK_TOGETHER_KEY,     'json'],
  ['liveMeter',    LIVE_METER_KEY,        'meter'],
  ['liveReadV3',   LIVE_READ_V3_KEY,      'loose'],
  ['lookAfter',    LOOK_AFTER_KEY,        'json'],
  ['minify',       MINIFY_KEY,            'json'],
  ['offlineGuard', OFFLINE_GUARD_KEY,     'json'],
  ['oneButton',    ONE_BUTTON_KEY,        'json'],
  ['pack',         PACK_KEY,              'json'],
  ['pageLang',     PAGE_LANG_KEY,         'json'],
  ['plainPaint',   PLAIN_PAINT_KEY,       'json'],
  ['readalong',    READALONG_KEY,         'loose'],
  ['rewatchDone',  REWATCH_DONE_KEY,      'json'],
  ['serverTiming', SERVER_TIMING_KEY,     'json'],
  ['nameBidi',     NAME_BIDI_KEY,         'json'],
  [null,           SHARE_KEY,             'read'],
  ['videoClean',   VIDEO_CLEAN_KEY,       'json'],
  ['home',         HOME_KEY,              'json'],
  ['hops',         HOPS_KEY,              'json'],
  ['waitUx',       WAIT_UX_KEY,           'json'],
]);
const RULES = { loose: isTrue, json: (v) => v === true, meter: meterOf };

const HOST_KEYS = Object.freeze(SWITCHES.map(([, key]) => key));
// web_quiz_one_hop (web-quiz-one-hop.js) rides this one read: its cache is filled from these rows (parsed there, JSON
// true only), so a hub open makes no read for it. Not a hub field: the hub's own switches are the HOST_KEYS above.
const KEYS = Object.freeze([...HOST_KEYS, ...OneHop.hubSwitches.keys]);

function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const out = { at: now };
  for (const [field, key, rule] of SWITCHES) if (field) out[field] = RULES[rule](by[key]);
  // the one share: the card on AND the share on, each only as the JSON true
  out.shareOpen = by[CARD_KEY] === true && by[SHARE_KEY] === true;
  return out;
}

/**
 * Another module's one app_settings read that asked for KEYS too (the join's, quiz_join_fast) fills an empty or
 * expired cache from its rows, so no second read follows; a live cache is left as it is. `asked` is the key list that
 * read asked for: a list missing one of KEYS throws; a key asked for with no row is the normal off.
 */
function prime(rows, now = Date.now(), asked = KEYS) {
  const missing = KEYS.filter((k) => !asked.includes(k));
  if (missing.length) throw new Error(`hub flags primed by a read that did not ask for ${missing.join(', ')}`);
  if (cache && now - cache.at < TTL_MS) return;
  cache = fromRows(rows, now);
  OneHop.hubSwitches.prime(rows, now);
}

async function readRows(keys) {
  const { data, error } = await Snap.rows(keys, () => supabase.from('app_settings').select('key, value').in('key', keys));
  if (error) throw new Error(error.message || 'app_settings read failed');
  return data || [];
}

/**
 * The hub's switches and the child's language switch in one read. If that read fails, the hub's switches are read
 * again on their own (the child's language switch then reads its own row and fails closed), so a fault on the child's
 * language row never turns the hub off.
 */
async function readWithChildLang(now) {
  try {
    const rows = await readRows([...KEYS, RETURN_LANG_KEY]);
    langSeen = { at: now, value: (rows.find((r) => r.key === RETURN_LANG_KEY) || {}).value };
    require('./web-quiz-return-lang').prime(langSeen.value, now, langFromHub);
    return rows;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup with the child language switch failed — hub switches alone', { error: err.message });
    langSeen = null;
    return readRows(KEYS);
  }
}

/**
 * The child's language row as the hub's live cache read it ({ at, value }), else undefined: the language switch's own
 * cache, when cold, answers from here before it reads its row.
 */
function langFromHub(now = Date.now()) {
  if (!cache || !langSeen || langSeen.at !== cache.at || now - cache.at >= TTL_MS) return undefined;
  return langSeen;
}

// One read in flight at a time: a page that looks at two of these switches at once (the hub and its one-button
// field) shares the read instead of sending a second.
let reading = null;
function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache);
  if (!reading) reading = read(now).finally(() => { reading = null; });
  return reading;
}

async function read(now) {
  try {
    // If the read that carries web_quiz_one_hop fails (with the child's language row, then without it), one_hop fails
    // closed and the hub's own keys are read again alone: nothing else goes off.
    let data;
    try {
      data = await readWithChildLang(now);
      OneHop.hubSwitches.prime(data, now);
    } catch (firstErr) {
      OneHop.hubSwitches.fail(now);
      data = await readRows(HOST_KEYS);
    }
    cache = fromRows(data, now);
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    // every field off (a meter: none), as an empty read would give; never cached
    return Object.fromEntries(SWITCHES.filter(([field]) => field).map(([field, , rule]) => [field, rule === 'meter' ? null : false]));
  }
}

/** Events v2 on: web_quiz_events_v2 AND its parent web_quiz_hub (cached 30 s, fails closed). Never throws. */
async function eventsV2On() {
  try {
    const f = await flags();
    return Boolean(f.hub && f.eventsV2);
  } catch (_) {
    return false;
  }
}

/** The rung job on: web_quiz_challenge_rungs AND web_quiz_challenge_v2 AND web_quiz_challenge (cached 30 s, fails closed). */
async function rungsOn() {
  try {
    const f = await flags();
    return Boolean(f.challenge && f.challengeV2 && f.rungs);
  } catch (_) {
    return false;
  }
}

/**
 * The same switch, never waited for (the synchronous page-event relay): the cached answer, refreshed in the
 * background when stale; off until the first read lands.
 */
function eventsV2Now(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) flags().catch(() => {});
  return Boolean(cache && cache.hub && cache.eventsV2);
}

/**
 * web_quiz_one_button, never waited for and never read on its own from a cold cache: off until the hub's (or the
 * join's) one read fills the cache; a stale value answers at once and is refreshed in the background; off once it is
 * older than twice the cache time (a refresh that never comes back).
 */
function oneButtonNow(now = Date.now()) {
  if (cache && now - cache.at >= TTL_MS) flags(now).catch(() => {});
  return Boolean(cache && cache.oneButton && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_adventure_look, never waited for: as oneButtonNow (the cached answer, off when cold or too old). */
function advNow(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) flags(now).catch(() => {});
  return Boolean(cache && cache.adv && now - cache.at < 2 * TTL_MS);
}

/**
 * web_quiz_wait_ux, never waited for and never read on its own: only the cache the hub's (or the join's) own read keeps
 * warm. Off when that cache is empty or older than 2 TTLs (a hub answer built across the 30 s mark keeps it), so a
 * route the hub never touches makes no settings read.
 */
function waitUxNow(now = Date.now()) {
  return Boolean(cache && cache.waitUx && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_wait_hops from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function hopsNow(now = Date.now()) {
  return Boolean(cache && cache.hops && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_doors_prefetch from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function prefetchNow(now = Date.now()) {
  return Boolean(cache && cache.prefetch && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_wait_home from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function homeNow(now = Date.now()) {
  return Boolean(cache && cache.home && now - cache.at < 2 * TTL_MS);
}

/** Any SWITCHES field from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function nowOf(field, now = Date.now()) {
  return Boolean(cache && cache[field] && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_hub_fanout from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function fanoutNow(now = Date.now()) {
  return Boolean(cache && cache.fanout && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_busy_page, like waitUxNow: only the batch's warm cache, never a read of its own; off when cold or stale. */
function busyPageNow(now = Date.now()) {
  return Boolean(cache && cache.busyPage === true && now - cache.at < TTL_MS);
}

/** web_quiz_link_together, as busyPageNow: only the batch's warm cache, never a read of its own (cold: off). */
function linkTogetherNow(now = Date.now()) {
  return Boolean(cache && cache.linkTogether === true && now - cache.at < TTL_MS);
}

/** web_quiz_kid_together, as busyPageNow: only the batch's warm cache, never a read of its own (cold: off). */
function kidTogetherNow(now = Date.now()) {
  return Boolean(cache && cache.kidTogether === true && now - cache.at < TTL_MS);
}

/** web_quiz_busy_retry, as busyPageNow: only the batch's warm cache, never a read of its own. */
function busyRetryNow(now = Date.now()) {
  return Boolean(cache && cache.busyRetry === true && now - cache.at < TTL_MS);
}

/** web_quiz_hub_waves2 from the same cache, never read here: on only with fanout on (the shorter chains run inside its branch). */
function waves2Now(now = Date.now()) {
  return Boolean(fanoutNow(now) && cache.waves2);
}

/** web_quiz_hub_waves3 from the same cache, never read here: on only with fanout on (as waves2Now). */
function waves3Now(now = Date.now()) {
  return Boolean(fanoutNow(now) && cache.waves3);
}

/** web_quiz_hub_embed from the same cache, never read here: on only with fanout on (as waves2Now). */
function embedNow(now = Date.now()) {
  return Boolean(fanoutNow(now) && cache.embed);
}

/** web_quiz_hub_child_memo from the hub's own switch cache, never read here: as fanoutNow. */
function childMemoNow(now = Date.now()) {
  return Boolean(cache && cache.childMemo && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_hub_early_kid from the hub's own switch cache, never read here: as fanoutNow. */
function earlyKidNow(now = Date.now()) {
  return Boolean(cache && cache.earlyKid && now - cache.at < 2 * TTL_MS);
}

/**
 * The step-timings switch, never waited for and never reading: the batch's cached answer (refreshed by the hub's own
 * flags() call on every hub answer); off until the first read lands, off on a failed read, off when the cache is older
 * than twice its life.
 */
function serverTimingNow(now = Date.now()) {
  return Boolean(cache && cache.serverTiming === true && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_edge_learn, never waited for: the hub's cached value (the hub's read has just run on a hub answer); off when none. */
function edgeLearnNow(now = Date.now()) {
  return Boolean(cache && cache.edgeLearn === true && now - cache.at < TTL_MS);
}

/**
 * The one share on, never read on its own: only the cache this module's read (or the join's) keeps warm, as waitUxNow.
 * A home link is made right after hubLink() read it, so off (or a failed read) asks nothing more. Never throws.
 */
function shareOpenNow(now = Date.now()) {
  return Boolean(cache && cache.shareOpen && now - cache.at < TTL_MS);
}

function faceLiteNow(now = Date.now()) {
  return Boolean(cache && cache.faceLite && now - cache.at < TTL_MS);
}

/** web_quiz_offline_guard, the same way: never waited for, never read on its own, off when the hub's cache is empty or expired. */
function offlineGuardNow(now = Date.now()) {
  return Boolean(cache && cache.offlineGuard && now - cache.at < TTL_MS);
}

/**
 * web_quiz_minify, never waited for and never read on its own: only the cache this module's read keeps warm (the hub's
 * and the quiz page's own switch read run before the answer is built). Off when that cache is empty or older than 2 TTLs.
 */
function minifyNow(now = Date.now()) {
  return Boolean(cache && cache.minify && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_plain_paint from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function plainPaintNow(now = Date.now()) {
  return Boolean(cache && cache.plainPaint && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_closed_lang from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function closedLangNow(now = Date.now()) {
  return Boolean(cache && cache.closedLang && now - cache.at < 2 * TTL_MS);
}

/** The quiz page's `nav` ({home, back}) when either switch is on, else null (the payload stays today's). Never throws. */
async function pageNav() {
  try {
    const f = await flags();
    const home = Boolean(f.hub && f.homeButton);
    const back = Boolean(f.backNav);
    return home || back ? { home, back } : null;
  } catch (_) {
    return null;
  }
}

/**
 * `<portal>/h/<token>` for these children, or null (hub off, no base URL, no secret, no child). Never throws.
 * `caller` names the builder on a dropped-id log line (signHub's default when omitted); or `{ caller, lang }` in its
 * place: `lang` (en|ur) is the language the reply or landing speaks, carried in the token only with web_quiz_return_lang on.
 */
async function hubLink(studentIds, caller) {
  try {
    const Link = require('./web-quiz-link');
    const base = Link.webBaseUrl();
    if (!base || !(await flags()).hub) return null;
    const opts = caller && typeof caller === 'object' ? caller : { caller };
    const R = require('./web-quiz-return-lang');
    const lang = R.linkLang(opts.lang) && (await R.on()) ? opts.lang : null;
    const token = lang ? T.signHub(studentIds, opts.caller, { lang }) : T.signHub(studentIds, opts.caller);
    return token ? `${base}/h/${token}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz hub: no hub link', { error: err.message });
    return null;
  }
}

// one export per line, in name order (two changes that add an export touch different lines)
module.exports = {
  ADV_KEY,
  advNow,
  BACK_NAV_KEY,
  BUSY_PAGE_KEY,
  busyPageNow,
  BUSY_RETRY_KEY,
  busyRetryNow,
  CHALLENGE_KEY,
  CHILD_HOME_KEY,
  CHILD_MEMO_KEY,
  childMemoNow,
  CLOSED_LANG_KEY,
  closedLangNow,
  DOOR_KEY,
  EARLY_KID_KEY,
  earlyKidNow,
  EDGE_LEARN_KEY,
  edgeLearnNow,
  EVENTS_V2_KEY,
  eventsV2Now,
  eventsV2On,
  FACE_LITE_KEY,
  faceLiteNow,
  FANOUT_KEY,
  ROSTER_WARM_KEY,
  fanoutNow,
  flags,
  GRADE_CHANGE_KEY,
  HOME_BUTTON_KEY,
  HOME_KEY,
  HOME_INLINE_KEY,
  HOME_EVERY_KEY,
  EARLY_UNLOCK_KEY,
  REWATCH_DONE_KEY,
  VIDEO_CLEAN_KEY,
  HOME_PRELOAD_KEY,
  homeNow,
  HOPS_KEY,
  hopsNow,
  HUB_KEY,
  hubLink,
  KEYS,
  CLASS_PIC_EARLY_KEY,
  LIBRARY_KEY,
  GAMES_TOGETHER_KEY,
  LIVE_METER_KEY,
  LIVE_READ_V3_KEY,
  LOOK_AFTER_KEY,
  MINIFY_KEY,
  minifyNow,
  nowOf,
  OFFLINE_GUARD_KEY,
  offlineGuardNow,
  ONE_BUTTON_KEY,
  oneButtonNow,
  PACK_KEY,
  PAGE_LANG_KEY,
  pageNav,
  PLAIN_PAINT_KEY,
  plainPaintNow,
  PREFETCH_KEY,
  prefetchNow,
  prime,
  RUNGS_KEY,
  rungsOn,
  SERVER_TIMING_KEY,
  serverTimingNow,
  shareOpenNow,
  SWITCHES,
  WAIT_UX_KEY,
  waitUxNow,
  WAVES2_KEY,
  waves2Now,
  WAVES3_KEY,
  waves3Now,
  EMBED_KEY,
  embedNow,
  KID_TOGETHER_KEY,
  kidTogetherNow,
  LINK_TOGETHER_KEY,
  CLASS_ROWS_KEY,
  CHALLENGE_EARLY_KEY,
  linkTogetherNow,
  _resetCache: () => { cache = null; reading = null; langSeen = null; },
};
