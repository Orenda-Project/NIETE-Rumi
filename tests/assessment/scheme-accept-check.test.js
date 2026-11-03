/**
 * bd-5jmnfj.4.50.10 — a key whose accept list holds the very form its common
 * error describes. v22 G1 English Q8 printed "accept: running; run" beside
 * "common error: Writing run without ing": the teacher cannot follow both.
 *
 * Pure functions, no I/O. The items are the v22 G1 English Q8 rows, inline.
 */

const { dropContradictedAccepts } = require('../../bot/shared/services/assessment/scheme-accept-check');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const Patterns = require('../../bot/shared/services/assessment/patterns');

function actionWord(answer, accept, commonError) {
  return {
    slot: 'g1.english.B.Q8', lines: 1, marks: 1, answer, blooms: 'Apply',
    question: 'What is the child doing?',
    main_question: 'Look at the picture. Write the -ing word for what the child is doing.',
    scheme: {
      accept,
      points: [{ kind: 'A', text: 'Correct -ing action word', marks: 1 }],
      checked: null,
      common_error: commonError,
    },
  };
}

function g1English(items) {
  const P = Patterns.get('fde_g1_2026');
  return {
    _layout: { v: 2, subject: 'english', sections: P.subjects.english.sections },
    unseen: { subjective: { 'Action Words': items } },
  };
}

describe('dropContradictedAccepts', () => {
  test('drops the base verb the common error names', () => {
    const r = dropContradictedAccepts(['running', 'run'], 'running', 'Writing run without ing or misspelling runing');
    expect(r.accept).toEqual(['running']);
    expect(r.dropped).toEqual(['run']);
  });

  test('keeps an alternative the error does not name', () => {
    const r = dropContradictedAccepts(['swimming', 'swim'], 'swimming', 'Writing swiming with one m');
    expect(r.accept).toEqual(['swimming', 'swim']);
  });

  test('a method the error only mentions stays (v22 G2 Maths Q12)', () => {
    const accept = ['Repeated subtraction', 'Equal sharing with objects', 'Using the 4 times table'];
    expect(dropContradictedAccepts(accept, '8', 'Miscounting during repeated subtraction.').accept).toEqual(accept);
  });

  test('an Urdu error drops nothing: the verb comes last (v12 G1 GK Q5)', () => {
    expect(dropContradictedAccepts(['بس', 'گاڑی'], 'بس', 'بس کی جگہ ریل گاڑی لکھنا').accept).toEqual(['بس', 'گاڑی']);
  });

  test('never drops the key answer, even when the error quotes it', () => {
    const r = dropContradictedAccepts(['there', 'over there'], 'there', 'Writing their instead of there');
    expect(r.accept).toEqual(['there', 'over there']);
  });

  test('matches whole words only, ignoring case and quotes', () => {
    expect(dropContradictedAccepts(['Jump'], 'jumping', "writing 'jump' without ing").accept).toEqual([]);
    expect(dropContradictedAccepts(['run'], 'running', 'Writing runner').accept).toEqual(['run']);
  });

  test('a sentence-long entry is not a form, so it stays', () => {
    const line = 'any answer that names the source of energy';
    expect(dropContradictedAccepts([line], 'the sun', line).accept).toEqual([line]);
  });

  test('a one-character entry is left alone', () => {
    expect(dropContradictedAccepts(['a'], 'an', 'Writing a before a vowel').accept).toEqual(['a']);
  });

  test('no common error, or no list: unchanged', () => {
    expect(dropContradictedAccepts(['run'], 'running', undefined).accept).toEqual(['run']);
    expect(dropContradictedAccepts(undefined, 'running', 'x').accept).toBeUndefined();
  });
});

describe('normaliseScheme on the v22 G1 English Q8 rows', () => {
  test('the base verb leaves accept; the common error stays', () => {
    const { examJson, log } = normaliseScheme(g1English([
      actionWord('running', ['running', 'run'], 'Writing run without ing or misspelling runing'),
      actionWord('jumping', ['jumping', 'jump'], 'Writing jump without ing'),
      actionWord('swimming', ['swimming', 'swim'], 'Writing swiming with one m'),
    ]));
    const rows = examJson.unseen.subjective['Action Words'];
    expect(rows.map((q) => q.scheme.accept)).toEqual([['running'], ['jumping'], ['swimming']]);
    expect(rows[0].scheme.common_error).toBe('Writing run without ing or misspelling runing');
    expect(log.filter((l) => /is the common error/.test(l))).toHaveLength(2);
  });
});
