/**
 * Two right answers, one keyed (round 6 blockers, bd-5jmnfj.4.58.9.1): v35 G1 English Q9 iii «The little bird
 * can ___ sweet songs.» keyed sing while hear, from the same box, also fits (its common error said "Choosing
 * hear"); v35 G2 English Q10 v «The duck is ____ the tree.» keyed behind while near, in the printed list, is also
 * true. A match row that fits two Column B phrases is the same defect (set B, G3 GK Q2).
 */

const A = require('../../bot/shared/services/assessment/fde-accept-alternatives');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const BOX = ['cross', 'train', 'sing', 'wash', 'hear'];
const boxItem = (question, answer, common_error, extra = {}) => ({
  slot: 'g1.english.B.Q9', main_question: 'Fill in each blank with the correct word from the box.', question, answer, marks: 2,
  scheme: { points: [{ text: 'Correct word chosen from the box', marks: 2, kind: 'K' }], accept: [answer], common_error, ...extra },
});
const prepItem = (question, answer, common_error, extra = {}) => ({
  slot: 'g2.english.B.Q10', main_question: 'Look at the picture and fill in the blank with in, on, under, near or behind', question, answer, marks: 1,
  scheme: { points: [{ text: 'Correct word', marks: 1, kind: 'K' }], accept: [answer], common_error, ...extra },
});
const matchItem = (question, answer, extra = {}) => ({ slot: 'g3.gk.A.Q2', question, answer, marks: 1, scheme: { accept: [answer], ...extra } });

const P = { sections: [{ slots: [
  { slot: 'g1.english.B.Q9', type: 'Complete the Sentences' },
  { slot: 'g2.english.B.Q10', type: 'Prepositions' },
  { slot: 'g3.gk.A.Q2', type: 'Match Columns', shape: 'match' },
] }] };
const exam = (lists) => ({ seen: { english: lists } });

describe('choicesOf', () => {
  test('a word box gives its words', () => {
    const items = [{ ...boxItem('a', 'cross', ''), words: BOX }, boxItem('b', 'train', '')];
    expect(A.choicesOf(items[1], items, P.sections[0].slots[0])).toEqual(BOX);
  });
  test('a list in the instruction gives its words', () => {
    const q = prepItem('The duck is ____ the tree.', 'behind', '');
    expect(A.choicesOf(q, [q], P.sections[0].slots[1])).toEqual(['in', 'on', 'under', 'near', 'behind']);
  });
  test('a match slot gives every row\'s answer', () => {
    const items = [matchItem('cow', 'milk'), matchItem('hen', 'eggs'), matchItem('bee', 'honey')];
    expect(A.choicesOf(items[0], items, P.sections[0].slots[2])).toEqual(['milk', 'eggs', 'honey']);
  });
  test('an item with no list gives none', () => {
    expect(A.choicesOf({ question: 'Why?', answer: 'x' }, [], { type: 'Short Answer' })).toEqual([]);
  });
});

describe('alternativeShortfall', () => {
  test('flags the v35 G1 Q9 iii item whose common error names another box word bare', () => {
    const items = [{ ...boxItem('We look left and right before we ___ the road.', 'cross', 'Choosing a word that does not fit the sentence, such as train'), words: BOX },
      boxItem('The little bird can ___ sweet songs.', 'sing', 'Choosing hear')];
    const out = A.alternativeShortfall(exam({ 'Complete the Sentences': items }), P);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'g1.english.B.Q9', reason: 'answer' });
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0]).toMatch(/sweet songs/);
    expect(out[0].items[0]).toMatch(/hear/);
  });
  test('a common error that says the word does not fit, or names a class, is not flagged', () => {
    const items = [{ ...boxItem('We ride the ___ on Tuesday.', 'train', 'Choosing a verb such as sing'), words: BOX },
      boxItem('We ___ our hands.', 'wash', 'Choosing a word that does not make sense, like cross'),
      boxItem('We ___ with our ears.', 'hear', 'Writing sing instead of hear')];
    expect(A.alternativeShortfall(exam({ 'Complete the Sentences': items }), P)).toEqual([]);
  });
  test('flags a word box item whose writer listed a second fit not in accept', () => {
    const items = [{ ...boxItem('The bird can ___.', 'sing', 'Choosing a verb that does not fit', { also_fits: ['hear'] }), words: BOX }];
    const out = A.alternativeShortfall(exam({ 'Complete the Sentences': items }), P);
    expect(out[0].items[0]).toMatch(/hear/);
  });
  test('flags a match row whose writer listed a second Column B fit', () => {
    const items = [matchItem('cow', 'milk', { also_fits: ['eggs'] }), matchItem('hen', 'eggs'), matchItem('bee', 'honey')];
    const out = A.alternativeShortfall(exam({ 'Match Columns': items }), P);
    expect(out).toHaveLength(1);
    expect(out[0].slot).toBe('g3.gk.A.Q2');
  });
  test('flags a preposition item whose common error names another listed preposition bare (v34 «Writing near or under»)', () => {
    const items = [prepItem('The duck is ____ the tree.', 'behind', 'Writing near or under')];
    expect(A.alternativeShortfall(exam({ Prepositions: items }), P)).toHaveLength(1);
  });
  test('an error that says why the choice is wrong is not a second fit (v37 loop 4 G2 «Writes She, It or They for one boy.»)', () => {
    const items = [prepItem('The dog is ____ the table.', 'under', 'Writing on, because the dog is below the tabletop'),
      prepItem('The cat is ____ the box.', 'in', 'Writing on for a cat inside the box')];
    expect(A.alternativeShortfall(exam({ Prepositions: items }), P)).toEqual([]);
  });
  test('a reusable list item whose second fit is mended into accept (behind ⇒ near, also_fits) is not asked again', () => {
    const items = [prepItem('The duck is ____ the tree.', 'behind', 'Writing under instead of behind'),
      prepItem('The ball is ____ the chair.', 'under', '', { also_fits: ['near'] })];
    expect(A.alternativeShortfall(exam({ Prepositions: items }), P)).toEqual([]);
  });
  test('a candidate already in accept is not flagged, nor an Urdu common error, nor a slot outside the pattern', () => {
    const items = [{ ...boxItem('The bird can ___.', 'sing', 'Choosing hear'), words: BOX }];
    items[0].scheme.accept = ['sing', 'hear'];
    expect(A.alternativeShortfall(exam({ 'Complete the Sentences': items }), P)).toEqual([]);
    const ur = { slot: 'g1.urdu.B.Q5', words: ['دودھ', 'سورج'], question: '___', answer: 'دودھ', scheme: { accept: ['دودھ'], common_error: 'سورج لکھنا' } };
    expect(A.alternativeShortfall(exam({ x: [ur] }), { sections: [{ slots: [{ slot: 'g1.urdu.B.Q5', type: 'Complete the Sentences' }] }] })).toEqual([]);
    expect(A.alternativeShortfall(exam({ 'Complete the Sentences': items }), { sections: [] })).toEqual([]);
  });
  test('never throws on junk', () => {
    expect(A.alternativeShortfall(null, null)).toEqual([]);
    expect(A.alternativeShortfall({ seen: { x: { y: [null, 3, {}] } } }, P)).toEqual([]);
  });
});

describe('acceptAlternatives', () => {
  test('a reusable list item takes the other true choice into accept: behind also reads near (v35 G2 Q10 v)', () => {
    const q = prepItem('The duck is ____ the tree.', 'behind', 'Writing under instead of behind');
    const { examJson, notes } = A.acceptAlternatives(exam({ Prepositions: [q] }), P);
    expect(examJson.seen.english.Prepositions[0].scheme.accept).toEqual(['behind', 'near']);
    expect(notes).toHaveLength(1);
    expect(q.scheme.accept).toEqual(['behind']);
  });
  test('under also reads near: a shoe below and in front of the bed is near it (v37 G2 Q10 v)', () => {
    const q = prepItem('The shoe is ____ the bed.', 'under', 'Writing on instead of under');
    const out = A.acceptAlternatives(exam({ Prepositions: [q] }), P).examJson.seen.english.Prepositions[0];
    expect(out.scheme.accept).toEqual(['under', 'near']);
  });
  test('a reusable list item takes the writer\'s also_fits into accept, only listed choices', () => {
    const q = prepItem('The ball is ____ the chair.', 'under', '', { also_fits: ['near', 'beside'] });
    const out = A.acceptAlternatives(exam({ Prepositions: [q] }), P).examJson.seen.english.Prepositions[0];
    expect(out.scheme.accept).toEqual(['under', 'near']);
    expect(out.scheme.also_fits).toBeUndefined();
  });
  test('a word box or match item is not widened: the fit is asked again instead; also_fits is dropped from print', () => {
    const items = [{ ...boxItem('The bird can ___.', 'sing', '', { also_fits: ['hear'] }), words: BOX }];
    const out = A.acceptAlternatives(exam({ 'Complete the Sentences': items }), P).examJson.seen.english['Complete the Sentences'][0];
    expect(out.scheme.accept).toEqual(['sing']);
    expect(out.scheme.also_fits).toBeUndefined();
  });
  test('an item with nothing to add is returned as it was', () => {
    const q = prepItem('The apple is ____ the basket.', 'in', 'Writing on instead of in');
    const ex = exam({ Prepositions: [q] });
    const { examJson, notes } = A.acceptAlternatives(ex, P);
    expect(examJson.seen.english.Prepositions[0]).toBe(q);
    expect(notes).toEqual([]);
  });
  test('never throws on junk', () => {
    expect(A.acceptAlternatives(null, P).notes).toEqual([]);
  });
});

describe('the prompt asks for one fit', () => {
  test('ONE_FIT_RULE names the check and the also_fits field', () => {
    expect(A.ONE_FIT_RULE).toMatch(/also_fits/);
    expect(A.ONE_FIT_RULE).toMatch(/word box/);
  });
  test('a G5 section prompt carries it', () => {
    const S = Patterns.get('fde_g5_2027').subjects.english;
    const section = S.sections[0];
    const user = Gen.buildPatternUserPrompt({ grade: 5, subject: 'english', pageContent: 'Book text.', pageReference: '1-20',
      section, slots: section.slots, lang: S.medium, P: S, scope: { kind: 'fde', chapters: null, pages: null } });
    expect(user).toContain(A.ONE_FIT_RULE);
  });
});

describe('wiring', () => {
  test('keyShortfall (G1/G2) returns the two-answer flag', () => {
    const { keyShortfall } = require('../../bot/shared/services/assessment/fde-key-checks');
    const items = [{ ...boxItem('The little bird can ___ sweet songs.', 'sing', 'Choosing hear'), words: BOX }];
    const out = keyShortfall(exam({ 'Complete the Sentences': items }), P, '');
    expect(out.some((f) => f.items.some((l) => /hear/.test(l) && /sweet songs/.test(l)))).toBe(true);
  });
});
