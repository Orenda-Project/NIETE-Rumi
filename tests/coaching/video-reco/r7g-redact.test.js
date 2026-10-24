'use strict';
/**
 * bd-8hhqhf R7g (red7 20261024T013349, COS 003908): a child's name that is also a dictionary word, coordinated with or listed
 * beside a name the redactor already masked, survived the excerpt (strict), the stored quote and reasons (non-strict) and
 * the roster check. Synthetic names only (red7 bin/attack_redactor.js shapes S3, S5).
 */
const { redactNames } = require('../../../bot/shared/services/coaching/video-reco/redact-names');

const PH = { child: '[a student]' };
const strict = (t, ctx = {}) => redactNames(t, { placeholders: PH, ...ctx });
const loose = (t, ctx = {}) => redactNames(t, { placeholders: PH, strict: false, ...ctx });

describe('the position rule: a word coordinated with, or listed beside, a masked name is a name', () => {
  test.each([
    ['S3 «X اور ‹p›» (a dictionary-word name first)', 'نور اور عائشہ نے جواب دیا، باقی خاموش رہے۔', 'نور'],
    ['S5 «‹p›، ‹p› اور X» (a vocabulary word listed after masked names)', 'عائشہ، بلال اور کرن نے کام ختم کر لیا، شاباش۔', 'کرن'],
    ['S5 on text the model already masked', '[a student]، [a student] اور کرن نے کام ختم کر لیا۔', 'کرن'],
    ['a comma list «‹p›، X، ‹p›»', 'عائشہ، کرن، بلال آپ تینوں آئیں۔', 'کرن'],
  ])('%s → masked, strict and non-strict', (_, text, name) => {
    expect(strict(text)).not.toContain(name);
    expect(loose(text)).not.toContain(name);
  });

  test.each([
    ['a function word after «اور»', 'عائشہ اور میں نے مل کر پڑھا۔'],
    ['«سب» after «اور»', 'بلال اور سب بچے کھڑے ہو جائیں۔'],
    ['no masked neighbour', 'پانی اور ہوا دونوں ضروری ہیں۔'],
  ])('control: %s → unchanged by the rule', (_, text) => {
    const words = text.match(/[؀-ۿ]+/g).filter((w) => !['عائشہ', 'بلال'].includes(w));
    const out = loose(text);
    for (const w of words) expect(out).toContain(w);
  });

  test('the lesson-count guard: a word the lesson says more than 3 times is lesson content, kept', () => {
    const counts = new Map([['کرن', 6]]);
    expect(loose('عائشہ اور کرن', { counts })).toContain('کرن');
    expect(loose('عائشہ اور کرن', { counts: new Map([['کرن', 2]]) })).not.toContain('کرن');
  });

  test('the lesson\'s own subject terms are never taken by the rule', () => {
    expect(loose('عائشہ اور مقناطیس', { vocab: ['مقناطیس'] })).toContain('مقناطیس');
  });

  test('the trace names the rule', () => {
    const trace = [];
    loose('نور اور عائشہ نے جواب دیا', { trace });
    expect(trace).toEqual(expect.arrayContaining([expect.objectContaining({ word: 'نور', why: 'coord' })]));
  });
});

describe('the roster check on the quote and both reasons reads the raw roster (S5 with the child on the class list)', () => {
  const S = () => require('../../../bot/shared/services/coaching/video-reco/select');
  test('rosterRaw keeps a vocabulary word that is on the roster; rosterSet (the card check) still drops it', () => {
    expect(S().rosterIn('اور کرن نے کام ختم کیا', S().rosterRaw(['کرن']))).toBe(true);
    expect(S().rosterIn('اور کرن نے کام ختم کیا', S().rosterSet(['کرن']))).toBe(false);
  });
  test('validate refuses a quote with a raw-roster name', () => {
    const C = require('../../../bot/shared/services/coaching/video-reco/catalog');
    const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
    const segId = cat.modules[0].segments[0].seg_id;
    const ex = ['[00:30] Teacher: سب نے کام کیا، کرن نے بھی کام ختم کر لیا؟', '[00:33] Student: جی'];
    const p = { seg_id: segId, moment: { at: '00:30', quote: 'کرن نے بھی کام ختم کر لیا' }, reason_en: 'The class only answered yes. The clip explains why.', reason_ur: 'کلاس نے صرف جی کہا؛ یہ کلپ کیوں کے سوال سمجھاتا ہے۔', confidence: 0.7 };
    const v = S().validate(p, { candidates: [{ seg_id: segId }] }, ex, { catalog: cat, rosterRaw: S().rosterRaw(['کرن']) });
    expect(v.none).toBe('validation:name');
  });
});
