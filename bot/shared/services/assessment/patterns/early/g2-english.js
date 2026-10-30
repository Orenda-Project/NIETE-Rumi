'use strict';
/**
 * Grade 2 English, FDE 2023-24 model paper: 100 marks. Oral: listening 5, speaking 5,
 * read aloud 10 (20). Written: comprehension 20 + writing 60 (80). ToS 36 / 36 / 28.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
// One underscore per missing letter: v12 printed "man__o" for mango, two blanks for one letter.
const oneBlankEach = (q) => {
  const stem = String(q.question || '').replace(/\s/g, '');
  return stem.includes('_') && stem.length === String(q.answer || '').trim().length;
};

// v28 G2 English Q1 (i) asked for free writing and (j) for a tense change: every question is read from the passage.
const FROM_PASSAGE = (q) => !(q.questions || []).some((x) => /^\s*Write (one|a) sentence about/i.test(String(x && x.question)) || /Change this sentence/i.test(String(x && x.question)));

module.exports = makeSubject({
  grade: 2,
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی',
  tos: { Remember: 36, Understand: 36, Apply: 28 },
  pages: 159,
  sections: [
    {
      id: 'A',
      label_en: 'Reading',
      levels: { Remember: 8, Understand: 8, Apply: 4 },
      slots: [
        { slot: 'g2.english.A.Q1', label_en: 'Q1.', type: 'Read and Answer', generate: 1, marks_each: 20, lines: 0, answer_ok: FROM_PASSAGE,
          instruction_en: 'Read the passage and answer the questions.',
          prompt_rule: 'One new passage of 80 to 110 words in "passage", on a book theme, in Grade 2 words. "questions": ten objects { question, answer, marks: 2, scheme } — four recall, four understand, two apply — where scheme.points sum to 2. Every question is answered from the passage: the two apply questions ask the child to use what the passage says (why, or what would happen if), never to write about themselves and never a grammar or tense change (no "Write one sentence about", no "Change this sentence"). Do not prefix a question with a letter. Two-mark questions: one answer earns both marks (2 for a complete answer, 1 for part of it); split into two marks only a question that asks for two things and says so ("What two things...?"). No question needs a grammar word the class has not met, and none asks the child to infer beyond one clause of the passage. v35 (bd-5jmnfj.4.58.9): a question never prints the answer to an earlier question ("Why does Sana thank the old man?" after a question keyed "An old man sells balloons"): before writing, read each stem against every earlier answer and say "he", "she", "it" or "they" instead of the earlier answer\'s words. No two questions pay the same fact (the ducks need bread or food, once only).' },
      ],
    },
    {
      id: 'B',
      label_en: 'Words and grammar',
      levels: { Remember: 14, Understand: 10, Apply: 4 },
      slots: [
        S({ slot: 'g2.english.B.Q2', label_en: 'Q2.', type: 'Sentences from Words', generate: 3,
          instruction_en: 'Make sentences with these words.',
          prompt_rule: 'Three book words. Answer: a model sentence; accept any correct sentence using the word.' }),
        S({ slot: 'g2.english.B.Q3', label_en: 'Q3.', type: 'Rhyming Pairs', generate: 3, picture: ['object'],
          instruction_en: 'Write a rhyming word.', prompt_rule: 'Three book words. The stem prints the word ("Write a word that rhymes with hat."). Answer: one rhyme; accept lists other real rhymes; the common error is a real word that does not rhyme. Each item also carries picture: {kind:"object", name} of the given word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q4', label_en: 'Q4.', type: 'Spelling', generate: 2, picture: ['object'], picture_only: true,
          instruction_en: 'Look at the picture and write the word.',
          prompt_rule: 'Two book objects as picture: {kind:"object", name}. Answer: the word.' }),
        S({ slot: 'g2.english.B.Q5', label_en: 'Q5.', type: 'Is Am Are', shape: 'mcq', generate: 3,
          instruction_en: 'Choose is, am or are.', prompt_rule: 'Three sentences with one blank; options exactly is, am, are. Use names the paper prints nowhere else.' }),
        S({ slot: 'g2.english.B.Q6', label_en: 'Q6.', type: 'Missing Letters', generate: 3, picture: ['object'],
          instruction_en: 'Fill in the missing letters.', answer_ok: oneBlankEach,
          prompt_rule: 'Three book words with one or two letters blank, one underscore for each missing letter ("b__k" for book, "man_o" for mango); the picture is the clue. Answer: the full word. Each item also carries picture: {kind:"object", name} of the answer word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q7', label_en: 'Q7.', type: 'Opposites', generate: 3,
          instruction_en: 'Write the opposite.', prompt_rule: 'Three book adjectives or verbs, each with one clear opposite. Answer: the opposite. scheme.accept lists only words that are the opposite of the given word itself, never small for tall or big for short.' }),
        S({ slot: 'g2.english.B.Q8', label_en: 'Q8.', type: 'Singular Plural', generate: 3, picture: ['object'],
          instruction_en: 'Write the plural.', prompt_rule: 'Three book nouns (one -es, one irregular). Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q9', label_en: 'Q9.', type: 'Has Have', shape: 'mcq', generate: 3,
          instruction_en: 'Choose has or have.', prompt_rule: 'Three sentences with one blank; options exactly has, have.' }),
        S({ slot: 'g2.english.B.Q10', label_en: 'Q10.', type: 'Prepositions', generate: 5, picture: ['scene'],
          instruction_en: 'Look at the picture. Write in, on, under, near or behind.',
          answer_ok: (q) => /^(in|on|under|near|behind)$/i.test(String(q.answer).trim()),
          prompt_rule: 'Five items, each a scene as picture: {kind:"scene", describe} of one object placed by another (a cat under a table), placed in, on, under, near or behind it, never above, over, beside or next to. The describe names the floor and the thing\'s own legs or base ("a ball on the floor under a chair", "a bird on top of the roof"). Never a bird or animal in or on a tree, or in any scene where both in and on read true (a bird among the leaves of a branch is both): use in only for a thing inside a container (box, basket, bag, cup). Stem: "The cat is ____ the table." Answer: that one word. v35 (bd-5jmnfj.4.58.9): in each scene only one of the five words is true; near is true of anything at, under, behind or beside another thing, so put the thing clearly apart for near; for an in, on, under or behind answer draw the position plainly, and scheme.accept never lists near (the child reads the picture for that position). Repeat one word across two items, so the last item cannot be found by using each word once.' }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      levels: { Remember: 8, Understand: 10, Apply: 14 },
      slots: [
        S({ slot: 'g2.english.C.Q11', label_en: 'Q11.', type: 'Pronouns', generate: 4,
          instruction_en: 'Write the sentence again. Use he, she, it or they.', prompt_rule: 'Four sentences naming a person or thing; a person is named with a plainly a boy\'s or a girl\'s name from the book (Ali, Ahmed, Sana, Ayesha), never a name that could be either; the child writes each sentence again with the pronoun. Answer: the full rewritten sentence with the pronoun in place of the name, e.g. "He is playing outside." Scheme: A 1 for the correct pronoun in the rewritten sentence.' }),
        { slot: 'g2.english.C.Q12', label_en: 'Q12.', type: 'Paragraph', generate: 1, marks_each: 10, lines: 7,
          instruction_en: 'Write five sentences on "My House".',
          prompt_rule: 'Topic exactly "My House". Answer: a model paragraph of five sentences. Scheme: five K points of 2 — writes about the house, five sentences, each sentence gives a different fact, sensible order, spells familiar words right. Every 2-mark criterion carries 2/1/0 descriptors in its text (for example "Writes five sentences: 2 for five, 1 for three or four, 0 for fewer"). No point pays capitals, full stops or describing words (Q14 and Q11 teach those).' },
        S({ slot: 'g2.english.C.Q13', label_en: 'Q13.', type: 'Articles', shape: 'mcq', generate: 3,
          instruction_en: 'Choose a or an.', prompt_rule: 'Three nouns with a blank before them; options exactly a, an.' }),
        S({ slot: 'g2.english.C.Q14', label_en: 'Q14.', type: 'Punctuation', generate: 3,
          instruction_en: 'Write each sentence again. Put a full stop (.) or a question mark (?) at the end.', answer_ok: (q) => /[.?]$/.test(String(q.answer).trim()),
          prompt_rule: 'Three short sentences with no end mark, each a statement or a question, never an exclamation. Answer: the sentence with its . or ?.' }),
        { slot: 'g2.english.C.Q15', label_en: 'Q15.', type: 'Picture Description', generate: 1, marks_each: 6, lines: 4, picture: ['scene'],
          instruction_en: 'Look at the picture and write three sentences.',
          prompt_rule: 'One busy scene from a book theme (a park, a market, a classroom) as picture: {kind:"scene", describe}. Answer: three model sentences. Scheme: three K points of 2 — each a correct sentence about the picture. Each point carries 2/1/0 descriptors in its text.' },
        { slot: 'g2.english.C.Q16', label_en: 'Q16.', type: 'Story Order', generate: 1, marks_each: 6, lines: 3,
          instruction_en: 'Put the sentences in order to make a story.',
          prompt_rule: 'One short story of six sentences from a book theme, given out of order and listed in "questions" as plain sentences with no number or letter in front (the paper letters them (a)-(f)). Answer: the order. Scheme: one K point of 6 scored by position: 6 if every sentence is in place, minus 1 for each sentence out of place, never below 0. Never one mark per adjacent pair. The six sentences share no food, animal or object word with any other question of this paper, in the singular or the plural. Write the story so exactly one order is valid; if two orders are really valid, list every valid order in scheme.accept.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'listening', kind: 'listening', marks: 5, label_en: 'Listening', label_ur: 'سننا',
        instruction_en: 'Read the story aloud twice. Then ask the questions; the child answers aloud.',
        instruction_ur: 'کہانی دو بار بلند آواز سے پڑھیں، پھر سوال پوچھیں۔',
        ask: 'A story of 5 to 7 sentences on a book theme, then five questions (2 recall, 2 understand, 1 apply, in that order, apply last) with answers. The fifth answer is one short model, followed by "any sensible answer that fits the story earns the mark". The story has at most two names (other characters are "her mother" or "the teacher"), and the fifth question is about the story (what would happen if, what should the character do), never about the child: no "you" or "your".', n: 5,
        rubric: [{ marks: 1, en: 'Each right answer', ur: 'ہر درست جواب' }] },
      { id: 'speaking', kind: 'speaking', marks: 5, label_en: 'Speaking', label_ur: 'بولنا',
        instruction_en: 'Ask the child to talk about the topic for about half a minute.',
        instruction_ur: 'بچے سے موضوع پر تقریباً آدھے منٹ بات کرنے کو کہیں۔',
        ask: 'One topic (my best friend, my favourite game) and three prompt questions.', n: 3,
        rubric: [
          { marks: 1, en: 'Keeps talking for half a minute with no more than two prompts from the teacher', ur: 'استاد کے دو سے زیادہ سوال کے بغیر آدھے منٹ تک بولتا ہے' },
          // v35 (bd-5jmnfj.4.58.9): a 2-mark row says what earns 1.
          { marks: 2, en: 'Gives different details about the topic: 2 for three or more, 1 for one or two, 0 for none', ur: 'موضوع پر مختلف تفصیلات دیتا ہے: تین یا زیادہ پر 2، ایک یا دو پر 1، کوئی نہیں تو 0' },
          { marks: 2, en: 'Speaks in full sentences: 2 if at most two sentences have a wrong is, am, are, has, have or plural, 1 if three or four, 0 if more', ur: 'مکمل جملوں میں بولتا ہے: زیادہ سے زیادہ دو جملوں میں is، am، are، has، have یا جمع غلط ہو تو 2، تین یا چار میں 1، اس سے زیادہ میں 0' },
        ] },
      { id: 'read_aloud', kind: 'read_aloud', marks: 10, label_en: 'Read aloud', label_ur: 'بلند خوانی',
        instruction_en: 'The child reads the passage aloud. Mark against the rubric.',
        instruction_ur: 'بچہ عبارت بلند آواز سے پڑھے۔ روبرک کے مطابق نمبر دیں۔',
        ask: 'A passage of 40 to 50 words from a book lesson (quote the book exactly). The card is one continuous passage from one place in the book, never two passages joined, and its first sentence names who it is about, so no he, she, they or it lacks a name or noun before it. The text is grammatical and keeps every apostrophe and possessive as printed in the book ("Pinky\'s eyes", never "Pinky eyes"): the child reads it aloud and is scored on accuracy.', n: 0,
        rubric: [
          { marks: 2, en: 'Sounds out long words part by part: 2 if every long word, 1 if some, 0 if none', ur: 'لمبے الفاظ ٹکڑوں میں پڑھتا ہے: ہر لفظ پر 2، کچھ پر 1، کسی پر نہیں تو 0' },
          { marks: 3, en: 'Accuracy: 3 for 0 to 2 words wrong, 2 for 3 to 5, 1 for 6 to 9, 0 for 10 or more', ur: 'درستگی: 0 سے 2 غلط الفاظ پر 3، 3 سے 5 پر 2، 6 سے 9 پر 1، 10 یا زیادہ پر 0' },
          { marks: 3, en: 'Fluency: 3 for smooth phrases with 2 stops or fewer, 2 for 3 to 5 stops, 1 for word by word, 0 if cannot read on', ur: 'روانی: 2 یا کم رکاوٹوں پر 3، 3 سے 5 پر 2، لفظ بہ لفظ پر 1، آگے نہ پڑھ سکے تو 0' },
          { marks: 2, en: 'Voice drops at each full stop (and rises at a question mark when the passage has one): 2 every time, 1 sometimes, 0 never', ur: 'آواز ہر فل سٹاپ پر نیچے (اور سوالیہ نشان پر اوپر، اگر عبارت میں ہو): ہمیشہ 2، کبھی کبھی 1، کبھی نہیں 0' },
        ] },
    ],
  },
});
