'use strict';

/**
 * Jugnu's spoken lines for the self-administered (SA) battery, in English and Urdu. Each line is the official EGRA /
 * Core EGMA instruction as item-bank.v3.json carries it (`from`), adapted for a child alone with a phone the way
 * Tangerine SA-EGRMA adapts it: the enumerator's stage directions ("[point to …]") become what the child does on the
 * screen, "tell me" becomes "say it out loud" (record) or "tap it" (tap), and nothing is added to the measure.
 *
 * Copy rules: the child is addressed with آپ and imperatives only, so no Urdu line carries a gendered verb (no
 * "گا/گی"); Urdu letters, never Arabic look-alikes; no right/wrong feedback during a scored task (EGRA gives
 * feedback on practice items only). `{x}` is the item the line is about, filled in per item by the builder.
 */

const L = (en, ur, from) => ({ en, ur, from });

// Lines every task uses, by when they are spoken.
const COMMON = {
  begin: L('Ready? Begin.', 'تیار ہو جائیں۔ شروع کریں۔', 'v3:script.begin'),
  time_up: L('Stop. Well done for trying.', 'رک جائیں۔ کوشش کرنے پر شاباش۔', 'v3:script.stop'),
  early_stop: L('Thank you! Let us go on to the next one.', 'شکریہ! اب اگلے حصے کی طرف چلتے ہیں۔', 'v3:script.early_stop'),
  after: L('Good effort! Let us go on to the next part.', 'شاباش! اب اگلے حصے کی طرف چلتے ہیں۔', 'v3:script.after'),
  practice_intro: L('First, let us practise.', 'پہلے مشق کرتے ہیں۔', 'egra_tk2016:Annex H (practice items)'),
  test_intro: L('Now it is your turn. Jugnu will not say if an answer is right until the end.', 'اب آپ کی باری ہے۔ اب جگنو آخر تک نہیں بتائے گا کہ جواب صحیح ہے یا نہیں۔', 'egra_tk2016:no feedback on scored items'),
  practice_right: L('Yes! Well done.', 'شاباش! بالکل ٹھیک۔', 'v3:script.practice_1_correct'),
  practice_wrong: L('Not quite. Listen again.', 'ابھی نہیں۔ دوبارہ سنیں۔', 'v3:script.practice_1_wrong'),
  replay: L('Listen again.', 'دوبارہ سنیں۔', 'egra_tk2016:3-second rule (replay at 5 s)'),
  hand_back: L('Well done! Please give the phone back to your teacher.', 'شاباش! اب فون واپس اپنے استاد کو دے دیں۔', 'adapted:handback'),
};

// Battery-level lines (welcome, the audio check, the end).
const BATTERY = {
  welcome: L('Hello! This is not a test for marks. Jugnu will play some reading and number games with you. Listen carefully and do your best.',
    'السلام علیکم! یہ نمبروں والا امتحان نہیں ہے۔ جگنو آپ کے ساتھ پڑھنے اور گنتی کے کچھ کھیل کھیلے گا۔ غور سے سنیں اور اپنی پوری کوشش کریں۔',
    'egra_tk2016:p.186 (consent and "this is not a test")'),
  audio_check: L('Can you hear Jugnu? Tap the picture Jugnu says.', 'کیا آپ کو جگنو کی آواز آ رہی ہے؟ جو تصویر جگنو بتائے، اسے دبائیں۔', 'adapted:headphone check'),
  audio_fail: L('Ask for help with the headphones, then try again.', 'ہیڈ فون کے لیے مدد مانگیں، پھر دوبارہ کوشش کریں۔', 'adapted:headphone check'),
  section_urdu: L('Now some Urdu reading.', 'اب کچھ اردو پڑھتے ہیں۔', 'adapted:section'),
  section_english: L('Now some English reading.', 'اب کچھ انگریزی پڑھتے ہیں۔', 'adapted:section'),
  section_maths: L('Now some number games.', 'اب گنتی کے کچھ کھیل۔', 'adapted:section'),
  end: L('All done! Thank you. Please give the phone back to your teacher.', 'سب ہو گیا! شکریہ۔ اب فون واپس اپنے استاد کو دے دیں۔', 'adapted:handback'),
};

// Per task kind. intro_record: the child reads aloud and Jugnu keeps the recording; intro_tap: Jugnu says an item and
// the child taps it. item: what Jugnu says for one scored item. right / wrong: practice feedback only.
const TASKS = {
  'ur.letters': {
    intro_record: L('Here is a page of Urdu letters. Say the NAME of each letter out loud, not its sound. Start at the first letter and go along each row. If you do not know a letter, go on to the next one. Read as quickly and carefully as you can.',
      'یہ اردو حروفِ تہجی کا صفحہ ہے۔ ہر حرف کا نام اونچی آواز میں بتائیں، آواز نہیں، صرف نام۔ پہلے حرف سے شروع کریں اور ہر سطر میں آگے بڑھیں۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔ جتنا جلدی اور دھیان سے ہو سکے، پڑھیں۔',
      'v3:sets.A.reading.ur.letters.script.intro+instructions'),
    intro_tap: L('Here are some Urdu letters. Listen to the name of a letter, then tap that letter. Go as quickly and carefully as you can.',
      'یہ کچھ اردو حروف ہیں۔ ایک حرف کا نام سنیں، پھر وہی حرف دبائیں۔ جتنا جلدی اور دھیان سے ہو سکے، کریں۔',
      'v3:sets.A.reading.ur.letters.script.intro (tap adaptation)'),
    item: L('{x}', '{x}', 'the letter name'),
    right: L('Yes! This letter is {x}.', 'شاباش! یہ حرف {x} ہے۔', 'v3:sets.A.reading.en.letters.script.practice_1_correct'),
    wrong: L('This letter is {x}.', 'یہ حرف {x} ہے۔', 'v3:sets.A.reading.en.letters.script.practice_1_wrong'),
  },
  'en.letters': {
    intro_record: L('Here is a page of English letters. Say the NAME of each letter out loud, not its sound. Start at the first letter and go along each row. If you do not know a letter, go on to the next one. Read as quickly and carefully as you can.',
      'یہ انگریزی حروفِ تہجی کا صفحہ ہے۔ ہر حرف کا نام اونچی آواز میں بتائیں، آواز نہیں، صرف نام۔ پہلے حرف سے شروع کریں اور ہر سطر میں آگے بڑھیں۔ اگر کوئی حرف نہ آئے تو اگلے حرف پر چلے جائیں۔ جتنا جلدی اور دھیان سے ہو سکے، پڑھیں۔',
      'v3:sets.A.reading.en.letters.script.intro+instructions'),
    intro_tap: L('Here are some English letters. Listen to the name of a letter, then tap that letter. Go as quickly and carefully as you can.',
      'یہ کچھ انگریزی حروف ہیں۔ ایک حرف کا نام سنیں، پھر وہی حرف دبائیں۔ جتنا جلدی اور دھیان سے ہو سکے، کریں۔',
      'v3:sets.A.reading.en.letters.script.intro (tap adaptation)'),
    example: L('For example, the name of this letter is {x}.', 'مثال کے طور پر، اس حرف کا نام {x} ہے۔', 'v3:sets.A.reading.en.letters.script.example'),
    item: L('{x}', '{x}', 'the letter name'),
    right: L('Yes! The name of this letter is {x}.', 'شاباش! اس حرف کا نام {x} ہے۔', 'v3:sets.A.reading.en.letters.script.practice_1_correct'),
    wrong: L('The name of this letter is {x}.', 'اس حرف کا نام {x} ہے۔', 'v3:sets.A.reading.en.letters.script.practice_1_wrong'),
  },
  // DESIGN §2b reading extras. English: TK2009 / TK2016 Annex H child instructions; Urdu: SELECT 2024 (initial sound).
  'en.letter_sounds': {
    intro_tap: L('Here are some English letters. Jugnu will say the SOUND of a letter, not its name. Tap the letter that makes that sound. Go as quickly and carefully as you can.',
      'یہ کچھ انگریزی حروف ہیں۔ جگنو ایک حرف کی آواز بولے گا، نام نہیں۔ جو حرف یہ آواز دیتا ہے، اسے دبائیں۔ جتنا جلدی اور دھیان سے ہو سکے، کریں۔',
      'egra_tk2016:Annex H p.187 letter sound "tell me the sounds of as many letters as you can" (tap adaptation)'),
    example: L('For example, the sound of this letter is {x}.', 'مثال کے طور پر، اس حرف کی آواز {x} ہے۔', 'egra_tk2016:Annex H p.187 (example T)'),
    right: L('Yes! The sound of this letter is {x}.', 'شاباش! اس حرف کی آواز {x} ہے۔', 'egra_tk2016:Annex H p.187 (practice, correct)'),
    wrong: L('The sound of this letter is {x}.', 'اس حرف کی آواز {x} ہے۔', 'egra_tk2016:Annex H p.187 (practice, incorrect)'),
  },
  'en.initial_sound': {
    intro_tap: L('This is a listening game. Jugnu will say a word two times. Listen to the word, then tap the letter for the very first sound in that word.',
      'یہ سننے کا کھیل ہے۔ جگنو ایک لفظ دو بار بولے گا۔ لفظ غور سے سنیں، پھر اس لفظ کی سب سے پہلی آواز والا حرف دبائیں۔',
      'egra_tk2009:p34 initial sound "tell me the very first sound in that word" (tap adaptation)'),
    // {x} = the word, {y} = its first sound as Jugnu says it.
    example: L('For example, in the word "{x}", the first sound is {y}.', 'مثال کے طور پر، لفظ "{x}" کی پہلی آواز {y} ہے۔', 'egra_tk2009:p34 (example "pot")'),
    right: L('Very good, the first sound in "{x}" is {y}.', 'شاباش! لفظ "{x}" کی پہلی آواز {y} ہے۔', 'egra_tk2009:p34 (practice, correct)'),
    wrong: L('Listen again: "{x}". The first sound in "{x}" is {y}.', 'دوبارہ سنیں: "{x}"۔ لفظ "{x}" کی پہلی آواز {y} ہے۔', 'egra_tk2009:p34 (practice, incorrect)'),
  },
  'ur.initial_sound': {
    intro_tap: L('This is a listening game. Jugnu will say some words. Tap the letter for the beginning sound of each word. Jugnu will say each word two times.',
      'یہ سننے کی مشق ہے۔ جگنو آپ کو کچھ لفظ بتائے گا۔ ہر لفظ کی ابتدائی آواز والا حرف دبائیں۔ جگنو ہر لفظ دو بار دہرائے گا۔',
      'select2024:p120 initial sound script (tap adaptation)'),
    example: L('For example, the beginning sound of the word "{x}" is {y}.', 'جیسے: لفظ "{x}" کی ابتدائی آواز {y} ہے۔', 'select2024:p120 (example "جہاز")'),
    right: L('Well done! The beginning sound of the word "{x}" is {y}.', 'شاباش! لفظ "{x}" کی ابتدائی آواز {y} ہے۔', 'select2024:p120 (practice, correct)'),
    wrong: L('The beginning sound of the word "{x}" is {y}.', 'لفظ "{x}" کی ابتدائی آواز {y} ہے۔', 'select2024:p120 (practice, incorrect)'),
  },
  nonwords: {
    intro_record: L('Here are some made-up words. They are not real words. Read as many as you can, out loud. Do not spell them, read each whole word. Start at the first word and go along each row. If you do not know a word, go on to the next one.',
      'یہ کچھ بنائے ہوئے الفاظ ہیں، یہ اصلی الفاظ نہیں ہیں۔ جتنے ہو سکیں، اونچی آواز میں پڑھیں۔ ہجے نہ کریں، پورا لفظ پڑھیں۔ پہلے لفظ سے شروع کریں اور ہر سطر میں آگے بڑھیں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔',
      'v3:sets.A.reading.<lang>.nonwords.script.intro+instructions'),
    intro_tap: L('Here are some made-up words. They are not real words. Listen to a made-up word, then tap that word.',
      'یہ کچھ بنائے ہوئے الفاظ ہیں، یہ اصلی الفاظ نہیں ہیں۔ ایک بنایا ہوا لفظ سنیں، پھر وہی لفظ دبائیں۔',
      'v3:sets.A.reading.<lang>.nonwords.script.intro (tap adaptation)'),
    example: L('For example, this made-up word is {x}.', 'مثال کے طور پر، یہ بنایا ہوا لفظ ہے: {x}۔', 'v3:sets.A.reading.<lang>.nonwords.script.example'),
    item: L('{x}', '{x}', 'the made-up word'),
    right: L('Yes! This made-up word is {x}.', 'شاباش! یہ بنایا ہوا لفظ {x} ہے۔', 'v3:sets.A.reading.<lang>.nonwords.script.practice_1_correct'),
    wrong: L('This made-up word is {x}.', 'یہ بنایا ہوا لفظ {x} ہے۔', 'v3:sets.A.reading.<lang>.nonwords.script.practice_1_wrong'),
  },
  words: {
    intro_record: L('Here are some words. Read as many as you can, out loud. Do not spell them, read each whole word. Start at the first word and go along each row. If you do not know a word, go on to the next one.',
      'یہ کچھ الفاظ ہیں۔ جتنے ہو سکیں، اونچی آواز میں پڑھیں۔ ہجے نہ کریں، پورا لفظ پڑھیں۔ پہلے لفظ سے شروع کریں اور ہر سطر میں آگے بڑھیں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔',
      'v3:sets.A.reading.<lang>.words.script.intro+instructions'),
    intro_tap: L('Here are some words. Listen to a word, then tap that word.', 'یہ کچھ الفاظ ہیں۔ ایک لفظ سنیں، پھر وہی لفظ دبائیں۔',
      'v3:sets.A.reading.<lang>.words.script.intro (tap adaptation)'),
    example: L('For example, this word is {x}.', 'مثال کے طور پر، یہ لفظ {x} ہے۔', 'v3:sets.A.reading.en.words.script.example'),
    item: L('{x}', '{x}', 'the word'),
    right: L('Yes! This word is {x}.', 'شاباش! یہ لفظ {x} ہے۔', 'v3:sets.A.reading.en.words.script.practice_1_correct'),
    wrong: L('This word is {x}.', 'یہ لفظ {x} ہے۔', 'v3:sets.A.reading.en.words.script.practice_1_wrong'),
  },
  story: {
    intro_record: L('Here is a short story. Read it out loud, quickly but carefully. Start at the first word. If you come to a word you do not know, go on to the next word. When you finish, there are some questions about the story.',
      'یہ ایک مختصر کہانی ہے۔ اسے اونچی آواز میں، جلدی مگر دھیان سے پڑھیں۔ پہلے لفظ سے شروع کریں۔ اگر کوئی لفظ نہ آئے تو اگلے لفظ پر چلے جائیں۔ کہانی پڑھنے کے بعد اس کے بارے میں کچھ سوال ہوں گے۔',
      'v3:sets.A.reading.<lang>.story.script.intro'),
    last_word: L('When Jugnu says stop, tap the last word you read.', 'جب جگنو کہے رک جائیں، تو وہ آخری لفظ دبائیں جو آپ نے پڑھا۔',
      'egra_tk2016:p.197 (the enumerator brackets the last word read)'),
  },
  story_comp: {
    intro_record: L('Now some questions about the story you just read. Listen to each question and say your answer out loud. You can answer in Urdu or English.',
      'اب اس کہانی کے بارے میں کچھ سوال ہیں جو آپ نے ابھی پڑھی۔ ہر سوال سنیں اور اپنا جواب اونچی آواز میں بتائیں۔ اردو یا انگریزی، کسی بھی زبان میں جواب دیں۔',
      'v3:sets.A.reading.<lang>.story.script.questions_intro'),
    intro_tap: L('Now some questions about the story you just read. Listen to each question, then tap the answer.',
      'اب اس کہانی کے بارے میں کچھ سوال ہیں جو آپ نے ابھی پڑھی۔ ہر سوال سنیں، پھر جواب دبائیں۔',
      'v3:sets.A.reading.<lang>.story.script.questions_intro (tap adaptation)'),
  },
  listening: {
    intro_record: L('Listen to a short story. You will hear it two times. Then there are some questions. Say your answer out loud, in Urdu or English.',
      'ایک مختصر کہانی سنیں۔ کہانی دو بار سنائی جائے گی۔ پھر کچھ سوال ہوں گے۔ اپنا جواب اونچی آواز میں بتائیں، اردو یا انگریزی میں۔',
      'v3:sets.A.reading.<lang>.listening.script.intro'),
    intro_tap: L('Listen to a short story. You will hear it two times. Then listen to each question and tap the answer.',
      'ایک مختصر کہانی سنیں۔ کہانی دو بار سنائی جائے گی۔ پھر ہر سوال سنیں اور جواب دبائیں۔',
      'v3:sets.A.reading.<lang>.listening.script.intro (tap adaptation)'),
  },
  'ma.number_id': {
    intro_record: L('Here are some numbers. Say each number out loud. Start at the first number and go along each row.',
      'یہ کچھ نمبر ہیں۔ ہر نمبر اونچی آواز میں بتائیں۔ پہلے نمبر سے شروع کریں اور ہر سطر میں آگے بڑھیں۔',
      'v3:sets.A.maths.3.number_id.script.intro'),
    intro_tap: L('Here are some numbers. Listen to a number, then tap that number.', 'یہ کچھ نمبر ہیں۔ ایک نمبر سنیں، پھر وہی نمبر دبائیں۔',
      'v3:sets.A.maths.3.number_id.script.intro (tap adaptation)'),
    item: L('{x}', '{x}', 'the number'),
  },
  'ma.discrimination': {
    intro_record: L('Look at the two numbers. Which number is bigger? Say it out loud.', 'ان دو نمبروں کو دیکھیں۔ کون سا نمبر بڑا ہے؟ اونچی آواز میں بتائیں۔',
      'v3:sets.A.maths.3.discrimination.script.item'),
    intro_tap: L('Look at the two numbers. Tap the number that is bigger.', 'ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔',
      'v3:sets.A.maths.3.discrimination.script.item (tap adaptation)'),
    right: L('That is right, {x} is bigger.', 'بالکل ٹھیک، {x} بڑا ہے۔', 'v3:sets.A.maths.3.discrimination.script.practice_1_correct'),
    wrong: L('The bigger number is {x}.', 'بڑا نمبر {x} ہے۔', 'v3:sets.A.maths.3.discrimination.script.practice_1_wrong'),
  },
  'ma.missing': {
    intro_record: L('Here are some numbers in a row. One number is missing. What number goes in the empty box? Say it out loud.',
      'یہ ایک قطار میں کچھ نمبر ہیں۔ ایک نمبر غائب ہے۔ خالی خانے میں کون سا نمبر آئے گا؟ اونچی آواز میں بتائیں۔',
      'v3:sets.A.maths.3.missing.script.item'),
    intro_tap: L('Here are some numbers in a row. One number is missing. Tap the number that goes in the empty box.',
      'یہ ایک قطار میں کچھ نمبر ہیں۔ ایک نمبر غائب ہے۔ خالی خانے میں جو نمبر آئے گا، اسے دبائیں۔',
      'v3:sets.A.maths.3.missing.script.item (tap adaptation)'),
    right: L('That is right, {x}.', 'بالکل ٹھیک، {x}۔', 'v3:sets.A.maths.3.missing.script.practice_1_correct'),
    wrong: L('The number {x} goes here.', 'یہاں {x} آئے گا۔', 'v3:sets.A.maths.3.missing.script.practice_1_wrong'),
  },
  'ma.add1': {
    intro_record: L('Here are some addition problems. Say the answer to each one out loud. If you do not know an answer, go on to the next one.',
      'یہ کچھ جمع کے سوال ہیں۔ ہر سوال کا جواب اونچی آواز میں بتائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔',
      'v3:sets.A.maths.3.add1.script.intro'),
    intro_tap: L('Here are some addition problems. Tap the answer to each one. If you do not know an answer, tap Next.',
      'یہ کچھ جمع کے سوال ہیں۔ ہر سوال کا جواب دبائیں۔ اگر جواب نہ آئے تو "اگلا" دبائیں۔',
      'v3:sets.A.maths.3.add1.script.intro (tap adaptation)'),
  },
  'ma.sub1': {
    intro_record: L('Here are some subtraction problems. Say the answer to each one out loud. If you do not know an answer, go on to the next one.',
      'یہ کچھ تفریق کے سوال ہیں۔ ہر سوال کا جواب اونچی آواز میں بتائیں۔ اگر کسی سوال کا جواب نہ آئے تو اگلے سوال پر چلے جائیں۔',
      'v3:sets.A.maths.3.sub1.script.intro'),
    intro_tap: L('Here are some subtraction problems. Tap the answer to each one. If you do not know an answer, tap Next.',
      'یہ کچھ تفریق کے سوال ہیں۔ ہر سوال کا جواب دبائیں۔ اگر جواب نہ آئے تو "اگلا" دبائیں۔',
      'v3:sets.A.maths.3.sub1.script.intro (tap adaptation)'),
  },
  'ma.add2': {
    intro_record: L('Here are some more addition problems. Take your time. Say the answer out loud.', 'یہ جمع کے کچھ اور سوال ہیں۔ آرام سے کریں۔ جواب اونچی آواز میں بتائیں۔',
      'v3:sets.A.maths.3.add2.script.intro'),
    intro_tap: L('Here are some more addition problems. Take your time, then tap the answer.', 'یہ جمع کے کچھ اور سوال ہیں۔ آرام سے سوچیں، پھر جواب دبائیں۔',
      'v3:sets.A.maths.3.add2.script.intro (tap adaptation)'),
  },
  'ma.sub2': {
    intro_record: L('Here are some more subtraction problems. Take your time. Say the answer out loud.', 'یہ تفریق کے کچھ اور سوال ہیں۔ آرام سے کریں۔ جواب اونچی آواز میں بتائیں۔',
      'v3:sets.A.maths.3.sub2.script.intro'),
    intro_tap: L('Here are some more subtraction problems. Take your time, then tap the answer.', 'یہ تفریق کے کچھ اور سوال ہیں۔ آرام سے سوچیں، پھر جواب دبائیں۔',
      'v3:sets.A.maths.3.sub2.script.intro (tap adaptation)'),
  },
  // The extra maths tasks (DESIGN §2b). RWP's own administration scripts were not recovered, so each line adapts the
  // RWP item's printed question ("What comes next?") with the Core EGMA keypad/tap wording of the nearest task.
  'ma.patterns': {
    intro_tap: L('Look at the pattern. Tap what comes next.', 'اس ترتیب کو دیکھیں۔ آگے جو آئے، اسے دبائیں۔',
      'rwp2026:patterns item text "What comes next?" (tap adaptation)'),
  },
  'ma.patterns_hi': {
    intro_tap: L('Look at the pattern and listen to the question. Type the answer with the number buttons.',
      'ترتیب کو دیکھیں اور سوال سنیں۔ جواب نمبر والے بٹن دبا کر لکھیں۔', 'rwp2026:patterns levels 3-4 item text (keypad adaptation)'),
  },
  'ma.number_repr': {
    intro_tap: L('Listen to each question, then type the answer with the number buttons. To hear a question again, tap Jugnu.',
      'ہر سوال سنیں، پھر جواب نمبر والے بٹن دبا کر لکھیں۔ سوال دوبارہ سننے کے لیے جگنو کو دبائیں۔',
      'rwp2026:represent item text (keypad adaptation, Core EGMA word problems wording)'),
  },
  'ma.ordering': {
    intro_tap: L('Listen to each question, then tap the answer.', 'ہر سوال سنیں، پھر جواب دبائیں۔',
      'rwp2026:identify item text (tap adaptation)'),
  },
  'ma.fluency_l34': {
    intro_tap: L('Here are some more sums: adding, taking away, times and sharing. Type the answer to each one. If you do not know an answer, tap Next.',
      'یہ کچھ اور سوال ہیں: جمع، تفریق، ضرب اور تقسیم۔ ہر سوال کا جواب لکھیں۔ اگر جواب نہ آئے تو "اگلا" دبائیں۔',
      'v3:sets.A.maths.3.add1.script.intro (keypad adaptation; RWP blfl4 grid)'),
  },
  'ma.word_problems': {
    intro_record: L('Listen to each problem very carefully, then say the answer out loud. To hear a problem again, tap Jugnu.',
      'ہر سوال بہت دھیان سے سنیں، پھر جواب اونچی آواز میں بتائیں۔ سوال دوبارہ سننے کے لیے جگنو کو دبائیں۔',
      'v3:sets.A.maths.3.word_problems.script.intro'),
    intro_tap: L('Listen to each problem very carefully, then tap the answer. To hear a problem again, tap Jugnu.',
      'ہر سوال بہت دھیان سے سنیں، پھر جواب دبائیں۔ سوال دوبارہ سننے کے لیے جگنو کو دبائیں۔',
      'v3:sets.A.maths.3.word_problems.script.intro (tap adaptation)'),
    right: L('That is right, {x}.', 'بالکل ٹھیک، {x}۔', 'v3:sets.A.maths.3.word_problems.script.practice_correct'),
    wrong: L('The answer is {x}.', 'جواب {x} ہے۔', 'v3:sets.A.maths.3.word_problems.script.practice_wrong'),
  },
};

// The names Jugnu says for Urdu letters in the letter task (the standard Urdu alphabet names, as the RWP enumerators
// accepted them: R7 may_instrument letterid_fl_urd).
const UR_LETTER_NAMES = {
  'ا': 'الف', 'آ': 'الف مد', 'ب': 'بے', 'پ': 'پے', 'ت': 'تے', 'ٹ': 'ٹے', 'ث': 'ثے', 'ج': 'جیم', 'چ': 'چے', 'ح': 'بڑی حے',
  'خ': 'خے', 'د': 'دال', 'ڈ': 'ڈال', 'ذ': 'ذال', 'ر': 'رے', 'ڑ': 'ڑے', 'ز': 'زے', 'ژ': 'ژے', 'س': 'سین', 'ش': 'شین',
  'ص': 'صواد', 'ض': 'ضواد', 'ط': 'طوئے', 'ظ': 'ظوئے', 'ع': 'عین', 'غ': 'غین', 'ف': 'فے', 'ق': 'قاف', 'ک': 'کاف',
  'گ': 'گاف', 'ل': 'لام', 'م': 'میم', 'ن': 'نون', 'ں': 'نون غنہ', 'و': 'واؤ', 'ؤ': 'واؤ ہمزہ', 'ہ': 'چھوٹی ہے',
  'ھ': 'دو چشمی ہے', 'ء': 'ہمزہ', 'ئ': 'ہمزہ', 'ی': 'چھوٹی یے', 'ے': 'بڑی یے',
};

// What Jugnu says for an English letter SOUND (letter-sound task). TK2009 p.28 accepts /b/ or /buh/ and either vowel
// sound; these spellings are for the voice only and are checked by ear (a human recording is preferred).
const EN_LETTER_SOUNDS = {
  a: 'ah', b: 'buh', c: 'kuh', d: 'duh', e: 'eh', f: 'fff', g: 'guh', h: 'hhh', i: 'ih', j: 'juh', k: 'kuh', l: 'lll', m: 'mmm',
  n: 'nnn', o: 'aw', p: 'puh', q: 'kwuh', r: 'rrr', s: 'sss', t: 'tuh', u: 'uh', v: 'vvv', w: 'wuh', x: 'ks', y: 'yuh', z: 'zzz',
};

module.exports = { COMMON, BATTERY, TASKS, UR_LETTER_NAMES, EN_LETTER_SOUNDS };
