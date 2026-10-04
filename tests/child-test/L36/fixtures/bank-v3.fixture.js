'use strict';
/**
 * L36 test fixture: an item bank v3 in the CONTRACT §21.3 shape, for the conversation tests and the render
 * harness until L35's bank (bot/shared/data/child-test/item-bank.v3.json) lands. TEST DATA ONLY: the items
 * are placeholders (letters, short words, Core EGMA-shaped numbers) and the English script lines quote the
 * Core EGMA / EGRA Toolkit wording R9 collected (lanes/R9/item_specs.json); the Urdu lines are stand-ins.
 * Nothing here is shipped to a child.
 */

const s = (en, ur) => ({ en, ur });
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const LETTERS_UR = 'ا ب پ ت ٹ ث ج چ ح خ د ڈ ذ ر ڑ ز ژ س ش ص'.split(' ');
const LETTERS_EN = 'a b c d e f g h i j k l m n o p q r s t'.split(' ');

const STORY_UR = 'بلال اپنے ابو کے ساتھ دریا پر گیا۔ وہاں بہت سی مچھلیاں تھیں۔ بلال نے ایک بڑی مچھلی پکڑی۔ ابو بہت خوش ہوئے۔ شام کو وہ گھر واپس آئے۔';
const STORY_EN = 'Sara has a red ball. She plays with her friend Ali in the park. The ball goes into the water. Ali gets a long stick. They get the ball back and go home happy.';
const tokens = (text) => text.split(/\s+/).filter(Boolean);
function lines(tok, per) {
  const out = [];
  for (let i = 0, n = 1; i < tok.length; i += per, n += 1) out.push({ n, from: i, to: Math.min(i + per, tok.length) - 1 });
  return out;
}

function reading(lang) {
  const ur = lang === 'ur';
  const letters = ur ? LETTERS_UR : LETTERS_EN;
  const story = ur ? STORY_UR : STORY_EN;
  const tok = tokens(story);
  const q = (id, prompt, needs) => ({ id, prompt, type: 'literal', accept: ['x'], reject: [], rubric: 'x', needs_line: needs, source: 'fixture' });
  return {
    listening: {
      task: `${lang}.listening`, title: s('Listening', 'سن کر سمجھنا'), timed_s: null, items: [], practice: [],
      stop: { type: 'none' }, read_times: 2, story: { text: ur ? 'ایک دن ثنا بازار گئی۔ اس نے دو سیب خریدے۔' : 'One day Juma went to the market. He bought two mangoes.' },
      questions: [q(`${lang}-l-q1`, ur ? 'ثنا کہاں گئی؟' : 'Where did Juma go?'), q(`${lang}-l-q2`, ur ? 'اس نے کیا خریدا؟' : 'What did he buy?')],
      script: { intro: ur ? s('I am going to read you a short story twice.', 'ہم آپ کو ایک چھوٹی سی کہانی دو بار سنائیں گے۔ غور سے سنیں۔') : s('I am going to read you a short story aloud ONCE and then ask you some questions.', 'I am going to read you a short story aloud ONCE and then ask you some questions.'),
        questions_intro: ur ? s('Now answer these questions.', 'اب ان سوالوں کے جواب دیں۔') : s('Now I am going to ask you some questions about the story.', 'Now I am going to ask you some questions about the story.') },
      source: { items: 'fixture' }, quality: 'ai_review',
    },
    letters: {
      task: `${lang}.letters`, title: s('Letters', 'حروف'), timed_s: 60, per_row: 10, kind: 'names',
      items: range(100, (i) => letters[i % letters.length]), practice: letters.slice(0, 3),
      stop: { type: 'first_row' },
      script: {
        practice: ur ? s('Tell me the names of these letters.', 'ان حروف کے نام بتائیں۔') : s('Here is a page full of letters. Tell me the NAMES of as many letters as you can.', 'Here is a page full of letters. Tell me the NAMES of as many letters as you can.'),
        begin: ur ? s('Start.', 'شروع کریں') : s('Ready? Begin.', 'Ready? Begin.'),
        go_on: ur ? s('Please go on.', 'آگے پڑھیں') : s('Please go on.', 'Please go on.'),
        stop: ur ? s('Stop. Thank you.', 'بس، شکریہ') : s('Stop. Thank you.', 'Stop. Thank you.'),
      },
      source: { items: 'fixture' }, quality: 'provisional',
    },
    nonwords: ur
      ? { task: 'ur.nonwords', gap: true, reason: 'No official Urdu EGRA made-up-word list is published (fixture).', title: s('Made-up words', 'فرضی الفاظ') }
      : {
        task: 'en.nonwords', title: s('Made-up words', 'فرضی الفاظ'), timed_s: 60, per_row: 5,
        items: range(50, (i) => ['ut', 'dif', 'mab', 'kep', 'zom'][i % 5]), practice: ['ut', 'dif', 'mab'],
        stop: { type: 'first_row', n: 5 },
        script: { practice: s('Here are some made-up words. Read them as best you can.', 'Here are some made-up words. Read them as best you can.'),
          begin: s('Ready? Begin.', 'Ready? Begin.'), go_on: s('Please go on.', 'Please go on.'), stop: s('Stop. Thank you.', 'Stop. Thank you.') },
        source: { items: 'fixture' }, quality: 'provisional',
      },
    words: {
      task: `${lang}.words`, title: s('Familiar words', 'جانے پہچانے الفاظ'), timed_s: 60, per_row: 5,
      items: range(50, (i) => (ur ? ['گھر', 'پانی', 'ماں', 'کتاب', 'سکول'] : ['cat', 'run', 'big', 'sun', 'red'])[i % 5]),
      practice: ur ? ['گھر', 'پانی', 'ماں'] : ['cat', 'run', 'big'], stop: { type: 'first_row', n: 5 },
      script: {
        practice: ur ? s('Read these words.', 'یہ الفاظ پڑھیں۔') : s('Here are some words. Read me as many as you can.', 'Here are some words. Read me as many as you can.'),
        begin: ur ? s('Start.', 'شروع کریں') : s('Ready? Begin.', 'Ready? Begin.'),
        go_on: ur ? s('Please go on.', 'آگے پڑھیں') : s('Please go on.', 'Please go on.'),
        stop: ur ? s('Stop. Thank you.', 'بس، شکریہ') : s('Stop. Thank you.', 'Stop. Thank you.'),
      },
      source: { items: 'fixture' }, quality: 'ai',
    },
    story: {
      task: `${lang}.story`, title: s('Story', 'کہانی'), timed_s: 60, items: tok, practice: [],
      stop: { type: 'first_line' },
      story: { text: story, lines: lines(tok, 8), tokens: tok },
      questions: ur
        ? [q('ur-s-q1', 'بلال کس کے ساتھ دریا پر گیا؟', 1), q('ur-s-q2', 'بلال نے کیا پکڑا؟', 2), q('ur-s-q3', 'وہ گھر کب آئے؟', 3)]
        : [q('en-s-q1', 'What colour is the ball?', 1), q('en-s-q2', 'Where does the ball go?', 2), q('en-s-q3', 'How did they feel?', 3)],
      script: {
        begin: ur ? s('Read this story aloud. Start.', 'یہ کہانی اونچی آواز میں پڑھیں۔ اب شروع کریں') : s('Please read this story aloud. Ready? Begin.', 'Please read this story aloud. Ready? Begin.'),
        go_on: ur ? s('Please go on.', 'آگے پڑھیں') : s('Please go on.', 'Please go on.'),
        stop: ur ? s('Stop. Thank you.', 'بس، شکریہ') : s('Stop. Thank you.', 'Stop. Thank you.'),
        questions_intro: ur ? s('Now some questions.', 'اب کہانی کے بارے میں کچھ سوال') : s('Now I am going to ask you a few questions about the story.', 'Now I am going to ask you a few questions about the story.'),
      },
      source: { items: 'fixture' }, quality: 'ai_review',
    },
  };
}

const U = (en, ur) => s(en, ur);
const GO_ON = U('Go on.', 'اگلا');
const STOP = U('Stop. Thank you.', 'بس، شکریہ');

function maths(grade) {
  const add = (n, max) => range(n, (i) => ({ a: (i % max) + 1, b: ((i * 3) % max) + 1, answer: (i % max) + 1 + ((i * 3) % max) + 1 }));
  return {
    number_id: { task: 'ma.number_id', title: U('Number identification', 'نمبر پہچاننا'), timed_s: 60, per_row: 5,
      items: range(20, (i) => String([2, 9, 12, 30, 22, 45, 39, 23, 48, 91, 33, 74, 87, 65, 108, 245, 587, 731, 989, 403][i])), practice: [],
      stop: { type: 'none' },
      script: { begin: U('Here are some numbers. Point to each number and tell me what it is. Start.', 'یہ کچھ نمبر ہیں۔ ہر نمبر پر انگلی رکھ کر بتائیں کہ یہ کون سا نمبر ہے۔ شروع کریں'), go_on: GO_ON, stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    discrimination: { task: 'ma.discrimination', title: U('Which is bigger', 'کون سا بڑا ہے'), timed_s: null,
      items: range(10, (i) => ({ a: 7 + i * (grade === 5 ? 140 : 9), b: 5 + i * (grade === 5 ? 150 : 8), answer: Math.max(7 + i, 5 + i) })),
      practice: [{ a: 8, b: 4, answer: 8 }, { a: 10, b: 12, answer: 12 }], stop: { type: 'consecutive_errors', n: 4 },
      script: { begin: U('Look at these numbers. Tell me which number is bigger.', 'ان نمبروں کو دیکھیں۔ بتائیں کون سا نمبر بڑا ہے۔'), ask: U('Which number is bigger?', 'کون سا نمبر بڑا ہے؟'), stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    missing: { task: 'ma.missing', title: U('Missing number', 'گمشدہ نمبر'), timed_s: null,
      items: range(10, (i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 })), practice: [{ seq: [1, 2, null, 4], answer: 3 }],
      stop: { type: 'consecutive_errors', n: 4 },
      script: { begin: U('Here are some numbers. One number is missing. Tell me the number that goes here.', 'یہاں کچھ نمبر ہیں۔ ایک نمبر غائب ہے۔ بتائیں یہاں کون سا نمبر آئے گا۔'), ask: U('What number goes here?', 'یہاں کون سا نمبر آئے گا؟'), stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    add1: { task: 'ma.add1', title: U('Addition', 'جمع'), timed_s: 60, per_row: 5, items: add(20, 9), practice: [],
      stop: { type: 'none' },
      script: { begin: U('Here are some addition problems. Say the answer for each problem. Start here.', 'یہ جمع کے سوال ہیں۔ ہر سوال کا جواب بتائیں۔ یہاں سے شروع کریں'), go_on: GO_ON, stop: STOP },
      source: { items: 'fixture' }, quality: 'ai' },
    sub1: { task: 'ma.sub1', title: U('Subtraction', 'تفریق'), timed_s: 60, per_row: 5,
      items: add(20, 9).map((x) => ({ a: x.answer, b: x.b, answer: x.a })), practice: [], stop: { type: 'none' },
      script: { begin: U('Here are some subtraction problems. Say the answer for each problem. Start here.', 'یہ تفریق کے سوال ہیں۔ ہر سوال کا جواب بتائیں۔ یہاں سے شروع کریں'), go_on: GO_ON, stop: STOP },
      source: { items: 'fixture' }, quality: 'ai' },
    add2: { task: 'ma.add2', title: U('Harder addition', 'مشکل جمع'), timed_s: null, items: add(5, 9).map((x) => ({ a: x.a + 10, b: x.b + 3, answer: x.a + x.b + 13 })), practice: [],
      stop: { type: 'consecutive_errors', n: 4 },
      script: { begin: U('Here are some harder addition problems. You can use the paper and pencil.', 'یہ کچھ مشکل جمع کے سوال ہیں۔ آپ کاغذ اور پنسل استعمال کر سکتے ہیں۔'), ask: U('What is the answer?', 'اس کا جواب کیا ہے؟'), stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    sub2: { task: 'ma.sub2', title: U('Harder subtraction', 'مشکل تفریق'), timed_s: null, items: add(5, 9).map((x) => ({ a: x.answer + 20, b: x.b + 3, answer: x.answer + 17 - x.b })), practice: [],
      stop: { type: 'consecutive_errors', n: 4 },
      script: { begin: U('Here are some harder subtraction problems. You can use the paper and pencil.', 'یہ کچھ مشکل تفریق کے سوال ہیں۔ آپ کاغذ اور پنسل استعمال کر سکتے ہیں۔'), ask: U('What is the answer?', 'اس کا جواب کیا ہے؟'), stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    word_problems: { task: 'ma.word_problems', title: U('Word problems', 'عبارتی سوال'), timed_s: null,
      items: [
        { prompt_ur: 'بس میں ۳ بچے ہیں۔ ۲ اور بچے بس میں آ جاتے ہیں۔ اب بس میں کتنے بچے ہیں؟', prompt_en: 'There are 3 children on the bus. 2 more get on. How many children are on the bus now?', answer: 5, type: 'change_add' },
        { prompt_ur: 'آپ کے پاس ۶ سیب ہیں۔ آپ ۲ سیب کھا لیتے ہیں۔ کتنے سیب باقی ہیں؟', prompt_en: 'You have 6 apples. You eat 2. How many are left?', answer: 4, type: 'change_sub' },
      ],
      practice: [], stop: { type: 'consecutive_errors', n: 4 },
      script: { intro: U('I have some problems for you. You can use these things to help you. Listen carefully to each problem.', 'میرے پاس آپ کے لیے کچھ سوال ہیں۔ آپ ان چیزوں سے مدد لے سکتے ہیں۔ ہر سوال غور سے سنیں۔'), stop: STOP },
      source: { items: 'fixture' }, quality: 'ai_review' },
    skip_level2_if_level1_zero: true,
  };
}

function bankV3() {
  return {
    version: 'child-test-items-v3', sources: { fixture: { title: 'L36 test fixture', url: '', pages: '' } },
    sets: { A: { term: s('Term 1', 'پہلی ٹرم'), reading: { ur: reading('ur'), en: reading('en') }, maths: { 3: maths(3), 5: maths(5) } } },
  };
}

module.exports = { bankV3 };
