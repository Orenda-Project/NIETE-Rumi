/**
 * bd-snkn32.44 — the You Do pair/group gate fired on words, not on pair work. In the bd-snkn32.40 measurement
 * (60 sandbox days) 9 days ended "Couldn't make it" on "You Do has pair or group work" in both rounds; every one was
 * the detector: "مل کر" (together) matched inside "مکمل کریں" (complete) and "شامل کر" (include), "in groups" matched
 * a maths question ("14 cookies packed in groups of 2"), "جوڑی" matched rhyming pairs (ہم آواز جوڑیاں). The model had
 * written each child alone in her book. The rule stays: You Do is each child alone, no peer talk.
 */
const { checkK5Rewrite, parseK5Reply } = require('../../bot/shared/services/lp-k5-own');

const script = (youDo) => ({
  goal: 'Name the parts of a plant.',
  meta: { day: 1 },
  hook: { warmUp: { teacherAsks: 'What do plants need?' } },
  iDo: { steps: [{ n: 1, say: 'Look at the picture on page 4.' }] },
  weDo: { action: 'In pairs, point to each part on page 4.' },
  youDo: { action: youDo },
  wrap: { exitOptions: [{ prompt: 'Name one part.' }] },
});
const make = { resources: ['textbook'] };
const reasons = (youDo) => checkK5Rewrite(script(), script(youDo), make).join('; ');

describe('You Do: what the measurement refused, which was each child alone', () => {
  it.each([
    'جملے مکمل کریں: الف۔ جھیل کینجھر کراچی سے ___',
    'جو بچہ اپنا کام مکمل کر لے وہ خاموشی سے اضافی سوال اکیلے حل کرے۔',
    'اپنی کہانی میں چوتھا اور پانچواں دن بھی شامل کر کے پانچ جملے لکھیں۔',
    'Q1 (p.168): 14 cookies packed in groups of 2 — how many packs?',
    'جو جلدی ختم کرے وہ پوری نظم کی ہم آواز جوڑیاں اپنی کاپی میں فہرست بنا لے۔',
    'گائے گی/سنائے گی اور ٹرائیں گے/آئیں گے — دو ہم آواز جوڑیاں۔',
    'مثلاً: بنٹی اُداس نہ ہوتی، یا دونوں مل کر کھیلتے رہتے۔',
    'ہر بچہ اکیلے اپنی کاپی میں کام کرے، کوئی ساتھی یا گروہ نہ بنے۔',
    'Each child works alone, not in pairs.',
  ])('passes "%s"', (youDo) => {
    expect(reasons(youDo)).toBe('');
  });
});

describe('You Do: real pair, group and peer work still refuses', () => {
  it.each([
    'Work in pairs to label the parts on page 5.',
    'In groups of four, label the parts on page 5.',
    'Put the children in groups of 4 to label page 5.',
    'Group work: label the parts on page 5.',
    'Label the parts with your partner.',
    'Tell your partner the name of each part.',
    'Turn to your neighbour and compare answers.',
    'Turn and talk: which part takes in water?',
    'جوڑیوں میں صفحہ 5 پر حصوں کے نام لکھیں۔',
    'بچے جوڑی بنا کر سوال حل کریں۔',
    'گروپ میں مل کر صفحہ 5 کے حصے لکھیں۔',
    'دو بچے مل کر سوال حل کریں۔',
    'اپنے ساتھی کو اپنا جواب بتائیں۔',
    'ساتھی کے ساتھ جواب ملائیں۔',
  ])('refuses "%s"', (youDo) => {
    expect(reasons(youDo)).toMatch(/You Do has pair or group work/);
  });

  it('the repair message quotes the whole offending line, not 60 characters of it', () => {
    const line = 'Each child first reads page 5 quietly, then finds the root, the stem and the leaf, and then works in pairs to label them.';
    expect(reasons(line)).toContain(`"${line}"`);
  });
});

describe('a reply that closed its JSON object one brace early is repaired here, not sent back', () => {
  // grade_4_english_ch7_seg3, both rounds: `…}]},"materials":[…]},"iDo":{…` — hook closed, then the plan.
  const plan = { hook: { steps: [{ n: 1 }] }, materials: ['book'], iDo: { steps: [] }, youDo: { a: 1 }, wrap: { b: 2 } };
  const broken = JSON.stringify(plan).replace('}]},"materials"', '}]}},"materials"');

  it('the broken text does not parse as it is', () => {
    expect(() => JSON.parse(broken)).toThrow();
  });

  it('parses to the whole plan', () => {
    const out = parseK5Reply('```json\n' + broken + '\n```');
    expect(out).toBeTruthy();
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['hook', 'iDo', 'youDo', 'wrap']));
  });

  it('a reply that is not a plan at all is still null', () => {
    expect(parseK5Reply('Sorry, I cannot do that.')).toBeNull();
    expect(parseK5Reply('[1, 2]')).toBeNull();
  });
});
