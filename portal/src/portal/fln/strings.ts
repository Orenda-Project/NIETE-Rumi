/**
 * bd-t7zk3t.11 — every word the Reading Hour + Numeracy (FLN) pages show, EN + UR (DESIGN v2 §1, §7).
 *
 * NIETE is flat en/ur (language-protocol): the page language is the user's `preferred_language` (GET /fln/me
 * `ui_lang`); a plan's OWN text keeps its own language. Rules for Urdu chrome: the separator is «—», never «·»;
 * Urdu digits ۰–۹; no ′ after minutes; every number/Latin run is drawn inside <bdi> by the component (`Bdi`), never
 * by a string here. Gender-neutral throughout. Components never hold a literal or an `ur ? … : …` ternary: they ask
 * `flnStrings(lang)`.
 */
export type FlnLang = 'en' | 'ur';
export type FlnSubjectKey = 'rh-en' | 'rh-ur' | 'num';
export type SectionKind = 'opening' | 'explain' | 'practice' | 'independent_practice' | 'conclusion' | 'homework';
export type GroupLevel = 'beginner' | 'intermediate' | 'advance';
export type ItemKind = 'instruction' | 'say' | 'ask' | 'answer';
export type Strand = 'daily' | 'extended';

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** A number in the page's digits: Urdu ۰–۹ on an Urdu page, as-is on an English one. */
export function num(n: number | string, lang: FlnLang): string {
  const s = String(n);
  return lang === 'ur' ? s.replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]) : s;
}

interface FlnStrings {
  /** The chrome separator between two parts of one line. */
  sep: string;
  subject: Record<FlnSubjectKey, string>;
  /** Kicker line 1, upper-cased in EN by CSS, never by the string. */
  subjectKicker: Record<FlnSubjectKey, string>;
  band: { title: string; sub: string; subSenior: string; loading: string; error: string; retry: string; gradeLabel: string };
  bandRow: (count: number, level: number) => string;
  grade: (g: number) => string;
  level: (n: number) => string;
  levelGrades: Record<1 | 2 | 3, string>;
  levelDesc: Record<FlnSubjectKey, Record<1 | 2 | 3, string>>;
  listSub: (level: number, gradesLabel: string, count: number) => string;
  lessons: (n: number) => string;
  otherLevels: string;
  chooseLevel: string;
  next: string;
  opened: string;
  strand: Record<Strand, string>;
  chapter: (n: number) => string;
  chooser: { title: string; line: string; screener: string; startHere: string; groupMap: Record<1 | 2 | 3, string> };
  minutes: (n: number) => string;
  chip: {
    sounds: (n: number) => string;
    words: (n: number) => string;
    narration: string;
    video: string;
    textbook: string;
    additional: string;
    extended: string;
    answerKey: string;
    guide: string;
    screener: string;
    /** "1 sound" — the same text `sounds(1)` returns (MOCKUPS fix: never "1 sounds"; `sounds`/`words` are plural-aware). */
    soundOne: string;
  };
  kickerLevelLesson: (level: number, pos: number, count: number) => string;
  kickerLevel: (level: number) => string;
  totalTime: (n: number) => string;
  goal: string;
  fullDetails: string;
  fewerDetails: string;
  details: { slo: string; bring: string; before: string; summary: string };
  soundsInLesson: string;
  section: Record<SectionKind, string>;
  expand: string;
  collapse: string;
  itemKind: Record<Exclude<ItemKind, 'instruction'>, string>;
  groupLevel: Record<GroupLevel, string>;
  image: { enlarge: string; close: string; failed: string };
  video: { watch: (minutes: string, mb: string) => string; smaller: string };
  pdf: string;
  footer: { p25: (id: number) => string; p23: (id: number) => string };
  errors: {
    notAvailable: string;
    toList: string;
    unavailable: string;
    retry: string;
    loading: string;
  };
  back: string;
  signIn: { banner: string };
}

const EN: FlnStrings = {
  sep: ' · ',
  subject: { 'rh-en': 'Reading Hour · English', 'rh-ur': 'Reading Hour · Urdu', num: 'Numeracy' },
  subjectKicker: { 'rh-en': 'Reading Hour · English', 'rh-ur': 'Reading Hour · Urdu', num: 'Numeracy' },
  band: {
    title: 'Reading Hour & Numeracy',
    sub: 'Foundational reading and maths · for every grade',
    subSenior: 'By level · start with the screener',
    loading: 'Loading…',
    error: "Reading Hour plans aren't available right now",
    retry: 'Try again',
    gradeLabel: 'Grade',
  },
  bandRow: (count, level) => `${count} lessons · Level ${level}`,
  grade: (g) => `Grade ${g}`,
  level: (n) => `Level ${n}`,
  levelGrades: { 1: 'Grade 1', 2: 'Grades 2–3', 3: 'Grades 4–5' },
  levelDesc: {
    'rh-en': {
      1: 'Letter sounds and first words',
      2: 'Blends, digraphs and short stories',
      3: 'Longer words, fluency and comprehension',
    },
    'rh-ur': {
      1: 'Letter sounds and first words',
      2: 'The same letters and sounds as Level 1, plus textbook comprehension',
      3: 'Longer words, fluency and comprehension',
    },
    num: {
      1: 'Numbers to 100, add and subtract',
      2: 'Numbers to 999, carrying and times tables',
      3: 'Thousands, long operations, fractions',
    },
  },
  listSub: (level, gradesLabel, count) => `Level ${level} · ${gradesLabel} · ${count} lessons`,
  lessons: (n) => `${n} lessons`,
  otherLevels: 'Other levels',
  chooseLevel: 'Choose a level',
  next: 'Next',
  opened: 'Opened',
  strand: { daily: 'Daily lessons', extended: 'Weekly · Extended Hour' },
  chapter: (n) => `Chapter ${n}`,
  chooser: {
    title: 'Which level?',
    line: 'Struggling readers exist in every grade. Run the screener first to place each student.',
    screener: 'Screener',
    startHere: 'Start here',
    groupMap: { 1: 'Beginner → Level 1', 2: 'Intermediate → Level 2', 3: 'Advanced → Level 3' },
  },
  minutes: (n) => `${n} min`,
  chip: {
    sounds: (n) => (n === 1 ? '1 sound' : `${n} sounds`),
    words: (n) => (n === 1 ? '1 word' : `${n} words`),
    narration: 'Story audio',
    video: 'Video',
    textbook: 'Needs the textbook',
    additional: 'Additional practice',
    extended: 'Weekly · Extended Hour',
    answerKey: 'Answer key audio · teacher only',
    guide: 'Guide',
    screener: 'Screener',
    soundOne: '1 sound',
  },
  kickerLevelLesson: (level, pos, count) => `Level ${level} · Lesson ${pos}/${count}`,
  kickerLevel: (level) => `Level ${level}`,
  totalTime: (n) => `${n} min`,
  goal: 'Lesson goal',
  fullDetails: 'Full details',
  fewerDetails: 'Fewer details',
  details: { slo: 'Learning outcomes', bring: 'Bring', before: 'Before class', summary: 'Summary' },
  soundsInLesson: 'Sounds in this lesson',
  section: {
    opening: 'Opening',
    explain: 'Explain',
    practice: 'Practice',
    independent_practice: 'Independent practice',
    conclusion: 'Conclusion',
    homework: 'Homework',
  },
  expand: 'Show steps',
  collapse: 'Hide steps',
  itemKind: { say: 'Say:', ask: 'Ask:', answer: 'Answer:' },
  groupLevel: { beginner: 'Beginner', intermediate: 'Intermediate', advance: 'Advanced' },
  image: { enlarge: 'Enlarge picture', close: 'Close', failed: "Picture couldn't load" },
  video: { watch: (minutes, mb) => `Watch · ${minutes} min · ${mb} MB`, smaller: 'Smaller video' },
  pdf: 'Open the worksheet',
  footer: {
    p25: (id) => `FDE FLN programme 2025 · ID ${id}`,
    p23: (id) => `Additional practice · 2023–24 programme · ID ${id}`,
  },
  errors: {
    notAvailable: "This lesson isn't available",
    toList: 'Go to the lesson list',
    unavailable: "Reading Hour plans aren't available right now",
    retry: 'Try again',
    loading: 'Loading…',
  },
  back: 'Back',
  signIn: { banner: 'Sign in to open' },
};

const UR: FlnStrings = {
  sep: ' — ',
  subject: { 'rh-en': 'ریڈنگ آور — انگریزی', 'rh-ur': 'ریڈنگ آور — اردو', num: 'بنیادی حساب' },
  subjectKicker: { 'rh-en': 'ریڈنگ آور — انگریزی', 'rh-ur': 'ریڈنگ آور — اردو', num: 'بنیادی حساب' },
  band: {
    title: 'ریڈنگ آور اور بنیادی حساب',
    sub: 'بنیادی پڑھائی اور حساب — ہر جماعت کے لیے',
    subSenior: 'سطح کے مطابق — اسکرینر سے شروع کریں',
    loading: 'لوڈ ہو رہا ہے…',
    error: 'ریڈنگ آور کے اسباق ابھی دستیاب نہیں — دوبارہ کوشش کریں',
    retry: 'دوبارہ کوشش کریں',
    gradeLabel: 'جماعت',
  },
  bandRow: (count, level) => `${num(count, 'ur')} اسباق — سطح ${num(level, 'ur')}`,
  grade: (g) => `جماعت ${num(g, 'ur')}`,
  level: (n) => `سطح ${num(n, 'ur')}`,
  levelGrades: { 1: 'پہلی جماعت', 2: 'دوسری اور تیسری جماعت', 3: 'چوتھی اور پانچویں جماعت' },
  levelDesc: {
    'rh-en': { 1: 'حروف کی آوازیں اور پہلے الفاظ', 2: 'مرکب آوازیں اور چھوٹی کہانیاں', 3: 'لمبے الفاظ، روانی اور فہم' },
    'rh-ur': { 1: 'حروف کی آوازیں اور پہلے الفاظ', 2: 'سطح ۱ کے حروف اور آوازیں، اور درسی کتاب سے فہم', 3: 'لمبے الفاظ، روانی اور فہم' },
    num: { 1: '۱۰۰ تک گنتی، جمع اور تفریق', 2: '۹۹۹ تک اعداد، ہاتھ کا جمع اور پہاڑے', 3: 'ہزاروں تک اعداد، لمبی تقسیم، کسریں' },
  },
  listSub: (level, gradesLabel, count) => `سطح ${num(level, 'ur')} — ${gradesLabel} — ${num(count, 'ur')} اسباق`,
  lessons: (n) => `${num(n, 'ur')} اسباق`,
  otherLevels: 'دوسری سطحیں',
  chooseLevel: 'سطح منتخب کریں',
  next: 'اگلا',
  opened: 'کھولا گیا',
  strand: { daily: 'روزانہ اسباق', extended: 'ہفتہ وار — توسیعی گھنٹہ' },
  chapter: (n) => `باب ${num(n, 'ur')}`,
  chooser: {
    title: 'کون سی سطح؟',
    line: 'پڑھنے میں پیچھے رہ جانے والے بچے ہر جماعت میں ہوتے ہیں۔ ہر بچے کی سطح جاننے کے لیے پہلے اسکرینر کریں۔',
    screener: 'اسکرینر',
    startHere: 'یہاں سے شروع کریں',
    groupMap: { 1: 'ابتدائی گروپ ← سطح ۱', 2: 'درمیانی گروپ ← سطح ۲', 3: 'اعلیٰ گروپ ← سطح ۳' },
  },
  minutes: (n) => `${num(n, 'ur')} منٹ`,
  chip: {
    sounds: (n) => (n === 1 ? '۱ آواز' : `${num(n, 'ur')} آوازیں`),
    words: (n) => (n === 1 ? '۱ لفظ' : `${num(n, 'ur')} الفاظ`),
    narration: 'کہانی کی آواز',
    video: 'ویڈیو',
    textbook: 'درسی کتاب درکار',
    additional: 'اضافی مشق',
    extended: 'ہفتہ وار — توسیعی گھنٹہ',
    answerKey: 'جوابی کلید کی آواز — صرف استاد کے لیے',
    guide: 'رہنمائی',
    screener: 'اسکرینر',
    soundOne: '۱ آواز',
  },
  kickerLevelLesson: (level, pos, count) => `سطح ${num(level, 'ur')} — سبق ${num(pos, 'ur')} (کل ${num(count, 'ur')})`,
  kickerLevel: (level) => `سطح ${num(level, 'ur')}`,
  totalTime: (n) => `${num(n, 'ur')} منٹ`,
  goal: 'سبق کا مقصد',
  fullDetails: 'مکمل تفصیل',
  fewerDetails: 'کم تفصیل',
  details: { slo: 'سیکھنے کے نتائج', bring: 'ساتھ لائیں', before: 'کلاس سے پہلے', summary: 'خلاصہ' },
  soundsInLesson: 'اس سبق کی آوازیں',
  section: {
    opening: 'آغاز',
    explain: 'وضاحت',
    practice: 'مشق',
    independent_practice: 'انفرادی مشق',
    conclusion: 'اختتام',
    homework: 'گھر کا کام',
  },
  expand: 'مراحل دکھائیں',
  collapse: 'مراحل چھپائیں',
  itemKind: { say: 'کہیں:', ask: 'پوچھیں:', answer: 'جواب:' },
  groupLevel: { beginner: 'ابتدائی گروپ', intermediate: 'درمیانی گروپ', advance: 'اعلیٰ گروپ' },
  image: { enlarge: 'تصویر بڑی کریں', close: 'بند کریں', failed: 'تصویر لوڈ نہیں ہوئی' },
  video: { watch: (minutes, mb) => `دیکھیں — ${num(minutes, 'ur')} منٹ — ${num(mb, 'ur')} ایم بی`, smaller: 'چھوٹی ویڈیو' },
  pdf: 'ورک شیٹ کھولیں',
  footer: {
    p25: (id) => `FDE FLN پروگرام ۲۰۲۵ — آئی ڈی ${num(id, 'ur')}`,
    p23: (id) => `اضافی مشق — ۲۰۲۳–۲۴ پروگرام — آئی ڈی ${num(id, 'ur')}`,
  },
  errors: {
    notAvailable: 'یہ سبق دستیاب نہیں',
    toList: 'فہرست پر جائیں',
    unavailable: 'ریڈنگ آور کے اسباق ابھی دستیاب نہیں — دوبارہ کوشش کریں',
    retry: 'دوبارہ کوشش کریں',
    loading: 'لوڈ ہو رہا ہے…',
  },
  back: 'واپس',
  signIn: { banner: 'کھولنے کے لیے سائن اِن کریں' },
};

const BY_LANG: Record<FlnLang, FlnStrings> = { en: EN, ur: UR };

export function flnStrings(lang: FlnLang): FlnStrings {
  return BY_LANG[lang] ?? EN;
}

export const FLN_DIR: Record<FlnLang, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl' };

/** Level of a primary grade (1 → L1, 2–3 → L2, 4–5 → L3); null from grade 6 (they choose). */
export function levelForGrade(grade: number): 1 | 2 | 3 | null {
  if (grade === 1) return 1;
  if (grade === 2 || grade === 3) return 2;
  if (grade === 4 || grade === 5) return 3;
  return null;
}
