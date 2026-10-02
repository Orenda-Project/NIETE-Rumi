'use strict';
const bank = require('./fixtures/item-bank.fixture.json');
const { assembleMarks, aiStatusFor } = require('../../../bot/shared/services/child-test/scoring/assemble');
const thresholds = require('../../../bot/shared/services/child-test/scoring/thresholds');

const form = bank.grades['3'].forms.A;

describe('child-test ai_marks assembler (ai-marks-v1)', () => {
  test('urdu block: every contract key present, maths null, first sounds hint-only', () => {
    const m = assembleMarks({
      block: 'urdu', form,
      parts: {
        story: { words_correct: 18, words_attempted: 20, seconds: 60, finished_early: false, flagged: [{ idx: 6, word: 'دریائے', verdict: 'wrong', confidence: 0.8 }], confidence: 0.85 },
        questions: [{ id: 'u3A-q1', verdict: 'correct', heard: 'ابو کے ساتھ', confidence: 0.9 }],
        first_sounds: [{ id: 'u3A-fs1', verdict: 'correct', heard: 'ا', confidence: 0.9 }],
        nonwords: [{ id: 'u3A-nw1', verdict: 'wrong', heard: 'تمار', confidence: 0.5 }],
      },
      flags: ['prompting_during_timed_minute', 'prompting_during_timed_minute'],
      modelVersions: { stt: 'soniox:stt-async-v4', counts: 'google/gemini-3.8-flash' },
      meta: { calls: [] },
    });
    expect(m.version).toBe('ai-marks-v1');
    expect(Object.keys(m)).toEqual(expect.arrayContaining(['story', 'fallback', 'questions', 'first_sounds', 'nonwords', 'maths', 'protocol_flags', 'model_versions', 'meta']));
    expect(m.maths).toBeNull();
    expect(m.fallback).toBeNull();
    expect(m.protocol_flags).toEqual(['prompting_during_timed_minute']);
    // first sounds are always a hint, never more confident than the hint cap
    expect(m.first_sounds[0].hint_only).toBe(true);
    expect(m.first_sounds[0].confidence).toBeLessThanOrEqual(thresholds.HINT_CONFIDENCE_CAP);
    // questions the scorer did not return are filled as none with zero confidence, in item order
    expect(m.questions.map((q) => q.id)).toEqual(['u3A-q1', 'u3A-q2', 'u3A-q3']);
    expect(m.questions[1]).toMatchObject({ verdict: 'none', confidence: 0 });
    expect(m.nonwords.map((q) => q.id)).toEqual(['u3A-nw1', 'u3A-nw2']);
  });

  test('rejects an unknown verdict and clamps confidence into [0,1]', () => {
    const m = assembleMarks({ block: 'english', form, parts: { questions: [{ id: 'e3A-q1', verdict: 'maybe', confidence: 3 }] } });
    expect(m.questions[0]).toMatchObject({ verdict: 'none', confidence: 0 });
    const m2 = assembleMarks({ block: 'english', form, parts: { questions: [{ id: 'e3A-q1', verdict: 'correct', confidence: 3 }] } });
    expect(m2.questions[0].confidence).toBe(1);
    expect(m2.first_sounds).toEqual([]);   // english has none
  });

  test('maths block: maths object in contract shape, reading keys null', () => {
    const m = assembleMarks({
      block: 'maths', form,
      parts: { maths: {
        numbers: [{ id: 'm3A-n1', verdict: 'correct', heard: '47', confidence: 0.85 }],
        quick_sums: { correct: 3, attempted: 4, seconds: 60, confidence: 0.7 },
        written: [{ id: 'm3A-w1', read_answer: '62', verdict: 'correct', confidence: 0.9 }],
        word_problem: { verdict: 'correct', read_answer: '9', confidence: 0.7 },
      } },
    });
    expect(m.story).toBeNull();
    expect(m.questions).toEqual([]);
    expect(m.maths.numbers.map((n) => n.id)).toEqual(['m3A-n1', 'm3A-n2', 'm3A-n3', 'm3A-n4']);
    expect(m.maths.written.map((n) => n.verdict)).toEqual(['correct', 'unreadable', 'unreadable', 'unreadable']);
    expect(m.maths.quick_sums).toMatchObject({ correct: 3, attempted: 4, seconds: 60 });
  });

  test('aiStatusFor: scored when every section scored, partial when some failed, failed when none', () => {
    expect(aiStatusFor('urdu', { story: true, questions: true, first_sounds: true, nonwords: true })).toBe('scored');
    expect(aiStatusFor('urdu', { story: true, questions: false, first_sounds: true, nonwords: true })).toBe('partial');
    expect(aiStatusFor('urdu', { story: false, questions: false, first_sounds: false, nonwords: false })).toBe('failed');
    expect(aiStatusFor('maths', { numbers: true, quick_sums: true, written: false, word_problem: true })).toBe('partial');
  });
});
