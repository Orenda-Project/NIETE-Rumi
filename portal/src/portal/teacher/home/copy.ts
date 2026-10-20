/**
 * The words of the Home card ("Next for you"), its score chips and the LP page's "Quiz this lesson" button
 * (the build contract, settled). Both languages from day one (language-protocol: NIETE is flat en/ur). Several lines are
 * the bot's own signed strings (th.played.n, th.again, th.report, th.quiz.this, th.lastlesson), so the card and the
 * quiz home it opens say the same thing; in Urdu the quiz is the teacher app's own word, «فوری جانچ», and a plan is
 * always «لیسن پلان» (vocabulary.guard), not the bot's WhatsApp wording.
 *
 * DATA is not copy: {topic}, {day}, {n}, {marks}/{max} come from GET /me/home as they are. In Urdu each one
 * sits in an isolate (language-protocol §8, §9.8: the placeholder is isolated, not the value): numbers in LRI…PDI (they
 * are always Latin digits), a topic or a date in FSI…PDI (its script is unknowable here: an Urdu plan title stays RTL,
 * an English one LTR). The sub line joins with "،" in Urdu and "·" in English. No number in a headline (the design rule R3).
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

/** Left-to-right isolate: a number or a fraction ("3/7") inside Urdu text. */
const LRI = '⁦';
/** First-strong isolate: a topic or a date, whose script the catalog cannot know. */
const FSI = '⁨';
const PDI = '⁩';
const num = (v: number | string) => `${LRI}${v}${PDI}`;
const data = (v: string) => `${FSI}${v}${PDI}`;

export const HOME_CARD_COPY = {
  eyebrow: 'Next for you',
  class: {
    title: (n: number) => `${n} in your class played`,
    sub: (topic: string) => `Quiz: ${topic}`,
    primary: 'Send again',
    secondary: 'See report',
  },
  coach: {
    title: 'Your coach report is ready',
    sub: (topic: string, day: string) => [topic, day].filter(Boolean).join(' · '),
    primary: 'See report',
    secondary: 'Quiz this',
  },
  lesson: {
    title: (topic: string) => `Quiz from your last lesson: ${topic}`,
    /** The slim card's lead-in; the topic follows as its own isolate (cut at its own end when long). */
    label: 'Quiz:',
    sub: (grade: number | string, subject: string) => `Lesson plan · Grade ${grade} · ${subject}`,
    primary: 'Quiz this',
    secondary: 'Open the plan',
  },
  obs: {
    title: (day: string) => `Your observation from ${day}`,
    sub: 'Observations',
    primary: 'See feedback',
    secondary: 'Lesson Plans',
  },
  first: {
    title: 'Make your first lesson plan',
    sub: 'Start here',
    primary: 'Make a lesson plan',
    secondary: 'Training',
  },
  scores: {
    coach: (marks: number, max: number) => `Coach ${marks}/${max}`,
    obs: (marks: number, max: number) => `Observation ${marks}/${max}`,
  },
  lp: {
    quizThis: 'Quiz this lesson',
  },
};

export const HOME_CARD_COPY_UR = {
  eyebrow: 'آپ کا اگلا کام',
  class: {
    title: (n: number) => `کلاس میں سے ${num(n)} نے کھیلا`,
    sub: (topic: string) => `فوری جانچ: ${data(topic)}`,
    primary: 'دوبارہ بھیجیں',
    secondary: 'رپورٹ دیکھیں',
  },
  coach: {
    title: 'آپ کی کوچنگ رپورٹ تیار ہے',
    sub: (topic: string, day: string) => [topic, day].filter(Boolean).map(data).join('، '),
    primary: 'رپورٹ دیکھیں',
    secondary: 'فوری جانچ بنائیں',
  },
  lesson: {
    title: (topic: string) => `آپ کے پچھلے سبق کی فوری جانچ: ${data(topic)}`,
    label: 'فوری جانچ:',
    sub: (grade: number | string, subject: string) => `لیسن پلان، جماعت ${num(grade)}، ${data(subject)}`,
    primary: 'فوری جانچ بنائیں',
    secondary: 'لیسن پلان کھولیں',
  },
  obs: {
    title: (day: string) => `${data(day)} کا مشاہدہ`,
    sub: 'مشاہدات',
    primary: 'رائے دیکھیں',
    secondary: 'لیسن پلان',
  },
  first: {
    title: 'اپنا پہلا لیسن پلان بنائیں',
    sub: 'یہاں سے شروع کریں',
    primary: 'لیسن پلان بنائیں',
    secondary: 'ٹریننگ',
  },
  scores: {
    coach: (marks: number, max: number) => `کوچ ${num(`${marks}/${max}`)}`,
    obs: (marks: number, max: number) => `مشاہدہ ${num(`${marks}/${max}`)}`,
  },
  lp: {
    quizThis: 'فوری جانچ بنائیں',
  },
};

export const HOME_CARD = bilingual(HOME_CARD_COPY, HOME_CARD_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry, found by its glob). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Home card',
  module: HOME_CARD as Bilingual<unknown>,
  // Every line has its own Urdu (the topic is data, so "Quiz: {topic}" still differs by its word).
  same: [],
  // The titles are sentences (the build contract), the lesson's sub line names three things, and the LP button mirrors the bot.
  longOk: ['class.title', 'coach.title', 'lesson.title', 'lesson.sub', 'obs.title', 'first.title', 'lp.quizThis'],
};
