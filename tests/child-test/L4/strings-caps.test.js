/**
 * Child-test coach copy: every childTest* catalog key exists in Urdu and English, fits the WhatsApp
 * field it is sent in (CODE POINTS, as Meta counts), and the Urdu addresses coaches and children
 * without gendered verbs about the person.
 */
const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');

const cp = (s) => [...s].length;
const keys = Object.keys(UX_STRINGS).filter((k) => k.startsWith('childTest'));

// Which field each key lands in (anything not named here is a message body, cap 1024).
const FIELD = {
  childTestOfferYes: 20, childTestOfferLater: 20, childTestPresent: 20, childTestAbsent: 20, childTestRefused: 20,
  childTestStopChild: 20, childTestMenu: 20, childTestNoPhoto: 20, childTestCardsButton: 20,
  childTestListButton: 20, childTestPickSchoolButton: 20, childTestSendToTeacher: 20,
  childTestSectionChildren: 24, childTestSectionAlternates: 24, childTestPickSchoolSection: 24,
  childTestAlternateRow: 72, childTestRoleNew: 30, childTestRoleReturning: 30, childTestStatusTested: 20,
  childTestStatusInProgress: 20, childTestStatusAbsent: 20, childTestStatusRefused: 20, childTestStatusCheckWaiting: 20,
  // header 60 with a 2-digit grade and a short section list
  childTestListHeader: 45,
  // the progress line also leads a 1024 body, but is kept short enough to read at a glance
  childTestProgress: 45, childTestProgressChild: 30,
};
const capOf = (k) => FIELD[k] || 1024;

test('there are child-test strings to check', () => {
  expect(keys.length).toBeGreaterThan(60);
});

test.each(keys)('%s has Urdu and English', (k) => {
  expect(typeof UX_STRINGS[k].en).toBe('string');
  expect(typeof UX_STRINGS[k].ur).toBe('string');
  expect(UX_STRINGS[k].ur).toMatch(/[؀-ۿ]/);
});

test.each(keys)('%s fits its WhatsApp field in both languages', (k) => {
  for (const lang of ['en', 'ur']) expect(cp(UX_STRINGS[k][lang])).toBeLessThanOrEqual(capOf(k));
});

test('Urdu child-test copy uses Urdu digits, not ASCII or Arabic-Indic ones', () => {
  for (const k of keys) {
    const ur = UX_STRINGS[k].ur.replace(/\{\w+\}/g, '').replace(/⁦[^⁩]*⁩/g, '');
    expect([k, /[0-9٠-٩]/.test(ur)]).toEqual([k, false]);
  }
});

test('Urdu child-test copy has no gendered address to the coach (رہی/رہے ہیں, آپ کی/کا + verb forms)', () => {
  for (const k of keys) {
    expect([k, /(رہی|رہے) (ہیں|ہو)|کر رہی|سکتی ہیں|سکتے ہیں/.test(UX_STRINGS[k].ur)]).toEqual([k, false]);
  }
});
