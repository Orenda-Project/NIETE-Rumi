'use strict';
/**
 * Round 6, bar C (DESIGN_R6 §4.1, RULING R6-11 item 3): coach_text_c, what the coach reads in RDF manual when the app
 * asks the questions (sa_app_asks). Every first-person line the app now performs names Jugnu; nothing points at an item
 * on the screen; nothing carries the practice or the ready line. The coach reads it (no clip).
 *   - every W3 task of every coach form carries coach_text_c in the page's language, ending on the hand-over line;
 *   - the committed battery files are what the builder makes.
 */
const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const bank = buildSaBank({ v3: read('item-bank.v3.json'), extra: read('item-bank.sa-extra.v1.json'), w3: read('item-bank.sa-w3.v1.json') });
const files = splitSaBankWithRuntime(bank);
const GIVE = { en: 'Then give the phone to the child.', ur: 'پھر فون بچے کو دے دیں۔' };
const BANNED = {
  en: [/\bI will\b/, /\bI am going to\b/, /When I say/, /^Say:/, /For example/, /\[/, /Ready\? Begin/, /Let's practice/],
  ur: [/اشارہ/, /مثال/, /پوچھے جائیں گے/, /بتایا جائے گا/, /کہا جائے/, /^کہیں:/, /جب میں کہوں/, /\[/, /تیار ہیں/],
};
const cases = [];
for (const g of [1, 2, 3, 4, 5]) for (const lang of ['en', 'ur']) cases.push([g, lang]);

describe('coach_text_c: the coach\'s words in RDF manual when Jugnu asks the questions', () => {
  test.each(cases)('Grade %i %s: every RDF manual task carries coach_text_c, Jugnu named, nothing stimulus-bound', (g, lang) => {
    const b = files[`sa/sa.coach.G${g}.A.${lang}.json`];
    expect(b.rdf_manual.length).toBe(17);
    for (const id of b.rdf_manual) {
      const t = b.tasks.find((x) => x.id === id);
      const c = t.coach_text_c;
      expect(c && typeof c.text).toBe('string');
      expect(c.text.endsWith(GIVE[lang])).toBe(true);
      expect(c.audio).toBeUndefined();
      for (const re of BANNED[lang]) expect([id, c.text]).not.toEqual([id, expect.stringMatching(re)]);
      if (lang === 'ur') expect(c.text).not.toMatch(/[A-Za-z]/);
    }
  });

  test('the rewordings name Jugnu where the app now speaks (story, questions, numbers, fluency)', () => {
    const t = (lang, id) => files[`sa/sa.coach.G3.A.${lang}.json`].tasks.find((x) => x.id === id).coach_text_c.text;
    expect(t('en', 'en.story_w3')).toMatch(/Jugnu will ask you some questions/);
    expect(t('en', 'en.story_w3')).toMatch(/When Jugnu says "Begin,"/);
    expect(t('en', 'en.story_comp_w3')).toMatch(/^Now Jugnu will ask you a few questions/);
    expect(t('en', 'ma.number_id8')).toMatch(/Jugnu will tell you when to begin and when to stop/);
    expect(t('en', 'ma.fluency1m')).toMatch(/Jugnu will tell you when to start and when to stop/);
    expect(t('en', 'ma.missing4')).toBe('Here are some more numbers. What number goes here? Then give the phone to the child.');
    expect(t('ur', 'ur.story_w3')).toMatch(/جگنو آپ سے چند سوال پوچھے گا/);
    expect(t('ur', 'ur.story_w3')).toMatch(/جب جگنو «شروع کریں» کہے تو/);
    expect(t('ur', 'ur.story_comp_w3')).toMatch(/^اب جگنو آپ سے اس کہانی کے بارے میں چند سوال پوچھے گا/);
    expect(t('ur', 'ma.number_id8')).toMatch(/جگنو بتائے گا کہ کب شروع کرنا ہے اور کب رکنا ہے/);
    expect(t('ur', 'ma.missing4')).not.toMatch(/\[/);
  });

  test('the panel-signed letter-sounds script is cut before its example, keeping the skip rule', () => {
    const en = files['sa/sa.coach.G3.A.en.json'].tasks.find((x) => x.id === 'en.letter_sounds5');
    expect(en.coach_text.text).toMatch(/For example/); // the coach-led script stays as signed
    expect(en.coach_text_c.text).toBe('Jugnu will show you letters of the English alphabet one at a time. Please tell me the SOUNDS of as many letters of the alphabet as you can. Not their names, but their sounds. If you come to a letter you do not know, go on to the next letter. Then give the phone to the child.');
    const ur = files['sa/sa.coach.G3.A.ur.json'].tasks.find((x) => x.id === 'ur.letter_sounds5');
    expect(ur.coach_text_c.text).toBe('آپ کو ایک ایک کر کے کچھ حروف دکھائے جائیں گے۔ ہر حرف کی آواز بتائیں۔ اس کا نام نہیں، اس کی آواز۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔ پھر فون بچے کو دے دیں۔');
  });

  test('coach_text is unchanged (coach-led without the switch reads what it read before)', () => {
    const t = files['sa/sa.coach.G3.A.en.json'].tasks.find((x) => x.id === 'en.story_w3');
    expect(t.coach_text.text).toMatch(/When I say "Begin,"/);
  });

  test('the committed battery files are what the builder makes', () => {
    for (const [rel, obj] of Object.entries(files)) {
      expect([rel, fs.readFileSync(path.join(DATA, rel), 'utf8')]).toEqual([rel, `${JSON.stringify(obj)}\n`]);
    }
  });
});
