/**
 * bd-snkn32.56 (queue #134 E) — the words of "Start from a learning goal or topic" (every grade since bd-snkn32.57,
 * behind the list-only portal_lp_own_goal_start). Its own small catalogue (own/copy.ts is at the 300-line limit), registered through
 * lessons/copy.ts COPY_ENTRIES like OWN. The Urdu is MACHINE-DRAFTED from the words own/copy.ts already uses
 * (سبق, لیسن پلان, صفحات) and needs a human read before this is switched on for anyone beyond the pilot.
 */
import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const GOAL_COPY = {
  /* step 1's second way in (the #134 mockup: "Start from… A learning goal / Type a topic") */
  startFromGoal: 'Start from a learning goal or topic',
  startFromGoalHint: 'No textbook needed in class',
  /* the goal screen */
  title: 'Learning goal',
  outcomes: 'Learning goals for your grade',
  noOutcomes: 'No learning goals listed for this subject yet.',
  topicPlaceholder: 'e.g. Saving water at home',
  find: 'Find',
  noMatch: 'Not found in your grade’s lessons. Try other words, or select a learning goal.',
  checkLabel: 'Learning goal',
  noBook: 'Written for a class with no textbook.',
  /* bd-snkn32.57 — "What you have" on the Check screen when, with no book, she ticked nothing */
  nothingExtra: 'Nothing extra',
  /* bd-snkn32.58.1 (queue #155 A) — Make my own's first screen: two equal starts */
  startTitle: 'How do you want to start?',
  fromBook: 'From a textbook chapter',
  fromBookHint: 'Select a chapter and its pages',
  fromGoal: 'From a learning goal',
  fromGoalHint: 'No textbook needed in class',
  /* the goal list, grouped by skill (our grouping, not official wording) */
  search: 'Search goals',
  goalsCount: (n: number) => (n === 1 ? '1 goal' : `${n} goals`),
  noneFound: 'No goal has these words.',
  /* bd-snkn32.58.2 (queue #155 B) — the typed-topic guard */
  didYouMean: 'Did you mean',
  otherGrade: (n: number) => `This is a Grade ${n} goal`,
  useAnyway: 'Use it anyway',
  seeMine: 'See my grade’s goals',
  blocked: 'This is not a school topic. Select a learning goal.',
  noteDropped: 'Your note was not used.',
  /* bd-snkn32.58.3 (queue #155 C) — the check before a goal plan is shown */
  checking: 'Checking it matches your goal…',
  unsureTitle: 'We could not make a plan we are sure of for this goal.',
  anotherGoal: 'Select another goal',
  /* bd-snkn32.61 (Amena 20 Nov) — skills only, no chapters; her own goal behind a clear button, still checked */
  searchPlaceholder: 'e.g. add, read, letters',
  addOwn: 'Add my own goal',
  ownLabel: 'My own goal',
  ownHint: 'We check the spelling and your grade.',
  checkOwn: 'Check my goal',
  useMine: 'Use my words',
  groups: {
    numbers: 'Numbers', add_sub: 'Adding and subtracting', mul_div: 'Multiplying and dividing', fractions: 'Fractions and decimals',
    measure: 'Measuring', time_money: 'Time and money', shapes: 'Shapes', data: 'Charts and data', patterns: 'Patterns',
    word_problems: 'Word problems', reading: 'Reading', comprehension: 'Understanding a text', phonics: 'Sounds and letters',
    words: 'New words', grammar: 'Grammar', speaking: 'Speaking and listening', writing: 'Written work', living: 'Living things',
    matter: 'Matter and energy', earth: 'Earth and space', tools: 'Science tools', other: 'Other goals',
  },
};

const GOAL_COPY_UR: typeof GOAL_COPY = {
  startFromGoal: 'سیکھنے کے مقصد یا موضوع سے شروع کریں',
  startFromGoalHint: 'کلاس میں کتاب کی ضرورت نہیں',
  title: 'سیکھنے کا مقصد',
  outcomes: 'آپ کی جماعت کے سیکھنے کے مقاصد',
  noOutcomes: 'اس مضمون کے سیکھنے کے مقاصد ابھی موجود نہیں۔',
  topicPlaceholder: 'مثلاً گھر میں پانی بچانا',
  find: 'تلاش کریں',
  noMatch: 'آپ کی جماعت کے لیسن پلان میں نہیں ملا۔ دوسرے الفاظ لکھیں، یا سیکھنے کا مقصد چنیں۔',
  checkLabel: 'سیکھنے کا مقصد',
  noBook: 'بغیر کتاب والی کلاس کے لیے لکھا گیا۔',
  nothingExtra: 'کچھ اضافی نہیں',
  startTitle: 'کیسے شروع کریں؟',
  fromBook: 'کتاب کے باب سے',
  fromBookHint: 'باب اور اس کے صفحات چنیں',
  fromGoal: 'سیکھنے کے مقصد سے',
  fromGoalHint: 'کلاس میں کتاب کی ضرورت نہیں',
  search: 'مقاصد تلاش کریں',
  goalsCount: (n: number) => `${n} مقاصد`,
  noneFound: 'ان الفاظ والا کوئی مقصد نہیں ملا۔',
  didYouMean: 'کیا آپ کا مطلب یہ تھا؟',
  otherGrade: (n: number) => `یہ جماعت ${n} کا مقصد ہے`,
  useAnyway: 'پھر بھی یہی لیں',
  seeMine: 'میری جماعت کے مقاصد',
  blocked: 'یہ اسکول کا موضوع نہیں۔ سیکھنے کا مقصد چنیں۔',
  noteDropped: 'آپ کا نوٹ شامل نہیں کیا گیا۔',
  checking: 'دیکھا جا رہا ہے کہ لیسن پلان آپ کے مقصد کے مطابق ہے…',
  unsureTitle: 'اس مقصد کے لیے ہم ایسا لیسن پلان نہیں بنا سکے جس پر ہمیں یقین ہو۔',
  anotherGoal: 'دوسرا مقصد چنیں',
  searchPlaceholder: 'مثلاً جمع، پڑھنا، حروف',
  addOwn: 'اپنا مقصد شامل کریں',
  ownLabel: 'میرا اپنا مقصد',
  ownHint: 'ہم ہجے اور جماعت دیکھتے ہیں۔',
  checkOwn: 'میرا مقصد جانچیں',
  useMine: 'میرے الفاظ لیں',
  groups: {
    numbers: 'اعداد', add_sub: 'جمع اور تفریق', mul_div: 'ضرب اور تقسیم', fractions: 'کسور اور اعشاریہ',
    measure: 'پیمائش', time_money: 'وقت اور پیسے', shapes: 'اشکال', data: 'گراف اور معلومات', patterns: 'نمونے',
    word_problems: 'عبارتی سوالات', reading: 'پڑھنا', comprehension: 'سمجھ کر پڑھنا', phonics: 'آوازیں اور حروف',
    words: 'نئے الفاظ', grammar: 'قواعد', speaking: 'بولنا اور سننا', writing: 'لکھنا', living: 'جاندار',
    matter: 'مادہ اور توانائی', earth: 'زمین اور خلا', tools: 'سائنسی آلات', other: 'دیگر مقاصد',
  },
};

export const GOAL = bilingual(GOAL_COPY, GOAL_COPY_UR);
export type GoalCopy = Words<typeof GOAL_COPY>;

export const GOAL_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Make my own · learning goal',
  module: GOAL as Bilingual<unknown>,
  same: [],
  // The way in, its hint, the list's heading, the empty and not-found states and the Check line are sentences.
  longOk: ['addOwn', 'ownLabel', 'ownHint', 'checkOwn', 'useMine', 'searchPlaceholder', 'checking', 'unsureTitle', 'anotherGoal', 'didYouMean', 'otherGrade', 'seeMine', 'blocked', 'noteDropped', 'useAnyway', 'startTitle', 'fromBook', 'fromBookHint', 'fromGoal', 'fromGoalHint', 'search', 'noneFound', 'groups', 'startFromGoal', 'startFromGoalHint', 'outcomes', 'noOutcomes', 'topicPlaceholder', 'noMatch', 'noBook', 'title', 'checkLabel'],
};
