/**
 * Urdu board-pattern papers: the Section A give-aways a local run with the reader on still printed,
 * each on its own recorded paper.
 *
 * (a) Q1 asks the meaning of an idiom Q5 asks the child to use, in another verb form: «دھوم مچ
 *     جانا» کا کیا مطلب ہے؟ beside Q5's «دھوم مچانا».
 * (b) Another Q1 item's OPTION prints a key of two words or more as a fact: «سدرہ نے … کیا
 *     بنایا؟ → تھیڑ کمپنی» beside «… کس بات کی اجازت مانگی؟» with «ب) سدرہ کی تھیڑ کمپنی بند کرنے کی».
 * (c) The reader's evidence check keeps the two by-meaning shapes: a Q6 verse line that answers by
 *     sense, and a stem that explains its own idiom. (The prompt names both; this locks the filter.)
 *
 * The recorded papers are local replies (content only), laid out as printed.
 */

const fs = require('fs');
const path = require('path');

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Reader = require('../../bot/shared/services/assessment/fde-reader');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r17-urdu-${name.startsWith('sandbox') ? name : `local-${name}`}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const lay = (paper, reasked) => applyLayout(clone({ unseen: paper.unseen }), U, paper._scope, { reasked });
const recorded = (paper, re) => items(paper, 'urdu.A.Q1').find((q) => re.test(q.question));

describe('(a) a Q1 meaning item on a Q5 idiom in another verb form is held', () => {
  const ch3 = read('chapters3');
  const idiom = recorded(ch3, /دھوم مچ جانا/);

  test('the recorded pair is on the paper as given', () => {
    expect(idiom.answer).toBe('د) بہت مشہور ہو جانا');
    expect(items(ch3, 'urdu.C.Q5').flatMap((q) => q.words || [])).toContain('دھوم مچانا');
  });

  test('chapters_3 Q1 ۱۳ «دھوم مچ جانا» کا مطلب does not print beside Q5 «دھوم مچانا», before or after the re-ask', () => {
    expect(q1Stems(lay(ch3, false).examJson)).not.toContain(idiom.question);
    expect(q1Stems(lay(ch3, true).examJson)).not.toContain(idiom.question);
  });

  test('the same item stays when Q5 sets another idiom on the same noun', () => {
    const exam = clone(ch3);
    const q5 = items(exam, 'urdu.C.Q5').find((q) => Array.isArray(q.words) && q.words.includes('دھوم مچانا'));
    q5.words = q5.words.map((w) => (w === 'دھوم مچانا' ? 'دھوم دھام' : w));
    expect(q1Stems(lay(exam, false).examJson)).toContain(idiom.question);
  });

  test('a Q1 idiom on another noun with the same verb stays («شور مچ جانا» beside «دھوم مچانا»)', () => {
    const exam = clone(ch3);
    const q = items(exam, 'urdu.A.Q1').find((x) => x.question === idiom.question);
    q.question = 'محاورے «شور مچ جانا» کا کیا مطلب ہے؟';
    expect(q1Stems(lay(exam, false).examJson)).toContain(q.question);
  });
});

describe('(b) a Q1 key of two words or more printed in another Q1 item\'s option is held', () => {
  const ch4 = read('chapters4');
  const made = recorded(ch4, /کیا بنایا؟/);
  const asks = recorded(ch4, /اجازت مانگی/);

  test('the recorded pair is on the paper as given', () => {
    expect(made.answer).toBe('ج) تھیڑ کمپنی');
    expect(asks.options).toContain('ب) سدرہ کی تھیڑ کمپنی بند کرنے کی');
  });

  test('chapters_4: only one of Q1 ۲ «… کیا بنایا؟ → تھیڑ کمپنی» and Q1 ۱۷ (option «… تھیڑ کمپنی بند کرنے کی») prints', () => {
    for (const reasked of [false, true]) {
      const stems = q1Stems(lay(ch4, reasked).examJson);
      expect(stems.filter((s) => s === made.question || s === asks.question)).toHaveLength(1);
    }
  });

  test('a one-word key in another item\'s option stays', () => {
    const exam = clone(ch4);
    const a = items(exam, 'urdu.A.Q1').find((q) => q.question === asks.question);
    const m = items(exam, 'urdu.A.Q1').find((q) => q.question === made.question);
    m.answer = 'ج) تھیڑ';
    m.options = m.options.map((o) => (o === 'ج) تھیڑ کمپنی' ? 'ج) تھیڑ' : o));
    const stems = q1Stems(lay(exam, false).examJson);
    expect(stems).toContain(m.question);
    expect(stems).toContain(a.question);
  });

  test('a grammar item quoting its own example stays beside a sample-sentence option that uses its key (sandbox chapters_1 ۲۰ «اللہ کرے»)', () => {
    const ch1 = read('sandbox-chapters1');
    const fill = recorded(ch1, /ہم سب کو کامیابی ملے/);
    expect(fill.answer).toBe('ج) اللہ کرے');
    expect(recorded(ch1, /کون سا جملہ شکیہ ہے/).options).toContain('ج) اللہ کرے امتحان آسان ہو۔');
    for (const reasked of [false, true]) expect(q1Stems(lay(ch1, reasked).examJson)).toContain(fill.question);
  });

  test('an option that is only the key itself, saying nothing about it, stays', () => {
    const exam = clone(ch4);
    const a = items(exam, 'urdu.A.Q1').find((q) => q.question === asks.question);
    a.options = a.options.map((o) => (o.startsWith('ب)') ? 'ب) تھیڑ کمپنی' : o));
    const stems = q1Stems(lay(exam, false).examJson);
    expect(stems).toContain(made.question);
    expect(stems).toContain(a.question);
  });
});

describe('(c) the reader\'s evidence check keeps the by-meaning shapes', () => {
  const full4 = read('full4');
  const { labels, blocks } = Reader.buildReaderPrompt(clone({ unseen: full4.unseen }), U);
  const labelOf = (re) => [...labels.entries()].find(([, q]) => re.test(q.question))[0];
  const river = labelOf(/ندی انسانوں سے کیا چاہتی/);
  const gloss = labelOf(/چکنا چور ہونا/);

  test('a verse line that answers by sense, quoted from Q6, is a flag', () => {
    const flags = Reader.parseFlags({ candidates: [{ item: river, by: 'Q6', evidence: 'یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟', reason: 'by sense', given_away: true }] }, labels, null, blocks);
    expect(flags.map((f) => f.item)).toEqual([river]);
  });

  test('a stem that explains its own idiom, quoted from that stem, is a flag', () => {
    const flags = Reader.parseFlags({ candidates: [{ item: gloss, by: gloss, evidence: 'ٹکڑا ٹکڑا ہو جانا', reason: 'its stem glosses its key', given_away: true }] }, labels, null, blocks);
    expect(flags.map((f) => f.item)).toEqual([gloss]);
  });

  test('a by-sense flag whose line is not printed where it says is still dropped', () => {
    const flags = Reader.parseFlags({ candidates: [{ item: river, by: 'Q6', evidence: 'ندی چاہتی ہے کہ اسے صاف رکھا جائے', reason: 'by sense', given_away: true }] }, labels, null, blocks);
    expect(flags).toEqual([]);
  });
});
