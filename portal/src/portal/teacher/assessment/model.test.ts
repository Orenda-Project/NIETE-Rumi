import { describe, it, expect } from 'vitest';
import {
  newPicks, unseenTotal, questionTotal, sourceOf, rangesText, stepReady, toSpec, fromSpec, groupPapersByDay, pkDay, dayLabel,
  type Picks,
} from './model';

/**
 * bd-fmf24g.6 — the New paper's rules, as the WhatsApp Flow keeps them (assessment-gen-endpoint.js,
 * question-types.js) and as POST /api/internal/assessment/create now takes them. She chooses the paper in parts: a
 * seen (book) count and a count for each unseen type; the paper is what they add up to (seen only, unseen only, or both).
 */

const base = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15),
  grade: 4, subject: 'science', subjectName: 'Science', chapters: [1, 2],
  typesSeeded: true, seen: 0, typeCounts: { MCQs: 15 },
  ...over,
});

describe('newPicks', () => {
  it('starts with 5 seen, no types yet (Questions fills in the default mix), no marks budget, answer lines on', () => {
    const p = newPicks(15);
    expect(p).toMatchObject({
      grade: null, subject: null, coverBy: 'chapters', chapters: [], ranges: [],
      seen: 5, typeCounts: {}, typesSeeded: false, marks: null, answerLines: true,
    });
  });
});

describe('the paper adds itself up', () => {
  it('seen and the unseen types; a type emptied to 0 counts nothing', () => {
    const p = base({ seen: 5, typeCounts: { MCQs: 4, 'True/False': 3, 'Brief Answers': 0 } });
    expect(unseenTotal(p)).toBe(7);
    expect(questionTotal(p)).toBe(12);
  });

  it('names where the questions come from: seen, unseen or both', () => {
    expect(sourceOf(base({ seen: 4, typeCounts: {} }))).toBe('seen');
    expect(sourceOf(base({ seen: 0, typeCounts: { MCQs: 3 } }))).toBe('unseen');
    expect(sourceOf(base({ seen: 4, typeCounts: { MCQs: 3 } }))).toBe('both');
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

  it('questions: 1..max in all, and a marks budget of 1..1000 that is not under the question count', () => {
    expect(stepReady('questions', base({ seen: 0, typeCounts: {} }), 50)).toBe(false);
    expect(stepReady('questions', base({ seen: 40, typeCounts: { MCQs: 11 } }), 50)).toBe(false);
    expect(stepReady('questions', base({ seen: 5, typeCounts: { MCQs: 10 } }), 50)).toBe(true);
    expect(stepReady('questions', base({ marks: 0 }), 50)).toBe(false);
    expect(stepReady('questions', base({ marks: 1001 }), 50)).toBe(false);
    expect(stepReady('questions', base({ marks: 14 }), 50)).toBe(false);
    expect(stepReady('questions', base({ marks: 40 }), 50)).toBe(true);
  });

  it('check: every step ready', () => {
    expect(stepReady('check', base(), 50)).toBe(true);
    expect(stepReady('check', base({ chapters: [] }), 50)).toBe(false);
  });
});

describe('toSpec — what POST /api/portal/assessment/generate is sent', () => {
  it('chapters, unseen questions in her types', () => {
    expect(toSpec(base())).toEqual({
      grade: 4, subject: 'science', chapterNumbers: [1, 2], pageRanges: null,
      questionCount: 15, contentSource: 'unseen', seenCount: null, questionTypes: [{ id: 'MCQs', count: 15 }],
      totalMarks: null, answerLines: true, outputFormat: 'pdf',
    });
  });

  it('pages instead of chapters', () => {
    const s = toSpec(base({ coverBy: 'pages', ranges: [[4, 14], [30, 33]] }));
    expect(s.chapterNumbers).toBeNull();
    expect(s.pageRanges).toBe('4-14, 30-33');
  });

  it('both: the seen count and her per-type counts (in the order she added them)', () => {
    const s = toSpec(base({
      seen: 5, typeCounts: { MCQs: 4, 'True/False': 3, 'Brief Answers': 3 }, marks: 40, answerLines: false,
    }));
    expect(s).toMatchObject({
      contentSource: 'both', questionCount: 15, seenCount: 5, totalMarks: 40, answerLines: false,
      questionTypes: [{ id: 'MCQs', count: 4 }, { id: 'True/False', count: 3 }, { id: 'Brief Answers', count: 3 }],
    });
  });

  it('a seen-only paper sends no types and no seen count', () => {
    const s = toSpec(base({ seen: 4, typeCounts: {} }));
    expect(s).toMatchObject({ contentSource: 'seen', questionCount: 4, seenCount: null, questionTypes: [] });
  });

  it('types emptied to 0 are left out', () => {
    const s = toSpec(base({ typeCounts: { MCQs: 4, 'True/False': 0 } }));
    expect(s.questionTypes).toEqual([{ id: 'MCQs', count: 4 }]);
  });
});

describe('fromSpec — Change choices after a paper failed', () => {
  it('rebuilds her choices from the request she sent', () => {
    const p = base({ seen: 5, typeCounts: { MCQs: 6, 'Brief Answers': 4 }, marks: 40 });
    expect(fromSpec(toSpec(p), 'Science')).toMatchObject({
      grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1, 2],
      seen: 5, typeCounts: { MCQs: 6, 'Brief Answers': 4 }, typesSeeded: true, marks: 40, answerLines: true,
    });
    expect(fromSpec(toSpec(base({ seen: 8, typeCounts: {} })), null)).toMatchObject({ seen: 8, typeCounts: {}, typesSeeded: true });
  });

  it('reads an older request too: one chapterNumber, type names (Questions refills the mix), page ranges', () => {
    expect(fromSpec({ grade: 5, subject: 'maths', chapterNumber: 3, questionCount: 10, questionTypes: ['MCQs'] }, null))
      .toMatchObject({ chapters: [3], coverBy: 'chapters', seen: 0, typeCounts: {}, typesSeeded: false });
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
