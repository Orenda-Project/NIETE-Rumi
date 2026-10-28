'use strict';

/**
 * The content reviewers' wording of Jugnu's lines (data/child-test/sa-lines-reviewed.v1.json): the builder lays it over
 * every form, each changed text gets the clip key its words hash to (so the screen and the voice change together), an
 * unchanged language keeps its key, and the engine's own copies of the same words say the same thing.
 */

const fs = require('fs');
const path = require('path');
const { applyReviewed, loadReviewed, audioKey } = require('../../shared/services/child-test/sa/reviewed-lines');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const reviewed = loadReviewed();
const line = (en, ur) => ({ en, ur, audio: { en: audioKey('en', en), ur: audioKey('ur', ur) } });

describe('applyReviewed', () => {
  const bank = {
    lines: { welcome: line('Hello!', 'سلام!') },
    tasks: {
      'coach.G1.A/ur.words4': { script: { intro: line('Read each word.', 'ہر لفظ پڑھیں۔'), begin: line('Begin.', 'شروع کریں۔') },
        practice: [{ model: [line('This word is:', 'یہ لفظ ہے:'), { text: 'گھر', lang: 'ur', audio: 'sa/v1/ur/x.mp3' }] }] },
      'coach.G2.A/ur.words4': { script: { intro: line('Read each word.', 'ہر لفظ پڑھیں۔') } },
      'coach.G1.A/en.words4': { script: { intro: line('Read each word.', 'ہر لفظ پڑھیں۔'), begin: line('Begin.', 'شروع کریں۔') } },
      'coach.G1.A/ma.add2i': { practice: [{ model: [line('The answer is:', 'جواب ہے:'), line('17', '۱۷')] }] },
    },
  };
  const out = applyReviewed(bank, {
    lines: { welcome: { ur: 'السلام علیکم!' } },
    script: { begin: { en: 'Go!' } },
    tasks: { 'ur.words4': { intro: { en: 'Read it.' }, practice_frame: { ur: 'یہ ہے:' } }, 'ma.add2i': { practice_frame: { en: 'Answer:' } } },
  });

  test('a changed language gets its new text and the key its words hash to; the other language is untouched', () => {
    expect(out.lines.welcome.ur).toBe('السلام علیکم!');
    expect(out.lines.welcome.audio.ur).toBe(audioKey('ur', 'السلام علیکم!'));
    expect(out.lines.welcome.en).toBe('Hello!');
    expect(out.lines.welcome.audio.en).toBe(bank.lines.welcome.audio.en);
  });

  test('a task\'s line changes in that task in every form, and nowhere else', () => {
    for (const f of ['coach.G1.A', 'coach.G2.A']) {
      expect(out.tasks[`${f}/ur.words4`].script.intro.en).toBe('Read it.');
      expect(out.tasks[`${f}/ur.words4`].script.intro.audio.en).toBe(audioKey('en', 'Read it.'));
    }
    expect(out.tasks['coach.G1.A/en.words4'].script.intro.en).toBe('Read each word.');
  });

  test('a script line changes in every task that says it', () => {
    expect(out.tasks['coach.G1.A/ur.words4'].script.begin.en).toBe('Go!');
    expect(out.tasks['coach.G1.A/en.words4'].script.begin.en).toBe('Go!');
  });

  test('the practice frame changes; the answer after it does not (words, or a number)', () => {
    const m = out.tasks['coach.G1.A/ur.words4'].practice[0].model;
    expect(m[0].ur).toBe('یہ ہے:');
    expect(m[0].audio.ur).toBe(audioKey('ur', 'یہ ہے:'));
    expect(m[1]).toEqual(bank.tasks['coach.G1.A/ur.words4'].practice[0].model[1]);
    const n = out.tasks['coach.G1.A/ma.add2i'].practice[0].model;
    expect(n[0].en).toBe('Answer:');
    expect(n[1]).toEqual(line('17', '۱۷'));
  });

  test('pure: the bank passed in is unchanged; no reviewed file, the bank as it was', () => {
    expect(bank.lines.welcome.ur).toBe('سلام!');
    expect(applyReviewed(bank, null)).toBe(bank);
  });
});

describe('the committed bank carries the reviewed lines', () => {
  const built = buildSaBank({ v3: read('item-bank.v3.json'), extra: read('item-bank.sa-extra.v1.json'), w3: read('item-bank.sa-w3.v1.json') });
  const files = splitSaBankWithRuntime(built);

  test('there is a reviewed file with changes in it', () => {
    expect(reviewed).toBeTruthy();
    expect(Object.keys(reviewed.lines).length + Object.keys(reviewed.tasks).length).toBeGreaterThan(0);
  });

  test('the builder\'s output is what is committed (build-sa-bank.js --check)', () => {
    for (const [rel, obj] of Object.entries(files)) {
      expect(`${JSON.stringify(obj)}\n`).toBe(fs.readFileSync(path.join(DATA, rel), 'utf8'));
    }
  });

  test('each reviewed battery line is in the bank with its new key', () => {
    for (const [k, change] of Object.entries(reviewed.lines)) {
      for (const [lang, text] of Object.entries(change)) {
        expect(built.lines[k][lang]).toBe(text);
        expect(built.lines[k].audio[lang]).toBe(audioKey(lang, text));
      }
    }
  });

  test('each reviewed task line is on the served battery\'s screen, in every form, with its new key', () => {
    let seen = 0;
    for (const [task, slots] of Object.entries(reviewed.tasks)) {
      for (const [slot, change] of Object.entries(slots)) {
        for (const [lang, text] of Object.entries(change)) {
          const forms = Object.keys(files).filter((f) => /^sa\/sa\.coach\..+\.json$/.test(f) && f.endsWith(`.${lang}.json`));
          expect(forms.length).toBe(5);
          for (const f of forms) {
            const t = files[f].tasks.find((x) => x.id === task || x.task === task);
            expect(t).toBeTruthy();
            const said = JSON.stringify(t);
            expect(said).toContain(JSON.stringify(text));
            expect(said).toContain(audioKey(lang, text));
            seen += 1;
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test('the engine\'s own copy of a line (sa-ui.js COPY) says what the battery line says', () => {
    const { COPY } = require('../../../dashboard/sa/sa-ui');
    const mirrored = ['right', 'try_again', 'shown', 'mic_skip_say', 'warm_title', 'last_word', 'all_done', 'back_wait', 'mic_skip_task', 'give_coach'];
    for (const k of mirrored) for (const lang of ['en', 'ur']) expect([k, lang, COPY[lang][k]]).toEqual([k, lang, built.lines[k][lang]]);
  });
});
