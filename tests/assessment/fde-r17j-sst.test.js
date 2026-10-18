/**
 * Social Studies, round 10:
 *   2. The premise words a model writes without an honorific («خدا», «پیغمبر», «فرمایا», «عجمی», «پروردگار»,
 *      «خالق», «اللہ پاک/کریم/رب») are held; bare «اللہ» and «نبی» stay, since they start names.
 * The papers are local model output; the people in their stories are the model's own.
 */

jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const Q5 = 'social_studies.C.Q5';

describe('2. the premise words written without an honorific', () => {
  const mk = (text) => ({ unseen: { subjective: { 'Long Questions': [{ slot: Q5, question: 'انسانی برابری پر دو باتیں لکھیں۔', answer: text, scheme: { points: [{ kind: 'K', text, marks: 2 }] } }] } } });
  const held = async (text) => (await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).map((d) => d.term);

  test.each([
    'خدا نے سب انسانوں کو برابر بنایا ہے۔',
    'پیغمبر نے سب کو برابر کہا۔',
    'آخری خطبے میں فرمایا گیا کہ سب برابر ہیں۔',
    'کسی عربی کو کسی عجمی پر کوئی فضیلت نہیں۔',
    'پروردگار کی نظر میں سب برابر ہیں۔',
    'سب انسانوں کا خالق ایک ہے۔',
    'اللہ پاک نے سب کو برابر پیدا کیا۔',
    'اللہ کریم سب کو دیکھتا ہے۔',
  ])('«%s» is held', async (text) => {
    expect(await held(text)).not.toEqual([]);
  });

  test.each([
    'عبداللہ ہارون نے سندھ کی آزادی کے لیے کام کیا۔',
    'اکرام اللہ نے اسکول میں صفائی کی مہم چلائی۔',
    'غلام نبی نے ووٹ ڈالا۔',
    'خداداد نے پانی کا نلکا ٹھیک کروایا۔',
    'خدا بخش نے دکان کے آگے سے تجاوزات ہٹائیں۔',
    'اللہ کے فضل سے فصل اچھی ہوئی اور کسان خوش ہوئے۔',
    'سب انسانوں کے بنیادی حقوق برابر ہیں۔',
  ])('«%s» is not held', async (text) => {
    expect(await held(text)).toEqual([]);
  });
});
