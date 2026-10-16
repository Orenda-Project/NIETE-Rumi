'use strict';
/**
 * The Challenge's clip warm job: no child meets silence on the first tap after a deploy.
 *
 * Once a Pakistan day, and on the first sweep tick after the queue service boots (sqs-worker.js scheduleChallengeVoiceSweep),
 * every `challenge_passages` row released by now or within the next 7 days (not withdrawn, not retired) has its clips
 * made ahead of the first child: a listening passage's story, each tap question's prompt, and, under
 * `web_quiz_challenge_option_audio`, each listening option. The texts and keys are the serve's own
 * (web-quiz-challenge.js clipKey / tapOptions, the passage from the item bank's registry loader) and each clip is
 * recorded by the serve's own recorder (lazy TTS to R2, `web_quiz.ch_clip_recorded` per clip). The recorder's
 * per-process cap (MAX_CLIP_RECORDINGS) is shared with a child's first serve, so a run never spends it all: it records
 * at most WARM_MAX_PER_RUN clips, and never once SERVE_HEADROOM or fewer recordings are left for children's serves.
 * Past either limit the store is still asked and the rest are counted as missing. Read-alouds' daily budget (web-quiz-challenge-budget.js) is STT and is untouched here.
 *
 * One event per run: `web_quiz.ch_clip_warm {n, missing, missing_listen, w:'s'}` (n = clips asked for, missing = still
 * absent, missing_listen = those of them a check-pool listening passage needs: its story, prompts and options).
 * Behind app_settings `web_quiz_challenge_clip_warm`, effective only with `web_quiz_challenge_v2` and
 * `web_quiz_challenge` on (each fails closed). Off ⇒ one switch read and nothing else: clips record on first serve.
 * Cost ≈ US$0.0002 a clip (Soniox by audio time).
 *
 * The order (RULING #100(a)): the check-pool LISTENING clips come first — every listening story (the one clip a child
 * cannot play the stop without), then those passages' prompts and options — and only then every other clip (read
 * prompts, practice and Story Time clips) in release order. A capped run so spends its allowance where a cold clip
 * would turn a child away.
 *
 * The daily guard (RULING #121): a run that ends capped having recorded at least one clip does not close the Pakistan
 * day, so the next hourly tick warms again; a capped run that recorded nothing, an uncapped run, or the
 * MAX_CAPPED_RUNS_PER_DAY-th capped run that day closes it (a recorder that fails every clip cannot spend all day).
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const AudioStore = require('./web-quiz-audio-store');
const Ch = require('./web-quiz-challenge');

const SWITCH_KEY = 'web_quiz_challenge_clip_warm';
const V2_KEY = 'web_quiz_challenge_v2';
const AHEAD_MS = 7 * 24 * 3600 * 1000;
const WARM_MAX_PER_RUN = 96;   // recordings one run may make
const SERVE_HEADROOM = 32;     // recordings always left for children's first serves
const MAX_CAPPED_RUNS_PER_DAY = 8;   // capped runs one Pakistan day may re-arm, per process

let lastDay = null;   // the Pakistan day this process closed its warm for
let cappedToday = { day: null, cappedRuns: 0 };   // capped runs this Pakistan day

/** The switch and its parents, the switch first (off ⇒ that one read only). */
async function switchOn() {
  return (await Ch.settingOn(SWITCH_KEY)) && (await Ch.settingOn(V2_KEY)) && (await Ch.challengeOn());
}

/** The passages to warm: released by now + 7 days, not withdrawn, not retired; oldest release first. */
async function passageRows(now) {
  const { data, error } = await supabase.from('challenge_passages').select('passage_id, lang, kind, pool, status, released_at, withdrawn_at')
    .not('released_at', 'is', null).is('withdrawn_at', null).neq('status', 'retired');
  if (error) throw new Error(error.message || 'challenge_passages read failed');
  return (data || []).filter((r) => Date.parse(r.released_at) <= now + AHEAD_MS)
    .sort((a, b) => Date.parse(a.released_at) - Date.parse(b.released_at) || String(a.passage_id).localeCompare(String(b.passage_id)));
}

// The warm's tiers: 0 = a check-pool listening story, 1 = that passage's prompts and options, 2 = everything else.
const CHECK_LISTEN_STORY = 0;
const CHECK_LISTEN_REST = 1;
const OTHER = 2;

/** One passage's clips as the serve asks for them, each with its tier: [{ key, text, lang, tier }]. */
function clipsOf(p, optAudio, pool = p.pool) {
  const out = [];
  const lang = p.lang;
  const checkListen = p.kind === 'listen' && pool === 'check';
  if (p.kind === 'listen' && p.text) out.push({ key: Ch.clipKey('listen', 'story', lang, p.text), text: p.text, lang, tier: checkListen ? CHECK_LISTEN_STORY : OTHER });
  for (const q of p.questions || []) {
    const t = Ch.tapOptions(q, lang, 'clip-warm');   // the option ORDER is per run; the set (and so the keys) is not
    if (!t) continue;
    const k = q.id.split('.').pop();
    const tier = checkListen ? CHECK_LISTEN_REST : OTHER;
    out.push({ key: Ch.clipKey(p.kind, k, lang, q.prompt), text: q.prompt, lang, tier });
    if (p.kind === 'listen' && optAudio) t.options.forEach((o) => out.push({ key: Ch.clipKey('listen', `${k}-opt`, lang, o), text: o, lang, tier }));
  }
  return out;
}

/** The clips in warm order: by tier (check-pool listening stories, their prompts and options, the rest), release order within a tier; the first `limit`. */
function inWarmOrder(clips, limit) {
  const ordered = [...clips.values()].map((c, i) => ({ c, i })).sort((a, b) => a.c.tier - b.c.tier || a.i - b.i).map((x) => x.c);
  return Number.isFinite(limit) ? ordered.slice(0, limit) : ordered;
}

/**
 * One warm run. Null when the switch (or a parent) is off, or the passages could not be read; else
 * { n, missing, missing_listen, recorded, had, capped, passages }.
 */
async function warmClips({ now = Date.now(), limit = Infinity } = {}) {
  if (!(await switchOn())) return null;
  let rows;
  try {
    rows = await passageRows(now);
  } catch (e) {
    logError('web_quiz.ch_clip_warm_failed', { error: String((e && e.message) || e).slice(0, 160) });
    return null;
  }
  const Bank = require('../child-test/item-bank');
  const optAudio = await Ch.optionAudioOn();
  const clips = new Map();
  let passages = 0;
  for (const r of rows) {
    const p = Bank.getPassage(r.passage_id);
    if (!p) { logToFile('⚠️ challenge clip warm: a registry passage has no file in this deploy', { passage_id: r.passage_id }); continue; }
    passages += 1;
    for (const c of clipsOf(p, optAudio, r.pool || p.pool)) {
      const have = clips.get(c.key);
      if (!have) clips.set(c.key, c);
      else if (c.tier < have.tier) have.tier = c.tier;   // one key shared by two passages warms at the earlier tier
    }
  }
  const ordered = inWarmOrder(clips, limit);
  const tally = { recorded: 0, had: 0, missing: 0 };
  let missingListen = 0;
  let capped = false;
  let attempts = 0;
  for (const c of ordered) {
    if (!capped && (attempts >= WARM_MAX_PER_RUN || Ch.clipsLeft(now) <= SERVE_HEADROOM)) capped = true;
    const r = await Ch.warmClip(c.key, c.text, c.lang, { record: !capped, now });
    if (r !== 'had' && !capped) attempts += 1;
    tally[r] += 1;
    if (r === 'missing' && c.tier <= CHECK_LISTEN_REST) missingListen += 1;
  }
  const out = { n: ordered.length, missing: tally.missing, missing_listen: missingListen, recorded: tally.recorded, had: tally.had, capped, passages };
  logEvent('web_quiz.ch_clip_warm', { n: out.n, missing: out.missing, missing_listen: out.missing_listen, w: 's' });
  logToFile('🔊 Challenge clip warm', out);
  return out;
}

/**
 * The daily entry (the first tick after boot runs): the run's object, or null once the Pakistan day is closed. The day is
 * claimed before the run (an overlapping tick does nothing) and given back after a capped run that recorded clips,
 * until the MAX_CAPPED_RUNS_PER_DAY-th capped run that day.
 */
async function daily({ now = Date.now() } = {}) {
  const day = AudioStore.pkDay(now);
  if (lastDay === day) return null;
  const before = lastDay;
  lastDay = day;
  const out = await warmClips({ now });
  if (out && out.capped) {
    if (cappedToday.day !== day) cappedToday = { day, cappedRuns: 0 };
    cappedToday.cappedRuns += 1;
    if (out.recorded > 0 && cappedToday.cappedRuns < MAX_CAPPED_RUNS_PER_DAY && lastDay === day) lastDay = before;
  }
  return out;
}

function __reset() { lastDay = null; cappedToday = { day: null, cappedRuns: 0 }; }

module.exports = { switchOn, warmClips, daily, SWITCH_KEY, WARM_MAX_PER_RUN, SERVE_HEADROOM, MAX_CAPPED_RUNS_PER_DAY, __reset };
