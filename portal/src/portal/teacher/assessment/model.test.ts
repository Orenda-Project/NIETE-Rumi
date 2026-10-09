import { describe, it, expect } from 'vitest';
import {
  newPicks, unseenTarget, typesTotal, rangesText, stepReady, toSpec, fromSpec, groupPapersByDay, pkDay, dayLabel,
  type Picks,
} from './model';

/**
 * bd-fmf24g.6 — the New paper's rules, as the WhatsApp Flow keeps them (assessment-gen-endpoint.js,
 * question-types.js) and as POST /api/internal/assessment/create now takes them:
 *   Book (seen) papers have no types; New (unseen) papers' types add up to the count; Mix papers take
 *   a book count that leaves room for at least one new question, and their types add up to the rest.
 */

const base = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15),
  grade: 4, subject: 'science', subjectName: 'Science', chapters: [1, 2],
  ...over,
});

describe('newPicks', () => {
  it('starts on the bot\'s default count, new questions, auto mix, no marks budget, answer lines on', () => {
    const p = newPicks(15);
    expect(p).toMatchObject({
      grade: null, subject: null, coverBy: 'chapters', chapters: [], ranges: [], count: 15,
      source: 'unseen', typeMode: 'auto', typeCounts: {}, marks: null, answerLines: true,
    });
  });
});

describe('unseenTarget / typesTotal', () => {
  it('book papers have no new questions; new papers are all new; mix is the rest after the book', () => {
    expect(unseenTarget(base({ source: 'seen' }))).toBe(0);
    expect(unseenTarget(base({ source: 'unseen', count: 12 }))).toBe(12);
    expect(unseenTarget(base({ source: 'both', count: 15, seen: 5 }))).toBe(10);
  });

  it('adds up only the types she picked', () => {
    expect(typesTotal(base({ typeCounts: { MCQs: 4, 'True/False': 3 } }))).toBe(7);
  });
});

describe('rangesText', () => {
  it('joins her page ranges the way the bot reads them', () => {
    expect(rangesText([[4, 14], [30, 33]])).toBe('4-14, 30-33');
    expect(rangesText([[7, 7]])).toBe('7-7');
    expect(rangesText([])).toBe('');
  });
});

describe('stepReady', () => {
  it('class: a grade and a subject', () => {
    expect(stepReady('class', newPicks(15), 50)).toBe(false);
    expect(stepReady('class', base(), 50)).toBe(true);
  });

  it('cover: at least one chapter, or at least one page range', () => {
    expect(stepReady('cover', base({ chapters: [] }), 50)).toBe(false);
    expect(stepReady('cover', base({ coverBy: 'pages', chapters: [1], ranges: [] }), 50)).toBe(false);
    expect(stepReady('cover', base({ coverBy: 'pages', ranges: [[4, 14]] }), 50)).toBe(true);
  });

  it('questions: 1..max, and on Mix a book count that leaves room for new questions', () => {
    expect(stepReady('questions', base({ count: 0 }), 50)).toBe(false);
    expect(stepReady('questions', base({ count: 51 }), 50)).toBe(false);
    expect(stepReady('questions', base({ source: 'both', count: 10, seen: 10 }), 50)).toBe(false);
    expect(stepReady('questions', base({ source: 'both', count: 10, seen: 0 }), 50)).toBe(false);
    expect(stepReady('questions', base({ source: 'both', count: 10, seen: 4 }), 50)).toBe(true);
  });

  it('types: auto is always fine; picked counts must add up to the new questions', () => {
    expect(stepReady('types', base({ typeMode: 'auto' }), 50)).toBe(true);
    expect(stepReady('types', base({ typeMode: 'pick', count: 10, typeCounts: { MCQs: 4 } }), 50)).toBe(false);
    expect(stepReady('types', base({ typeMode: 'pick', count: 10, typeCounts: { MCQs: 4, 'Brief Answers': 6 } }), 50)).toBe(true);
    expect(stepReady('types', base({
      typeMode: 'pick', source: 'both', count: 15, seen: 5, typeCounts: { MCQs: 10 },
    }), 50)).toBe(true);
  });

  it('extras: no budget, or 1..1000', () => {
    expect(stepReady('extras', base({ marks: null }), 50)).toBe(true);
    expect(stepReady('extras', base({ marks: 0 }), 50)).toBe(false);
    expect(stepReady('extras', base({ marks: 1001 }), 50)).toBe(false);
    expect(stepReady('extras', base({ marks: 40 }), 50)).toBe(true);
  });

  it('check: every step ready', () => {
    expect(stepReady('check', base(), 50)).toBe(true);
    expect(stepReady('check', base({ chapters: [] }), 50)).toBe(false);
  });
});

describe('toSpec — what POST /api/portal/assessment/generate is sent', () => {
  it('chapters, new questions, auto mix', () => {
    expect(toSpec(base())).toEqual({
      grade: 4, subject: 'science', chapterNumbers: [1, 2], pageRanges: null,
      questionCount: 15, contentSource: 'unseen', seenCount: null, questionTypes: [],
      totalMarks: null, answerLines: true, outputFormat: 'pdf',
    });
  });

  it('pages instead of chapters', () => {
    const s = toSpec(base({ coverBy: 'pages', ranges: [[4, 14], [30, 33]] }));
    expect(s.chapterNumbers).toBeNull();
    expect(s.pageRanges).toBe('4-14, 30-33');
  });

  it('mix with a book count and her per-type counts (in the order she ticked them)', () => {
    const s = toSpec(base({
      source: 'both', count: 15, seen: 5, typeMode: 'pick',
      typeCounts: { MCQs: 4, 'True/False': 3, 'Brief Answers': 3 }, marks: 40, answerLines: false,
    }));
    expect(s).toMatchObject({
      contentSource: 'both', questionCount: 15, seenCount: 5, totalMarks: 40, answerLines: false,
      questionTypes: [{ id: 'MCQs', count: 4 }, { id: 'True/False', count: 3 }, { id: 'Brief Answers', count: 3 }],
    });
  });

  it('a book paper sends no types and no book count', () => {
    const s = toSpec(base({ source: 'seen', seen: 4, typeMode: 'pick', typeCounts: { MCQs: 15 } }));
    expect(s.seenCount).toBeNull();
    expect(s.questionTypes).toEqual([]);
  });

  it('types picked with a zero count are left out', () => {
    const s = toSpec(base({ typeMode: 'pick', count: 4, typeCounts: { MCQs: 4, 'True/False': 0 } }));
    expect(s.questionTypes).toEqual([{ id: 'MCQs', count: 4 }]);
  });
});

describe('fromSpec — Change choices after a paper failed', () => {
  it('rebuilds her v2 choices from the request she sent', () => {
    const p = base({
      source: 'both', count: 15, seen: 5, typeMode: 'pick', typeCounts: { MCQs: 6, 'Brief Answers': 4 }, marks: 40,
    });
    expect(fromSpec(toSpec(p), 'Science')).toMatchObject({
      grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1, 2],
      count: 15, source: 'both', seen: 5, typeMode: 'pick', typeCounts: { MCQs: 6, 'Brief Answers': 4 },
      marks: 40, answerLines: true,
    });
  });

  it('reads an older request too: one chapterNumber, type names, page ranges', () => {
    expect(fromSpec({ grade: 5, subject: 'maths', chapterNumber: 3, questionCount: 10, questionTypes: ['MCQs'] }, null))
      .toMatchObject({ chapters: [3], coverBy: 'chapters', typeMode: 'auto', source: 'unseen', count: 10 });
    expect(fromSpec({ grade: 5, subject: 'maths', pageRanges: '4-14, 30-33', questionCount: 10 }, null))
      .toMatchObject({ coverBy: 'pages', ranges: [[4, 14], [30, 33]] });
  });
});

describe('days (Pakistan)', () => {
  it('names an instant\'s Pakistan day', () => {
    // 20:00 UTC on 7 Oct is 01:00 on 8 Oct in Pakistan.
    expect(pkDay('2026-10-07T20:00:00Z')).toBe('2026-10-08');
    expect(pkDay(null)).toBeNull();
  });

  it('Today, Yesterday, then the date', () => {
    expect(dayLabel('2026-10-08', '2026-10-08')).toBe('Today');
    expect(dayLabel('2026-10-07', '2026-10-08')).toBe('Yesterday');
    expect(dayLabel('2026-10-05', '2026-10-08')).toBe('Mon 5 Oct');
  });

  it('groups papers by the day they were ready, newest day first, keeping each day\'s order', () => {
    const papers = [
      { paper_id: 'a', ready_at: '2026-10-08T05:00:00Z' },
      { paper_id: 'b', ready_at: '2026-10-07T06:00:00Z' },
      { paper_id: 'c', ready_at: '2026-10-08T03:00:00Z' },
      { paper_id: 'd', ready_at: null },
    ];
    const groups = groupPapersByDay(papers, '2026-10-08');
    expect(groups.map((g) => [g.day, g.items.map((p) => p.paper_id)])).toEqual([
      ['Today', ['a', 'c']],
      ['Yesterday', ['b']],
    ]);
  });
});
