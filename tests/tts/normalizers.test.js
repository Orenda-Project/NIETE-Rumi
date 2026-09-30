/**
 * The per-language text clean-up for the ElevenLabs and OpenAI voices is data, not
 * code (red first).
 *
 * Which language gets which clean-up is a table: a language with an entry is
 * cleaned by it, any other language is spoken as written. Adding a language's
 * clean-up is one row, not another `=== 'ur' ?` in each provider.
 */

const { normalizeFor, NORMALIZERS } = require('../../bot/shared/services/tts/text/normalizers');

describe('tts text normalizers', () => {
  it('Urdu gets the Urdu clean-up (numbers as words, decimals as "point", no Markdown)', () => {
    expect(normalizeFor('ur', '**اسکور** 31.3 فیصد')).toBe('اسکور thirty-one point three فیصد');
    expect(normalizeFor('ur-PK', 'جماعت 5')).toBe('جماعت five');
  });

  it('a language with no entry is spoken exactly as written', () => {
    expect(normalizeFor('en', 'Plan **3** activities.')).toBe('Plan **3** activities.');
    expect(normalizeFor('ps-PK', 'test 3')).toBe('test 3');
    expect(normalizeFor(undefined, 'x 1')).toBe('x 1');
  });

  it('the table is the one place a language gets a clean-up', () => {
    expect(Object.keys(NORMALIZERS)).toEqual(['ur']);
  });
});
