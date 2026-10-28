'use strict';
/**
 * Round 8, the content owner's items 28 and 31 (spoken side), in every coach form's built bank and served battery:
 * - 28: the story questions' instruction tells a stuck child to press the Next button («آگے») to go on;
 * - 31: the Urdu maths instructions say the English operation word (in Urdu script) beside the Urdu one.
 * Each changed line carries the clip key its words hash to, so the screen and the voice change together.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'shared', 'data', 'child-test');
const bank = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.sa.v1.json'), 'utf8'));
const key = (lang, text) => `sa/v1/${lang}/${crypto.createHash('sha1').update(`${lang}|${text}`).digest('hex').slice(0, 12)}.mp3`;
const coach = (task) => Object.entries(bank.tasks).filter(([k]) => /^coach\.G\d\.A\//.test(k) && k.endsWith(`/${task}`));

const STUCK_UR = 'اگر جواب نہ آئے تو «آگے» دبا کر اگلے سوال پر جائیں۔';
const STUCK_EN = 'If you get stuck, press Next to go on.';
const OPS = { 'ma.add2i': ['جمع', 'ایڈیشن'], 'ma.sub2i': ['تفریق', 'سبٹریکشن'], 'ma.mul2i': ['ضرب', 'ملٹی پلیکیشن'] };

test('item 28: the story questions intro says how to go on when stuck, in every coach form, both languages', () => {
  for (const task of ['ur.story_comp_w3', 'en.story_comp_w3']) {
    const forms = coach(task);
    expect(forms.length).toBe(5);
    for (const [, t] of forms) {
      const s = t.script.intro;
      expect(s.ur.endsWith(` ${STUCK_UR}`)).toBe(true);
      expect(s.en.endsWith(` ${STUCK_EN}`)).toBe(true);
      expect(s.audio).toEqual({ en: key('en', s.en), ur: key('ur', s.ur) });
    }
  }
});

test('item 31: the Urdu maths instructions say the English operation word (in Urdu script) beside the Urdu one', () => {
  for (const [task, [ur, en]] of Object.entries(OPS)) {
    const forms = coach(task);
    expect(forms.length).toBeGreaterThan(0);
    for (const [, t] of forms) {
      for (const line of ['intro', 'test_intro']) {
        const s = t.script[line];
        expect(s.ur).toContain(`${ur} یعنی ${en}`);
        expect(s.audio.ur).toBe(key('ur', s.ur));
      }
    }
  }
});

test('the served coach batteries carry the same lines', () => {
  for (const g of [1, 2, 3, 4, 5]) {
    for (const lang of ['ur', 'en']) {
      const text = fs.readFileSync(path.join(DATA, 'sa', `sa.coach.G${g}.A.${lang}.json`), 'utf8');
      expect(text.includes(lang === 'ur' ? STUCK_UR : STUCK_EN)).toBe(true);
    }
  }
});
