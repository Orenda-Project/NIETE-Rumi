'use strict';
/**
 * bd-rj6w0n.14.8 — Urdu GB plans (ties to bd-rj6w0n.5.8.9: Urdu plans carrying an English title).
 *
 *  1. An Urdu book's plan goes out with an Urdu title. A Latin title on an Urdu segment (the
 *     bd-rj6w0n.5.8.9 rows) is never shown: the chapter's Urdu title stands in, else no title line.
 *  2. RTL card check: an Urdu book's message is Urdu whatever language the tap carried (its first
 *     strong character is right-to-left), and an Urdu book's plan is authored and cached in Urdu only
 *     (GB's lane keys it on the book's language, bd-rj6w0n.14.16), never an English one.
 */
const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockDbResults = [];

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a), sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/lp.pdf'), buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => {
  const b = {};
  ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'upsert'].forEach((m) => { b[m] = () => b; });
  b.then = (res, rej) => Promise.resolve(mockDbResults.shift() || { data: null, error: null }).then(res, rej);
  b.single = b.maybeSingle = () => Promise.resolve(mockDbResults.shift() || { data: null, error: null });
  return { from: jest.fn(() => b), rpc: jest.fn(() => Promise.resolve({ data: null, error: null })) };
});

const Serving = require('../../bot/shared/services/lp612-serving.service');
const GbDelivery = require('../../bot/shared/services/lp612-gb-delivery.service');

const URDU_SEG = {
  segment_id: 'nbf_snc_grade_2_urdu.c02.s03', book_stem: 'nbf_snc_grade_2_urdu', grade: 2, subject: 'Urdu',
  language: 'ur', curriculum: 'nbf_snc', chapter_title: 'ہمارا گھر',
  subtopic_title: 'Our home: reading', menu_title: 'Our home: reading',
};
const KEY = 'gb-lp/gb_k5_v10.1/ur/nbf_snc_grade_2_urdu.c02.s03.pdf';
const STRONG = /[A-Za-z֐-ࣿיִ-﷿ﹰ-﻿]/;
const firstStrongIsRtl = (text) => { const m = String(text).match(STRONG); return !!m && !/[A-Za-z]/.test(m[0]); };
// What she reads: any text line plus the PDF's caption.
const sentText = () => [...mockSendMessage.mock.calls.map((c) => c[1]), ...mockSendDocumentByLink.mock.calls.map((c) => c[3])].join('\n');
const deliver = (segment, lang) => Serving.deliverRender({ phone: '923001234567', r2Key: KEY, segment, lang });

beforeEach(() => { jest.clearAllMocks(); mockDbResults.length = 0; });

describe('an Urdu GB plan carries an Urdu title', () => {
  test('a Latin topic on an Urdu segment is replaced by the chapter\'s Urdu title', async () => {
    await deliver(URDU_SEG, 'ur');
    expect(sentText()).toContain('ہمارا گھر');
    expect(sentText()).not.toContain('Our home');
  });

  test('an Urdu topic is kept as it is', async () => {
    await deliver({ ...URDU_SEG, subtopic_title: 'گھر کے کمرے', menu_title: 'گھر کے کمرے' }, 'ur');
    expect(sentText()).toContain('گھر کے کمرے');
  });

  test('no Urdu title anywhere: no title line, and still no Latin title', async () => {
    await deliver({ ...URDU_SEG, chapter_title: 'Our home' }, 'ur');
    expect(sentText()).not.toMatch(/Our home/);
    expect(firstStrongIsRtl(sentText())).toBe(true);
  });

  test('an English GB book keeps its English topic', async () => {
    await deliver({ ...URDU_SEG, subject: 'English', language: 'en', chapter_title: 'Ch 2' }, 'en');
    expect(sentText()).toContain('Our home: reading');
  });
});

describe('RTL card check', () => {
  test('an Urdu book\'s message is Urdu and RTL even when the tap carried English', async () => {
    await deliver(URDU_SEG, 'en');
    expect(firstStrongIsRtl(sentText())).toBe(true);
    expect(sentText()).not.toMatch(/Grade|Open your lesson plan/);
  });

  test.each(['en', 'ur'])('an Urdu book is authored and cached in Urdu only, whatever was asked (%s)', (asked) => {
    expect(GbDelivery.authorLanguage(URDU_SEG)).toBe('ur');
    expect(GbDelivery.cardLanguage(URDU_SEG, asked)).toBe('ur');
  });

  test('an English GB book is authored in English', () => {
    expect(GbDelivery.authorLanguage({ ...URDU_SEG, subject: 'English', language: 'en' })).toBe('en');
  });
});
