#!/usr/bin/env node
'use strict';
/**
 * The check before app_settings `web_quiz_one_voice` goes on: is every voice line a child can be served under THAT
 * plan already in the store, in the plan's voice?
 *
 *   node scripts/quiz/one-voice-missing-keys.js --expect-ref <project-ref> --plan '<the exact switch value, JSON>'
 *
 * With the switch on, Jugnu's challenge clips are read under keys that name the plan voice's rendering
 * (web-quiz-challenge.js clipKey). A key with no file is recorded at a child's first open, in that voice but outside
 * any checked take. So the gated takes go up first, and this check says when none is missing:
 * - the clips: the clip warm job's own list (web-quiz-challenge-clip-warm.js passageRows + clipsOf: the listening
 *   stories, the prompts, the options under web_quiz_challenge_option_audio, the Story Time read-along clips), each
 *   looked up under the key computed with the plan PINNED (the live switch value is never read);
 * - Jugnu's shared lines: the set of each language's plan voice (web-quiz-voice.js SHARED_SETS) must exist.
 * Read-only: nothing is recorded or written. Refuses unless SUPABASE_URL's project ref equals --expect-ref.
 * Prints passage ids, languages and parts, never a passage's words. Exit 0 only when nothing is missing.
 */

const { projectRef } = require('./backfill-bank-quiz-audio');

function parseArgs(argv) {
  const args = { expectRef: null, plan: undefined };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--expect-ref') args.expectRef = String(next() || '').trim() || null;
    else if (a === '--plan') {
      let value = null;
      try { value = JSON.parse(next()); } catch (_) { value = null; }
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

  print(`one-voice-missing-keys: plan=${args.plan.sig} en=${Voice.setIdOf(args.plan.voices.en)} ur=${Voice.setIdOf(args.plan.voices.ur)}`);
  const optAudio = await Ch.optionAudioOn();
  const clips = new Map();
  for (const r of await CW.passageRows(now)) {
    const p = Bank.getPassage(r.passage_id);
    if (!p) { print(`no_file\t${r.passage_id}`); continue; }
    for (const c of CW.clipsOf(p, optAudio, r.pool || p.pool)) if (!clips.has(c.key)) clips.set(c.key, { ...c, id: r.passage_id });
  }
  let present = 0;
  let missing = 0;
  for (const c of clips.values()) {
    if ((await Ch.warmClip(c.key, c.text, c.lang, { record: false, now })) === 'had') { present += 1; continue; }
    missing += 1;
    print(`missing\t${c.id}\t${c.lang}\t${partOf(c.key)}`);
  }
  const sets = Voice.sharedSets(args.plan);
  const shared = {};
  ['en', 'ur'].forEach((lang) => {
    shared[lang] = sets[lang] ? sets[lang].path : null;
    if (!sets[lang]) print(`missing\tshared-lines\t${lang}\t${Voice.setIdOf(args.plan.voices[lang])}`);
  });
  const ok = missing === 0 && Boolean(shared.en && shared.ur);
  print(`SUMMARY present=${present} total=${clips.size} missing=${missing} shared=en:${shared.en || 'none'},ur:${shared.ur || 'none'} ok=${ok ? 'yes' : 'no'}`);
  return { ok, present, total: clips.size, missing, shared };
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.exit(r && r.refused ? 2 : r && r.ok ? 0 : 1); })
    .catch((e) => { process.stderr.write(`one-voice-missing-keys failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
