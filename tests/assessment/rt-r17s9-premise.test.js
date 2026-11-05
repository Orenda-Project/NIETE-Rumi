/**
 * Social Studies: the «خدا» premise term holds its izafat form («خدائے بزرگ و برتر»), as it holds «خدائی»,
 * and still never the name «خدا بخش».
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const Q5 = 'social_studies.C.Q5';
const mk = (text) => ({ unseen: { subjective: { 'Long Questions': [{ slot: Q5, question: 'انسانی برابری پر دو باتیں لکھیں۔', answer: text, scheme: { points: [{ kind: 'K', text, marks: 2 }] } }] } } });
const held = async (text) => (await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).map((d) => d.term);

test.each([
  'خدائے بزرگ و برتر نے سب انسانوں کو برابر پیدا کیا۔',
  'خدائے واحد کی نظر میں سب برابر ہیں۔',
  'خدائی حکم ہے کہ سب برابر ہیں۔',
])('«%s» is held', async (text) => {
  expect(await held(text)).toEqual(['خدا']);
});

test.each([
  'خدا بخش نے دکان کے آگے سے تجاوزات ہٹائیں۔',
  'خداداد نے پانی کا نلکا ٹھیک کروایا۔',
])('«%s» is not held', async (text) => {
  expect(await held(text)).toEqual([]);
});
