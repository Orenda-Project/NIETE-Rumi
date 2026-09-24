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

/**
 * bd-y7hst -- THE ORIGINAL GATE CATCHES 178 OF 335 SHIPPING ch9-10-build DOCS AND MISSES
 * BANNED TALK IN 225 MORE. Each case below is a REAL string pulled from that corpus
 * (10_Grades 1-5 LP Build, ch9-10-build, renders, each seg's docs folder, *.lp.json),
 * one per missed-vocabulary bucket the gap analysis found. These must be RED against the
 * pre-widening PEER_TALK list and GREEN after it.
 */
describe('bd-y7hst: the widened vocabulary catches corpus moves the original gate missed', () => {
  test.each([
    ['named pair protocol (Partner A/B) -- role label, not an indefinite article',
      'Partner A: "I point to ____. What is its opposite?" Partner B answers, then they swap.'],
    ['named pair protocol, spoken hand-off',
      'Partner A, tell Partner B: Where does the sentence stop?'],
    ['pair-check / partner-check -- named protocol, and here explicitly aloud',
      'Students complete the four p.132 answer lines independently on slates or in notebooks, ' +
      'then partner-check by reading each completed pair aloud. Teacher circulates and checks ' +
      'that each word is matched to its opposite.'],
    ['pair game -- named protocol pairing two children as opponents',
      'Fact-fluency pair game: Partner A flashes 1-5 fingers, Partner B says the number ' +
      'instantly with no counting one by one; swap after five turns each.'],
    ['tell your partner -- the negation-window dash bug, not a vocabulary gap: "not" belongs ' +
      'to the clause BEFORE the dash and must not suppress the instruction after it',
      'Now think of something YOU have done at home this week, but you\'re not sure exactly ' +
      'when - tell your partner one present-perfect sentence about it.'],
    ['turn to your partner -- colon-led prompt, no trailing talk verb',
      'Turn to your partner: can they BOTH be right? Why?'],
    ['think-pair-anything -- the protocol family beyond the literal "-share"',
      'Think-Pair-Check: for each of the 8 sections on page 241, Partner A states their answer ' +
      'and reasoning first, Partner B checks it against the page.'],
    ['whisper ... to your partner -- an addressee object beyond the original it/that/the-answer list',
      'First whisper your idea to your partner.'],
    ['whisper-count -- hyphenated compound the original fixed list did not anticipate',
      'Now whisper-count with your partner: 100, 200, 300, 400, 500.'],
    ['peer as the SUBJECT of a talk verb',
      'Recall: how did we measure length yesterday? (things lined up end to end, no gaps) -- ' +
      'peer says it together, then one pair shares aloud.'],
  ])('%s is refused', (_name, prompt) => {
    expect(peerFails(withGuidedPrompt(prompt)).length).toBeGreaterThan(0);
  });
});

/**
 * bd-y7hst ROUND 2 -- the coordinator reopened this bead over two disclosed-but-overruled
 * gaps: the "TALK-VERB ... with a partner" addressee form, and the circle/turn-taking
 * discussion family (including a child RESPONDING TO another child). Each case below is a
 * REAL string pulled from the ch9-10-build corpus, one per verb/construction the round-2
 * design covers. RED against the pre-round-2 PEER_TALK list, GREEN after it.
 */
describe('bd-y7hst round 2: talk-verb-with-a-partner and the circle/turn-taking family', () => {
  test.each([
    ['say ... with a partner',
      'Say one number bond for 90 with a partner.'],
    ['count ... with a partner',
      'Students count with a partner, explain the clue, and then give a choral answer.'],
    ['practise ... with a partner',
      'Create your own clock, then practise setting different times with a partner.'],
    ['read ... with a partner',
      'Read the numeral 1 with a partner.'],
    ['discuss ... with a partner -- a flexible gap the existing "discuss in pairs" entry does not reach',
      'Students first discuss each step with a partner, then contribute the calculation.'],
    ['share ... with a partner',
      'share ONE thing you learned in this chapter with a partner, then pass the smile by ' +
      'tapping their shoulder.'],
    ['check ... with a partner -- not whisper-prefixed, so not already caught',
      'Check with your partner: point to each word you encoded and read it aloud.'],
    ['compare ... with a partner',
      'Choose and solve 4 + 3, 4 + 4, or 3 + 2. Compare quietly with a partner.'],
    ['answer ... with a partner',
      'Then answer this question with your partner: \'Where do YOU see days, weeks, months, or years at home?\''],
    ['ask ... with a partner -- verb-mechanic coverage, no bare corpus instance found',
      'Ask your question with a partner before you answer alone.'],
    ['tell ... with a partner -- verb-mechanic coverage, no bare corpus instance found',
      'Tell the sentence with your partner, then write it.'],
    ['sit in a circle -- the coordinator\'s own cited g4_ch9 anchor',
      'Students sit in circles as instructed on pp.104-105. Each student shares one preferred ' +
      'dance from the poem and a reason, asks one information question, and responds to one ' +
      'peer with a thumbs up plus an explanation.'],
    ['sit in a circle with your classmates',
      'Sit in a circle with your classmates. One by one, share what dance from the poem you liked best.'],
    ['sit in SMALL circles -- the corpus also writes it this way, not just "a circle"',
      'In Activity 2, students sit in small circles, share a top season and a reason, nod while ' +
      'listening, wait until a friend is done speaking, and add to the chain.'],
    ['sit in small circles, period-separated from the trigger -- "Sit in small circles. Each ' +
      'person will share..."',
      'Sit in small circles. Each person will share a top season and why it is a favourite.'],
    ['in a circle, each student -- the coordinator\'s own example construction',
      'In a circle, each student takes a turn to answer before the next one speaks.'],
    ['circle with classmates, no governing "sit" verb -- corpus drops it entirely',
      'Form a new small circle with classmates who were not in your earlier circle. Each ' +
      'student tells the new group a top season and why it is a favourite.'],
    ['responds to one peer -- a child responding to ANOTHER CHILD, not the teacher or the class',
      'Each student shares one preferred dance from the poem and a reason, asks one information ' +
      'question, and responds to one peer with a thumbs up plus an explanation.'],
    ['replies to a classmate -- the same construction, "replies" not "responds"',
      'After listening to the first answer, the next child replies to a classmate with a reason.'],
  ])('%s is refused', (_name, prompt) => {
    expect(peerFails(withGuidedPrompt(prompt)).length).toBeGreaterThan(0);
  });
});

/**
 * bd-y7hst -- FALSE POSITIVES ARE THE MORE EXPENSIVE FAILURE. Widening vocabulary to catch the
 * 225 missed lessons must not touch the moves the rule explicitly protects: WRITTEN peer
 * exchange, choral response, write/walk/reveal, and a child answering the whole class or the
 * teacher. The five below are the mandated minimum; the rest are corpus near-misses the new
 * whisper/peer/pair-check patterns came close to snagging.
 */
describe('bd-y7hst: the widened vocabulary still passes the explicitly-allowed moves', () => {
  test.each([
    ['written peer exchange -- Chalk Talk, "write on a partner\'s answer" is legal',
      'Write one line on your partner\'s answer, then slide the copy back.'],
    ['round 2 MANDATED: written exchange, no talk verb -- "work" is not in the governed verb list',
      'Work with a partner\'s written answer in your copy.'],
    ['round 2: possessive exclusion tradeoff -- "your partner\'S" is a written artefact, not the ' +
      'addressee of a talk verb',
      'Compare your writing with your partner\'s, then both of you compare against the board.'],
    ['round 2: same possessive tradeoff, "quietly" reinforces it is a silent, written comparison',
      'Look at the two versions, then quietly compare with your partner\'s book.'],
    ['choral response -- the WHOLE CLASS says it together on a clap',
      'Write the word in your copy. When I clap, the whole class says it together and you tick or fix your own.'],
    ['write, walk, reveal',
      'Write, walk, reveal: you write, I walk and check, then we reveal.'],
    ['a child answering the WHOLE CLASS, not a classmate',
      'Hands up -- tell the class where you saw it.'],
    ['a child answering the TEACHER',
      'Tell me the sound you hear.'],
    ['a story character whispering -- not a classroom move',
      '"Stay right here, someone will find you," she whispered, her stomach feeling tight.'],
    ['the Whispering Wind circle game -- whisper is to the NEXT PLAYER in a circle, not "to/with a partner"',
      'Play the Whispering Wind game: sit in a circle, and the first player whispers this line ' +
      'so quietly that only the tone can be heard clearly by the next player.'],
    ['peer used for a differentiation role, not a talk act',
      'Record whether students could count sphere, cube, and cone characteristics without peer prompting.'],
    ['peer-check -- a SILENT written check, deliberately distinct from the banned pair-check / partner-check label',
      'Then peer-check for a capital letter, full stop, and phonetic spelling attempt.'],
  ])('%s stays clean', (_name, prompt) => {
    expect(peerFails(withGuidedPrompt(prompt))).toEqual([]);
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

/**
 * bd-yjmxh/bd-v2ikv -- TWO REAL URDU MISSES the list above still does not catch, both real
 * corpus strings pulled from ch9-10-build (not invented): g5_ch9/Urdu_seg7's warm-up item 1,
 * "'راہ گیر' لفظ کو دو اجزا میں توڑ کر اپنے ساتھی کو سنائیں۔" -- "اپنے ساتھی کو سنائیں" is
 * RECITE/TELL IT TO YOUR COMPANION, spoken peer-to-peer, banned; and g5_ch10/Urdu_seg6's
 * warm-up item 2, "پارٹنر کو بتائیں: ببلو کے صبر کا پیمانہ کیوں لبریز ہوا تھا؟" -- the
 * TRANSLITERATED English word "پارٹنر" (partner) told to, rather than ساتھی/جوڑی. Both are
 * the VERB-DIRECTED-AT-A-PEER construction (addressee + کو + a recite/tell verb), not the
 * bare noun -- "ساتھی"/"پارٹنر" alone appear innocently elsewhere in the corpus and must stay
 * clean (see the false-positive guard below). RED against the pre-fix PEER_TALK list.
 */
describe('bd-yjmxh/bd-v2ikv: two real Urdu misses -- recite/tell TO a companion, and transliterated پارٹنر', () => {
  test.each([
    ['recite/tell TO your companion -- g5_ch9/Urdu_seg7 warm-up item 1, verbatim',
      "'راہ گیر' لفظ کو دو اجزا میں توڑ کر اپنے ساتھی کو سنائیں۔"],
    ['transliterated پارٹنر, told to -- g5_ch10/Urdu_seg6 warm-up item 2, verbatim',
      'پارٹنر کو بتائیں: ببلو کے صبر کا پیمانہ کیوں لبریز ہوا تھا؟'],
  ])('%s is refused', (_name, prompt) => {
    expect(peerFails(withGuidedPrompt(prompt)).length).toBeGreaterThan(0);
  });
});

/**
 * SAFETY PROPERTY -- the operator's five explicitly-blessed legal moves must stay clean
 * through the Urdu widening above. These are re-asserted here, by the exact wording handed
 * down for this fix, rather than trusted to the pre-existing (mostly-English) coverage in
 * the false-positive describe block above.
 */
describe('SAFETY PROPERTY: the five operator-blessed moves stay clean after the Urdu widening', () => {
  test.each([
    ['written peer exchange -- write on a partner\'s answer, slide the copy back',
      'Write one line on your partner\'s answer, then slide the copy back.'],
    ['written peer exchange -- work with a partner\'s written answer',
      'Work with a partner\'s written answer in your copy.'],
    ['choral response on a clap -- tick or fix your own',
      'Write the word in your copy. When I clap, the whole class says it together and you tick or fix your own.'],
    ['a child answering the WHOLE CLASS, not a classmate',
      'Hands up -- tell the class where you saw it.'],
    ['choral reveal on a clap',
      'On a clap, the whole class reveals together.'],
  ])('%s stays clean', (_name, prompt) => {
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
      'circle / turn-taking discussion',
      'discussion circle',
      'discuss in pairs / with a partner',
      'elbow / shoulder / talking partner',
      'group discussion',
      'named pair protocol (Partner A/B)',
      'pair / partner / peer talk',
      'pair game',
      'pair-check / partner-check',
      'partner whisper',
      'peer (talk verb, subject form)',
      'responds to a classmate',
      'talk to a classmate',
      'talk verb with a partner',
      'tell a classmate',
      'think-pair-anything',
      'turn-and-talk',
      'unbounded queue',
      'whisper to a classmate',
      'ایک دوسرے سے بات (talk to each other)',
      'آپس میں بات (talk among yourselves)',
      'جوڑی میں بات (pair talk)',
      'زبانی ساتھی جانچ (partner checks aloud)',
      'ساتھی سے بات (talk to your partner)',
      'ساتھی کو سنانا/بتانا (recite/tell TO a companion)',
      'سرگوشی (whisper to a classmate)',
      'پارٹنر کو بتانا (transliterated partner, told to)',
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
