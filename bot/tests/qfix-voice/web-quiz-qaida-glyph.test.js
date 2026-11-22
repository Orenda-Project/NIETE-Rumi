/**
 * A Qaida letter card reaches the page marked Arabic (web-quiz.service.js questionPayload → web-quiz-figure.js).
 *
 * A Noorani Qaida teaches Arabic letters in Naskh, and the page now draws a letter card marked lang 'ar' in a Naskh
 * face. Bug (Nov 2026): the serve path rebuilt every stored glyph picture as {kind, glyph, text, name, alt, dir} and
 * dropped every other key, so a `lang: 'ar'` written into the stored item never reached the page. The test serves a
 * stored row through the real questionPayload; only the database, cache and log boundaries are fakes.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const WQ = require('../../shared/services/quiz/web-quiz.service');

// A grade 1 Islamiyat item as K5 stores it: an Urdu stem, the letters themselves as the options (fictional row).
function qaidaRow(pics) {
  const letters = ['د', 'ث', 'ذ'];
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    question_text: 'قاعدے کی ترتیب میں خ کے بعد کون سا حرف آتا ہے؟',
    option_a: letters[0], option_b: letters[1], option_c: letters[2], option_d: null,
    correct_option: 'A',
    media: {
      language: 'ur',
      web: {
        v: 2, type: 'picture', key: 'A', stem: 'قاعدے کی ترتیب میں خ کے بعد کون سا حرف آتا ہے؟',
        options: letters.map((t, i) => ({ slot: 'ABC'[i], text: t, pic: pics(t) })),
      },
    },
  };
}
const served = (pics) => WQ.questionPayload(qaidaRow(pics), 0, '', {}, null).options;

describe('a stored Qaida letter card keeps its Arabic mark on the way to the page', () => {
  test('a glyph stored with lang "ar" is served with lang "ar" (and right-to-left)', () => {
    const opts = served((t) => ({ kind: 'glyph', text: t, lang: 'ar' }));
    expect(opts.map((o) => o.pic)).toEqual(['د', 'ث', 'ذ'].map((t) => ({ kind: 'glyph', glyph: t, text: t, name: t, alt: t, dir: 'rtl', lang: 'ar' })));
  });

  test('a glyph stored without a mark (every card today) is served exactly as before, with no lang key', () => {
    const opts = served((t) => ({ kind: 'glyph', text: t }));
    opts.forEach((o) => expect(Object.keys(o.pic).sort()).toEqual(['alt', 'dir', 'glyph', 'kind', 'name', 'text']));
  });

  test('only "ar" passes: any other stored value is dropped, never forwarded to the page', () => {
    for (const lang of ['ur', 'AR ', '"><b>', 7]) {
      served((t) => ({ kind: 'glyph', text: t, lang })).forEach((o) => expect(o.pic).not.toHaveProperty('lang'));
    }
  });
});
