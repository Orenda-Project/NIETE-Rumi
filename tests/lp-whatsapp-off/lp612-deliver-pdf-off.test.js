'use strict';
/**
 * Grades 6-12 and GB K-5 plans (lp612-serving deliverRender — the cache hit, the author worker's waiters, the
 * re-delivery job and the GB lane all send through it): with HER programme on lp_whatsapp_pdf_off the PDF and its
 * summary line are not sent — the app link goes instead, with no survey. The programme is the teacher's, never the
 * book's: a GB teacher on an ICT 6-12 book follows "gb", an ICT teacher on a GB K-5 book follows "ict".
 */
const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockSchedule = jest.fn();
const mockLink = jest.fn();

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
  b.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
  b.single = b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return { from: jest.fn(() => b), rpc: jest.fn(() => Promise.resolve({ data: null, error: null })) };
});
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: (...a) => mockSchedule(...a) }));
jest.mock('../../bot/shared/services/lp612-deliveries.store', () => ({ record: jest.fn() }));
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ sendLessonPlanLink: (...a) => mockLink(...a) }));

const Fake = require('../fixtures/lp-whatsapp-off-fake');
const Serving = require('../../bot/shared/services/lp612-serving.service');

const PHONE = '920000000002';
const ICT_SEG = {
  segment_id: 'grade_9_biology.c01.p1-3', book_stem: 'grade_9_biology', grade: 9, subject: 'Biology',
  language: 'en', chapter_title: 'Cells', subtopic_title: 'Cell parts', menu_title: 'Cell parts',
};
const GB_K5_SEG = {
  segment_id: 'nbf_snc_grade_2_urdu.c02.s03', book_stem: 'nbf_snc_grade_2_urdu', grade: 2, subject: 'Urdu',
  language: 'ur', curriculum: 'nbf_snc', chapter_title: 'ہمارا گھر', subtopic_title: 'گھر', menu_title: 'گھر',
};
const deliver = (userId, segment = ICT_SEG, lang = 'en') => Serving.deliverRender({
  phone: PHONE, userId, r2Key: `lp612/v1/${lang}/${segment.segment_id}.pdf`, segment, lang, renderId: 'r-1',
});

beforeEach(() => {
  jest.clearAllMocks();
  Fake.reset();
  mockLink.mockReset().mockResolvedValue(true);
});

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
  test(off ? 'no PDF, no summary, no survey: the app link' : 'today: the PDF and its survey', async () => {
    Fake.setPdfOff(value);
    const out = await deliver(userId);
    if (off) {
      expect(mockSendDocumentByLink).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockSchedule).not.toHaveBeenCalled();
      expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({ userId, from: PHONE, language: 'en' }));
      expect(out).toEqual({ appLink: true });
    } else {
      expect(mockLink).not.toHaveBeenCalled();
      expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledTimes(1);
    }
  });
});

describe('her programme, not the book', () => {
  test('["gb"]: a GB teacher on an ICT 6-12 book gets the link', async () => {
    Fake.setPdfOff(['gb']);
    await deliver(Fake.GB_TEACHER, ICT_SEG);
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  test('["gb"]: an ICT teacher on a GB K-5 book still gets the PDF', async () => {
    Fake.setPdfOff(['gb']);
    await deliver(Fake.ICT_TEACHER, GB_K5_SEG, 'ur');
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  });
});

test('no userId (an old waiter row): the switch is not asked, the PDF goes as today', async () => {
  Fake.setPdfOff(['ict', 'gb']);
  await Serving.deliverRender({ phone: PHONE, r2Key: 'lp612/v1/en/x.pdf', segment: ICT_SEG, lang: 'en' });
  expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
  expect(mockLink).not.toHaveBeenCalled();
});

test('off and the link could not go: still no PDF, and no throw (the caller does not count it as a failed send)', async () => {
  Fake.setPdfOff(['ict']);
  mockLink.mockResolvedValue(false);
  await expect(deliver(Fake.ICT_TEACHER)).resolves.toEqual({ appLink: false });
  expect(mockSendDocumentByLink).not.toHaveBeenCalled();
});
