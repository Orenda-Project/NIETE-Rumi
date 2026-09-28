'use strict';
/**
 * The reply language for a child is decided in code, per turn, and the model is
 * only told the answer.
 *
 * An offline replay of real child turns showed that an instruction ("reply in
 * the language the child writes in") loses to the model's own earlier replies:
 * the model keeps the language of the chat, whatever the prompt says. So the
 * decision is made here, where it can be tested, and handed to the model.
 *
 *   Urdu script in the message              -> ur
 *   Latin text with clear English evidence  -> en
 *   Latin text with clear Roman-Urdu evidence -> ur (answered in Urdu script)
 *   no clear evidence (a letter, a number, a name, one word, a tie)
 *                                           -> the language of the bot's last reply
 *                                              in this chat, else the quiz language
 */
const {
  childMessageLanguage,
  replyTextLanguage,
  messageScript,
  decideChildReplyLanguage,
} = require('../../bot/shared/utils/child-reply-language');

describe('childMessageLanguage — what one child message says about language', () => {
  test.each([
    ['a single option letter', 'b', null],
    ['an option letter with a bracket', 'C)', null],
    ['a number', '7', null],
    ['a sum', '2+4', null],
    ['a name', 'Test Child', null],
    ['one word', 'photosynthesis', null],
    ['an empty message', '', null],
    ['Roman Urdu', 'mujhe samajh nahi aya', 'ur'],
    ['Roman Urdu with an English subject term', 'fractions kya hote hain', 'ur'],
    ['Roman Urdu with a homograph ("or" = aur)', 'or kya hai', 'ur'],
    ['English', 'What is the answer to this question', 'en'],
    ['English with a subject term', 'Can you explain photosynthesis', 'en'],
    ['Urdu script', 'یہ سوال سمجھ نہیں آیا', 'ur'],
    ['one Urdu-script word', 'جی', 'ur'],
    ['mixed Urdu script and English', 'photosynthesis کیا ہے', 'ur'],
    ['a tie', 'is hai', null],
  ])('%s', (_, text, expected) => {
    expect(childMessageLanguage(text)).toBe(expected);
  });
});

describe('replyTextLanguage — the language a stored bot reply is actually in', () => {
  test('Urdu script reply -> ur', () => {
    expect(replyTextLanguage('شاباش! اگلا سوال یہ ہے۔')).toBe('ur');
  });
  test('English reply -> en', () => {
    expect(replyTextLanguage('Great job! Here is the next question.')).toBe('en');
  });
  test('Roman Urdu reply -> ur (the chat was in Urdu, whatever the letters)', () => {
    expect(replyTextLanguage('Shabash! Aap ne sahi jawab diya hai, ab agla sawal karo')).toBe('ur');
  });
  test('an empty reply carries no language', () => {
    expect(replyTextLanguage('')).toBeNull();
  });
});

describe('messageScript — for the drift log', () => {
  test.each([
    ['یہ کیا ہے', 'urdu_script'],
    ['what is this', 'latin'],
    ['photosynthesis کیا ہے', 'mixed'],
    ['7', 'none'],
    ['', 'none'],
  ])('%s -> %s', (text, expected) => {
    expect(messageScript(text)).toBe(expected);
  });
});

describe('decideChildReplyLanguage — the per-turn decision', () => {
  const urduChat = [
    { role: 'user', content: 'mujhe fractions samjhao' },
    { role: 'assistant', content: 'ضرور! کسر ایک پورے کا حصہ ہوتی ہے۔ بتائیں 1/2 کیا ہے؟ a) آدھا b) پورا' },
  ];
  const englishChat = [
    { role: 'user', content: 'help me with fractions' },
    { role: 'assistant', content: 'Sure! A fraction is part of a whole. What is 1/2? a) half b) whole' },
  ];

  test('an en-quiz child who writes English gets English', () => {
    expect(decideChildReplyLanguage({ message: 'I do not understand this question', history: urduChat, quizLanguage: 'en' }))
      .toEqual({ language: 'en', source: 'message', messageScript: 'latin' });
  });

  test('an en-quiz child who writes Roman Urdu gets Urdu', () => {
    expect(decideChildReplyLanguage({ message: 'mujhe samajh nahi aya', history: englishChat, quizLanguage: 'en' }))
      .toEqual({ language: 'ur', source: 'message', messageScript: 'latin' });
  });

  test('a ur-quiz child who writes English gets English', () => {
    expect(decideChildReplyLanguage({ message: 'What is the answer', history: urduChat, quizLanguage: 'ur' }))
      .toMatchObject({ language: 'en', source: 'message' });
  });

  test('"b" in a chat that is in Urdu stays Urdu, even for an en-quiz child', () => {
    expect(decideChildReplyLanguage({ message: 'b', history: urduChat, quizLanguage: 'en' }))
      .toEqual({ language: 'ur', source: 'last_reply', messageScript: 'latin' });
  });

  test('"7" in a chat that is in English stays English, even for a ur-quiz child', () => {
    expect(decideChildReplyLanguage({ message: '7', history: englishChat, quizLanguage: 'ur' }))
      .toEqual({ language: 'en', source: 'last_reply', messageScript: 'none' });
  });

  test('the LAST reply decides, not an earlier one', () => {
    const history = [...englishChat, { role: 'user', content: 'urdu mein batao' }, urduChat[1]];
    expect(decideChildReplyLanguage({ message: 'b', history, quizLanguage: 'en' }).language).toBe('ur');
  });

  test('no signal and no earlier reply -> the quiz language', () => {
    expect(decideChildReplyLanguage({ message: 'Test Child', history: [], quizLanguage: 'ur' }))
      .toEqual({ language: 'ur', source: 'quiz', messageScript: 'latin' });
    expect(decideChildReplyLanguage({ message: 'b', history: [{ role: 'user', content: 'b' }], quizLanguage: 'en' }))
      .toMatchObject({ language: 'en', source: 'quiz' });
  });

  test('a missing history or quiz language never throws; the floor is English', () => {
    expect(decideChildReplyLanguage({ message: 'b' })).toMatchObject({ language: 'en', source: 'quiz' });
  });
});
