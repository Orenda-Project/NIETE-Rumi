'use strict';
/**
 * The question stems a teacher can tick on a topic paper (bd-6clakk.12), by subject, grade band
 * and question type: each [id, text]. Taken from the item instructions of the FDE model papers
 * (Drive 1JVReBscTMR7RdsiDNmGYCvc54VoOC2DP; research in bd-5jmnfj v1_research/fde-patterns-g1-g2.md
 * and fde-patterns-g3-g5.md). The English, Maths and Science lines are the papers' own wording;
 * the Urdu PDFs extract garbled, so the Urdu lines are the standard Urdu paper instruction for the
 * same FDE item, not a verbatim copy.
 *
 * Maths and Science use one list for both bands ('1-5'). Pure data.
 */

const ENGLISH = {
  '1-2': {
    MCQs: [['choose', 'Choose the correct answer.'], ['tick-word', 'Tick the correct word.']],
    'Fill in the Blanks': [
      ['is-am-are', 'Fill in the blanks with is, am or are.'],
      ['has-have', 'Fill in the blanks with has or have.'],
      ['a-an-the', 'Fill in the blanks with a, an or the.'],
      ['in-on-under', 'Fill in the blanks with in, on or under.'],
      ['word-box', 'Complete the sentences with words from the box.'],
    ],
    'Missing Letters': [
      ['missing-letters', 'Fill in the missing letters.'],
      ['unscramble', 'Unscramble the letters to make a word.'],
    ],
    'True/False': [['true-false', 'Write True or False.']],
    'Match the Column': [
      ['match-ab', 'Match column A with column B.'],
      ['opposites', 'Match the words with their opposites.'],
      ['singular-plural', 'Match the singular with its plural.'],
    ],
    'Circle the Correct Answer': [
      ['circle-naming', 'Circle the naming words.'],
      ['underline-action', 'Underline the action words.'],
    ],
    'Rewrite Sentences': [
      ['capitals', 'Rewrite the sentences with capital letters and full stops.'],
      ['noun-pronoun', 'Change the noun to a pronoun and rewrite the sentence.'],
      ['alphabetical', 'Put the words in alphabetical order.'],
      ['rearrange', 'Rearrange the words to make a sentence.'],
    ],
    'Brief Answers': [['one-sentence', 'Answer these questions in one sentence.']],
    'Word Meanings': [['meanings', 'Write the meanings of these words.']],
    'Word Sentences': [
      ['this-is', 'Make sentences with "This is a ...".'],
      ['use-in-sentence', 'Use these words in sentences.'],
    ],
    'Comprehension Passage': [['read-answer', 'Read the passage and answer the questions.']],
    Rewriting: [
      ['plural', 'Rewrite the words in plural form.'],
      ['rhyming', 'Write a rhyming word for each word.'],
    ],
    'Story Completion': [['order-story', 'Put the sentences in order to complete the story.']],
    'Simple Writing': [
      ['word-bank-paragraph', 'Write a paragraph using the words in the box.'],
      ['five-sentences', 'Write five sentences about the topic.'],
    ],
  },
  '3-5': {
    MCQs: [['choose', 'Choose the correct answer.'], ['closest-meaning', 'Choose the word closest in meaning.']],
    'True/False': [
      ['true-false', 'Write True or False.'],
      ['correct-false', 'Write True or False. Correct the false sentences.'],
    ],
    'Fill in the Blanks': [
      ['verb-form', 'Fill in the blanks with the correct form of the verb.'],
      ['present-continuous', 'Fill in the blanks using the present continuous tense.'],
      ['a-an-the', 'Fill in the blanks with a, an or the.'],
      ['preposition', 'Fill in the blanks with the correct preposition.'],
    ],
    'Missing Letters': [['missing-letters', 'Fill in the missing letters.']],
    'Match the Column': [
      ['match-ab', 'Match column A with column B.'],
      ['opposites', 'Match the words with their opposites.'],
      ['meanings', 'Match the words with their meanings.'],
    ],
    'Circle the Correct Answer': [['circle-word', 'Circle the correct word.']],
    'Rewrite Sentences': [
      ['do-as-directed', 'Do as directed.'],
      ['past-tense', 'Change the sentences into past tense.'],
      ['negative', 'Change the sentences into negative.'],
      ['punctuate', 'Punctuate the sentences.'],
    ],
    'Brief Answers': [['two-three', 'Answer these questions in two or three sentences.']],
    'Word Meanings': [['meanings', 'Write the meanings of these words.']],
    'Word Sentences': [['use-in-sentence', 'Use these words in sentences.']],
    'Comprehension Passage': [
      ['read-answer', 'Read the passage and answer the questions.'],
      ['read-table', 'Read the passage and complete the table.'],
    ],
    'Story Writing': [
      ['story-clues', 'Write a story using the clues given.'],
      ['story-moral', 'Write a story with the moral given.'],
    ],
    'Letter Writing': [['letter-friend', 'Write a letter to your friend.'], ['invitation', 'Write an invitation card.']],
    'Application Writing': [['leave', 'Write an application to your headteacher for leave.']],
    'Essay Writing': [['essay', 'Write an essay of about 80 words on the topic.']],
    'Paragraph Writing': [['paragraph', 'Write a paragraph on the topic.']],
  },
};

const URDU = {
  '1-2': {
    MCQs: [['choose', 'درست جواب پر دائرہ لگائیں۔']],
    'Fill in the Blanks': [
      ['blanks', 'خالی جگہ پُر کریں۔'],
      ['word-box', 'دیے گئے الفاظ سے جملے مکمل کریں۔'],
    ],
    'Missing Letters': [
      ['missing', 'غائب حروف لکھ کر لفظ مکمل کریں۔'],
      ['join', 'حروف جوڑ کر لفظ بنائیں۔'],
    ],
    'True/False': [['true-false', 'درست یا غلط لکھیں۔']],
    'Match the Column': [['match', 'کالم (الف) کو کالم (ب) سے ملائیں۔']],
    'Circle the Correct Answer': [
      ['verbs', 'جملوں میں فعل کے نیچے لکیر لگائیں۔'],
      ['nouns', 'اسم پر دائرہ لگائیں۔'],
    ],
    'Rewrite Sentences': [
      ['alphabetical', 'الفاظ کو حروفِ تہجی کی ترتیب سے لکھیں۔'],
      ['arrange', 'الفاظ کو ترتیب دے کر جملہ بنائیں۔'],
    ],
    'Brief Answers': [['short', 'مختصر جواب دیں۔']],
    'Word Meanings': [['meanings', 'الفاظ کے معنی لکھیں۔']],
    'Word Sentences': [['sentences', 'ان الفاظ کو جملوں میں استعمال کریں۔']],
    'Comprehension Passage': [['read-answer', 'عبارت پڑھ کر سوالوں کے جواب دیں۔']],
    Rewriting: [['plural', 'واحد سے جمع بنائیں۔'], ['opposite', 'الفاظ کے متضاد لکھیں۔']],
    'Story Completion': [['order-story', 'جملوں کو ترتیب دے کر کہانی مکمل کریں۔']],
    'Simple Writing': [['five-sentences', 'دیے گئے عنوان پر پانچ جملے لکھیں۔']],
  },
  '3-5': {
    MCQs: [['choose', 'درست جواب پر دائرہ لگائیں۔']],
    'True/False': [['true-false', 'درست یا غلط لکھیں۔']],
    'Fill in the Blanks': [['blanks', 'خالی جگہ پُر کریں۔']],
    'Match the Column': [
      ['match', 'کالم (الف) کو کالم (ب) سے ملائیں۔'],
      ['opposites', 'الفاظ کو ان کے متضاد سے ملائیں۔'],
    ],
    'Circle the Correct Answer': [
      ['verbs', 'جملوں میں فعل کے نیچے لکیر لگائیں۔'],
      ['nouns', 'اسم پر دائرہ لگائیں۔'],
    ],
    'Rewrite Sentences': [
      ['as-directed', 'ہدایت کے مطابق جملے دوبارہ لکھیں۔'],
      ['past-tense', 'جملوں کو زمانہ ماضی میں تبدیل کریں۔'],
      ['arrange', 'الفاظ کو ترتیب دے کر جملہ بنائیں۔'],
    ],
    'Brief Answers': [['short', 'مختصر جواب دیں۔']],
    'Word Meanings': [['meanings', 'الفاظ کے معنی لکھیں۔']],
    'Word Sentences': [['sentences', 'ان الفاظ کو جملوں میں استعمال کریں۔']],
    'Comprehension Passage': [['read-answer', 'عبارت پڑھ کر سوالوں کے جواب دیں۔']],
    'Story Writing': [['clues', 'دیے گئے اشاروں کی مدد سے کہانی لکھیں۔']],
    'Letter Writing': [['letter-friend', 'اپنے دوست کے نام خط لکھیں۔']],
    'Application Writing': [['leave', 'رخصت کے لیے درخواست لکھیں۔']],
    'Essay Writing': [['essay', 'دیے گئے عنوان پر مضمون لکھیں۔']],
    'Paragraph Writing': [['paragraph', 'دیے گئے عنوان پر پیراگراف لکھیں۔']],
  },
};

const MATHS = {
  '1-5': {
    MCQs: [['choose', 'Choose the correct answer.']],
    'Fill in the Blanks': [
      ['blanks', 'Fill in the blanks.'],
      ['compare', 'Put <, > or = in the boxes.'],
    ],
    'True/False': [['true-false', 'Write True or False.']],
    'Match the Column': [['match-ab', 'Match column A with column B.']],
    Sequences: [
      ['pattern', 'Complete the pattern.'],
      ['missing-numbers', 'Count on and write the missing numbers.'],
    ],
    'Short Questions': [
      ['solve', 'Solve.'],
      ['show-working', 'Solve and show your working.'],
      ['in-words', 'Write the numbers in words.'],
    ],
    'Restricted Response Question': [['explain', 'Solve and explain your answer.']],
    'Word Problems': [
      ['read-solve', 'Read the problem and solve it.'],
      ['with-unit', 'Read the problem and solve it. Write the answer with its unit.'],
    ],
    'Graphs & Geometric Problems': [
      ['bar-graph', 'Draw a bar graph from the table.'],
      ['draw-shape', 'Draw the shape and label its sides.'],
    ],
  },
};

const SCIENCE = {
  '1-5': {
    MCQs: [['choose', 'Choose the correct answer.']],
    MSQs: [['tick-all', 'Tick all the correct answers.']],
    'True/False': [
      ['true-false', 'Write True or False.'],
      ['correct-false', 'Write True or False. Correct the false sentences.'],
    ],
    'Fill in the Blanks': [['blanks', 'Fill in the blanks.']],
    'Brief Answers': [
      ['two-three', 'Answer in two or three sentences.'],
      ['give-reason', 'Give a reason.'],
      ['differences', 'Write two differences between the two.'],
    ],
    'Flow Chart': [
      ['food-chain', 'Make a food chain from the living things given.'],
      ['complete-flow', 'Complete the flow chart.'],
    ],
    'Mind Map': [['mind-map', 'Make a mind map of the topic.']],
    'Logical Reasoning': [['why', 'Think and answer: why does this happen?']],
  },
};

module.exports = { BANK: { english: ENGLISH, urdu: URDU, maths: MATHS, science: SCIENCE } };
