'use strict';
/**
 * bd-gzfdu9 R7q (COS 20261026T050104 §2b; panel v12 on fresh-6): the quoted card sentence in the card frame.
 *   Z014  a card carrying a word in another script («сосед», Cyrillic) was quoted verbatim → fail closed: the plain frame
 *   Z049  the "…" gap dropped the clause naming the chapter's head move (Think-Pair-Share) for a later one naming its
 *         second (sentence frames), and the quote closed on «۔» before the frame's own «"۔» (a doubled full stop)
 *   Z178  the quote's closing «')» was cut and a «۔» put in its place
 *   and never a cut inside a clause: a sentence with no clause that fits takes the plain frame, never a word-boundary cut.
 * The three sentences are the panel's own (items/Z014, Z049, Z178 report_next_step.try_this_as_sent), with the shipped
 * catalogue's chapters they were sent with.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
const S = require('../../../bot/shared/services/coaching/video-reco/select');
const catalog = require('../../../bot/shared/services/coaching/video-reco/catalog');

const CARDS = {
  Z014: ['51-s1', "ہر چیک کے بعد 5–7 سیکنڈ انتظار کریں اور کم از کم ایک open-ended سوال پوچھیں: 'آپ نے یہ کیسے جانا؟'؛ پھر دو منٹ کے لیے сосед سے share کروائیں۔"],
  Z049: ['50-s2', "اگلی کلاس میں، جب 'They is riding' کا سوال پوچھیں تو 60–90 سیکنڈ Think-Pair-Share دیں، تین task cards (sentence frames, fill-the-blank، extension (یعنی تیز مکمل کرنے والوں کے لیے اضافی مشق) prompts) دیں اور ہر جواب کے بعد ایک مخصوص اگلا قدم بتائیں۔"],
  Z178: ['51-s1', "اگلی کلاس میں، جب ہر گروپ الفاظ مثال کے طور پر 'بادل' یا 'لکھنا' بتائے، تو 7-10 سیکنڈ wait time رکھیں؛ پھر ہر گروپ سے ایک مخصوص open-ended question پوچھیں (مثلاً: 'یہ لفظ اسم کیوں ہے؟ بتائیں') اور ایک ہم جماعت سے peer feedback مانگیں ('ایک مثال اور دیں')"],
};
const frame = (z, language = 'ur') => {
  const [segId, sentence] = CARDS[z];
  const hit = catalog.segment(segId);
  return { hit, out: S.cardFrame({ sentence, startS: hit.segment.start_s, endS: hit.segment.end_s, language, teacherName: 'T', module: hit.module, subject: 'english', segment: hit.segment, plainIfNamed: true }) };
};
const quoted = (reason) => { const m = /⁨([^⁩]*)⁩/.exec(String(reason || '')); return m ? m[1] : null; };

describe('Z014: another script in the card → the plain frame, never the quote', () => {
  test('ur reader: no Cyrillic, no quote; the plain frame naming the chapter', () => {
    const { hit, out } = frame('Z014');
    expect(out.reason_ur).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(quoted(out.reason_ur)).toBeNull();
    expect(out.reason_ur).toBe(S.plainFrame('ur', hit.segment));
  });
  test.each([['Devanagari', 'पड़ोसी'], ['Greek', 'γείτονα'], ['Han', '邻居']])('%s too', (_n, w) => {
    const [segId, sentence] = CARDS.Z014;
    const hit = catalog.segment(segId);
    const out = S.cardFrame({ sentence: sentence.replace('сосед', w), startS: hit.segment.start_s, endS: hit.segment.end_s, language: 'ur', teacherName: 'T', module: hit.module, subject: 'english', segment: hit.segment, plainIfNamed: true });
    expect(quoted(out.reason_ur)).toBeNull();
  });
  test('control: the same card in Urdu and Latin script only is still quoted', () => {
    const [segId, sentence] = CARDS.Z014;
    const hit = catalog.segment(segId);
    const out = S.cardFrame({ sentence: sentence.replace('сосед', 'ساتھی'), startS: hit.segment.start_s, endS: hit.segment.end_s, language: 'ur', teacherName: 'T', module: hit.module, subject: 'english', segment: hit.segment, plainIfNamed: true });
    expect(quoted(out.reason_ur)).toContain('ساتھی سے share کروائیں');
  });
});

describe('Z049: the gap never drops the clause naming the chapter\'s head move; one full stop', () => {
  test('the quote keeps Think-Pair-Share', () => {
    const q = quoted(frame('Z049').out.reason_ur);
    expect(q).toContain('Think-Pair-Share');
  });
  test('no full stop inside the quote before the frame\'s own «"۔»', () => {
    const r = frame('Z049').out.reason_ur;
    expect(r).not.toMatch(/[۔.]⁩"/);
  });
});

describe('Z178: the closing bracket and quote stay; the frame closes the sentence', () => {
  test('the quote ends «دیں\')», never «دیں۔»', () => {
    const r = frame('Z178').out.reason_ur;
    expect(quoted(r)).toMatch(/دیں'\)$/);
    expect(r).not.toMatch(/[۔.]⁩"/);
  });
  test('every bracket and single quote the quote opens, it closes', () => {
    for (const z of ['Z049', 'Z178']) {
      const q = quoted(frame(z).out.reason_ur) || '';
      expect(q.split('(').length).toBe(q.split(')').length);
    }
  });
});

describe('never a cut inside a clause', () => {
  test('one long clause that does not fit → the plain frame, not a word-boundary "…"', () => {
    const hit = catalog.segment('51-s1');
    const one = `ہر سوال کے بعد ${'بچوں سے کیوں اور کیسے والے سوال پوچھیں اور جواب کا انتظار کریں '.repeat(5)}`.trim();
    const out = S.cardFrame({ sentence: one, startS: hit.segment.start_s, endS: hit.segment.end_s, language: 'ur', teacherName: 'T', module: hit.module, subject: 'english', segment: hit.segment, plainIfNamed: true });
    expect(quoted(out.reason_ur)).toBeNull();
    expect(out.reason_ur).toBe(S.plainFrame('ur', hit.segment));
  });
  test('fitClauses: no clause fits → null (the caller\'s plain frame)', () => {
    expect(S.fitClauses(`${'word '.repeat(80)}end`, 60, catalog.segment('51-s1').segment)).toBeNull();
  });
});
