'use strict';
/**
 * bd-snkn32.58.2 (queue #155 B) — guardrails for a typed topic (Amena 19 Nov: "how do we set guardrails for misspelled
 * words"). No model call: a pure match against the official goals of her grade.
 *
 *   Normalise       lowercase, Urdu marks dropped, ی/ي ک/ك ہ/ه unified
 *   Roman Urdu      a small school-word table (jama, zarb, nazm, parhna, hindsa …) → English + Urdu words
 *   Misspelling     edit distance ≤1 (4–6 letters), ≤2 (7+), or a shared start of 4+ letters; ranked by score
 *   Did you mean    up to 3 of her grade's goals; never a plan without her tap
 *   Grade check     a goal of another grade (±2) that fits clearly better is named
 *   Refusal         a blocked word, or nothing on the curriculum: no suggestion, no plan
 */
const G = require('../../bot/shared/services/lp-own-goal-guard');

const row = (id, text, chapter = null) => ({ segment_id: id, slo_descriptions: [text], chapter_title: chapter, menu_title: null });
const G3_MATHS = [
  row('d1', 'Add up to 4-digit numbers with and without regrouping in written form.', 'Plus and Minus'),
  row('d2', 'Multiply 2 digit numbers by 1 digit number mentally and in written form.', 'Multiplication'),
  row('d3', 'Multiply numbers by 6, 7, 8, and 9 using times table.', 'Multiplication'),
  row('d4', 'Identify and recognise proper fractions, improper fractions, mixed fractions.', 'Fractions'),
  row('d5', 'Read and write time in hours and minutes from both analogue and digital clocks.', 'Time'),
];
const G4_MATHS = [
  row('e1', 'Recognise, read, and write decimal numbers and identify the place value of decimal numbers.', 'Decimals'),
  row('e2', 'Add and subtract unlike fractions.', 'Fractions'),
];
const G3_URDU = [
  row('u1', 'نظم کو درست تلفظ اور لہجے کے ساتھ بلند آواز سے پڑھ سکیں۔', 'نظم'),
  row('u2', 'تحریر میں اسم اور فعل کی شناخت کر سکیں۔', 'قواعد'),
];

describe('normalise', () => {
  it('lowercase, Urdu marks dropped, Arabic letter forms unified', () => {
    expect(G.normalise('MULTIPLY')).toBe('multiply');
    expect(G.normalise('گَھر')).toBe('گھر');
    expect(G.normalise('كتاب')).toBe('کتاب');
    expect(G.normalise('علي')).toBe('علی');
    expect(G.normalise('مدرسه')).toBe('مدرسہ');
  });
});

describe('editDistance', () => {
  it('counts single-letter changes', () => {
    expect(G.editDistance('multiplcation', 'multiplication')).toBe(1);
    expect(G.editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('guardTopic: did you mean', () => {
  it('a misspelling still finds the goal', () => {
    const r = G.guardTopic('multiplcation by 2', { rows: G3_MATHS });
    expect(r.status).toBe('ok');
    expect(r.suggestions[0].segmentId).toMatch(/^d[23]$/);
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
  });
  it('Roman Urdu school words: "jama 2 hindsay" → adding', () => {
    const r = G.guardTopic('jama 2 hindsay', { rows: G3_MATHS });
    expect(r.status).toBe('ok');
    expect(r.suggestions[0].segmentId).toBe('d1');
  });
  it('Roman Urdu to an Urdu goal: "nazm parhna" → reading a poem', () => {
    const r = G.guardTopic('nazm parhna', { rows: G3_URDU });
    expect(r.status).toBe('ok');
    expect(r.suggestions[0].segmentId).toBe('u1');
  });
  it('Urdu typed in Urdu: "اسم"', () => {
    expect(G.guardTopic('اسم', { rows: G3_URDU }).suggestions[0].segmentId).toBe('u2');
  });
  it('suggestions carry the goal text, once each, and never a chapter name (bd-snkn32.61)', () => {
    const r = G.guardTopic('multiply', { rows: G3_MATHS });
    expect(r.suggestions.map((s) => s.segmentId)).toEqual(['d2', 'd3']);
    expect(r.suggestions[0]).toEqual({ segmentId: 'd2', text: G3_MATHS[1].slo_descriptions[0] });
  });
});

describe('guardTopic: refusals', () => {
  it('off the curriculum: none', () => {
    expect(G.guardTopic('cricket world cup', { rows: G3_MATHS })).toEqual({ status: 'none', suggestions: [] });
  });
  it('a blocked word: blocked, even next to a real goal word', () => {
    expect(G.guardTopic('multiply guns', { rows: G3_MATHS })).toEqual({ status: 'blocked', suggestions: [] });
    expect(G.guardTopic('شراب', { rows: G3_URDU }).status).toBe('blocked');
    expect(G.guardTopic('sharab', { rows: G3_URDU }).status).toBe('blocked');
  });
  it('too short or empty: none', () => {
    expect(G.guardTopic('', { rows: G3_MATHS }).status).toBe('none');
    expect(G.guardTopic('a', { rows: G3_MATHS }).status).toBe('none');
  });
});

describe('guardTopic: grade check', () => {
  it('a goal of another grade that fits clearly better is named', () => {
    const r = G.guardTopic('decimal place value', { rows: G3_MATHS, others: [{ grade: 4, rows: G4_MATHS }] });
    expect(r.otherGrade).toEqual(expect.objectContaining({ grade: 4, segmentId: 'e1' }));
  });
  it('no grade line when her own grade fits as well', () => {
    const r = G.guardTopic('fractions', { rows: G3_MATHS, others: [{ grade: 4, rows: G4_MATHS }] });
    expect(r.status).toBe('ok');
    expect(r.otherGrade).toBeUndefined();
  });
});

describe('hasBlockedWord (the Check-screen note)', () => {
  it('finds a blocked word in English, Urdu or Roman Urdu; ordinary notes pass', () => {
    expect(G.hasBlockedWord('please add a gun game')).toBe(true);
    expect(G.hasBlockedWord('bachon ko sharab ka bata do')).toBe(true);
    expect(G.hasBlockedWord('بچوں کو جوا کھیلنا')).toBe(true);
    expect(G.hasBlockedWord('Use the playground for counting')).toBe(false);
    expect(G.hasBlockedWord('skills and drills')).toBe(false);
  });
});

describe('everyday English to the official wording', () => {
  it('"poem reading aloud" finds "read prose and poetry orally"', () => {
    const rows = [row('r1', 'Read prose and poetry orally with expression.'), row('r2', 'Identify days of the week and month')];
    expect(G.guardTopic('poem reading aloud', { rows }).suggestions[0].segmentId).toBe('r1');
  });
});

describe('a near-miss counts less than a real word', () => {
  it('"cricket world cup" does not land on a "word" goal that mentions a cup', () => {
    const rows = [row('w1', 'Use common nouns such as cup, bag and pen in a word list.')];
    expect(G.guardTopic('cricket world cup', { rows }).status).toBe('none');
  });
});
