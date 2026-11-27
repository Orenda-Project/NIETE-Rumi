'use strict';
/**
 * The Urdu letter-names practice example ک («کاف», the content owner's 26 Nov review; it was ث) rides the letter-sound
 * picker's switch, sa_r28_letter_pick, like the rest of that review. ON (staging and production run it ON): the example
 * is ک, modelled by its name «کاف». OFF: it stays ث, modelled by «ثے», exactly as before round 28, so a phone with every
 * sa_r28_* switch OFF receives the battery it received before (sa-r28-off-identity, against its saved golden). The
 * battery file carries the ک example as practice_r28 { r28, practice }; no served battery ever holds that key.
 */
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const PAGES = [1, 2, 3, 4, 5].flatMap((g) => ['ur', 'en'].map((page) => `sa.coach.G${g}.A.${page}.json`));
const read = (name) => JSON.parse(fs.readFileSync(path.join(BATTERIES, name), 'utf8'));
const names = Object.keys(SWITCHES);
// The sandbox of the day (every switch before round 28 ON), then with round 28's switches as named.
const earlier = Object.fromEntries(names.map((k) => [k, !/^r28/.test(k)]));
const with28 = (over) => ({ ...earlier, ...over });
const practiceOf = (served) => served.tasks.find((t) => t.id === 'ur.letter_names5').practice
  .map((p) => [p.id, p.role, p.show, p.target, p.answer, p.model[1].text, p.model[1].audio]);

const THE = ['ur.letter_names5.p1', 'example', 'ث', 'ث', 'ثے', 'ثے', 'sa/v1/ur/f250ca0b87fa.mp3'];
const KAF = ['ur.letter_names5.p1', 'example', 'ک', 'ک', 'کاف', 'کاف', 'sa/v1/ur/4283e5e14e7a.mp3'];

describe('the letter-names practice example follows sa_r28_letter_pick', () => {
  test.each(PAGES)('%s: OFF, the example is ث («ثے»)', (name) => {
    expect(practiceOf(applySwitches(read(name), earlier))).toEqual([THE]);
    expect(practiceOf(applySwitches(read(name), with28({ r28Mcq: true, r28Ceiling: true })))).toEqual([THE]);
  });

  test.each(PAGES)('%s: ON, the example is ک («کاف»)', (name) => {
    expect(practiceOf(applySwitches(read(name), with28({ r28LetterPick: true })))).toEqual([KAF]);
    expect(practiceOf(applySwitches(read(name), Object.fromEntries(names.map((k) => [k, true]))))).toEqual([KAF]);
  });

  test.each(PAGES)('%s: no served battery carries the switch\'s own copy (practice_r28)', (name) => {
    for (const on of [{}, earlier, with28({ r28LetterPick: true }), Object.fromEntries(names.map((k) => [k, true]))]) {
      expect(JSON.stringify(applySwitches(read(name), on))).not.toContain('practice_r28');
    }
  });
});
