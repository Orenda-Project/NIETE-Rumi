'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1f; panel v8 §6): the quoted card keeps its imperative. «پوچھیں، جیسے» / «رکھیں، جیسے»
 * vanished (Z015 Z098 Z204 Z281) because childFreeCard read «پوچھیں،» with its comma as an unknown word, a name before
 * «جیسے», and dropped it with the comparison. A long card's cut kept the example and dropped the verb it serves (Z180), or
 * landed inside a bracket or quote (Z233 Z241 Z307).
 */
const CR = require('../../../bot/shared/services/coaching/video-reco/copy-rules');
const S = require('../../../bot/shared/services/coaching/video-reco/select');

const Z098 = "اگلی کلاس میں جب کوئی بچہ سوال پوچھے، فوراً جواب دینے کے بجائے ایک open-ended question واپس پوچھیں، جیسے 'آپ کے خیال میں یہ کیوں ہے؟'، اور جواب سے پہلے 5-7 سیکنڈ کا wait time دیں۔";
const Z015 = "اگلی کلاس میں جب ارکان سازی کی مشق کروائیں، تو تختے پر پہلے سے دو open-ended questions لکھ کر رکھیں، جیسے 'یہ لفظ اس طرح کیوں بنا؟'، اور جواب سے پہلے 5-7 سیکنڈ کا wait time دیں۔";

describe('childFreeCard keeps a verb before «جیسے»', () => {
  test.each([['Z098', Z098, 'پوچھیں، جیسے'], ['Z015', Z015, 'رکھیں، جیسے']])('%s', (_, card, kept) => {
    expect(CR.childFreeCard(card, { vocab: [] })).toBe(card);
    expect(CR.childFreeCard(card, { vocab: [] })).toContain(kept);
  });
  test('control: a lexicon name compared with «جیسے» is still dropped', () => {
    expect(CR.childFreeCard('اگلی کلاس میں عائشہ جیسے بچوں سے پہلے پوچھیں کہ یہ کیوں ہے۔', { vocab: [] })).not.toContain('عائشہ');
  });
});

describe('fitClauses: the example stays with its verb, no cut inside a bracket or quote', () => {
  const seg = { title_en: 'Yes/no question vs. a why question', summary_en: 'why question', moves: ['open_questions'], keywords: ['why', 'how'] };
  test('Z180 shape: «…پوچھیں: \'Why …?\'» is never cut to «… \'Why …?\'» without the verb', () => {
    const card = "اگلی کلاس میں، جب بورڈ پر 4/6 + 1/6 حل کروائیں، تو دو open-ended questions پوچھیں: 'Why does the denominator stay the same for like fractions?' اور 'How do you know the numerators add?' پھر ہر سوال کے بعد 20–30 سیکنڈ wait time دیں۔";
    const out = S.cardFrame({ sentence: card, startS: 0, endS: 52, language: 'ur', module: { module_id: 51, format: 'mixed' }, subject: 'maths', vocab: [], segment: seg });
    const q = out && out.reason_ur;
    expect(q).toBeTruthy();
    if (q.includes("'Why")) expect(q).toContain('پوچھیں');
  });
  test('Z233 shape: never inside the bracket', () => {
    const card = "اگلی کلاس میں، جب آپ 'Clean your room' کہیں، دو open-ended questions پوچھیں، 5 سیکنڈ wait time دیں، Think-Pair-Share کرائیں، ہر جوڑے کو 2-item peer-check card (intonation: rise/fall? yes/no; pronunciation: th/w? yes/no) دیں اور ایک exchange خود model کریں۔";
    const out = S.cardFrame({ sentence: card, startS: 0, endS: 55, language: 'ur', module: { module_id: 50, format: 'talking_head' }, subject: 'english', vocab: [], segment: { title_en: 'Think-pair-share', summary_en: 'think pair share', moves: ['think_pair_share'], keywords: [] } });
    const q = (out && out.reason_ur) || '';
    const inner = (q.match(/"⁨([\s\S]*)⁩"/) || [])[1] || '';
    expect(inner.split('(').length).toBe(inner.split(')').length);
    expect(inner.split("'").length % 2).toBe(1);
  });
});
