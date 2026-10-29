/**
 * bd-6clakk.11 — the oral part of the FDE Grade 3-5 English and Urdu model papers, in the shape the
 * early patterns use (patterns/early/g2-*.js). Tasks and marks are FDE's own. FDE prints no rubric for
 * these papers, so a task's marks are split only where FDE splits them (per question); where it does
 * not, the task is one row the teacher marks as a whole. G3 English reuses FDE's Grade 2 rubric, whose
 * marks are the same. Projects are left out: FDE marks them as their own 10% component.
 * Written reading comprehension stays in the written paper.
 */
const row = (marks, en, ur) => ({ marks, en, ur });
const WHOLE = (marks) => row(marks, 'The whole task (FDE gives no split)', 'پورا کام (FDE نے تقسیم نہیں دی)');
const perQuestion = (marks) => marks.map((m, i) => row(m, `Question ${i + 1}`, `سوال ${i + 1}`));

const task = (id, kind, marks, label_en, label_ur, instruction_en, instruction_ur, ask, n, rubric, extra = {}) => ({
  id, kind, marks, label_en, label_ur, instruction_en, instruction_ur, ask, n, rubric, ...extra,
});

const READ_ALOUD_EN = 'The child reads the passage aloud. Mark against the rubric.';
const READ_ALOUD_UR = 'بچہ عبارت بلند آواز سے پڑھے۔ روبرک کے مطابق نمبر دیں۔';
const LISTEN_EN = 'Read the text aloud twice. Then ask the questions; the child answers aloud.';
const LISTEN_UR = 'عبارت دو بار بلند آواز سے پڑھیں، پھر سوال پوچھیں؛ بچہ زبانی جواب دے۔';
const SPEAK_UR = 'بچہ موضوع پر چند جملے بولے۔';

const english = {
  3: [
    task('listening', 'listening', 5, 'Listening', 'سننا', LISTEN_EN, LISTEN_UR,
      'A story of 6 to 8 sentences on a book theme, then five questions (2 recall, 2 understand, 1 apply) with answers.', 5,
      [row(1, 'Each right answer', 'ہر درست جواب')]),
    task('speaking', 'speaking', 5, 'Speaking', 'بولنا',
      'Ask the child to talk about the topic for about a minute.', 'بچے سے موضوع پر تقریباً ایک منٹ بات کرنے کو کہیں۔',
      'One topic from the book pages and three prompt questions.', 3,
      [row(1, 'Confidence', 'اعتماد'), row(1, 'Gives details', 'تفصیل'), row(1, 'Standard English', 'درست انگریزی'), row(2, 'Expression', 'اظہار')]),
    task('read_aloud', 'read_aloud', 10, 'Read aloud', 'بلند خوانی', READ_ALOUD_EN, READ_ALOUD_UR,
      'A passage of 50 to 60 words from a book lesson (quote the book exactly).', 0,
      [row(2, 'Breaks words into syllables', 'الفاظ کو ہجوں میں توڑنا'), row(3, 'Accuracy', 'درستگی'), row(3, 'Fluency', 'روانی'), row(2, 'Expression', 'اظہار')]),
  ],
  4: [
    task('listening', 'listening', 5, 'Listening: tone and sounds', 'سننا',
      'Read the story aloud with its tone. The child says whether each asked sentence rises or falls, then names the cluster words.', LISTEN_UR,
      'A story of about 7 sentences on a book theme; three of its sentences, each asked as "rising or falling tone?" with the answer; '
        + 'and two words that begin with a three-consonant cluster (like "street"), each asked as "which word begins with …?".', 5,
      [row(3, 'Rising or falling tone named right', 'لہجہ درست بتایا'), row(2, 'Three-consonant cluster words found', 'تین حرفی جوڑ والے الفاظ پہچانے')]),
    task('speaking', 'speaking', 5, 'Speaking', 'بولنا',
      'A: ask each child the two questions. B: a group of three discusses the two questions, taking turns.', SPEAK_UR,
      'Activity A: two personal questions (a favourite thing from the book pages, and why). '
        + 'Activity B: two opinion questions on a book theme for a group of three to discuss.', 4,
      [row(1, 'A, question 1', 'الف، سوال 1'), row(1, 'A, question 2', 'الف، سوال 2'), row(1, 'B, question 1', 'ب، سوال 1'), row(2, 'B, question 2', 'ب، سوال 2')]),
    task('read_aloud', 'read_aloud', 5, 'Read aloud', 'بلند خوانی',
      'The child reads the passage aloud, keeping the pronunciation rules.', READ_ALOUD_UR,
      'A passage of 60 to 80 words from a book lesson (quote the book exactly).', 0,
      [row(5, 'Pronunciation', 'تلفظ')]),
  ],
  5: [
    task('dialogue', 'speaking', 5, 'Speaking: pair dialogue', 'بولنا: جوڑی میں مکالمہ',
      'Two children read the model dialogue, then make and present their own on the task.', 'دو بچے مکالمہ پڑھیں، پھر اپنا مکالمہ بنا کر سنائیں۔',
      'A model dialogue of 6 short turns on a book theme as the script, and one item: the task for the pair\'s own dialogue.', 1,
      [WHOLE(5)], { script: true }),
    task('pronouns', 'listening', 2, 'Listening: pronouns', 'سننا: ضمیریں',
      'Read the passage aloud. Ask for the missing pronouns.', LISTEN_UR,
      'A passage of about 8 sentences on a book theme; four items, each a sentence with its pronoun asked for, answer the pronoun.', 4,
      [WHOLE(2)]),
    task('diphthongs', 'listening', 2, 'Listening: diphthongs', 'سننا: دوہری آوازیں',
      'Read the text aloud. The child names the words with a diphthong.', LISTEN_UR,
      'A text of 4 to 5 sentences; five items asking "which word has the sound …?", answer the word.', 5,
      [WHOLE(2)]),
    task('syllables', 'listening', 1, 'Listening: syllables', 'سننا: ہجے',
      'Read the text aloud. The child splits the asked words into syllables.', LISTEN_UR,
      'A text of 3 to 4 sentences; four items, each a word from it, answer its syllable split.', 4,
      [WHOLE(1)]),
  ],
};

const urdu = {
  3: [
    task('listening', 'listening', 5, 'Listening', 'سننا', LISTEN_EN, LISTEN_UR,
      'An Urdu passage of 6 to 8 sentences on a book theme (good habits, care for others), then four questions with answers.', 4,
      [WHOLE(5)]),
    task('imagine', 'speaking', 5, 'Speaking', 'بولنا',
      'Ask the question; the child answers in a few sentences.', SPEAK_UR,
      'One "if you were …, how would you …?" question tied to the book pages.', 1, [WHOLE(5)]),
    task('verses', 'read_aloud', 8, 'Read verses and answer', 'اشعار پڑھ کر جواب',
      'The child reads the verses and answers the question.', 'بچہ اشعار پڑھے اور سوال کا جواب دے۔',
      'Six lines of a book poem as the script (quote the book exactly), and one question on it with its answer.', 1,
      [WHOLE(8)], { script: true }),
    task('riddles', 'listening', 2, 'Riddles', 'پہیلیاں',
      'Read each riddle; the child solves it.', 'ہر پہیلی سنائیں؛ بچہ بوجھے۔',
      'Two short Urdu riddles as items, each with its answer.', 2,
      [row(1, 'Each riddle solved', 'ہر پہیلی بوجھی')], { script: false }),
    task('tell', 'speaking', 6, 'Speaking', 'بولنا',
      'Ask the question; the child answers in a few sentences.', SPEAK_UR,
      'One question on how the child celebrates or does something from the book pages.', 1, [WHOLE(6)]),
    task('read_aloud', 'read_aloud', 4, 'Read aloud', 'بلند خوانی',
      'The child reads the text with correct pronunciation.', 'بچہ عبارت درست تلفظ سے پڑھے۔',
      'Four lines from a book lesson (quote the book exactly).', 0, [WHOLE(4)]),
  ],
  4: [
    task('listening', 'listening', 5, 'Listening', 'سننا', LISTEN_EN, LISTEN_UR,
      'An Urdu story of 8 to 10 sentences on a book theme, then three questions with answers (the third asks the child\'s opinion).', 3,
      perQuestion([1, 2, 2])),
    task('poem', 'read_aloud', 5, 'Read a poem and answer', 'نظم پڑھ کر جواب',
      'The child reads the verses with rhythm, suggests a title and answers the question.', 'بچہ اشعار لے اور آہنگ سے پڑھے، عنوان تجویز کرے اور سوال کا جواب دے۔',
      'Verses from a book poem as the script (quote the book exactly), and one question on them with its answer.', 1,
      [WHOLE(5)], { script: true }),
    task('moral', 'read_aloud', 4, 'Read and tell the lesson', 'پڑھ کر سبق بتانا',
      'The child reads the passage and tells its moral lesson.', 'بچہ عبارت پڑھے اور بتائے کہ اس سے کیا سبق ملا۔',
      'A short passage from a book lesson as the script, and one item: "what lesson did you learn?" with its answer.', 1,
      [WHOLE(4)], { script: true }),
    task('speaking', 'speaking', 16, 'Speaking', 'بولنا',
      'Ask the four questions; the child answers each aloud.', 'چاروں سوال پوچھیں؛ بچہ ہر ایک کا زبانی جواب دے۔',
      'Four questions: three personal ones on book themes, and one asking for five sentences on a topic from the book pages.', 4,
      perQuestion([3, 3, 5, 5])),
  ],
  5: [
    task('listening', 'listening', 5, 'Listening', 'سننا', LISTEN_EN, LISTEN_UR,
      'An Urdu passage of 8 to 10 sentences on a book theme, then three questions with answers (the third asks its central idea).', 3,
      perQuestion([1, 2, 2])),
    task('riddles', 'listening', 5, 'Riddles', 'پہیلیاں',
      'Read each riddle; the child solves it.', 'ہر پہیلی سنائیں؛ بچہ بوجھے۔',
      'Two Urdu riddles as items, each with its answer.', 2, [WHOLE(5)], { script: false }),
    task('five_sentences', 'speaking', 5, 'Speaking: five sentences', 'بولنا: پانچ جملے',
      'The child says five sentences on the topic.', 'بچہ موضوع پر پانچ جملے بولے۔',
      'One topic from the book pages.', 1, [WHOLE(5)]),
    task('ambition', 'speaking', 5, 'Speaking', 'بولنا',
      'Ask the question; the child answers with a reason.', SPEAK_UR,
      'One personal question with "why?" tied to a book theme.', 1, [WHOLE(5)]),
    task('explain', 'speaking', 5, 'Speaking', 'بولنا',
      'Ask the question; the child names and explains.', SPEAK_UR,
      'One question asking the child to name five things from a book theme and say why each matters.', 1, [WHOLE(5)]),
    task('read_aloud', 'read_aloud', 5, 'Read aloud', 'بلند خوانی', READ_ALOUD_EN, READ_ALOUD_UR,
      'A passage of 60 to 80 words from a book lesson (quote the book exactly).', 0, [WHOLE(5)]),
  ],
};

module.exports = { english, urdu };
