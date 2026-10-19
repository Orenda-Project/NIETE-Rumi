/**
 * bd-fmf24g.64 — the words of the four auth pages (login, forgot password, enter code, first-time setup), in English
 * and Urdu; and of the analytics accounts' own sign-in page (/portal/analytics/login), which reuses them. Labels only
 * (1-4 words, never a sentence): the operator-approved list from the v36_login-refresh design.
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
  // bd-gmuk5s — an analytics-only account's NAME in the same field: the link that opens a normal keyboard for it, the
  // field's label while it holds a name, and the link back to the phone keypad. The two links are one pair ("Use …"),
  // and neither says "Sign in": the page's verb is "Log in" (its button).
  byName: 'Use a name instead',
  accountName: 'Account name',
  byPhone: 'Use phone number',
  password: 'Password',
  // bd-x7aprz.3 — a code on WhatsApp is the sign-in; a password is the second choice. One pair of links ("Use …").
  usePassword: 'Use password instead',
  useCode: 'Use a code instead',
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
  enterName: 'Enter name',
  checkNum: 'Check the number',
  // bd-x7aprz.3 — never "No account found" / "No password yet": a number that is not registered gets the way to
  // register (the bot's form), and an account with no password gets the code.
  notRegistered: 'Not registered yet',
  registerOnWa: 'Register on WhatsApp',
  byCode: 'Log in by code',
  getNewLink: 'Get a new link',
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
  // A short-lived notice for people a server change signed out (auth/SignedOutBanner, which ends it by date). A
  // sentence on purpose: the operator approved these exact words.
  signedOut: 'Signed out? Log in with a code on WhatsApp — no password needed.',
  // The analytics accounts' own sign-in page (/portal/analytics/login): its title is the name of the page it opens
  // (analytics/copy.ts frame.page), and one line under it says how to sign in. The verb is the page's "Log in".
  analyticsTitle: 'Schools analytics',
  analyticsSub: 'Log in with your account name',
};

export const AUTH_UR: Words<typeof AUTH_EN> = {
  brand: 'NIETE',
  logoAlt: 'NIETE Portal',
  welcome: 'خوش آمدید',
  login: 'لاگ اِن',
  loggingIn: 'لاگ اِن جاری',
  phone: 'فون نمبر',
  phoneHint: '03XX XXXXXXX',
  byName: 'نام استعمال کریں',
  accountName: 'اکاؤنٹ کا نام',
  byPhone: 'فون نمبر استعمال کریں',
  password: 'پاس ورڈ',
  usePassword: 'پاس ورڈ استعمال کریں',
  useCode: 'کوڈ استعمال کریں',
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
  enterName: 'نام لکھیں',
  checkNum: 'نمبر چیک کریں',
  notRegistered: 'ابھی رجسٹر نہیں',
  registerOnWa: 'واٹس ایپ پر رجسٹر کریں',
  byCode: 'کوڈ سے لاگ اِن',
  getNewLink: 'نیا لنک لیں',
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
  // The verb agrees with «لاگ ان», never with the reader: no gendered second-person form.
  signedOut: 'لاگ ان ختم ہو گیا؟ واٹس ایپ پر کوڈ سے لاگ ان کریں، پاس ورڈ کی ضرورت نہیں۔',
  // «تجزیہ» is the ontology's Urdu for Analytics; the line under it reuses «اکاؤنٹ کا نام» and the button's «لاگ اِن».
  analyticsTitle: 'اسکولوں کا تجزیہ',
  analyticsSub: 'اپنے اکاؤنٹ کے نام سے لاگ اِن کریں',
};

export const AUTH = bilingual(AUTH_EN, AUTH_UR);
export type AuthWords = typeof AUTH_EN;
export type AuthKey = keyof AuthWords;

export const COPY_ENTRY: CopyEntry = {
  screen: 'Login, forgot password, enter code, setup and the analytics sign-in',
  module: AUTH as Bilingual<unknown>,
  // The brand, the mark's name and the number's shape read the same in both languages.
  same: ['brand', 'logoAlt', 'phoneHint'],
  // The ontology's own words for "it reached her WhatsApp" (واٹس ایپ پر بھیجا گیا is 5 words in Urdu), used word for word.
  // "Register on WhatsApp" is the same phrase shape in Urdu (واٹس ایپ پر رجسٹر کریں, 5 words): bd-x7aprz.3.
  // The signed-out notice is the one approved sentence on these pages, and it ends by date (auth/SignedOutBanner).
  // The analytics sign-in's subtitle is the one line the operator asked for under its title (6 words; 7 in Urdu).
  longOk: ['sentOnWhatsapp', 'registerOnWa', 'signedOut', 'analyticsSub'],
};
