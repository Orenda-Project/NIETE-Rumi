/**
 * Social Studies: the «رب» premise term holds the word in every form a model writes it, never the name «رب نواز».
 * Each text below names the premise in a form the whole-word term held before the narrowing.
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const Q5 = 'social_studies.C.Q5';
const mk = (text) => ({ unseen: { subjective: { 'Long Questions': [{ slot: Q5, question: 'انسانی برابری پر دو باتیں لکھیں۔', answer: text, scheme: { points: [{ kind: 'K', text, marks: 2 }] } }] } } });
const held = async (text) => (await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).map((d) => d.term);

describe('the premise through «رب», in forms a model writes', () => {
  test.each([
    'ہمارا رب سب کو دیکھتا ہے اس لیے سب برابر ہیں۔',
    'اللہ رب کریم نے سب انسانوں کو برابر پیدا کیا۔',
    'ربِ کائنات نے سب انسان برابر بنائے۔',
    'رب ذوالجلال نے سب انسانوں کو ایک جیسا بنایا۔',
    'سب انسان ایک ہی رب کے بندے ہیں۔',
    'رب تعالیٰ کے نزدیک سب برابر ہیں۔',
    'سب کا رب ایک ہے۔',
  ])('«%s» is held', async (text) => {
    expect(await held(text)).not.toEqual([]);
  });
});

describe('controls', () => {
  test.each([
    'رب نواز نے دکان کھولی اور ٹیکس نہیں دیا۔',
    'سردار عبدالرب نشتر تحریکِ پاکستان کے رہنما تھے۔',
    'سب انسانوں کے بنیادی حقوق برابر ہیں۔',
  ])('«%s» is not held', async (text) => {
    expect(await held(text)).toEqual([]);
  });
});
