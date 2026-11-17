'use strict';
/**
 * Round 28 (sa_r28_letter_pick, sa_r28_mcq, sa_r28_ceiling): with every round-28 switch OFF, nothing a phone receives
 * or does changes. Two goldens recorded on the code BEFORE round 28 (`__golden__/sa-r28-off-identity.json`):
 *
 *   batteries  for every coach form (G1..G5 × ur/en) and two switch states (everything OFF; every earlier switch ON),
 *              the sha256 of the JSON the battery route would serve (applySwitches), ui flags left in: the earlier
 *              switches' flags are part of what a phone runs and must not move either.
 *   runs       sa-core through one Urdu and one English RDF-auto battery with today's runner options and a scripted
 *              child (the same taps every time, a fixed clock): the sha256 of the ordered event log and the results.
 *
 * A round-28 change that leaks with the switches OFF moves a digest and fails here. To re-record after a DELIBERATE
 * content change (a new bank version): SA_R28_RECORD_GOLDEN=1 ./run-tests.sh tests/sa-r28-off-identity, and say why in
 * the commit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../sa/sa-core');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const GOLDEN = path.join(__dirname, '__golden__', 'sa-r28-off-identity.json');
const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const FORMS = [1, 2, 3, 4, 5].flatMap((g) => ['ur', 'en'].map((l) => `sa.coach.G${g}.A.${l}.json`));
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const read = (name) => JSON.parse(fs.readFileSync(path.join(BATTERIES, name), 'utf8'));

/** Every switch the route knows, OFF; then every switch that is not round 28, ON (the sandbox of the day). */
function states() {
  const names = Object.keys(SWITCHES);
  const r28 = (k) => /^r28/.test(k);
  return {
    all_off: Object.fromEntries(names.map((k) => [k, false])),
    earlier_on: Object.fromEntries(names.map((k) => [k, !r28(k)])),
  };
}

/** A scripted child through one battery: every answer is the target, every cell is tapped, the story is "done". */
function run(battery, block) {
  let t = 0;
  const now = () => (t += 250);
  const events = [];
  const served = applySwitches(battery, states().earlier_on);
  const list = Array.isArray(served[block]) ? served[block] : null;
  const picked = list ? { ...served, tasks: list.map((id) => served.tasks.find((x) => x.id === id)).filter(Boolean) } : served;
  const w3 = picked.ui || {};
  const r = core.createRunner({
    battery: picked, now, wall: () => '2026-01-01T00:00:00.000Z', session_id: 'golden', onEvent: (e) => events.push(e),
    audio_check: false, warmup: false, mic: () => 'ok', oral_practice: false, keypad_warmup: false,
    one_at_a_time: w3.one_at_a_time === true, cell_pace: w3.cell_pace === true, cell_next_only: w3.cell_next_only === true,
    comp_all_questions: w3.comp_all_questions === true, section_recording: w3.section_recording === true,
    skip_last_word: w3.auto_no_last_word === true, incomplete: w3.incomplete_move_on === true, silence_repeat: w3.silence_repeat === true,
    end_section: w3.end_section === true, auto_end_section: w3.r20_auto_end_section === true,
    oral_in_a_row: typeof w3.r13_oral_rule === 'number' ? w3.r13_oral_rule : null,
    silence_in_a_row: [1, 2, 3].includes(w3.r20_silence_stop) ? w3.r20_silence_stop : null,
  });
  r.start();
  for (let guard = 0; guard < 2000 && r.view().phase !== 'battery_end'; guard += 1) {
    const v = r.view();
    const task = v.task;
    if (v.phase === 'instruction') { r.instructionPlayed(); r.instructionDone(); continue; }
    if (v.phase === 'practice') { r.practiceAnswer(v.practice.target_index != null ? v.practice.target_index : v.practice.target); continue; }
    if (v.phase === 'ready') { r.begin(); continue; }
    if (v.phase === 'running') {
      if (task.mode === 'record') {
        r.log('record_start', { task_id: task.id });
        if (v.cell != null) { r.voice(); r.nextCell('tap'); } else { r.voice(); r.done(); }
        continue;
      }
      if (task.mode === 'oral') { r.promptDone(); r.answer('spoken'); continue; }
      r.answer(v.item.target_index != null ? v.item.target_index : v.item.target);
      continue;
    }
    if (v.phase === 'last_word') { r.lastWord(0); continue; }
    if (v.phase === 'task_end') { r.next(); continue; }
    if (v.phase === 'silence_reminder') { r.silenceRepeatDone(); continue; }
    if (v.phase === 'mic_check') { r.micChecked(true, 0.5); continue; }
    throw new Error(`golden run stuck in ${v.phase}`);
  }
  return { events: sha(events), results: sha(r.results()), n_events: events.length, n_results: r.results().length };
}

function digests() {
  const st = states();
  const batteries = {};
  for (const name of FORMS) {
    const b = read(name);
    batteries[name] = Object.fromEntries(Object.entries(st).map(([k, on]) => [k, sha(JSON.stringify(applySwitches(b, on)))]));
  }
  const runs = {
    'sa.coach.G3.A.ur.json:rdf_auto': run(read('sa.coach.G3.A.ur.json'), 'rdf_auto'),
    'sa.coach.G3.A.en.json:rdf_auto': run(read('sa.coach.G3.A.en.json'), 'rdf_auto'),
  };
  return { batteries, runs };
}

describe('round 28: with every sa_r28_* switch OFF, the served batteries and a run are byte-identical to before', () => {
  const got = digests();
  if (process.env.SA_R28_RECORD_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), ...got }, null, 1)}\n`);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

  for (const name of FORMS) {
    for (const state of ['all_off', 'earlier_on']) {
      test(`${name} served with ${state}: unchanged`, () => {
        expect(got.batteries[name][state]).toBe(golden.batteries[name][state]);
      });
    }
  }
  for (const key of Object.keys(golden.runs)) {
    test(`${key}: the scripted run's events and results are unchanged`, () => {
      expect(got.runs[key]).toEqual(golden.runs[key]);
    });
  }
  test('the scripted runs exercised every task (no run ended early)', () => {
    for (const key of Object.keys(got.runs)) expect(got.runs[key].n_results).toBeGreaterThanOrEqual(17);
  });
});
