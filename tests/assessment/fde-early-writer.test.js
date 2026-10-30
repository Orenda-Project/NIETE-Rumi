/**
 * The Grade 1-2 paper writer (bd-5jmnfj.4.1), with the model and the service's
 * private helpers faked and the real layout, marking scheme and blueprint check:
 * every subject lays out whole with its real subject key, pictures and oral part;
 * a section short of pictures and an oral task with nothing written are each
 * asked once more; a second miss fails the paper with what was written.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { ORAL_SYSTEM } = require('../../bot/shared/services/assessment/fde-early-writer');
const { NO_PICTURES } = require('../../bot/shared/services/assessment/fde-early-prompt');
const { run, oralTree, slotOf1, items } = require('./helpers/early-writer-harness'); // the faked writer, shared with the v34 oral tests

test.each([[1, 'maths'], [1, 'english'], [1, 'urdu'], [1, 'general_knowledge'], [2, 'maths'], [2, 'english'], [2, 'urdu'], [2, 'general_knowledge']])(
  'Grade %i %s lays out whole, with its real subject, its pictures and its oral part', async (grade, key) => {
    const { P, d, calls, go } = run(grade, key);
    const out = await go();
    expect(out.examJson._layout.subject).toBe(key);
    expect(out.examJson._layout.total_marks).toBe(P.total_marks);
    expect(calls.sections.every((c) => !c.user.includes(NO_PICTURES))).toBe(true);
    const pics = items(out.examJson).filter((q) => q.picture);
    expect(pics.every((q) => q.picture.src)).toBe(true);
    if (P.sections.some((s) => s.slots.some((sl) => sl.picture))) expect(pics.length).toBeGreaterThan(0);
    if (P.oral) expect(out.examJson._layout.oral.content.map((c) => c.id)).toEqual(P.oral.tasks.map((t) => t.id));
    else expect(out.examJson._layout.oral).toBeUndefined();
    expect(out.examJson._layout.blueprint).toBeDefined();
    expect(out).toEqual(expect.objectContaining({ chapterTitle: null, pageReference: '1-50', questionCount: 1 }));
    expect(d.writeSection).toHaveBeenCalledTimes(P.sections.length + (P.oral ? 1 : 0));
  });

test('the oral part is asked with its own system prompt, beside the sections', async () => {
  const { calls, go } = run(1, 'english');
  await go();
  expect(calls.oral[0][0].content).toBe(ORAL_SYSTEM);
});

test('a section short of a picture is asked once more and the second reply fills it', async () => {
  const { calls, go } = run(1, 'maths', { replies: { A: [{ noPicture: ['g1.maths.A.Q3'] }] } });
  const out = await go();
  expect(calls.sections.filter((c) => c.id === 'A')).toHaveLength(2);
  expect(calls.sections.filter((c) => c.id === 'B')).toHaveLength(1);
  expect(items(out.examJson).filter((q) => q.slot === 'g1.maths.A.Q3').every((q) => q.picture && q.picture.src)).toBe(true);
});

test('a section still short of a picture fails the paper with what was written', async () => {
  const miss = { noPicture: ['g1.maths.B.Q7'] };
  const { go } = run(1, 'maths', { replies: { B: [miss, miss] } });
  const err = await go().catch((e) => e);
  expect(err.code).toBe('PATTERN_SHORT_SLOT');
  expect(err.shortfall).toEqual([{ slot: 'g1.maths.B.Q7', reason: 'picture' }]);
  expect(err.examJson).toBeDefined();
  expect(err.model).toBe('test/model');
});

test('an oral task with nothing written is asked once more; the first reply\'s tasks are kept', async () => {
  const P = Patterns.get('fde_g1_2026').subjects.english;
  const { calls, go } = run(1, 'english', { oralReplies: [oralTree(P.oral, ['speaking']), oralTree(P.oral)] });
  const out = await go();
  expect(calls.oral).toHaveLength(2);
  expect(calls.oral[1][1].content).toContain('speaking');
  expect(out.examJson._layout.oral.content.map((c) => c.id)).toEqual(['listening', 'speaking', 'read_aloud']);
});

test('an oral task still empty after its re-ask fails the paper ORAL_SHORT', async () => {
  const P = Patterns.get('fde_g1_2026').subjects.english;
  const half = oralTree(P.oral, ['read_aloud']);
  const { go } = run(1, 'english', { oralReplies: [half, half] });
  const err = await go().catch((e) => e);
  expect(err.code).toBe('ORAL_SHORT');
  expect(err.missing).toEqual(['read_aloud']);
});

test('a picture that cannot be drawn fails the paper, keeping what was written', async () => {
  const boom = jest.fn(async () => { throw Object.assign(new Error('A picture on the paper could not be drawn.'), { code: 'PICTURE_FAILED' }); });
  const { go } = run(1, 'maths', { pictures: boom });
  const err = await go().catch((e) => e);
  expect(err.code).toBe('PICTURE_FAILED');
  expect(err.examJson._layout.subject).toBe('maths');
  expect(err.model).toBe('test/model');
});

// Amena, 23 Oct 2026: "For grade 1, its the same pictures in the whole paper" (bd-5jmnfj.4.27).
test('a section whose picture repeats an earlier question is asked once more, told the pictures taken', async () => {
  const { calls, go } = run(1, 'english', { replies: { C: [{ names: { 'g1.english.C.Q11': ['cat'] } }] , A: [{ names: { 'g1.english.A.Q1': ['cat'] } }] } });
  const out = await go();
  expect(calls.sections.filter((c) => c.id === 'A')).toHaveLength(1);
  const c = calls.sections.filter((x) => x.id === 'C');
  expect(c).toHaveLength(2);
  expect(c[1].user).toMatch(/already on this paper/);
  expect(c[1].user).toMatch(/\bcat\b/);
  const cats = items(out.examJson).filter((q) => q.picture && q.picture.name === 'cat');
  expect(cats.map((q) => q.slot)).toEqual(['g1.english.A.Q1']);
});

test('two questions in one section showing one thing: that section is re-asked, told which items repeat', async () => {
  const { calls, go } = run(1, 'english', { replies: { A: [{ names: { 'g1.english.A.Q1': ['cat'], 'g1.english.A.Q4': ['cat'] } }] } });
  await go();
  const a = calls.sections.filter((x) => x.id === 'A');
  expect(a).toHaveLength(2);
  expect(a[1].user).toMatch(/\bcat\b/);
  expect(a[1].user).toMatch(/different word/i);
});

test('a repeat left after the re-ask and one more ask is logged and the paper still comes back', async () => {
  const again = { names: { 'g1.english.C.Q11': ['cat'] } };
  const { d, go } = run(1, 'english', { replies: { A: [{ names: { 'g1.english.A.Q1': ['cat'] } }], C: [again, again, again] } }); // the last reply is the one extra ask (bd-5jmnfj.4.58.2)
  const out = await go();
  expect(out.examJson).toBeDefined();
  expect(d.logToFile).toHaveBeenCalledWith('[assessment] repeated pictures', expect.objectContaining({
    repeated: [{ slot: 'g1.english.C.Q11', reason: 'repeat', pictures: ['cat'] }],
  }));
});

// v12 G2 English Q10 iv: the bird is above the tree, but the child may write only in, on, under, near or behind (bd-5jmnfj.4.22).
const above = { keys: { 'g2.english.B.Q10': [{ question: 'The bird is ____ the tree.', answer: 'above' }] } };

test('a section keyed off its own rule is asked once more, told the item and the rule', async () => {
  const { d, calls, go } = run(2, 'english', { replies: { B: [above] } });
  await go();
  const b = calls.sections.filter((c) => c.id === 'B');
  expect(b).toHaveLength(2);
  expect(b[1].user).toMatch(/The bird is ____ the tree\. → above/);
  expect(b[1].user).toMatch(/never above/i);
  expect(d.logToFile).not.toHaveBeenCalledWith('[assessment] answers off the rule', expect.anything());
});

// v20 G1 English: Section C was re-asked for Q12's repeated dog and cat; its new Q13 asked about a gift,
// and nothing checked the second reply (bd-5jmnfj.4.40).
const gift = { keys: { 'g1.english.C.Q13': [{ question: 'A child gets a gift from a friend. What will she say?' }] } };

test('a key off its rule in a re-asked reply is asked once more, and only that question is swapped in', async () => {
  const { d, calls, go } = run(1, 'english', { replies: {
    A: [{ names: { 'g1.english.A.Q1': ['cat'] } }], C: [{ names: { 'g1.english.C.Q11': ['cat'] } }, gift],
  } });
  const out = await go();
  const c = calls.sections.filter((x) => x.id === 'C');
  expect(c).toHaveLength(3);
  expect(c[2].user).toMatch(/gift from a friend/);
  expect(items(out.examJson).filter((q) => /gift/.test(q.question))).toHaveLength(0);
  expect(items(out.examJson).filter((q) => q.slot === 'g1.english.C.Q13')).toHaveLength(slotOf1('g1.english.C.Q13').generate);
  expect(items(out.examJson).filter((q) => q.picture && q.picture.name === 'cat').map((q) => q.slot)).toEqual(['g1.english.A.Q1']);
  expect(d.logToFile).not.toHaveBeenCalledWith('[assessment] answers off the rule', expect.anything());
});

test('a key off its rule after the re-ask is asked once more', async () => {
  const { calls, go } = run(2, 'english', { replies: { B: [above, above] } });
  await go();
  expect(calls.sections.filter((c) => c.id === 'B')).toHaveLength(3);
});

test('a key still off its rule after both re-asks is logged and the paper still comes back', async () => {
  const { d, go } = run(2, 'english', { replies: { B: [above, above, above] } });
  const out = await go();
  expect(out.examJson).toBeDefined();
  expect(d.logToFile).toHaveBeenCalledWith('[assessment] answers off the rule', expect.objectContaining({
    answers: [{ slot: 'g2.english.B.Q10', reason: 'answer', items: ['The bird is ____ the tree. → above'] }],
  }));
});

// v17 G2 GK asked the capital, the national animal and the root in two questions each: the sections
// were written at once, blind to each other (bd-5jmnfj.4.16).
test('sections are written in turn, each told what the earlier ones asked', async () => {
  const { P, d, calls, go } = run(2, 'general_knowledge');
  let running = 0;
  let most = 0;
  const write = d.writeSection.getMockImplementation();
  d.writeSection.mockImplementation(async (args) => {
    running += 1; most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 2));
    running -= 1;
    return write(args);
  });
  await go();
  expect(calls.sections.map((c) => c.id)).toEqual(P.sections.map((s) => s.id));
  expect(calls.sections[0].user).not.toMatch(/already asks/);
  expect(calls.sections[1].user).toMatch(/already asks/);
  expect(calls.sections[1].user).toContain('Question 1 for g2.general_knowledge.A.Q1 → 1');
  expect(most).toBeLessThanOrEqual(1 + (P.oral ? 1 : 0));
});

test('a re-asked section keeps the note of what the earlier sections asked', async () => {
  const { calls, go } = run(1, 'maths', { replies: { B: [{ noPicture: ['g1.maths.B.Q7'] }] } });
  await go();
  const b = calls.sections.filter((c) => c.id === 'B');
  expect(b).toHaveLength(2);
  expect(b[1].user).toMatch(/already asks/);
});

// v26 G2 Urdu Q1 iv: the who-said MCQ offered names the book dialogue does not hold (bd-5jmnfj.4.58.2).
const BOOK_URDU = 'غصیلا بھنورا: میں تم سے لڑائی کروں گا۔ تتلیا: میں تتلیا ہوں۔ ٹڈی: آؤ سب دوست بن جائیں۔ '.repeat(6);
const garbled = { keys: { 'g2.urdu.A.Q1': [{ question: 'لڑائی کے بعد کس نے سب کو دوست بننے کو کہا؟', options: ['الف) غصیلے کیڑے نے', 'ب) ٹڈی نے', 'ج) تگیا نے'], answer: 'الف) غصیلے کیڑے نے' }] } };

test('a who-said item with names the book text lacks is asked once more, told the item', async () => {
  const { calls, go } = run(2, 'urdu', { replies: { A: [garbled] }, book: BOOK_URDU });
  await go();
  const a = calls.sections.filter((c) => c.id === 'A');
  expect(a).toHaveLength(2);
  expect(a[1].user).toMatch(/تگیا/);
  expect(a[1].user).toMatch(/book text does not hold/);
});
