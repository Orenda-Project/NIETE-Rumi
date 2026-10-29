'use strict';
/**
 * first-reply-english-evidence — may a BRAND-NEW row's first message be answered in English?
 *
 * WHY
 *
 * A new row is stored 'ur' (the offer's first language), and resolve-response-language.js keeps
 * the stored language for any Latin-script message, because Latin script is NOT evidence of
 * English here: Roman Urdu is Latin-script Urdu ("class 4 ka lesson plan chahiye"). That rule is
 * right and stays. Its one cost is the person whose very first message is plainly English: the teacher is
 * answered in Urdu before they have had any chance to choose.
 *
 * THE RULE (positive evidence only; everything else is today's answer)
 *
 *   - the switch FIRST_REPLY_ENGLISH_EVIDENCE is exactly "true" (an env switch, like the other
 *     language-behaviour switch LANGUAGE_AUDIO_AUTOFLIP: no app_settings read on every message);
 *   - the row is brand new: it has never sent a message (first_message_at is still null on the
 *     row this turn read) and its language is not locked;
 *   - the message has no Perso-Arabic character, at least three ENGLISH words, every word is
 *     English (or a number, or a word spelled the same in both — see SHARED), and no word is
 *     Roman Urdu.
 *
 * It decides THIS turn's reply language only. It never writes preferred_language or
 * language_locked: the one writer is setUserLanguage(), and only the teacher's own choice calls it.
 *
 * DELIBERATELY PURE: no I/O, no logging. The caller logs.
 */

const { isOffered } = require('../config/languages');

const SWITCH = 'FIRST_REPLY_ENGLISH_EVIDENCE';
const MIN_ENGLISH_WORDS = 3;
const PERSO_ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

const words = (s) => new Set(s.trim().split(/\s+/));

/**
 * Roman-Urdu words: any one of these means the message is not English evidence. Postpositions
 * and particles (ka/ki/ke/ko/se/ne/par/pe/mein), pronouns (mujhe/mera/aap/ye/wo), the verbs a
 * request is made with (chahiye/karo/dein/bhej/bata), greetings and address (aoa/salam/ji/bhai),
 * and the textspeak these messages carry (plz/pls/k/g/kr). Common spelling variants are listed
 * because Roman Urdu has no fixed spelling.
 */
const ROMAN_URDU = words(`
  hai hain hy hn hay hei ho hon hoon hun hu hota hoti hote hona hoga hogi honge tha thi thay
  ka ki ke ko se ne mein main mai mien mn par pe pr tak liye lie liay lye wala wali wale walay
  mujhe mjhe muje mujhay mujh mujhko mera meri mere mery hamara hamari hamare hum ham
  aap ap apka apki apke apko tum tera teri tumhara ye yeh yah wo woh voh vo iska iski
  uska uski isko usko inko unko inhe unhe inka unka
  kya kia kyun kyon kyu kaise kese kesay kaisay kaisa kaisi kitna kitni kitne kab kahan kidhar
  kaun kon kis kisi kuch koi jo jab tab agar lekin magar phir bhi sirf aur bas ab abhi aaj kal
  chahiye chahye chaiye chahie chahiay chaheye chahiyay chahta chahti chahte chahiyen
  karo kar kr karna krna karni karen karein kren krein kijiye kijye karde krde kardo krdo kariye
  dein den de dena dijiye dijye dijiyega dedo dedein dy diya diye
  bhej bhejo bhejen bhejein bhejdo bhejain bhejna bhejiye bhijwa
  bata batao bataen batayen bataye bataiye btao btayen samjha samjhao samjhayen
  sakta sakti sakte skta skti rahi raha rahe rha rhi gaya gayi gaye
  aoa salam salaam slam assalam asalam aslam assalamualaikum asalamualaikum walaikum alaikum
  wassalam ji jee g bhai bhae baji baaji sahab sahib janab ustad ustaad
  nahi nahin nai nhi na haan han ha acha accha achha achi theek thik thk shukriya shukria
  jazakallah inshallah mashallah alhamdulillah
  bachon bachay bache bachey bacho bachon sabak sabaq kitab jamat jamaat kaam baat
  plz pls k kr
`);

/**
 * Words spelled identically in English and Roman Urdu with a different Urdu meaning (the = "were",
 * me = "in", to = "then", is = "this", us = "that", do = "give/two", in = "these", he = "is",
 * hi = emphatic, or = "and", so = "sleep", per = "on"), plus forms of address used in both. They are
 * ALLOWED in an English message (vetoing "send me a plan" would make the rule useless) but are
 * not COUNTED toward the three English words, so they cannot be the evidence.
 */
const SHARED = words(`the me to is in us do he hi or so per sir madam miss dear hello hey`);

/** Common English words a teacher's first message is made of. Inflections are handled by stem(). */
const ENGLISH = words(`
  a an i my mine we our ours you your yours they their them it its this that these those there here
  am are was were be been being have has had having will would shall should can could may might must
  not no yes ok okay please thanks thank kindly also just only very really too more most less much many
  some any all every each other another same new old good great nice best better well first last next
  and but if because when where what which who whom whose why how than then about above after again
  against along among around as at before behind below between by down during for from into like near
  of off on onto out over since through till under until up upon with within without
  want need needs like love help make create give send share show tell explain write prepare plan
  get find know learn teach use start begin try see look read listen speak talk ask answer check
  improve design suggest provide generate build download upload open change correct mark grade solve
  practice practise review revise understand assess evaluate support guide manage organise organize
  im ive id ill dont cant wont isnt arent doesnt didnt youre thats whats lets hows wheres
  teacher student pupil child children kid class classroom school lesson lessons plan planning activity
  activities worksheet exercise exercises homework test quiz exam question questions topic subject
  chapter unit book textbook page story poem grammar vocabulary word sentence paragraph essay letter
  english urdu math maths mathematics science physics chemistry biology computer islamiat islamic
  studies social history geography art drawing music sports health
  fraction fractions number numbers addition subtraction multiplication division table tables shape
  shapes geometry algebra equation measurement time money decimal decimals percentage
  plant plants animal animals water air energy light sound force matter photosynthesis cell
  body human earth weather solar system planet planets environment
  grade level primary secondary junior senior kindergarten nursery prep
  one two three four five six seven eight nine ten eleven twelve
  first second third fourth fifth sixth seventh eighth ninth tenth
  idea ideas way ways method methods strategy strategies tip tips example examples material materials
  resource resources video videos picture pictures image images chart game games song songs
  hour minute minutes period day week month year today tomorrow morning afternoon evening
  short long easy simple fun interesting interactive detailed creative full complete small big
  reading writing speaking listening spelling counting
  coach coaching observation feedback training course certificate
  name
  can could would please
  doing done made gave sent wrote taught learnt learned
`);

/** Try the word, then its common English inflections stripped back to a lexicon stem. */
function isEnglishWord(w) {
  if (ENGLISH.has(w)) return true;
  const tries = [];
  if (w.endsWith('ies')) tries.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) tries.push(w.slice(0, -2));
  if (w.endsWith('s')) tries.push(w.slice(0, -1));
  if (w.endsWith('ing')) tries.push(w.slice(0, -3), `${w.slice(0, -3)}e`);
  if (w.endsWith('ed')) tries.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ly')) tries.push(w.slice(0, -2));
  if (w.endsWith('er')) tries.push(w.slice(0, -2), w.slice(0, -1));
  return tries.some((t) => t.length > 1 && ENGLISH.has(t));
}

const NUMBER = /^\d+(st|nd|rd|th)?$/;

/** Cut a message into lowercase Latin words; apostrophes are dropped ("I'd" → "id"). */
function tokenize(text) {
  return text.toLowerCase()
    .replace(/['’‘`]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @returns {{english:boolean, reason:string, counted:number}}
 */
function hasEnglishEvidence(text) {
  if (typeof text !== 'string' || !text.trim()) return { english: false, reason: 'empty', counted: 0 };
  if (PERSO_ARABIC.test(text)) return { english: false, reason: 'perso_arabic_script', counted: 0 };
  let counted = 0;
  for (const w of tokenize(text)) {
    if (ROMAN_URDU.has(w)) return { english: false, reason: 'roman_urdu_word', counted };
    if (NUMBER.test(w) || SHARED.has(w)) continue;
    if (!isEnglishWord(w)) return { english: false, reason: 'unknown_word', counted };
    counted += 1;
  }
  if (counted < MIN_ENGLISH_WORDS) return { english: false, reason: 'too_few_english_words', counted };
  return { english: true, reason: 'english_evidence', counted };
}

/** A row that has never sent a message and has not locked a language. */
function isBrandNewRow(user) {
  return !!(user && user.id && !user.first_message_at && user.language_locked !== true);
}

const isSwitchOn = (env = process.env) => !!env && env[SWITCH] === 'true';

/**
 * @returns {{language:'en'|null, reason:string}} 'en' when this turn may answer in English; null = today's.
 */
function firstReplyLanguage({ user, text, env = process.env } = {}) {
  if (!isSwitchOn(env)) return { language: null, reason: 'switch_off' };
  if (!isBrandNewRow(user)) return { language: null, reason: 'not_brand_new' };
  if (!isOffered('en')) return { language: null, reason: 'en_not_offered' };
  const ev = hasEnglishEvidence(text);
  return { language: ev.english ? 'en' : null, reason: ev.reason };
}

module.exports = {
  hasEnglishEvidence,
  isBrandNewRow,
  isSwitchOn,
  firstReplyLanguage,
  tokenize,
  ROMAN_URDU,
  ENGLISH,
  SHARED,
  SWITCH,
};
