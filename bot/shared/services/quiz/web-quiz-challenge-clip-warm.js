'use strict';
/**
 * The Challenge's clip warm job: no child meets silence on the first tap after a deploy.
 *
 * Once a Pakistan day, and on the first sweep tick after the queue service boots (sqs-worker.js scheduleChallengeVoiceSweep),
 * every `challenge_passages` row released by now or within the next 7 days (not withdrawn, not retired) has its clips
 * made ahead of the first child: a listening passage's story, each tap question's prompt, and, under
 * `web_quiz_challenge_option_audio`, each listening option. The texts and keys are the serve's own
 * (web-quiz-challenge.js clipKey / tapOptions, the passage from the item bank's registry loader) and each clip is
 * recorded by the serve's own recorder (lazy TTS to R2, `web_quiz.ch_clip_recorded` per clip), under the same
 * per-process cap (MAX_CLIP_RECORDINGS) a child's first serve has: at the cap the run records nothing more and counts
 * the rest as missing. Read-alouds' daily budget (web-quiz-challenge-budget.js) is STT and is untouched here.
 *
 * One event per run: `web_quiz.ch_clip_warm {n, missing, w:'s'}` (n = clips asked for, missing = still absent).
 * Behind app_settings `web_quiz_challenge_clip_warm`, effective only with `web_quiz_challenge_v2` and
 * `web_quiz_challenge` on (each fails closed). Off ⇒ one switch read and nothing else: clips record on first serve.
 * Cost ≈ US$0.0002 a clip (Soniox by audio time).
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const AudioStore = require('./web-quiz-audio-store');
const Ch = require('./web-quiz-challenge');

const SWITCH_KEY = 'web_quiz_challenge_clip_warm';
const V2_KEY = 'web_quiz_challenge_v2';
const AHEAD_MS = 7 * 24 * 3600 * 1000;

let lastDay = null;   // the Pakistan day this process last ran a warm

/** The switch and its parents, the switch first (off ⇒ that one read only). */
async function switchOn() {
  return (await Ch.settingOn(SWITCH_KEY)) && (await Ch.settingOn(V2_KEY)) && (await Ch.challengeOn());
}

/** The passages to warm: released by now + 7 days, not withdrawn, not retired; oldest release first. */
async function passageRows(now) {
  const { data, error } = await supabase.from('challenge_passages').select('passage_id, lang, kind, status, released_at, withdrawn_at')
    .not('released_at', 'is', null).is('withdrawn_at', null).neq('status', 'retired');
  if (error) throw new Error(error.message || 'challenge_passages read failed');
  return (data || []).filter((r) => Date.parse(r.released_at) <= now + AHEAD_MS)
    .sort((a, b) => Date.parse(a.released_at) - Date.parse(b.released_at) || String(a.passage_id).localeCompare(String(b.passage_id)));
}

/** One passage's clips as the serve asks for them: [{ key, text, lang }]. */
function clipsOf(p, optAudio) {
  const out = [];
  const lang = p.lang;
  if (p.kind === 'listen' && p.text) out.push({ key: Ch.clipKey('listen', 'story', lang, p.text), text: p.text, lang });
  for (const q of p.questions || []) {
    const t = Ch.tapOptions(q, lang, 'clip-warm');   // the option ORDER is per run; the set (and so the keys) is not
    if (!t) continue;
    const k = q.id.split('.').pop();
    out.push({ key: Ch.clipKey(p.kind, k, lang, q.prompt), text: q.prompt, lang });
    if (p.kind === 'listen' && optAudio) t.options.forEach((o) => out.push({ key: Ch.clipKey('listen', `${k}-opt`, lang, o), text: o, lang }));
  }
  return out;
}

/**
 * One warm run. Null when the switch (or a parent) is off, or the passages could not be read; else
 * { n, missing, recorded, had, capped, passages }.
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
    for (const c of clipsOf(p, optAudio)) if (!clips.has(c.key) && clips.size < limit) clips.set(c.key, c);
  }
  const tally = { recorded: 0, had: 0, missing: 0 };
  let capped = false;
  for (const c of clips.values()) {
    if (!capped && Ch.clipsLeft() === 0) capped = true;
    tally[await Ch.warmClip(c.key, c.text, c.lang, { record: !capped })] += 1;
  }
  const out = { n: clips.size, missing: tally.missing, recorded: tally.recorded, had: tally.had, capped, passages };
  logEvent('web_quiz.ch_clip_warm', { n: out.n, missing: out.missing, w: 's' });
  logToFile('🔊 Challenge clip warm', out);
  return out;
}

/** The daily entry: at most one run per Pakistan day per process (the first tick after boot runs). */
async function daily({ now = Date.now() } = {}) {
  const day = AudioStore.pkDay(now);
  if (lastDay === day) return null;
  lastDay = day;
  return warmClips({ now });
}

function __reset() { lastDay = null; }

module.exports = { switchOn, warmClips, daily, SWITCH_KEY, __reset };
