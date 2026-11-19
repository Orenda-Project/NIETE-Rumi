'use strict';
/**
 * lp-pdf-off: the one helper every in-flight lesson-plan PDF send asks before it sends (a Flow tap already made, a
 * worker's waiter, a typed curriculum topic). Her programme on lp_whatsapp_pdf_off → the app link goes instead of
 * the PDF; anything else → { off: false } and the caller sends exactly as today.
 */
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockLink = jest.fn();
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ sendLessonPlanLink: (...a) => mockLink(...a) }));

const Fake = require('../fixtures/lp-whatsapp-off-fake');
const { pdfOffLink } = require('../../bot/shared/services/lp-pdf-off');

const PHONE = '920000000000';

beforeEach(() => {
  Fake.reset();
  mockLink.mockReset().mockResolvedValue(true);
});

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s, %s teacher', (_label, value, _who, userId, off) => {
  test(off ? 'the app link goes, not the PDF' : 'today: not off, nothing sent here', async () => {
    Fake.setPdfOff(value);
    const out = await pdfOffLink({ userId, phone: PHONE, language: 'ur', reason: 'flow_tap' });
    if (off) {
      expect(out).toEqual({ off: true, linked: true });
      expect(mockLink).toHaveBeenCalledWith({ userId, from: PHONE, language: 'ur', reason: 'flow_tap' });
    } else {
      expect(out).toEqual({ off: false });
      expect(mockLink).not.toHaveBeenCalled();
    }
  });
});

describe('the link itself', () => {
  test('a link that could not go is still off: no PDF, linked false', async () => {
    Fake.setPdfOff(['ict']);
    mockLink.mockResolvedValue(false);
    expect(await pdfOffLink({ userId: Fake.ICT_TEACHER, phone: PHONE, language: 'en', reason: 'x' })).toEqual({ off: true, linked: false });
  });

  test('a link send that throws is still off, and does not throw', async () => {
    Fake.setPdfOff(['ict']);
    mockLink.mockRejectedValue(new Error('meta down'));
    expect(await pdfOffLink({ userId: Fake.ICT_TEACHER, phone: PHONE, language: 'en', reason: 'x' })).toEqual({ off: true, linked: false });
  });

  test('no phone: off is still answered, nothing is sent', async () => {
    Fake.setPdfOff(['ict']);
    expect(await pdfOffLink({ userId: Fake.ICT_TEACHER, phone: null, language: 'en', reason: 'x' })).toEqual({ off: true, linked: false });
    expect(mockLink).not.toHaveBeenCalled();
  });

  test('no user: today', async () => {
    Fake.setPdfOff(['ict', 'gb']);
    expect(await pdfOffLink({ userId: null, phone: PHONE })).toEqual({ off: false });
  });
});
