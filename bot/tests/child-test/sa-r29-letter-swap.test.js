'use strict';

/**
 * The content owner's 26 Nov 2026 review of the letter screens, as the committed runtime batteries serve them:
 *   ur.letter_pick10   test: ف -> ا and ٹ -> ت (ب م ک س ر ش گ چ kept); practice ل ن kept
 *   en.letter_pick10   test: l -> g, z -> w, r -> q, n -> x (d f b a p o kept); practice t -> b, m -> k
 *   ur.letter_names5   practice example ث -> ک, said by its name «کاف», under sa_r28_letter_pick: the file keeps today's
 *                      example ث as practice and carries ک as practice_r28 { r28: 'letter_pick', practice }, which the
 *                      battery route serves in its place while the switch is ON (dashboard/routes/sa-battery-switches.js)
 * Each picker row is an answer key: the target is one of its five cards, exactly once, and the clip Jugnu plays is the
 * one keyed on the words it says (sa/v5/<lang>/sha1(lang|text)[:12].mp3).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '../../shared/data/child-test/sa');
const COACH_FORMS = ['coach.G1.A', 'coach.G2.A', 'coach.G3.A', 'coach.G4.A', 'coach.G5.A'];
const runtime = (form, lang) => JSON.parse(fs.readFileSync(path.join(DATA, `sa.${form}.${lang}.json`), 'utf8'));
const task = (b, id) => b.tasks.find((t) => t.id === id);
const key = (dir, lang, text) => `sa/${dir}/${lang}/${crypto.createHash('sha1').update(`${lang}|${text}`).digest('hex').slice(0, 12)}.mp3`;

const PICK = {
  ur: {
    items: [['ب', 'بَ'], ['م', 'مَ'], ['ک', 'کَ'], ['س', 'سَ'], ['ر', 'رَ'], ['ش', 'شَ'], ['گ', 'گَ'], ['ا', 'اَ'], ['چ', 'چَ'], ['ت', 'تَ']],
    practice: [['ل', 'لَ'], ['ن', 'نَ']],
  },
  en: {
    items: [['g', 'ga'], ['w', 'wa'], ['q', 'kwa'], ['x', 'ks'], ['d', 'da'], ['f', 'fa'], ['b', 'ba'], ['a', 'a'], ['p', 'pa'], ['o', 'o']],
    practice: [['b', 'ba'], ['k', 'ka']],
  },
};

describe('letter screens after the content owner\'s 26 Nov review', () => {
  for (const form of COACH_FORMS) for (const page of ['ur', 'en']) {
    for (const lang of ['ur', 'en']) {
      test(`${form} ${page} page: ${lang}.letter_pick10 targets, practice and answer keys`, () => {
        const t = task(runtime(form, page), `${lang}.letter_pick10`);
        expect(t.items.map((it) => [it.target, it.prompt_text])).toEqual(PICK[lang].items);
        expect(t.practice.map((it) => [it.target, it.prompt_text])).toEqual(PICK[lang].practice);
        for (const it of [...t.items, ...t.practice]) {
          expect(it.show).toBe(it.target);
          expect(it.options.filter((o) => o === it.target)).toHaveLength(1);
          expect(it.prompt_audio).toBe(key('v5', lang, it.prompt_text));
        }
      });
    }

    test(`${form} ${page} page: ur.letter_names5 practice is the example ک, named «کاف», under the letter-pick switch`, () => {
      const t = task(runtime(form, page), 'ur.letter_names5');
      // today's example stays on the task (served while sa_r28_letter_pick is OFF)
      expect(t.practice.map((x) => [x.id, x.role, x.show, x.answer, x.model[1].audio])).toEqual([['ur.letter_names5.p1', 'example', 'ث', 'ثے', key('v1', 'ur', 'ثے')]]);
      expect(t.practice_r28.r28).toBe('letter_pick');
      expect(t.practice_r28.practice).toHaveLength(1);
      const [p] = t.practice_r28.practice;
      expect([p.id, p.role, p.show, p.target, p.answer]).toEqual(['ur.letter_names5.p1', 'example', 'ک', 'ک', 'کاف']);
      expect(p.model[0]).toEqual(t.practice[0].model[0]);
      expect(p.model[1]).toMatchObject({ text: 'کاف', audio: key('v1', 'ur', 'کاف') });
      expect(p.model[1].audio).toBe('sa/v1/ur/4283e5e14e7a.mp3');
      // the scored five are unchanged
      expect(t.items.map((it) => it.target)).toEqual(['د', 'ج', 'پ', 'ت', 'ا']);
    });
  }
});
