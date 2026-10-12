/**
 * bd-fmf24g.64 — the words of the four auth pages (login, forgot password, enter code, first-time setup), in English
 * and Urdu. Labels only (1-4 words, never a sentence): the operator-approved list from the v36_login-refresh design.
 *
 * The Urdu is MACHINE-DRAFTED (some from the bot's own Urdu: لاگ اِن, فون نمبر) and waits for a native check, like the
 * rest of the v2 Urdu; registering COPY_ENTRY below (teacher/copyRegistry.ts) is what puts it in that queue and under
 * the completeness checks (none empty, none still English).
 *
 * `langTo` is the language the pill switches TO, written in that language's own script (the ontology's "Language").
 * Server sentences are NOT copy: errors map from the HTTP status to a key here (auth/errors.ts).
 */
import { bilingual, type Bilingual, type Words } from '../teacher/i18n';
import type { CopyEntry } from '../teacher/copyRegistry';

export const AUTH_EN = {
  brand: 'NIETE',
  logoAlt: 'NIETE Portal',
  welcome: 'Welcome',
  login: 'Log in',
  loggingIn: 'Logging in',
  phone: 'Phone number',
  phoneHint: '03XX XXXXXXX',
  password: 'Password',
  forgot: 'Forgot password',
  privacy: 'Privacy policy',
  deleteAccount: 'Delete account',
  language: 'Language',
  langTo: 'اردو',
  back: 'Back',
  showPw: 'Show password',
  hidePw: 'Hide password',
  sendCode: 'Send code',
  sending: 'Sending',
  codeTitle: 'Enter code',
  sentOnWhatsapp: 'Sent on WhatsApp',
  code: 'Code',
  newPw: 'New password',
  confirmPw: 'Confirm password',
  resetPw: 'Reset password',
  resetting: 'Resetting',
  create: 'Create account',
  creating: 'Creating account',
  chars: '8+ characters',
  oneNum: '1 number',
  // errors and notices: 1-3 words, shown under the field that is wrong
  wrongPw: 'Wrong password',
  enterPw: 'Enter password',
  checkNum: 'Check the number',
  noAccount: 'No account found',
  noPw: 'No password yet',
  wrongCode: 'Wrong code',
  sixDigits: '6 digits needed',
  tooShort: 'Too short',
  differ: 'Passwords differ',
  tooMany: 'Too many tries',
  noConnection: 'No connection',
  couldntLogin: "Couldn't log in",
  couldntSend: "Couldn't send code",
  couldntReset: "Couldn't reset",
  couldntCreate: "Couldn't set up",
  linkExpired: 'Link expired',
  alreadySetUp: 'Already set up',
};

export const AUTH_UR: Words<typeof AUTH_EN> = {
  brand: 'NIETE',
  logoAlt: 'NIETE Portal',
  welcome: 'خوش آمدید',
  login: 'لاگ اِن',
  loggingIn: 'لاگ اِن جاری',
  phone: 'فون نمبر',
  phoneHint: '03XX XXXXXXX',
  password: 'پاس ورڈ',
  forgot: 'پاس ورڈ بھول گئے',
  privacy: 'پرائیویسی پالیسی',
  deleteAccount: 'اکاؤنٹ حذف کریں',
  language: 'زبان',
  langTo: 'English',
  back: 'واپس',
  showPw: 'پاس ورڈ دکھائیں',
  hidePw: 'پاس ورڈ چھپائیں',
  sendCode: 'کوڈ بھیجیں',
  sending: 'بھیج رہے ہیں',
  codeTitle: 'کوڈ درج کریں',
  sentOnWhatsapp: 'واٹس ایپ پر بھیجا گیا',
  code: 'کوڈ',
  newPw: 'نیا پاس ورڈ',
  confirmPw: 'پاس ورڈ دوبارہ',
  resetPw: 'پاس ورڈ ری سیٹ',
  resetting: 'ری سیٹ جاری',
  create: 'اکاؤنٹ بنائیں',
  creating: 'سیٹ اپ جاری',
  chars: '8 یا زیادہ حروف',
  oneNum: 'ایک نمبر',
  wrongPw: 'غلط پاس ورڈ',
  enterPw: 'پاس ورڈ لکھیں',
  checkNum: 'نمبر چیک کریں',
  noAccount: 'اکاؤنٹ نہیں ملا',
  noPw: 'ابھی پاس ورڈ نہیں',
  wrongCode: 'غلط کوڈ',
  sixDigits: '6 ہندسے درکار ہیں',
  tooShort: 'بہت چھوٹا',
  differ: 'پاس ورڈ مختلف ہیں',
  tooMany: 'بہت زیادہ کوششیں',
  noConnection: 'کنکشن نہیں ہے',
  couldntLogin: 'لاگ اِن نہیں ہوا',
  couldntSend: 'کوڈ نہیں بھیجا',
  couldntReset: 'ری سیٹ نہیں ہوا',
  couldntCreate: 'سیٹ اپ نہیں ہوا',
  linkExpired: 'لنک ختم ہو گیا',
  alreadySetUp: 'پہلے سے سیٹ اپ',
};

export const AUTH = bilingual(AUTH_EN, AUTH_UR);
export type AuthWords = typeof AUTH_EN;
export type AuthKey = keyof AuthWords;

export const COPY_ENTRY: CopyEntry = {
  screen: 'Login, forgot password, enter code and setup',
  module: AUTH as Bilingual<unknown>,
  // The brand, the mark's name and the number's shape read the same in both languages.
  same: ['brand', 'logoAlt', 'phoneHint'],
  // The ontology's own words for "it reached her WhatsApp" (واٹس ایپ پر بھیجا گیا is 5 words in Urdu), used word for word.
  longOk: ['sentOnWhatsapp'],
};
