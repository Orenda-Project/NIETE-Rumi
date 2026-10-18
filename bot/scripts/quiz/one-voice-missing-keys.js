#!/usr/bin/env node
'use strict';
/**
 * The check before app_settings `web_quiz_one_voice` goes on: is every voice line a child can be served under THAT
 * plan already in the store, in the plan's voice?
 *
 *   node scripts/quiz/one-voice-missing-keys.js --expect-ref <project-ref> --plan '<the exact switch value, JSON>'
 *        [--record-short --max-usd X]
 *
 * With the switch on, Jugnu's challenge clips are read under keys that name the plan voice's rendering
 * (web-quiz-challenge.js clipKey). A key with no file is recorded at a child's first open, in that voice but outside
 * any checked take. So the gated takes go up first, and this check says when none is missing:
 * - the clips: the clip warm job's own list (web-quiz-challenge-clip-warm.js passageRows + clipsOf: the listening
 *   stories, the prompts, the options under web_quiz_challenge_option_audio, the Story Time read-along clips), each
 *   looked up under the key computed with the plan PINNED (the live switch value is never read);
 * - Jugnu's shared lines: the set of each language's plan voice (web-quiz-voice.js SHARED_SETS) must exist, and the
 *   set of every quiz the plan maps to one (`quiz_voices`);
 * - the per-quiz map as the value carries it: an entry the plan drops (not a recorded set's name or "keep") would give
 *   that quiz its language's voice without a word, so each is listed (`dropped`) and the check is not ok.
 * Line 1 names both families the flip moves: the quiz lines' voice per language and the challenge's storybook voice
 * (web-quiz-voice.js STORY_VOICE, the voice of the clip keys).
 * Read-only: nothing is recorded or written. Refuses unless SUPABASE_URL's project ref equals --expect-ref.
 * Prints passage ids, languages and parts, never a passage's words. Exit 0 only when nothing is missing.
 *
 * --record-short: the short lines that are missing (each question's prompt and its options, never a listening story or a
 * Story Time read-along: those are checked takes) are recorded first, by the challenge's own recorder under the pinned
 * plan (provider bytes, one call a line), each through a light gate: a length plausible for its words, and for a prompt
 * of 4+ words one transcription with a word error rate ≤ 0.20 (EN) / 0.25 (UR). A take that fails is deleted and
 * recorded once more; failing again it is deleted and listed (`gate_failed`). Stops before the next line once the
 * spend reaches --max-usd (default 5); prints `SPEND usd=… chars=…`. A process records at most the recorder's daily
 * cap (`capped`): run it again.
 */

const { projectRef } = require('./backfill-bank-quiz-audio');

// The light gate's numbers: characters a second of each voice's speech (measured on the one voice's lines), a take's
// length against that estimate, the word error a prompt may have, and the price (ElevenLabs per character; Soniox async).
const CPS = { en: 14, ur: 12 };
const LENGTH_RANGE = [0.25, 3.0];
const MAX_WER = { en: 0.20, ur: 0.25 };
const USD_PER_CHAR = 0.30 / 1000;
const STT_USD_PER_S = 0.135 / 3600;
const SHORT_PART = /^q\d+(-opt)?$/;

function parseArgs(argv) {
  const args = { expectRef: null, plan: undefined, raw: undefined, recordShort: false, maxUsd: 5 };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--expect-ref') args.expectRef = String(next() || '').trim() || null;
    else if (a === '--record-short') args.recordShort = true;
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--plan') {
      let value = null;
      try { value = JSON.parse(next()); } catch (_) { value = null; }
      args.raw = value;
      args.plan = require('../../shared/services/quiz/web-quiz-one-voice-flag').normalize(value);
    }
  }
  return args;
}

// "<exercise>/<part>" of a challenge clip key: quiz-audio/<env>/challenge/<lang>/<exercise>/<part>-<voice>-<hash8>.ogg
function partOf(key) {
  const bits = String(key).split('/');
  const file = bits.pop();
  const m = /^(.*?)-(?:sx|el|oa)-/.exec(file);
  return `${bits.pop()}/${m ? m[1] : file}`;
}

/** Word error rate of what was heard against the words (the child test's word rules: text-norm clean + same). Pure. */
function wer(text, heard) {
  const N = require('../../shared/services/child-test/scoring/text-norm');
  const ref = N.refWords(text);
  const hyp = N.refWords(heard);
  if (!ref.length) return 0;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (N.same(ref[i - 1], hyp[j - 1]) ? 0 : 1));
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

// The default hearing: Soniox async through the child test's own transcription (the audio in a private temp file).
async function sonioxHears(audio, lang) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-voice-gate-'));
  const file = path.join(dir, 'clip.ogg');
  try {
    fs.writeFileSync(file, audio, { mode: 0o600 });
    return (await require('../../shared/services/child-test/scoring/stt').transcribe(file, lang)).text || '';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The light gate on one take: null when it passes, else the reason ("length=…", "wer=…"). */
async function gate(c, res, stt) {
  const chars = [...String(c.text)].length;
  const est = 0.3 + chars / (CPS[c.lang] || CPS.en);
  const ratio = (Number(res.durationSec) || 0) / est;
  if (!(res.audio && res.audio.length) || ratio < LENGTH_RANGE[0] || ratio > LENGTH_RANGE[1]) return `length=${ratio.toFixed(2)}`;
  if (!/-opt$/.test(c.part) && String(c.text).trim().split(/\s+/).length >= 4) {
    const w = wer(c.text, await stt(res.audio, c.lang, c.text));
    if (w > (MAX_WER[c.lang] || MAX_WER.en)) return `wer=${w.toFixed(2)}`;
  }
  return null;
}

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const print = deps.print || ((line) => process.stdout.write(`${line}\n`));
  const now = deps.now || Date.now();
  const args = parseArgs(argv);
  const ref = projectRef(env.SUPABASE_URL);
  if (!args.expectRef || !ref || ref !== args.expectRef) {
    print('REFUSED: SUPABASE_URL is not the project passed in --expect-ref (neither is printed). Nothing was read.');
    return { refused: true };
  }
  if (!args.plan) {
    print('REFUSED: --plan names no voice plan (the switch value, as JSON). Nothing was read.');
    return { refused: true };
  }
  const OneVoice = require('../../shared/services/quiz/web-quiz-one-voice-flag');
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  OneVoice.pin(args.plan);
  const Ch = require('../../shared/services/quiz/web-quiz-challenge');
  const CW = require('../../shared/services/quiz/web-quiz-challenge-clip-warm');
  const Bank = require('../../shared/services/child-test/item-bank');

  // A language the plan leaves out keeps today's voice: "today" (its keys and shared lines are today's).
  const setOf = (lang) => (args.plan.voices[lang] === null ? 'today' : Voice.setIdOf(args.plan.voices[lang]));
  const storyOf = (lang) => (args.plan.voices[lang] === null ? 'today' : Voice.setIdOf(Voice.STORY_VOICE[lang]));
  const rawMap = args.raw && args.raw.quiz_voices && typeof args.raw.quiz_voices === 'object' && !Array.isArray(args.raw.quiz_voices)
    ? args.raw.quiz_voices : {};
  const map = args.plan.quiz_voices || {};
  const dropped = Object.keys(rawMap).filter((id) => !(id in map)).sort();
  print(`one-voice-missing-keys: plan=${args.plan.sig} en=${setOf('en')} ur=${setOf('ur')} challenge=en:${storyOf('en')},ur:${storyOf('ur')}`
    + ` quiz_voices=${Object.keys(rawMap).length} dropped=${dropped.length}`);
  dropped.forEach((id) => print(`dropped\tquiz_voices\t${id}`));
  const optAudio = await Ch.optionAudioOn();
  const clips = new Map();
  for (const r of await CW.passageRows(now)) {
    const p = Bank.getPassage(r.passage_id);
    if (!p) { print(`no_file\t${r.passage_id}`); continue; }
    for (const c of CW.clipsOf(p, optAudio, r.pool || p.pool)) if (!clips.has(c.key)) clips.set(c.key, { ...c, id: r.passage_id });
  }
  const rec = { recorded: 0, gateFailed: 0, usd: 0, chars: 0, stopped: null };
  const failed = new Set();   // takes that failed the gate were deleted: missing, whatever this process remembers
  if (args.recordShort) {
    const r2 = require('../../shared/storage/r2');
    const bucket = require('../../shared/services/quiz/web-quiz-audio-store').quizAudioBucket();
    const stt = deps.stt || sonioxHears;
    for (const c of clips.values()) {
      const part = partOf(c.key).split('/').pop();
      if (!SHORT_PART.test(part)) continue;
      if ((await Ch.warmClip(c.key, c.text, c.lang, { record: false, now })) === 'had') continue;
      let why = null;
      let takes = 0;
      while (takes < 2) {
        if (rec.usd >= args.maxUsd) { rec.stopped = 'max_usd'; break; }
        const res = await Ch.recordClip(c.key, c.text, c.lang, now);
        if (!res) { rec.stopped = 'capped'; break; }
        takes += 1;
        rec.chars += [...String(c.text)].length;
        rec.usd += [...String(c.text)].length * USD_PER_CHAR + (Number(res.durationSec) || 0) * STT_USD_PER_S;
        why = await gate({ ...c, part }, res, stt);
        if (!why) break;
        try { await r2.deleteKey(c.key, { bucket }); } catch (_) { /* listed as failed either way */ }
      }
      if (takes && !why) {
        rec.recorded += 1;
        print(`recorded\t${c.id}\t${c.lang}\t${partOf(c.key)}`);
      } else if (takes) {
        failed.add(c.key);
        rec.gateFailed += 1;
        print(`gate_failed\t${c.id}\t${c.lang}\t${partOf(c.key)}\t${why}${takes < 2 ? ` (not retried: ${rec.stopped})` : ''}`);
      }
      if (rec.stopped) break;
    }
    print(`SPEND usd=${rec.usd.toFixed(4)} chars=${rec.chars}`);
  }
  let present = 0;
  let missing = 0;
  for (const c of clips.values()) {
    if (!failed.has(c.key) && (await Ch.warmClip(c.key, c.text, c.lang, { record: false, now })) === 'had') { present += 1; continue; }
    missing += 1;
    print(`missing\t${c.id}\t${c.lang}\t${partOf(c.key)}`);
  }
  const sets = Voice.sharedSets(args.plan);
  const shared = {};
  ['en', 'ur'].forEach((lang) => {
    if (args.plan.voices[lang] === null) { shared[lang] = 'today'; return; }
    shared[lang] = sets[lang] ? sets[lang].path : null;
    if (!sets[lang]) print(`missing\tshared-lines\t${lang}\t${setOf(lang)}`);
  });
  const unsetMapped = [...new Set(Object.values(map))].filter((t) => t !== 'keep' && !Voice.SHARED_SETS[t]).sort();
  unsetMapped.forEach((t) => print(`missing\tshared-lines\tquiz\t${t}`));
  const ok = missing === 0 && Boolean(shared.en && shared.ur) && !dropped.length && !unsetMapped.length;
  print(`SUMMARY present=${present} total=${clips.size} missing=${missing} shared=en:${shared.en || 'none'},ur:${shared.ur || 'none'} dropped=${dropped.length} ok=${ok ? 'yes' : 'no'}${rec.stopped ? ` stopped=${rec.stopped}` : ''}`);
  return { ok, present, total: clips.size, missing, shared, dropped: dropped.length, recorded: rec.recorded, gateFailed: rec.gateFailed, usd: rec.usd, stopped: rec.stopped };
}

module.exports = { main, parseArgs, wer };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.exit(r && r.refused ? 2 : r && r.ok ? 0 : 1); })
    .catch((e) => { process.stderr.write(`one-voice-missing-keys failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
