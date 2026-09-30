/**
 * Urdu voice notes read decimals as "point" (red first).
 *
 * The Urdu number clean-up spelled every run of digits on its own, so the two
 * halves of a decimal became two numbers with the dot left between them:
 * "31.3 فیصد" went to the voice as "thirty-one.three فیصد" and was heard as
 * "thirty-one three" — the decimal was lost. Coaching voice notes quote scores
 * like this often (58 of 255 recent Urdu scripts carried one). A decimal is now
 * spoken as "<whole number> point <each digit>".
 */

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-dummy';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-dummy';

jest.mock('axios');
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const axios = require('axios');
const { normalizeForUrduTTS } = require('../../bot/shared/services/urdu-tts-normalizer');

describe('normalizeForUrduTTS — decimals', () => {
  it.each([
    ['آپ کا اسکور 31.3 فیصد رہا۔', 'آپ کا اسکور thirty-one point three فیصد رہا۔'],
    ['71.4%', 'seventy-one point four%'],
    ['81.8', 'eighty-one point eight'],
    ['2.05 منٹ', 'two point zero five منٹ'],
    ['0.5', 'zero point five'],
    ['12.25 اور 3.5', 'twelve point two five اور three point five'],
  ])('%s', (input, expected) => {
    expect(normalizeForUrduTTS(input)).toBe(expected);
  });

  it('never leaves a dot between two number words', () => {
    expect(normalizeForUrduTTS('31.3 فیصد')).not.toMatch(/[a-z]\.[a-z]/);
  });

  it('a sentence-ending full stop after a number is not a decimal', () => {
    expect(normalizeForUrduTTS('Grade 3. Next')).toBe('Grade three. Next');
  });

  it('integers are unchanged: 0-99 spelled, larger numbers kept as digits', () => {
    expect(normalizeForUrduTTS('Grade 3')).toBe('Grade three');
    expect(normalizeForUrduTTS('43 اور 8')).toBe('forty-three اور eight');
    expect(normalizeForUrduTTS('year 2026')).toBe('year 2026');
  });
});

describe('the Urdu ElevenLabs request carries the spoken decimal', () => {
  beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32, 1)]) });
  });

  it('generateSpeechForLanguage(ur) posts "point", not a split decimal', async () => {
    const ElevenLabsService = require('../../bot/shared/services/elevenlabs.service');
    await ElevenLabsService.generateSpeechForLanguage('آپ کا اسکور 31.3 فیصد رہا۔', 'ur');

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('api.elevenlabs.io/v1/text-to-speech/');
    expect(body.text).toContain('thirty-one point three فیصد');
    expect(body.text).not.toContain('thirty-one.three');
  });
});
