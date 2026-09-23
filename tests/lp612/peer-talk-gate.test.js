/**
 * bd-c5miz -- A BANNED MOVE MUST FAIL A GATE, NOT MERELY BE ABSENT FROM AN EXAMPLE.
 *
 * The schema's worked example for the warm-up strategy was
 * `'Prerequisite retrieval -- partner whisper'`. Partner whisper is a move the coaches
 * asked to have removed and the operator has since made the prerequisite standard:
 *
 *   *"why cant we add what we have set as rule? Coaches gave this feedback to remove
 *   partner whisper, what Ive said should now be the pre-req"*
 *
 * and the rule itself, in her words:
 *
 *   *"teachers dont let students talk to each other, that too when the class begins,
 *   neither in Guided Practice, how else can we do retrieval?"*
 *   *"In large classrooms, its just not possible to do so much in a class of 40+
 *   students ... all teachers have said they can do only 1 activity per LP, that is
 *   reasonable"*
 *
 * The distinction this suite exists to protect: TALK between students is banned;
 * WRITTEN exchange between students is not, and a child speaking to the whole class or
 * to the teacher is not. A naive ban on the word "partner" would refuse the corpus's own
 * Chalk Talk -- *"They write, slide the copy one place, write one line on a partner's
 * answer, slide it back."* -- which would be a regression, not a fix.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));
const { PEER_TALK, peerTalkDefects } = require(path.join(V, 'lib', 'peertalk.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

const LIVE = path.join(
  '/Users/amenaahmed/rumi/Rumi 10 April 2026',
  '10_Grades 1-5 LP Build', 'renders', 'g3-ch2-trio', 'o1', 'docs');

/** lint() returns { fails, warns }; a BLOCKING defect is in `fails`. */
const peerFails = (doc) => lint(doc, BASE).fails.filter((f) => f.startsWith('PEER_TALK'));

function withStrategy(strategy) {
  const doc = JSON.parse(raw);
  const intro = doc.sections.find((s) => s.id === 'introduction');
  intro.warmup = { items: [{ q: 'What is 8 + 2?', a: '10', kind: 'prerequisite' }], strategy };
  return doc;
}

/** The Guided Practice half of the rule: the We Do block's own prompt. */
function withGuidedPrompt(prompt) {
  const doc = JSON.parse(raw);
  const act = doc.sections.find((s) => s.id === 'activity');
  act.blocks.find((b) => b.type === 'faded_example').prompt = prompt;
  return doc;
}

describe('bd-c5miz: student-to-student TALK fails the gate', () => {
  test('the move the bead is named for -- partner whisper -- is refused', () => {
    const fails = peerFails(withStrategy('Prerequisite retrieval — partner whisper'));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.join(' ')).toMatch(/partner whisper/i);
  });

  test.each([
    ['turn-and-talk', 'Prerequisite retrieval — turn and talk'],
    ['think-pair-share', 'Prerequisite retrieval — think-pair-share'],
    ['pair talk', 'Prerequisite retrieval — pair talk'],
    ['elbow partner', 'Retrieval with your elbow partner'],
  ])('%s is refused in the warm-up strategy', (_name, strategy) => {
    expect(peerFails(withStrategy(strategy)).length).toBeGreaterThan(0);
  });

  test('GUIDED PRACTICE is scanned too -- the operator banned it there by name', () => {
    const fails = peerFails(withGuidedPrompt(
      'Solve row 1 together, then turn and talk to your partner about the answer.'));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails[0]).toMatch(/\/sections\/2\//);
  });

  test('an unbounded queue is refused -- 40+ children, one activity', () => {
    expect(peerFails(withGuidedPrompt(
      'Take answers from as many as time allows.')).length).toBeGreaterThan(0);
  });

  test('URDU is gated too -- a matcher that only reads English exempts every Urdu lesson', () => {
    // "In pairs, talk to your partner" -- with the harakat the Urdu corpus actually carries.
    expect(peerFails(withGuidedPrompt('جوڑی میں اَپنے ساتھی سے بات کریں۔')).length).toBeGreaterThan(0);
    expect(peerFails(withGuidedPrompt('ایک دوسرے سے بات کریں۔')).length).toBeGreaterThan(0);
  });
});

describe('bd-c5miz: the approved substitutes must still pass', () => {
  test.each([
    ['the live English corpus value', 'Prerequisite retrieval — write, walk, reveal'],
    ['the live Urdu corpus value', 'پیشگی مَعْلُومات کی بازْیافْت — لِکھو، گُھومو، ظاہِر کَرو'],
    ['choral reading, a child speaking to the WHOLE CLASS', 'پیشگی مَعْلُومات کی بازْیافْت — ہَم آواز پَڑھائی'],
    ['choral response, said in English', 'Prerequisite retrieval — choral response'],
  ])('%s passes', (_name, strategy) => {
    expect(peerFails(withStrategy(strategy))).toEqual([]);
  });

  test.each([
    ['Chalk Talk -- WRITTEN peer exchange, silently',
      'Chalk Talk, silent. They write, slide the copy one place, write one line on a partner\'s answer, slide it back. Nobody stands and nobody speaks.'],
    ['the corpus prohibition, which states the rule rather than breaking it',
      'Do not call out and do not tell a neighbour — WRITE the word in your copy.'],
    ['the same prohibition in the other corpus phrasing',
      'Nobody calls out and nobody talks to a neighbour. I ask, you think, you WRITE the answer.'],
    ['a written step shown to a partner on paper',
      'Write each subtraction step so your partner can see your thinking.'],
    ['the whole class answering together',
      'On the clap the whole class says "6 hundreds" together; each child ticks or corrects their own 600.'],
    ['a child answering the TEACHER',
      'Ask Sana to explain a regrouping; she answers you while the class listens.'],
    ['the Urdu silent exchange the corpus actually runs',
      'پھِر خاموش تبادلہ: ایک تالی پَر ہَر بچہ اَپنی کاپی ایک جَگہ آگے سَرکائے اَور ساتھی کی سَطْر پَر ایک سَطْر لِکھے۔'],
    ['the live English_seg5 Chalk Talk close -- a classmate\'s question, asked to the WHOLE CLASS',
      'Second clap, copies slide back, and each child reads what a classmate wrote on theirs. Then name three or four children to ask their CLASSMATE\'S question aloud, to the whole class, with you as the first to answer.'],
    ['the Urdu statement of the rule itself',
      'اُستانیاں جماعت کے آغاز پَر بچوں کو ایک دوسرے سے بات کَرنے کی اِجازت نہیں دیتیں۔'],
  ])('%s passes', (_name, prompt) => {
    expect(peerFails(withGuidedPrompt(prompt))).toEqual([]);
  });
});

describe('bd-c5miz: the vocabulary lives in ONE place and cannot drift', () => {
  test('every entry is a named, flagged pattern', () => {
    expect(PEER_TALK.length).toBeGreaterThan(0);
    for (const p of PEER_TALK) {
      expect(typeof p.name).toBe('string');
      expect(p.re instanceof RegExp).toBe(true);
      expect(['en', 'ur']).toContain(p.lang);
    }
  });

  test('the list is PINNED -- adding or dropping a banned move is a deliberate edit', () => {
    expect(PEER_TALK.map((p) => p.name).sort()).toEqual([
      'ask a classmate',
      'buzz groups',
      'discussion circle',
      'discuss in pairs / with a partner',
      'elbow / shoulder / talking partner',
      'group discussion',
      'pair / partner / peer talk',
      'partner whisper',
      'talk to a classmate',
      'tell a classmate',
      'think-pair-share',
      'turn-and-talk',
      'unbounded queue',
      'whisper to a classmate',
      'ایک دوسرے سے بات (talk to each other)',
      'آپس میں بات (talk among yourselves)',
      'جوڑی میں بات (pair talk)',
      'زبانی ساتھی جانچ (partner checks aloud)',
      'ساتھی سے بات (talk to your partner)',
      'سرگوشی (whisper to a classmate)',
    ].sort());
  });

  test('BOTH languages are covered -- an English-only gate would LOOK enforced', () => {
    const langs = new Set(PEER_TALK.map((p) => p.lang));
    expect(langs.has('en')).toBe(true);
    expect(langs.has('ur')).toBe(true);
  });

  test('the matcher reports WHICH move it found, so an author can fix it', () => {
    const hits = peerTalkDefects('Retrieval by partner whisper.');
    expect(hits.map((h) => h.name)).toContain('partner whisper');
  });
});

describe('bd-c5miz: the schema no longer advertises a banned move', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(V, 'schema', 'lp_doc.schema.json'), 'utf8'));
  const d = schema.properties.sections.items.properties.warmup.properties.strategy.description;

  // The description NAMES partner whisper -- as the thing that is refused, which is the point.
  // What it must never do again is offer it as the WORKED EXAMPLE, which is the quoted form.
  test('no worked example is a banned move', () => {
    // The `e.g.` clause -- everything the description offers an author to COPY, which ends
    // where the bd-c5miz rule statement begins.
    const examples = d.slice(d.indexOf('e.g.'), d.indexOf('bd-c5miz'));
    expect(examples).toMatch(/e\.g\./);
    expect(examples).not.toMatch(/partner whisper|turn.and.talk|think.pair.share|pair talk/i);
  });

  test('partner whisper appears only as the thing that is BANNED', () => {
    expect(d).toMatch(/No partner whisper/);
  });

  test('it states the rule, so the next authoring pass reads it', () => {
    expect(d).toMatch(/PEER_TALK/);
    expect(d).toMatch(/write, walk, reveal/i);
  });
});

describe('bd-c5miz: the 20 live G1-5 documents', () => {
  const docs = fs.readdirSync(LIVE).filter((f) => f.endsWith('.lp.json'));

  test('all 20 are present', () => {
    expect(docs.length).toBe(20);
  });

  test.each(docs)('%s carries no student-to-student talk', (f) => {
    const doc = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
    expect(lint(doc, path.join(LIVE, f)).fails.filter((x) => x.startsWith('PEER_TALK'))).toEqual([]);
  });
});
