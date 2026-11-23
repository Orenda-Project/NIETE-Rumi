'use strict';
/**
 * The message every class group reads after a forward is a child surface, so its Urdu says «کوئز» (one noun on child
 * surfaces) and carries no Latin word in Urdu prose: «کوئز کا وقت!», «کوئز بھیجا ہے», «یہاں دبائیں». The link is the one
 * Latin atom it keeps. English is unchanged. Real builder (studentMessage → resolveUx), no mocks beyond the network
 * boundary.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => ({})); // a chemistry renderer the generator loads; never reached by this builder

const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');

const LINK = 'https://x.test/q/AB12CD';
const ur = (web) => Gen.studentMessage({ teacherName: 'ثنا', topic: 'پودے', date: '۲۱ نومبر', link: LINK, language: 'ur', web });
const en = (web) => Gen.studentMessage({ teacherName: 'Sana', topic: 'Plants', date: '21 Nov', link: LINK, language: 'en', web });

describe('the forwarded class message in Urdu', () => {
  test.each([[false], [true]])('web %s: no Latin letter outside the link', (web) => {
    const msg = ur(web);
    expect(msg).toContain(LINK);
    expect(msg.split(LINK).join('')).not.toMatch(/[A-Za-z]/);
  });

  test.each([[false], [true]])('web %s: «کوئز کا وقت!», «کوئز بھیجا ہے», «یہاں دبائیں»', (web) => {
    const msg = ur(web);
    expect(msg).toContain('*کوئز کا وقت!*');
    expect(msg).toContain('کوئز بھیجا ہے');
    expect(msg).toContain('یہاں دبائیں');
  });

  test.each([[false], [true]])('web %s: English is unchanged', (web) => {
    const msg = en(web);
    expect(msg).toContain('📚 *Quiz time!*');
    expect(msg).toContain('has sent you a quiz on *Plants*');
    expect(msg).toContain(`Tap here to start:\n${LINK}`);
    expect(msg).toMatch(web ? /You will be asked your name first\.$/ : /You will be asked your name and class first\.$/);
  });
});
