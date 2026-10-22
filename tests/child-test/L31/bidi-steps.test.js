/**
 * L31 (bd-s1oo0.46.7) — the words the coach says to the child, laid out so a phone paints them in reading order
 * (language-protocol §9, shot_v2 05: "2. Say:« … اب » شروع کریں").
 *
 * Rule: in a message, every line the coach says in the OTHER script sits on its own line, wrapped in a
 * directional isolate with the guillemets INSIDE it (Urdu in an English message: RLI «…» PDI; English in an
 * Urdu message: LRI «…» PDI). A numbered question/problem carries its number in its own LTR isolate first.
 * Nothing else shares that line. Real: steps.js, the catalog, the item bank.
 */
const steps = require('../../../bot/shared/services/child-test/conversation/steps');

const RLI = '⁧'; const LRI = '⁦'; const PDI = '⁩';
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const CHILD = { displayName: 'Ayesha Khan', classLabel: 'Grade 3 - A', classShort: '3-A', grade: 3, section: 'A', teacherName: 'Saima Bibi' };

// One said line in an English message: indent, an optional numbered isolate, then RLI « … » PDI, nothing else.
const URDU_SAY_LINE = new RegExp(`^ *(?:${LRI}[①②③④⑤⑥]${PDI} )?${RLI}«[^${RLI}${LRI}${PDI}«»]+»${PDI}$`);
// One said line in an Urdu message: the same, LRI around the English.
const ENGLISH_SAY_LINE = new RegExp(`^ *(?:${LRI}[①②③④⑤⑥]${PDI} )?${LRI}«[^${RLI}${LRI}${PDI}«»]+»${PDI}$`);

/** Strip every isolated span (and isolate marks), so what is left is what shares the line's base direction. */
const outsideIsolates = (line) => line.replace(/[⁦-⁨][^⁩]*⁩/g, '');

const messages = (lang) => ({
  urdu: steps.stepMessage(lang, 'urdu', { name: 'Ayesha Khan', grade: 3, form: 'A' }),
  english: steps.stepMessage(lang, 'english', { name: 'Ayesha Khan', grade: 3, form: 'A' }),
  maths: steps.stepMessage(lang, 'maths', { name: 'Ayesha Khan', grade: 3, form: 'A' }),
  presence: steps.presenceBody(lang, { n: 1, total: 5, child: CHILD, greet: steps.greetFor(steps.bankFormFor(3, 'A')) }),
});

describe('English coach: every Urdu line the coach says is alone on its line, inside an RTL isolate', () => {
  const m = messages('en');
  test.each(['urdu', 'maths', 'presence'])('%s', (k) => {
    const urduLines = m[k].split('\n').filter((l) => ARABIC.test(l));
    expect(urduLines.length).toBeGreaterThan(0);
    for (const line of urduLines) expect(line).toMatch(URDU_SAY_LINE);
  });

  test('the Urdu story: start, go-on, stop, the question intro, the 3 questions, 2 reach anchors (L34) and the fallback are 10 said lines', () => {
    const said = m.urdu.split('\n').filter((l) => URDU_SAY_LINE.test(l));
    expect(said).toHaveLength(10);
    // questions numbered ① ② ③, each number in its own LTR isolate, never glued to the RTL run
    expect(said.filter((l) => l.includes(`${LRI}①${PDI} ${RLI}`))).toHaveLength(1);
    expect(said.filter((l) => l.includes(`${LRI}③${PDI} ${RLI}`))).toHaveLength(1);
  });

  test('maths: the two word problems are numbered said lines', () => {
    expect(m.maths).toContain(`${LRI}①${PDI} ${RLI}«`);
    expect(m.maths).toContain(`${LRI}②${PDI} ${RLI}«`);
  });

  test('the English story needs no isolate (all one direction) and keeps its words', () => {
    expect(m.english).not.toMatch(ARABIC);
    const start = steps.scriptFor('english', steps.bankFormFor(3, 'A')).start;
    expect(m.english.split('\n')).toContain(`   «${start}»`);
  });

  test('no English instruction text is left on a line with Urdu', () => {
    for (const line of [m.urdu, m.maths, m.presence].join('\n').split('\n').filter((l) => ARABIC.test(l))) {
      expect(outsideIsolates(line)).not.toMatch(LATIN);
    }
  });
});

describe('Urdu coach: English said lines are alone and LTR-isolated; Latin atoms are isolated', () => {
  const m = messages('ur');
  test('the English story: every line carrying English words is a said line in an LTR isolate', () => {
    const latinLines = m.english.split('\n').filter((l) => LATIN.test(outsideIsolates(l)) || /«[^»]*[A-Za-z]/.test(l));
    expect(latinLines.length).toBeGreaterThan(0);
    for (const line of latinLines) expect(line).toMatch(ENGLISH_SAY_LINE);
  });

  test.each(['urdu', 'english', 'maths', 'presence'])('%s: no bare Latin outside an isolate (1:05, A–D, 1–4)', (k) => {
    for (const line of m[k].split('\n')) expect(outsideIsolates(line)).not.toMatch(/[A-Za-z0-9]/);
  });
});
